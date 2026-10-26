import { CacheRepository, type WebCacheRecord } from '@ai-reading-partner/db';
import { ModelClient, ProviderConfigError, type ProviderConfig } from '@ai-reading-partner/ai';

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

export class WebFetchService {
  constructor(
    private readonly cache: CacheRepository,
    private readonly providerConfig?: ProviderConfig,
  ) {}

  async fetchPage(projectId: string, rawUrl: string, signal?: AbortSignal): Promise<FetchedWebPage> {
    signal?.throwIfAborted();
    const url = validatePublicHttpUrl(rawUrl);
    const cached = this.cache.findWeb(projectId, url.toString(), 'fetch');
    if (cached && cached.status === 'ready' && cached.content && new Date(cached.expires_at) > new Date()) {
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
      if (!response.ok) throw new Error(`Web page returned HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!isSupportedContentType(contentType)) {
        throw new Error(`Unsupported web content type: ${contentType || 'unknown'}`);
      }
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) throw new Error('Web page is too large');
      const raw = await response.text();
      if (raw.length > MAX_BYTES) throw new Error('Web page is too large');
      const title = contentType.includes('text/html') ? extractTitle(raw) : null;
      const content = (contentType.includes('text/html') ? extractReadableText(raw) : raw)
        .slice(0, MAX_CONTENT_CHARS)
        .trim();
      if (!content) throw new Error('No readable content found on the web page');
      signal?.throwIfAborted();
      const summary = await this.summarize(content, title ?? currentUrl.toString(), signal);
      signal?.throwIfAborted();

      const record = this.cache.saveWeb({
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
      return toFetchedPage(record);
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

async function fetchWithTimeout(url: URL, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Web page fetch timed out')), 20_000);
  try {
    return await fetch(url, {
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain',
        'User-Agent': 'AIReadingPartner/0.1 (+local)',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function validatePublicHttpUrl(value: URL | string): URL {
  const url = typeof value === 'string' ? new URL(value) : value;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked URL protocol: ${url.protocol}`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error(`Blocked private or loopback host: ${url.hostname}`);
  }
  return url;
}

function isPrivateHost(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/\.$/u, '');
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
  if (value.startsWith('fd') || value.startsWith('fe80:')) return true;
  return false;
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
