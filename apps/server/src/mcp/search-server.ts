import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SearxngClient } from '../services/searxng';
import { WebFetchService, pageReadFailure } from '../services/web-fetch';

const settings = z.object({
  base_url: z.string().url(), timeout_ms: z.number().int().positive().max(120000), max_results: z.number().int().min(1).max(50),
}).parse(JSON.parse(process.env.ARP_SEARCH_CONFIG ?? '{}'));
delete process.env.ARP_SEARCH_CONFIG;
const search = new SearxngClient({ current: { searxng: settings } });
const pages = new WebFetchService();
const server = new McpServer({ name: 'ai-reading-search', version: '1.0.0' });

server.registerTool('search_web', {
  description: 'Search SearXNG with a short query. Returns untrusted snippets, not verified page text.',
  inputSchema: { query: z.string().trim().min(1).max(160), limit: z.number().int().min(1).max(10).default(3) },
}, async ({ query, limit }, extra) => {
  try {
    const results = await search.search('', query, { limit, signal: extra.signal });
    return { content: [{ type: 'text', text: JSON.stringify({ results, fetchedAt: new Date().toISOString(), evidenceType: 'snippet' }) }] };
  } catch {
    extra.signal.throwIfAborted();
    return { isError: true, content: [{ type: 'text', text: 'search_unavailable' }] };
  }
});

server.registerTool('read_web_page', {
  description: 'Read one public HTTP page. Private destinations and unsafe redirects are blocked.',
  inputSchema: { url: z.string().url().max(2000) },
}, async ({ url }, extra) => {
  try {
    const page = await pages.fetchPage('', url, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify({ ...page, content: page.content.slice(0, 20000), fetchedAt: new Date().toISOString(), evidenceType: 'page' }) }] };
  } catch (error) {
    extra.signal.throwIfAborted();
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'page_unavailable', ...pageReadFailure(error) }) }] };
  }
});

await server.connect(new StdioServerTransport());
process.once('SIGTERM', () => { void server.close().finally(() => process.exit(0)); });
