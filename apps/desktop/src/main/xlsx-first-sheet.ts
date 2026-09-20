import { inflateRawSync } from 'node:zlib';

const XLSX_MAX_ZIP_ENTRIES = 128;
const XLSX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 15_000;
const NS = /xmlns(:\w+)?="[^"]*"/g;

function assertBudget(startedAt: number): void {
  if (Date.now() - startedAt > PARSE_TIMEOUT_MS) throw new Error('PARSE_TIMEOUT');
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
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
    || /^xl\/worksheets\/[^/]+\.xml$/u.test(name);
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
  const relMatch = relXml.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))
    ?? relXml.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`));
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

export function parseXlsxFirstSheet(buffer: Buffer): string[][] {
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
  for (const match of xml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
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
  return table;
}
