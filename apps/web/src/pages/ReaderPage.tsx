import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ArrowLeft, ArrowRight, Bookmark, Menu, MessageSquare, PanelLeftClose, PanelRightClose, X, ZoomIn, ZoomOut } from 'lucide-react';
import { MarkdownContent } from '../components/MarkdownContent';
import { ConversationPanel, type Shortcut } from '../components/ConversationPanel';
import type { QuoteSnapshot } from '../components/SelectionQuote';

interface DocumentDetail {
  id: string;
  hash: string;
  title: string;
  page_count: number;
  processing_status: string;
  processing_error: string | null;
  text_layer: 'text' | 'mixed' | 'scanned' | 'unknown';
  current_page: number;
  scroll_offset: number;
}

interface SectionItem {
  id: string;
  title: string;
  level: number;
  start_page: number;
  source: string;
}

interface AiActionResponse {
  answer: string;
  cached: boolean;
  promptVersion: string;
  modelId: string | null;
  providerId: string | null;
  sources: Array<{
    type: 'selection' | 'page' | 'chunk';
    page: number;
    excerpt: string;
  }>;
}

interface SummaryItem {
  id: string;
  scope: 'book' | 'section' | 'project';
  target_id: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  markdown: string | null;
  error: string | null;
}

interface NoteItem {
  id: string;
  title: string;
  markdown: string;
  source: 'user' | 'agent';
  status: 'ready' | 'missing_source';
  current_version: number;
  updated_at: string;
}

interface PageMetrics {
  page_number: number;
  char_count: number;
  has_text: number;
}

interface PageGeometry {
  width: number;
  height: number;
}

interface SelectionAnchor {
  page: number;
  text: string;
  normalizedText: string;
  hash: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset?: number;
  endOffset?: number;
  documentHash?: string;
  endPage?: number;
  fragments?: Array<{ page: number; text: string }>;
}

interface TermCacheItem {
  id: string;
  display_term: string;
  explanation: string;
}

interface ContentCacheItem {
  id: string;
  page_number: number;
  action: string;
  normalized_text: string;
  answer: string;
}

interface StableLinkToken {
  kind: 'term' | 'note' | 'doc' | 'section' | 'web';
  id: string;
  label: string;
  page?: number;
}

