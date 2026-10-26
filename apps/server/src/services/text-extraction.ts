import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildChunks } from '@ai-reading-partner/core';
import { ChunkRepository, DocumentRepository, PageRepository, SectionRepository, type Database } from '@ai-reading-partner/db';
import { extractPdf, type ExtractedPdf } from '../processing/pdf-document';
import { PDF_TEXT_VERSION } from '../processing/pdf-unicode';
import { writeChunksJsonl, writePagesJsonl } from '../processing/page-serialization';

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
    if (metadata.textExtractionVersion === PDF_TEXT_VERSION &&
        (!repair?.mappings || existsSync(join(directory, 'reader.pdf')))) return;
    const extracted = await extractPdf(readFileSync(document.source_path));
    const sections = new SectionRepository(this.database).list(documentId);
    const chunks = buildChunks(sections.map(section => ({
      id: section.id, startPage: section.start_page, endPage: section.end_page,
    })), extracted.pages);
    writePagesJsonl(join(directory, 'pages.jsonl'), extracted.pages);
    writeChunksJsonl(join(directory, 'chunks.jsonl'), chunks);
    writeReaderPdf(directory, extracted);
    this.database.transaction(() => {
      new PageRepository(this.database).replaceAll(documentId, extracted.pages);
      new ChunkRepository(this.database).replaceAll(documentId, chunks);
      documents.updateProcessing(documentId, {
        metadata_json: JSON.stringify({ ...metadata, textExtractionVersion: PDF_TEXT_VERSION }),
        diagnostics_json: JSON.stringify({ ...diagnostics, unicodeRepair: extracted.unicodeRepair }),
      });
    })();
  }
}
