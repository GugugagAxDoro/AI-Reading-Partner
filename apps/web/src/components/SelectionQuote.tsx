import { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface QuoteSnapshot {
  text: string; page: number; endPage?: number; prefix?: string; suffix?: string; hash?: string;
  fragments?: Array<{ page: number; text: string }>;
  documentHash?: string; startOffset?: number; endOffset?: number;
}

export function middleEllipsis(text: string, fits: (value: string) => boolean): string {
  const normalized = text.replace(/\s+/gu, ' ');
  if (fits(normalized)) return normalized;
  const segments = Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(normalized), (item) => item.segment);
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    const candidate = segments.slice(0, Math.ceil(count / 2)).join('') + '…' + segments.slice(segments.length - Math.floor(count / 2)).join('');
    if (fits(candidate)) low = count;
    else high = count - 1;
  }
  return segments.slice(0, Math.ceil(low / 2)).join('') + '…' + segments.slice(segments.length - Math.floor(low / 2)).join('');
}

export function SelectionQuote({ quote, onRemove, onNavigate }: { quote: QuoteSnapshot; onRemove?: () => void; onNavigate?: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState('');
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return;
      context.font = getComputedStyle(element).font;
      setDisplay(middleEllipsis(quote.text, (value) => context.measureText(value).width <= element.clientWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [quote.text]);
  return <div className="quote-wrapper"><div className="selection-quote">
    <button type="button" className="quote-page" title="跳转原文" onClick={onNavigate}>P{quote.page}{quote.endPage && quote.endPage !== quote.page ? `–${quote.endPage}` : ''}</button>
    <button type="button" className="quote-preview-toggle" aria-expanded={expanded} title={quote.text} onClick={() => setExpanded(!expanded)}>
      <span ref={ref}>{display || quote.text}</span>
    </button>
    {onRemove && <button type="button" className="icon-button" title="移除引用" aria-label="移除引用" onClick={onRemove}><X size={14} /></button>}
  </div>{expanded && <blockquote className="quote-full">{quote.text}</blockquote>}</div>;
}
