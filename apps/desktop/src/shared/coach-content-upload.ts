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
const BINARY_MESSAGE =
  'Excel 未能解析。未连接飞书或 Wiki。请改用 CSV，或确认工作簿第一张表可读取。';
const CHINESE_DOMAIN: Readonly<Record<string, DashboardContentDomain>> = Object.freeze({
  售前: 'presale',
  活动: 'campaign',
  售后: 'aftersale',
  产品: 'product',
  产品话术: 'product',
  faq: 'product',
});

function headerKey(cell: string): string {
  return cell.trim().toLocaleLowerCase('zh-CN').split('|')[0]?.trim() ?? '';
}

function isSceneHeader(cell: string): boolean {
  return ['scene', '场景', '快捷短语', '业务填写问题', '问题'].includes(cell);
}

function isScriptHeader(cell: string): boolean {
  return ['script', '标准话术', 'step', '步骤', '产品话术'].includes(cell) || cell.startsWith('客满话术');
}

function isDomainHeader(cell: string): boolean {
  return ['domain', 'category', '域', '分类'].includes(cell);
}

function isProductHeader(cell: string, index: number): boolean {
  return cell === '产品' || (index === 0 && cell === '');
}

export function domainFromSourceName(sourceName: string): DashboardContentDomain | undefined {
  const name = sourceName.toLocaleLowerCase('zh-CN');
  if (name.includes('售后')) return 'aftersale';
  if (name.includes('售前')) return 'presale';
  if (name.includes('活动')) return 'campaign';
  if (name.includes('faq') || name.includes('产品')) return 'product';
  return undefined;
}

function domainFromCell(raw: string): DashboardContentDomain | undefined {
  const trimmed = raw.trim();
  if (DOMAINS.has(trimmed)) return trimmed as DashboardContentDomain;
  const mapped = CHINESE_DOMAIN[trimmed.toLocaleLowerCase('zh-CN')] ?? CHINESE_DOMAIN[trimmed];
  return mapped;
}

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

export function parseCoachUploadTable(table: readonly string[][], sourceName: string): CoachUploadResult {
  if (table.length === 0) {
    return fail('empty', '没有可预览的数据行。');
  }
  const header = table[0].map((cell) => headerKey(cell));
  const sceneIndex = header.findIndex((cell) => isSceneHeader(cell));
  const scriptIndex = header.findIndex((cell) => isScriptHeader(cell));
  const domainIndex = header.findIndex((cell) => isDomainHeader(cell));
  const productIndex = header.findIndex((cell, index) => index !== scriptIndex && isProductHeader(cell, index));
  if (sceneIndex < 0 || scriptIndex < 0 || sceneIndex === scriptIndex) {
    return fail('invalid-table', '表头必须能映射到场景（快捷短语/问题）和标准话术（产品话术）。');
  }
  const fallbackDomain = domainFromSourceName(sourceName);
  const rows: CoachUploadRow[] = [];
  let skippedEmpty = 0;
  let skippedBraces = 0;
  for (let index = 1; index < table.length; index += 1) {
    const record = table[index] ?? [];
    const product = productIndex >= 0 ? (record[productIndex] ?? '').trim() : '';
    const shortcut = (record[sceneIndex] ?? '').trim();
    const script = (record[scriptIndex] ?? '').trim();
    const rawDomain = domainIndex >= 0 ? (record[domainIndex] ?? '').trim() : '';
    if (!product && !shortcut && !script && !rawDomain) {
      skippedEmpty += 1;
      continue;
    }
    const sheetRow = index + 1;
    if (!shortcut || !script) {
      skippedEmpty += 1;
      continue;
    }
    if (/[{}]/u.test(script.replaceAll('{订单号}', '').replaceAll('{日期}', ''))) {
      skippedBraces += 1;
      continue;
    }
    let domain: DashboardContentDomain | undefined;
    if (rawDomain !== '') {
      domain = domainFromCell(rawDomain);
      if (!domain) {
        if (header[domainIndex] === 'domain') {
          return fail('invalid-table', `第 ${sheetRow} 行的域只能是 售前/活动/售后/产品，或 presale、campaign、aftersale、product。`);
        }
        domain = fallbackDomain;
      }
    } else {
      domain = fallbackDomain;
    }
    const scene = product && product !== shortcut ? `${product} · ${shortcut}` : shortcut;
    rows.push(domain ? { scene, script, domain } : { scene, script });
  }
  if (rows.length === 0) {
    return fail('empty', skippedBraces > 0
      ? `没有可预览的数据行。已跳过 ${String(skippedBraces)} 行含合同不允许的花括号。`
      : '没有可预览的数据行。');
  }
  if (rows.length > COACH_UPLOAD_MAX_ROWS) {
    return fail('invalid-table', `行数超过 ${COACH_UPLOAD_MAX_ROWS} 行本地预览上限。`);
  }
  const csvText = [
    'scene,script,domain',
    ...rows.map((row) => [row.scene, row.script, row.domain ?? ''].map(csvCell).join(',')),
  ].join('\n');
  const skippedNote = skippedEmpty > 0 || skippedBraces > 0
    ? `已跳过空白或不完整 ${String(skippedEmpty)} 行` + (skippedBraces > 0 ? `、花括号 ${String(skippedBraces)} 行。` : '。')
    : '';
  return Object.freeze({
    ok: true,
    sourceName: skippedNote ? `${sourceName} · ${skippedNote}` : sourceName,
    rows: Object.freeze(rows),
    csvText,
  });
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function parseCoachUploadCsv(text: string, sourceName: string): CoachUploadResult {
  const normalized = text.replace(/^\uFEFF/u, '');
  if (normalized.includes('\u0000')) {
    return fail('binary-workbook', BINARY_MESSAGE);
  }
  return parseCoachUploadTable(parseCsv(normalized), sourceName);
}
