import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Copy, FilePlus, Globe, Network, Plus, RotateCcw, Settings2, Square, X } from 'lucide-react';
import { MarkdownContent, type StableTarget } from './MarkdownContent';
import { serializeReferences } from '@ai-reading-partner/core/references';
import { SelectionQuote, type QuoteSnapshot } from './SelectionQuote';

interface Conversation { id: string; title: string; web_enabled: number }
interface Message {
  id: string; ordinal: number; role: 'user' | 'assistant'; markdown: string; status: string; action: string;
  quote_json: string | null; parents_json: string; reply_to: string | null; metadata_json: string; sequence: number; error: string | null;
}
interface Draft { text: string; quote?: QuoteSnapshot; parents: string[] }
interface HistoryPreferences { policy: 'smart' | 'none' | 'recent-one'; maxRounds: number; maxTokens: number }
export interface Shortcut { id: string; action: string; quote: QuoteSnapshot }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error || `请求失败（${response.status}）`); }
  return response.json() as Promise<T>;
}
const emptyDraft = (): Draft => ({ text: '', parents: [] });

export function ConversationPanel({ projectId, documentId, quote, shortcut, onPage, onNavigate, targetExists, onSaved, onCompleted }: {
  projectId: string; documentId: string; quote: QuoteSnapshot | null; shortcut: Shortcut | null;
  onPage: (page: number) => void; onNavigate: (target: StableTarget) => void; targetExists: (target: StableTarget) => boolean;
  onSaved: () => void; onCompleted: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [research, setResearch] = useState(false);
  const [settings, setSettings] = useState(false);
  const [preferences, setPreferences] = useState<HistoryPreferences>({ policy: 'smart', maxRounds: 1, maxTokens: 1000 });
  const [atBottom, setAtBottom] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastComposition = useRef(0);
  const consumedShortcut = useRef('');
  const consumedQuote = useRef<QuoteSnapshot | null>(null);
  const activeRef = useRef(activeId);
  const nearBottom = useRef(true);
  const requestId = useRef<string | null>(null);
  activeRef.current = activeId;
  const base = `/api/projects/${projectId}/conversations/${activeId}`;
  const draft = drafts[activeId] ?? emptyDraft();
  const active = conversations.find((item) => item.id === activeId);
  const busy = sending || messages.some((item) => ['pending', 'streaming'].includes(item.status));
  const updateDraft = (patch: Partial<Draft>) => setDrafts((old) => ({ ...old, [activeId]: { ...(old[activeId] ?? emptyDraft()), ...patch } }));

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const items = await request<Conversation[]>(`/api/projects/${projectId}/documents/${documentId}/conversations`);
      const available = items.length ? items : [await request<Conversation>(`/api/projects/${projectId}/documents/${documentId}/conversations`, 'POST', {})];
      if (cancelled) return;
      setConversations(available);
      const saved = localStorage.getItem(`conversation:${projectId}:${documentId}`);
      setActiveId(available.find((item) => item.id === saved)?.id ?? available[0]!.id);
      setPreferences(await request<HistoryPreferences>('/api/reader-preferences'));
    };
    void initialize().catch((reason) => { if (!cancelled) setError(String(reason.message)); });
    return () => { cancelled = true; };
  }, [projectId, documentId]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setMessages([]); setCursor(null); setError(''); nearBottom.current = true;
    localStorage.setItem(`conversation:${projectId}:${documentId}`, activeId);
    const savedDraft = sessionStorage.getItem(`draft:${activeId}`);
    if (savedDraft) { try { setDrafts((old) => ({ ...old, [activeId]: JSON.parse(savedDraft) })); } catch { /* invalid draft */ } }
    void request<{ messages: Message[]; nextCursor: number | null }>(`${base}/messages`).then((value) => {
      if (!cancelled) { setMessages(value.messages); setCursor(value.nextCursor); }
    }).catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [activeId, base, documentId, projectId]);

  useEffect(() => { if (activeId) sessionStorage.setItem(`draft:${activeId}`, JSON.stringify(draft)); }, [activeId, draft]);
  useEffect(() => {
    if (quote && activeId && quote !== consumedQuote.current) {
      consumedQuote.current = quote;
      updateDraft({ quote });
    }
  }, [quote, activeId]);

  const activeMessage = messages.find((item) => ['pending', 'streaming'].includes(item.status));
  useEffect(() => {
    if (!activeMessage) return;
    const owner = activeId;
    const stream = new EventSource(`${base}/messages/${activeMessage.id}/events`);
    const snapshot = (event: Event) => {
      const value = JSON.parse((event as MessageEvent).data) as Message;
      if (owner !== activeRef.current) return;
      setMessages((old) => old.map((item) => item.id === value.id && value.sequence >= item.sequence ? value : item));
      if (!['pending', 'streaming'].includes(value.status)) { stream.close(); onCompleted(); }
    };
    stream.addEventListener('snapshot', snapshot);
    stream.addEventListener('status', snapshot);
    stream.addEventListener('delta', (event) => {
      const value = JSON.parse((event as MessageEvent).data) as { id: string; sequence: number; delta: string };
      if (owner !== activeRef.current) return;
      setMessages((old) => old.map((item) => item.id === value.id && value.sequence > item.sequence ? { ...item, markdown: item.markdown + value.delta, sequence: value.sequence } : item));
    });
    stream.onerror = () => { if (stream.readyState === EventSource.CLOSED && owner === activeRef.current) setError('连接已断开，重新载入会话以恢复回答'); };
    return () => stream.close();
  }, [activeMessage?.id, activeId, base]);

  useLayoutEffect(() => { if (nearBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages]);

  const send = async (action = 'custom_question', selected = draft.quote, retry?: Message) => {
    if (!activeId || busy || (!draft.text.trim() && !selected && !retry)) return;
    const owner = activeId;
    const original = retry ? messages.find((item) => item.id === retry.reply_to) : null;
    const body = { requestId: requestId.current ?? crypto.randomUUID(), action: retry?.action ?? action,
      text: original?.markdown ?? (action === 'custom_question' ? draft.text : ''), quote: original?.quote_json ? JSON.parse(original.quote_json) : selected,
      parents: original ? JSON.parse(original.parents_json) : draft.parents, retryOf: retry?.id, forceAgent: research };
    requestId.current = body.requestId;
    setSending(true); setError('');
    try {
      const pair = await request<{ user: Message; assistant: Message }>(`${base}/messages`, 'POST', body);
      requestId.current = null;
      setDrafts((old) => ({ ...old, [owner]: emptyDraft() }));
      if (owner === activeRef.current) {
        nearBottom.current = true; setAtBottom(true);
        setMessages((old) => [...old.filter((item) => item.id !== pair.user.id && item.id !== pair.assistant.id), pair.user, pair.assistant]);
      }
    } catch (reason) {
      requestId.current = null;
      if (owner === activeRef.current) setError(reason instanceof Error ? reason.message : '发送失败');
    } finally { setSending(false); }
  };

  useEffect(() => {
    if (!shortcut || !activeId || busy || consumedShortcut.current === shortcut.id) return;
    consumedShortcut.current = shortcut.id;
    void send(shortcut.action, shortcut.quote);
  }, [shortcut, activeId, busy]);

  const save = async (message: Message) => {
    try {
      const note = await request<{ id: string }>(`${base}/messages/${message.id}/note`, 'POST');
      setMessages((old) => old.map((item) => item.id === message.id ? { ...item, metadata_json: JSON.stringify({ ...JSON.parse(item.metadata_json), noteId: note.id }) } : item));
      onSaved();
    } catch (reason) { setError(String(reason)); }
  };
  const loadOlder = async () => {
    if (!cursor || !list.current) return;
    const owner = activeId;
    const height = list.current.scrollHeight;
    const top = list.current.scrollTop;
    try {
      const result = await request<{ messages: Message[]; nextCursor: number | null }>(`${base}/messages?before=${cursor}`);
      if (owner !== activeRef.current) return;
      nearBottom.current = false;
      setMessages((old) => [...result.messages, ...old]); setCursor(result.nextCursor);
      requestAnimationFrame(() => { if (list.current) list.current.scrollTop = top + list.current.scrollHeight - height; });
    } catch (reason) { setError(String(reason)); }
  };
  return <div className="conversation-panel">
    <header className="conversation-header"><strong>阅读助手</strong><div className="toolbar-icons">
      <button className="icon-button" title="上下文设置" aria-label="上下文设置" onClick={() => setSettings(!settings)}><Settings2 size={17} /></button>
      <button className="icon-button" title="新建会话" aria-label="新建会话" onClick={() => {
        void request<Conversation>(`/api/projects/${projectId}/documents/${documentId}/conversations`, 'POST', { title: `会话 ${conversations.length + 1}` }).then((value) => { setConversations((old) => [value, ...old]); setActiveId(value.id); }).catch((reason) => setError(reason.message));
      }}><Plus size={18} /></button></div></header>
    <select className="conversation-select" aria-label="切换会话" value={activeId} onChange={(event) => setActiveId(event.target.value)}>{conversations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
    {settings && <div className="context-settings"><label>历史策略<select value={preferences.policy} onChange={(event) => setPreferences({ ...preferences, policy: event.target.value as HistoryPreferences['policy'] })}>
      <option value="smart">智能关联</option><option value="none">不携带历史</option><option value="recent-one">最近一轮</option></select></label>
      <label>最大轮数<input type="number" min={0} max={2} value={preferences.maxRounds} onChange={(event) => setPreferences({ ...preferences, maxRounds: Number(event.target.value) })} /></label>
      <label>历史 token 上限<input type="number" min={0} max={1500} step={100} value={preferences.maxTokens} onChange={(event) => setPreferences({ ...preferences, maxTokens: Number(event.target.value) })} /></label>
      <button onClick={() => { void request<HistoryPreferences>('/api/reader-preferences', 'PUT', preferences).then((value) => { setPreferences(value); setSettings(false); }).catch((reason) => setError(reason.message)); }}>保存设置</button></div>}
    <div className="message-list" ref={list} onScroll={() => { const element = list.current!; const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80; nearBottom.current = bottom; setAtBottom(bottom); }}>
      {cursor && <button className="load-older" onClick={() => void loadOlder()}>加载较早消息</button>}
      {!messages.length && <div className="chat-empty"><BookOpen size={28} /><p>从这本书开始对话</p></div>}
      {messages.map((message) => {
        const metadata = JSON.parse(message.metadata_json);
        const selected: QuoteSnapshot | null = message.quote_json ? JSON.parse(message.quote_json) : null;
        return <article key={message.id} className={`chat-message ${message.role}`} data-message-id={message.id} data-status={message.status}>
          <header><strong>{message.role === 'user' ? '你' : '阅读助手'}</strong><span className="muted">{metadata.cached ? '本地缓存' : ''}{({ pending: '等待生成', streaming: '正在生成', cancelled: '已停止', failed: '生成失败' } as Record<string, string>)[message.status]}</span></header>
          {selected && message.role === 'user' && <SelectionQuote quote={selected} onNavigate={() => onPage(selected.page)} />}
          <MarkdownContent sources={metadata.sources ?? []} onNavigate={onNavigate} targetExists={targetExists} onPage={onPage}>{message.markdown}</MarkdownContent>
          {metadata.webSearch?.warning && <p className="retrieval-status" role="status">{metadata.webSearch.warning}</p>}
          {message.error && <p className="inline-error" role="alert">{message.error}</p>}
          {metadata.historyOmitted && <p className="muted">历史超出预算，未带入本次请求。</p>}
          {metadata.runId && <details className="research-timeline"><summary>研究过程</summary>{metadata.steps?.map((step: { id: string; title: string; payload_json: string }) => {
            const proposal = JSON.parse(step.payload_json).observation;
            return <div key={step.id}><p>{step.title}</p>{proposal?.confirmation_required && <div className="write-confirmation">
              <span>{proposal.action === 'delete_note' ? '删除笔记' : '重写笔记'} · {proposal.title ?? proposal.note_id}</span>
              {proposal.pending_markdown && <details><summary>查看修改内容</summary><MarkdownContent>{proposal.pending_markdown}</MarkdownContent></details>}
              {metadata.confirmations?.includes(step.id) ? <span>已确认执行</span> : <button onClick={() => {
                if (!window.confirm(proposal.action === 'delete_note' ? '确定删除此笔记？' : '确定重写此笔记？')) return;
                void request<Message>(`${base}/messages/${message.id}/confirm`, 'POST', { stepId: step.id }).then((value) => { setMessages((old) => old.map((item) => item.id === value.id ? value : item)); onSaved(); }).catch((reason) => setError(reason.message));
              }}>确认执行</button>}
            </div>}</div>;
          })}<a href={`/api/projects/${projectId}/agent/runs/${metadata.runId}`} target="_blank" rel="noreferrer">运行记录</a></details>}
          {message.role === 'assistant' && !message.markdown.includes('[[ref:') && <div className="message-sources">{metadata.sources?.map((source: { page?: number; documentId?: string; title?: string; url?: string; id?: string }, index: number) => {
            if (source.page) {
              const target: StableTarget = { kind: 'doc', id: source.documentId ?? documentId, label: source.title ?? `P${source.page}`, page: source.page };
              const exists = targetExists(target);
              return <button key={index} className={`stable-link${exists ? '' : ' missing-source'}`} disabled={!exists} title={exists ? target.label : '目标源已失效'} onClick={() => onNavigate(target)}>{source.documentId && source.documentId !== documentId ? `${source.title ?? '跨书来源'} · ` : ''}P{source.page}{!exists && '（源已失效）'}</button>;
            }
            const url = source.url ?? (source.id?.startsWith('web:') ? source.id.slice(4) : '');
            return /^https?:\/\//u.test(url) ? <a key={index} href={url} target="_blank" rel="noreferrer">来源 {index + 1}</a> : null;
          })}</div>}
          {message.role === 'assistant' && !['pending', 'streaming'].includes(message.status) && <footer className="message-controls">
            {message.status === 'completed' && <><button title="追问此回答" onClick={() => updateDraft({ parents: draft.parents.includes(message.id) ? draft.parents : [...draft.parents, message.id].slice(-2) })}>追问</button>
              <button className="icon-button" title="复制回答" aria-label="复制回答" onClick={() => { void navigator.clipboard.writeText(serializeReferences(message.markdown, metadata.sources ?? [])).catch(() => setError('复制失败')); }}><Copy size={14} /></button>
              <button className="icon-button" title="保存为笔记" aria-label="保存为笔记" onClick={() => void save(message)}><FilePlus size={14} /></button></>}
            {message.status === 'completed' && <button className="icon-button" title="生成脑图" aria-label="生成脑图" onClick={() => {
              void request<{ noteId?: string }>(`${base}/messages/${message.id}/mindmap`, 'POST').then(() => request<{ id: string }>(`${base}/messages/${message.id}/note`, 'POST')).then((note) => {
                setMessages((old) => old.map((item) => item.id === message.id ? { ...item, metadata_json: JSON.stringify({ ...JSON.parse(item.metadata_json), noteId: note.id, mindmap: true }) } : item)); onSaved();
              }).catch((reason) => setError(reason.message));
            }}><Network size={14} /></button>}
            {metadata.noteId && metadata.mindmap && <a href={`/api/projects/${projectId}/notes/${metadata.noteId}/mindmap`} target="_blank" rel="noreferrer">打开脑图</a>}
            <button className="icon-button" title="重新生成" aria-label="重新生成" disabled={busy} onClick={() => void send(message.action, undefined, message)}><RotateCcw size={14} /></button>
          </footer>}
        </article>;
      })}
    </div>
    {!atBottom && <button className="return-latest" onClick={() => { nearBottom.current = true; setAtBottom(true); list.current?.scrollTo({ top: list.current.scrollHeight }); }}><ArrowDown size={14} />最新消息</button>}
    <div className="chat-composer">
      {error && <div className="inline-error" role="alert">{error}<button className="icon-button" aria-label="关闭错误" title="关闭错误" onClick={() => setError('')}><X size={14} /></button></div>}
      {draft.quote && <SelectionQuote quote={draft.quote} onRemove={() => updateDraft({ quote: undefined })} onNavigate={() => onPage(draft.quote!.page)} />}
      {draft.parents.length > 0 && <div className="followup-target"><span title={draft.parents.map((id) => messages.find((item) => item.id === id)?.markdown ?? '').join('\n')}>追问：{draft.parents.map((id) => messages.find((item) => item.id === id)?.markdown.replace(/[#*\n]/gu, '').slice(0, 24)).join('；')}</span><button className="icon-button" title="移除追问关联" aria-label="移除追问关联" onClick={() => updateDraft({ parents: [] })}><X size={14} /></button></div>}
      <div className="selection-shortcuts"><button disabled={!draft.quote || busy} onClick={() => void send('vocabulary_explanation')}>词汇解释</button><button disabled={!draft.quote || busy} onClick={() => void send('content_interpretation')}>深度解读</button></div>
      <textarea aria-label="问题" placeholder="询问这本书…" value={draft.text} onChange={(event) => updateDraft({ text: event.target.value })} rows={3}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; lastComposition.current = Date.now(); }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229 && Date.now() - lastComposition.current > 80) { event.preventDefault(); void send(); } }} />
      <div className="composer-toolbar"><div className="toolbar-icons"><button className={`icon-button${active?.web_enabled ? ' enabled' : ''}`} title={active?.web_enabled ? '关闭本会话联网' : '开启本会话联网'} aria-label="联网" aria-pressed={Boolean(active?.web_enabled)} onClick={() => { void request<Conversation>(base, 'PATCH', { webEnabled: !active?.web_enabled }).then((value) => setConversations((old) => old.map((item) => item.id === value.id ? value : item))).catch((reason) => setError(reason.message)); }}><Globe size={17} /></button>
        <label className="research-toggle"><input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} />深度研究</label></div>
        {activeMessage ? <button className="icon-button send-button" title="停止生成" aria-label="停止生成" onClick={() => { void request(`${base}/messages/${activeMessage.id}/cancel`, 'POST').catch((reason) => setError(reason.message)); }}><Square size={16} /></button>
          : <button className="icon-button send-button" title="发送" aria-label="发送" disabled={busy || (!draft.text.trim() && !draft.quote)} onClick={() => void send()}><ArrowUp size={18} /></button>}
      </div>
    </div>
  </div>;
}
