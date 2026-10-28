import {
  ChunkRepository,
  CacheRepository,
  DocumentRepository,
  PageRepository,
  SectionRepository,
} from '@ai-reading-partner/db';
import {
  buildContext,
  createNormalizedHash,
  normalizeText,
  selectionHash,
  type ContextBuildResult,
  chunkReferencePosition,
} from '@ai-reading-partner/core';
import {
  ModelClient,
  ProviderConfigError,
  resolveRouting,
  type ProviderConfig,
} from '@ai-reading-partner/ai';
import type { Database } from '@ai-reading-partner/db';
import { PROMPT_VERSION, answerOutputTokens, buildPromptMessages, readingTaskProfile, type AiActionType } from './prompts';
import { RetrievalService } from './retrieval';
import { contextualSense } from './evidence';

const actionSchemaValues: readonly AiActionType[] = [
  'vocabulary_explanation',
  'content_interpretation',
  'custom_question',
];

export interface AiActionInput {
  action: AiActionType;
  pageNumber: number;
  text: string;
  normalizedText?: string | null;
  selectionHash?: string | null;
  anchor?: {
    quote?: string | null;
    prefix?: string | null;
    suffix?: string | null;
  } | null;
  instruction?: string | null;
  language?: string | null;
}

export interface AiActionResult {
  answer: string;
  cached: boolean;
  promptVersion: string;
  modelId: string | null;
  providerId: string | null;
  sources: SourceReference[];
  contextProfile: ContextBuildResult['profile'];
  contextTokens: number;
  contextHash: string;
}

export interface SourceReference {
  type: 'selection' | 'page' | 'chunk';
  id?: string;
  page: number;
  excerpt: string;
  endPage?: number;
  startOffset?: number;
  endOffset?: number;
  locationStatus?: 'verified' | 'unverified' | 'ambiguous';
}

export class AiActionService {
  private readonly cache: CacheRepository;
  private readonly documents: DocumentRepository;
  private readonly pages: PageRepository;
  private readonly sections: SectionRepository;
  private readonly chunks: ChunkRepository;
  private readonly retrieval: RetrievalService;

  constructor(
    private readonly database: Database,
    private readonly dataRoot: string,
    private readonly providerConfig: ProviderConfig,
  ) {
    this.cache = new CacheRepository(database);
    this.documents = new DocumentRepository(database, dataRoot);
    this.pages = new PageRepository(database);
    this.sections = new SectionRepository(database);
    this.chunks = new ChunkRepository(database);
    this.retrieval = new RetrievalService(database);
  }

