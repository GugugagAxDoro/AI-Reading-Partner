import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConversationService, historySchema, sendSchema } from './services/conversations';

export function registerConversationRoutes(app: FastifyInstance, service: ConversationService) {
  const base = '/api/projects/:projectId/conversations/:conversationId';
  type Scope = { projectId: string; conversationId: string; messageId: string };
  app.get('/api/reader-preferences', () => historySchema.parse(service.repository.preference('history', {})));
  app.put('/api/reader-preferences', (request) => {
    const value = historySchema.parse(request.body);
    service.repository.setPreference('history', value);
    return value;
  });
  app.get('/api/projects/:projectId/documents/:documentId/conversations', (request) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    return service.repository.list(projectId, documentId);
  });
  app.post('/api/projects/:projectId/documents/:documentId/conversations', (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const body = z.object({ title: z.string().trim().min(1).max(120).default('新会话') }).parse(request.body ?? {});
    reply.status(201);
    return service.repository.create(projectId, documentId, body.title);
  });
  app.patch(base, (request) => {
    const { projectId, conversationId } = request.params as Scope;
    service.scope(projectId, conversationId);
    const body = z.object({ webEnabled: z.boolean().optional() }).parse(request.body ?? {});
    service.repository.touch(conversationId, body.webEnabled);
    return service.scope(projectId, conversationId);
  });
  app.get(`${base}/messages`, (request) => {
    const { projectId, conversationId } = request.params as Scope;
    service.scope(projectId, conversationId);
    const query = z.object({ before: z.coerce.number().int().positive().optional() }).parse(request.query);
    const messages = service.repository.messages(conversationId, query.before);
    return { messages, nextCursor: messages.length === 50 ? messages[0]!.ordinal : null };
  });
  app.post(`${base}/messages`, (request, reply) => {
    const { projectId, conversationId } = request.params as Scope;
    const result = service.send(projectId, conversationId, sendSchema.parse(request.body));
    reply.status(202);
    return result;
  });
  app.post(`${base}/messages/:messageId/cancel`, (request) => {
    const { projectId, conversationId, messageId } = request.params as Scope;
    service.scope(projectId, conversationId);
    if (!service.repository.message(conversationId, messageId)) throw Object.assign(new Error('消息不存在'), { statusCode: 404 });
    service.cancel(conversationId, messageId);
    return service.snapshot(conversationId, messageId);
  });
  app.post(`${base}/messages/:messageId/note`, (request) => {
    const { projectId, conversationId, messageId } = request.params as Scope;
    return service.saveNote(projectId, conversationId, messageId);
  });
  app.post(`${base}/messages/:messageId/mindmap`, (request) => {
    const { projectId, conversationId, messageId } = request.params as Scope;
    return service.mindmap(projectId, conversationId, messageId);
  });
  app.post(`${base}/messages/:messageId/confirm`, (request) => {
    const { projectId, conversationId, messageId } = request.params as Scope;
    const body = z.object({ stepId: z.string() }).parse(request.body);
    return service.confirm(projectId, conversationId, messageId, body.stepId);
  });
  app.get(`${base}/messages/:messageId/events`, (request, reply) => {
    const { projectId, conversationId, messageId } = request.params as Scope;
    service.scope(projectId, conversationId);
    const message = service.snapshot(conversationId, messageId);
    if (!message || message.conversation_id !== conversationId) throw Object.assign(new Error('消息不存在'), { statusCode: 404 });
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let previous: typeof message | undefined;
    const write = (value: typeof message) => {
      if (reply.raw.destroyed) return;
      const event = !previous ? 'snapshot' : value.status !== previous.status ? 'status' : value.status === 'streaming' ? 'delta' : 'snapshot';
      const payload = event === 'delta' && value.markdown.startsWith(previous!.markdown)
        ? { id: value.id, conversation_id: value.conversation_id, sequence: value.sequence, delta: value.markdown.slice(previous!.markdown.length) }
        : value;
      reply.raw.write(`id: ${value.sequence}\nevent: ${'delta' in payload ? 'delta' : event === 'delta' ? 'snapshot' : event}\ndata: ${JSON.stringify(payload)}\n\n`);
      previous = value;
      if (!['pending', 'streaming'].includes(value.status)) reply.raw.end();
    };
    const unsubscribe = service.subscribe(messageId, write);
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n'); }, 15000);
    reply.raw.on('close', () => { unsubscribe(); clearInterval(heartbeat); });
    write(service.snapshot(conversationId, messageId)!);
  });
}
