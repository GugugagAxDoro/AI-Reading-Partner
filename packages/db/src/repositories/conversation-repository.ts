import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface Conversation {
  id: string;
  project_id: string;
  document_id: string | null;
  document_hash: string;
  document_title: string;
  title: string;
  web_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  ordinal: number;
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  action: string;
  markdown: string;
  status: 'pending' | 'streaming' | 'completed' | 'cancelled' | 'failed';
  request_id: string | null;
  reply_to: string | null;
  retry_of: string | null;
  quote_json: string | null;
  parents_json: string;
  metadata_json: string;
  sequence: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class ConversationRepository {
  constructor(private readonly db: Database) {}

  create(projectId: string, documentId: string, title = '新会话'): Conversation {
    const document = this.db.prepare(`SELECT d.* FROM documents d JOIN project_documents p
      ON p.document_id=d.id WHERE p.project_id=? AND d.id=?`).get(projectId, documentId) as { hash: string; title: string } | undefined;
    if (!document) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO conversations
      (id,project_id,document_id,document_hash,document_title,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, projectId, documentId, document.hash, document.title, title, now, now);
    return this.get(projectId, id)!;
  }

  get(projectId: string, id: string): Conversation | undefined {
    return this.db.prepare('SELECT * FROM conversations WHERE project_id=? AND id=?').get(projectId, id) as Conversation | undefined;
  }

  list(projectId: string, documentId: string): Conversation[] {
    this.db.prepare(`UPDATE conversations SET document_id=? WHERE project_id=? AND document_id IS NULL
      AND document_hash=(SELECT hash FROM documents WHERE id=?)
      AND EXISTS(SELECT 1 FROM project_documents WHERE project_id=? AND document_id=?)`)
      .run(documentId, projectId, documentId, projectId, documentId);
    return this.db.prepare('SELECT * FROM conversations WHERE project_id=? AND document_id=? ORDER BY updated_at DESC, id')
      .all(projectId, documentId) as Conversation[];
  }

  touch(id: string, webEnabled?: boolean): void {
    this.db.prepare('UPDATE conversations SET updated_at=?, web_enabled=COALESCE(?, web_enabled) WHERE id=?')
      .run(new Date().toISOString(), webEnabled === undefined ? null : Number(webEnabled), id);
  }

  message(conversationId: string, id: string): ConversationMessage | undefined {
    return this.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? AND id=?')
      .get(conversationId, id) as ConversationMessage | undefined;
  }

  request(conversationId: string, requestId: string): ConversationMessage | undefined {
    return this.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? AND request_id=?')
      .get(conversationId, requestId) as ConversationMessage | undefined;
  }

  messages(conversationId: string, before?: number, limit = 50): ConversationMessage[] {
    return (this.db.prepare(`SELECT * FROM conversation_messages WHERE conversation_id=? AND ordinal<?
      ORDER BY ordinal DESC LIMIT ?`).all(conversationId, before ?? Number.MAX_SAFE_INTEGER, limit) as ConversationMessage[]).reverse();
  }

  enqueue(conversationId: string, input: {
    requestId: string; action: string; text: string; quote?: unknown; parents?: string[]; retryOf?: string;
  }): { user: ConversationMessage; assistant: ConversationMessage; existing: boolean } {
    return this.db.transaction(() => {
      const existing = this.request(conversationId, input.requestId);
      if (existing) return { user: existing, assistant: this.db.prepare('SELECT * FROM conversation_messages WHERE reply_to=?').get(existing.id) as ConversationMessage, existing: true };
      const active = this.db.prepare("SELECT id FROM conversation_messages WHERE conversation_id=? AND status IN ('pending','streaming')").get(conversationId);
      if (active) throw Object.assign(new Error('本会话已有正在生成的回答'), { statusCode: 409 });
      const now = new Date().toISOString();
      const userId = randomUUID();
      const answerId = randomUUID();
      const insert = this.db.prepare(`INSERT INTO conversation_messages
        (id,conversation_id,role,action,markdown,status,request_id,reply_to,retry_of,quote_json,parents_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const quote = input.quote ? JSON.stringify(input.quote) : null;
      const parents = JSON.stringify(input.parents ?? []);
      insert.run(userId, conversationId, 'user', input.action, input.text, 'completed', input.requestId, null, null, quote, parents, now, now);
      insert.run(answerId, conversationId, 'assistant', input.action, '', 'pending', null, userId, input.retryOf ?? null, quote, parents, now, now);
      this.touch(conversationId);
      return { user: this.message(conversationId, userId)!, assistant: this.message(conversationId, answerId)!, existing: false };
    })();
  }

  update(id: string, patch: { markdown: string; status: ConversationMessage['status']; metadata?: unknown; error?: string | null; sequence?: number }): void {
    this.db.prepare(`UPDATE conversation_messages SET markdown=?,status=?,metadata_json=COALESCE(?,metadata_json),error=?,
      sequence=MAX(sequence,?)+1,updated_at=? WHERE id=? AND status IN ('pending','streaming')`)
      .run(patch.markdown, patch.status, patch.metadata ? JSON.stringify(patch.metadata) : null, patch.error ?? null, patch.sequence ?? 0, new Date().toISOString(), id);
  }

  recover(): void {
    this.db.prepare(`UPDATE conversation_messages SET status='failed',error='服务重启中断了生成，请重试',sequence=sequence+1
      WHERE status IN ('pending','streaming')`).run();
  }

  metadata(conversationId: string, id: string, patch: Record<string, unknown>): ConversationMessage {
    const message = this.message(conversationId, id);
    if (!message) throw Object.assign(new Error('消息不存在'), { statusCode: 404 });
    this.db.prepare('UPDATE conversation_messages SET metadata_json=?,sequence=sequence+1 WHERE id=?')
      .run(JSON.stringify({ ...JSON.parse(message.metadata_json), ...patch }), id);
    return this.message(conversationId, id)!;
  }

  preference<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value_json FROM reader_preferences WHERE key=?').get(key) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as T : fallback;
  }

  setPreference(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO reader_preferences(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json')
      .run(key, JSON.stringify(value));
  }
}
