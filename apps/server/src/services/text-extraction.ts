import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildChunks, CHUNK_POSITION_VERSION } from '@ai-reading-partner/core';
import { ChunkRepository, DocumentRepository, PageRepository, SectionRepository, type Database } from '@ai-reading-partner/db';
import { extractPdf, type ExtractedPdf } from '../processing/pdf-document';
import { PDF_TEXT_VERSION } from '../processing/pdf-unicode';
import { writeChunksJsonl, writePagesJsonl } from '../processing/page-serialization';
import { resolveSourcePositions } from './source-positions';

export function writeReaderPdf(directory: string, extracted: ExtractedPdf): void {
  if (!extracted.readerPdf) return;
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'reader.pdf');
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, extracted.readerPdf);
  renameSync(temporary, path);
}

export class TextExtractionService {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly database: Database, private readonly dataRoot: string) {}

  ensure(documentId: string): Promise<void> {
    const active = this.pending.get(documentId);
    if (active) return active;
    const task = this.refresh(documentId).finally(() => this.pending.delete(documentId));
    this.pending.set(documentId, task);
    return task;
  }

  private async refresh(documentId: string): Promise<void> {
    const documents = new DocumentRepository(this.database, this.dataRoot);
    const document = documents.get(documentId);
    if (!document || document.processing_status !== 'ready') return;
    const metadata = JSON.parse(document.metadata_json) as Record<string, unknown>;
    const directory = join(dirname(document.source_path), 'extracted');
    const diagnostics = JSON.parse(document.diagnostics_json) as Record<string, unknown>;
    const repair = diagnostics.unicodeRepair as { mappings?: number } | undefined;
    const textCurrent = metadata.textExtractionVersion === PDF_TEXT_VERSION && (!repair?.mappings || existsSync(join(directory, 'reader.pdf')));
    const chunkRepository = new ChunkRepository(this.database);
    const existingChunks = chunkRepository.list(documentId);
    const positionsCurrent = metadata.chunkPositionVersion === CHUNK_POSITION_VERSION || existingChunks.length > 0 && existingChunks.every(chunk => JSON.parse(chunk.metadata_json).position_version === CHUNK_POSITION_VERSION);
    if (textCurrent && positionsCurrent) return;
    const backups = join(this.dataRoot, 'backups', 'source-positions', documentId);
    mkdirSync(backups, { recursive: true });
    const databaseBackup = join(backups, 'before-page-spans-v2.db');
    if (!existsSync(databaseBackup)) {
      await this.database.backup(databaseBackup);
      if (existsSync(join(directory, 'chunks.jsonl'))) copyFileSync(join(directory, 'chunks.jsonl'), join(backups, 'chunks.jsonl'));
    }
    const extracted = textCurrent ? null : await extractPdf(readFileSync(document.source_path));
    const pages = extracted?.pages ?? new PageRepository(this.database).list(documentId).map(page => ({ pageNumber: page.page_number, text: page.text }));
    const sections = new SectionRepository(this.database).list(documentId);
    const chunks = buildChunks(sections.map(section => ({
      id: section.id, startPage: section.start_page, endPage: section.end_page,
    })), pages);
    mkdirSync(directory, { recursive: true });
    if (extracted) writePagesJsonl(join(directory, 'pages.jsonl'), extracted.pages);
    writeChunksJsonl(join(directory, 'chunks.jsonl'), chunks);
    if (extracted) writeReaderPdf(directory, extracted);
    this.database.transaction(() => {
      if (extracted) new PageRepository(this.database).replaceAll(documentId, extracted.pages);
      new ChunkRepository(this.database).replaceAll(documentId, chunks);
      documents.updateProcessing(documentId, {
        metadata_json: JSON.stringify({ ...metadata, textExtractionVersion: PDF_TEXT_VERSION, chunkPositionVersion: CHUNK_POSITION_VERSION }),
        diagnostics_json: JSON.stringify({ ...diagnostics, ...(extracted ? { unicodeRepair: extracted.unicodeRepair } : {}) }),
      });
    })();
    const projects = this.database.prepare('SELECT project_id FROM project_documents WHERE document_id=?').all(documentId) as Array<{ project_id: string }>;
    const resolutions = projects.flatMap(({ project_id: projectId }) => {
      const rows = this.database.prepare(`SELECT m.id,m.metadata_json AS payload,'record' AS kind FROM conversation_messages m
        JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=?
        UNION ALL SELECT id,sources_json,'sources' FROM term_cache WHERE project_id=?
        UNION ALL SELECT id,sources_json,'sources' FROM content_cache WHERE project_id=?
        UNION ALL SELECT id,payload_json,'record' FROM term_variants WHERE project_id=?
        UNION ALL SELECT id,structure_json,'record' FROM summaries WHERE project_id=? OR (project_id IS NULL AND document_id=?)`)
        .all(projectId, projectId, projectId, projectId, projectId, documentId) as Array<{ id: string; payload: string | null; kind: string }>;
      return rows.flatMap(row => {
        try {
          const value = JSON.parse(row.payload ?? '{}');
          const original = (row.kind === 'sources' ? value : value.sources ?? value.references ?? JSON.parse(value.sources_json ?? '[]')) as import('@ai-reading-partner/core').SourceReference[];
          const sources = original.filter(source => source.documentId === documentId);
          return sources.length ? [{ recordId: row.id, projectId, original: sources, resolved: resolveSourcePositions(this.database, projectId, sources) }] : [];
        } catch { return []; }
      });
    });
    writeFileSync(join(backups, 'reference-resolutions.json'), JSON.stringify({ version: CHUNK_POSITION_VERSION, resolutions }, null, 2));
  }
}
