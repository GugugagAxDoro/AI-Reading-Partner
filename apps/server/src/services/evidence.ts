import { createNormalizedHash, normalizeText, tokenForIndex, type SourceReference } from '@ai-reading-partner/core';
import { z } from 'zod';
import type { AiActionType } from './prompts';

export const readingRequestSchema = z.object({
  projectId: z.string().min(1), documentId: z.string().min(1).nullable(),
  conversationId: z.string().min(1).optional(), requestId: z.string().min(1).max(100),
  action: z.enum(['vocabulary_explanation', 'content_interpretation', 'custom_question']),
  question: z.string().max(12000),
  selection: z.object({ text: z.string().min(1).max(30000), page: z.number().int().positive(),
    documentHash: z.string().optional(), startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(), endPage: z.number().int().positive().optional(),
    prefix: z.string().optional(), suffix: z.string().optional(),
  }).optional(),
  parents: z.array(z.string()).max(2).default([]),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(4).default([]),
  webPolicy: z.enum(['auto', 'off']), language: z.string().default('简体中文'),
  version: z.literal(1).default(1),
});
export type ReadingRequest = z.infer<typeof readingRequestSchema>;

export const evidenceDecisionSchema = z.object({
  action: z.enum(['answer', 'search_current_document', 'search_project', 'search_web', 'read_web_page']),
  query: z.string().max(160).optional(), url: z.string().url().optional(),
  gaps: z.array(z.string().max(100)).max(6).default([]),
  claims: z.array(z.string().max(100)).max(8).default([]),
  reason: z.string().max(120).default(''),
});

export function requiresExternal(question: string) {
  return /联网|网上|网络搜索|查网|最新|当前(?:价格|利率|政策|版本|现状)|截至|实时|核验|查证|web\s*search|search\s*(?:the\s*)?web|latest|up.to.date/iu.test(question);
}

