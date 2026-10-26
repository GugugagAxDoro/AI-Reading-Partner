import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface StableTarget { kind: 'term' | 'note' | 'doc' | 'section' | 'web'; id: string; label: string; page?: number }

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }

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
        for (const match of child.value.matchAll(/\[\[(term|note|doc|section|web):([^|\]]+)(?:\|([^\]]+))?\]\]/gu)) {
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

export function MarkdownContent({ children, onNavigate, targetExists, onPage }: {
  children: string; onNavigate?: (target: StableTarget) => void;
  targetExists?: (target: StableTarget) => boolean; onPage?: (page: number) => void;
}) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkStableLinks]}
    urlTransform={(url) => url.startsWith('#stable-') ? url : /^(https?:|mailto:|#)/iu.test(url) ? defaultUrlTransform(url) : ''}
    components={{
      img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '未加载'}]</span>,
      table: ({ children: content }) => <div className="markdown-table"><table>{content}</table></div>,
      a: ({ href, children: label }) => {
        const match = /^#stable-(term|note|doc|section|web)-(.*)$/u.exec(href ?? '');
        if (match) {
          let id = '';
          try { id = decodeURIComponent(match[2]!); } catch { return <span className="missing-source">{label}（源已失效）</span>; }
          const target: StableTarget = { kind: match[1] as StableTarget['kind'], id, label: String(label) };
          const exists = targetExists?.(target) ?? false;
          return <button type="button" className={`stable-link${exists ? '' : ' missing-source'}`} disabled={!exists}
            title={exists ? target.label : '目标源已删除或不可用'} onClick={() => onNavigate?.(target)}>{label}{!exists && '（源已失效）'}</button>;
        }
        const page = /^#page=(\d+)$/u.exec(href ?? '');
        if (page) return <button className="stable-link" type="button" onClick={() => onPage?.(Number(page[1]))}>{label}</button>;
        return href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>;
      },
    }}>{children}</ReactMarkdown></div>;
}
