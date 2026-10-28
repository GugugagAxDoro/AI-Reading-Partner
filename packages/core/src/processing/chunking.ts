import { estimateTokens, normalizeSearchText } from './retrieval';
import { createNormalizedHash } from './text';

export const CHUNK_POSITION_VERSION = 'page-spans-v2';
export interface ChunkSourceSection { id: string | null; startPage: number; endPage: number }
export interface ChunkSourcePage { pageNumber: number; text: string }
export interface ChunkPageSpan { page: number; start: number; end: number; chunkStart: number; chunkEnd: number }
export interface BuiltChunk {
  sectionId: string | null;
  pageNumber: number;
  text: string;
  normalizedText: string;
  tokenEstimate: number;
  charStart: number | null;
  charEnd: number | null;
  metadata: Record<string, unknown>;
}
export interface BuildChunksOptions { maxChars?: number; overlapChars?: number }

function mappedPage(page: ChunkSourcePage) {
  const characters: Array<{ text: string; start: number; end: number }> = [];
  for (const match of page.text.matchAll(/\r\n?|[ \t]+|[^\r \t]/gu)) {
    const text = match[0].startsWith('\r') ? '\n' : /^[ \t]/u.test(match[0]) ? ' ' : match[0];
    const previous = characters.at(-1);
    if (text === '\n' && previous?.text === '\n' && characters.at(-2)?.text === '\n') previous.end = match.index + match[0].length;
    else characters.push({ text, start: match.index, end: match.index + match[0].length });
  }
  while (characters.length && !characters[0]!.text.trim()) characters.shift();
  while (characters.length && !characters.at(-1)!.text.trim()) characters.pop();
  return characters.flatMap(character => Array.from({ length: character.text.length }, (_, index) => ({ ...character, text: character.text[index]!, page: page.pageNumber })));
}

export function buildChunks(sections: readonly ChunkSourceSection[], pages: readonly ChunkSourcePage[], options: BuildChunksOptions = {}): BuiltChunk[] {
  const maxChars = Math.max(2, options.maxChars ?? 1200);
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? 120, Math.floor(maxChars / 3)));
  const sourceSections = sections.length ? sections : [{ id: null, startPage: 1, endPage: Math.max(1, ...pages.map(page => page.pageNumber)) }];
  const chunks: BuiltChunk[] = [];
  for (const section of sourceSections) {
    const mapping: Array<{ text: string; start: number; end: number; page: number } | null> = [];
    let text = '';
    for (const page of [...pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
      if (page.pageNumber < section.startPage || page.pageNumber > section.endPage) continue;
      const mapped = mappedPage(page);
      if (!mapped.length) continue;
      if (text) { text += '\n\n'; mapping.push(null, null); }
      text += mapped.map(character => character.text).join('');
      mapping.push(...mapped);
    }
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf('\n\n', end);
        if (boundary > start + overlapChars) end = boundary;
        if (end > start && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
      }
      while (start < end && !text[start]!.trim()) start++;
      while (end > start && !text[end - 1]!.trim()) end--;
      const piece = text.slice(start, end);
      if (normalizeSearchText(piece)) {
        const spans: ChunkPageSpan[] = [];
        for (let index = start; index < end; index++) {
          const position = mapping[index];
          if (!position) continue;
          const previous = spans.at(-1);
          if (previous?.page === position.page) { previous.end = position.end; previous.chunkEnd = index - start + 1; }
          else spans.push({ page: position.page, start: position.start, end: position.end, chunkStart: index - start, chunkEnd: index - start + 1 });
        }
        const first = spans[0]!;
        const last = spans.at(-1)!;
        chunks.push({ sectionId: section.id, pageNumber: first.page, text: piece, normalizedText: piece,
          tokenEstimate: estimateTokens(piece), charStart: first.start, charEnd: last.end,
          metadata: { section_id: section.id, start_page: first.page, end_page: last.page, source_pages: spans.map(span => span.page),
            page_spans: spans, position_version: CHUNK_POSITION_VERSION, content_hash: createNormalizedHash(piece) } });
      }
      if (end >= text.length) break;
      const next = Math.max(start + 1, end - overlapChars);
      start = /[\uDC00-\uDFFF]/u.test(text[next] ?? '') ? next + 1 : next;
    }
  }
  return chunks;
}