export function searchQuery(question: string, selectedText = '', context = '') {
  const cleaned = question.replace(/(?:请|帮我|联网|网上|网络搜索|查网|核验|查证|简要|详细|解释|解读|分析|一下|的含义|适用条件)/gu, ' ')
    .replace(/(?:sk-[\w-]{8,}|Bearer\s+\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/giu, ' ')
    .replace(/(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/giu, ' ')
    .replace(/[\r\n]+/gu, ' ').trim();
  const selection = selectedText.length <= 48 ? selectedText.trim() : '';
  const domain = /投资|收益|基准|量化|交易/u.test(context) ? '投资 收益' : /软件|程序|发布/u.test(context) ? '软件' : '';
  return [...new Set([selection, domain, cleaned].filter(Boolean))].join(' ').replace(/\s+/gu, ' ').trim().slice(0, 160);
}

export function relevantWebEvidence(query: string, source: { title: string; snippet: string }, context = '') {
  if (source.snippet.trim().length < 8) return false;
  const text = `${source.title} ${source.snippet}`.toLowerCase();
  const terms = query.split(/\s+/u).flatMap(part => tokenForIndex(part).split(/\s+/u)).filter((token) => token.length > 1 && !/^(?:联网|核验|最新|search|web|verify)$/iu.test(token));
  const specific = terms.filter(term => !/^(?:投资|收益|解释|解读|分析|相关|这个|是否|能否|判断|可以|需要|资料|信息|什么|为何|如何)$/u.test(term));
  const concepts = specific.length ? specific : terms;
  const named = concepts.filter(term => /^[a-z][a-z\d_-]*$/iu.test(term));
  const explicitChineseName = (query.match(/\p{Script=Han}{4,}/gu) ?? []).some(phrase => text.includes(phrase));
  if (named.length ? !named.some(term => text.includes(term.toLowerCase())) && !explicitChineseName : concepts.length && !concepts.some(term => text.includes(term.toLowerCase()))) return false;
  const ambiguousNamed = named.length > 0 && !concepts.some(term => /\p{Script=Han}/u.test(term));
  if (ambiguousNamed && /投资|收益|基准|量化|交易/u.test(context) && !/投资|收益|基准|量化|交易|金融|基金|风险(?:调整|模型|暴露)|\b(?:benchmark|invest(?:ment|ing|or|ors)?|portfolio|financ\w*|trading|fund|asset|beta|capm)\b|\b(?:excess|abnormal|risk[- ]adjusted|investment|portfolio|asset|fund|market)\s+returns?\b/iu.test(text)) return false;
  return true;
}

export function webTopicMatch(topic: string, source: { title: string; snippet: string }) {
  if (!topic) return true;
  const text = `${source.title} ${source.snippet}`.toLowerCase();
  if (text.includes(topic.toLowerCase())) return true;
  const terms = [...new Set(tokenForIndex(topic).split(/\s+/u).filter(term => term.length > 1))];
  return terms.length > 1 && terms.filter(term => text.includes(term.toLowerCase())).length / terms.length >= 0.7;
}

export function webEvidenceScore(query: string, source: { title: string; snippet: string }) {
  const terms = [...new Set(query.split(/\s+/u).flatMap(part => tokenForIndex(part).split(/\s+/u)).filter(term => term.length > 1))];
  const title = source.title.toLowerCase();
  const snippet = source.snippet.toLowerCase();
  return terms.reduce((score, term) => score + (title.includes(term.toLowerCase()) ? 2 : 0) + (snippet.includes(term.toLowerCase()) ? 1 : 0), 0);
}

export function needsArtifact(question: string) {
  return /(?:创建|生成|保存|修改|重写|删除|追加|整理成).{0,12}(?:笔记|文档|脑图|思维导图)|脑图|思维导图/u.test(question);
}

export function contextualSense(context: string, term: string) {
  const text = normalizeText(context.replaceAll(term, ''));
  const domains = [
    ['software', /软件|版本|测试|发布|程序|编程/u],
    ['finance-risk', /风险模型|风险因子|因子收益|风险暴露/u],
    ['finance', /投资|超额收益|收益率|基准|交易|对冲|市场敏感/u],
    ['science', /物理|粒子|辐射|实验|化学/u],
  ] as const;
  return domains.find(([, pattern]) => pattern.test(text))?.[0] ?? `context:${createNormalizedHash(text.slice(0, 300))}`;
}

export function makeSource(input: Omit<SourceReference, 'id'> & { id?: string }): SourceReference {
  return { ...input, id: input.id ?? `s-${createNormalizedHash(input.url ? canonicalSourceUrl(input.url) : `${input.documentId}:${input.page}:${input.anchor ?? ''}`).slice(0, 16)}` };
}

function canonicalSourceUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/iu.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch { return value; }
}

export function evidenceContext(sources: SourceReference[], registry = sources) {
  return sources.map((source) => ({ id: source.id, number: registry.findIndex((item) => item.id === source.id) + 1, type: source.source,
    title: source.title, page: source.locationStatus === 'unverified' || source.locationStatus === 'ambiguous' ? undefined : source.page,
    endPage: source.endPage, locationStatus: source.locationStatus, url: source.url, evidenceType: source.evidenceType,
    excerpt: source.excerpt, fetchedAt: source.fetchedAt, claimIds: source.claimIds, conflictGroup: source.conflictGroup,
    duplicateGroup: source.duplicateGroup, coverage: source.anchor?.startsWith('selection:') ? 'selected_text_only' : 'excerpt_only',
    anchor: source.anchor }));
}

export function resolveReferenceAliases(markdown: string, sources: SourceReference[]) {
  return markdown.replace(/\[\[ref:([^|\]]+)(?:\|([^\]]+))?\]\]/gu, (marker, id: string) => {
    const source = sources.find((item, index) => item.id === id || String(index + 1) === id || `r${index + 1}` === id
      || item.id.startsWith('s-') && item.id.slice(2) === id);
    return source ? `[[ref:${source.id}|${sources.indexOf(source) + 1}]]` : marker;
  });
}

