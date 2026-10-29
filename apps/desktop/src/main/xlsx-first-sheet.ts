import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';

const XLSX_MAX_ZIP_ENTRIES = 128;
const XLSX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 15_000;
const NS = /xmlns(:\w+)?="[^"]*"/g;

function assertBudget(startedAt: number): void {
  if (Date.now() - startedAt > PARSE_TIMEOUT_MS) throw new Error('PARSE_TIMEOUT');
}

function xmlCodePoint(raw: string, radix: number): string {
  const value = Number.parseInt(raw, radix);
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return '';
  if (value >= 0xd800 && value <= 0xdfff) return '';
  return String.fromCodePoint(value);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => xmlCodePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, dec: string) => xmlCodePoint(dec, 10))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripNs(xml: string): string {
  return xml.replace(NS, '');
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function keepZipEntry(name: string): boolean {
  if (name.endsWith('/')) return false;
  return name === 'xl/workbook.xml'
    || name === 'xl/_rels/workbook.xml.rels'
    || name === 'xl/sharedStrings.xml'
    || /^xl\/worksheets\/[^/]+\.xml$/u.test(name)
    || /^xl\/worksheets\/_rels\/[^/]+\.xml\.rels$/u.test(name)
    || /^xl\/drawings\/(?:_rels\/)?[^/]+\.(?:xml|xml\.rels)$/u.test(name)
    || /^xl\/media\/[^/]+$/u.test(name);
}

function readZipLocalFiles(buffer: Buffer, startedAt: number): ReadonlyMap<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  let uncompressed = 0;
  let seen = 0;
  while (offset + 30 <= buffer.length && seen <= XLSX_MAX_ZIP_ENTRIES) {
    assertBudget(startedAt);
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (name.includes('..') || name.startsWith('/')) throw new Error('UNSUPPORTED_FORMAT');
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressed;
    if (dataEnd > buffer.length || (method !== 0 && method !== 8)) throw new Error('UNSUPPORTED_FORMAT');
    seen += 1;
    if (!keepZipEntry(name) || compressed === 0) {
      offset = dataEnd;
      continue;
    }
    const remaining = XLSX_MAX_UNCOMPRESSED_BYTES - uncompressed;
    if (remaining < 1) throw new Error('CONTENT_TOO_LARGE');
    let payload: Buffer;
    try {
      payload = method === 0
        ? buffer.subarray(dataStart, dataEnd)
        : inflateRawSync(buffer.subarray(dataStart, dataEnd), { maxOutputLength: remaining });
    } catch (error) {
      throw new Error(error instanceof RangeError ? 'CONTENT_TOO_LARGE' : 'UNSUPPORTED_FORMAT');
    }
    uncompressed += payload.length;
    files.set(name, payload);
    offset = dataEnd;
  }
  if (files.size === 0) throw new Error('UNSUPPORTED_FORMAT');
  return files;
}

function sharedStrings(xml: string): readonly string[] {
  const values: string[] = [];
  const si = stripNs(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
  for (const match of si) {
    const body = match[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1]));
    values.push(texts.join(''));
  }
  return values;
}

function sheetPath(files: ReadonlyMap<string, Buffer>): string {
  const workbook = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('UNSUPPORTED_FORMAT');
  const sheetMatch = stripNs(workbook.toString('utf8')).match(/<sheet\b[^>]*r:id="([^"]+)"/);
  const rid = sheetMatch?.[1];
  if (!rid) throw new Error('UNSUPPORTED_FORMAT');
  const relXml = stripNs(rels.toString('utf8'));
  const escapedRid = rid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const relMatch = relXml.match(new RegExp(`<Relationship\\b[^>]*Id="${escapedRid}"[^>]*Target="([^"]+)"`))
    ?? relXml.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${escapedRid}"`));
  const target = relMatch?.[1];
  if (!target) throw new Error('UNSUPPORTED_FORMAT');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  return path.replace(/\\/g, '/');
}

function cellValue(inner: string, attrs: string, strings: readonly string[]): string {
  const typeMatch = attrs.match(/\bt="([^"]+)"/);
  const type = typeMatch?.[1] ?? '';
  if (type === 'inlineStr') {
    const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1]));
    return texts.join('');
  }
  const raw = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) ? (strings[index] ?? '') : '';
  }
  return decodeXml(raw);
}

type WorkbookImage = { row: number; dataUrl: string };

