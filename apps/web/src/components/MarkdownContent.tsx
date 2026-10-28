import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Globe } from 'lucide-react';
import { referenceLabel, referencePageLabel, safeWebUrl, type SourceReference } from '@ai-reading-partner/core/references';

export interface StableTarget { kind: 'term' | 'note' | 'doc' | 'section' | 'web'; id: string; label: string; page?: number }

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }

function ReferenceBadge({ source, label, exists, url, description, onNavigate, target }: {
  source: SourceReference; label: ReactNode; exists: boolean; url: string | null; description: string;
  onNavigate?: (target: StableTarget) => void; target: StableTarget;
}) {
  const tooltipId = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [position]);
  const show = (event: SyntheticEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 16);
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 230)) });
  };
  const Icon = source.source === 'web' ? Globe : BookOpen;
  const content = <><Icon size={12} aria-hidden="true" /><span>{label}</span></>;
  const events = { onMouseEnter: show, onFocus: show, onMouseLeave: () => setPosition(null), onBlur: () => setPosition(null) };
  return <>{source.source === 'web' && exists
    ? <a {...events} className="source-reference" href={url!} title={description} aria-label={description} aria-describedby={position ? tooltipId : undefined} target="_blank" rel="noopener noreferrer">{content}</a>
    : <button {...events} type="button" className={`source-reference${exists ? '' : ' missing-source'}`} aria-label={description} title={description} aria-describedby={position ? tooltipId : undefined}
      aria-disabled={!exists} onClick={() => { if (exists) onNavigate?.(target); }}>{content}</button>}
    {position && createPortal(<span id={tooltipId} className="reference-tooltip reference-tooltip-visible" role="tooltip" style={position}>{description}</span>, document.body)}
  </>;
}

function remarkStableLinks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === 'link' || node.type === 'linkReference') return;
      const merged: MarkdownNode[] = [];
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index]!;
        const previous = merged.at(-1);
        const following = node.children[index + 1];
        if (child.type === 'link' && child.url && previous?.type === 'text' && /\[\[web:$/u.test(previous.value ?? '')
          && following?.type === 'text' && following.value?.startsWith(']]')
          && child.children?.length === 1 && child.children[0]?.type === 'text' && child.children[0].value === child.url) {
          previous.value += child.url + following.value;
          index++;
        } else merged.push(child);
      }
      node.children = merged;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child]; }
        const parts: MarkdownNode[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\[\[(term|note|doc|section|web|ref):([^|\]]+)(?:\|([^\]]+))?\]\]/gu)) {
          if (match.index! > offset) parts.push({ type: 'text', value: child.value.slice(offset, match.index) });
          parts.push({ type: 'link', url: `#stable-${match[1]}-${encodeURIComponent(match[2]!)}`, children: [{ type: 'text', value: match[3] || match[2]! }] });
          offset = match.index! + match[0].length;
        }
        if (!parts.length) return [child];
        if (offset < child.value.length) parts.push({ type: 'text', value: child.value.slice(offset) });
        return parts;
      });
    };
    visit(tree);
  };
}

export function MarkdownContent({ children, onNavigate, targetExists, onPage, sources = [] }: {
  children: string; onNavigate?: (target: StableTarget) => void;
  sources?: SourceReference[];
  targetExists?: (target: StableTarget) => boolean; onPage?: (page: number) => void;
}) {
  const latest = useRef({ onNavigate, targetExists, onPage, sources });
  latest.current = { onNavigate, targetExists, onPage, sources };
  const components = useMemo<Components>(() => ({
      img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '未加载'}]</span>,
      table: ({ children: content }) => <div className="markdown-table"><table>{content}</table></div>,
      a: ({ href, children: label }) => {
        const { onNavigate, targetExists, onPage, sources } = latest.current;
        const reference = /^#stable-ref-(.*)$/u.exec(href ?? '');
        if (reference) {
          let id = '';
          try { id = decodeURIComponent(reference[1]!); } catch { return <span className="missing-source">来源不可用</span>; }
          const source = sources.find((item) => item.id === id);
          if (!source) return <span className="source-reference missing-source" title="来源不可用">{label}</span>;
          const isWeb = source.source === 'web';
          const target: StableTarget = { kind: 'doc', id: source.documentId ?? '', page: source.page, label: source.title };
          const url = safeWebUrl(source.url);
          const located = referencePageLabel(source) !== '原文';
          const exists = !source.missing && (isWeb ? Boolean(url) : located && (targetExists?.(target) ?? false));
          const description = `${isWeb ? '网页' : '书籍'}：${source.title}${isWeb ? url ? ` · ${new URL(url).hostname}` : '' : located ? ` · 第 ${source.page}${source.endPage && source.endPage > source.page! ? `–${source.endPage}` : ''} 页` : ' · 位置待核实'}${source.missing ? '（来源已失效）' : exists ? '' : '（来源不可用）'}`;
          return <ReferenceBadge source={source} label={referenceLabel(source)} exists={exists} url={url} description={description} target={target} onNavigate={onNavigate} />;
        }
        const match = /^#stable-(term|note|doc|section|web)-(.*)$/u.exec(href ?? '');
        if (match) {
          let id = '';
          try { id = decodeURIComponent(match[2]!); } catch { return <span className="missing-source">{label}（源已失效）</span>; }
          const locator = match[1] === 'doc' ? /^(.*?)#page=(\d+)$/u.exec(id) : null;
          const target: StableTarget = { kind: match[1] as StableTarget['kind'], id: locator?.[1] ?? id,
            page: locator ? Number(locator[2]) : undefined, label: String(label) };
          const exists = targetExists?.(target) ?? false;
          return <button type="button" className={`stable-link${exists ? '' : ' missing-source'}`} disabled={!exists}
            title={exists ? target.label : '目标源已删除或不可用'} onClick={() => onNavigate?.(target)}>{target.kind === 'doc' && <BookOpen size={12} aria-hidden="true" />}{label}{!exists && '（源已失效）'}</button>;
        }
        const page = /^#page=(\d+)$/u.exec(href ?? '');
        if (page) return <button className="stable-link" type="button" onClick={() => onPage?.(Number(page[1]))}>{label}</button>;
        if (href?.startsWith('#')) return <a href={href}>{label}</a>;
        return href ? <a href={href} target="_blank" rel="noopener noreferrer">{/^https?:/iu.test(href) && <Globe size={12} aria-hidden="true" />}{label}</a> : <span>{label}</span>;
      },
    }), []);
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkStableLinks]}
    urlTransform={(url) => url.startsWith('#stable-') ? url : /^(https?:|mailto:|#)/iu.test(url) ? defaultUrlTransform(url) : ''}
    components={components}>{children}</ReactMarkdown></div>;
}
