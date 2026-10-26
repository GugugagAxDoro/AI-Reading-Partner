import { randomUUID } from 'node:crypto';
import type { Database } from '../database';
import { tokenForIndex } from '@ai-reading-partner/core';

export interface ChunkRecord {
  id: string;
  document_id: string;
  section_id: string | null;
  page_number: number;
  ordinal: number;
  text: string;
  normalized_text: string;
  token_estimate: number;
  char_start: number | null;
  char_end: number | null;
  metadata_json: string;
}

export interface CreateChunkInput {
  sectionId?: string | null;
  pageNumber: number;
  text: string;
  normalizedText: string;
  tokenEstimate: number;
  charStart?: number | null;
  charEnd?: number | null;
  metadata?: Record<string, unknown>;
}

export class ChunkRepository {
  constructor(private readonly database: Database) {}

  replaceAll(documentId: string, chunks: readonly CreateChunkInput[]): ChunkRecord[] {
    const rows: ChunkRecord[] = [];
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM chunks_fts WHERE document_id = ?').run(documentId);
      this.database.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
      const insert = this.database.prepare(
        `INSERT INTO chunks (
           id, document_id, section_id, page_number, ordinal, text, normalized_text,
           token_estimate, char_start, char_end, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.database.prepare(
        `INSERT INTO chunks_fts (
           chunk_id, document_id, section_id, page_number, text, normalized_text
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );

      chunks.forEach((chunk, index) => {
        const id = randomUUID();
        const metadata = JSON.stringify(chunk.metadata ?? {});
        insert.run(
          id,
          documentId,
          chunk.sectionId ?? null,
          chunk.pageNumber,
          index,
          chunk.text,
          chunk.normalizedText,
          chunk.tokenEstimate,
          chunk.charStart ?? null,
          chunk.charEnd ?? null,
          metadata,
        );
        insertFts.run(
          id,
          documentId,
          chunk.sectionId ?? null,
          chunk.pageNumber,
          chunk.text,
          tokenForIndex(chunk.normalizedText),
        );
        rows.push({
          id,
          document_id: documentId,
          section_id: chunk.sectionId ?? null,
          page_number: chunk.pageNumber,
          ordinal: index,
          text: chunk.text,
          normalized_text: chunk.normalizedText,
          token_estimate: chunk.tokenEstimate,
          char_start: chunk.charStart ?? null,
          char_end: chunk.charEnd ?? null,
          metadata_json: metadata,
        });
      });
    })();
    return rows;
  }

  list(documentId: string): ChunkRecord[] {
    return this.database
      .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY ordinal')
      .all(documentId) as ChunkRecord[];
  }

  listBySection(sectionId: string): ChunkRecord[] {
    return this.database
      .prepare('SELECT * FROM chunks WHERE section_id = ? ORDER BY ordinal')
      .all(sectionId) as ChunkRecord[];
  }
}
