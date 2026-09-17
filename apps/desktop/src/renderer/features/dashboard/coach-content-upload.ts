import type { DomainId } from '../../data/dashboard-manifest';

export const COACH_UPLOAD_MAX_BYTES = 64 * 1024;
export const COACH_UPLOAD_MAX_ROWS = 50;

export type CoachUploadRow = Readonly<{
  scene: string;
  script: string;
  domain?: DomainId;
}>;

export type CoachUploadFailureCode =
  | 'unsupported-type'
  | 'too-large'
  | 'binary-workbook'
  | 'invalid-table'
  | 'empty';

export type CoachUploadSuccess = Readonly<{
  ok: true;
  sourceName: string;
  rows: readonly CoachUploadRow[];
}>;

export type CoachUploadFailure = Readonly<{
  ok: false;
  code: CoachUploadFailureCode;
  message: string;
}>;

export type CoachUploadResult = CoachUploadSuccess | CoachUploadFailure;

const DOMAINS = new Set<string>(['presale', 'campaign', 'aftersale', 'product']);
const SCENE_HEADERS = new Set(['scene', '场景']);
const SCRIPT_HEADERS = new Set(['script', '标准话术', 'step', '步骤']);
const DOMAIN_HEADERS = new Set(['domain', 'category', '域']);
const BINARY_MESSAGE =
  '当前切片只在本页读取 CSV 文本表。二进制 Excel 未解析，也未连接飞书或 Wiki。可改用合成样例按钮。';

function fail(code: CoachUploadFailureCode, message: string): CoachUploadFailure {
  return Object.freeze({ ok: false, code, message });
}

function isZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

export function parseCoachUploadCsv(text: string, sourceName: string): CoachUploadResult {
  const normalized = text.replace(/^\uFEFF/u, '');
  if (normalized.includes('\u0000')) {
    return fail('binary-workbook', BINARY_MESSAGE);
  }
  const table = parseCsv(normalized);
  if (table.length === 0) {
    return fail('empty', '没有可预览的数据行。');
  }
  const header = table[0].map((cell) => cell.trim().toLocaleLowerCase('zh-CN'));
  const sceneIndex = header.findIndex((cell) => SCENE_HEADERS.has(cell));
  const scriptIndex = header.findIndex((cell) => SCRIPT_HEADERS.has(cell));
  if (sceneIndex < 0 || scriptIndex < 0) {
    return fail('invalid-table', '表头必须包含场景列，以及标准话术列。');
  }
  const domainIndex = header.findIndex((cell) => DOMAIN_HEADERS.has(cell));
  const rows: CoachUploadRow[] = [];
  for (let index = 1; index < table.length; index += 1) {
    const record = table[index];
    const scene = (record[sceneIndex] ?? '').trim();
    const script = (record[scriptIndex] ?? '').trim();
    const rawDomain = domainIndex >= 0 ? (record[domainIndex] ?? '').trim() : '';
    if (!scene && !script && !rawDomain) continue;
    const sheetRow = index + 1;
    if (!scene || !script) {
      return fail('invalid-table', `第 ${sheetRow} 行必须有场景与标准话术。`);
    }
    let domain: DomainId | undefined;
    if (rawDomain !== '') {
      if (!DOMAINS.has(rawDomain)) {
        return fail('invalid-table', `第 ${sheetRow} 行的域只能是 presale、campaign、aftersale 或 product。`);
      }
      domain = rawDomain as DomainId;
    }
    rows.push(domain ? { scene, script, domain } : { scene, script });
  }
  if (rows.length === 0) {
    return fail('empty', '没有可预览的数据行。');
  }
  if (rows.length > COACH_UPLOAD_MAX_ROWS) {
    return fail('invalid-table', `行数超过 ${COACH_UPLOAD_MAX_ROWS} 行本地预览上限。`);
  }
  return Object.freeze({
    ok: true,
    sourceName,
    rows: Object.freeze(rows),
  });
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FILE_READ_FAILED'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
        return;
      }
      reject(new Error('FILE_READ_FAILED'));
    };
    reader.readAsArrayBuffer(file);
  });
}

export async function readCoachUploadFile(file: File): Promise<CoachUploadResult> {
  const sourceName = file.name.trim() || 'untitled.csv';
  const lower = sourceName.toLowerCase();
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
    return fail('unsupported-type', '仅接受 .csv 或 .xlsx。');
  }
  if (file.size > COACH_UPLOAD_MAX_BYTES) {
    return fail('too-large', `文件超过 ${COACH_UPLOAD_MAX_BYTES / 1024}KiB。当前切片只做本地草稿预览。`);
  }
  const bytes = await readFileBytes(file);
  // Renderer cannot unzip workbooks. ZIP/OLE files fail closed instead of
  // pretending Feishu/Wiki or a real Excel parser is connected.
  if (bytes.includes(0) || isZipSignature(bytes)) {
    return fail('binary-workbook', BINARY_MESSAGE);
  }
  return parseCoachUploadCsv(new TextDecoder('utf-8').decode(bytes), sourceName);
}
