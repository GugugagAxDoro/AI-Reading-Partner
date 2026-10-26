import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { estimateMessageTokens, ModelClient, ModelRequestError, resolveRouting, type ChatMessage, type ProviderConfig } from '@ai-reading-partner/ai';
import { createNormalizedHash, normalizeText } from '@ai-reading-partner/core';
import { CacheRepository, ConversationRepository, DocumentRepository, NoteRepository, PageRepository, type ConversationMessage, type Database } from '@ai-reading-partner/db';
import { MindmapService } from './mindmap';
import { PROMPT_VERSION, buildPromptMessages, type AiActionType } from './prompts';
import { RetrievalService } from './retrieval';
import { AgentService } from './agent';
import { routeReadingIntent } from './intent-router';

export const historySchema = z.object({
  policy: z.enum(['smart', 'none', 'recent-one']).default('smart'),
  maxRounds: z.number().int().min(0).max(2).default(1),
  maxTokens: z.number().int().min(0).max(1500).default(1000),
});
export const quoteSchema = z.object({
  text: z.string().min(1).max(30000), page: z.number().int().positive(),
  endPage: z.number().int().positive().optional(), prefix: z.string().max(500).optional(),
  suffix: z.string().max(500).optional(), hash: z.string().optional(),
  documentHash: z.string().optional(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional(),
  fragments: z.array(z.object({ page: z.number().int().positive(), text: z.string() })).max(100).optional(),
});
export const sendSchema = z.object({
  requestId: z.string().min(1).max(100),
  action: z.enum(['vocabulary_explanation', 'content_interpretation', 'custom_question']).default('custom_question'),
  text: z.string().trim().max(12000).default(''),
  quote: quoteSchema.optional(), parents: z.array(z.string()).max(2).default([]),
  retryOf: z.string().optional(), forceAgent: z.boolean().default(false),
}).refine((value) => value.text.length > 0 || value.quote, '请输入问题或选择原文');
export type SendInput = z.infer<typeof sendSchema>;

export function messageTokens(messages: ChatMessage[]): number {
  return estimateMessageTokens(messages);
}

export class ConversationService {
  readonly repository: ConversationRepository;
  private readonly cache: CacheRepository;
  private readonly documents: DocumentRepository;
  private readonly pages: PageRepository;
  private readonly retrieval: RetrievalService;
  private readonly events = new EventEmitter();
  private readonly active = new Map<string, { controller: AbortController; message: ConversationMessage; runId?: string }>();
  private readonly work = new Set<Promise<void>>();

  constructor(private readonly db: Database, private readonly dataRoot: string, private readonly config: ProviderConfig, private readonly agent: AgentService) {
    this.repository = new ConversationRepository(db);
    this.repository.recover();
    this.cache = new CacheRepository(db);
    this.documents = new DocumentRepository(db, dataRoot);
    this.pages = new PageRepository(db);
    this.retrieval = new RetrievalService(db);
  }

  scope(projectId: string, id: string) {
    const conversation = this.repository.get(projectId, id);
    if (!conversation) throw Object.assign(new Error('会话不存在'), { statusCode: 404 });
    return conversation;
  }

  history(conversationId: string, input: SendInput): ChatMessage[] {
    for (const id of input.parents) {
      const parent = this.repository.message(conversationId, id);
      if (!parent || parent.role !== 'assistant' || parent.status !== 'completed') {
        throw Object.assign(new Error('追问对象必须是本会话已完成的回答'), { statusCode: 400 });
      }
    }
    const preferences = historySchema.parse(this.repository.preference('history', historySchema.parse({})));
    if (input.action !== 'custom_question' || preferences.policy === 'none' || !preferences.maxRounds || !preferences.maxTokens) return [];
    let ids = input.parents;
    if (!ids.length && preferences.policy === 'recent-one') {
      ids = this.repository.messages(conversationId).filter((item) => item.role === 'assistant' && item.status === 'completed').slice(-1).map((item) => item.id);
    }
    if (ids.length > preferences.maxRounds) throw Object.assign(new Error('关联数量超过历史轮数设置'), { statusCode: 400 });
    const messages: ChatMessage[] = [];
    for (const id of ids) {
      const answer = this.repository.message(conversationId, id)!;
      const question = answer.reply_to ? this.repository.message(conversationId, answer.reply_to) : null;
      if (!question) continue;
      const quote = question.quote_json ? JSON.parse(question.quote_json).text as string : '';
      const pair: ChatMessage[] = [{ role: 'user', content: `${question.markdown}${quote ? `\n引用：${quote}` : ''}` }, { role: 'assistant', content: answer.markdown }];
      if (messageTokens([...messages, ...pair]) <= preferences.maxTokens) messages.push(...pair);
      else {
        const marker = '\n[历史超出预算，已省略；如有歧义请补充问题]';
        const characters = Array.from(`${question.markdown}\n${quote}\n${answer.markdown}`);
        let low = 0; let high = characters.length;
        while (low < high) {
          const count = Math.ceil((low + high) / 2);
          if (messageTokens([...messages, { role: 'user', content: characters.slice(0, count).join('') + marker }]) <= preferences.maxTokens) low = count;
          else high = count - 1;
        }
        if (low > 80) messages.push({ role: 'user', content: characters.slice(0, low).join('') + marker });
      }
    }
    return messages;
  }

  send(projectId: string, id: string, input: SendInput) {
    const conversation = this.scope(projectId, id);
    const existing = this.repository.request(id, input.requestId);
    if (existing) return this.repository.enqueue(id, input);
    if (!conversation.document_id || !this.documents.getFromProject(projectId, conversation.document_id)) {
      throw Object.assign(new Error('原书已移出或删除，只能查看历史'), { statusCode: 410 });
    }
    const document = this.documents.get(conversation.document_id)!;
    if (input.quote?.documentHash && input.quote.documentHash !== document.hash) throw Object.assign(new Error('引用不属于当前书籍，请重新选择原文'), { statusCode: 400 });
    if (input.quote) input = { ...input, quote: { ...input.quote, documentHash: document.hash } };
    if (input.quote && (input.quote.page > document.page_count || (input.quote.endPage ?? input.quote.page) > document.page_count || (input.quote.endPage ?? input.quote.page) < input.quote.page)) {
      throw Object.assign(new Error('引用页码无效，请重新选择原文'), { statusCode: 400 });
    }
    if (input.retryOf) {
      const original = this.repository.message(id, input.retryOf);
      if (!original || original.role !== 'assistant' || ['pending', 'streaming'].includes(original.status)) throw Object.assign(new Error('无效的重试对象'), { statusCode: 400 });
    }
    const history = this.history(id, input);
    const route = input.action === 'custom_question' ? routeReadingIntent({ instruction: input.text, forceAgent: input.forceAgent }) : { kind: 'direct_action' };
    const prepared = this.prepare(projectId, conversation.document_id, input, history);
    const pair = this.repository.enqueue(id, { ...input, text: input.text || (input.action === 'vocabulary_explanation' ? '词汇解释' : '深度解读') });
    if (!pair.existing) {
      const promise = this.generate(projectId, conversation.document_id, pair.assistant, input, prepared, route.kind === 'agent_task', Boolean(conversation.web_enabled));
      this.work.add(promise);
      void promise.finally(() => this.work.delete(promise));
    }
    return pair;
  }

  private prepare(projectId: string, documentId: string, input: SendInput, history: ChatMessage[]) {
    let file;
    try { file = this.config.current; }
    catch { throw Object.assign(new Error('模型尚未配置或配置无效，请检查本地 providers.toml'), { statusCode: 400 }); }
    const routing = resolveRouting(file, input.action === 'custom_question' ? 'complex_qa' : 'simple_explanation');
    const document = this.documents.get(documentId)!;
    const section = this.db.prepare('SELECT id,title FROM sections WHERE document_id=? AND start_page<=? AND end_page>=? ORDER BY level DESC LIMIT 1')
      .get(documentId, input.quote?.page ?? 1, input.quote?.page ?? 1) as { id: string; title: string } | undefined;
    const prompt = buildPromptMessages(input.action, { title: document.title, page: input.quote?.page ?? 1,
      selectedText: input.quote?.text ?? '', instruction: input.text, sectionTitle: section?.title, language: '简体中文' });
    const protectedMessages: ChatMessage[] = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
    const budget = Math.min(input.action === 'custom_question' ? 6000 : 3000, file.models[routing.tier].context_window - 1200 - 512);
    if (messageTokens(protectedMessages) > budget) throw Object.assign(new Error('问题或原文超过上下文预算，请缩小范围后重试'), { statusCode: 413 });
    const chunks = this.retrieval.searchCurrent(documentId, (input.text || input.quote?.text || '').slice(0, 300), { limit: 3, currentPage: input.quote?.page });
    const page = input.quote ? this.pages.list(documentId).find((item) => item.page_number === input.quote?.page) : undefined;
    const evidence = [...chunks.map((chunk) => ({ page: chunk.page_number, text: chunk.text, id: chunk.id })),
      ...(page ? [{ page: page.page_number, text: page.text, id: `page:${page.page_number}` }] : [])];
    const summaries = this.db.prepare("SELECT markdown FROM summaries WHERE document_id=? AND (project_id=? OR project_id IS NULL) AND status='ready' AND (scope='book' OR section_id=?) LIMIT 2")
      .all(documentId, projectId, section?.id ?? null) as Array<{ markdown: string }>;
    let messages = [...protectedMessages];
    const sources: Array<{ page: number; documentId: string; excerpt: string; id?: string }> = [];
    if (input.quote) sources.push({ page: input.quote.page, documentId, excerpt: input.quote.text.slice(0, 160) });
    for (const item of evidence) {
      const text = input.quote ? item.text.replaceAll(input.quote.text, '[见选中文本]') : item.text;
      const candidate: ChatMessage = { role: 'user', content: `原文证据（第${item.page}页）：\n${text}` };
      if (messageTokens([...messages, candidate]) < budget) {
        messages.push(candidate);
        sources.push({ page: item.page, documentId, excerpt: text.slice(0, 160), id: item.id });
      }
    }
    for (const summary of summaries) {
      const context: ChatMessage = { role: 'user', content: `已有小结（辅助信息，以原文为准）：\n${summary.markdown.slice(0, 600)}` };
      if (messageTokens([...messages, context]) <= budget) messages.push(context);
    }
    const includedHistory = history.length > 0 && messageTokens([...messages, ...history]) <= budget;
    if (includedHistory) messages = [messages[0]!, ...history, ...messages.slice(1)];
    return { file, routing, messages, metadata: { promptVersion: PROMPT_VERSION, modelId: routing.model,
      providerId: routing.providerId, sources: [...new Map(sources.map((source) => [source.page, source])).values()], contextTokens: messageTokens(messages), inputBudget: budget,
      historyMessages: includedHistory ? history.length : 0, historyOmitted: history.length > 0 && !includedHistory } };
  }

  private async generate(projectId: string, documentId: string, initial: ConversationMessage, input: SendInput,
    prepared: ReturnType<ConversationService['prepare']>, research: boolean, webEnabled: boolean) {
    const controller = new AbortController();
    const state = { controller, message: initial, runId: undefined as string | undefined };
    this.active.set(initial.id, state);
    let markdown = '';
    let lastFlush = Date.now();
    let flushedLength = 0;
    const flushTimer = setInterval(() => {
      if (state.runId && !controller.signal.aborted) {
        const steps = this.agent.listSteps(projectId, state.runId);
        if (JSON.stringify(steps) !== JSON.stringify(metadata.steps)) { metadata.steps = steps; update('streaming'); }
      }
      if (!controller.signal.aborted && markdown.length !== flushedLength) {
        update('streaming'); flushedLength = markdown.length; lastFlush = Date.now();
      }
    }, 500);
    const metadata: Record<string, unknown> = { ...prepared.metadata, cached: false };
    const update = (status: ConversationMessage['status'], error?: string) => {
      if (controller.signal.aborted && status !== 'cancelled') return;
      const persisted = this.repository.message(initial.conversation_id, initial.id);
      if (!persisted) { controller.abort(); return; }
      const previousMetadata = JSON.parse(persisted.metadata_json);
      this.repository.update(initial.id, { markdown, status, metadata: { ...previousMetadata, ...metadata }, error, sequence: state.message.sequence });
      state.message = this.repository.message(initial.conversation_id, initial.id)!;
      this.events.emit(initial.id, state.message);
    };
    const cacheable = Boolean(input.quote) && !input.parents.length && !input.retryOf && prepared.metadata.historyMessages === 0
      && (!input.quote?.endPage || input.quote.endPage === input.quote.page) && !research;
    const normalized = normalizeText((input.quote?.text ?? '').replace(/\s+/gu, ' '));
    const key = { projectId, documentId, pageNumber: input.quote?.page ?? 1, action: input.action,
      instructionHash: createNormalizedHash(input.text), selectionHash: createNormalizedHash(normalized) };
    try {
      const cached = cacheable ? input.action === 'vocabulary_explanation'
        ? this.cache.findTerm(projectId, normalized.toLowerCase()) : this.cache.findContent(key) : null;
      if (cached?.prompt_version === PROMPT_VERSION) {
        markdown = 'explanation' in cached ? cached.explanation : cached.answer;
        metadata.cached = true;
        metadata.sources = JSON.parse(cached.sources_json);
      } else if (research) {
        const history = prepared.messages.slice(1, 1 + prepared.metadata.historyMessages);
        const task = [input.text, input.quote?.text, ...history.map((item) => item.content)].filter(Boolean).join('\n\n');
        const run = this.agent.createRun(projectId, documentId, { task });
        state.runId = run.id;
        metadata.runId = run.id;
        update('streaming');
        await this.agent.execute(projectId, documentId, run.id, { signal: controller.signal, webEnabled });
        if (controller.signal.aborted) return;
        const result = this.agent.getRun(projectId, run.id)!;
        metadata.steps = this.agent.listSteps(projectId, run.id);
        if (result.status !== 'ready' || !result.result_json) throw new Error('研究未完成，请查看运行记录后重试');
        const payload = JSON.parse(result.result_json);
        markdown = payload.answer;
        metadata.sources = payload.citations;
      } else {
        const client = new ModelClient(prepared.file);
        const request = { tier: prepared.routing.tier, messages: prepared.messages, maxTokens: 1200, signal: controller.signal, retries: 0 };
        update('streaming');
        try {
          for await (const delta of client.streamText(request)) {
            if (controller.signal.aborted) return;
            markdown += delta;
            state.message = { ...state.message, markdown, sequence: state.message.sequence + 1, status: 'streaming', metadata_json: JSON.stringify(metadata) };
            this.events.emit(initial.id, state.message);
            if (Date.now() - lastFlush >= 500 || markdown.length - flushedLength >= 4096) {
              update('streaming'); lastFlush = Date.now(); flushedLength = markdown.length;
            }
          }
        } catch (error) {
          if (!controller.signal.aborted && !markdown && error instanceof ModelRequestError && error.message.includes('streaming unsupported')) {
            markdown = (await client.complete(request)).content;
            metadata.nonStreamingFallback = true;
          } else throw error;
        }
      }
      if (controller.signal.aborted) return;
      if (!markdown.trim()) throw new Error('模型未返回文本');
      if (cacheable && !metadata.cached) {
        const common = { projectId, sources: metadata.sources as unknown[], promptVersion: PROMPT_VERSION, modelId: prepared.routing.model, providerId: prepared.routing.providerId };
        if (input.action === 'vocabulary_explanation') this.cache.saveTerm({ ...common, normalizedTerm: normalized.toLowerCase(), displayTerm: input.quote!.text, explanation: markdown });
        else this.cache.saveContent({ ...common, ...key, normalizedText: normalized, answer: markdown });
      }
      update('completed');
    } catch (error) {
      if (!controller.signal.aborted) update('failed', error instanceof ModelRequestError ? error.message : '生成失败，请检查模型配置后重试');
    } finally {
      clearInterval(flushTimer);
      this.active.delete(initial.id);
    }
  }

  snapshot(conversationId: string, messageId: string) {
    return this.active.get(messageId)?.message ?? this.repository.message(conversationId, messageId);
  }

  subscribe(messageId: string, listener: (message: ConversationMessage) => void) {
    this.events.on(messageId, listener);
    return () => this.events.off(messageId, listener);
  }

  cancel(conversationId: string, messageId: string) {
    const state = this.active.get(messageId);
    if (!state || state.message.conversation_id !== conversationId) return;
    state.controller.abort();
    this.repository.update(messageId, { markdown: state.message.markdown, status: 'cancelled', metadata: JSON.parse(state.message.metadata_json), sequence: state.message.sequence });
    state.message = this.repository.message(conversationId, messageId)!;
    this.events.emit(messageId, state.message);
  }

  saveNote(projectId: string, conversationId: string, messageId: string) {
    const conversation = this.scope(projectId, conversationId);
    const message = this.repository.message(conversationId, messageId);
    if (!message || message.role !== 'assistant' || message.status !== 'completed') throw Object.assign(new Error('只能保存已完成的回答'), { statusCode: 400 });
    const notes = new NoteRepository(this.db, this.dataRoot);
    const metadata = JSON.parse(message.metadata_json);
    const existing = metadata.noteId ? notes.get(metadata.noteId) : undefined;
    if (existing?.project_id === projectId) return existing;
    const references = (metadata.sources ?? []).map((source: { page?: number; documentId?: string; title?: string; url?: string; id?: string }) => {
      if (!source.page) return source.url || (source.id?.startsWith('web:') ? source.id.slice(4) : '');
      const documentId = source.documentId ?? conversation.document_id;
      const title = source.title ?? conversation.document_title;
      return documentId && this.documents.getFromProject(projectId, documentId) ? `[[doc:${documentId}|${title} 第${source.page}页]]` : `${title} 第${source.page}页（源已失效）`;
    }).filter(Boolean);
    const note = notes.create({ projectId, title: message.markdown.replace(/^#+\s*/u, '').slice(0, 80), markdown: message.markdown + (references.length ? `\n\n## 来源\n${references.join('\n\n')}` : '') });
    this.repository.metadata(conversationId, messageId, { noteId: note.id });
    return note;
  }

  mindmap(projectId: string, conversationId: string, messageId: string) {
    const note = this.saveNote(projectId, conversationId, messageId);
    const result = new MindmapService(this.dataRoot, new NoteRepository(this.db, this.dataRoot)).generate(projectId, note.id);
    this.repository.metadata(conversationId, messageId, { mindmap: true });
    return result;
  }

  confirm(projectId: string, conversationId: string, messageId: string, stepId: string) {
    this.scope(projectId, conversationId);
    const message = this.repository.message(conversationId, messageId);
    if (!message) throw Object.assign(new Error('消息不存在'), { statusCode: 404 });
    const metadata = JSON.parse(message.metadata_json);
    const step = metadata.runId ? this.agent.listSteps(projectId, metadata.runId)?.find((item) => item.id === stepId) : undefined;
    const proposal = step ? JSON.parse(step.payload_json).observation : null;
    if (!proposal?.confirmation_required || !['rewrite_note', 'delete_note'].includes(proposal.action)) throw Object.assign(new Error('确认操作不存在'), { statusCode: 404 });
    const confirmations: string[] = metadata.confirmations ?? [];
    if (confirmations.includes(stepId)) return message;
    const notes = new NoteRepository(this.db, this.dataRoot);
    const note = notes.get(proposal.note_id);
    if (!note || note.project_id !== projectId || note.current_version !== proposal.current_version) throw Object.assign(new Error('笔记已变更，请重新确认最新版本'), { statusCode: 409 });
    if (proposal.action === 'delete_note') notes.delete(note.id);
    else notes.update({ noteId: note.id, markdown: proposal.pending_markdown, changeKind: 'rewrite' });
    const updated = this.repository.metadata(conversationId, messageId, { confirmations: [...confirmations, stepId] });
    const active = this.active.get(messageId);
    if (active) active.message = updated;
    return updated;
  }

  async close() {
    for (const state of this.active.values()) this.cancel(state.message.conversation_id, state.message.id);
    await Promise.allSettled(this.work);
  }

  cancelScope(projectId?: string, documentId?: string) {
    for (const state of this.active.values()) {
      const conversation = this.db.prepare('SELECT project_id,document_id FROM conversations WHERE id=?').get(state.message.conversation_id) as { project_id: string; document_id: string } | undefined;
      if (conversation && (!projectId || conversation.project_id === projectId) && (!documentId || conversation.document_id === documentId)) this.cancel(state.message.conversation_id, state.message.id);
    }
  }
}
