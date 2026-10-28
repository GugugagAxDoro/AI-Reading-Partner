import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createNormalizedHash, serializeReferences, type SourceReference } from '@ai-reading-partner/core';
import {
  AgentRepository,
  DocumentRepository,
  NoteRepository,
  ProjectRepository,
  SectionRepository,
  SummaryRepository,
} from '@ai-reading-partner/db';
import {
  ModelClient,
  ModelRequestError,
  ProviderConfigError,
  resolveRouting,
  type ChatMessage,
  type ProviderConfig,
  type ToolCall,
  type ToolDefinition,
  RunBudget,
  estimateMessageTokens,
} from '@ai-reading-partner/ai';
import type { Database } from '@ai-reading-partner/db';
import { CacheRepository } from '@ai-reading-partner/db';
import { RetrievalService } from './retrieval';
import { McpSearchService } from './mcp-search';
import { MindmapService } from './mindmap';
import { answerContract, basePrompt, EVIDENCE_POLICY, PROMPT_VERSION } from './prompts';
import { boundedObservation, requiresExternal, needsArtifact, evidenceContext, evidenceLedger, makeSource, relevantWebEvidence, resolveReferenceAliases, retrievalFingerprint, searchQuery, validateAnswer, readingRequestSchema, type ReadingRequest } from './evidence';

export interface AgentRunInput {
  task: string;
  title?: string;
  maxRounds?: number;
  budgetTokens?: number;
  timeoutMs?: number;
}

interface JsonToolPlan {
  tool_calls?: Array<{ name?: string; arguments?: unknown }>;
  finish?: { answer?: string };
  answer?: string;
}

interface EvidenceRecord extends SourceReference {
  text: string;
}

interface EvidenceJudgment {
  sufficient: boolean;
  relevance: 'high' | 'medium' | 'low';
  missing_concepts: string[];
  expand_retrieval: boolean;
  gap: string | null;
}

const AGENT_PROMPT_VERSION = PROMPT_VERSION;

const TOOL_SCHEMAS: Record<string, ToolDefinition> = {
  search_current_document: {
    type: 'function',
    function: {
      name: 'search_current_document',
      description: 'Search the current document for relevant chunks.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['query'],
      },
    },
  },
  search_project: {
    type: 'function',
    function: {
      name: 'search_project',
      description: 'Search other books in the current project.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['query'],
      },
    },
  },
  search_web: {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the configured SearXNG endpoint. Send only a concise generated query.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['query'],
      },
    },
  },
  finish: {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Return the final cited answer.',
      parameters: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
    },
  },
  create_note: {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Create a standalone Markdown note for durable research output.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          markdown: { type: 'string' },
        },
        required: ['title', 'markdown'],
      },
    },
  },
  read_note: {
    type: 'function',
    function: {
      name: 'read_note',
      description: 'Read a note by stable ID.',
      parameters: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id'],
      },
    },
  },
  append_note: {
    type: 'function',
    function: {
      name: 'append_note',
      description: 'Append a small automatic insight to an existing note.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['note_id', 'content'],
      },
    },
  },
  rewrite_note: {
    type: 'function',
    function: {
      name: 'rewrite_note',
      description: 'Propose a substantial note rewrite. The user must confirm before it is applied.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          markdown: { type: 'string' },
        },
        required: ['note_id', 'markdown'],
      },
    },
  },
  delete_note: {
    type: 'function',
    function: {
      name: 'delete_note',
      description: 'Propose deleting a note. The user must confirm before it is applied.',
      parameters: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id'],
      },
    },
  },
  fetch_web_page: {
    type: 'function',
    function: {
      name: 'fetch_web_page',
      description: 'Fetch a selected public web page from search results.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  read_document_chunks: {
    type: 'function',
    function: {
      name: 'read_document_chunks',
      description: 'Read up to three chunk IDs from the current document or project evidence.',
      parameters: {
        type: 'object',
        properties: {
          chunk_ids: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 3,
          },
        },
        required: ['chunk_ids'],
      },
    },
  },
  read_section: {
    type: 'function',
    function: {
      name: 'read_section',
      description: 'Read compact evidence for a document section.',
      parameters: {
        type: 'object',
        properties: { section_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 } },
        required: ['section_id'],
      },
    },
  },
  read_summary: {
    type: 'function',
    function: {
      name: 'read_summary',
      description: 'Read a book or section summary. Use scope book with the current document ID.',
      parameters: {
        type: 'object',
        properties: { scope: { type: 'string', enum: ['book', 'section'] }, target_id: { type: 'string' } },
        required: ['scope', 'target_id'],
      },
    },
  },
  list_sections: {
    type: 'function',
    function: {
      name: 'list_sections',
      description: 'List the current document outline.',
      parameters: { type: 'object', properties: {} },
    },
  },
  read_cache: {
    type: 'function',
    function: {
      name: 'read_cache',
      description: 'Read a cached term or passage explanation.',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['term', 'content'] }, id: { type: 'string' } },
        required: ['kind', 'id'],
      },
    },
  },
  save_cache: {
    type: 'function',
    function: {
      name: 'save_cache',
      description: 'Save a reusable term explanation to the project cache.',
      parameters: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          explanation: { type: 'string' },
          source_evidence_id: { type: 'string' },
        },
        required: ['term', 'explanation'],
      },
    },
  },
  generate_mindmap: {
    type: 'function',
    function: {
      name: 'generate_mindmap',
      description: 'Generate an offline Markmap HTML file for an existing note.',
      parameters: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id'],
      },
    },
  },
};

