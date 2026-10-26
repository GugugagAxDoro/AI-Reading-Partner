import type { Database } from '../database';

export interface ReadingProgressRecord {
  project_id: string;
  document_id: string;
  current_page: number;
  scroll_offset: number;
  percent: number;
  updated_at: string;
}

export class ProgressRepository {
  constructor(private readonly database: Database) {}

  get(projectId: string, documentId: string): ReadingProgressRecord | undefined {
    return this.database
      .prepare('SELECT * FROM reading_progress WHERE project_id = ? AND document_id = ?')
      .get(projectId, documentId) as ReadingProgressRecord | undefined;
  }

  save(input: {
    projectId: string;
    documentId: string;
    currentPage: number;
    scrollOffset?: number;
    percent?: number;
  }): ReadingProgressRecord {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO reading_progress (project_id, document_id, current_page, scroll_offset, percent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, document_id) DO UPDATE SET
           current_page = excluded.current_page,
           scroll_offset = excluded.scroll_offset,
           percent = excluded.percent,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        input.documentId,
        input.currentPage,
        input.scrollOffset ?? 0,
        input.percent ?? 0,
        now,
      );
    return this.get(input.projectId, input.documentId)!;
  }
}
