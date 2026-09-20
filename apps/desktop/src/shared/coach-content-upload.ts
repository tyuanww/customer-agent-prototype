import {
  CONTENT_IMPORT_MAX_BYTES,
  CONTENT_IMPORT_MAX_ROWS,
  type DashboardContentDomain,
  type DashboardContentRow,
} from './dashboard-content';

export const COACH_UPLOAD_MAX_BYTES = CONTENT_IMPORT_MAX_BYTES;
export const COACH_UPLOAD_MAX_ROWS = CONTENT_IMPORT_MAX_ROWS;

export type CoachUploadRow = DashboardContentRow;

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
  csvText: string;
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
    let domain: DashboardContentDomain | undefined;
    if (rawDomain !== '') {
      if (!DOMAINS.has(rawDomain)) {
        return fail('invalid-table', `第 ${sheetRow} 行的域只能是 presale、campaign、aftersale 或 product。`);
      }
      domain = rawDomain as DashboardContentDomain;
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
    csvText: normalized,
  });
}
