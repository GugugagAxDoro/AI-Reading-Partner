import { OPS, type PDFPageProxy } from 'pdfjs-dist';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

function glyphIndex(view: DataView, cmap: number, code: number): number {
  const count = view.getUint16(cmap + 2);
  for (let index = 0; index < count; index++) {
    const offset = cmap + view.getUint32(cmap + 8 + index * 8);
    const format = view.getUint16(offset);
    if (format === 12) {
      const groups = view.getUint32(offset + 12);
      for (let group = 0; group < groups; group++) {
        const start = offset + 16 + group * 12;
        const first = view.getUint32(start);
        const last = view.getUint32(start + 4);
        if (code >= first && code <= last) return view.getUint32(start + 8) + code - first;
      }
    } else if (format === 4 && code <= 0xffff) {
      const segments = view.getUint16(offset + 6) / 2;
      for (let segment = 0; segment < segments; segment++) {
        const end = view.getUint16(offset + 14 + segment * 2);
        const first = view.getUint16(offset + 16 + segments * 2 + segment * 2);
        if (code < first || code > end) continue;
        const delta = view.getInt16(offset + 16 + segments * 4 + segment * 2);
        const rangeAt = offset + 16 + segments * 6 + segment * 2;
        const range = view.getUint16(rangeAt);
        if (!range) return (code + delta) & 0xffff;
        const glyph = view.getUint16(rangeAt + range + (code - first) * 2);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
    }
  }
  return 0;
}

export function unicodeMetricFont(data: Uint8Array, mapping: ReadonlyMap<number, number>): Uint8Array | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = view.getUint16(4);
    if (count > 256 || 12 + count * 16 > data.byteLength) return null;
    const tables = Array.from({ length: count }, (_, index) => {
      const entry = 12 + index * 16;
      return { tag: view.getUint32(entry), offset: view.getUint32(entry + 8), length: view.getUint32(entry + 12) };
    });
    const cmap = tables.find(table => table.tag === 0x636d6170);
    if (!cmap) return null;
    const glyphs = [...mapping].map(([unicode, fontChar]) => ({ unicode, glyph: glyphIndex(view, cmap.offset, fontChar) })).sort((left, right) => left.unicode - right.unicode);
    if (!glyphs.length || glyphs.some(item => !item.glyph)) return null;
    const replacement = new Uint8Array(28 + glyphs.length * 12);
    const mapped = new DataView(replacement.buffer);
    mapped.setUint16(2, 1); mapped.setUint16(4, 3); mapped.setUint16(6, 10); mapped.setUint32(8, 12);
    mapped.setUint16(12, 12); mapped.setUint32(16, replacement.length - 12); mapped.setUint32(24, glyphs.length);
    glyphs.forEach((item, index) => { const offset = 28 + index * 12; mapped.setUint32(offset, item.unicode); mapped.setUint32(offset + 4, item.unicode); mapped.setUint32(offset + 8, item.glyph); });
    const aligned = (size: number) => (size + 3) & ~3;
    const output = new Uint8Array(12 + count * 16 + tables.reduce((sum, table) => sum + aligned(table === cmap ? replacement.length : table.length), 0));
    const result = new DataView(output.buffer);
    output.set(data.subarray(0, 12));
    let cursor = 12 + count * 16;
    let headOffset = 0;
    const checksum = (start: number, length: number) => { let sum = 0; for (let offset = start; offset < start + aligned(length); offset += 4) sum = (sum + result.getUint32(offset)) >>> 0; return sum; };
    tables.forEach((table, index) => {
      const bytes = table === cmap ? replacement : data.subarray(table.offset, table.offset + table.length);
      output.set(bytes, cursor);
      if (table.tag === 0x68656164) { headOffset = cursor; result.setUint32(cursor + 8, 0); }
      const entry = 12 + index * 16;
      result.setUint32(entry, table.tag); result.setUint32(entry + 4, checksum(cursor, bytes.length)); result.setUint32(entry + 8, cursor); result.setUint32(entry + 12, bytes.length);
      cursor += aligned(bytes.length);
    });
    if (headOffset) result.setUint32(headOffset + 8, (0xb1b0afba - checksum(0, output.length)) >>> 0);
    return output;
  } catch { return null; }
}

