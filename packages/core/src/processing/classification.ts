export interface TextLayerPageDiagnostic {
  pageNumber: number;
  charCount: number;
}

export type TextLayerClassification = 'text' | 'mixed' | 'scanned';

export function classifyTextLayer(pages: readonly TextLayerPageDiagnostic[]): {
  classification: TextLayerClassification;
  textPageCount: number;
  pageCount: number;
  textPageRatio: number;
} {
  const pageCount = pages.length;
  const textPageCount = pages.filter((page) => page.charCount >= 40).length;
  const textPageRatio = pageCount === 0 ? 0 : textPageCount / pageCount;
  const classification: TextLayerClassification =
    textPageCount === 0 ? 'scanned' : textPageRatio >= 0.8 ? 'text' : 'mixed';
  return { classification, textPageCount, pageCount, textPageRatio };
}
