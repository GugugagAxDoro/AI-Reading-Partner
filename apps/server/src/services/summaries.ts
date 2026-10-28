import { estimateTokens, summaryReferences, type SourceReference } from '@ai-reading-partner/core';
import {
  ChunkRepository,
  DocumentRepository,
  SectionRepository,
  SummaryRepository,
  type SummaryRecord,
} from '@ai-reading-partner/db';
import { ModelClient, ProviderConfigError, resolveRouting, type ProviderConfig } from '@ai-reading-partner/ai';
import type { Database } from '@ai-reading-partner/db';
import {
  SUMMARY_PROMPT_VERSION,
  buildChunkGroupSummaryMessages,
  buildSummaryMessages,
} from './prompts';
import { makeSource } from './evidence';

export type SummaryScope = 'book' | 'section' | 'project';

export class SummaryService {
  private readonly chunks: ChunkRepository;
  private readonly documents: DocumentRepository;
  private readonly sections: SectionRepository;
  private readonly summaries: SummaryRepository;

  constructor(
    private readonly database: Database,
    private readonly providerConfig: ProviderConfig,
  ) {
    this.chunks = new ChunkRepository(database);
    this.documents = new DocumentRepository(database, '');
    this.sections = new SectionRepository(database);
    this.summaries = new SummaryRepository(database);
  }

  ensureBookSummary(projectId: string, documentId: string, options: { background?: boolean } = {}): SummaryRecord {
    const existing = this.summaries.find('book', documentId, projectId);
    if (existing && (existing.status === 'ready' || existing.status === 'processing' || existing.status === 'pending')) {
      if (options.background) void this.generateBookSummary(projectId, documentId).catch(() => undefined);
      return existing;
    }

    const summary = this.summaries.save({
      scope: 'book',
      targetId: documentId,
      projectId,
      documentId,
      status: 'pending',
    });
    if (options.background) {
      void this.generateBookSummary(projectId, documentId).catch(() => undefined);
    }
    return summary;
  }

  ensureSectionSummary(projectId: string, documentId: string, sectionId: string): SummaryRecord {
    const existing = this.summaries.find('section', sectionId, projectId);
    if (existing && existing.status !== 'failed') return existing;

    const summary = this.summaries.save({
      scope: 'section',
      targetId: sectionId,
      projectId,
      documentId,
      sectionId,
      status: 'pending',
    });
    void this.generateSectionSummary(projectId, documentId, sectionId).catch(() => undefined);
    return summary;
  }