export async function alignTextLayerFonts(page: PDFPageProxy, content: TextContent): Promise<FontFace[]> {
  const styles = content.styles;
  const operators = await page.getOperatorList();
  const mappings = new Map<string, Map<number, number>>();
  const ambiguous = new Set<string>();
  const sequences: Array<{ font: string; glyphs: Array<{ unicode: string; width: number }> }> = [];
  let current = '';
  for (const [index, operation] of operators.fnArray.entries()) {
    const args = operators.argsArray[index];
    if (operation === OPS.setFont) current = args[0];
    if (operation !== OPS.showText || !current) continue;
    if (args[0].every((glyph: unknown) => typeof glyph !== 'number' || glyph === 0)) sequences.push({ font: current, glyphs: args[0].filter((glyph: unknown) => typeof glyph !== 'number') });
    const mapping = mappings.get(current) ?? new Map<number, number>();
    mappings.set(current, mapping);
    for (const glyph of args[0]) {
      if (!glyph || typeof glyph === 'number') continue;
      if ([...glyph.unicode].length !== 1 || [...glyph.fontChar].length !== 1) continue;
      const unicode = glyph.unicode.codePointAt(0)!;
      const fontChar = glyph.fontChar.codePointAt(0)!;
      if (mapping.has(unicode) && mapping.get(unicode) !== fontChar) ambiguous.add(current);
      mapping.set(unicode, fontChar);
    }
  }
  const faces: FontFace[] = [];
  for (const [name, mapping] of mappings) {
    const style = styles[name];
    if (!style || style.vertical || ambiguous.has(name)) continue;
    const font = page.commonObjs.get(name) as { data?: Uint8Array; disableFontFace?: boolean };
    if (!font.data || font.disableFontFace) continue;
    const bytes = unicodeMetricFont(font.data, mapping);
    if (!bytes) continue;
    const family = `${name}_selection_${page.pageNumber}`;
    try {
      const face = new FontFace(family, bytes as Uint8Array<ArrayBuffer>);
      await face.load(); document.fonts.add(face); faces.push(face);
      style.fontFamily = `"${family}"`;
    } catch { continue; }
  }
  content.items = content.items.flatMap(item => {
    if (!('str' in item) || !item.str || styles[item.fontName]?.vertical) return [item];
    const sequence = sequences.find(candidate => candidate.font === item.fontName && candidate.glyphs.map(glyph => glyph.unicode).join('') === item.str);
    if (!sequence?.glyphs.some(glyph => glyph.unicode.length > 1)) return [item];
    const width = sequence.glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
    if (width <= 0) return [item];
    const angle = Math.atan2(item.transform[1], item.transform[0]);
    let offset = 0;
    const parts: TextItem[] = [];
    let pending = '';
    let pendingWidth = 0;
    const flush = () => {
      if (!pending) return;
      const advance = item.width * pendingWidth / width;
      parts.push({ ...item, str: pending, width: advance, transform: [...item.transform.slice(0, 4), item.transform[4] + offset * Math.cos(angle), item.transform[5] + offset * Math.sin(angle)], hasEOL: false });
      offset += advance; pending = ''; pendingWidth = 0;
    };
    for (const glyph of sequence.glyphs) {
      if (glyph.unicode.length > 1) flush();
      pending += glyph.unicode; pendingWidth += glyph.width;
      if (glyph.unicode.length > 1) flush();
    }
    flush();
    if (parts.length) parts.at(-1)!.hasEOL = item.hasEOL;
    return parts;
  });
  return faces;
}
