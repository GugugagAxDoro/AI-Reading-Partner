import { estimateTokens, normalizeSearchText } from './retrieval';
import { createNormalizedHash, normalizeText } from './text';

export interface ChunkSourceSection {
  id: string | null;
  startPage: number;
  endPage: number;
}

export interface ChunkSourcePage {
  pageNumber: number;
  text: string;
}

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

export interface BuildChunksOptions {
  maxChars?: number;
  overlapChars?: number;
}

export function buildChunks(
  sections: readonly ChunkSourceSection[],
  pages: readonly ChunkSourcePage[],
  options: BuildChunksOptions = {},
): BuiltChunk[] {
  const maxChars = options.maxChars ?? 1200;
  const overlapChars = Math.min(options.overlapChars ?? 120, Math.floor(maxChars / 3));
  const sourceSections = sections.length > 0
    ? sections
    : [{ id: null, startPage: 1, endPage: Math.max(1, pages.at(-1)?.pageNumber ?? 1) }];

  const chunks: BuiltChunk[] = [];
  for (const section of sourceSections) {
    const sectionPages = pages
      .filter((page) => page.pageNumber >= section.startPage && page.pageNumber <= section.endPage)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    if (sectionPages.length === 0) continue;

    const rawText = sectionPages.map((page) => page.text.trim()).filter(Boolean).join('\n\n');
    if (!rawText.trim()) continue;

    const paragraphs = normalizeText(rawText)
      .split(/\n{2,}/gu)
      .filter((part: string) => part.trim().length > 0);
    const pieces = groupParagraphs(paragraphs, maxChars, overlapChars);
    for (const piece of pieces) {
      const normalized = normalizeText(piece);
      chunks.push({
        sectionId: section.id,
        pageNumber: sectionPages[0]?.pageNumber ?? 1,
        text: piece,
        normalizedText: normalized,
        tokenEstimate: estimateTokens(normalized),
        charStart: null,
        charEnd: null,
        metadata: {
          section_id: section.id,
          start_page: section.startPage,
          end_page: section.endPage,
          source_pages: sectionPages.map((page) => page.pageNumber),
          content_hash: createNormalizedHash(normalized),
        },
      });
    }
  }
  return chunks;
}

function groupParagraphs(paragraphs: readonly string[], maxChars: number, overlapChars: number): string[] {
  const pieces: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = current.join('\n\n');
    pieces.push(text);
    if (overlapChars > 0) {
      const tail = text.slice(Math.max(0, text.length - overlapChars));
      current = [tail];
      currentLength = tail.length;
      return;
    }
    current = [];
    currentLength = 0;
  };

  for (const paragraph of paragraphs) {
    const normalizedParagraph = paragraph.trim();
    if (!normalizedParagraph) continue;
    if (normalizedParagraph.length > maxChars) {
      flush();
      for (let index = 0; index < normalizedParagraph.length; index += maxChars) {
        const start = Math.max(0, index - (index === 0 ? 0 : overlapChars));
        const end = Math.min(normalizedParagraph.length, index + maxChars);
        const slice = normalizedParagraph.slice(start, end).trim();
        if (slice) pieces.push(slice);
      }
      continue;
    }

    if (currentLength + normalizedParagraph.length + 2 > maxChars) flush();
    current.push(normalizedParagraph);
    currentLength += normalizedParagraph.length + 2;
  }
  flush();
  return pieces.filter((piece) => normalizeSearchText(piece).length > 0);
}
