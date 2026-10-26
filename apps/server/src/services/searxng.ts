import { ProviderConfigError, type ProviderConfig } from '@ai-reading-partner/ai';
import { createNormalizedHash } from '@ai-reading-partner/core';
import { CacheRepository } from '@ai-reading-partner/db';

export interface SearxngResult {
  url: string;
  title: string;
  snippet: string;
  engine?: string;
  score?: number;
}

export class SearxngClient {
  constructor(
    private readonly providerConfig: ProviderConfig,
    private readonly cache?: CacheRepository,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.providerConfig.current.searxng?.base_url);
  }

  async search(projectId: string, query: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<SearxngResult[]> {
    options.signal?.throwIfAborted();
    const config = this.providerConfig.current;
    const baseUrl = config.searxng?.base_url;
    if (!baseUrl) throw new Error('SearXNG is not configured');
    const generatedQuery = this.generateQuery(query);
    if (!generatedQuery) return [];

    const limit = options.limit ?? config.searxng?.max_results ?? 8;
    const cacheKey = createNormalizedHash(`${generatedQuery}\n${limit}`);
    const cachedSearch = this.cache?.findWeb(projectId, 'search', cacheKey);
    if (this.cache && cachedSearch?.content && cachedSearch.status === 'ready' && new Date(cachedSearch.expires_at) > new Date()) {
      try {
        return JSON.parse(cachedSearch.content) as SearxngResult[];
      } catch {
        // Fall through to a fresh request when a cached payload is invalid.
      }
    }

    const url = new URL('search', ensureTrailingSlash(baseUrl));
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', generatedQuery);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('SearXNG request timed out')), config.searxng?.timeout_ms ?? 20_000);
    try {
      const response = await fetch(url, { signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal });
      if (!response.ok) throw new Error(`SearXNG returned HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) throw new Error('SearXNG JSON API is disabled');
      const payload = await response.json() as unknown;
      const results = parseSearxngResponse(payload, limit);
      this.cache?.saveWeb({
        projectId,
        url: 'search',
        queryHash: cacheKey,
        title: 'SearXNG result set',
        content: JSON.stringify(results),
        status: 'ready',
        sourceMetadata: {
          endpoint: url.toString(),
          query: generatedQuery,
          result_count: results.length,
          fetched_at: new Date().toISOString(),
        },
        retentionDays: 180,
      });
      return results;
    } finally {
      clearTimeout(timer);
    }
  }

  generateQuery(rawQuery: string): string {
    const collapsed = rawQuery
      .replace(/https?:\/\/\S+/gu, ' ')
      .replace(/[\r\n]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!collapsed) return '';
    const quoted = collapsed.match(/["“”']([^"“”']{2,80})["“”']/u);
    if (quoted?.[1]) return quoted[1].trim().slice(0, 160);
    const cleaned = collapsed
      .replace(/^(请|帮我|帮我搜索|搜索|查找|查询|联网搜索)[，,：:\s]+/u, '')
      .replace(/[。．，,；;！!？?]+$/u, '')
      .trim();
    return cleaned.slice(0, 160);
  }
}

function parseSearxngResponse(payload: unknown, limit: number): SearxngResult[] {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid SearXNG response');
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) throw new Error('SearXNG response has no results array');
  return results
    .map((item): SearxngResult | null => {
      if (typeof item !== 'object' || item === null) return null;
      const candidate = item as Record<string, unknown>;
      const url = typeof candidate.url === 'string' ? candidate.url : '';
      if (!isHttpUrl(url)) return null;
      return {
        url,
        title: typeof candidate.title === 'string' ? candidate.title : url,
        snippet: typeof candidate.content === 'string' ? candidate.content : '',
        engine: typeof candidate.engine === 'string' ? candidate.engine : undefined,
        score: typeof candidate.score === 'number' ? candidate.score : undefined,
      };
    })
    .filter((item): item is SearxngResult => item !== null)
    .slice(0, limit);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
