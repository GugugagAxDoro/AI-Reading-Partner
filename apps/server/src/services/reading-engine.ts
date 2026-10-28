import { z } from 'zod';
import { estimateMessageTokens, ModelClient, ModelRequestError, RunBudget, type ChatMessage, type ProviderConfig, type ModelTier, type ToolCall, type ToolDefinition } from '@ai-reading-partner/ai';
import { type SourceReference, chunkReferencePosition } from '@ai-reading-partner/core/references';
import { DocumentRepository, PageRepository, type Database } from '@ai-reading-partner/db';
import { McpSearchService } from './mcp-search';
import { RetrievalService } from './retrieval';
import { boundedObservation, deduplicateEvidence, evidenceContext, evidenceLedger, makeSource, readingRequestSchema, relevantWebEvidence, requiresExternal, resolveReferenceAliases, retrievalFingerprint, searchQuery, validateAnswer, webEvidenceScore, webTopicMatch, type ReadingRequest } from './evidence';
import { answerContract, answerOutputTokens, EVIDENCE_POLICY } from './prompts';
import { PageReadError } from './web-fetch';
import type { SearxngResult } from './searxng';

const parameters = z.object({ query: z.string().trim().min(1).max(160) });
const retrievalTools: ToolDefinition[] = [
  { type: 'function', function: { name: 'read_document_page', description: '读取本书明确提及的 PDF 页码，例如选区沿用第三页定义时读取第3页，不用不相关检索结果猜测。', parameters: { type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, required: ['page'] } } },
  { type: 'function', function: { name: 'search_current_document', description: '查找本书尚缺少的原文或定义。仅在提供证据不足时使用。', parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 160 } }, required: ['query'] } } },
  { type: 'function', function: { name: 'search_project', description: '本书缺少所需解释时，检索同项目相关书籍。', parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 160 } }, required: ['query'] } } },
  { type: 'function', function: { name: 'search_web', description: '只在外部概念、事实、时效核验或用户要求联网时搜索。query 使用准确名称与必要领域，不抄原文段落；结果不相关时改用中文名称或专业同义词。默认返回3条；前列候选不可读或不足时可将limit增至6，不重复相同query和limit。', parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 160 }, limit: { type: 'integer', minimum: 1, maximum: 6 } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_web_page', description: '摘要不足以支持结论时读取已发现来源正文。失败时可在同一查询内有界查找替代来源；以返回的实际来源为准。正文可读不等于事实已被证实，须检查支持段落、口径及来源质量。', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
];

export class ReadingEngine {
  private readonly retrieval: RetrievalService;
  private readonly documents: DocumentRepository;
  private readonly pages: PageRepository;
  constructor(db: Database, root: string, private readonly config: ProviderConfig, private readonly search: McpSearchService) {
    this.retrieval = new RetrievalService(db);
    this.documents = new DocumentRepository(db, root);
    this.pages = new PageRepository(db);
  }