  async generateBookSummary(projectId: string, documentId: string): Promise<SummaryRecord> {
    const document = this.documents.get(documentId);
    if (!document) throw new Error('Document not found');
    this.summaries.save({
      scope: 'book',
      targetId: documentId,
      projectId,
      documentId,
      status: 'processing',
    });
    try {
      const chunks = this.chunks.list(documentId);
      const references = chunks.map((chunk) => makeSource({ source: 'document', documentId, title: document.title, page: chunk.page_number, anchor: chunk.id, evidenceType: 'passage' }));
      const evidence = await this.mapReduceEvidence(document.title, chunks.map((chunk, index) => ({
        text: `[[ref:${references[index]!.id}]]\n${chunk.text}`,
        sectionId: chunk.section_id,
      })), 'book');
      const markdown = await this.finalizeSummary(document.title, null, 'book', evidence, references);
      return this.summaries.save({
        scope: 'book',
        targetId: documentId,
        projectId,
        documentId,
        status: 'ready',
        markdown,
        structure: { references },
        promptVersion: SUMMARY_PROMPT_VERSION,
      });
    } catch (error) {
      return this.summaries.save({
        scope: 'book',
        targetId: documentId,
        projectId,
        documentId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async generateSectionSummary(projectId: string, documentId: string, sectionId: string): Promise<SummaryRecord> {
    const section = this.sections.list(documentId).find((item) => item.id === sectionId);
    if (!section) throw new Error('Section not found');
    const document = this.documents.get(documentId);
    if (!document) throw new Error('Document not found');

    this.summaries.save({
      scope: 'section',
      targetId: sectionId,
      projectId,
      documentId,
      sectionId,
      status: 'processing',
    });
    try {
      const chunks = this.chunks.listBySection(sectionId);
      const references = chunks.map((chunk) => makeSource({ source: 'document', documentId, title: document.title, page: chunk.page_number, anchor: chunk.id, evidenceType: 'passage' }));
      const evidence = await this.mapReduceEvidence(document.title, chunks.map((chunk, index) => ({
        text: `[[ref:${references[index]!.id}]]\n${chunk.text}`,
        sectionId,
      })), 'section');
      const markdown = await this.finalizeSummary(document.title, section.title, 'section', evidence, references);
      return this.summaries.save({
        scope: 'section',
        targetId: sectionId,
        projectId,
        documentId,
        sectionId,
        status: 'ready',
        markdown,
        structure: { references },
        promptVersion: SUMMARY_PROMPT_VERSION,
      });
    } catch (error) {
      return this.summaries.save({
        scope: 'section',
        targetId: sectionId,
        projectId,
        documentId,
        sectionId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async generateProjectSummary(projectId: string, projectName: string): Promise<SummaryRecord> {
    const bookSummaries = this.database
      .prepare(
        `SELECT s.markdown, s.structure_json, d.title FROM summaries s
         JOIN documents d ON d.id = s.document_id
         JOIN project_documents pd ON pd.document_id = d.id
         WHERE s.project_id = ? AND s.scope = 'book' AND s.status = 'ready' AND s.markdown IS NOT NULL
         ORDER BY d.title`,
      )
      .all(projectId) as Array<{ markdown: string; title: string; structure_json: string | null }>;
    if (bookSummaries.length === 0) throw new Error('Project has no ready book summaries yet');

    this.summaries.save({
      scope: 'project',
      targetId: projectId,
      projectId,
      status: 'processing',
    });
    try {
      const evidence = bookSummaries
        .map((item) => `# ${item.title}\n${item.markdown}`)
        .join('\n\n');
      const references = bookSummaries.flatMap((item) => summaryReferences(item.structure_json));
      const markdown = await this.finalizeSummary(projectName, null, 'project', evidence.slice(0, 16000), references);
      return this.summaries.save({
        scope: 'project',
        targetId: projectId,
        projectId,
        status: 'ready',
        markdown,
        structure: { references },
        promptVersion: SUMMARY_PROMPT_VERSION,
      });
    } catch (error) {
      return this.summaries.save({
        scope: 'project',
        targetId: projectId,
        projectId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async mapReduceEvidence(
    title: string,
    chunks: Array<{ text: string; sectionId: string | null }>,
    scope: SummaryScope,
  ): Promise<string> {
    const totalTokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0);
    if (totalTokens <= 3500) return chunks.map((chunk) => chunk.text).join('\n\n').slice(0, 16000);

    let evidence = await this.summarizeGroups(title, chunks.map((chunk) => chunk.text), scope);
    for (let round = 0; estimateTokens(evidence) > 5000; round++) {
      if (round >= 4) throw new Error('摘要压缩未收敛，请缩小摘要范围');
      const groups = evidence
        .split(/\n\n/u)
        .filter(Boolean)
        .map((text) => ({ text, sectionId: null }));
      evidence = await this.summarizeGroups(title, groups.map((group) => group.text), scope);
    }
    return evidence;
  }

  private async summarizeGroups(
    title: string,
    texts: string[],
    scope: SummaryScope,
  ): Promise<string> {
    const providerFile = this.loadProviderConfig();
    const client = new ModelClient(providerFile);
    const routing = resolveRouting(providerFile, 'chunk_summary');
    const groups: string[][] = [];
    for (let index = 0; index < texts.length; index += 6) {
      groups.push(texts.slice(index, index + 6));
    }

    const summaries: string[] = [];
    for (const group of groups) {
      const messages = buildChunkGroupSummaryMessages({
        title,
        sectionTitle: null,
        content: group.join('\n\n').slice(0, 9000),
        language: '简体中文',
      });
      const result = await client.complete({
        tier: routing.tier,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
        maxTokens: scope === 'book' ? 350 : 420,
      });
      summaries.push(result.content.trim());
    }
    return summaries.join('\n\n').slice(0, 16000);
  }

  private async finalizeSummary(
    title: string,
    sectionTitle: string | null,
    scope: SummaryScope,
    evidence: string,
    references: SourceReference[],
  ): Promise<string> {
    const providerFile = this.loadProviderConfig();
    const client = new ModelClient(providerFile);
    const profile = scope === 'book'
      ? 'document_summary'
      : scope === 'section'
        ? 'document_summary'
        : 'project_summary';
    const routing = resolveRouting(providerFile, profile);
    const messages = buildSummaryMessages({ title, sectionTitle, scope, evidence, language: '简体中文' });
    const result = await client.complete({
      tier: routing.tier,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
      maxTokens: 1200,
    });
    const markdown = result.content.trim();
    const validIds = new Set(references.map((source) => source.id));
    for (const match of markdown.matchAll(/\[\[ref:([^|\]]+)(?:\|[^\]]+)?\]\]/gu)) {
      if (!validIds.has(match[1]!)) throw new Error('摘要包含未知来源引用');
    }
    return markdown;
  }

  private loadProviderConfig() {
    try {
      return this.providerConfig.current;
    } catch (error) {
      if (error instanceof ProviderConfigError) {
        throw new Error('AI is not configured or provider configuration is invalid');
      }
      throw error;
    }
  }
}
