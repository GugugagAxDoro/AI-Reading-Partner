export interface SourceReference {
  id: string;
  source: 'document' | 'web';
  title: string;
  documentId?: string;
  documentHash?: string;
  page?: number;
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
    return `[^${label}]: ${title}，第 ${source.page ?? 1} 页${source.missing ? '（来源已失效）' : '（在应用内定位）'} [[doc:${source.documentId ?? 'missing'}#page=${source.page ?? 1}|原文]]`;
  }).join('\n');
}
