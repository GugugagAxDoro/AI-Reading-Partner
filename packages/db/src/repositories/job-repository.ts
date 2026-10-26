import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface JobRecord {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'cancelled';
  project_id: string | null;
  document_id: string | null;
  section_id: string | null;
  progress: number;
  total: number;
  stage: string | null;
  error: string | null;
  retry_count: number;
  payload_json: string;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
}

export class JobRepository {
  constructor(private readonly database: Database) {}

  enqueue(input: {
    type: string;
    projectId?: string | null;
    documentId?: string | null;
    sectionId?: string | null;
    total?: number;
    stage?: string | null;
    payload?: Record<string, unknown>;
  }): JobRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO jobs (id, type, project_id, document_id, section_id, total, stage, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.projectId ?? null,
        input.documentId ?? null,
        input.sectionId ?? null,
        input.total ?? 1,
        input.stage ?? null,
        JSON.stringify(input.payload ?? {}),
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): JobRecord | undefined {
    return this.database.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRecord | undefined;
  }

  list(options: { projectId?: string; documentId?: string } = {}): JobRecord[] {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options.projectId) {
      conditions.push('project_id = ?');
      values.push(options.projectId);
    }
    if (options.documentId) {
      conditions.push('document_id = ?');
      values.push(options.documentId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.database.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC`).all(...values) as JobRecord[];
  }

  update(id: string, update: Partial<Omit<JobRecord, 'id' | 'created_at'>>): JobRecord | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) continue;
      fields.push(`${key} = ?`);
      values.push(typeof value === 'boolean' ? Number(value) : value);
    }
    if (fields.length === 0) return this.get(id);
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    this.database.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.get(id);
  }
}
