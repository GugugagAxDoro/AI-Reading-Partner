export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/[.,;:!?"'()\[\]{}《》「」『』、。，：；！？·—–]/gu, ' ')
    .trim();
}

export function tokenForIndex(input: string): string {
  const normalized = normalizeSearchText(input).replace(/\s+/gu, '');
  const tokens: string[] = [];
  for (const token of normalized.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/gu) ?? []) tokens.push(token);

  const withoutLatin = normalized.replace(/[a-z0-9]+(?:[-_][a-z0-9]+)*/gu, ' ');
  for (const span of withoutLatin.split(/\s+/).filter(Boolean)) {
    if (span.length === 1) {
      tokens.push(span);
      continue;
    }
    for (let index = 0; index < span.length - 1; index += 1) {
      tokens.push(span.slice(index, index + 2));
    }
  }
  return [...new Set(tokens)].join(' ');
}

export function estimateTokens(input: string): number {
  if (!input.trim()) return 0;
  const cjkCount = (input.match(/[\u3400-\u9dbf\u4e00-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  const remaining = input.length - cjkCount;
  return Math.max(1, cjkCount + Math.ceil(remaining / 4));
}
