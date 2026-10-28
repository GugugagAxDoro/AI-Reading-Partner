import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import {
  buildChunks,
  classifyTextLayer,
  resolveDataRoot,
  ensureDataRoot,
} from '@ai-reading-partner/core';
import {
  CacheRepository,
  ChunkRepository,
  DatabaseConstructor as Database,
  DocumentRepository,
  JobRepository,
  migrate,
  NoteRepository,
  PageRepository,
  ProgressRepository,
  ProjectRepository,
  SectionRepository,
  SummaryRepository,
} from '@ai-reading-partner/db';
import { ProviderConfig } from '@ai-reading-partner/ai';
import { extractPdf, fallbackOutline, generatePdfCover } from './processing/pdf-document';
import { writePagesJsonl } from './processing/page-serialization';
import { DocumentImportService, DocumentNotFoundError } from './services/document-import';
import { AiActionService } from './services/ai-actions';
import { RetrievalService } from './services/retrieval';
import { SummaryService } from './services/summaries';
import { MindmapService } from './services/mindmap';
import { AgentService } from './services/agent';
import { routeReadingIntent } from './services/intent-router';
import { TextExtractionService } from './services/text-extraction';
import { ConversationService } from './services/conversations';
import { registerConversationRoutes } from './conversation-routes';

const pdfjsDistDir = new URL('../../../node_modules/pdfjs-dist/build', import.meta.url).pathname;

const createProjectSchema = z.object({ name: z.string().trim().min(1).max(100) });
const renameProjectSchema = z.object({ name: z.string().trim().min(1).max(100) });

