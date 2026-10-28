import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { createNormalizedHash } from '@ai-reading-partner/core';
import type { ProviderConfig } from '@ai-reading-partner/ai';
import type { CacheRepository } from '@ai-reading-partner/db';
import type { SearxngResult } from './searxng';
import { validatePublicHttpUrl } from './web-fetch';
import { searchQuery } from './evidence';

const searchResultSchema = z.object({ results: z.array(z.object({
  url: z.string().url().max(2000), title: z.string().max(300), snippet: z.string().max(3000),
  engine: z.string().optional(), score: z.number().optional(),
})).max(10), fetchedAt: z.string(), evidenceType: z.literal('snippet') });
const pageSchema = z.object({ url: z.string().url(), finalUrl: z.string().url(), title: z.string().nullable(),
  content: z.string().max(20000), fetchedAt: z.string(), evidenceType: z.literal('page') });

export class McpSearchService {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;
  private settingsKey = '';
  private closed = false;
  private connection: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';
  private backend: 'unknown' | 'ready' | 'unavailable' = 'unknown';

  constructor(private readonly config: ProviderConfig, private readonly cache?: CacheRepository) {}

  isConfigured() { return Boolean(this.config.current.searxng?.base_url) && this.config.current.mcp?.search?.enabled !== false; }

  getStatus() {
    let configured = false;
    try { configured = this.isConfigured(); } catch { }
    return { transport: 'stdio' as const, connection: this.closed ? 'closed' : !configured ? 'unconfigured' : this.connection, backend: this.backend };
  }

  private async connect(signal?: AbortSignal): Promise<Client> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('Search service closed');
    if (!this.isConfigured()) throw new Error('Search is not configured');
    const settings = this.config.current.searxng!;
    const key = JSON.stringify([settings, this.config.current.mcp?.search]);
    if (this.client && key === this.settingsKey) return this.client;
    if (this.connecting) return this.connecting;
    this.connection = 'starting';
    this.connecting = (async () => {
      await this.client?.close();
      const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL(`../mcp/search-server.${extension}`, import.meta.url))],
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ARP_SEARCH_CONFIG: JSON.stringify(settings) }, stderr: 'pipe' });
      this.transport = transport;
      transport.stderr?.on('data', () => undefined);
      const client = new Client({ name: 'ai-reading-partner', version: '1.0.0' });
      client.onclose = () => {
        if (this.client === client) { this.client = undefined; this.settingsKey = ''; this.connection = 'idle'; }
      };
      try {
        const timeout = this.config.current.mcp?.search?.startup_timeout_ms ?? 5000;
        await client.connect(transport, { timeout, signal });
        const listed = await client.listTools({}, { timeout, signal });
        if (!['search_web', 'read_web_page'].every((name) => listed.tools.some((tool) => tool.name === name))) throw new Error('Missing MCP tools');
        if (this.closed) throw new Error('Search service closed');
        this.client = client;
        this.settingsKey = key;
        this.connection = 'ready';
        return client;
      } catch {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
        this.connection = 'failed';
        throw new Error('MCP search unavailable');
      }
    })();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }

  async searchWithFallback(projectId: string, query: string, options: { limit?: number; signal?: AbortSignal; fresh?: boolean } = {}) {
    try {
      const results = await this.search(projectId, query, options);
      return { results, warning: null as string | null };
    } catch {
      options.signal?.throwIfAborted();
      this.backend = 'unavailable';
      return { results: [] as SearxngResult[], warning: '联网核验暂不可用，未核实的外部信息已保留为缺口。' };
    }
  }

  async search(projectId: string, query: string, options: { limit?: number; signal?: AbortSignal; fresh?: boolean } = {}): Promise<SearxngResult[]> {
    options.signal?.throwIfAborted();
    const limit = Math.min(Math.max(options.limit ?? 3, 1), 10);
    const generated = searchQuery(query.replace(/https?:\/\/\S+/gu, ''));
    if (!generated) return [];
    const hash = createNormalizedHash(`${generated}\n${limit}`);
    const cached = this.cache?.findWeb(projectId, 'search', hash);
    if (!options.fresh && cached?.content && cached.status === 'ready' && Date.now() - Date.parse(cached.fetched_at) < 86400000) {
      try {
        const parsed = searchResultSchema.safeParse(JSON.parse(cached.content));
        if (parsed.success) return parsed.data.results.map((item) => ({ ...item, fetchedAt: parsed.data.fetchedAt }));
      } catch { }
    }
    const client = await this.connect(options.signal);
    const reply = await client.callTool({ name: 'search_web', arguments: { query: generated, limit } }, undefined,
      { signal: options.signal, timeout: this.config.current.searxng?.timeout_ms ?? 20000 });
    if (reply.isError) throw new Error('Search unavailable');
    const payload = searchResultSchema.parse(JSON.parse(resultText(reply.content)));
    this.backend = 'ready';
    this.cache?.saveWeb({ projectId, url: 'search', queryHash: hash, content: JSON.stringify(payload),
      sourceMetadata: { transport: 'mcp-stdio', fetchedAt: payload.fetchedAt }, retentionDays: 180 });
    return payload.results.map((item) => ({ ...item, fetchedAt: payload.fetchedAt }));
  }

  async fetchPage(projectId: string, url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    try { validatePublicHttpUrl(url); } catch { throw new Error('Page unavailable: blocked destination'); }
    const cached = this.cache?.findWeb(projectId, url, 'fetch');
    if (cached?.content && cached.status === 'ready' && Date.now() - Date.parse(cached.fetched_at) < 86400000) {
      return { url, finalUrl: url, title: cached.title, content: cached.content, fetchedAt: cached.fetched_at, evidenceType: 'page' as const, cached: true };
    }
    const client = await this.connect(signal);
    const reply = await client.callTool({ name: 'read_web_page', arguments: { url } }, undefined,
      { signal, timeout: this.config.current.mcp?.search?.read_timeout_ms ?? 20000 });
    if (reply.isError) throw new Error('Page unavailable');
    const page = pageSchema.parse(JSON.parse(resultText(reply.content)));
    this.cache?.saveWeb({ projectId, url, queryHash: 'fetch', title: page.title, content: page.content,
      sourceMetadata: { transport: 'mcp-stdio', final_url: page.finalUrl, fetchedAt: page.fetchedAt }, retentionDays: 180 });
    return { ...page, cached: false };
  }

  async close() {
    this.closed = true;
    await this.connecting?.catch(() => undefined);
    await this.client?.close().catch(() => undefined);
    await this.transport?.close().catch(() => undefined);
    this.client = undefined;
  }
}

function resultText(content: unknown): string {
  const items = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).parse(content);
  const text = items.find((item) => item.type === 'text')?.text;
  if (!text || text.length > 100000) throw new Error('Invalid MCP response');
  return text;
}
