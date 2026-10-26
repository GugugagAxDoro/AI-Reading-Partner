import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export type SummaryScope = 'book' | 'section' | 'project';
export type SummaryStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface SummaryRecord {
  id: string;
  project_id: string | null;
  document_id: string | null;
  section_id: string | null;
  scope: SummaryScope;
  target_id: string;
  status: SummaryStatus;
  markdown: string | null;
  structure_json: string | null;
  prompt_version: string | null;
  model_id: string | null;
  provider_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveSummaryInput {
  scope: SummaryScope;
  targetId: string;
  projectId?: string | null;
  documentId?: string | null;
  sectionId?: string | null;
  status: SummaryStatus;
  markdown?: string | null;
  structure?: Record<string, unknown> | null;
  promptVersion?: string | null;
  modelId?: string | null;
  providerId?: string | null;
  error?: string | null;
}

export class SummaryRepository {
  constructor(private readonly database: Database) {}

  save(input: SaveSummaryInput): SummaryRecord {
    const now = new Date().toISOString();
    const existing = this.find(input.scope, input.targetId, input.projectId ?? null);
    if (existing) {
      this.database
        .prepare(
          `UPDATE summaries SET
             status = ?, markdown = ?, structure_json = ?, prompt_version = ?, model_id = ?,
             provider_id = ?, error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.status,
          input.markdown ?? null,
          input.structure ? JSON.stringify(input.structure) : null,
          input.promptVersion ?? null,
          input.modelId ?? null,
          input.providerId ?? null,
          input.error ?? null,
          now,
          existing.id,
        );
      return this.get(existing.id)!;
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO summaries (
           id, project_id, document_id, section_id, scope, target_id, status, markdown,
           structure_json, prompt_version, model_id, provider_id, error, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId ?? null,
        input.documentId ?? null,
        input.sectionId ?? null,
        input.scope,
        input.targetId,
        input.status,
        input.markdown ?? null,
        input.structure ? JSON.stringify(input.structure) : null,
        input.promptVersion ?? null,
        input.modelId ?? null,
        input.providerId ?? null,
        input.error ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  find(scope: SummaryScope, targetId: string, projectId?: string | null): SummaryRecord | undefined {
    return this.database
      .prepare(
        `SELECT * FROM summaries
         WHERE scope = ? AND target_id = ? AND (project_id IS ? OR project_id = ?)`,
      )
      .get(scope, targetId, projectId ?? null, projectId ?? null) as SummaryRecord | undefined;
  }

  get(id: string): SummaryRecord | undefined {
    return this.database.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as SummaryRecord | undefined;
  }

  listByDocument(documentId: string): SummaryRecord[] {
    return this.database
      .prepare('SELECT * FROM summaries WHERE document_id = ? ORDER BY updated_at DESC')
      .all(documentId) as SummaryRecord[];
  }
}
