import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { detectOutlineCandidates, normalizeText, type OutlineCandidate } from '@ai-reading-partner/core';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { repairPdfUnicode, type UnicodeRepair } from './pdf-unicode';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  charCount: number;
}

export interface PdfMetadata {
  title: string | null;
  author: string | null;
}

export interface ExtractedPdf {
  readerPdf: Uint8Array | null;
  unicodeRepair: UnicodeRepair;
  pageCount: number;
  metadata: PdfMetadata;
  pages: ExtractedPage[];
  nativeOutline: OutlineCandidate[];
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedPdf> {
  const prepared = await repairPdfUnicode(buffer);
  const readerPdf = prepared.repair.mappings ? prepared.data.slice() : null;
  const pdf = await pdfjsLib.getDocument({ data: prepared.data }).promise;
  try {
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = (metadata?.info ?? {}) as { Title?: string; Author?: string };
    const pages: ExtractedPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = normalizeText(
        (textContent.items as Array<{ str?: string }>)
          .map((item) => item.str ?? '')
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      );
      pages.push({ pageNumber, text, charCount: text.length });
    }

    const nativeOutline = await extractNativeOutline(pdf);
    return {
      readerPdf,
      unicodeRepair: prepared.repair,
      pageCount: pdf.numPages,
      metadata: {
        title: info.Title?.trim() || null,
        author: info.Author?.trim() || null,
      },
      pages,
      nativeOutline,
    };
  } finally {
    await pdf.destroy();
  }
}

export async function generatePdfCover(buffer: Buffer, coverPath: string, maxWidth = 320): Promise<boolean> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.5, maxWidth / viewport.width));
    const scaledViewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.max(1, Math.floor(scaledViewport.width)),
      Math.max(1, Math.floor(scaledViewport.height)),
    );
    const context = canvas.getContext('2d');
    await page.render({
      canvasContext: context,
      viewport: scaledViewport,
    } as Parameters<typeof page.render>[0]).promise;
    const encoded = await canvas.encode('png');
    mkdirSync(dirname(coverPath), { recursive: true });
    writeFileSync(coverPath, encoded);
    return true;
  } catch {
    return false;
  }
}

export function fallbackOutline(pages: readonly ExtractedPage[], pageCount: number): OutlineCandidate[] {
  const detected = detectOutlineCandidates(pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })));
  if (detected.length > 0) return detected;
  return [{ title: '全书', startPage: 1, level: 1 }];
}

async function extractNativeOutline(pdf: any): Promise<OutlineCandidate[]> {
  try {
    const outline = await pdf.getOutline();
    if (!Array.isArray(outline) || outline.length === 0) return [];

    const result: OutlineCandidate[] = [];
    const visit = async (items: any[], level: number): Promise<void> => {
      for (const item of items) {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        if (!title) continue;
        const pageNumber = await resolveOutlinePage(pdf, item.dest);
        if (pageNumber > 0) result.push({ title, startPage: pageNumber, level });
        if (Array.isArray(item.items) && item.items.length > 0) {
          await visit(item.items, level + 1);
        }
      }
    };
    await visit(outline, 1);
    return result;
  } catch {
    return [];
  }
}

async function resolveOutlinePage(pdf: any, dest: unknown): Promise<number> {
  try {
    const explicitDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicitDest) || explicitDest.length === 0) return 0;
    const ref = explicitDest[0];
    if (!ref || typeof ref !== 'object') return 0;
    const pageIndex = await pdf.getPageIndex(ref);
    return Number.isFinite(pageIndex) ? pageIndex + 1 : 0;
  } catch {
    return 0;
  }
}
