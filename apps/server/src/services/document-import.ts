import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { buildChunks, classifyTextLayer, type OutlineCandidate } from '@ai-reading-partner/core';
import { ModelClient, ProviderConfigError, type ProviderConfig } from '@ai-reading-partner/ai';
import {
  ChunkRepository,
  DocumentRepository,
  JobRepository,
  PageRepository,
  SectionRepository,
  SummaryRepository,
  permanentlyDeleteDocument,
  prepareDocumentSourceForReimport,
  removeDocumentFromProject,
  type JobRecord,
} from '@ai-reading-partner/db';
import type { Database } from '@ai-reading-partner/db';
import { extractPdf, fallbackOutline, generatePdfCover } from '../processing/pdf-document';
import { writeChunksJsonl, writePagesJsonl } from '../processing/page-serialization';
import { SummaryService } from './summaries';
import { PDF_TEXT_VERSION } from '../processing/pdf-unicode';
import { writeReaderPdf } from './text-extraction';

const MAX_PDF_BYTES = 500 * 1024 * 1024;

export interface ImportDocumentResult {
  documentId: string;
  jobId: string;
  reused: boolean;
}

export class DocumentImportService {
  private readonly documents: DocumentRepository;
  private readonly jobs: JobRepository;
  private readonly pages: PageRepository;
  private readonly sections: SectionRepository;
  private readonly chunks: ChunkRepository;
  private readonly summaries: SummaryRepository;

  private readonly database: Database;
  private readonly dataRoot: string;

  constructor(
    database: Database,
    dataRoot: string,
    private readonly summaryService?: SummaryService,
    private readonly providerConfig?: ProviderConfig,
  ) {
    this.database = database;
    this.dataRoot = dataRoot;
    this.documents = new DocumentRepository(this.database, this.dataRoot);
    this.jobs = new JobRepository(this.database);
    this.pages = new PageRepository(this.database);
    this.sections = new SectionRepository(this.database);
    this.chunks = new ChunkRepository(this.database);
    this.summaries = new SummaryRepository(this.database);
  }

