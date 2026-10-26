export interface OutlineCandidatePage {
  pageNumber: number;
  text: string;
}

export interface OutlineCandidate {
  title: string;
  startPage: number;
  level: number;
}

const headingPatterns = [
  /^\s*(第\s*[0-9一二三四五六七八九十百]+\s*[章篇讲回部分节])(?:[^\n]{0,100})$/u,
  /^\s*(Chapter\s+\d+)(?:[^\n]{0,100})$/iu,
  /^\s*(Part\s+\d+)(?:[^\n]{0,100})$/iu,
  /^\s*(\d+(?:\.\d+)*)\s+([^\d\n][^\n]{0,120})$/u,
];

export function detectOutlineCandidates(pages: readonly OutlineCandidatePage[]): OutlineCandidate[] {
  const candidates: OutlineCandidate[] = [];
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const lines = page.text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 140) continue;
      for (const pattern of headingPatterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        const title = match[0].trim();
        if (title.length < 2) continue;
        const level = title.match(/^\d+(?:\.\d+)*/u) ? (title.match(/\./gu)?.length ?? 0) + 1 : 1;
        candidates.push({ title, startPage: page.pageNumber, level });
        break;
      }
    }
  }
  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: readonly OutlineCandidate[]): OutlineCandidate[] {
  const result: OutlineCandidate[] = [];
  for (const candidate of candidates) {
    const previous = result.at(-1);
    if (previous && previous.title === candidate.title && previous.startPage === candidate.startPage) continue;
    result.push(candidate);
  }
  return result;
}