  async explainSelection(projectId: string, documentId: string, input: AiActionInput): Promise<AiActionResult> {
    if (!actionSchemaValues.includes(input.action)) {
      throw Object.assign(new Error('Unsupported AI action'), { statusCode: 400 });
    }
    const document = this.documents.get(documentId);
    if (!document || !this.documents.listByProject(projectId).some((item) => item.id === documentId)) throw Object.assign(new Error('Document not found'), { statusCode: 404 });

    const normalized = normalizeText(input.normalizedText?.trim() || input.text);
    const hash = input.selectionHash?.trim() || selectionHash(normalized);
    const pageNumber = Math.max(1, Math.floor(input.pageNumber));
    const language = input.language?.trim() || '简体中文';
    const pageText = this.pages.list(documentId).find(item => item.page_number === pageNumber)?.text ?? '';
    const sense = contextualSense(pageText, normalized);
    const compatibility = `${PROMPT_VERSION}:legacy:${language}:${createNormalizedHash(input.instruction ?? '')}:${sense}`;
    const instructionHash = createNormalizedHash(compatibility);

    if (input.action === 'vocabulary_explanation') {
      const normalizedTerm = normalizeText(input.text).toLowerCase();
      const term = this.cache.findVariant(projectId, normalizedTerm, compatibility);
      if (term?.prompt_version === PROMPT_VERSION) {
        return {
          answer: term.explanation,
          cached: true,
          promptVersion: term.prompt_version ?? PROMPT_VERSION,
          modelId: term.model_id,
          providerId: term.provider_id,
          sources: safeArray(term.sources_json),
          contextProfile: 'selected_passage',
          contextTokens: 0,
          contextHash: '',
        };
      }
    } else {
      const content = this.cache.findContent({
        projectId,
        documentId,
        pageNumber,
        action: input.action,
        instructionHash,
        selectionHash: hash,
      });
      if (content?.prompt_version === PROMPT_VERSION) {
        return {
          answer: content.answer,
          cached: true,
          promptVersion: content.prompt_version ?? PROMPT_VERSION,
          modelId: content.model_id,
          providerId: content.provider_id,
          sources: safeArray(content.sources_json),
          contextProfile: 'selected_passage',
          contextTokens: 0,
          contextHash: '',
        };
      }
    }

    let providerFile;
    try {
      providerFile = this.providerConfig.current;
    } catch (error) {
      if (error instanceof ProviderConfigError) {
        throw Object.assign(new Error('AI is not configured or provider configuration is invalid'), {
          statusCode: 400,
          cause: error,
        });
      }
      throw error;
    }
    const client = new ModelClient(providerFile);
    const section = this.sections.list(documentId).find((item) =>
      pageNumber >= item.start_page && pageNumber <= item.end_page,
    );
    const { context, sources: nearbySources } = this.buildNearbyContext(
      documentId,
      pageNumber,
      input.action,
      input.instruction?.trim() || normalized,
      section?.id,
      hash,
    );
    const messages = buildPromptMessages(input.action, {
      selectedText: normalized,
      instruction: input.instruction,
      title: document.title,
      page: pageNumber,
      sectionTitle: section?.title,
      nearbyContext: context.text,
      language,
    });
    const profile = readingTaskProfile(input.action, input.instruction ?? '');
    const routing = resolveRouting(providerFile, profile);
    const result = await client.complete({
      tier: routing.tier,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
      maxTokens: answerOutputTokens(input.instruction ?? ''),
    });

    const sources = [
      { type: 'selection' as const, page: pageNumber, excerpt: normalized.slice(0, 160) },
      ...nearbySources,
    ];
    if (input.action === 'vocabulary_explanation') {
      const term = this.cache.saveVariant({
        compatibility,
        projectId,
        normalizedTerm: normalizeText(input.text).toLowerCase(),
        displayTerm: input.text.trim(),
        explanation: result.content,
        sources,
        promptVersion: PROMPT_VERSION,
        modelId: result.model,
        providerId: result.providerId,
      });
      return {
        answer: term.explanation,
        cached: false,
        promptVersion: term.prompt_version ?? PROMPT_VERSION,
        modelId: term.model_id,
        providerId: term.provider_id,
        sources: safeArray(term.sources_json),
        contextProfile: context.profile,
        contextTokens: context.tokenEstimate,
        contextHash: context.contextHash,
      };
    }

    const content = this.cache.saveContent({
      projectId,
      documentId,
      pageNumber,
      action: input.action,
      instructionHash,
      normalizedText: normalized,
      selectionHash: hash,
      answer: result.content,
      sources,
      promptVersion: PROMPT_VERSION,
      modelId: result.model,
      providerId: result.providerId,
    });
    return {
      answer: content.answer,
      cached: false,
      promptVersion: content.prompt_version ?? PROMPT_VERSION,
      modelId: content.model_id,
      providerId: content.provider_id,
      sources: safeArray(content.sources_json),
      contextProfile: context.profile,
      contextTokens: context.tokenEstimate,
      contextHash: context.contextHash,
    };
  }

  private buildNearbyContext(
    documentId: string,
    pageNumber: number,
    action: AiActionType,
    retrievalQuery: string,
    sectionId?: string | null,
    selectionHashValue?: string,
  ): { context: ContextBuildResult; sources: SourceReference[] } {
    const page = this.pages.list(documentId).find((item) => item.page_number === pageNumber);
    const pageText = normalizeText(page?.text ?? '');

    const retrieved = action === 'custom_question'
      ? this.retrieval.searchCurrent(documentId, retrievalQuery, {
          limit: 2,
          currentPage: pageNumber,
          currentSectionId: sectionId,
        })
      : [];

    const sources: SourceReference[] = [];
    const items = [
      {
        id: `selection:${selectionHashValue ?? pageNumber}`,
        type: 'selected_text' as const,
        text: retrievalQuery,
        page: pageNumber,
        priority: 100,
        protected: true,
      },
      ...(pageText ? [{
        id: `page:${pageNumber}`,
        type: 'page' as const,
        text: pageText,
        page: pageNumber,
        priority: 80,
      }] : []),
      ...retrieved.map((chunk) => ({
        id: `chunk:${chunk.id}`,
        type: 'chunk' as const,
        text: chunk.text,
        page: chunk.page_number,
        sectionId: chunk.section_id ?? undefined,
        priority: 70,
      })),
    ];
    sources.push(...retrieved.map((chunk) => ({
      type: 'chunk' as const,
      id: chunk.id,
      ...chunkReferencePosition(chunk),
      page: chunk.page_number,
      excerpt: chunk.text.slice(0, 160),
    })));
    const context = buildContext('selected_passage', items, {
      selected_passage: action === 'vocabulary_explanation' ? 1800 : 3000,
    });
    return { context, sources };
  }
}

function safeArray(value: string): SourceReference[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSourceReference) : [];
  } catch {
    return [];
  }
}

function isSourceReference(value: unknown): value is SourceReference {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SourceReference>;
  return (
    (candidate.type === 'selection' || candidate.type === 'page' || candidate.type === 'chunk') &&
    typeof candidate.page === 'number' &&
    typeof candidate.excerpt === 'string'
  );
}