export function retrievalFingerprint(name: string, argumentsValue: unknown) {
  const normalize = (value: unknown): unknown => {
    if (typeof value === 'string') return normalizeText(value).replace(/\s+/gu, ' ').trim().toLowerCase();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  return createNormalizedHash(JSON.stringify([name, normalize(argumentsValue)]));
}

export function evidenceLedger(question: string, sources: SourceReference[]) {
  const questions = question.split(/[？?；;\n]/u).map((value) => value.trim()).filter(Boolean).slice(0, 8);
  const claims = (questions.length ? questions : ['解释当前选区']).map((text, index) => ({ id: `c${index + 1}`, text }));
  const tokens = (text: string) => new Set(tokenForIndex(text).split(/\s+/u).filter((token) => token.length > 1));
  const coverage = (text: string, other: string) => {
    const target = tokens(text); const reference = tokens(other);
    return target.size ? [...target].filter((token) => reference.has(token)).length / target.size : 0;
  };
  const entries = sources.map((source) => ({ ...source, contentHash: createNormalizedHash(source.excerpt ?? ''),
    claimIds: claims.filter((claim) => coverage(claim.text, `${source.title} ${source.excerpt ?? ''}`) > 0).map((claim) => claim.id) }));
  for (const [index, source] of entries.entries()) {
    const text = source.excerpt ?? '';
    for (const previous of entries.slice(0, index)) {
      const earlier = previous.excerpt ?? '';
      if (text.trim().length >= 8 && normalizeText(text).replace(/\s+/gu, '') === normalizeText(earlier).replace(/\s+/gu, '')) {
        const group = previous.duplicateGroup ?? previous.id;
        previous.duplicateGroup = group; source.duplicateGroup = group;
      }
      if (text.length < 30 || earlier.length < 30) continue;
      const similarity = Math.min(coverage(text, earlier), coverage(earlier, text));
      if (similarity >= 0.9) {
        const group = previous.duplicateGroup ?? previous.id;
        previous.duplicateGroup = group; source.duplicateGroup = group;
      }
      const numbers = (value: string) => [...value.matchAll(/\d+(?:\.\d+)?%?/gu)].map((match) => match[0]).sort().join(',');
      if (similarity >= 0.4 && numbers(text) && numbers(earlier) && numbers(text) !== numbers(earlier)) {
        const group = previous.conflictGroup ?? `possible-${previous.id}`;
        previous.conflictGroup = group; source.conflictGroup = group;
      }
    }
  }
  return { claims, sources: entries, gaps: claims.filter((claim) => !entries.some((source) => source.claimIds.includes(claim.id))).map((claim) => claim.id) };
}

export function deduplicateEvidence(sources: SourceReference[]): SourceReference[] {
  const identities = new Set<string>();
  return sources.filter((source) => {
    const identity = source.url ? canonicalSourceUrl(source.url) : `${source.documentId}:${source.page}:${source.anchor ?? ''}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

export function validateAnswer(markdown: string, action: AiActionType, sources: SourceReference[]) {
  const issues: string[] = [];
  const first = markdown.trimStart().split('\n')[0] ?? '';
  if (/^(?:#{1,6}\s|>\s|你好|当然|根据上下文|根据网络资料|下面为你)/u.test(first)) issues.push('indirect_opening');
  if (/^\s*(?:```json\s*)?\{\s*"(?:tool_calls|finish|answer)"/u.test(markdown)) issues.push('protocol_in_answer');
  if (action === 'vocabulary_explanation' && !/^(?:\*\*)?[^：:\n]{1,100}(?:\*\*)?[：:]/u.test(first)
    && !/不足|无法|缺少|未提供|不明确/u.test(first)) issues.push('vocabulary_opening');
  for (const match of markdown.matchAll(/\[\[ref:([^|\]]+)(?:\|([^\]]+))?\]\]/gu)) {
    if (!sources.some((source) => source.id === match[1])) issues.push('unknown_reference');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function boundedObservation(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[nested data omitted]';
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value)) return value.slice(0, 6).map((item) => boundedObservation(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, item]) => [key, boundedObservation(item, depth + 1)]));
  return value;
}