  async importPdf(projectId: string, buffer: Buffer, filename: string): Promise<ImportDocumentResult> {
    validatePdf(buffer);
    const safeFilename = validatePdfFilename(filename);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const documentDirectory = join(this.dataRoot, 'documents', hash);
    const sourcePath = join(documentDirectory, 'source.pdf');
    mkdirSync(documentDirectory, { recursive: true });

    const existing = this.documents.findByHash(hash);
    if (!existsSync(sourcePath)) {
      const temporaryPath = join(this.dataRoot, 'tmp', `${hash}-${Date.now()}-${process.pid}.pdf`);
      mkdirSync(dirname(temporaryPath), { recursive: true });
      writeFileSync(temporaryPath, buffer);
      renameSync(temporaryPath, sourcePath);
    } else if (existing && existing.source_path !== sourcePath) {
      prepareDocumentSourceForReimport(this.database, existing.id, {
        sourcePath,
        sizeBytes: buffer.length,
      });
    }

    let document = existing;
    let reused = Boolean(existing);
    if (!document) {
      document = this.documents.create({
        hash,
        filename: safeFilename,
        title: deriveTitle(safeFilename),
        sourcePath,
        sizeBytes: buffer.length,
      });
    } else {
      this.documents.updateProcessing(document.id, {
        processing_status: 'pending',
        processing_stage: 'received',
        processing_error: null,
      });
    }

    this.documents.addToProject(projectId, document.id);
    const activeJob = this.activeJobForDocument(document.id);
    if (activeJob) {
      return { documentId: document.id, jobId: activeJob.id, reused };
    }

    const job = this.enqueueImport(projectId, document.id);
    void this.processJob(job.id).catch((error) => {
      this.jobs.update(job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      this.documents.updateProcessing(document!.id, {
        processing_status: 'failed',
        processing_error: error instanceof Error ? error.message : String(error),
      });
    });
    return { documentId: document.id, jobId: job.id, reused };
  }

  async retry(projectId: string, documentId: string): Promise<ImportDocumentResult> {
    const document = this.documents.getFromProject(projectId, documentId);
    if (!document) throw new DocumentNotFoundError();

    const activeJob = this.activeJobForDocument(documentId);
    if (activeJob) return { documentId, jobId: activeJob.id, reused: true };
    if (document.processing_status === 'ready') {
      const job = this.jobs.enqueue({ type: 'document_import', projectId, documentId, total: 1 });
      this.jobs.update(job.id, { status: 'ready', stage: 'ready' });
      return { documentId, jobId: job.id, reused: true };
    }

    const job = this.enqueueImport(projectId, documentId);
    void this.processJob(job.id).catch((error) => {
      this.jobs.update(job.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
      this.documents.updateProcessing(documentId, {
        processing_status: 'failed',
        processing_error: error instanceof Error ? error.message : String(error),
      });
    });
    return { documentId, jobId: job.id, reused: true };
  }

  listJobs(projectId?: string): JobRecord[] {
    return this.jobs.list({ projectId });
  }

  async processJob(jobId: string): Promise<JobRecord> {
    const job = this.jobs.get(jobId);
    if (!job || job.type !== 'document_import') throw new DocumentNotFoundError('Job not found');
    if (!job.document_id) throw new DocumentNotFoundError('Job has no document');
    if (job.status === 'running') return job;
    if (job.status === 'ready') return job;

    const document = this.documents.get(job.document_id);
    if (!document) {
      return this.failJob(job.id, 'Document not found');
    }

    this.jobs.update(job.id, { status: 'running', progress: 2, total: 100, stage: 'metadata', error: null });
    this.documents.updateProcessing(document.id, {
      processing_status: 'processing',
      processing_stage: 'metadata',
      processing_error: null,
    });

    try {
      if (!existsSync(document.source_path)) {
        throw new Error(`Source PDF is missing: ${document.source_path}`);
      }
      const buffer = readFileSync(document.source_path);
      validatePdf(buffer);

      if (this.jobs.get(job.id)?.cancel_requested) return this.cancelJob(job.id, document.id);
      const extracted = await extractPdf(buffer);

      const hashDirectory = join(this.dataRoot, 'documents', document.hash);
      const extractedDirectory = join(hashDirectory, 'extracted');
      writePagesJsonl(join(extractedDirectory, 'pages.jsonl'), extracted.pages);
      writeReaderPdf(extractedDirectory, extracted);

      this.jobs.update(job.id, { progress: 24, stage: 'cover' });
      const coverPath = join(hashDirectory, 'cover.png');
      const coverGenerated = await generatePdfCover(buffer, coverPath);

      const classification = classifyTextLayer(extracted.pages);
      if (classification.classification === 'scanned') {
        const error = 'PDF has no usable text layer. OCR is not supported in this phase.';
        this.documents.updateProcessing(document.id, {
          processing_status: 'failed',
          processing_stage: 'text_layer',
          processing_error: error,
          text_layer: 'scanned',
          title: extracted.metadata.title ?? document.title,
          author: extracted.metadata.author,
          page_count: extracted.pageCount,
          cover_path: coverGenerated ? coverPath : document.cover_path,
          diagnostics_json: JSON.stringify(classification),
        });
        return this.failJob(job.id, error, 'text_layer');
      }

      this.jobs.update(job.id, { progress: 38, stage: 'outline' });
      const outline = extracted.nativeOutline.length > 0
        ? extracted.nativeOutline
        : fallbackOutline(extracted.pages, extracted.pageCount);
      const refinedOutline = extracted.nativeOutline.length > 0
        ? null
        : await this.refineOutlineWithModel(outline);
      const finalOutline = refinedOutline ?? outline;

      if (this.jobs.get(job.id)?.cancel_requested) return this.cancelJob(job.id, document.id);
      const sections = finalOutline.map((candidate, index) => ({
        level: candidate.level,
        title: candidate.title,
        startPage: candidate.startPage,
        endPage: Math.min(
          extracted.pageCount,
          finalOutline[index + 1]?.startPage ? Math.max(candidate.startPage, finalOutline[index + 1]!.startPage - 1) : extracted.pageCount,
        ),
        source: extracted.nativeOutline.length > 0 ? 'native_outline' : refinedOutline ? 'model_refined_outline' : 'deterministic_outline',
      }));

      this.documents.updateProcessing(document.id, {
        title: extracted.metadata.title ?? document.title,
        author: extracted.metadata.author,
        page_count: extracted.pageCount,
        cover_path: coverGenerated ? coverPath : document.cover_path,
        text_layer: classification.classification,
        metadata_json: JSON.stringify({ ...safeParse(document.metadata_json), ...extracted.metadata, textExtractionVersion: PDF_TEXT_VERSION }),
        diagnostics_json: JSON.stringify({ ...safeParse(document.diagnostics_json), ...classification, unicodeRepair: extracted.unicodeRepair }),
        processing_stage: 'indexing',
      });

      this.jobs.update(job.id, { progress: 58, stage: 'indexing' });
      const sectionRecords = this.sections.replaceAll(document.id, sections);
      const builtChunks = buildChunks(
        sectionRecords.map((section) => ({
          id: section.id,
          startPage: section.start_page,
          endPage: section.end_page,
        })),
        extracted.pages,
      );
      writeChunksJsonl(join(extractedDirectory, 'chunks.jsonl'), builtChunks);
      this.pages.replaceAll(document.id, extracted.pages);
      this.chunks.replaceAll(document.id, builtChunks);

      if (this.jobs.get(job.id)?.cancel_requested) return this.cancelJob(job.id, document.id);
      this.jobs.update(job.id, { progress: 82, stage: 'summary' });
      this.summaries.save({
        scope: 'book',
        targetId: document.id,
        projectId: job.project_id,
        documentId: document.id,
        status: 'pending',
      });

      this.documents.updateProcessing(document.id, {
        processing_status: 'ready',
        processing_stage: 'ready',
        processing_error: null,
      });
      if (job.project_id) {
        void this.summaryService?.generateBookSummary(job.project_id, document.id).catch(() => undefined);
      }
      return this.jobs.update(job.id, {
        status: 'ready',
        progress: 100,
        stage: 'ready',
        error: null,
      })!;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.documents.updateProcessing(document.id, {
        processing_status: 'failed',
        processing_error: message,
      });
      return this.failJob(job.id, message, this.jobs.get(job.id)?.stage ?? undefined);
    }
  }

  removeFromProject(projectId: string, documentId: string): boolean {
    return removeDocumentFromProject(this.database, projectId, documentId);
  }

  deletePermanent(documentId: string): boolean {
    const document = this.documents.get(documentId);
    if (!document) return false;
    permanentlyDeleteDocument(this.database, documentId);
    rmSync(join(this.dataRoot, 'documents', document.hash), { recursive: true, force: true });
    return true;
  }

  private enqueueImport(projectId: string, documentId: string): JobRecord {
    return this.jobs.enqueue({
      type: 'document_import',
      projectId,
      documentId,
      total: 100,
      stage: 'metadata',
      payload: { source: 'pdf_upload' },
    });
  }

  private async refineOutlineWithModel(baseOutline: OutlineCandidate[]): Promise<OutlineCandidate[] | null> {
    if (!this.providerConfig || baseOutline.length <= 1) return null;
    try {
      const providerFile = this.providerConfig.current;
      const client = new ModelClient(providerFile);
      const completion = await client.complete({
        tier: 'strong',
        messages: [
          {
            role: 'system',
            content: '你是 PDF 目录整理器。基于候选标题输出 JSON 数组，不要 Markdown。每一项必须是 {"title":string,"startPage":number,"level":number}。保持页码不变或更准确，层级合理，不要新增原文中没有的标题。',
          },
          {
            role: 'user',
            content: `候选目录：\n${JSON.stringify(baseOutline, null, 2)}\n请整理层级和标题。`,
          },
        ],
        maxTokens: 2000,
        temperature: 0,
      });
      const parsed = parseOutlineModelResponse(completion.content, baseOutline);
      return parsed.length > 0 ? parsed : null;
    } catch (error) {
      if (error instanceof ProviderConfigError) return null;
      return null;
    }
  }

  private activeJobForDocument(documentId: string): JobRecord | undefined {
    return this.jobs
      .list({ documentId })
      .find((job) => job.type === 'document_import' && (job.status === 'pending' || job.status === 'running'));
  }

  private failJob(jobId: string, message: string, stage?: string): JobRecord {
    const job = this.jobs.get(jobId);
    return this.jobs.update(jobId, {
      status: 'failed',
      stage: stage ?? job?.stage ?? 'failed',
      error: message,
      retry_count: (job?.retry_count ?? 0) + 1,
    })!;
  }

  private cancelJob(jobId: string, documentId: string): JobRecord {
    this.documents.updateProcessing(documentId, { processing_status: 'pending', processing_stage: 'cancelled' });
    return this.jobs.update(jobId, { status: 'cancelled', stage: 'cancelled', error: null })!;
  }
}

export class DocumentNotFoundError extends Error {
  constructor(message = 'Document not found') {
    super(message);
    this.name = 'DocumentNotFoundError';
  }
}

export function validatePdf(buffer: Buffer): void {
  if (buffer.length === 0) throw new Error('PDF file is empty');
  if (buffer.length > MAX_PDF_BYTES) throw new Error('PDF file is larger than 500 MB');
  if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    throw new Error('Only PDF files are supported');
  }
}

export function validatePdfFilename(filename: string): string {
  const safeFilename = basename(filename.trim()).trim();
  if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
    throw new Error('A valid PDF filename is required');
  }
  return safeFilename.replace(/[\\/]+/g, '-');
}

function parseOutlineModelResponse(value: string, baseOutline: readonly OutlineCandidate[]): OutlineCandidate[] {
  const trimmed = value.trim().replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const basePages = new Set(baseOutline.map((candidate) => candidate.startPage));
    return parsed
      .map((item): OutlineCandidate | null => {
        if (typeof item !== 'object' || item === null) return null;
        const candidate = item as Partial<OutlineCandidate>;
        if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) return null;
        if (typeof candidate.startPage !== 'number' || !Number.isFinite(candidate.startPage)) return null;
        const startPage = Math.floor(candidate.startPage);
        if (startPage < 1) return null;
        const level = typeof candidate.level === 'number' && Number.isFinite(candidate.level)
          ? Math.min(Math.max(Math.floor(candidate.level), 1), 6)
          : 1;
        return { title: candidate.title.trim().slice(0, 200), startPage, level };
      })
      .filter((item): item is OutlineCandidate => item !== null && basePages.has(item.startPage))
      .sort((left, right) => left.startPage - right.startPage || left.level - right.level);
  } catch {
    return [];
  }
}

function deriveTitle(filename: string): string {
  return filename.replace(/\.pdf$/iu, '').trim() || 'Untitled PDF';
}

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