  async answer(input: {
    request: ReadingRequest; messages: ChatMessage[]; sources: SourceReference[]; budget: RunBudget; tier: ModelTier; inputLimit: number;
    onDelta: (delta: string) => void; onReset?: () => void; onState: (state: Record<string, unknown>) => void;
  }) {
    const request = readingRequestSchema.parse(input.request);
    const { budget } = input;
    const outputTokens = answerOutputTokens(request.question);
    if (request.documentId && !this.documents.getFromProject(request.projectId, request.documentId)) throw new Error('Document outside request project');
    const client = new ModelClient(this.config.current, budget);
    let sources = deduplicateEvidence(input.sources.filter((source) => source.source === 'web'
      || Boolean(source.documentId && this.documents.getFromProject(request.projectId, source.documentId))));
    const steps: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const discovered = new Set(sources.flatMap((source) => source.url ? [source.url] : []));
    const candidates = new Map<string, { query: string; result: SearxngResult }>();
    const queryLimits = new Map<string, number>();
    const localContext = input.sources.map((source) => `${source.title} ${source.excerpt ?? ''}`).join('\n');
    const topic = request.question.match(/["“]([^"”\n]{2,48})["”]/u)?.[1] ?? '';
    const needsBody = /正文|原始(?:资料|来源)|原文核验/u.test(request.question);
    let webWarning: string | null = null;
    let externalAttempted = false;
    const unreadPages = new Set<string>();
    const rejectedPages = new Set<string>();
    const requiredBodyChecks = new Set<string>();
    const verifiedBodyChecks = new Set<string>();
    let localAttempted = input.sources.some((source) => source.documentId === request.documentId);
    let noProgress = 0;
    let text = '';
    let protocolFallback = false;
    let budgetLimited = false;
    const metadata = () => {
      const ledger = evidenceLedger(request.question || request.selection?.text || '', sources);
      sources = ledger.sources;
      input.onState({ sources, evidence: { claims: ledger.claims, gaps: ledger.gaps }, steps,
        webSearch: { attempted: externalAttempted, warning: webWarning, unreadPages: [...unreadPages],
          bodyReadQueries: [...verifiedBodyChecks], pendingBodyQueries: [...requiredBodyChecks].filter(query => !verifiedBodyChecks.has(query)) }, budgetLimited, usage: budget.snapshot() });
    };
    const add = (items: SourceReference[]) => {
      const old = sources.length;
      sources = deduplicateEvidence([...sources, ...items]);
      noProgress = sources.length > old ? 0 : noProgress + 1;
    };
    const execute = async (name: string, raw: unknown, allowFallback = true): Promise<unknown> => {
      budget.signal.throwIfAborted();
      const normalizedArguments = name === 'search_web' && raw && typeof raw === 'object' ? { ...raw,
        limit: 'limit' in raw ? raw.limit : 3 } : raw;
      const fingerprint = retrievalFingerprint(name, normalizedArguments);
      if (seen.has(fingerprint)) { noProgress++; return { error: 'duplicate_query', instruction: '已有相同查询，不再重复；使用现有证据回答或指出缺口。' }; }
      seen.add(fingerprint);
      let result: unknown;
      try {
        budget.tool();
        if (name === 'read_document_page') {
          const { page } = z.object({ page: z.number().int().positive() }).parse(raw);
          const record = request.documentId ? this.pages.list(request.documentId).find(item => item.page_number === page) : undefined;
          if (!record) result = { error: 'page_not_found' };
          else {
            add([makeSource({source:'document',documentId:request.documentId!,title:this.documents.get(request.documentId!)!.title,page,
              anchor:`page:${page}`,excerpt:record.text.slice(0,3000),locationStatus:'verified',evidenceType:'passage'})]);
            result = {page,text:record.text.slice(0,3000)};
          }
        } else if (name === 'read_web_page') {
          if (request.webPolicy === 'off' || webWarning) return { error: 'web_disabled_or_unavailable' };
          const { url } = z.object({ url: z.string().url().max(2000) }).parse(raw);
          if (!discovered.has(url)) return { error: 'Only a discovered source may be read' };
          const query = candidates.get(url)?.query ?? url;
          const check = request.question.includes(url) ? url : query;
          requiredBodyChecks.add(check);
          const page = await this.search.fetchPage(request.projectId, url, AbortSignal.any([budget.signal, AbortSignal.timeout(10000)]));
          const challenge = /验证码|安全验证|access denied|just a moment|verify (?:you are|your identity)|captcha/iu.test(page.title ?? '');
          const body = { title: '', snippet: page.content };
          if (challenge || page.content.trim().length < 50 || !webTopicMatch(topic, body) || candidates.has(url) && !relevantWebEvidence(query, body, localContext)) {
            rejectedPages.add(url);
            sources = sources.filter(source => source.url !== url);
            throw new PageReadError('unusable_content');
          }
          unreadPages.delete(url);
          verifiedBodyChecks.add(check);
          const existing = sources.find((source) => source.url === url);
          sources = sources.filter((source) => source.url !== url);
          add([makeSource({ ...existing, source: 'web', title: page.title ?? url, url, excerpt: page.content.slice(0, 3000), fetchedAt: page.fetchedAt, evidenceType: 'page' })]);
          noProgress = 0;
          result = { status: 'ready', source: sources.find((source) => source.url === url), query,
            instruction: '这是实际读取的正文节选，不代表其中论断已被证实。核对相邻论断的支持段落；比较本书与网页的定义、假设和方法，不把外部补充归为作者观点。' };
        } else {
          const { query } = parameters.parse(raw);
          if (name === 'search_web') {
            if (request.webPolicy === 'off' || webWarning) return { error: 'web_disabled_or_unavailable' };
            if (request.selection && request.selection.text.length > 80 && query.includes(request.selection.text.slice(0, 60))) return { error: 'Use concept keywords, not the source passage' };
            if (!externalAttempted && needsBody) requiredBodyChecks.add(query);
            externalAttempted = true;
            const { limit } = z.object({ limit: z.number().int().min(1).max(6).default(3) }).parse(raw);
            const searched = await this.search.searchWithFallback(request.projectId, query, { limit, signal: budget.signal, fresh: requiresExternal(request.question) });
            webWarning = searched.warning;
            queryLimits.set(query, Math.max(limit, queryLimits.get(query) ?? 0));
            for (const item of searched.results) { discovered.add(item.url); if (!candidates.has(item.url)) candidates.set(item.url, { query, result: item }); }
            const relevant = searched.results.filter((item) => !rejectedPages.has(item.url) && webTopicMatch(topic, item) && relevantWebEvidence(query, item, localContext));
            add(relevant.map((item) => makeSource({ source: 'web', url: item.url, title: item.title, excerpt: item.snippet, fetchedAt: item.fetchedAt ?? new Date().toISOString(), evidenceType: 'snippet' })));
            result = { results: searched.results.map((item) => ({ ...item, relevant: relevant.includes(item) })), warning: webWarning,
              instruction: relevant.length ? '只使用相关证据，必要时读取候选正文。' : '摘要不足或不相关，不支持外部结论；可定向读取候选网页，仍无证据则保留缺口。' };
          } else if (name === 'search_current_document' || name === 'search_project') {
            if (name === 'search_project' && request.documentId && !localAttempted) return { error: 'Search the current book first' };
            const chunks = name === 'search_current_document'
              ? request.documentId ? this.retrieval.searchCurrent(request.documentId, query, { limit: 3 }) : []
              : this.retrieval.searchProject(request.projectId, query, { limit: 3, currentDocumentId: request.documentId }).other;
            if (name === 'search_current_document') localAttempted = true;
            add(chunks.map((chunk) => makeSource({ source: 'document', title: this.documents.get(chunk.document_id)?.title ?? '原文', documentId: chunk.document_id,
              ...chunkReferencePosition(chunk), anchor: chunk.id, excerpt: chunk.text.slice(0, 2500), evidenceType: 'passage' })));
            result = { results: chunks.map((chunk) => ({ page: chunk.page_number, documentId: chunk.document_id, text: chunk.text.slice(0, 1500) })) };
          } else result = { error: 'Unknown tool' };
        }
      } catch (error) {
        budget.signal.throwIfAborted();
        noProgress++;
        result = { error: error instanceof z.ZodError ? 'invalid_arguments' : 'retrieval_unavailable',
          ...(error instanceof PageReadError ? { reason: error.code, status: error.status } : {}),
          ...(name === 'read_web_page' ? { instruction: '正文未读，不能当作全文核验；可读取其他已发现的相关来源，或将原查询的limit增至6寻找后续候选，仍不足则保留具体缺口。不要绕过访问限制。' } : {}) };
        if (name === 'search_web') webWarning = '联网核验暂不可用。';
        if (name === 'read_web_page' && raw && typeof raw === 'object' && 'url' in raw && typeof raw.url === 'string' && discovered.has(raw.url)) unreadPages.add(raw.url);
      }
      steps.push({ id: `retrieval-${steps.length + 1}`, title: ({ search_web: '检索外部证据', read_web_page: '读取来源正文', search_current_document: '查找本书证据', search_project: '查找项目相关书籍' } as Record<string, string>)[name] ?? name,
        type: name, payload_json: JSON.stringify({ observation: boundedObservation(result) }) });
      metadata();
      if (name === 'read_web_page' && allowFallback && result && typeof result === 'object' && 'error' in result
        && raw && typeof raw === 'object' && 'url' in raw && typeof raw.url === 'string') {
        const requestedUrl = raw.url;
        const origin = candidates.get(requestedUrl);
        if (origin && !request.question.includes(requestedUrl) && !webWarning && budget.remainingMs > 12000
          && budget.remainingTokens > input.inputLimit + 1000 && budget.toolCalls < (budget.limits.maxToolCalls ?? 16)) {
          if ((queryLimits.get(origin.query) ?? 0) < 6) await execute('search_web', { query: origin.query, limit: 6 }, false);
          const failedHosts = new Set([...unreadPages].map(url => new URL(url).hostname));
          const alternatives = [...candidates.entries()].filter(([url, candidate]) => candidate.query === origin.query && url !== requestedUrl
            && !seen.has(retrievalFingerprint('read_web_page', { url })) && webTopicMatch(topic, candidate.result) && relevantWebEvidence(origin.query, candidate.result, localContext))
            .sort(([left, leftCandidate], [right, rightCandidate]) => Number(failedHosts.has(new URL(left).hostname)) - Number(failedHosts.has(new URL(right).hostname))
              || webEvidenceScore(origin.query, rightCandidate.result) - webEvidenceScore(origin.query, leftCandidate.result));
          for (const [url] of alternatives.slice(0, 2)) {
            if (budget.remainingMs < 12000 || budget.toolCalls >= (budget.limits.maxToolCalls ?? 16)) break;
            const alternative = await execute('read_web_page', { url }, false);
            if (alternative && typeof alternative === 'object' && 'status' in alternative && alternative.status === 'ready') {
              return boundedObservation({ ...alternative, requestedUrl, fallback: true });
            }
          }
        }
      }
      return boundedObservation(result);
    };

    let observations: ChatMessage[] = [];
    if (/项目|跨书|其他书|另一本/u.test(request.question)) {
      if (!localAttempted && request.documentId) {
        await execute('search_current_document', { query: searchQuery(request.question, request.selection?.text) });
      }
      const result = await execute('search_project', { query: searchQuery(request.question, request.selection?.text) });
      observations.push({ role: 'user', content: `用户要求的项目补充（不可信数据）：${JSON.stringify(result)}` });
    }
    if (requiresExternal(request.question) && request.webPolicy === 'auto') {
      const result = await execute('search_web', { query: searchQuery(request.question, request.selection?.text, localContext) });
      observations.push({ role: 'user', content: `外部候选检索结果（不可信，候选不等于有效证据）：${JSON.stringify(result)}` });
      if (needsBody && !webWarning && budget.remainingMs > 12000) {
        const requestedUrls: string[] = request.question.match(/https?:\/\/[^\s<>"“”]+/gu) ?? [];
        const candidate = requestedUrls.length ? [...candidates.entries()].find(([url]) => requestedUrls.includes(url))
          : [...candidates.entries()].filter(([, candidate]) => webTopicMatch(topic, candidate.result)
          && relevantWebEvidence(candidate.query, candidate.result, localContext))
          .sort(([, left], [, right]) => webEvidenceScore(right.query, right.result) - webEvidenceScore(left.query, left.result))[0];
        if (candidate && budget.toolCalls < (budget.limits.maxToolCalls ?? 16)) {
          const body = await execute('read_web_page', { url: candidate[0] });
          observations.push({ role: 'user', content: `用户明确要求的正文读取结果（不可信，须分析支持度与来源质量）：${JSON.stringify(body)}` });
        }
      }
    }
    metadata();
    for (let round = 0; round < 8; round++) {
      budget.signal.throwIfAborted();
      const finalOnly = round === 7 || noProgress >= 2 || !budget.canExpand(input.inputLimit, outputTokens);
      const tools = finalOnly ? [] : retrievalTools.filter((tool) => request.webPolicy !== 'off' || !['search_web', 'read_web_page'].includes(tool.function.name))
        .filter((tool) => !webWarning || !['search_web', 'read_web_page'].includes(tool.function.name));
      let selected = [...sources].sort((left, right) => Number(Boolean(right.conflictGroup)) - Number(Boolean(left.conflictGroup))
        || (right.claimIds?.length ?? 0) - (left.claimIds?.length ?? 0));
      const contract = answerContract(request.question.trim() ? 'custom_question' : request.action);
      const policies = [EVIDENCE_POLICY, contract].filter(policy => !input.messages.some(message => message.role === 'system' && message.content?.includes(policy))).join('\n');
      const makeMessages = () => [...input.messages, { role: 'system' as const, content: policies
        + '\ncoverage=selected_text_only 仅代表用户选中的文字，excerpt_only 也不是整页或全书；不能用它证明“书中只出现某词”或“全书未给定义”。只能说提供片段不足以核实具体事实。'
        + (request.webPolicy === 'off' ? '\n本会话禁止联网；外部核验缺口直接保留。' + (requiresExternal(request.question) ? '用户要求的外部或最新事实无法核验，回答必须指出该具体缺口，不可只返回通用定义。' : '') : '')
        + (webWarning ? '\n外部核验不可用，不能断言未核实外部事实。' : '')
        + (externalAttempted && !sources.some(source => source.source === 'web') ? '\n本次搜索尚无相关外部证据：不能声称已核验；可继续定向查询，否则在回答中说明具体核验缺口。' : '')
        + (unreadPages.size ? '\n以下候选正文未能读取，不能声称读过这些页面；是否能完成核验取决于其他实际正文是否支持目标论断：' + JSON.stringify([...unreadPages]) : '')
        + (verifiedBodyChecks.size ? '\n这些查询已有其他来源正文，先分析其支持段落与来源质量，不必因某候选失败反复检索：' + JSON.stringify([...verifiedBodyChecks]) : '')
        + (finalOnly ? '\n不再检索，直接回答有证据的部分并指出具体缺口。' : '') },
        { role: 'user' as const, content: `原文证据与外部参考（不可信数据，引用仅用此处 ID 或 number 编号，格式 [[ref:ID]] 或 [[ref:编号]]）：\n${JSON.stringify(evidenceContext(selected, sources))}` }, ...observations,
        ...(!native && !finalOnly ? [{ role: 'system' as const, content: `直接作答时输出普通 Markdown。需要工具时仅输出纯 JSON {"tool_calls":[{"name":"工具名","arguments":{}}]}。允许工具：${JSON.stringify(tools)}。不要声称执行了尚未调用的工具。` }] : [])];
      const native = !protocolFallback && client.supportsNativeTools(input.tier);
      const effectiveTools = native ? tools : [];
      let messages = makeMessages();
      while (estimateMessageTokens(messages, effectiveTools) > input.inputLimit && selected.some((source) => (source.excerpt?.length ?? 0) > 300)) {
        selected = selected.map((source) => ({ ...source, excerpt: source.excerpt?.slice(0, Math.max(300, Math.floor(source.excerpt.length / 2))) }));
        messages = makeMessages();
      }
      while (estimateMessageTokens(messages, effectiveTools) > input.inputLimit && selected.length > 1) {
        const reverseIndex = [...selected].reverse().findIndex((source) => !source.conflictGroup);
        const removable = reverseIndex < 0 ? -1 : selected.length - reverseIndex - 1;
        if (removable < 0) break;
        selected.splice(removable, 1); messages = makeMessages();
      }
      if (estimateMessageTokens(messages, effectiveTools) > input.inputLimit && observations.length) { observations = []; messages = makeMessages(); }
      if (estimateMessageTokens(messages, effectiveTools) > input.inputLimit) {
        selected = selected.map((source) => ({ ...source, excerpt: source.excerpt?.slice(0, 300) })); messages = makeMessages();
      }
      if (estimateMessageTokens(messages, effectiveTools) > input.inputLimit) throw new Error('上下文预算不足，请缩小问题或选区');
      let calls: ToolCall[] = [];
      let output = '';
      {
        let buffered = '';
        let jsonOutput: boolean | undefined;
        const availableOutput = Math.min(outputTokens, budget.remainingTokens - estimateMessageTokens(messages, effectiveTools));
        if (availableOutput < 1) throw new Error('上下文预算不足，请缩小问题或选区');
        budgetLimited ||= availableOutput < outputTokens;
        const modelRequest = { tier: input.tier, messages, maxTokens: availableOutput, retries: 0,
          tools: effectiveTools, toolChoice: 'auto' as const, signal: budget.signal,
          onToolCalls: (value: ToolCall[]) => { calls = value; } };
        try {
          for await (const delta of client.streamText(modelRequest)) {
            output += delta;
            if (native) { input.onDelta(delta); continue; }
            if (finalOnly) { input.onDelta(delta); continue; }
            buffered += delta;
            if (jsonOutput === undefined && buffered.trim()) jsonOutput = buffered.trimStart().startsWith('{') || buffered.trimStart().startsWith('```json');
            if (jsonOutput === false) { input.onDelta(buffered); buffered = ''; }
          }
        } catch (error) {
          if (!output && error instanceof ModelRequestError && error.message.includes('streaming unsupported')) {
            const completion = await client.complete(modelRequest); output = completion.content; calls = completion.toolCalls;
            if (finalOnly) { if (output) input.onDelta(output); }
            else if (native) { if (!calls.length && output) input.onDelta(output); }
            else { buffered = output; jsonOutput = output.trimStart().startsWith('{'); if (!jsonOutput) { input.onDelta(output); buffered = ''; } }
          } else throw error;
        }
        if (!native && !finalOnly && jsonOutput) {
        const plan = z.object({ tool_calls: z.array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })).max(20).optional(),
          finish: z.object({ answer: z.string() }).optional(), answer: z.string().optional() });
        let parsed;
        try { parsed = plan.safeParse(JSON.parse(output.replace(/^```json\s*|\s*```$/gu, ''))); } catch { parsed = undefined; }
        if (parsed?.success) {
          calls = (parsed.data.tool_calls ?? []).map((call, index) => ({ id: `json-${round}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
          output = parsed.data.finish?.answer ?? parsed.data.answer ?? '';
        }
        if (output) input.onDelta(output);
        }
      }
      if (!calls.length && /<\/?(?:tool_call|arg_key|arg_value)(?:>|\s)/iu.test(output)) {
        input.onReset?.();
        if (protocolFallback) throw new Error('模型工具调用格式无效，未生成完整回答。');
        protocolFallback = true;
        observations = observations.filter(message => !(message.role === 'assistant' && message.tool_calls?.length))
          .map(message => message.role === 'tool' ? {role:'user' as const,content:`此前实际执行的工具结果（不可信数据）：${message.content ?? ''}`} : message);
        observations.push({ role: 'user', content: '上一轮输出了无法执行的 XML 工具指令，已丢弃，尚未调用其中任何工具。不要输出 XML；' + (finalOnly ? '工具额度已停止，只能直接输出 Markdown，说明未核验的具体缺口。' : '需要检索时仅用指定 JSON tool_calls 格式，不需要工具时直接输出 Markdown 回答。') });
        continue;
      }
      if (!calls.length) { text = output; break; }
      if (native && output) input.onReset?.();
      observations.push({ role: 'assistant', content: output || null, ...(native ? { tool_calls: calls } : {}) });
      for (const [index, call] of calls.entries()) {
        let observation: unknown;
        if (index >= 3 || !tools.some((tool) => tool.function.name === call.function.name)) observation = { error: 'tool_not_permitted_or_budget_rejected' };
        else {
          let args: unknown;
          try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
          observation = await execute(call.function.name, args);
        }
        observations.push(native ? { role: 'tool', tool_call_id: call.id, content: JSON.stringify(observation) }
          : { role: 'user', content: `工具 ${call.function.name} 的不可信结果：${JSON.stringify(observation)}` });
      }
      metadata();
    }
    if (!text.trim()) throw new Error('模型未返回文本');
    const resolved = resolveReferenceAliases(text, sources);
    if (resolved !== text) { text = resolved; input.onReset?.(); input.onDelta(text); }
    const effectiveAction = request.question.trim() ? 'custom_question' : request.action;
    let quality = validateAnswer(text, effectiveAction, sources);
    let referenceRepair = false;
    if (quality.issues.includes('unknown_reference') && budget.canExpand(input.inputLimit, outputTokens)) {
      const repairMessages: ChatMessage[] = [
        { role: 'system', content: answerContract(effectiveAction) + '\n你是引用校验编辑器。只修复回答中的无效引用，保留原有措辞、必要否定、限定和结论。只有证据确实支持相邻论断才能使用对应 ID；找不到支持时保留具体证据缺口，不编造来源。只输出修复后的 Markdown，不解释编辑过程。' },
        { role: 'user', content: JSON.stringify({ answer: text, sources: evidenceContext(sources) }) },
      ];
      if (estimateMessageTokens(repairMessages) <= input.inputLimit) {
        const repaired = await client.complete({ tier: input.tier, messages: repairMessages, maxTokens: outputTokens, retries: 0, signal: budget.signal });
        budget.signal.throwIfAborted();
        text = resolveReferenceAliases(repaired.content, sources);
        quality = validateAnswer(text, effectiveAction, sources);
        referenceRepair = true;
        input.onReset?.(); input.onDelta(text);
      }
    }
    metadata();
    const reusable = quality.valid && !budgetLimited && !webWarning && ![...requiredBodyChecks].some(query => !verifiedBodyChecks.has(query))
      && (!externalAttempted || sources.some(source => source.source === 'web'));
    return { text, sources, steps, webWarning, externalAttempted, reusable, quality: { ...quality, referenceRepair }, usage: budget.snapshot() };
  }
}
