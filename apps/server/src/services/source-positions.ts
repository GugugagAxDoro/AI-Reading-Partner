import { chunkReferencePosition, type SourceReference } from '@ai-reading-partner/core';
import type { Database } from '@ai-reading-partner/db';

export function resolveSourcePositions(database: Database, projectId: string, sources: SourceReference[]): SourceReference[] {
  return sources.map(source => {
    if (source.source !== 'document') return source;
    if (!source.documentId || !database.prepare('SELECT 1 FROM project_documents WHERE project_id=? AND document_id=?').get(projectId, source.documentId)) return { ...source, missing: true, locationStatus: 'unverified' };
    if (source.locationStatus === 'verified') return source;
    const chunk = source.anchor ? database.prepare('SELECT page_number, metadata_json, char_start, char_end FROM chunks WHERE document_id=? AND id=?').get(source.documentId, source.anchor) as Parameters<typeof chunkReferencePosition>[0] | undefined : undefined;
    if (chunk) {
      const position = chunkReferencePosition(chunk);
      if (position.locationStatus === 'verified') return { ...source, ...position };
    }
    const excerpt = source.excerpt?.replace(/\s/gu, '') ?? '';
    if (!excerpt || excerpt.includes('[见选中文本]')) return { ...source, locationStatus: 'unverified' };
    const pages = database.prepare('SELECT page_number,text FROM pages WHERE document_id=? ORDER BY page_number').all(source.documentId) as Array<{ page_number: number; text: string }>;
    const mapping: Array<{ page: number; offset: number }> = [];
    let text = '';
    for (const page of pages) for (let offset = 0; offset < page.text.length; offset++) {
      if (/\s/u.test(page.text[offset]!)) continue;
      text += page.text[offset]; mapping.push({ page: page.page_number, offset });
    }
    const first = text.indexOf(excerpt);
    if (first < 0) return { ...source, locationStatus: 'unverified' };
    if (text.indexOf(excerpt, first + 1) >= 0) return { ...source, locationStatus: 'ambiguous' };
    const start = mapping[first]!; const end = mapping[first + excerpt.length - 1]!;
    return { ...source, page: start.page, endPage: end.page, startOffset: start.offset, endOffset: end.offset + 1, locationStatus: 'verified' };
  });
}
