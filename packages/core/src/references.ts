export interface SourceReference {
  id: string;
  source: 'document' | 'web';
  title: string;
  documentId?: string;
  documentHash?: string;
  page?: number;
  endPage?: number;
  startOffset?: number;
  endOffset?: number;
  locationStatus?: 'verified' | 'unverified' | 'ambiguous';
  anchor?: string;
  url?: string;
  excerpt?: string;
  fetchedAt?: string;
  evidenceType?: 'passage' | 'snippet' | 'page';
  missing?: boolean;
  contentHash?: string;
  claimIds?: string[];
  duplicateGroup?: string;
  conflictGroup?: string;
}

export function referencePageLabel(source: SourceReference): string {
  if (!source.page || source.locationStatus !== 'verified') return '原文';
  return `P${source.page}${source.endPage && source.endPage > source.page ? `–${source.endPage}` : ''}`;
}

export function referenceLabel(source: SourceReference): string {
  if (source.source === 'document') return referencePageLabel(source);
  return source.title.trim() || (safeWebUrl(source.url) ? new URL(source.url!).hostname : '网页');
}

export function chunkReferencePosition(chunk: { page_number: number; metadata_json?: string; char_start?: number | null; char_end?: number | null }): Pick<SourceReference, 'page' | 'endPage' | 'startOffset' | 'endOffset' | 'locationStatus'> {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(chunk.metadata_json ?? '{}'); } catch { /* Legacy metadata may be incomplete. */ }
  const verified = metadata.position_version === 'page-spans-v2';
  return { page: chunk.page_number, endPage: verified ? Number(metadata.end_page) || chunk.page_number : undefined,
    startOffset: verified ? chunk.char_start ?? undefined : undefined, endOffset: verified ? chunk.char_end ?? undefined : undefined,
    locationStatus: verified ? 'verified' : 'unverified' };
}

export function summaryReferences(structure: string | null | undefined): SourceReference[] {
  try {
    const value: unknown = JSON.parse(structure ?? '{}');
    if (!value || typeof value !== 'object' || !('references' in value) || !Array.isArray(value.references)) return [];
    return value.references.filter((item): item is SourceReference => Boolean(item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.title === 'string' && ['document', 'web'].includes(item.source)));
  } catch { return []; }
}

export function safeWebUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function serializeReferences(markdown: string, sources: SourceReference[]): string {
  const used = new Map<string, { source: SourceReference; label: string }>();
  const result = markdown.replace(/\[\[ref:([^|\]]+)(?:\|([^\]]+))?\]\]/gu, (_match, id: string, label?: string) => {
    const source = sources.find((item) => item.id === id);
    if (!source) return `[${label ?? '?'}：来源不可用]`;
    const number = String(sources.indexOf(source) + 1);
    used.set(id, { source, label: number });
    return `[^${number}]`;
  });
  if (!used.size) return result;
  return result + '\n\n' + [...used.values()].map(({ source, label }) => {
    const title = source.title.replace(/[\[\]\r\n]/gu, ' ');
    const url = safeWebUrl(source.url);
    if (source.source === 'web') return `[^${label}]: ${title}${url ? ` <${url}>` : '（来源不可用）'}`;
    const position = referencePageLabel(source);
    const locator = position !== '原文' && source.documentId ? ` [[doc:${source.documentId}#page=${source.page}|原文]]` : '（位置待核实）';
    return `[^${label}]: ${title}，${position}${source.missing ? '（来源已失效）' : ''}${locator}`;
  }).join('\n');
}
