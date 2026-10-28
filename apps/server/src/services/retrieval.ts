import { tokenForIndex } from '@ai-reading-partner/core';
import type { Database } from '@ai-reading-partner/db';

export interface RetrievedChunk {
  id: string;
  document_id: string;
  section_id: string | null;
  page_number: number;
  text: string;
  token_estimate: number;
  metadata_json?: string;
  char_start?: number | null;
  char_end?: number | null;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  currentDocumentId?: string | null;
  currentPage?: number | null;
  currentSectionId?: string | null;
}

export class RetrievalService {
  constructor(private readonly database: Database) {}

  searchCurrent(documentId: string, query: string, options: SearchOptions = {}): RetrievedChunk[] {
    const matchQuery = buildFtsQuery(query);
    if (!matchQuery) return [];
    const limit = Math.min(Math.max(1, options.limit ?? 5), 20);
    const rows = this.database
      .prepare(
        `SELECT c.id, c.document_id, c.section_id, c.page_number, c.text, c.token_estimate, c.metadata_json, c.char_start, c.char_end,
                bm25(chunks_fts) AS bm25_rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.chunk_id
         WHERE chunks_fts MATCH ? AND c.document_id = ?
         ORDER BY bm25_rank
         LIMIT ?`,
      )
      .all(matchQuery, documentId, limit * 2) as Array<RetrievedChunk & { bm25_rank: number }>;

    return rows
      .map((row) => ({
        ...row,
        score: applyBoosts(-row.bm25_rank, options, row),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  searchProject(
    projectId: string,
    query: string,
    options: SearchOptions = {},
  ): { current: RetrievedChunk[]; other: RetrievedChunk[] } {
    const currentDocumentId = options.currentDocumentId ?? null;
    const current = currentDocumentId ? this.searchCurrent(currentDocumentId, query, options) : [];

    const matchQuery = buildFtsQuery(query);
    const limit = Math.min(Math.max(1, options.limit ?? 5), 20);
    if (!matchQuery) return { current, other: [] };
    const rows = this.database
      .prepare(
        `SELECT c.id, c.document_id, c.section_id, c.page_number, c.text, c.token_estimate, c.metadata_json, c.char_start, c.char_end,
                bm25(chunks_fts) AS bm25_rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.chunk_id
         JOIN project_documents pd ON pd.document_id = c.document_id
         WHERE chunks_fts MATCH ? AND pd.project_id = ?
           ${currentDocumentId ? 'AND c.document_id != ?' : ''}
         ORDER BY bm25_rank
         LIMIT ?`,
      )
      .all(...(currentDocumentId ? [matchQuery, projectId, currentDocumentId] : [matchQuery, projectId]), limit) as Array<RetrievedChunk & { bm25_rank: number }>;

    const other = rows
      .map((row) => ({ ...row, score: -row.bm25_rank }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { current, other };
  }
}

function applyBoosts(baseScore: number, options: SearchOptions, row: RetrievedChunk): number {
  let score = baseScore;
  if (options.currentPage && row.page_number === options.currentPage) score += 1;
  if (options.currentSectionId && row.section_id === options.currentSectionId) score += 0.5;
  return score;
}

function buildFtsQuery(query: string): string {
  const tokens = tokenForIndex(query)
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 24);
  if (tokens.length === 0) return '';
  return tokens.map((token) => `"${token}"`).join(' OR ');
}
