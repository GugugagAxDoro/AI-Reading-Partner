import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BuiltChunk } from '@ai-reading-partner/core';
import type { ExtractedPage } from './pdf-document';

export function writePagesJsonl(pagesPath: string, pages: readonly ExtractedPage[]): void {
  mkdirSync(dirname(pagesPath), { recursive: true });
  const content = pages
    .map((page) => JSON.stringify({ page_number: page.pageNumber, text: page.text, char_count: page.charCount }))
    .join('\n');
  writeFileSync(pagesPath, content ? `${content}\n` : '', 'utf8');
}

export function writeChunksJsonl(chunksPath: string, chunks: readonly BuiltChunk[]): void {
  mkdirSync(dirname(chunksPath), { recursive: true });
  const content = chunks
    .map((chunk) =>
      JSON.stringify({
        page_number: chunk.pageNumber,
        section_id: chunk.sectionId,
        text: chunk.text,
        normalized_text: chunk.normalizedText,
        token_estimate: chunk.tokenEstimate,
        metadata: chunk.metadata,
      }),
    )
    .join('\n');
  writeFileSync(chunksPath, content ? `${content}\n` : '', 'utf8');
}