export interface AppOptions {
  dataRootOverride?: string;
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const dataRoot = ensureDataRoot(resolveDataRoot(options.dataRootOverride));
  const database = new Database(join(dataRoot, 'app.db'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  const schemaVersion = Number(database.pragma('user_version', { simple: true }));
  if (schemaVersion > 0 && schemaVersion < 3) {
    const backups = join(dataRoot, 'backups');
    mkdirSync(backups, { recursive: true });
    await database.backup(join(backups, `before-schema-v${schemaVersion === 1 ? 2 : 3}-${Date.now()}.db`));
  }
  migrate(database);
  database.prepare("UPDATE agent_runs SET status='failed',error='运行被中断，可重新发起；已保存笔记保留',finished_at=?,updated_at=? WHERE status IN ('running','pending')")
    .run(new Date().toISOString(), new Date().toISOString());

  const app: FastifyInstance = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] });
  await app.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  });

  const projectRepository = new ProjectRepository(database);
  const documentRepository = new DocumentRepository(database, dataRoot);
  const pageRepository = new PageRepository(database);
  const sectionRepository = new SectionRepository(database);
  const chunkRepository = new ChunkRepository(database);
  const progressRepository = new ProgressRepository(database);
  const providerConfig = new ProviderConfig(dataRoot);
  const summaryService = new SummaryService(database, providerConfig);
  const documentImportService = new DocumentImportService(database, dataRoot, summaryService, providerConfig);
  const textExtractionService = new TextExtractionService(database, dataRoot);
  const summaryRepository = new SummaryRepository(database);
  const aiActionService = new AiActionService(database, dataRoot, providerConfig);
  const retrievalService = new RetrievalService(database);
  const noteRepository = new NoteRepository(database, dataRoot);
  const mindmapService = new MindmapService(dataRoot, noteRepository);
  const cacheRepository = new CacheRepository(database);
  const agentService = new AgentService(dataRoot, database, providerConfig);
  const conversations = new ConversationService(database, dataRoot, providerConfig, agentService);
  registerConversationRoutes(app, conversations);
  app.addHook('preClose', async () => { await conversations.close(); await agentService.close(); });

  app.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as Error & { statusCode?: number };
    const statusCode = error instanceof z.ZodError ? 400 : typeof error.statusCode === 'number' ? error.statusCode : 500;
    const message = statusCode >= 500 ? 'Internal server error' : error.message;
    if (statusCode >= 500) {
      app.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Unhandled request error');
    }
    reply.status(statusCode).send({ error: message });
  });

  app.get('/api/health', () => ({ status: 'ok' }));
  app.get('/api/config/pdfjs', () => ({ path: pdfjsDistDir }));
  app.get('/api/providers/status', async () => providerConfig.status());
  app.post('/api/providers/reload', async () => providerConfig.reload());

  app.get('/api/projects', () => projectRepository.list());
  app.post('/api/projects', async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const project = projectRepository.create(body.name);
    reply.status(201);
    return project;
  });
  app.get('/api/projects/:projectId', (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = projectRepository.get(projectId);
    if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return project;
  });
  app.patch('/api/projects/:projectId', (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = renameProjectSchema.parse(request.body);
    const project = projectRepository.rename(projectId, body.name);
    if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return project;
  });
  app.delete('/api/projects/:projectId', (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    conversations.cancelScope(projectId);
    const deleted = projectRepository.delete(projectId);
    if (!deleted) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    reply.status(204);
  });
  app.get('/api/projects/:projectId/documents', (request) => {
    const { projectId } = request.params as { projectId: string };
    return documentRepository.listByProject(projectId);
  });
  app.get('/api/projects/:projectId/references', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return database.prepare(`SELECT d.id AS id,'doc' AS kind,d.id AS documentId,1 AS page FROM documents d
      JOIN project_documents p ON p.document_id=d.id WHERE p.project_id=?
      UNION ALL SELECT s.id,'section',s.document_id,s.start_page FROM sections s
      JOIN project_documents p ON p.document_id=s.document_id WHERE p.project_id=?`).all(projectId, projectId);
  });

  app.post('/api/projects/:projectId/documents', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) {
      throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    }
    const file = await request.file();
    if (!file) throw Object.assign(new Error('A PDF file is required'), { statusCode: 400 });
    const buffer = await file.toBuffer();
    const result = await documentImportService.importPdf(
      projectId,
      buffer,
      file.filename || 'document.pdf',
    );
    reply.status(202);
    return result;
  });

  app.get('/api/projects/:projectId/jobs', (request) => {
    const { projectId } = request.params as { projectId: string };
    return documentImportService.listJobs(projectId);
  });

  app.get('/api/projects/:projectId/documents/:documentId', (request) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const document = documentRepository.getFromProject(projectId, documentId);
    if (!document) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    return document;
  });

  app.post('/api/projects/:projectId/documents/:documentId/retry', async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    try {
      const result = await documentImportService.retry(projectId, documentId);
      reply.status(202);
      return result;
    } catch (error) {
      if (error instanceof DocumentNotFoundError) {
        throw Object.assign(new Error('Document not found'), { statusCode: 404 });
      }
      throw error;
    }
  });

  app.delete('/api/projects/:projectId/documents/:documentId', async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const query = request.query as { permanent?: string };
    const document = documentRepository.getFromProject(projectId, documentId);
    if (!document) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    if (query.permanent === 'true') {
      conversations.cancelScope(undefined, documentId);
      documentImportService.deletePermanent(documentId);
    } else {
      conversations.cancelScope(projectId, documentId);
      documentImportService.removeFromProject(projectId, documentId);
    }
    reply.status(204);
  });

  app.get('/api/documents/:documentId/pages', async (request) => {
    const { documentId } = request.params as { documentId: string };
    if (!documentRepository.get(documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    await textExtractionService.ensure(documentId);
    return pageRepository.list(documentId);
  });

  app.get('/api/documents/:documentId/page-metrics', async (request) => {
    const { documentId } = request.params as { documentId: string };
    if (!documentRepository.get(documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    await textExtractionService.ensure(documentId);
    return pageRepository.list(documentId).map((page) => ({
      page_number: page.page_number,
      char_count: page.char_count,
      has_text: page.has_text,
    }));
  });

  app.get('/api/documents/:documentId/sections', (request) => {
    const { documentId } = request.params as { documentId: string };
    if (!documentRepository.get(documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    return sectionRepository.list(documentId);
  });

  app.get('/api/documents/:documentId/chunks', async (request) => {
    const { documentId } = request.params as { documentId: string };
    if (!documentRepository.get(documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    await textExtractionService.ensure(documentId);
    return chunkRepository.list(documentId);
  });

  app.get('/api/documents/:documentId/search', async (request) => {
    const { documentId } = request.params as { documentId: string };
    if (!documentRepository.get(documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    await textExtractionService.ensure(documentId);
    const query = z.object({
      q: z.string().trim().min(1).max(300),
      limit: z.coerce.number().int().min(1).max(20).default(5),
    }).parse(request.query);
    return retrievalService.searchCurrent(documentId, query.q, { limit: query.limit });
  });

  app.get('/api/projects/:projectId/search', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    const query = z.object({
      q: z.string().trim().min(1).max(300),
      document_id: z.string().trim().optional(),
      limit: z.coerce.number().int().min(1).max(20).default(8),
    }).parse(request.query);
    return retrievalService.searchProject(projectId, query.q, {
      limit: query.limit,
      currentDocumentId: query.document_id ?? null,
    });
  });

  app.put('/api/projects/:projectId/documents/:documentId/progress', (request) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    if (!documentRepository.getFromProject(projectId, documentId)) {
      throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    }
    const body = z.object({
      current_page: z.number().int().positive().default(1),
      scroll_offset: z.number().default(0),
      percent: z.number().min(0).max(100).default(0),
    }).parse(request.body);
    return progressRepository.save({
      projectId,
      documentId,
      currentPage: body.current_page,
      scrollOffset: body.scroll_offset,
      percent: body.percent,
    });
  });

  app.post('/api/projects/:projectId/documents/:documentId/actions', async (request) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    if (!documentRepository.getFromProject(projectId, documentId)) {
      throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    }
    const body = z.object({
      action: z.enum(['vocabulary_explanation', 'content_interpretation', 'custom_question']),
      page_number: z.number().int().positive(),
      text: z.string().trim().min(1).max(5000),
      normalized_text: z.string().trim().max(5000).optional(),
      selection_hash: z.string().length(64).optional(),
      quote: z.string().trim().max(5000).optional(),
      prefix: z.string().trim().max(500).optional(),
      suffix: z.string().trim().max(500).optional(),
      instruction: z.string().trim().max(1000).optional(),
      language: z.string().trim().max(40).optional(),
    }).parse(request.body);
    try {
      await textExtractionService.ensure(documentId);
      return await aiActionService.explainSelection(projectId, documentId, {
        action: body.action,
        pageNumber: body.page_number,
        text: body.text,
        normalizedText: body.normalized_text,
        selectionHash: body.selection_hash,
        anchor: {
          quote: body.quote,
          prefix: body.prefix,
          suffix: body.suffix,
        },
        instruction: body.instruction,
        language: body.language,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('configuration is missing')) {
        throw Object.assign(new Error('AI is not configured'), { statusCode: 400 });
      }
      if (error instanceof Error && error.message.includes('Model provider returned')) {
        throw Object.assign(new Error('AI provider request failed'), { statusCode: 502 });
      }
      throw error;
    }
  });

  app.get('/api/documents/:documentId/reader.pdf', async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const document = documentRepository.get(documentId);
    if (!document) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    await textExtractionService.ensure(documentId);
    const repaired = join(dirname(document.source_path), 'extracted', 'reader.pdf');
    try {
      return reply.header('Cache-Control', 'no-cache').type('application/pdf')
        .send(readFileSync(existsSync(repaired) ? repaired : document.source_path));
    } catch {
      throw Object.assign(new Error('Source PDF is missing'), { statusCode: 410 });
    }
  });

  app.get('/api/documents/:documentId/source.pdf', async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const document = documentRepository.get(documentId);
    if (!document) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    try {
      return reply.type('application/pdf').send(readFileSync(document.source_path));
    } catch {
      throw Object.assign(new Error('Source PDF is missing'), { statusCode: 410 });
    }
  });

  app.get('/api/documents/:documentId/summaries', (request) => {
    const { documentId } = request.params as { documentId: string };
    if (!documentRepository.get(documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    return summaryRepository.listByDocument(documentId);
  });

  app.post('/api/projects/:projectId/documents/:documentId/summaries/book', async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    if (!documentRepository.getFromProject(projectId, documentId)) {
      throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    }
    const summary = summaryService.ensureBookSummary(projectId, documentId, { background: true });
    reply.status(202);
    return summary;
  });

  app.post('/api/projects/:projectId/documents/:documentId/sections/:sectionId/summary', async (request, reply) => {
    const { projectId, documentId, sectionId } = request.params as {
      projectId: string;
      documentId: string;
      sectionId: string;
    };
    if (!documentRepository.getFromProject(projectId, documentId)) {
      throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    }
    const summary = summaryService.ensureSectionSummary(projectId, documentId, sectionId);
    reply.status(202);
    return summary;
  });

  app.post('/api/projects/:projectId/summary', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = projectRepository.get(projectId);
    if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    try {
      return await summaryService.generateProjectSummary(projectId, project.name);
    } catch (error) {
      if (error instanceof Error && error.message.includes('no ready book summaries')) {
        throw Object.assign(new Error('Project has no ready book summaries yet'), { statusCode: 409 });
      }
      if (error instanceof Error && error.message.includes('AI is not configured')) {
        throw Object.assign(new Error('AI is not configured or provider configuration is invalid'), { statusCode: 400 });
      }
      throw error;
    }
  });
  app.get('/api/projects/:projectId/summary', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return summaryRepository.find('project', projectId, projectId) ?? null;
  });

  app.get('/api/projects/:projectId/notes', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return noteRepository.list(projectId);
  });

  app.post('/api/projects/:projectId/notes', (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    const body = z.object({
      title: z.string().trim().min(1).max(200),
      markdown: z.string().max(500000),
    }).parse(request.body);
    const note = noteRepository.create({ projectId, ...body, source: 'user', createdBy: 'user' });
    reply.status(201);
    return note;
  });

  app.get('/api/projects/:projectId/notes/:noteId', (request) => {
    const { projectId, noteId } = request.params as { projectId: string; noteId: string };
    const note = noteRepository.get(noteId);
    if (!note || note.project_id !== projectId) {
      throw Object.assign(new Error('Note not found'), { statusCode: 404 });
    }
    return {
      ...note,
      versions: noteRepository.versions(noteId),
      links: noteRepository.links(noteId),
    };
  });

  app.patch('/api/projects/:projectId/notes/:noteId', (request) => {
    const { projectId, noteId } = request.params as { projectId: string; noteId: string };
    const note = noteRepository.get(noteId);
    if (!note || note.project_id !== projectId) {
      throw Object.assign(new Error('Note not found'), { statusCode: 404 });
    }
    const body = z.object({
      title: z.string().trim().min(1).max(200).optional(),
      markdown: z.string().max(500000).optional(),
      change_kind: z.enum(['edit', 'append', 'rewrite', 'restore']).optional(),
    }).parse(request.body);
    const updated = noteRepository.update({
      noteId,
      title: body.title,
      markdown: body.markdown,
      changeKind: body.change_kind,
    });
    if (!updated) throw Object.assign(new Error('Note not found'), { statusCode: 404 });
    return updated;
  });

  app.post('/api/projects/:projectId/notes/:noteId/versions/:version/restore', (request) => {
    const { projectId, noteId, version } = request.params as {
      projectId: string;
      noteId: string;
      version: string;
    };
    const note = noteRepository.get(noteId);
    if (!note || note.project_id !== projectId) {
      throw Object.assign(new Error('Note not found'), { statusCode: 404 });
    }
    const restored = noteRepository.restoreVersion(noteId, Number(version));
    if (!restored) throw Object.assign(new Error('Version not found'), { statusCode: 404 });
    return restored;
  });

  app.post('/api/projects/:projectId/notes/:noteId/mindmap', (request, reply) => {
    const { projectId, noteId } = request.params as { projectId: string; noteId: string };
    try {
      const mindmap = mindmapService.generate(projectId, noteId);
      reply.status(201);
      return mindmap;
    } catch (error) {
      if (error instanceof Error && error.message === 'Note not found') {
        throw Object.assign(new Error('Note not found'), { statusCode: 404 });
      }
      throw error;
    }
  });

  app.get('/api/projects/:projectId/notes/:noteId/mindmap', (request, reply) => {
    const { projectId, noteId } = request.params as { projectId: string; noteId: string };
    const mindmapPath = mindmapService.path(projectId, noteId);
    if (!mindmapPath) throw Object.assign(new Error('Note not found'), { statusCode: 404 });
    try {
      if ((request.query as { download?: string }).download === '1') {
        reply.header('Content-Disposition', `attachment; filename="${noteId}.html"`);
      }
      return reply.type('text/html').send(readFileSync(mindmapPath, 'utf8'));
    } catch {
      throw Object.assign(new Error('Mind map not generated'), { statusCode: 404 });
    }
  });

  app.get('/api/static/markmap/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string | string[] })['*'];
    const relative = (Array.isArray(wildcard) ? wildcard : [wildcard]).flat().join('/');
    if (relative.includes('..')) throw Object.assign(new Error('Invalid path'), { statusCode: 400 });
    const allowedFiles = [
      'markmap-lib/dist/browser/index.mjs',
      'markmap-view/dist/browser/index.js',
      'markmap-common/dist/index.mjs',
    ];
    if (!allowedFiles.includes(relative)) {
      throw Object.assign(new Error('File not found'), { statusCode: 404 });
    }
    const fileName = relative.split('/').at(-1)!;
    const contentType = fileName.endsWith('.mjs')
      ? 'text/javascript'
      : fileName.endsWith('.js')
        ? 'text/javascript'
        : 'text/plain';
    return reply.type(contentType).send(readFileSync(join(pdfjsDistDir, '../../markmap', relative), 'utf8'));
  });

  app.get('/api/projects/:projectId/term-cache', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return cacheRepository.listTerms(projectId);
  });

  app.get('/api/projects/:projectId/content-cache', (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { document_id?: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return cacheRepository.listContent(projectId, query.document_id ?? null);
  });

  app.get('/api/projects/:projectId/web-cache', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    cacheRepository.markStaleExpired();
    return cacheRepository.listWeb(projectId);
  });

  app.delete('/api/projects/:projectId/web-cache', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    const query = request.query as { expired_only?: string };
    const deleted = cacheRepository.clearWebCache(projectId, {
      expiredOnly: query.expired_only === 'true',
    });
    return { deleted };
  });

  app.post('/api/projects/:projectId/agent/runs', (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      task: z.string().trim().min(1).max(4000),
      title: z.string().trim().max(120).optional(),
      document_id: z.string().trim().uuid().optional(),
      max_rounds: z.coerce.number().int().min(1).max(12).default(8),
      budget_tokens: z.coerce.number().int().min(1000).max(250_000).default(120_000),
      timeout_ms: z.coerce.number().int().min(10_000).max(300_000).default(180_000),
    }).parse(request.body);
    const run = agentService.createRun(projectId, body.document_id ?? null, {
      task: body.task,
      title: body.title,
      maxRounds: body.max_rounds,
      budgetTokens: body.budget_tokens,
      timeoutMs: body.timeout_ms,
    });
    void agentService.execute(projectId, body.document_id ?? null, run.id).catch(() => undefined);
    reply.status(202);
    return run;
  });

  app.post('/api/projects/:projectId/documents/:documentId/intent', (request) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    if (!documentRepository.getFromProject(projectId, documentId)) {
      throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    }
    const body = z.object({
      action: z.enum(['vocabulary_explanation', 'content_interpretation', 'custom_question']).optional(),
      text: z.string().trim().max(5000).optional(),
      instruction: z.string().trim().max(1000).optional(),
      force_agent: z.boolean().default(false),
    }).parse(request.body);
    return routeReadingIntent({
      action: body.action,
      selection: body.text,
      instruction: body.instruction,
      forceAgent: body.force_agent,
    });
  });

  app.get('/api/projects/:projectId/agent/runs', (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!projectRepository.get(projectId)) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    return agentService.listRuns(projectId);
  });

  app.get('/api/projects/:projectId/agent/runs/:runId', (request) => {
    const { projectId, runId } = request.params as { projectId: string; runId: string };
    const run = agentService.getRun(projectId, runId);
    if (!run) throw Object.assign(new Error('Agent run not found'), { statusCode: 404 });
    return { ...run, steps: agentService.listSteps(projectId, runId) ?? [] };
  });

  app.get('/api/documents/:documentId/cover.png', async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const document = documentRepository.get(documentId);
    if (!document?.cover_path) throw Object.assign(new Error('Cover not found'), { statusCode: 404 });
    try {
      return reply.type('image/png').send(readFileSync(document.cover_path));
    } catch {
      throw Object.assign(new Error('Cover is missing'), { statusCode: 410 });
    }
  });

  app.get('/api/static/pdfjs/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string | string[] })['*'];
    const relative = (Array.isArray(wildcard) ? wildcard : [wildcard]).flat().join('/');
    if (relative.includes('..')) throw Object.assign(new Error('Invalid path'), { statusCode: 400 });
    const fileName = relative.split('/').at(-1);
    if (!fileName || !readdirSync(pdfjsDistDir).includes(fileName)) {
      throw Object.assign(new Error('File not found'), { statusCode: 404 });
    }
    const contentType = fileName.endsWith('.mjs')
      ? 'text/javascript'
      : fileName.endsWith('.css')
        ? 'text/css'
        : 'application/octet-stream';
    return reply.type(contentType).send(readFileSync(join(pdfjsDistDir, fileName)));
  });

  return {
    app,
    dataRoot,
    database,
    close: () => database.close(),
  };
}
