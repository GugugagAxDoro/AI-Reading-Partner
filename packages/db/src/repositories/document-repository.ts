import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface DocumentRecord {
  id: string;
  hash: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  title: string;
  author: string | null;
  page_count: number;
  cover_path: string | null;
  source_path: string;
  text_layer: 'text' | 'mixed' | 'scanned' | 'unknown';
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  processing_stage: string;
  processing_error: string | null;
  metadata_json: string;
  diagnostics_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectDocument extends DocumentRecord {
  project_id: string;
  added_at: string;
  current_page: number;
  scroll_offset: number;
  percent: number;
  progress_updated_at: string | null;
}

export interface CreateDocumentInput {
  hash: string;
  filename: string;
  title: string;
  author?: string | null;
  pageCount?: number;
  sourcePath: string;
  sizeBytes: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export class DocumentRepository {
  constructor(
    private readonly database: Database,
    private readonly _dataRoot: string,
  ) {}

  findByHash(hash: string): DocumentRecord | undefined {
    return this.database.prepare('SELECT * FROM documents WHERE hash = ?').get(hash) as DocumentRecord | undefined;
  }

  create(input: CreateDocumentInput): DocumentRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO documents (
           id, hash, filename, mime_type, size_bytes, title, author, page_count,
           source_path, metadata_json, processing_status, processing_stage,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'received', ?, ?)`,
      )
      .run(
        id,
        input.hash,
        input.filename,
        input.mimeType ?? 'application/pdf',
        input.sizeBytes,
        input.title,
        input.author ?? null,
        input.pageCount ?? 0,
        input.sourcePath,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): DocumentRecord | undefined {
    return this.database.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRecord | undefined;
  }

  addToProject(projectId: string, documentId: string): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO project_documents (project_id, document_id, added_at)
         VALUES (?, ?, ?)`,
      )
      .run(projectId, documentId, new Date().toISOString());
  }

  listByProject(projectId: string): ProjectDocument[] {
    return this.database
      .prepare(
        `SELECT d.*, pd.project_id, pd.added_at,
                COALESCE(rp.current_page, 1) AS current_page,
                COALESCE(rp.scroll_offset, 0) AS scroll_offset,
                COALESCE(rp.percent, 0) AS percent,
                rp.updated_at AS progress_updated_at
         FROM project_documents pd
         JOIN documents d ON d.id = pd.document_id
         LEFT JOIN reading_progress rp
           ON rp.project_id = pd.project_id AND rp.document_id = pd.document_id
         WHERE pd.project_id = ?
         ORDER BY pd.added_at DESC`,
      )
      .all(projectId) as ProjectDocument[];
  }

  getFromProject(projectId: string, documentId: string): ProjectDocument | undefined {
    return this.listByProject(projectId).find((document) => document.id === documentId);
  }

  updateProcessing(
    documentId: string,
    update: Partial<Pick<DocumentRecord, 'processing_status' | 'processing_stage' | 'processing_error' | 'title' | 'author' | 'page_count' | 'cover_path' | 'text_layer' | 'metadata_json' | 'diagnostics_json'>>,
  ): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), documentId);
    this.database.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  removeFromProject(projectId: string, documentId: string): boolean {
    return this.database
      .prepare('DELETE FROM project_documents WHERE project_id = ? AND document_id = ?')
      .run(projectId, documentId).changes > 0;
  }

  projectReferenceCount(documentId: string): number {
    return Number(
      (this.database.prepare('SELECT COUNT(*) AS count FROM project_documents WHERE document_id = ?').get(documentId) as {
        count?: number;
      }).count ?? 0,
    );
  }

  deletePermanent(documentId: string): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          `DELETE FROM content_cache WHERE document_id = ?
           AND id NOT IN (SELECT id FROM content_cache WHERE document_id != ?)`,
        )
        .run(documentId, documentId);
      this.database
        .prepare('DELETE FROM annotations WHERE document_id = ?')
        .run(documentId);
      this.database
        .prepare(
          `UPDATE note_links SET target_status = 'missing_source'
           WHERE target_type IN ('doc', 'section') AND target_id = ?`,
        )
        .run(documentId);
      this.database.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
    })();
  }
}
