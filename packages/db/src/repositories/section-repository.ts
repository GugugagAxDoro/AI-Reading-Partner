import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface SectionRecord {
  id: string;
  document_id: string;
  parent_id: string | null;
  level: number;
  ordinal: number;
  title: string;
  start_page: number;
  end_page: number;
  start_offset: number | null;
  end_offset: number | null;
  source: string;
}

export interface CreateSectionInput {
  parentId?: string | null;
  level: number;
  title: string;
  startPage: number;
  endPage: number;
  startOffset?: number | null;
  endOffset?: number | null;
  source?: string;
}

export class SectionRepository {
  constructor(private readonly database: Database) {}

  replaceAll(documentId: string, sections: readonly CreateSectionInput[]): SectionRecord[] {
    const insert = this.database.prepare(
      `INSERT INTO sections (
         id, document_id, parent_id, level, ordinal, title, start_page, end_page,
         start_offset, end_offset, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rows: SectionRecord[] = [];
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM sections WHERE document_id = ?').run(documentId);
      sections.forEach((section, index) => {
        const id = randomUUID();
        insert.run(
          id,
          documentId,
          section.parentId ?? null,
          section.level,
          index,
          section.title,
          section.startPage,
          section.endPage,
          section.startOffset ?? null,
          section.endOffset ?? null,
          section.source ?? 'native_outline',
        );
        rows.push({
          id,
          document_id: documentId,
          parent_id: section.parentId ?? null,
          level: section.level,
          ordinal: index,
          title: section.title,
          start_page: section.startPage,
          end_page: section.endPage,
          start_offset: section.startOffset ?? null,
          end_offset: section.endOffset ?? null,
          source: section.source ?? 'native_outline',
        });
      });
    })();
    return rows;
  }

  list(documentId: string): SectionRecord[] {
    return this.database
      .prepare('SELECT * FROM sections WHERE document_id = ? ORDER BY ordinal')
      .all(documentId) as SectionRecord[];
  }
}
