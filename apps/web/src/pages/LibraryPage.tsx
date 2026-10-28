import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { MarkdownContent } from '../components/MarkdownContent';
import { summaryReferences } from '@ai-reading-partner/core/references';

interface Project {
  id: string;
  name: string;
  document_count: number;
  last_activity_at: string | null;
}

interface DocumentItem {
  id: string;
  title: string;
  author: string | null;
  page_count: number;
  text_layer: 'text' | 'mixed' | 'scanned' | 'unknown';
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  processing_stage: string;
  processing_error: string | null;
  cover_path: string | null;
  added_at: string;
  current_page: number;
  percent: number;
  progress_updated_at: string | null;
}

interface JobItem {
  id: string;
  type: string;
  status: string;
  progress: number;
  total: number;
  stage: string | null;
  error: string | null;
  document_id: string | null;
  updated_at: string;
}

interface ProviderStatus {
  active: boolean;
  light_model: string | null;
  strong_model: string | null;
  error: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export default function LibraryPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [projectName, setProjectName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [projectSummary, setProjectSummary] = useState<{ markdown: string | null; status: string; structure_json?: string | null } | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  useEffect(() => {
    let cancelled = false; setProjectSummary(null);
    if (selectedProjectId) void api<typeof projectSummary>(`/api/projects/${selectedProjectId}/summary`).then((value) => { if (!cancelled) setProjectSummary(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [selectedProjectId]);
  const localized = (value: string) => ({ pending: '等待处理', processing: '处理中', running: '进行中', ready: '已就绪', failed: '失败', text: '文本 PDF', mixed: '混合 PDF', scanned: '扫描 PDF', unknown: '检测中', received: '已接收', metadata: '读取元信息', extraction: '提取文本', indexing: '构建索引', completed: '已完成', summary: '生成总结', outline: '分析目录', cover: '生成封面', cancelled: '已取消' } as Record<string, string>)[value] ?? '处理中';
  const visibleDocuments = useMemo(() => documents.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((first, second) => {
    const order = sort === 'title' ? first.title.localeCompare(second.title, 'zh') : sort === 'added' ? second.added_at.localeCompare(first.added_at) : (second.progress_updated_at ?? '').localeCompare(first.progress_updated_at ?? '');
    return order || second.added_at.localeCompare(first.added_at) || first.id.localeCompare(second.id);
  }), [documents, query, sort]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') document.querySelectorAll<HTMLDetailsElement>('.book-menu[open]').forEach((menu) => { menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus(); }); };
    document.addEventListener('keydown', dismiss); return () => document.removeEventListener('keydown', dismiss);
  }, []);

  const load = useCallback(async (projectId?: string) => {
    try {
      const [projectList, providerStatus] = await Promise.all([
        api<Project[]>('/api/projects'),
        api<ProviderStatus>('/api/providers/status'),
      ]);
      setProjects(projectList);
      setProvider(providerStatus);
      const nextProjectId = projectId ?? (selectedProjectId || projectList[0]?.id || '');
      setSelectedProjectId(nextProjectId);
      if (nextProjectId) {
        const [documentList, jobList] = await Promise.all([
          api<DocumentItem[]>(`/api/projects/${nextProjectId}/documents`),
          api<JobItem[]>(`/api/projects/${nextProjectId}/jobs`),
        ]);
        setDocuments(documentList);
        setJobs(jobList);
      } else {
        setDocuments([]);
        setJobs([]);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (selectedProjectId) void load(selectedProjectId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [load, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const createProject = async () => {
    if (!projectName.trim()) return;
    setBusy(true);
    try {
      const project = await api<Project>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName.trim() }),
      });
      setProjectName('');
      await load(project.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  };

  const importPdf = async (file: File) => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      await api(`/api/projects/${selectedProjectId}/documents`, { method: 'POST', body });
      await load(selectedProjectId);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (documentId: string) => {
    setBusy(true);
    try {
      await api(`/api/projects/${selectedProjectId}/documents/${documentId}/retry`, { method: 'POST' });
      await load(selectedProjectId);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : String(retryError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (documentId: string, permanent: boolean) => {
    if (permanent && !window.confirm('永久删除会移除共享源文件和解析数据，确定继续吗？')) return;
    setBusy(true);
    try {
      await api(`/api/projects/${selectedProjectId}/documents/${documentId}${permanent ? '?permanent=true' : ''}`, {
        method: 'DELETE',
      });
      await load(selectedProjectId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="library-page">
      <section className="library-toolbar">
        <div>
          <h1>项目文库</h1>
        </div>
        <div className="provider-state">
          {provider?.active
            ? `${provider.light_model} / ${provider.strong_model}`
            : 'AI 未配置，可先导入和阅读'}
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="library-controls">
        <label>
          项目
          <select
            value={selectedProjectId}
            onChange={(event) => void load(event.target.value)}
          >
            <option value="">请选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        <div className="inline-form">
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="新项目名称"
          />
          <button type="button" onClick={() => void createProject()} disabled={busy || !projectName.trim()}>
            创建项目
          </button>
        </div>
        <label className="import-control">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPdf(file);
              event.target.value = '';
            }}
            disabled={busy || !selectedProjectId}
          />
          导入 PDF
        </label>
      </section>

      {selectedProject ? (
        <>
          <div className="library-discovery"><input aria-label="搜索书名" placeholder="搜索书名" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select aria-label="书籍排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">书名</option></select></div>
          <details className="project-summary"><summary>项目概览</summary>
            {projectSummary?.markdown && <MarkdownContent sources={summaryReferences(projectSummary.structure_json)} targetExists={(target) => target.kind === 'doc' && documents.some((item) => item.id === target.id)} onNavigate={(target) => { if (target.kind === 'doc') window.location.assign(`/read/${selectedProject.id}/${target.id}#page=${target.page ?? 1}`); }}>{projectSummary.markdown}</MarkdownContent>}
            <button disabled={summaryBusy} onClick={() => { setSummaryBusy(true); void api<typeof projectSummary>(`/api/projects/${selectedProjectId}/summary`, { method: 'POST' }).then(setProjectSummary).catch((reason) => setError(reason.message)).finally(() => setSummaryBusy(false)); }}>{summaryBusy ? '生成中' : projectSummary?.markdown ? '更新项目总结' : '生成项目总结'}</button>
          </details>
          <section className="book-grid">
            {documents.length === 0 && (
              <div className="empty-state">还没有书籍。选择一个 PDF 开始导入。</div>
            )}
            {documents.length > 0 && !visibleDocuments.length && <div className="empty-state">没有匹配的书籍。</div>}
            {visibleDocuments.map((document) => {
              const jobsForDocument = jobs.filter((job) => job.document_id === document.id).slice(0, 3);
              return (
                <article key={document.id} className="book-card">
                  <div className="book-cover">
                    {document.cover_path
                      ? <img src={`/api/documents/${document.id}/cover.png`} alt={document.title} />
                      : <div className="cover-placeholder">PDF</div>}
                  </div>
                  <div className="book-body">
                    <h2>{document.title}</h2>
                    <p>{document.author ?? '未知作者'} · {document.page_count || '?'} 页</p>
                    <div className="book-meta">
                      <span className={`badge badge-${document.processing_status}`}>{localized(document.processing_status)}</span>
                      <span className="badge">{localized(document.text_layer)}</span>
                      <span>{localized(document.processing_stage)}</span>
                    </div>
                    <div className="progress-track" aria-label={`阅读进度 ${document.percent.toFixed(0)}%`}>
                      <span style={{ width: `${document.percent}%` }} />
                    </div>
                    <p className="progress-text">
                      第 {document.current_page} 页 · {document.percent.toFixed(0)}%
                      {document.progress_updated_at && ` · ${new Date(document.progress_updated_at).toLocaleString()}`}
                    </p>
                    {document.processing_error && <p className="error-text">{document.processing_error}</p>}
                    <div className="book-actions">
                      <Link to={`/read/${selectedProject.id}/${document.id}`} className="button primary">
                        {document.progress_updated_at ? '继续阅读' : '打开阅读'}
                      </Link>
                      <details className="book-menu"><summary className="icon-button" title="更多书籍操作" aria-label={`更多操作：${document.title}`}><MoreHorizontal size={18} /></summary><div className="book-menu-items">
                      <button type="button" onClick={() => void retry(document.id)} disabled={busy}>
                        重试处理
                      </button>
                      <button type="button" onClick={() => void remove(document.id, false)} disabled={busy}>
                        移出项目
                      </button>
                      <button type="button" className="danger" onClick={() => void remove(document.id, true)} disabled={busy}>
                        永久删除
                      </button>
                      </div></details>
                    </div>
                  </div>
                  {jobsForDocument.length > 0 && (
                    <ol className="job-timeline">
                      {jobsForDocument.map((job) => (
                        <li key={job.id}>
                          <strong>{localized(job.status)}</strong> · {job.stage ? localized(job.stage) : '等待处理'} · {job.progress}/{job.total}
                          {job.error && <span>{job.error}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              );
            })}
          </section>
        </>
      ) : (
        <div className="empty-state">创建或选择一个项目后即可管理书籍。</div>
      )}
    </div>
  );
}
