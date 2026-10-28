import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface TermCacheRecord {
  id: string;
  project_id: string;
  normalized_term: string;
  display_term: string;
  explanation: string;
  sources_json: string;
  prompt_version: string | null;
  model_id: string | null;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentCacheRecord {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number;
  action: string;
  instruction_hash: string;
  normalized_text: string;
  selection_hash: string;
  answer: string;
  sources_json: string;
  prompt_version: string | null;
  model_id: string | null;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebCacheRecord {
  id: string;
  project_id: string;
  url: string;
  query_hash: string;
  title: string | null;
  content: string | null;
  summary: string | null;
  status: 'ready' | 'stale' | 'failed';
  source_metadata_json: string;
  fetched_at: string;
  expires_at: string;
}

export interface CachedTerm {
  id: string;
  normalized_term: string;
  display_term: string;
  explanation: string;
  sources_json: string;
  created_at: string;
  updated_at: string;
}

export interface CachedContent {
  id: string;
  document_id: string;
  page_number: number;
  action: string;
  normalized_text: string;
  selection_hash: string;
  answer: string;
  sources_json: string;
  created_at: string;
  updated_at: string;
}

export class CacheRepository {
  constructor(private readonly database: Database) {}

  findVariant(projectId: string, term: string, compatibility: string): TermCacheRecord | undefined {
    const row = this.database.prepare('SELECT payload_json FROM term_variants WHERE project_id=? AND normalized_term=? AND compatibility=? ORDER BY created_at DESC LIMIT 1')
      .get(projectId, term, compatibility) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as TermCacheRecord : undefined;
  }

  saveVariant(input: Parameters<CacheRepository['saveTerm']>[0] & { compatibility: string }): TermCacheRecord {
    const now = new Date().toISOString();
    const record: TermCacheRecord = { id: randomUUID(), project_id: input.projectId, normalized_term: input.normalizedTerm,
      display_term: input.displayTerm, explanation: input.explanation, sources_json: JSON.stringify(input.sources ?? []),
      prompt_version: input.promptVersion ?? null, model_id: input.modelId ?? null, provider_id: input.providerId ?? null, created_at: now, updated_at: now };
    this.database.prepare('INSERT INTO term_variants(id,project_id,normalized_term,compatibility,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(record.id, input.projectId, input.normalizedTerm, input.compatibility, JSON.stringify(record), now);
    if (!this.findTerm(input.projectId, input.normalizedTerm)) this.saveTerm(input);
    return record;
  }

  findTerm(projectId: string, normalizedTerm: string): TermCacheRecord | undefined {
    return this.database
      .prepare('SELECT * FROM term_cache WHERE project_id = ? AND normalized_term = ?')
      .get(projectId, normalizedTerm) as TermCacheRecord | undefined;
  }

  saveTerm(input: {
    projectId: string;
    normalizedTerm: string;
    displayTerm: string;
    explanation: string;
    sources?: unknown[];
    promptVersion?: string | null;
    modelId?: string | null;
    providerId?: string | null;
  }): TermCacheRecord {
    const existing = this.findTerm(input.projectId, input.normalizedTerm);
    const now = new Date().toISOString();
    if (existing) {
      this.database
        .prepare(
          `UPDATE term_cache SET display_term = ?, explanation = ?, sources_json = ?,
             prompt_version = ?, model_id = ?, provider_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.displayTerm,
          input.explanation,
          JSON.stringify(input.sources ?? []),
          input.promptVersion ?? null,
          input.modelId ?? null,
          input.providerId ?? null,
          now,
          existing.id,
        );
      return this.findTerm(input.projectId, input.normalizedTerm)!;
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO term_cache (
           id, project_id, normalized_term, display_term, explanation, sources_json,
           prompt_version, model_id, provider_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.normalizedTerm,
        input.displayTerm,
        input.explanation,
        JSON.stringify(input.sources ?? []),
        input.promptVersion ?? null,
        input.modelId ?? null,
        input.providerId ?? null,
        now,
        now,
      );
    return this.findTerm(input.projectId, input.normalizedTerm)!;
  }

  findContent(input: {
    projectId: string;
    documentId: string;
    pageNumber: number;
    action: string;
    instructionHash: string;
    selectionHash: string;
  }): ContentCacheRecord | undefined {
    return this.database
      .prepare(
        `SELECT * FROM content_cache
         WHERE project_id = ? AND document_id = ? AND page_number = ? AND action = ?
           AND instruction_hash = ? AND selection_hash = ?`,
      )
      .get(
        input.projectId,
        input.documentId,
        input.pageNumber,
        input.action,
        input.instructionHash,
        input.selectionHash,
      ) as ContentCacheRecord | undefined;
  }

  saveContent(input: {
    projectId: string;
    documentId: string;
    pageNumber: number;
    action: string;
    instructionHash: string;
    normalizedText: string;
    selectionHash: string;
    answer: string;
    sources?: unknown[];
    promptVersion?: string | null;
    modelId?: string | null;
    providerId?: string | null;
  }): ContentCacheRecord {
    const existing = this.findContent(input);
    const now = new Date().toISOString();
    if (existing) {
      this.database
        .prepare(
          `UPDATE content_cache SET answer = ?, sources_json = ?, prompt_version = ?,
             model_id = ?, provider_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.answer,
          JSON.stringify(input.sources ?? []),
          input.promptVersion ?? null,
          input.modelId ?? null,
          input.providerId ?? null,
          now,
          existing.id,
        );
      return this.findContent(input)!;
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO content_cache (
           id, project_id, document_id, page_number, action, instruction_hash, normalized_text,
           selection_hash, answer, sources_json, prompt_version, model_id, provider_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.documentId,
        input.pageNumber,
        input.action,
        input.instructionHash,
        input.normalizedText,
        input.selectionHash,
        input.answer,
        JSON.stringify(input.sources ?? []),
        input.promptVersion ?? null,
        input.modelId ?? null,
        input.providerId ?? null,
        now,
        now,
      );
    return this.findContent(input)!;
  }

  listTerms(projectId: string): CachedTerm[] {
    const legacy = this.database
      .prepare(
        `SELECT id, normalized_term, display_term, explanation, sources_json, created_at, updated_at
         FROM term_cache
         WHERE project_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(projectId) as CachedTerm[];
    const variants = this.database.prepare('SELECT normalized_term,compatibility,payload_json FROM term_variants WHERE project_id=? ORDER BY created_at DESC,rowid DESC')
      .all(projectId) as Array<{ normalized_term: string; compatibility: string; payload_json: string }>;
    const seen = new Set<string>();
    const current = variants.filter((item) => {
      const key = `${item.normalized_term}:${item.compatibility}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map((item) => JSON.parse(item.payload_json) as CachedTerm);
    return [...current.filter((variant) => !legacy.some((item) => item.normalized_term === variant.normalized_term && item.explanation === variant.explanation && item.sources_json === variant.sources_json)), ...legacy];
  }

  listContent(projectId: string, documentId?: string | null): CachedContent[] {
    const conditions = ['project_id = ?'];
    const values: unknown[] = [projectId];
    if (documentId) {
      conditions.push('document_id = ?');
      values.push(documentId);
    }
    return this.database
      .prepare(
        `SELECT id, document_id, page_number, action, normalized_text, selection_hash, answer, sources_json, created_at, updated_at
         FROM content_cache
         WHERE ${conditions.join(' AND ')}
         ORDER BY updated_at DESC`,
      )
      .all(...values) as CachedContent[];
  }

  findWeb(projectId: string, url: string, queryHash: string): WebCacheRecord | undefined {
    return this.database
      .prepare('SELECT * FROM web_cache WHERE project_id = ? AND url = ? AND query_hash = ?')
      .get(projectId, url, queryHash) as WebCacheRecord | undefined;
  }

  saveWeb(input: {
    projectId: string;
    url: string;
    queryHash: string;
    title?: string | null;
    content?: string | null;
    summary?: string | null;
    status?: WebCacheRecord['status'];
    sourceMetadata?: Record<string, unknown>;
    retentionDays?: number;
  }): WebCacheRecord {
    const now = new Date();
    const retentionDays = input.retentionDays ?? 180;
    const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT OR REPLACE INTO web_cache (
           id, project_id, url, query_hash, title, content, summary, status,
           source_metadata_json, fetched_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.url,
        input.queryHash,
        input.title ?? null,
        input.content ?? null,
        input.summary ?? null,
        input.status ?? 'ready',
        JSON.stringify(input.sourceMetadata ?? {}),
        now.toISOString(),
        expiresAt,
      );
    return this.findWeb(input.projectId, input.url, input.queryHash)!;
  }

  listWeb(projectId: string): WebCacheRecord[] {
    return this.database
      .prepare('SELECT * FROM web_cache WHERE project_id = ? ORDER BY fetched_at DESC')
      .all(projectId) as WebCacheRecord[];
  }

  markStaleExpired(now = new Date()): number {
    return this.database
      .prepare(`UPDATE web_cache SET status = 'stale' WHERE status = 'ready' AND expires_at <= ?`)
      .run(now.toISOString()).changes;
  }

  clearExpired(now = new Date()): number {
    return this.database.prepare("UPDATE web_cache SET content=NULL,summary=NULL,status='stale' WHERE expires_at<=? AND (content IS NOT NULL OR summary IS NOT NULL OR status!='stale')")
      .run(now.toISOString()).changes;
  }

  clearTermCache(projectId: string): number {
    return this.database.transaction(() => {
      const variants = this.database.prepare('DELETE FROM term_variants WHERE project_id=?').run(projectId).changes;
      return this.database.prepare('DELETE FROM term_cache WHERE project_id = ?').run(projectId).changes + variants;
    })();
  }

  clearContentCache(projectId: string): number {
    return this.database.prepare('DELETE FROM content_cache WHERE project_id = ?').run(projectId).changes;
  }

  clearWebCache(projectId: string, options: { expiredOnly?: boolean } = {}): number {
    if (options.expiredOnly) {
      return this.database
        .prepare("UPDATE web_cache SET content=NULL,summary=NULL,status='stale' WHERE project_id=? AND expires_at<=? AND (content IS NOT NULL OR summary IS NOT NULL OR status!='stale')")
        .run(projectId, new Date().toISOString()).changes;
    }
    return this.database.prepare('DELETE FROM web_cache WHERE project_id = ?').run(projectId).changes;
  }
}
