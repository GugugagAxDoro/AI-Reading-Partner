import { createHash } from 'node:crypto';

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function selectionHash(input: string): string {
  return createNormalizedHash(normalizeText(input));
}

export function createNormalizedHash(input: string): string {
  return createHash('sha256').update(normalizeText(input), 'utf8').digest('hex');
}
