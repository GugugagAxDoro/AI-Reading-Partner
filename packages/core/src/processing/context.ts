import { createNormalizedHash, normalizeText } from './text';
import { estimateTokens } from './retrieval';

export type ContextProfile = 'selected_passage' | 'book_question' | 'project_question' | 'agent_task';

export type ContextSourceType = 'selected_text' | 'page' | 'chunk' | 'summary' | 'cache' | 'tool';

export interface ContextItem {
  id: string;
  type: ContextSourceType;
  text: string;
  title?: string;
  page?: number;
  documentId?: string;
  sectionId?: string;
  priority?: number;
  protected?: boolean;
}

export interface ContextPiece extends ContextItem {
  tokenEstimate: number;
  originalTokenEstimate: number;
  truncated: boolean;
}

export interface ContextBuildResult {
  profile: ContextProfile;
  pieces: ContextPiece[];
  text: string;
  tokenEstimate: number;
  tokenBudget: number;
  contextHash: string;
  droppedItemIds: string[];
  truncatedItemIds: string[];
}

export interface ContextBudgets {
  selected_passage: number;
  book_question: number;
  project_question: number;
  agent_task: number;
}

export const DEFAULT_CONTEXT_BUDGETS: ContextBudgets = {
  selected_passage: 3000,
  book_question: 8000,
  project_question: 10000,
  agent_task: 6000,
};

export function trimToTokenBudget(input: string, maxTokens: number): { text: string; tokenEstimate: number; truncated: boolean } {
  const normalized = normalizeText(input);
  const total = estimateTokens(normalized);
  if (total <= maxTokens) return { text: normalized, tokenEstimate: total, truncated: false };
  if (maxTokens <= 1) return { text: normalized.slice(0, 1), tokenEstimate: 1, truncated: true };

  const tokensPerCharacter = total / Math.max(1, normalized.length);
  const maxCharacters = Math.max(1, Math.floor(maxTokens / tokensPerCharacter));
  const headEnd = Math.max(1, Math.floor(maxCharacters * 0.7));
  const tailStart = Math.max(
    headEnd + 1,
    normalized.length - Math.max(0, Math.floor(maxCharacters * 0.2)),
  );
  const head = normalized.slice(0, headEnd).trimEnd();
  const tail = tailStart < normalized.length ? normalized.slice(tailStart).trimStart() : '';
  const text = tail ? `${head}\n\n…[context trimmed]…\n\n${tail}` : head;
  return { text, tokenEstimate: estimateTokens(text), truncated: true };
}

export function buildContext(
  profile: ContextProfile,
  items: readonly ContextItem[],
  budgetOverrides?: Partial<ContextBudgets>,
): ContextBuildResult {
  const tokenBudget = budgetOverrides?.[profile] ?? DEFAULT_CONTEXT_BUDGETS[profile];
  const normalizedItems = items.filter((item) => item.text.trim().length > 0);
  const orderedItems = [...normalizedItems].sort((left, right) => {
    const protectedDifference = Number(Boolean(right.protected)) - Number(Boolean(left.protected));
    if (protectedDifference !== 0) return protectedDifference;
    const priorityDifference = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDifference !== 0) return priorityDifference;
    return normalizedItems.indexOf(left) - normalizedItems.indexOf(right);
  });

  const accepted: ContextPiece[] = [];
  const droppedItemIds: string[] = [];
  const truncatedItemIds: string[] = [];
  let remaining = tokenBudget;

  for (const item of orderedItems) {
    const originalTokenEstimate = estimateTokens(item.text);
    if (remaining <= 0) {
      droppedItemIds.push(item.id);
      continue;
    }
    const trimmed = trimToTokenBudget(item.text, remaining);
    if (trimmed.tokenEstimate <= 0) {
      droppedItemIds.push(item.id);
      continue;
    }
    accepted.push({
      ...item,
      text: trimmed.text,
      tokenEstimate: trimmed.tokenEstimate,
      originalTokenEstimate,
      truncated: trimmed.truncated,
    });
    remaining -= trimmed.tokenEstimate;
    if (trimmed.truncated) truncatedItemIds.push(item.id);
  }

  accepted.sort((left, right) => normalizedItems.findIndex((item) => item.id === left.id) - normalizedItems.findIndex((item) => item.id === right.id));
  const text = accepted.map((piece) => {
    const location = [
      piece.title,
      typeof piece.page === 'number' ? `P${piece.page}` : null,
    ].filter(Boolean).join(' · ');
    return location ? `[${location}]\n${piece.text}` : piece.text;
  }).join('\n\n');

  return {
    profile,
    pieces: accepted,
    text,
    tokenEstimate: estimateTokens(text),
    tokenBudget,
    contextHash: createNormalizedHash(text),
    droppedItemIds,
    truncatedItemIds,
  };
}