interface ProviderStatusItem {
  configured: boolean;
  active: boolean;
  searxng_configured: boolean;
  error: string | null;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(collapseWhitespace(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function locateSelection(haystack: string, needle: string): { start: number; end: number } | null {
  const normalizedHaystack = collapseWhitespace(haystack);
  const normalizedNeedle = collapseWhitespace(needle);
  const start = normalizedHaystack.indexOf(normalizedNeedle);
  if (start < 0) return null;
  return { start, end: start + normalizedNeedle.length };
}

async function buildSelectionAnchor(
  pageNumber: number,
  selectedText: string,
  pageText: string,
): Promise<SelectionAnchor> {
  const normalizedText = collapseWhitespace(selectedText);
  const location = locateSelection(pageText, selectedText);
  const quoteStart = Math.max(0, location?.start ?? 0);
  return {
    page: pageNumber,
    text: selectedText,
    normalizedText,
    hash: await hashText(selectedText),
    quote: normalizedText,
    prefix: collapseWhitespace(pageText).slice(Math.max(0, quoteStart - 80), quoteStart),
    suffix: collapseWhitespace(pageText).slice((location?.end ?? normalizedText.length), (location?.end ?? normalizedText.length) + 80),
    startOffset: location?.start,
    endOffset: location?.end,
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  return await response.json() as T;
}

export default function ReaderPage() {
  const { projectId, documentId } = useParams();
  const navigate = useNavigate();
  const [references, setReferences] = useState<Array<{ id: string; kind: string; documentId: string; page: number }>>([]);
  useEffect(() => {
    let cancelled = false;
    void api<typeof references>(`/api/projects/${projectId}/references`).then((value) => { if (!cancelled) setReferences(value); }).catch(() => { if (!cancelled) setReferences([]); });
    return () => { cancelled = true; };
  }, [projectId, documentId]);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const textLayerRefs = useRef(new Map<number, HTMLDivElement>());
  const pageRenderTasksRef = useRef(new Map<number, pdfjsLib.RenderTask>());
  const renderedScalesRef = useRef(new Map<number, number>());
  const pageTextsRef = useRef(new Map<number, string>());
  const termCachesRef = useRef<TermCacheItem[]>([]);
  const initialProgressRef = useRef<{ page: number; scrollOffset: number } | null>(null);
  const restoredRef = useRef(false);
  const pendingRenderRef = useRef(new Set<number>());
  const progressTimerRef = useRef<number | null>(null);
  const sectionSummaryRequestedRef = useRef(new Set<string>());
  const [documentDetail, setDocumentDetail] = useState<DocumentDetail | null>(null);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [pages, setPages] = useState<number[]>([]);
  const [pageSizes, setPageSizes] = useState<Record<number, PageGeometry>>({});
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set());
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [selection, setSelection] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [attachedQuote, setAttachedQuote] = useState<QuoteSnapshot | null>(null);
  const [shortcut, setShortcut] = useState<Shortcut | null>(null);
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const selectionRevision = useRef(0);
  const [editingNote, setEditingNote] = useState(false);
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);
  const [panels, setPanels] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem('reader-panels') ?? '{}');
      return { left: Math.min(360, Math.max(220, Number(value.left) || 250)), right: Math.min(480, Math.max(340, Number(value.right) || 380)), leftClosed: Boolean(value.leftClosed), rightClosed: Boolean(value.rightClosed) };
    } catch { return { left: 250, right: 380, leftClosed: false, rightClosed: false }; }
  });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const summaryScopeRef = useRef(documentId);
  summaryScopeRef.current = documentId;
  useEffect(() => { localStorage.setItem('reader-panels', JSON.stringify(panels)); }, [panels]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (window.innerWidth >= 1200) setDrawer(null);
      document.documentElement.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
    };
    viewport?.addEventListener('resize', resize); window.addEventListener('resize', resize); resize();
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = drawer === 'left' ? leftRef.current : rightRef.current;
    const center = workspaceRef.current?.querySelector<HTMLElement>('.reader-center');
    const header = document.querySelector<HTMLElement>('.app-header');
    if (center) center.inert = true;
    if (header) header.inert = true;
    panel?.querySelector<HTMLElement>('button,select,input,textarea,a')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(null); }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select')].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { if (center) center.inert = false; if (header) header.inert = false; document.removeEventListener('keydown', keys); previousFocus?.focus(); };
  }, [drawer]);
  const resizePanel = (side: 'left' | 'right', start: number) => {
    const initial = panels[side];
    const move = (event: PointerEvent) => setPanels((old) => ({ ...old, [side]: Math.min(side === 'left' ? 360 : 480, Math.max(side === 'left' ? 220 : 340, initial + (event.clientX - start) * (side === 'left' ? 1 : -1))) }));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };
  const [aiResult, setAiResult] = useState<AiActionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.2);
  const [stageWidth, setStageWidth] = useState(0);
  const [activeTab, setActiveTab] = useState<'directory' | 'summaries' | 'notes'>('directory');
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteMarkdown, setNoteMarkdown] = useState('');
  const [termCaches, setTermCaches] = useState<TermCacheItem[]>([]);
  const [contentCaches, setContentCaches] = useState<ContentCacheItem[]>([]);
  const [lowTextPages, setLowTextPages] = useState<Set<number>>(new Set());
  const [providerStatus, setProviderStatus] = useState<ProviderStatusItem | null>(null);
  const [agentMindmapUrl, setAgentMindmapUrl] = useState<string | null>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setStageWidth(container.clientWidth));
    setStageWidth(container.clientWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!projectId || !documentId) return;
    let cancelled = false;
    selectionRevision.current += 1;
    setAttachedQuote(null); setSelectionAnchor(null); setPopover(null); setShortcut(null);
    void (async () => {
      try {
        const detail = await api<DocumentDetail>(`/api/projects/${projectId}/documents/${documentId}`);
        const sectionList = await api<SectionItem[]>(`/api/documents/${documentId}/sections`);
        if (cancelled) return;
        const requestedPage = /^#page=(\d+)$/u.exec(window.location.hash)?.[1];
        initialProgressRef.current = requestedPage ? { page: Math.max(1, Math.min(detail.page_count, Number(requestedPage))), scrollOffset: 0 } : detail.current_page > 1 || detail.scroll_offset !== 0
          ? { page: detail.current_page, scrollOffset: detail.scroll_offset }
          : null;
        setDocumentDetail(detail);
        setSections(sectionList);
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, documentId]);

  useEffect(() => {
    if (!documentId || !summaries.some((summary) => summary.status === 'pending' || summary.status === 'processing')) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<SummaryItem[]>(`/api/documents/${documentId}/summaries`, { signal: controller.signal }).then((items) => {
        if (!cancelled) setSummaries(items);
      }).catch(() => undefined);
    }, 1000);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [documentId, summaries]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api<ProviderStatusItem>('/api/providers/status');
        if (!cancelled) setProviderStatus(status);
      } catch {
        // The reader remains usable even if provider diagnostics are unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId || !documentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [summaryList, noteList] = await Promise.all([
          api<SummaryItem[]>(`/api/documents/${documentId}/summaries`),
          api<NoteItem[]>(`/api/projects/${projectId}/notes`),
        ]);
        if (cancelled) return;
        setSummaries(summaryList);
        setNotes(noteList);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, documentId]);

  useEffect(() => {
    if (!projectId || !documentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [termList, contentList, metrics] = await Promise.all([
          api<TermCacheItem[]>(`/api/projects/${projectId}/term-cache`),
          api<ContentCacheItem[]>(`/api/projects/${projectId}/content-cache?document_id=${documentId}`),
          api<PageMetrics[]>(`/api/documents/${documentId}/page-metrics`),
        ]);
        if (cancelled) return;
        setTermCaches(termList);
        setContentCaches(contentList);
        setLowTextPages(new Set(metrics.filter((item) => !item.has_text || item.char_count < 40).map((item) => item.page_number)));
      } catch {
        // Cache and diagnostics are enhancements; do not block the reader if they are unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, documentId]);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url: `/api/documents/${documentId}/reader.pdf` }).promise;
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        const firstPage = await pdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const firstGeometry = { width: firstViewport.width, height: firstViewport.height };
        pdfRef.current = pdf;
        const nextPageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
        setPages(nextPageNumbers);
        setPageSizes(Object.fromEntries(nextPageNumbers.map((pageNumber) => [pageNumber, firstGeometry])));
        setRenderedPages(new Set());
        setSelection('');
        setSelectionAnchor(null);
        setAiResult(null);
        restoredRef.current = false;
        const progress = initialProgressRef.current;
        const startPage = Math.min(Math.max(progress?.page ?? 1, 1), pdf.numPages);
        setCurrentPage(startPage);
        setPageInput(String(startPage));
        setLoadingPdf(false);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      pageRenderTasksRef.current.forEach((task) => task.cancel());
      pageRenderTasksRef.current.clear();
      renderedScalesRef.current.clear();
      pageTextsRef.current.clear();
      pageRefs.current.clear();
      pendingRenderRef.current.clear();
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
      setLoadingPdf(true);
      setPages([]);
      setRenderedPages(new Set());
      void pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [documentId]);

  const markTermCache = useCallback((pageNumber: number) => {
    const textLayer = textLayerRefs.current.get(pageNumber);
    if (!textLayer) return;
    for (const term of termCachesRef.current) {
      const normalizedTerm = collapseWhitespace(term.display_term);
      if (!normalizedTerm || normalizedTerm.length > 100) continue;
      const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
      const replacements: Array<{ node: Text; index: number }> = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.parentElement?.closest('.term-cached')) continue;
        const index = node.data.toLowerCase().indexOf(normalizedTerm.toLowerCase());
        if (index >= 0) replacements.push({ node, index });
      }
      for (const replacement of replacements) {
        const { node, index } = replacement;
        const marker = document.createElement('mark');
        marker.className = 'term-cached';
        marker.title = '项目缓存词汇，点击查看解释';
        marker.textContent = node.data.slice(index, index + normalizedTerm.length);
        marker.addEventListener('click', (event) => {
          event.stopPropagation();
          setSelection(term.display_term);
          setSelectionAnchor(null);
          setAiResult({
            answer: term.explanation,
            cached: true,
            promptVersion: '',
            modelId: null,
            providerId: null,
            sources: [],
          });
        });
        const after = node.splitText(index + normalizedTerm.length);
        node.parentElement?.insertBefore(marker, after);
        node.data = node.data.slice(0, index);
      }
    }
  }, []);

  useEffect(() => {
    termCachesRef.current = termCaches;
    for (const pageNumber of renderedPages) markTermCache(pageNumber);
  }, [markTermCache, renderedPages, termCaches]);

  const renderPage = useCallback(async (pageNumber: number) => {
    const pdf = pdfRef.current;
    const canvas = canvasRefs.current.get(pageNumber);
    const textLayerContainer = textLayerRefs.current.get(pageNumber);
    if (!pdf || !canvas || !textLayerContainer) return;
    if (pageNumber < 1 || pageNumber > pdf.numPages) return;
    const targetWidth = Math.min(Math.max(stageWidth - 40, 1), 880) * scale / 1.2;
    if (renderedScalesRef.current.get(pageNumber) === targetWidth) return;
    if (pendingRenderRef.current.has(pageNumber)) return;

    pendingRenderRef.current.add(pageNumber);
    pageRenderTasksRef.current.get(pageNumber)?.cancel();
    try {
      const page = await pdf.getPage(pageNumber);
      const unscaledViewport = page.getViewport({ scale: 1 });
      const geometry = { width: unscaledViewport.width, height: unscaledViewport.height };
      setPageSizes((current) => (current[pageNumber] ? current : { ...current, [pageNumber]: geometry }));
      const viewport = page.getViewport({ scale: targetWidth / geometry.width });
      textLayerContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
      textLayerContainer.style.setProperty('--scale-round-x', '1px');
      textLayerContainer.style.setProperty('--scale-round-y', '1px');
      canvas.width = Math.floor(viewport.width * window.devicePixelRatio);
      canvas.height = Math.floor(viewport.height * window.devicePixelRatio);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      textLayerContainer.replaceChildren();
      const renderTask = page.render({ canvas, canvasContext: context, viewport });
      pageRenderTasksRef.current.set(pageNumber, renderTask);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      pageTextsRef.current.set(pageNumber, pageText);
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerContainer,
        viewport,
      });
      await textLayer.render();
      renderedScalesRef.current.set(pageNumber, targetWidth);
      setRenderedPages((current) => new Set(current).add(pageNumber));
      markTermCache(pageNumber);
    } catch (renderError) {
      if (renderError instanceof Error && renderError.name !== 'RenderingCancelledException') {
        setError(renderError instanceof Error ? renderError.message : String(renderError));
      }
    } finally {
      pendingRenderRef.current.delete(pageNumber);
    }
  }, [markTermCache, scale, stageWidth]);

  const updateVisiblePage = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const focusPoint = container.scrollTop + container.clientHeight * 0.35;
    let visiblePage = currentPage;
    for (const [pageNumber, element] of pageRefs.current.entries()) {
      if (element.offsetTop <= focusPoint) visiblePage = pageNumber;
    }
    if (visiblePage !== currentPage) {
      setCurrentPage(visiblePage);
      setPageInput(String(visiblePage));
    }
  }, [currentPage]);

  const renderVisiblePages = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pages.length === 0) return;
    const visiblePages = new Set<number>();
    for (const pageNumber of pages) {
      const element = pageRefs.current.get(pageNumber);
      if (!element) continue;
      const top = element.offsetTop - container.clientHeight;
      const bottom = element.offsetTop + element.offsetHeight + container.clientHeight;
      if (bottom >= container.scrollTop && top <= container.scrollTop + container.clientHeight) {
        visiblePages.add(pageNumber);
      }
    }
    if (visiblePages.size === 0 && currentPage >= 1 && currentPage <= pages.length) visiblePages.add(currentPage);
    void Promise.all(Array.from(visiblePages, (pageNumber) => renderPage(pageNumber)));
  }, [currentPage, pages, renderPage]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      updateVisiblePage();
      renderVisiblePages();
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = window.setTimeout(() => {
        void saveProgressRef.current?.();
      }, 1200);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [renderVisiblePages, updateVisiblePage]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(renderVisiblePages);
    return () => window.cancelAnimationFrame(frame);
  }, [pageSizes, pages, renderVisiblePages, scale]);

  useLayoutEffect(() => {
    if (pages.length === 0 || !documentDetail || restoredRef.current) return;
    const progress = initialProgressRef.current;
    const targetPage = progress?.page ?? currentPage;
    const element = pageRefs.current.get(targetPage);
    const container = scrollContainerRef.current;
    if (!element || !container) return;
    container.scrollTop = Math.max(0, element.offsetTop + (progress?.scrollOffset ?? 0));
    setCurrentPage(targetPage);
    setPageInput(String(targetPage));
    restoredRef.current = true;
    initialProgressRef.current = null;
    updateVisiblePage();
    renderVisiblePages();
  }, [currentPage, documentDetail, pages, renderVisiblePages, updateVisiblePage]);

  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !scrollContainerRef.current?.contains(event.target)) return;
      const activeSelection = window.getSelection();
      const text = activeSelection?.toString() ?? '';
      if (!text.trim()) {
        setPopover(null);
        return;
      }
      const range = activeSelection?.rangeCount ? activeSelection.getRangeAt(0) : null;
      const startElement = range?.startContainer.parentElement ?? null;
      const pageElement = startElement?.closest('[data-page-number]');
      const pageNumber = Number(pageElement?.getAttribute('data-page-number') ?? currentPage);
      const pageText = startElement?.closest('.textLayer')?.textContent ?? pageTextsRef.current.get(pageNumber) ?? '';
      setSelection(text);
      setSelectionAnchor(null);
      const revision = ++selectionRevision.current;
      const endPage = Number(range?.endContainer.parentElement?.closest('[data-page-number]')?.getAttribute('data-page-number') ?? pageNumber);
      const fragments: Array<{ page: number; text: string }> = [];
      if (range) for (const [page, layer] of textLayerRefs.current) {
        if (page >= pageNumber && page <= endPage) {
          const fragment = range.cloneRange();
          if (page !== pageNumber) fragment.setStart(layer, 0);
          if (page !== endPage) fragment.setEnd(layer, layer.childNodes.length);
          fragments.push({ page, text: fragment.toString() });
        }
      }
      void buildSelectionAnchor(pageNumber, text, pageText).then((anchor) => {
        if (revision !== selectionRevision.current) return;
        const snapshot = { ...anchor, documentHash: documentDetail?.hash, endPage, fragments };
        setSelectionAnchor(snapshot); setAttachedQuote(snapshot);
      });
      const bounds = scrollContainerRef.current?.getBoundingClientRect();
      const rects = range ? [...range.getClientRects()] : [];
      const rect = rects.find((item) => item.bottom > (bounds?.top ?? 0)) ?? range?.getBoundingClientRect();
      if (bounds && rect && window.matchMedia('(min-width: 1200px) and (pointer: fine)').matches) {
        setPopover({ x: Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - 224)), y: rect.top - 46 >= bounds.top ? rect.top - 46 : Math.min(bounds.bottom - 44, rect.bottom + 8) });
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    const hide = () => setPopover(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    const selectionChanged = () => { if (!window.getSelection()?.toString().trim()) hide(); };
    const keyboardSelection = (event: KeyboardEvent) => { if (event.key.startsWith('Arrow') && event.shiftKey) handleMouseUp({ target: window.getSelection()?.focusNode } as MouseEvent); };
    const stage = scrollContainerRef.current;
    stage?.addEventListener('scroll', hide);
    document.addEventListener('keydown', escape);
    document.addEventListener('keyup', keyboardSelection);
    document.addEventListener('selectionchange', selectionChanged);
    return () => { document.removeEventListener('mouseup', handleMouseUp); stage?.removeEventListener('scroll', hide); document.removeEventListener('keydown', escape); document.removeEventListener('keyup', keyboardSelection); document.removeEventListener('selectionchange', selectionChanged); };
  }, [currentPage, documentDetail]);

  const goToPage = (nextPage: number) => {
    if (!pdfRef.current) return;
    const bounded = Math.min(Math.max(1, nextPage), pdfRef.current.numPages);
    const element = pageRefs.current.get(bounded);
    if (element && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: Math.max(0, element.offsetTop - 16), behavior: 'smooth' });
    }
    setCurrentPage(bounded);
    setPageInput(String(bounded));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        goToPage(currentPage + (event.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage]);

  const saveProgress = useCallback(async (silent = false) => {
    if (!projectId || !documentId) return;
    try {
      await api(`/api/projects/${projectId}/documents/${documentId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_page: currentPage,
          scroll_offset: Math.max(
            0,
            Math.round((scrollContainerRef.current?.scrollTop ?? 0) - (pageRefs.current.get(currentPage)?.offsetTop ?? 0)),
          ),
          percent: pdfRef.current ? ((currentPage - 1) / pdfRef.current.numPages) * 100 : 0,
        }),
      });
      if (!silent) setError(null);
    } catch (saveError) {
      if (!silent) setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }, [currentPage, documentId, projectId]);

  const saveProgressRef = useRef(saveProgress);
  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  useEffect(() => {
    if (!restoredRef.current || pages.length === 0) return;
    const timer = window.setTimeout(() => {
      void saveProgressRef.current?.(true);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [currentPage, pages.length]);

  const selectNote = (note: NoteItem) => {
    setSelectedNoteId(note.id);
    setNoteTitle(note.title);
    setNoteMarkdown(note.markdown);
    setEditingNote(false);
    setActiveTab('notes');
  };

  const saveNote = async () => {
    if (!projectId) return;
    try {
      const body = JSON.stringify({ title: noteTitle.trim(), markdown: noteMarkdown });
      if (selectedNoteId) {
        await api(`/api/projects/${projectId}/notes/${selectedNoteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      } else {
        const note = await api<NoteItem>(`/api/projects/${projectId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        setSelectedNoteId(note.id);
      }
      const noteList = await api<NoteItem[]>(`/api/projects/${projectId}/notes`);
      setNotes(noteList);
      setEditingNote(false);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : String(noteError));
    }
  };

  const createDynamicNote = async () => {
    if (!projectId || !aiResult) return;
    try {
      const note = await api<NoteItem>(`/api/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selection.slice(0, 40) || '动态笔记',
          markdown: aiResult.answer,
        }),
      });
      const noteList = await api<NoteItem[]>(`/api/projects/${projectId}/notes`);
      setNotes(noteList);
      selectNote(note);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : String(noteError));
    }
  };

  const stableLinkTargetExists = (token: StableLinkToken): boolean => {
    if (token.kind === 'term') return termCaches.some((item) => item.id === token.id);
    if (token.kind === 'note') return notes.some((item) => item.id === token.id);
    if (token.kind === 'doc') return documentId === token.id || references.some((item) => item.kind === 'doc' && item.id === token.id);
    if (token.kind === 'section') return sections.some((item) => item.id === token.id) || references.some((item) => item.kind === 'section' && item.id === token.id);
    try {
      const url = new URL(token.id);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const followStableLink = (token: StableLinkToken) => {
    if (!stableLinkTargetExists(token)) {
      setError('目标源已删除或不可用。');
      return;
    }
    if (token.kind === 'term') {
      const term = termCaches.find((item) => item.id === token.id);
      if (!term) return;
      setSelection(term.display_term);
      setSelectionAnchor(null);
      setAiResult({
        answer: term.explanation,
        cached: true,
        promptVersion: '',
        modelId: null,
        providerId: null,
        sources: [],
      });
      return;
    }
    if (token.kind === 'note') {
      const note = notes.find((item) => item.id === token.id);
      if (note) selectNote(note);
      return;
    }
    if (token.kind === 'section') {
      const section = sections.find((item) => item.id === token.id);
      if (section) goToPage(section.start_page);
      else {
        const target = references.find((item) => item.id === token.id && item.kind === 'section');
        if (target) navigate(`/read/${projectId}/${target.documentId}#page=${target.page}`);
      }
      return;
    }
    if (token.kind === 'doc') { if (token.id === documentId) goToPage(token.page ?? 1); else navigate(`/read/${projectId}/${token.id}#page=${token.page ?? 1}`); return; }
    if (token.kind === 'web') {
      window.open(token.id, '_blank', 'noopener,noreferrer');
    }
  };

  useEffect(() => {
    if (!projectId || !documentId) return;
    const section = sections.find((item) => currentPage >= item.start_page && currentPage <= item.start_page + 20);
    if (!section) return;
    const summary = summaries.find((item) => item.scope === 'section' && item.target_id === section.id);
    if (summary || sectionSummaryRequestedRef.current.has(section.id)) return;
    sectionSummaryRequestedRef.current.add(section.id);
    void (async () => {
      try {
        await api(`/api/projects/${projectId}/documents/${documentId}/sections/${section.id}/summary`, {
          method: 'POST',
        });
        const summaryList = await api<SummaryItem[]>(`/api/documents/${documentId}/summaries`);
        setSummaries(summaryList);
      } catch {
        sectionSummaryRequestedRef.current.delete(section.id);
      }
    })();
  }, [currentPage, documentId, projectId, sections, summaries]);

  const generateAgentMindmap = async (noteId: string) => {
    if (!projectId) return;
    try {
      await api(`/api/projects/${projectId}/notes/${noteId}/mindmap`, { method: 'POST' });
      setAgentMindmapUrl(`/api/projects/${projectId}/notes/${noteId}/mindmap`);
      setError(null);
    } catch (mindmapError) {
      setError(mindmapError instanceof Error ? mindmapError.message : String(mindmapError));
    }
  };

  return (
    <div ref={workspaceRef} className={`reader-workspace${panels.leftClosed ? ' left-closed' : ''}${panels.rightClosed ? ' right-closed' : ''}${drawer ? ` drawer-${drawer}` : ''}`}
      style={{ '--left-width': `${panels.left}px`, '--right-width': `${panels.right}px` } as React.CSSProperties}>
      {drawer && <button className="drawer-backdrop" aria-label="关闭侧栏" onClick={() => setDrawer(null)} />}
      <aside ref={leftRef} className="reader-left" role={drawer === 'left' ? 'dialog' : undefined} aria-modal={drawer === 'left' || undefined} aria-label="目录与笔记">
        <button className="icon-button drawer-close" title="关闭侧栏" aria-label="关闭目录" onClick={() => setDrawer(null)}><X size={18} /></button>
        <nav className="left-tabs">
          <button
            type="button"
            className={activeTab === 'directory' ? 'active' : ''}
            onClick={() => setActiveTab('directory')}
          >
            目录
          </button>
          <button
            type="button"
            className={activeTab === 'summaries' ? 'active' : ''}
            onClick={() => setActiveTab('summaries')}
          >
            小结
          </button>
          <button
            type="button"
            className={activeTab === 'notes' ? 'active' : ''}
            onClick={() => setActiveTab('notes')}
          >
            笔记
          </button>
        </nav>

        {activeTab === 'directory' && (
          <div className="outline-list">
          {sections.length === 0 && <p className="muted">暂无目录。</p>}
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              style={{ paddingLeft: `${10 + (section.level - 1) * 12}px` }}
              onClick={() => goToPage(section.start_page)}
            >
              <span className="outline-title">{section.title}</span>
              <span className="outline-page">P{section.start_page}</span>
            </button>
          ))}
        </div>
        )}

        {activeTab === 'summaries' && (
          <div className="summary-list">
            {summaries.length === 0 && <p className="muted">暂无小结。</p>}
            {summaries.map((summary) => (
              <details key={summary.id} className="summary-item" open={summary.scope === 'book' || summary.target_id === sections.filter((section) => section.start_page <= currentPage).at(-1)?.id}>
                <summary><strong>{summary.scope === 'book' ? '全书总结' : summary.scope === 'project' ? '项目总结' : sections.find((section) => section.id === summary.target_id)?.title ?? '章节小结'}</strong>
                <span className={`badge badge-${summary.status}`}>{({ ready: '已完成', failed: '失败', pending: '等待生成', processing: '生成中' })[summary.status]}</span></summary>
                <MarkdownContent onNavigate={followStableLink} targetExists={stableLinkTargetExists} onPage={goToPage}>{summary.markdown ?? summary.error ?? '等待生成。'}</MarkdownContent>
                {summary.status === 'failed' && <button onClick={() => {
                  const owner = documentId;
                  void api<SummaryItem>(`/api/projects/${projectId}/documents/${documentId}/${summary.scope === 'book' ? 'summaries/book' : `sections/${summary.target_id}/summary`}`, { method: 'POST' })
                    .then((item) => { if (summaryScopeRef.current === owner) setSummaries((old) => old.map((value) => value.id === item.id ? item : value)); })
                    .catch((reason) => { if (summaryScopeRef.current === owner) setError(reason.message); });
                }}>重试小结</button>}
              </details>
            ))}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="notes-panel">
            <div className="notes-list">
              {notes.map((note) => (
                <button key={note.id} type="button" onClick={() => selectNote(note)}>
                  <span className="outline-title">{note.title}</span>
                  <span className="outline-page">v{note.current_version}</span>
                  {note.status === 'missing_source' && <span className="badge badge-failed">源已删除</span>}
                </button>
              ))}
            </div>
            <div className="note-editor">
              {!editingNote && <><h3>{noteTitle || '笔记'}</h3><div className="note-preview"><MarkdownContent onNavigate={followStableLink} targetExists={stableLinkTargetExists} onPage={goToPage}>{noteMarkdown}</MarkdownContent></div>
                <button onClick={() => setEditingNote(true)}>{selectedNoteId ? '编辑笔记' : '新建笔记'}</button>
                <button onClick={() => { setSelectedNoteId(''); setNoteTitle(''); setNoteMarkdown(''); setEditingNote(true); }}>新建</button></>}
              {editingNote && <><input
                value={noteTitle}
                onChange={(event) => setNoteTitle(event.target.value)}
                placeholder="笔记标题"
              />
              <textarea
                value={noteMarkdown}
                onChange={(event) => setNoteMarkdown(event.target.value)}
                rows={14}
              />
              <button type="button" onClick={() => void saveNote()}>
                {selectedNoteId ? '保存笔记' : '创建笔记'}
              </button>
              <button onClick={() => { const note = notes.find((item) => item.id === selectedNoteId); setNoteTitle(note?.title ?? ''); setNoteMarkdown(note?.markdown ?? ''); setEditingNote(false); }}>取消</button></>}
              {selectedNoteId && (
                <button type="button" onClick={() => void generateAgentMindmap(selectedNoteId)}>
                  生成脑图
                </button>
              )}
              {agentMindmapUrl && (
                <>
                  <a href={agentMindmapUrl} target="_blank" rel="noreferrer">打开脑图</a>
                  <a href={`${agentMindmapUrl}?download=1`} download>导出 HTML</a>
                </>
              )}
            </div>
          </div>
        )}
      </aside>
      <div className="panel-resizer left-resizer" role="separator" aria-label="调整目录宽度" aria-orientation="vertical" tabIndex={0}
        onPointerDown={(event) => { event.preventDefault(); resizePanel('left', event.clientX); }}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setPanels((old) => ({ ...old, left: Math.max(220, Math.min(360, old.left + (event.key === 'ArrowLeft' ? -10 : 10))) })); }} />

      <main className="reader-center">
        <header className="reader-toolbar">
          <div className="toolbar-icons"><Link to="/" className="icon-button" title="返回文库" aria-label="返回文库"><ArrowLeft size={18} /></Link>
          <button className="icon-button desktop-control" title="折叠目录" aria-label="折叠目录" onClick={() => setPanels((old) => ({ ...old, leftClosed: !old.leftClosed }))}><PanelLeftClose size={18} /></button>
          <button className="icon-button mobile-control" title="打开目录" aria-label="打开目录" onClick={() => setDrawer('left')}><Menu size={18} /></button></div>
          <div className="page-controls">
            <button type="button" aria-label="上一页" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              <ArrowLeft size={16} />
            </button>
            <form onSubmit={(event) => { event.preventDefault(); goToPage(Number(pageInput)); }}>
              <input
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                inputMode="numeric"
                aria-label="页码"
              />
            </form>
            <span className="muted">{currentPage} / {pdfRef.current?.numPages ?? documentDetail?.page_count ?? '—'}</span>
            <button type="button" aria-label="下一页" onClick={() => goToPage(currentPage + 1)}>
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="reader-actions">
            <button className="icon-button" title="缩小" aria-label="缩小" type="button" onClick={() => setScale((value) => Math.max(0.6, value - 0.1))}><ZoomOut size={16} /></button>
            <button className="icon-button" title="放大" aria-label="放大" type="button" onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}><ZoomIn size={16} /></button>
            <button className="icon-button" title="保存进度" aria-label="保存进度" type="button" onClick={() => void saveProgress()}><Bookmark size={16} /></button>
            <button className="icon-button desktop-control" title="折叠对话" aria-label="折叠对话" onClick={() => setPanels((old) => ({ ...old, rightClosed: !old.rightClosed }))}><PanelRightClose size={18} /></button>
            <button className="icon-button mobile-control" title="打开对话" aria-label="打开对话" onClick={() => setDrawer('right')}><MessageSquare size={18} /></button>
          </div>
        </header>

        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {documentDetail?.processing_error && (
          <div className="alert alert-error">{documentDetail.processing_error}</div>
        )}

        <div className="pdf-stage" ref={scrollContainerRef}>
          {loadingPdf && <div className="pdf-loading">正在加载 PDF…</div>}
          {pages.map((pageNumber) => {
            const geometry = pageSizes[pageNumber];
            const pageContentCaches = contentCaches.filter((item) => item.page_number === pageNumber);
            return (
              <div
                key={pageNumber}
                ref={(element) => {
                  if (element) pageRefs.current.set(pageNumber, element);
                  else pageRefs.current.delete(pageNumber);
                }}
                className={`pdf-container${currentPage === pageNumber ? ' active' : ''}`}
                data-page-number={pageNumber}
                style={geometry ? {
                  aspectRatio: `${geometry.width} / ${geometry.height}`,
                  width: `${Math.min(Math.max(stageWidth - 40, 1), 880) * scale / 1.2}px`,
                } : undefined}
              >
                <div className="page-meta">
                  <span>第 {pageNumber} 页{lowTextPages.has(pageNumber) ? ' · 文本层稀疏' : ''}</span>
                  {pageContentCaches.map((cache) => (
                    <button
                      key={cache.id}
                      type="button"
                      className="content-cache-marker"
                      title={cache.normalized_text.slice(0, 120)}
                      onClick={() => setAiResult({
                        answer: cache.answer,
                        cached: true,
                        promptVersion: '',
                        modelId: null,
                        providerId: null,
                        sources: [],
                      })}
                    >
                      {cache.action === 'vocabulary_explanation' ? '词汇' : cache.action === 'content_interpretation' ? '解读' : '问答'}
                    </button>
                  ))}
                </div>
                <canvas
                  ref={(element) => {
                    if (element) canvasRefs.current.set(pageNumber, element);
                    else canvasRefs.current.delete(pageNumber);
                  }}
                />
                <div
                  ref={(element) => {
                    if (element) textLayerRefs.current.set(pageNumber, element);
                    else textLayerRefs.current.delete(pageNumber);
                  }}
                  className="textLayer"
                />
              </div>
            );
          })}
        </div>
      </main>

      <div className="panel-resizer right-resizer" role="separator" aria-label="调整对话宽度" aria-orientation="vertical" tabIndex={0}
        onPointerDown={(event) => { event.preventDefault(); resizePanel('right', event.clientX); }}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setPanels((old) => ({ ...old, right: Math.max(340, Math.min(480, old.right + (event.key === 'ArrowLeft' ? 10 : -10))) })); }} />
      <aside ref={rightRef} className="reader-right" role={drawer === 'right' ? 'dialog' : undefined} aria-modal={drawer === 'right' || undefined} aria-label="阅读对话">
        <button className="icon-button drawer-close" title="关闭侧栏" aria-label="关闭对话" onClick={() => setDrawer(null)}><X size={18} /></button>
        {providerStatus && !providerStatus.configured && <div className="inline-error provider-warning">模型未配置。可继续阅读和查看历史，请在本地 providers.toml 配置模型。</div>}
        {providerStatus?.configured && !providerStatus.searxng_configured && <div className="muted provider-warning">联网搜索未配置，本地问答可用。</div>}
        {projectId && documentId && <ConversationPanel key={`${projectId}:${documentId}`} projectId={projectId} documentId={documentId} quote={attachedQuote} shortcut={shortcut} onPage={goToPage}
          onNavigate={followStableLink} targetExists={stableLinkTargetExists}
          onSaved={() => { void api<NoteItem[]>(`/api/projects/${projectId}/notes`).then(setNotes).catch((reason) => setError(reason.message)); }}
          onCompleted={() => { void Promise.all([api<TermCacheItem[]>(`/api/projects/${projectId}/term-cache`), api<ContentCacheItem[]>(`/api/projects/${projectId}/content-cache?document_id=${documentId}`)]).then(([terms, contents]) => { setTermCaches(terms); setContentCaches(contents); }).catch((reason) => setError(reason.message)); }} />}
      </aside>
      {popover && selectionAnchor && <div className="selection-popover" role="toolbar" aria-label="选区快捷操作" style={{ left: popover.x, top: popover.y }} onPointerDown={(event) => event.preventDefault()}>
        <button onClick={() => { setShortcut({ id: crypto.randomUUID(), action: 'vocabulary_explanation', quote: selectionAnchor }); setPopover(null); }}>名词解释</button>
        <button onClick={() => { setShortcut({ id: crypto.randomUUID(), action: 'content_interpretation', quote: selectionAnchor }); setPopover(null); }}>深度解读</button>
      </div>}
      {aiResult && <div className="cache-preview" role="dialog" aria-modal="true" aria-label="缓存解释"><header><strong>历史解释</strong><button className="icon-button" title="关闭解释" aria-label="关闭解释" onClick={() => setAiResult(null)}><X size={16} /></button></header>
        <MarkdownContent onNavigate={followStableLink} targetExists={stableLinkTargetExists} onPage={goToPage}>{aiResult.answer}</MarkdownContent>
        <button onClick={() => void createDynamicNote()}>保存为动态笔记</button>
      </div>}
    </div>
  );
}