function relationship(files: ReadonlyMap<string, Buffer>, source: string, id: string): string {
  const relPath = posix.join(posix.dirname(source), '_rels', `${posix.basename(source)}.rels`);
  const xml = files.get(relPath)?.toString('utf8');
  if (!xml) throw new Error('IMAGE_RELATIONSHIP_MISSING');
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)(?:\/?>)/g)) {
    const attrs = match[1];
    const foundId = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    if (foundId !== id || !target) continue;
    const resolved = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(source), target));
    if (!resolved.startsWith('xl/')) throw new Error('IMAGE_RELATIONSHIP_INVALID');
    return resolved;
  }
  throw new Error('IMAGE_RELATIONSHIP_MISSING');
}

function sheetImages(files: ReadonlyMap<string, Buffer>, path: string, xml: string, notices: string[]): WorkbookImage[] {
  const drawingId = xml.match(/<(?:\w+:)?drawing\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (!drawingId) return [];
  const drawingPath = relationship(files, path, drawingId);
  const drawing = files.get(drawingPath)?.toString('utf8');
  if (!drawing) throw new Error('IMAGE_DRAWING_MISSING');
  const images: WorkbookImage[] = [];
  let totalBytes = 0;
  let unsupported = 0;
  for (const match of drawing.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
    const anchor = match[2];
    const id = match[1] === 'absoluteAnchor' ? undefined : anchor.match(/<(?:\w+:)?blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
    if (!id) { unsupported += 1; continue; }
    const row = Number(anchor.match(/<(?:\w+:)?from\b[^>]*>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/)?.[1]);
    if (!Number.isSafeInteger(row) || row < 0) throw new Error('IMAGE_ROW_INVALID');
    const mediaPath = relationship(files, drawingPath, id);
    if (!mediaPath.startsWith('xl/media/')) throw new Error('IMAGE_RELATIONSHIP_INVALID');
    const bytes = files.get(mediaPath);
    if (!bytes) throw new Error('IMAGE_MISSING');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) throw new Error('IMAGE_FORMAT_UNSUPPORTED');
    totalBytes += bytes.length;
    if (bytes.length > 5 * 1024 * 1024 || totalBytes > 8 * 1024 * 1024 || images.length >= 100) throw new Error('IMAGE_LIMIT');
    // DrawingML rows are 0-based; sheet rows are 1-based. The image belongs to the row its top-left corner sits in.
    images.push({ row: row + 1, dataUrl: `data:image/${png ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}` });
  }
  if (unsupported > 0) notices.push(`有 ${String(unsupported)} 个图形、图表或链接图片无法对应到话术行，未导入。`);
  return images;
}

function workbookNotices(files: ReadonlyMap<string, Buffer>, xml: string): string[] {
  const notices: string[] = [];
  const sheets = files.get('xl/workbook.xml')?.toString('utf8').match(/<(?:\w+:)?sheet\b/g)?.length ?? 0;
  if (sheets > 1) notices.push(`工作簿有 ${String(sheets)} 张工作表，只导入第一张。`);
  if (/<(?:\w+:)?picture\b/.test(xml)) notices.push('工作表背景图不属于任何话术，未导入。');
  if (/<(?:\w+:)?legacyDrawing\b/.test(xml)) notices.push('单元格批注未导入。');
  const links = xml.match(/<(?:\w+:)?hyperlink\b/g)?.length ?? 0;
  if (links > 0) notices.push(`${String(links)} 个超链接只保留显示文字，链接地址未导入。`);
  return notices;
}

export function parseXlsxWorkbook(buffer: Buffer): { table: string[][]; images: WorkbookImage[]; notices: string[] } {
  const startedAt = Date.now();
  const files = readZipLocalFiles(buffer, startedAt);
  const strings = files.has('xl/sharedStrings.xml')
    ? sharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8'))
    : [];
  const path = sheetPath(files);
  const sheet = files.get(path);
  if (!sheet) throw new Error('UNSUPPORTED_FORMAT');
  const xml = stripNs(sheet.toString('utf8'));
  const rows = new Map<number, Map<number, string>>();
  let maxCol = 0;
  let maxRow = 0;
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    assertBudget(startedAt);
    const attrs = match[1];
    const ref = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!ref) continue;
    const col = columnIndex(ref[1]);
    const row = Number.parseInt(ref[2], 10);
    const value = cellValue(match[2] ?? '', attrs, strings).trim();
    if (value === '') continue;
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(col, value);
    if (col > maxCol) maxCol = col;
    if (row > maxRow) maxRow = row;
  }
  const table: string[][] = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const record = rows.get(row);
    const line: string[] = [];
    for (let col = 0; col <= maxCol; col += 1) line.push(record?.get(col) ?? '');
    table.push(line);
  }
  const notices = workbookNotices(files, xml);
  return { table, images: sheetImages(files, path, xml, notices), notices };
}

export function parseXlsxFirstSheet(buffer: Buffer): string[][] {
  return parseXlsxWorkbook(buffer).table;
}
