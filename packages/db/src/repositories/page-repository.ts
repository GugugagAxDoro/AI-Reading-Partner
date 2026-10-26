import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface PageRecord {
  id: string;
  document_id: string;
  page_number: number;
  text: string;
  char_count: number;
  has_text: number;
  diagnostics_json: string;
}

export interface CreatePageInput {
  pageNumber: number;
  text: string;
  diagnostics?: Record<string, unknown>;
}

export class PageRepository {
  constructor(private readonly database: Database) {}

  replaceAll(documentId: string, pages: readonly CreatePageInput[]): void {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM pages WHERE document_id = ?').run(documentId);
      const statement = this.database.prepare(
        `INSERT INTO pages (id, document_id, page_number, text, char_count, has_text, diagnostics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const page of pages) {
        statement.run(
          randomUUID(),
          documentId,
          page.pageNumber,
          page.text,
          page.text.length,
          page.text.trim().length > 0 ? 1 : 0,
          JSON.stringify(page.diagnostics ?? {}),
        );
      }
    })();
  }

  list(documentId: string): PageRecord[] {
    return this.database
      .prepare('SELECT * FROM pages WHERE document_id = ? ORDER BY page_number')
      .all(documentId) as PageRecord[];
  }
}