export class AgentService {
  private readonly executing = new Set<string>();
  private readonly runs: AgentRepository;
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly retrieval: RetrievalService;
  private readonly search: McpSearchService;
  private readonly notes: NoteRepository;
  private readonly termCache: CacheRepository;
  private readonly sectionRepository: SectionRepository;
  private readonly summaries: SummaryRepository;
  private readonly mindmaps: MindmapService;

  constructor(
    private readonly dataRoot: string,
    private readonly database: Database,
    private readonly providerConfig: ProviderConfig,
  ) {
    this.runs = new AgentRepository(database);
    this.documents = new DocumentRepository(database, dataRoot);
    this.projects = new ProjectRepository(database);
    this.retrieval = new RetrievalService(database);
    this.search = new McpSearchService(providerConfig, new CacheRepository(database));
    this.notes = new NoteRepository(database, dataRoot);
    this.termCache = new CacheRepository(database);
    this.sectionRepository = new SectionRepository(database);
    this.summaries = new SummaryRepository(database);
    this.mindmaps = new MindmapService(dataRoot, this.notes);
  }

  createRun(projectId: string, documentId: string | null, input: AgentRunInput) {
    if (!this.projects.get(projectId)) throw new Error('Project not found');
    if (documentId && !this.documents.getFromProject(projectId, documentId)) throw new Error('Document not found');
    return this.runs.createRun({
      projectId,
      documentId,
      title: input.title?.trim() || input.task.slice(0, 80),
      task: input.task,
      maxRounds: input.maxRounds ?? 8,
      budgetTokens: input.budgetTokens ?? 24_000,
      timeoutMs: input.timeoutMs ?? 180_000,
    });
  }

  getRun(projectId: string, runId: string) {
    const run = this.runs.getRun(runId);
    return run?.project_id === projectId ? run : undefined;
  }

  listRuns(projectId: string) {
    return this.runs.listRuns(projectId);
  }

  listSteps(projectId: string, runId: string) {
    return this.getRun(projectId, runId) ? this.runs.listSteps(runId) : undefined;
  }

  async execute(projectId: string, documentId: string | null, runId: string, options: { signal?: AbortSignal; webEnabled?: boolean; request?: ReadingRequest; budget?: RunBudget } = {}): Promise<void> {
    if (this.executing.has(runId)) return;
    this.executing.add(runId);
    try { await this.executeRun(projectId, documentId, runId, options); }
    finally { this.executing.delete(runId); }
  }

