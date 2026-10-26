import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream,
} from 'pdf-lib';

export const PDF_TEXT_VERSION = 1;

interface Mapping {
  cid: number;
  unicode: number;
  width: number;
}

export interface UnicodeRepair {
  fonts: number;
  mappings: number;
  method: 'validated-cid-order';
  skippedReason?: string;
}

function mappings(source: string): Mapping[] {
  const result = new Map<number, Mapping>();
  for (const section of source.matchAll(/\b(beginbfchar|beginbfrange)\b([\s\S]*?)\bend(?:bfchar|bfrange)\b/gu)) {
    const body = section[2]!;
    const pattern = section[1] === 'beginbfchar'
      ? /<([\da-fA-F]{2,4})>\s*<([\da-fA-F]{4})>/gu
      : /<([\da-fA-F]{2,4})>\s*<([\da-fA-F]{2,4})>\s*<([\da-fA-F]{4})>/gu;
    if (body.replace(pattern, '').trim()) return [];
    for (const match of body.matchAll(pattern)) {
      const destination = match.at(-1)!;
      const first = Number.parseInt(match[1]!, 16);
      const last = section[1] === 'beginbfrange' ? Number.parseInt(match[2]!, 16) : first;
      const unicode = Number.parseInt(destination, 16);
      if (last < first || unicode + last - first > 0xffff) return [];
      for (let cid = first; cid <= last; cid++) {
        result.set(cid, { cid, unicode: unicode + cid - first, width: match[1]!.length });
      }
    }
  }
  return [...result.values()];
}

function readCmap(font: PDFDict): { stream: PDFRawStream; source: string; entries: Mapping[] } | null {
  const stream = font.context.lookup(font.get(PDFName.of('ToUnicode')));
  if (!(stream instanceof PDFRawStream)) return null;
  const source = Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
  return { stream, source, entries: mappings(source) };
}

function consistentOffset(entries: Mapping[], lower: number, upper: number, minimum: number): number | null {
  const anchors = entries.filter(entry => entry.unicode >= lower && entry.unicode <= upper);
  if (anchors.length < minimum) return null;
  const offset = anchors[0]!.unicode - anchors[0]!.cid;
  return anchors.every(entry => entry.unicode - entry.cid === offset) ? offset : null;
}

function namedGlyphs(fonts: PDFDict[]): Map<number, number> {
  const result = new Map<number, number>();
  const conflicts = new Set<number>();
  for (const font of fonts) {
    if (font.get(PDFName.of('Subtype')) !== PDFName.of('Type3')) continue;
    const cmap = readCmap(font);
    const encoding = font.context.lookup(font.get(PDFName.of('Encoding')));
    const differences = encoding instanceof PDFDict ? encoding.lookupMaybe(PDFName.of('Differences'), PDFArray) : undefined;
    if (!cmap || !differences) continue;
    const byCode = new Map(cmap.entries.map(entry => [entry.cid, entry.unicode]));
    let code = 0;
    for (const value of differences.asArray()) {
      if (value instanceof PDFNumber) {
        code = value.asNumber();
        continue;
      }
      const match = value instanceof PDFName ? /^g([\da-fA-F]+)$/u.exec(value.decodeText()) : null;
      const unicode = byCode.get(code++);
      if (!match || unicode === undefined) continue;
      const gid = Number.parseInt(match[1]!, 16);
      if (result.has(gid) && result.get(gid) !== unicode) conflicts.add(gid);
      else result.set(gid, unicode);
    }
  }
  for (const gid of conflicts) result.delete(gid);
  return result;
}

export async function repairPdfUnicode(buffer: Buffer): Promise<{ data: Uint8Array; repair: UnicodeRepair }> {
  const repair: UnicodeRepair = { fonts: 0, mappings: 0, method: 'validated-cid-order' };
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch {
    return { data: new Uint8Array(buffer), repair: { ...repair, skippedReason: 'unsupported-pdf-structure' } };
  }
  const fonts = pdf.context.enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFDict => object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Font'));
  const references = namedGlyphs(fonts);
  for (const font of fonts) {
    if (font.get(PDFName.of('Subtype')) !== PDFName.of('Type0') || font.get(PDFName.of('Encoding')) !== PDFName.of('Identity-H')) continue;
    const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
    const descendant = descendants?.lookup(0, PDFDict);
    if (!descendant || descendant.get(PDFName.of('Subtype')) !== PDFName.of('CIDFontType2') ||
        descendant.get(PDFName.of('CIDToGIDMap')) !== PDFName.of('Identity')) continue;
    const cmap = readCmap(font);
    if (!cmap) continue;
    const offset = consistentOffset(cmap.entries, 0x4e00, 0x9fff, 32);
    if (offset === null) continue;
    const corroboration = [...references].filter(([gid, unicode]) => unicode >= 0x4e00 && unicode <= 0x9fff && unicode - gid === offset);
    if (corroboration.length < 3) continue;
    const fullwidthOffset = consistentOffset(cmap.entries, 0xff01, 0xff5e, 3);
    const anchors = cmap.entries.filter(entry => entry.unicode >= 0x4e00 && entry.unicode <= 0x9fff);
    const minCid = Math.min(...anchors.map(entry => entry.cid));
    const maxCid = Math.max(...anchors.map(entry => entry.cid));
    let corrected = 0;
    for (const entry of cmap.entries) {
      if (entry.unicode >= 0x4e00 && entry.unicode <= 0x9fff) continue;
      let unicode = references.get(entry.cid);
      if (unicode === undefined && entry.cid >= minCid && entry.cid <= maxCid) unicode = entry.cid + offset;
      if (unicode === undefined && fullwidthOffset !== null) {
        const candidate = entry.cid + fullwidthOffset;
        if (candidate >= 0xff01 && candidate <= 0xff5e) unicode = candidate;
      }
      if (unicode !== undefined && unicode !== entry.unicode) {
        entry.unicode = unicode;
        corrected++;
      }
    }
    if (corrected === 0) continue;
    const blocks: string[] = [];
    for (let index = 0; index < cmap.entries.length; index += 100) {
      const group = cmap.entries.slice(index, index + 100);
      blocks.push(`${group.length} beginbfchar\n${group.map(entry =>
        `<${entry.cid.toString(16).padStart(entry.width, '0')}> <${entry.unicode.toString(16).padStart(4, '0')}>`,
      ).join('\n')}\nendbfchar`);
    }
    const source = cmap.source
      .replace(/\d+\s+begin(?:bfchar|bfrange)\b[\s\S]*?\bend(?:bfchar|bfrange)\b/gu, '')
      .replace(/\bendcmap\b/u, `${blocks.join('\n')}\nendcmap`);
    font.set(PDFName.of('ToUnicode'), pdf.context.register(pdf.context.flateStream(source)));
    repair.fonts++;
    repair.mappings += corrected;
  }
  return { data: repair.mappings ? await pdf.save() : new Uint8Array(buffer), repair };
}
