export interface ReadingDecoration {
  id: string;
  text: string;
  kind: 'vocabulary' | 'interpretation' | 'question';
  page?: number;
  prefix?: string;
  suffix?: string;
}

export function decorateReadingRanges(layer: HTMLElement, records: ReadingDecoration[], activate: (ids: string[]) => void): () => void {
  const container = layer.parentElement!;
  const overlay = document.createElement('div');
  overlay.className = 'reading-decorations';
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const raw = nodes.map(node => node.data).join('');
  const positions: number[] = [];
  let normalized = '';
  for (let index = 0; index < raw.length; index++) {
    if (/\s/u.test(raw[index]!)) continue;
    normalized += raw[index]!.toLowerCase(); positions.push(index);
  }
  const compact = (text: string) => text.replace(/\s/gu, '').toLowerCase();
  const groups = new Map<string, { start: number; end: number; kind: ReadingDecoration['kind']; ids: string[] }>();
  for (const record of records) {
    const needle = compact(record.text);
    if (!needle || (record.kind === 'vocabulary' && needle.length > 100)) continue;
    const matches: number[] = [];
    for (let from = 0; from < normalized.length;) {
      const index = normalized.indexOf(needle, from);
      if (index < 0) break;
      from = index + needle.length;
      if (record.kind === 'vocabulary' && /^[a-z\d]+$/iu.test(needle) && /[a-z\d]/iu.test(raw[positions[index]! - 1] ?? '')) continue;
      if (record.kind === 'vocabulary' && /^[a-z\d]+$/iu.test(needle) && /[a-z\d]/iu.test(raw[positions[index + needle.length - 1]! + 1] ?? '')) continue;
      if (record.prefix && !normalized.slice(0, index).endsWith(compact(record.prefix))) continue;
      if (record.suffix && !normalized.slice(index + needle.length).startsWith(compact(record.suffix))) continue;
      matches.push(index);
    }
    if (record.kind !== 'vocabulary' && matches.length !== 1) continue;
    for (const match of matches) {
      const start = positions[match]!;
      const end = positions[match + needle.length - 1]! + 1;
      const key = `${start}:${end}`;
      const existing = groups.get(key);
      if (existing) { existing.ids.push(record.id); if (record.kind === 'vocabulary' || existing.kind === 'question' && record.kind === 'interpretation') existing.kind = record.kind; }
      else groups.set(key, { start, end, kind: record.kind, ids: [record.id] });
    }
  }
  const point = (offset: number, end: boolean) => {
    for (const node of nodes) {
      if (offset < node.length || (end && offset === node.length) || node === nodes.at(-1)) return { node, offset: Math.min(offset, node.length) };
      offset -= node.length;
    }
    return null;
  };
  const bounds = container.getBoundingClientRect();
  const hits: Array<{ rects: DOMRect[]; ids: string[]; marks: HTMLElement[] }> = [];
  for (const group of groups.values()) {
    const start = point(group.start, false); const end = point(group.end, true);
    if (!start || !end) continue;
    const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    if (!rects.length) continue;
    const overlapping = group.kind !== 'vocabulary' && [...groups.values()].some(other => other.kind === 'vocabulary' && other.start < group.end && other.end > group.start);
    const marks: HTMLElement[] = [];
    if (!overlapping) for (const rect of rects) {
      const mark = document.createElement('span'); mark.className = `reading-decoration decoration-${group.kind}`;
      Object.assign(mark.style, { left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      overlay.append(mark); marks.push(mark);
    }
    const entry = document.createElement('button'); entry.type = 'button';
    entry.className = `decoration-entry decoration-${group.kind}${overlapping ? ' decoration-margin' : ''}`;
    entry.setAttribute('aria-label', `${group.kind === 'vocabulary' ? '词汇解释' : group.kind === 'interpretation' ? '深度解读' : '自定义问答'}：${raw.slice(group.start, group.end)}，${group.ids.length}条历史记录`);
    entry.title = entry.getAttribute('aria-label')!;
    Object.assign(entry.style, { left: `${overlapping ? bounds.width - 12 : rects[0]!.left - bounds.left}px`, top: `${rects[0]!.bottom - bounds.top - 4}px` });
    const focus = () => marks.forEach(mark => mark.classList.add('decoration-active'));
    const blur = () => marks.forEach(mark => mark.classList.remove('decoration-active'));
    entry.onfocus = focus; entry.onblur = blur; entry.onmouseenter = focus; entry.onmouseleave = blur;
    entry.onclick = () => activate(group.ids); overlay.append(entry);
    if (!overlapping) hits.push({ rects, ids: group.ids, marks });
  }
  container.append(overlay);
  const click = (event: MouseEvent) => {
    if (!window.getSelection()?.isCollapsed) return;
    const current = container.getBoundingClientRect();
    const x = event.clientX - current.left + bounds.left; const y = event.clientY - current.top + bounds.top;
    const hit = hits.find(item => item.rects.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom));
    if (hit) { event.stopPropagation(); activate(hit.ids); }
  };
  const hover = (event: MouseEvent) => {
    const current = container.getBoundingClientRect();
    const x = event.clientX - current.left + bounds.left; const y = event.clientY - current.top + bounds.top;
    hits.forEach(hit => hit.marks.forEach(mark => mark.classList.toggle('decoration-active', hit.rects.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom))));
  };
  const leave = () => hits.forEach(hit => hit.marks.forEach(mark => mark.classList.remove('decoration-active')));
  layer.addEventListener('click', click); layer.addEventListener('mousemove', hover);
  layer.addEventListener('mouseleave', leave);
  return () => { layer.removeEventListener('click', click); layer.removeEventListener('mousemove', hover); layer.removeEventListener('mouseleave', leave); overlay.remove(); };
}