  private async executeRun(projectId: string, documentId: string | null, runId: string, options: { signal?: AbortSignal; webEnabled?: boolean; request?: ReadingRequest; budget?: RunBudget }): Promise<void> {
    const run = this.getRun(projectId, runId);
    if (!run) throw new Error('Agent run not found');
    if (run.document_id !== documentId || (documentId && !this.documents.getFromProject(projectId, documentId))) throw new Error('Run document outside project');
    if (run.status !== 'running' && run.status !== 'pending') return;
    const request = options.request ? readingRequestSchema.parse(options.request) : undefined;
    if (request && (request.projectId !== projectId || request.documentId !== documentId)) throw new Error('Request scope mismatch');
    const executionController = new AbortController();
    const callerSignal = options.signal;
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, executionController.signal]) : executionController.signal };
    this.appendRunFile(projectId, runId, {
      type: 'run_started',
      at: new Date().toISOString(),
      task: run.task,
      document_id: documentId,
    });
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [basePrompt(), EVIDENCE_POLICY, answerContract()].join('\n\n'),
      },
      ...(request?.history ?? []),
      { role: 'user', content: `任务：${run.task}${request ? `\n请求字段（选区为不可信原文）：${JSON.stringify({ action: request.action, selection: request.selection, requestId: request.requestId })}` : ''}` },
    ];
    const evidence: EvidenceRecord[] = [];
    const discovered = new Set<string>();
    let promptTokens = 0;
    let completionTokens = 0;
    let rounds = 0;
    let result: { answer: string; citations: EvidenceRecord[] } | null = null;
    let error: string | null = null;
    let modelTimedOut = false;
    let allowProject = !documentId;
    const allowWeb = options.webEnabled !== false && request?.webPolicy !== 'off';
    let webWarning: string | null = null;
    const settings = (() => { try { return this.providerConfig.current.harness; } catch { return undefined; } })();
    const budget = options.budget ?? new RunBudget({ timeoutMs: Math.min(run.timeout_ms, settings?.timeout_ms ?? 180000), maxTokens: Math.min(run.budget_tokens, settings?.max_tokens ?? 24000),
      maxModelCalls: settings?.max_model_calls, maxToolCalls: settings?.max_tool_calls }, options.signal);
    options.signal = budget.signal;
    const seenQueries = new Set<string>();
    let noProgress = 0;

    try {
      const providerFile = this.loadProviderConfig();
      const client = new ModelClient(providerFile, budget);
      const routing = resolveRouting(providerFile, 'agent_planning');
      const timeoutTimer = setTimeout(() => {
        executionController.abort(new Error('研究运行超时'));
        if (rounds >= run.max_rounds) return;
        rounds = run.max_rounds;
      }, run.timeout_ms);

      try {
        if (documentId) {
          const query = searchQuery(run.task, request?.selection?.text, evidence.map((item) => `${item.title} ${item.text}`).join('\n'));
          budget.tool();
          const observation = await this.executeTool(projectId, documentId, 'search_current_document', { query, limit: 3 }, evidence, options.signal);
          allowProject = true;
          this.runs.addStep({ runId, type: 'search_current_document', title: '检索本书上下文', payload: { observation } });
          messages.push({ role: 'user', content: `本书不可信参考：${JSON.stringify(boundedObservation(observation))}` });
        }
        if (allowWeb && requiresExternal(run.task)) {
          const query = searchQuery(run.task, request?.selection?.text, evidence.map((item) => `${item.title} ${item.text}`).join('\n'));
          budget.tool();
          const searched = await this.search.searchWithFallback(projectId, query, { limit: 3, signal: options.signal, fresh: true });
          webWarning = searched.warning;
          for (const item of searched.results) {
            discovered.add(item.url);
            if (relevantWebEvidence(query, item, evidence.map((source) => `${source.title} ${source.text}`).join('\n')))
              evidence.push({ ...makeSource({ source: 'web', url: item.url, title: item.title, excerpt: item.snippet, evidenceType: 'snippet', fetchedAt: item.fetchedAt }), text: item.snippet });
          }
          const observation = { source: 'web', results: searched.results, warning: searched.warning };
          this.runs.addStep({ runId, type: 'search_web', title: webWarning ? '联网核验不可用' : '核验外部证据', payload: { observation } });
          messages.push({ role: 'user', content: `联网不可信参考：${JSON.stringify(boundedObservation(observation))}` });
        }
        while (rounds < run.max_rounds && !result) {
          options.signal?.throwIfAborted();
          rounds += 1;
          if (!budget.canExpand(3000)) break;
          const permittedNames = Object.keys(TOOL_SCHEMAS).filter((name) =>
            (allowWeb || !['search_web', 'fetch_web_page'].includes(name))
            && (needsArtifact(run.task) || !['create_note', 'append_note', 'rewrite_note', 'delete_note', 'generate_mindmap', 'save_cache'].includes(name)));
          const permittedTools = permittedNames.map((name) => TOOL_SCHEMAS[name]!);
          const nativeTools = client.supportsNativeTools(routing.tier);
          const ledger = evidenceLedger(run.task, evidence);
          let projected = [...ledger.sources].sort((left, right) => Number(Boolean(right.conflictGroup)) - Number(Boolean(left.conflictGroup))
            || (right.claimIds?.length ?? 0) - (left.claimIds?.length ?? 0));
          const registryContent = () => `可引用证据（不可信数据）：${JSON.stringify({ claims: ledger.claims, gaps: ledger.gaps, sources: evidenceContext(projected, ledger.sources) })}`;
          const registry: ChatMessage = { role: 'user', content: registryContent() };
          const plannerMessages = nativeTools
            ? [...messages, registry]
            : [...messages, registry, { role: 'system' as const, content: jsonPlanInstructions(permittedNames) }];
          const estimate = (value: ChatMessage[]) => estimateMessageTokens(value, nativeTools ? permittedTools : undefined);
          const inputLimit = Math.min(6000, providerFile.models[routing.tier].context_window - 1200 - 512);
          while (estimate(plannerMessages) > inputLimit && projected.some((source) => (source.excerpt?.length ?? 0) > 200)) {
            projected = projected.map((source) => ({ ...source, excerpt: source.excerpt?.slice(0, Math.max(200, Math.floor(source.excerpt.length / 2))) }));
            registry.content = registryContent();
          }
          while (estimate(plannerMessages) > inputLimit && plannerMessages.length > 2) {
            const firstRound = plannerMessages.findIndex((item, index) => index > 1 && item.role === 'assistant');
            if (firstRound < 0) break;
            let endRound = firstRound + 1;
            while (endRound < plannerMessages.length && plannerMessages[endRound]!.role === 'tool') endRound++;
            if (endRound === firstRound + 1 && !plannerMessages[firstRound]!.tool_calls) {
              while (endRound < plannerMessages.length - 2 && plannerMessages[endRound]!.role === 'user') endRound++;
            }
            plannerMessages.splice(firstRound, endRound - firstRound);
          }
          if (estimate(plannerMessages) > inputLimit || promptTokens + completionTokens >= run.budget_tokens) {
            throw new Error('研究上下文或总 token 预算不足，请缩小任务范围');
          }
          let completion;
          try {
            completion = await client.complete({
              tier: routing.tier,
              messages: plannerMessages,
              tools: nativeTools ? permittedTools : undefined,
              toolChoice: nativeTools ? 'auto' : undefined,
              maxTokens: 700,
              timeoutMs: run.timeout_ms,
              signal: options.signal,
              retries: 0,
            });
          } catch (plannerError) {
            const shouldFallback = nativeTools
              && plannerError instanceof Error
              && /tool|function|invalid_response|HTTP 400|HTTP 422/u.test(plannerError.message);
            if (!shouldFallback) throw plannerError;
            this.appendRunFile(projectId, runId, {
              type: 'protocol_fallback',
              at: new Date().toISOString(),
              from: 'native_tools',
              to: 'json_plan',
              reason: normalizeAgentError(plannerError),
            });
            this.runs.addStep({
              runId,
              type: 'protocol_fallback',
              title: '原生工具调用失败，已切换 JSON 协议',
              payload: { reason: normalizeAgentError(plannerError) },
            });
            completion = await client.complete({
              tier: routing.tier,
              messages: [...plannerMessages, { role: 'system' as const, content: jsonPlanInstructions(permittedNames) }],
              maxTokens: 700,
              timeoutMs: run.timeout_ms,
              signal: options.signal,
              retries: 0,
            });
          }
          promptTokens += completion.usage.prompt_tokens;
          completionTokens += completion.usage.completion_tokens;

          const nativeCalls = completion.toolCalls.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: parseToolArguments(call.function.arguments),
          }));
          const jsonPlan = nativeCalls.length === 0 ? parseJsonPlan(completion.content) : null;
          const plannedCalls = nativeCalls.length > 0
            ? nativeCalls
            : (jsonPlan?.tool_calls ?? []).map((call, index) => ({
                id: `json-${rounds}-${index}`,
                name: call.name ?? '',
                arguments: (call.arguments ?? {}) as Record<string, unknown>,
              }));

          messages.push({
            role: 'assistant',
            content: completion.content || null,
            ...(nativeTools && nativeCalls.length > 0 ? { tool_calls: completion.toolCalls } : {}),
          });

          if (plannedCalls.length === 0) {
            const answer = jsonPlan?.finish?.answer ?? jsonPlan?.answer ?? completion.content.trim();
            if (answer) {
              result = { answer, citations: evidence };
              break;
            }
          }

          const finishCall = plannedCalls.find((call) => call.name === 'finish');
          if (finishCall) {
            const answer = typeof finishCall.arguments.answer === 'string'
              ? finishCall.arguments.answer
              : completion.content.trim();
            if (answer) {
              for (const call of plannedCalls) messages.push(nativeCalls.length ? { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: call === finishCall ? 'finished' : 'not_executed_after_finish' }) } : { role: 'user', content: '任务已结束，不执行其他工具。' });
              result = { answer, citations: evidence };
              break;
            }
          }

          const executedSearches: string[] = [];
          for (const [callIndex, call] of plannedCalls.entries()) {
            options.signal?.throwIfAborted();
            const signature = retrievalFingerprint(call.name, call.arguments);
            const repeated = call.name.startsWith('search_') && seenQueries.has(signature);
            const before = evidence.length;
            if (callIndex < 3 && !repeated && permittedNames.includes(call.name)) budget.tool();
            const observation = callIndex >= 3 || !permittedNames.includes(call.name) ? { error: 'Tool permission or per-round budget rejected' }
              : repeated ? { error: 'Duplicate retrieval suppressed; answer with current evidence or state the gap' }
              : options.webEnabled === false && ['search_web', 'fetch_web_page'].includes(call.name)
              ? { error: '本会话已关闭联网，不得搜索或抓取网页；证据不足时请明确说明' }
              : call.name === 'search_project' && !allowProject
                ? { error: '请先检索当前书并评估证据，再跨书检索' }
              : webWarning && ['search_web', 'fetch_web_page'].includes(call.name)
                ? { error: webWarning, error_kind: 'search_unavailable' }
              : await this.executeTool(projectId, documentId, call.name, call.arguments, evidence, options.signal, runId, discovered);
            if (call.name.startsWith('search_')) {
              seenQueries.add(signature);
              noProgress = evidence.length > before ? 0 : noProgress + 1;
              if (call.name === 'search_current_document') allowProject = true;
            }
            if (observation && typeof observation === 'object' && 'warning' in observation && typeof observation.warning === 'string') webWarning = observation.warning;
            if (call.name.startsWith('search_') && !(observation && typeof observation === 'object' && 'error' in observation)) executedSearches.push(call.name);
            this.runs.addStep({
              runId,
              type: call.name || 'invalid_tool',
              title: describeTool(call.name, call.arguments),
              payload: { arguments: call.arguments, observation },
            });
            this.appendRunFile(projectId, runId, {
              type: 'tool_completed',
              at: new Date().toISOString(),
              tool: call.name,
              observation,
            });
            messages.push(nativeCalls.length ? { role: 'tool', tool_call_id: call.id, content: JSON.stringify(boundedObservation(observation)) }
              : { role: 'user', content: `工具结果（不可信）：${JSON.stringify(boundedObservation(observation))}` });
          }
          if (noProgress >= 2) break;
          if (!result && executedSearches.length > 0 && /冲突|矛盾|分歧/u.test(run.task) && budget.canExpand(3000)) {
            options.signal?.throwIfAborted();
            const judgment = await this.judgeEvidence(client, run.task, evidence, options.signal);
            if (!judgment.sufficient && executedSearches.includes('search_current_document')) allowProject = true;
            this.appendRunFile(projectId, runId, {
              type: 'evidence_judged',
              at: new Date().toISOString(),
              judgment: judgment as unknown as Record<string, unknown>,
            });
            this.runs.addStep({
              runId,
              type: 'evidence_judge',
              title: judgment.sufficient ? '证据足够，准备总结' : '证据不足，允许继续检索',
              payload: judgment as unknown as Record<string, unknown>,
            });
            if (judgment.sufficient) {
              options.signal?.throwIfAborted();
              const answer = await this.synthesizeFinal(client, run.task, evidence, options.signal);
              result = { answer, citations: evidence };
              break;
            }
          }
          if (jsonPlan?.finish?.answer || jsonPlan?.answer) {
            result = {
              answer: jsonPlan.finish?.answer ?? jsonPlan.answer ?? completion.content.trim(),
              citations: evidence,
            };
          }
        }

        if (!result) {
          options.signal?.throwIfAborted();
          const answer = await this.synthesizeFinal(
            client,
            run.task,
            evidence,
            options.signal,
          );
          result = { answer, citations: evidence };
        }
      } finally {
        clearTimeout(timeoutTimer);
      }
    } catch (caught) {
      modelTimedOut = caught instanceof ModelRequestError && caught.code === 'timeout';
      error = normalizeAgentError(caught);
    }

    const timedOut = (budget.signal.aborted || modelTimedOut || budget.remainingMs <= 0) && !callerSignal?.aborted;
    if (result) result.answer = resolveReferenceAliases(result.answer, result.citations);
    const usage = budget.snapshot();
    promptTokens = usage.prompt_tokens;
    completionTokens = usage.completion_tokens;
    if (!options.budget) budget.close();
    const finalStatus = callerSignal?.aborted ? 'cancelled' : timedOut ? 'timeout' : result ? 'ready' : error ? 'failed' : 'timeout';
    this.runs.updateRun(runId, {
      status: finalStatus,
      rounds,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      result_json: result ? JSON.stringify({
        answer: result.answer,
        citations: result.citations,
        prompt_version: AGENT_PROMPT_VERSION,
        webWarning,
        usage,
        quality: validateAnswer(result.answer, request?.question.trim() ? 'custom_question' : request?.action ?? 'custom_question', result.citations),
        evidence: evidenceLedger(run.task, result.citations),
        request,
      }) : null,
      error,
      finished_at: new Date().toISOString(),
    });
    this.appendRunFile(projectId, runId, {
      type: 'run_finished',
      at: new Date().toISOString(),
      status: finalStatus,
      result,
      error,
      rounds,
      tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    });
  }

  private async executeTool(
    projectId: string,
    documentId: string | null,
    name: string,
    args: Record<string, unknown>,
    evidence: EvidenceRecord[],
    signal?: AbortSignal,
    runId?: string,
    discovered?: Set<string>,
  ): Promise<unknown> {
    if (!Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, name)) {
      return { error: `Unknown tool: ${name}`, error_kind: 'invalid_tool' };
    }
    const validation = validateToolArguments(name, args);
    if (!validation.ok) {
      return { error: validation.error, error_kind: 'invalid_arguments' };
    }

    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const limit = Math.min(Math.max(Number(args.limit ?? 4) || 4, 1), 10);
    if (name === 'search_current_document') {
      if (!documentId) return { error: 'No current document', error_kind: 'missing_context' };
      const chunks = this.retrieval.searchCurrent(documentId, query, { limit });
      this.addDocumentEvidence(evidence, chunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.document_id,
        text: chunk.text,
        page: chunk.page_number,
      })));
      return { source: 'document', results: chunks.slice(0, limit) };
    }
    if (name === 'search_project') {
      const search = this.retrieval.searchProject(projectId, query, { limit, currentDocumentId: documentId });
      const results = (documentId ? search.other : [...search.current, ...search.other]).slice(0, limit);
      this.addDocumentEvidence(evidence, results.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.document_id,
        text: chunk.text,
        page: chunk.page_number,
      })));
      return { source: 'project', results };
    }
    if (name === 'search_web') {
      if (!this.search.isConfigured()) {
        return { error: 'SearXNG is not configured', error_kind: 'missing_configuration' };
      }
      const { results, warning } = await this.search.searchWithFallback(projectId, query, { limit, signal });
      results.forEach((result) => {
        discovered?.add(result.url);
        if (!relevantWebEvidence(query, result, evidence.map((item) => `${item.title} ${item.text}`).join('\n'))) return;
        if (evidence.some((item) => item.url === result.url)) return;
        evidence.push({
          ...makeSource({ source: 'web', url: result.url, title: result.title, excerpt: result.snippet, evidenceType: 'snippet', fetchedAt: result.fetchedAt }),
          text: result.snippet,
        });
      });
      return { source: 'web', results, ...(warning ? { warning } : {}) };
    }
    if (name === 'create_note') {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      if (!title || !markdown) return { error: 'title and markdown are required' };
      return this.noteOperation(runId, name, args, () => {
      signal?.throwIfAborted();
      const note = this.notes.create({
        projectId,
        title: title.slice(0, 200),
        markdown: serializeReferences(this.insertStableLinks(projectId, markdown), evidence),
        source: 'agent',
        createdBy: 'agent',
      });
      return { created: true, note_id: note.id, title: note.title, version: note.current_version };
      });
    }
    if (name === 'read_note') {
      const noteId = typeof args.note_id === 'string' ? args.note_id.trim() : '';
      const note = this.notes.get(noteId);
      if (!note || note.project_id !== projectId) return { error: 'Note not found' };
      return {
        note_id: note.id,
        title: note.title,
        markdown: note.markdown,
        status: note.status,
        version: note.current_version,
      };
    }
    if (name === 'append_note') {
      return this.noteOperation(runId, name, args, () => {
      signal?.throwIfAborted();
      const noteId = typeof args.note_id === 'string' ? args.note_id.trim() : '';
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      const note = this.notes.get(noteId);
      if (!note || note.project_id !== projectId) return { error: 'Note not found' };
      if (content.length > 600) return { error: 'Automatic appends must be 600 characters or fewer' };
      const updated = this.notes.update({
        noteId,
        markdown: `${note.markdown}\n\n${serializeReferences(this.insertStableLinks(projectId, content), evidence)}`,
        changeKind: 'append',
      });
      return { updated: true, note_id: noteId, version: updated?.current_version ?? note.current_version };
      });
    }
    if (name === 'rewrite_note') {
      const noteId = typeof args.note_id === 'string' ? args.note_id.trim() : '';
      const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      const note = this.notes.get(noteId);
      if (!note || note.project_id !== projectId) return { error: 'Note not found' };
      return {
        confirmation_required: true,
        action: 'rewrite_note',
        note_id: noteId,
        current_version: note.current_version,
        pending_markdown: this.insertStableLinks(projectId, markdown),
      };
    }
    if (name === 'delete_note') {
      const noteId = typeof args.note_id === 'string' ? args.note_id.trim() : '';
      const note = this.notes.get(noteId);
      if (!note || note.project_id !== projectId) return { error: 'Note not found' };
      return { confirmation_required: true, action: 'delete_note', note_id: noteId, title: note.title, current_version: note.current_version };
    }
    if (name === 'fetch_web_page') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) return { error: 'url is required' };
      if (!discovered?.has(url) && !evidence.some((item) => item.url === url)) return { error: 'Only a discovered source may be read', error_kind: 'unknown_source' };
      let page;
      try {
        page = await this.search.fetchPage(projectId, url, signal);
      } catch {
        signal?.throwIfAborted();
        return { error: '网页抓取失败，请使用已有搜索摘要和本地证据继续回答。', error_kind: 'fetch_unavailable' };
      }
      evidence.push({
        ...makeSource({ source: 'web', url: page.url, title: page.title ?? page.url, excerpt: page.content.slice(0, 3000), evidenceType: 'page', fetchedAt: page.fetchedAt }),
        text: page.content,
      });
      return {
        url: page.url,
        final_url: page.finalUrl,
        title: page.title,
        content: page.content.slice(0, 30_000),
        summary: null,
        cached: page.cached,
      };
    }
    if (name === 'read_document_chunks') {
      const requested = typeof args.chunk_ids === 'string'
        ? [args.chunk_ids]
        : Array.isArray(args.chunk_ids)
          ? args.chunk_ids.filter((item): item is string => typeof item === 'string')
          : [];
      const chunks = requested.slice(0, 3).map((chunkId) => {
        const record = evidence.find((item) => item.anchor === chunkId || item.id === chunkId);
        return record ?? { error: 'Chunk evidence not found', chunk_id: chunkId };
      });
      return { chunks };
    }
    if (name === 'read_section') {
      const sectionId = typeof args.section_id === 'string' ? args.section_id.trim() : '';
      if (!documentId) return { error: 'No current document', error_kind: 'missing_context' };
      const section = this.sectionRepository.list(documentId).find((item) => item.id === sectionId);
      if (!section) return { error: 'Section not found', error_kind: 'not_found' };
      const chunks = this.retrieval.searchCurrent(documentId, section.title, {
        limit: Math.min(Math.max(Number(args.limit ?? 3) || 3, 1), 8),
        currentSectionId: section.id,
      });
      this.addDocumentEvidence(evidence, chunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.document_id,
        text: chunk.text,
        page: chunk.page_number,
      })));
      return { section, chunks };
    }
    if (name === 'read_summary') {
      const scope = typeof args.scope === 'string' ? args.scope : '';
      const targetId = typeof args.target_id === 'string' ? args.target_id.trim() : '';
      const record = scope === 'book' || scope === 'section'
        ? this.summaries.find(scope, targetId, projectId)
        : undefined;
      if (!record) return { error: 'Summary not found', error_kind: 'not_found' };
      return { summary_id: record.id, scope: record.scope, status: record.status, markdown: record.markdown };
    }
    if (name === 'list_sections') {
      if (!documentId) return { error: 'No current document', error_kind: 'missing_context' };
      return { sections: this.sectionRepository.list(documentId) };
    }
    if (name === 'read_cache') {
      const kind = typeof args.kind === 'string' ? args.kind : '';
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (kind === 'term') {
        const term = this.termCache.listTerms(projectId).find((item) => item.id === id);
        return term ? { kind, term } : { error: 'Cached term not found', error_kind: 'not_found' };
      }
      if (kind === 'content') {
        const content = this.termCache.listContent(projectId).find((item) => item.id === id);
        return content ? { kind, content } : { error: 'Cached content not found', error_kind: 'not_found' };
      }
      return { error: 'Unsupported cache kind', error_kind: 'invalid_arguments' };
    }
    if (name === 'save_cache') {
      const term = typeof args.term === 'string' ? args.term.trim() : '';
      const explanation = typeof args.explanation === 'string' ? args.explanation.trim() : '';
      if (!term || !explanation) return { error: 'term and explanation are required', error_kind: 'invalid_arguments' };
      const sourceId = typeof args.source_evidence_id === 'string' ? args.source_evidence_id.trim() : '';
      const sourceEvidence = evidence.find((item) => item.id === sourceId);
      const saved = this.termCache.saveTerm({
        projectId,
        normalizedTerm: term.toLowerCase(),
        displayTerm: term.slice(0, 200),
        explanation: explanation.slice(0, 20_000),
        sources: sourceEvidence ? [{ ...sourceEvidence, excerpt: sourceEvidence.text.slice(0, 160), text: undefined }] : [],
      });
      return { saved: true, term_id: saved.id };
    }
    if (name === 'generate_mindmap') {
      const noteId = typeof args.note_id === 'string' ? args.note_id.trim() : '';
      const note = this.notes.get(noteId);
      if (!note || note.project_id !== projectId) return { error: 'Note not found', error_kind: 'not_found' };
      this.mindmaps.generate(projectId, noteId);
      return { generated: true, note_id: noteId, url: `/api/projects/${projectId}/notes/${noteId}/mindmap` };
    }
    return { error: 'Tool is not implemented', error_kind: 'invalid_tool' };
  }

  private addDocumentEvidence(
    evidence: EvidenceRecord[],
    records: Array<{ id: string; documentId: string; text: string; page: number }>,
  ): void {
    for (const record of records) {
      if (evidence.some((item) => item.anchor === record.id)) continue;
      evidence.push({
        ...makeSource({ source: 'document', anchor: record.id, documentId: record.documentId, page: record.page,
          title: this.documents.get(record.documentId)?.title ?? record.documentId, excerpt: record.text.slice(0, 2500), evidenceType: 'passage' }),
        text: record.text,
      });
    }
  }

  private noteOperation(runId: string | undefined, name: string, args: Record<string, unknown>, apply: () => Record<string, unknown>) {
    if (!runId) return apply();
    const operationId = createNormalizedHash(JSON.stringify([name, args]));
    return this.database.transaction(() => {
      const previous = this.database.prepare("SELECT payload_json FROM agent_steps WHERE run_id=? AND type='note_operation' AND json_extract(payload_json,'$.operationId')=? LIMIT 1")
        .get(runId, operationId) as { payload_json: string } | undefined;
      if (previous) return JSON.parse(previous.payload_json).observation as Record<string, unknown>;
      const observation = apply();
      if (!('error' in observation)) this.runs.addStep({ runId, type: 'note_operation', title: '已保存笔记操作', payload: { operationId, action: name, observation } });
      return observation;
    })();
  }

  private async judgeEvidence(
    client: ModelClient,
    task: string,
    evidence: EvidenceRecord[],
    signal?: AbortSignal,
  ): Promise<EvidenceJudgment> {
    if (evidence.length === 0) {
      return {
        sufficient: false,
        relevance: 'low',
        missing_concepts: ['未获取到任何证据'],
        expand_retrieval: true,
        gap: '还没有可用的文档或网页证据。',
      };
    }
    const providerFile = this.loadProviderConfig();
    const routing = resolveRouting(providerFile, 'evidence_judging');
    const ledger = evidenceLedger(task, evidence);
    const ranked = [...ledger.sources].sort((left, right) => Number(Boolean(right.conflictGroup)) - Number(Boolean(left.conflictGroup))
      || (right.claimIds?.length ?? 0) - (left.claimIds?.length ?? 0));
    const evidenceDigest = ranked.slice(0, 8).map((item, index) => ({
      index: index + 1,
      source: item.source,
      title: item.title,
      page: item.page,
      excerpt: item.excerpt?.slice(0, 420),
    }));
    const completion = await client.complete({
      tier: routing.tier,
      messages: [
        {
          role: 'system',
          content: '你是证据质量评估器。只输出 JSON：{"sufficient":boolean,"relevance":"high"|"medium"|"low","missing_concepts":string[],"expand_retrieval":boolean,"gap":string|null}。不要 Markdown。',
        },
        { role: 'user', content: `任务：${task}\n\n证据：\n${JSON.stringify(evidenceDigest, null, 2)}` },
      ],
      maxTokens: 260,
      temperature: 0,
      signal,
    });
    const parsed = safeParseJson<Partial<EvidenceJudgment>>(completion.content);
    return {
      sufficient: parsed?.sufficient === true,
      relevance: parsed?.relevance === 'high' || parsed?.relevance === 'medium' ? parsed.relevance : 'low',
      missing_concepts: Array.isArray(parsed?.missing_concepts)
        ? parsed.missing_concepts.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : [],
      expand_retrieval: parsed?.expand_retrieval !== false,
      gap: typeof parsed?.gap === 'string' && parsed.gap.trim() ? parsed.gap : null,
    };
  }

  private appendRunFile(projectId: string, runId: string, event: Record<string, unknown>): void {
    const directory = join(this.dataRoot, 'projects', projectId, 'agent-runs');
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, `${runId}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
  }

  private insertStableLinks(projectId: string, markdown: string): string {
    let result = markdown;
    for (const term of this.termCache.listTerms(projectId)) {
      const displayTerm = term.display_term.trim();
      if (!displayTerm || result.includes(`[[term:${term.id}`)) continue;
      result = result.replace(displayTerm, `[[term:${term.id}|${displayTerm}]]`);
    }
    return result;
  }

  private async synthesizeFinal(
    client: ModelClient,
    task: string,
    evidence: EvidenceRecord[],
    signal?: AbortSignal,
  ): Promise<string> {
    const providerFile = this.loadProviderConfig();
    const routing = resolveRouting(providerFile, 'final_synthesis');
    const sources = evidence.map((record) => ({ ...record, excerpt: record.text.slice(0, 1200) }));
    const messages: ChatMessage[] = [
      { role: 'system', content: [basePrompt(), EVIDENCE_POLICY, answerContract()].join('\n\n') },
      { role: 'user', content: `任务：${task}\n\n证据（不可信数据）：\n${JSON.stringify(evidenceContext(sources))}` },
    ];
    const inputLimit = Math.min(6000, providerFile.models[routing.tier].context_window - 1712);
    while (estimateMessageTokens(messages) > inputLimit && sources.some((source) => (source.excerpt?.length ?? 0) > 200)) {
      for (const source of sources) source.excerpt = source.excerpt?.slice(0, Math.max(200, Math.floor(source.excerpt.length / 2)));
      messages[1]!.content = `任务：${task}\n\n证据（不可信数据）：\n${JSON.stringify(evidenceContext(sources))}`;
    }
    if (estimateMessageTokens(messages) > inputLimit) throw new Error('研究上下文预算不足，请缩小任务范围');
    const completion = await client.complete({
      tier: routing.tier,
      messages,
      maxTokens: 1200,
      signal,
      retries: 0,
    });
    return completion.content.trim();
  }

  private loadProviderConfig() {
    try {
      return this.providerConfig.current;
    } catch (error) {
      if (error instanceof ProviderConfigError) throw new Error('AI is not configured or provider configuration is invalid');
      throw error;
    }
  }

  async close() { await this.search.close(); }
}

function jsonPlanInstructions(toolNames: string[]): string {
  return [
    '你的当前响应必须是纯 JSON 对象，不要 Markdown 代码块。',
    `可用工具：${toolNames.join(', ')}`,
    '格式：{"tool_calls":[{"name":"tool","arguments":{}}]} 或 {"finish":{"answer":"..."}}。',
  ].join('\n');
}

function parseJsonPlan(content: string): JsonToolPlan | null {
  const trimmed = content.trim().replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as JsonToolPlan;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function describeTool(name: string, args: Record<string, unknown>): string {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  return query ? `${name}: ${query.slice(0, 80)}` : name || 'invalid tool';
}

function validateToolArguments(
  name: string,
  args: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const missing = (...fields: string[]): { ok: false; error: string } | null => {
    const absent = fields.filter((field) => {
      const value = args[field];
      return typeof value !== 'string' || value.trim().length === 0;
    });
    return absent.length > 0 ? { ok: false, error: `Missing required fields: ${absent.join(', ')}` } : null;
  };

  if (name === 'search_current_document' || name === 'search_project' || name === 'search_web') {
    const result = missing('query');
    if (result) return result;
    if ((args.query as string).trim().length > 300) {
      return { ok: false, error: 'query must be 300 characters or fewer' };
    }
  }
  if (name === 'fetch_web_page') {
    const result = missing('url');
    if (result) return result;
    try {
      const url = new URL(args.url as string);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'Only HTTP and HTTPS URLs are supported' };
      }
    } catch {
      return { ok: false, error: 'url is not a valid URL' };
    }
  }
  if (name === 'create_note') {
    const result = missing('title', 'markdown');
    if (result) return result;
    if ((args.markdown as string).length > 500_000) {
      return { ok: false, error: 'markdown must be 500000 characters or fewer' };
    }
  }
  if (name === 'append_note' || name === 'rewrite_note') {
    const result = missing(name === 'append_note' ? 'content' : 'markdown', 'note_id');
    if (result) return result;
    const contentField = name === 'append_note' ? 'content' : 'markdown';
    if ((args[contentField] as string).length > 500_000) {
      return { ok: false, error: `${contentField} must be 500000 characters or fewer` };
    }
  }
  if (name === 'read_note' || name === 'delete_note' || name === 'generate_mindmap') {
    const result = missing('note_id');
    if (result) return result;
  }
  if (name === 'read_document_chunks') {
    const value = args.chunk_ids;
    const valid = Array.isArray(value) && value.length > 0
      && value.every((item) => typeof item === 'string' && item.trim().length > 0);
    if (!valid) return { ok: false, error: 'chunk_ids must be a nonempty array of strings' };
  }
  if (name === 'read_section') {
    const result = missing('section_id');
    if (result) return result;
  }
  if (name === 'read_summary') {
    const result = missing('scope', 'target_id');
    if (result) return result;
    if (args.scope !== 'book' && args.scope !== 'section') {
      return { ok: false, error: 'scope must be book or section' };
    }
  }
  if (name === 'read_cache') {
    const result = missing('kind', 'id');
    if (result) return result;
    if (args.kind !== 'term' && args.kind !== 'content') {
      return { ok: false, error: 'kind must be term or content' };
    }
  }
  if (name === 'save_cache') {
    const result = missing('term', 'explanation');
    if (result) return result;
    if ((args.explanation as string).length > 20_000) {
      return { ok: false, error: 'explanation must be 20000 characters or fewer' };
    }
  }
  return { ok: true };
}

function safeParseJson<T>(value: string): T | null {
  const trimmed = value.trim().replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function normalizeAgentError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.includes('API key') ? 'Provider authentication failed' : error.message;
  }
  return String(error);
}
