import { CacheRepository, type WebCacheRecord } from '@ai-reading-partner/db';
import { ModelClient, ProviderConfigError, type ProviderConfig } from '@ai-reading-partner/ai';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as safeFetch } from 'undici';

export interface FetchedWebPage {
  url: string;
  finalUrl: string;
  title: string | null;
  content: string;
  summary?: string | null;
  cached: boolean;
}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;
const MAX_CONTENT_CHARS = 100_000;

export const pageFailureCodes = ['access_denied', 'rate_limited', 'http_error', 'timeout', 'dns_failure', 'tls_failure', 'blocked_destination', 'unusable_content', 'unavailable'] as const;
export type PageFailureCode = typeof pageFailureCodes[number];

export class PageReadError extends Error {
  constructor(readonly code: PageFailureCode, readonly status?: number) {
    super(`Page unavailable: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'PageReadError';
  }
}

export function pageReadFailure(error: unknown): { code: PageFailureCode; status?: number } {
  if (error instanceof PageReadError) return { code: error.code, ...(error.status ? { status: error.status } : {}) };
  if (!(error instanceof Error)) return { code: 'unavailable' };
  if (['TimeoutError', 'AbortError'].includes(error.name)) return { code: 'timeout' };
  const cause = error.cause;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : 'code' in error ? error.code : undefined;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code: 'dns_failure' };
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return { code: 'timeout' };
  if (typeof code === 'string' && ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) return { code: 'tls_failure' };
  return { code: 'unavailable' };
}

export class WebFetchService {
  constructor(
    private readonly cache?: CacheRepository,
    private readonly providerConfig?: ProviderConfig,
  ) {}

  async fetchPage(projectId: string, rawUrl: string, signal?: AbortSignal): Promise<FetchedWebPage> {
    signal?.throwIfAborted();
    const url = validatePublicHttpUrl(rawUrl);
    const cached = this.cache?.findWeb(projectId, url.toString(), 'fetch');
    if (cached && cached.status === 'ready' && cached.content && Date.now() - Date.parse(cached.fetched_at) < 86400000 && new Date(cached.expires_at) > new Date()) {
      return {
        url: cached.url,
        finalUrl: safeSourceMetadata(cached.source_metadata_json).final_url ?? cached.url,
        title: cached.title,
        content: cached.content,
        summary: cached.summary,
        cached: true,
      };
    }

    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      signal?.throwIfAborted();
      const response = await fetchWithTimeout(currentUrl, signal);
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400) {
        if (!location) throw new Error(`Redirect without location: HTTP ${response.status}`);
        currentUrl = validatePublicHttpUrl(new URL(location, currentUrl));
        continue;
      }
      if (!response.ok) throw new PageReadError(response.status === 429 ? 'rate_limited' : [401, 402, 403].includes(response.status) ? 'access_denied' : 'http_error', response.status);
      const contentType = response.headers.get('content-type') ?? '';
      if (!isSupportedContentType(contentType)) {
        throw new Error(`Unsupported web content type: ${contentType || 'unknown'}`);
      }
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) throw new Error('Web page is too large');
      const raw = response.raw;
      if (raw.length > MAX_BYTES) throw new Error('Web page is too large');
      const title = contentType.includes('text/html') ? extractTitle(raw) : null;
      const content = (contentType.includes('text/html') ? extractReadableText(raw) : raw)
        .slice(0, MAX_CONTENT_CHARS)
        .trim();
      if (!content) throw new Error('No readable content found on the web page');
      signal?.throwIfAborted();
      const summary = await this.summarize(content, title ?? currentUrl.toString(), signal);
      signal?.throwIfAborted();

      const record = this.cache?.saveWeb({
        projectId,
        url: url.toString(),
        queryHash: 'fetch',
        title,
        content,
        summary,
        status: 'ready',
        sourceMetadata: {
          final_url: currentUrl.toString(),
          content_type: contentType,
          fetched_at: new Date().toISOString(),
          byte_limit: MAX_BYTES,
        },
      });
      return record ? toFetchedPage(record) : { url: url.toString(), finalUrl: currentUrl.toString(), title, content, cached: false };
    }
    throw new Error('Too many redirects');
  }

  async summarize(content: string, title: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.providerConfig) return null;
    try {
      const providerFile = this.providerConfig.current;
      const client = new ModelClient(providerFile);
      const result = await client.complete({
        tier: 'light',
        messages: [
          { role: 'system', content: '你是网页资料压缩器。用不超过 220 个字的简体中文总结关键事实，保留时间、数据和来源要点，不要添加观点。' },
          { role: 'user', content: `标题：${title}\n\n网页内容：\n${content.slice(0, 12_000)}` },
        ],
        maxTokens: 400,
        temperature: 0.1,
        signal,
      });
      return result.content.trim() || null;
    } catch (error) {
      if (error instanceof ProviderConfigError) return null;
      return null;
    }
  }
}

async function fetchWithTimeout(url: URL, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new PageReadError('timeout')), 20_000);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let dispatcher: Agent | undefined;
  let abortDns: (() => void) | undefined;
  try {
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        if (combined.aborted) reject(combined.reason);
        else { abortDns = () => reject(combined.reason); combined.addEventListener('abort', abortDns, { once: true }); }
      }),
    ]);
    combined.throwIfAborted();
    if (!addresses.length || addresses.some((entry) => isPrivateHost(entry.address))) throw new Error('Blocked resolved address');
    const pinned = addresses[0]!;
    dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    } } });
    const response = await safeFetch(url, {
      redirect: 'manual',
      dispatcher,
      signal: combined,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain',
        'User-Agent': 'AIReadingPartner/0.1 (+local)',
      },
    });
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Web page is too large');
    if (response.body) for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > MAX_BYTES) throw new Error('Web page is too large');
      chunks.push(chunk);
    }
    return { status: response.status, ok: response.ok, headers: response.headers, raw: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
    if (abortDns) combined.removeEventListener('abort', abortDns);
    await dispatcher?.destroy();
  }
}

export function validatePublicHttpUrl(value: URL | string): URL {
  const url = typeof value === 'string' ? new URL(value) : value;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password || isPrivateHost(url.hostname)) {
    throw new Error(`Blocked private or loopback host: ${url.hostname}`);
  }
  return url;
}

export function isPrivateHost(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  if (value === '::1' || value === '[::1]' || value === '0.0.0.0') return true;
  if (value.startsWith('127.')) return true;
  if (value.startsWith('10.')) return true;
  if (value.startsWith('192.168.')) return true;
  if (value.startsWith('169.254.')) return true;
  if (value.startsWith('172.')) {
    const second = Number(value.split('.')[1]);
    if (Number.isInteger(second) && second >= 16 && second <= 31) return true;
  }
  if (!isIP(value)) return value.endsWith('.local') || value.endsWith('.internal');
  const blocked = new BlockList();
  for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4');
  if (isIP(value) === 6) for (const [address, prefix] of [['::', 96], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]] as const) blocked.addSubnet(address, prefix, 'ipv6');
  return blocked.check(value, isIP(value) === 6 ? 'ipv6' : 'ipv4');
}

function isSupportedContentType(contentType: string): boolean {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized === 'text/plain'
    || normalized === 'text/html'
    || normalized === 'application/xhtml+xml';
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  return match ? decodeHtmlEntities(match[1] ?? '').trim() : null;
}

function extractReadableText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/giu, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/giu, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/giu, ' ');
  return decodeHtmlEntities(withoutScripts
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim());
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function toFetchedPage(record: WebCacheRecord): FetchedWebPage {
  const metadata = safeSourceMetadata(record.source_metadata_json);
  return {
    url: record.url,
    finalUrl: metadata.final_url ?? record.url,
    title: record.title,
    content: record.content ?? '',
    summary: record.summary,
    cached: false,
  };
}

function safeSourceMetadata(value: string | null | undefined): { final_url?: string } {
  try {
    const parsed = JSON.parse(value ?? '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as { final_url?: unknown }).final_url === 'string'
      ? parsed as { final_url: string }
      : {};
  } catch {
    return {};
  }
}
