import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { inspectMenokinWpsCellImages } from './menokin-sop-cell-image-adapter.js';
import {
  MENOKIN_SOP_CANDIDATE_POLICY,
  MENOKIN_SOP_EXECUTION_KEYS,
  MENOKIN_SOP_EXECUTION_STEP,
  MENOKIN_SOP_SEVERITY_ORDER,
  MENOKIN_SOP_TERMINAL_KEYS,
  validateMenokinSourceRows,
  type MenokinSopGroup,
  type MenokinSourceField,
  type MenokinSourceImage,
  type MenokinSourceKnowledge,
  type MenokinSourceNode,
  type MenokinSourcePath,
  type MenokinSourceQuickPhrase,
  type MenokinSourceRow,
  type MenokinSourceScript,
} from './menokin-sop-candidate.js';
import { INTAKE_POLICY, IntakeFailure } from './policy.js';
import { readSopCellText } from './sop.js';

/** Reads the single flat worksheet accepted by the Menokin SOP source boundary. */
export const MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME = '特殊流程 SOP';

export const MENOKIN_FLAT_SOP_WORKBOOK_HEADERS = Object.freeze([
  '地区',
  '商业类型',
  '店铺',
  '作用',
  'SOP归属',
  '步骤说明',
  '步骤类型',
  '路径选择',
  '步骤',
  '字段',
  '操作说明',
  '话术',
  '快捷语',
  '前提条件',
  '判断维度',
  '类型判断',
  '症状描述',
  '图片',
] as const);

export type MenokinFlatSopWorkbookIssue = Readonly<{
  code: string;
  sheet: string;
  row: number | null;
  column: string | null;
  field: string | null;
  fix: string;
}>;

export type MenokinFlatSopWorkbookParseResult = Readonly<{
  ok: boolean;
  sourceSha256: string;
  sourceRows: readonly MenokinSourceRow[];
  issues: readonly MenokinFlatSopWorkbookIssue[];
}>;

export type MenokinFlatSopWorkbookOptions = Readonly<{
  /** A caller may tighten the source-row budget but cannot raise the candidate limit. */
  maxRows?: number;
}>;

type EmbeddedImage = Readonly<{
  columnNumber: number;
  contentSha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: number;
}>;

type WpsFactByRow = ReadonlyMap<number, EmbeddedImage>;

const GROUP_SET = new Set<string>(MENOKIN_SOP_SEVERITY_ORDER);
const EXECUTION_KEY_SET = new Set<string>(MENOKIN_SOP_EXECUTION_KEYS);
const TERMINAL_KEY_SET = new Set<string>(MENOKIN_SOP_TERMINAL_KEYS);
const IMAGE_EXTENSIONS = new Set(['png', 'jpeg', 'gif']);

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

const columnName = (index: number): string => {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const normalizeText = (value: string): string => value.replace(/\r\n?/gu, '\n').trim();

type ControlledImageReference = Readonly<{
  ok: boolean;
  referenceHash: string | null;
}>;

type OpaqueEncodingState = {
  nodes: number;
  active: WeakSet<object>;
};

/** Deterministic, bounded encoding used only to hash an opaque image cell. */
const encodeOpaque = (
  value: unknown,
  state: OpaqueEncodingState = { nodes: 0, active: new WeakSet() },
  depth = 0,
): string | null => {
  if (++state.nodes > 1_024 || depth > 12) return null;
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (typeof value === 'number') return Number.isFinite(value) ? `number:${value}` : null;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (typeof value !== 'object') return null;
  if (state.active.has(value)) return null;
  state.active.add(value);
  try {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? `date:${value.toISOString()}` : null;
    }
    if (Array.isArray(value)) {
      const encoded = value.map((entry) => encodeOpaque(entry, state, depth + 1));
      return encoded.some((entry) => entry === null) ? null : `array:[${encoded.join('|')}]`;
    }
    const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null;
    const kind = prototype === Object.prototype || prototype === null
      ? 'object'
      : `object:${typeof prototype?.constructor?.name === 'string' ? prototype.constructor.name : 'unknown'}`;
    const entries = Object.keys(value).sort().map((key) => {
      const encoded = encodeOpaque((value as Record<string, unknown>)[key], state, depth + 1);
      return encoded === null ? null : `${key.length}:${key}=${encoded}`;
    });
    return entries.some((entry) => entry === null) ? null : `${kind}:{${entries.join('|')}}`;
  } finally {
    state.active.delete(value);
  }
};

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isAbsentImageText = (text: string): boolean => text === '' || text === '无';

/** Read the image column without evaluating formulas or hyperlink targets. */
const readControlledImageReference = (value: ExcelJS.CellValue): ControlledImageReference => {
  if (value === null || value === undefined || value === '') return { ok: true, referenceHash: null };
  if (typeof value === 'string') {
    const text = normalizeText(value);
    return { ok: true, referenceHash: isAbsentImageText(text) ? null : sha256(text) };
  }
  if (typeof value === 'number') {
    const encoded = Number.isFinite(value) ? encodeOpaque(value) : null;
    return encoded === null
      ? { ok: false, referenceHash: null }
      : { ok: true, referenceHash: sha256(`image-number-v1:${encoded}`) };
  }
  if (typeof value !== 'object') return { ok: false, referenceHash: null };

  if (hasOwn(value, 'formula') || hasOwn(value, 'sharedFormula')) {
    const encoded = encodeOpaque(value);
    return encoded === null
      ? { ok: false, referenceHash: null }
      : { ok: true, referenceHash: sha256(`image-formula-v1:${encoded}`) };
  }
  if (hasOwn(value, 'hyperlink')) {
    const displayText = readSopCellText(value);
    if (displayText === undefined) return { ok: false, referenceHash: null };
    if (isAbsentImageText(normalizeText(displayText))) return { ok: true, referenceHash: null };
    const encoded = encodeOpaque(value);
    return encoded === null
      ? { ok: false, referenceHash: null }
      : { ok: true, referenceHash: sha256(`image-hyperlink-v1:${encoded}`) };
  }

  const displayText = readSopCellText(value);
  if (displayText === undefined) return { ok: false, referenceHash: null };
  const text = normalizeText(displayText);
  return { ok: true, referenceHash: isAbsentImageText(text) ? null : sha256(text) };
};

const issue = (
  code: string,
  row: number | null,
  column: string | null,
  field: string | null,
  fix: string,
  sheet = MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME,
): MenokinFlatSopWorkbookIssue => ({ code, sheet, row, column, field, fix });

const failed = (
  sourceSha256: string,
  issues: readonly MenokinFlatSopWorkbookIssue[],
): MenokinFlatSopWorkbookParseResult => ({
  ok: false,
  sourceSha256,
  sourceRows: [],
  issues,
});

const imageBuffer = (image: ExcelJS.Image): Buffer | null => {
  if (image.buffer) return Buffer.from(image.buffer);
  if (image.base64) return Buffer.from(image.base64.split(',', 2).at(-1) ?? '', 'base64');
  return null;
};

const hasImageSignature = (mime: EmbeddedImage['mime'], bytes: Buffer): boolean => {
  if (mime === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 6
    && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a'
      || bytes.subarray(0, 6).toString('ascii') === 'GIF89a');
};

const stepNode = (step: string, title: string | null, body: string | null): MenokinSourceNode => {
  const nodeKey = step || null;
  if (nodeKey !== null && EXECUTION_KEY_SET.has(nodeKey)) {
    return {
      nodeKey,
      nodeType: 'execution',
      stepNumber: MENOKIN_SOP_EXECUTION_STEP,
      title,
      body,
    };
  }
  if (nodeKey !== null && TERMINAL_KEY_SET.has(nodeKey)) {
    return { nodeKey, nodeType: 'terminal', stepNumber: null, title, body };
  }
  return { nodeKey, nodeType: 'unresolved', stepNumber: null, title, body };
};

const sourceEntryCode = (sourceSha256: string, rowNumber: number): string =>
  `FLAT-${sourceSha256.slice(0, 24)}-R${rowNumber}`;

const rowHash = (headers: readonly string[], values: readonly string[]): string =>
  sha256(JSON.stringify(headers.map((header, index) => [header, values[index] ?? ''])));

const knowledgeEntries = (
  values: readonly string[],
  targetNodeKey: string | null,
): readonly MenokinSourceKnowledge[] => {
  const definitions = [
    ['region', values[0]],
    ['businessType', values[1]],
    ['shop', values[2]],
    ['purpose', values[3]],
    ['stepExplanation', values[5]],
    ['stepType', values[6]],
    ['operationInstructions', values[10]],
    ['precondition', values[13]],
    ['judgmentDimension', values[14]],
    ['typeJudgment', values[15]],
    ['symptomDescription', values[16]],
  ] as const;
  return definitions.flatMap(([key, text]) => text
    ? [{ kind: 'knowledge' as const, key, text, targetNodeKey }]
    : []);
};

const mapEmbeddedImages = (
  book: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  issues: MenokinFlatSopWorkbookIssue[],
): ReadonlyMap<number, readonly EmbeddedImage[]> => {
  const byRow = new Map<number, EmbeddedImage[]>();
  for (const entry of sheet.getImages()) {
    const row = Math.floor(entry.range.tl.row) + 1;
    const column = Math.floor(entry.range.tl.col) + 1;
    if (row < 2) {
      issues.push(issue('MEDIA_ROW_UNBOUNDED', row, columnName(column), 'images', '图片必须锚定在数据行'));
      continue;
    }
    if (column !== MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.length) {
      issues.push(issue(
        'MEDIA_COLUMN_INVALID',
        row,
        columnName(column),
        'images',
        '内嵌图片必须放在「图片」列',
      ));
      continue;
    }
    const image = book.getImage(Number(entry.imageId));
    const extension = image.extension;
    const bytes = imageBuffer(image);
    if (!bytes || !IMAGE_EXTENSIONS.has(extension)) {
      issues.push(issue(
        'MEDIA_UNAVAILABLE',
        row,
        columnName(column),
        'images',
        '图片必须是可读取的 PNG、JPEG 或 GIF',
      ));
      continue;
    }
    const mime: EmbeddedImage['mime'] = extension === 'jpeg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : 'image/png';
    if (!hasImageSignature(mime, bytes)) {
      issues.push(issue(
        'MEDIA_INVALID_SIGNATURE',
        row,
        columnName(column),
        'images',
        '图片扩展名与文件内容不一致，请重新导出',
      ));
      continue;
    }
    const metadata: EmbeddedImage = {
      columnNumber: column,
      contentSha256: sha256(bytes),
      mime,
      bytes: bytes.length,
    };
    const rowImages = byRow.get(row) ?? [];
    rowImages.push(metadata);
    byRow.set(row, rowImages);
  }
  return byRow;
};

const wpsFactsByRow = (
  facts: readonly Readonly<{
    rowNumber: number;
    columnNumber: 18;
    contentSha256: string;
    mime: EmbeddedImage['mime'];
    bytes: number;
  }>[],
): WpsFactByRow => new Map(facts.map((fact) => [fact.rowNumber, {
  columnNumber: fact.columnNumber,
  contentSha256: fact.contentSha256,
  mime: fact.mime,
  bytes: fact.bytes,
}]));

/**
 * Parse one flat, one-dimensional Menokin SOP worksheet into candidate source
 * rows. The returned rows have already passed `validateMenokinSourceRows`; any
 * workbook, media, row-shape or row-set issue returns no rows at all.
 */
export async function parseMenokinFlatSopWorkbook(
  bytes: Buffer,
  options: MenokinFlatSopWorkbookOptions = {},
): Promise<MenokinFlatSopWorkbookParseResult> {
  if (!Buffer.isBuffer(bytes)) {
    return failed('', [issue('INVALID_BYTES', null, null, '$', '输入必须是 XLSX 文件字节')]);
  }
  const sourceSha256 = sha256(bytes);
  const maxRows = options.maxRows ?? MENOKIN_SOP_CANDIDATE_POLICY.maxRows;
  if (!Number.isSafeInteger(maxRows)
    || maxRows < 1
    || maxRows > MENOKIN_SOP_CANDIDATE_POLICY.maxRows) {
    return failed(sourceSha256, [issue(
      'INVALID_OPTIONS',
      null,
      null,
      '$.maxRows',
      `maxRows 必须是 1 到 ${MENOKIN_SOP_CANDIDATE_POLICY.maxRows} 之间的整数`,
    )]);
  }

  const issues: MenokinFlatSopWorkbookIssue[] = [];
  try {
    // Resolve WPS package media before ExcelJS allocates an object model. The
    // adapter owns the archive safety check and returns hashes only.
    const wpsInspection = await inspectMenokinWpsCellImages(bytes, MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME);
    if (wpsInspection.issues.length > 0) {
      for (const wpsIssue of wpsInspection.issues) {
        issues.push(issue(
          wpsIssue.code,
          wpsIssue.rowNumber,
          wpsIssue.columnNumber === null ? null : columnName(wpsIssue.columnNumber),
          wpsIssue.columnNumber === 18 ? 'images' : null,
          '修复 WPS 单元格图片关系后重新导出',
        ));
      }
      return failed(sourceSha256, issues);
    }
    const wpsImagesByRow = wpsFactsByRow(wpsInspection.facts);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);

    const actualSheets = book.worksheets.map((worksheet) => worksheet.name);
    for (const name of actualSheets) {
      if (name !== MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME) {
        issues.push(issue('UNKNOWN_SHEET', 1, null, 'sheet', '只允许一个「特殊流程 SOP」工作表', name));
      }
    }
    if (!actualSheets.includes(MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME)) {
      issues.push(issue('MISSING_SHEET', 1, null, 'sheet', '缺少「特殊流程 SOP」工作表'));
    }
    if (actualSheets.length !== 1) {
      issues.push(issue(
        'SHEET_COUNT_INVALID',
        null,
        null,
        'sheet',
        '工作簿必须恰好包含一个「特殊流程 SOP」工作表',
      ));
    }
    if (issues.length > 0) return failed(sourceSha256, issues);

    const sheet = book.getWorksheet(MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME)!;
    if (sheet.model.merges?.length) {
      issues.push(issue('MERGED_CELLS', 1, null, 'sheet', '取消合并单元格'));
    }
    if (sheet.columnCount > MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.length) {
      issues.push(issue(
        'UNEXPECTED_COLUMN',
        1,
        columnName(MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.length + 1),
        'headers',
        '删除第 18 列之后的额外列',
      ));
    }

    const headerValues = MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.map((expected, index) => {
      const rawValue = sheet.getCell(1, index + 1).value;
      const value = readSopCellText(rawValue);
      const column = columnName(index + 1);
      if (value === undefined) {
        issues.push(issue('NON_TEXT_CELL', 1, column, `headers.${index}`, '表头必须是纯文本'));
        return '';
      }
      if (value !== expected) {
        issues.push(issue(
          'HEADER_MISMATCH',
          1,
          column,
          `headers.${index}`,
          `恢复表头「${expected}」`,
        ));
      }
      return value;
    });
    const seenHeaders = new Set<string>();
    headerValues.forEach((header, index) => {
      if (!header) {
        issues.push(issue('MISSING_HEADER', 1, columnName(index + 1), `headers.${index}`, '补齐 18 列表头'));
        return;
      }
      if (seenHeaders.has(header)) {
        issues.push(issue('DUPLICATE_HEADER', 1, columnName(index + 1), `headers.${index}`, '删除重复表头'));
      }
      seenHeaders.add(header);
    });
    if (issues.length > 0) return failed(sourceSha256, issues);

    const imagesByRow = mapEmbeddedImages(book, sheet, issues);
    if (issues.length > 0) return failed(sourceSha256, issues);

    const sourceRows: MenokinSourceRow[] = [];
    const parsedRowNumbers = new Set<number>();
    let normalizedTextCharacters = 0;
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const values: string[] = [];
      let imageReferenceHash: string | null = null;
      let nonText = false;
      for (let column = 1; column <= MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.length; column++) {
        const raw = row.getCell(column).value;
        if (column === 18) {
          if (wpsImagesByRow.has(rowNumber)) {
            const wpsImage = wpsImagesByRow.get(rowNumber)!;
            values.push(`embedded-sha256:${wpsImage.contentSha256}`);
            continue;
          }
          const controlled = readControlledImageReference(raw);
          if (!controlled.ok) {
            nonText = true;
            issues.push(issue(
              'NON_TEXT_CELL',
              rowNumber,
              columnName(column),
              MENOKIN_FLAT_SOP_WORKBOOK_HEADERS[column - 1]!,
              '图片列只接受文本、有限数值、公式或链接对象',
            ));
            values.push('');
            continue;
          }
          imageReferenceHash = controlled.referenceHash;
          values.push(imageReferenceHash ? `external-sha256:${imageReferenceHash}` : '');
          continue;
        }
        const value = readSopCellText(raw);
        if (value === undefined) {
          nonText = true;
          issues.push(issue(
            'NON_TEXT_CELL',
            rowNumber,
            columnName(column),
            MENOKIN_FLAT_SOP_WORKBOOK_HEADERS[column - 1]!,
            '改成文本、富文本、有限数值或仅显示文字的链接；不要使用公式、日期、布尔值或未知对象',
          ));
          values.push('');
          continue;
        }
        const text = normalizeText(value);
        normalizedTextCharacters += text.length;
        if (text.length > INTAKE_POLICY.cellChars) {
          issues.push(issue(
            'CELL_TEXT_LIMIT',
            rowNumber,
            columnName(column),
            MENOKIN_FLAT_SOP_WORKBOOK_HEADERS[column - 1]!,
            '缩短单元格文本',
          ));
        }
        values.push(text);
      }
      if (normalizedTextCharacters > INTAKE_POLICY.normalizedTextChars) {
        issues.push(issue('NORMALIZED_TEXT_LIMIT', rowNumber, null, null, '拆分工作簿或缩短文本'));
        break;
      }
      const hasText = values.slice(0, 17).some(Boolean);
      const embeddedImages = [
        ...(imagesByRow.get(rowNumber) ?? []),
        ...(wpsImagesByRow.has(rowNumber) ? [wpsImagesByRow.get(rowNumber)!] : []),
      ];
      if (!hasText && embeddedImages.length === 0) continue;
      if (nonText) continue;
      if (!hasText) {
        issues.push(issue('IMAGE_WITHOUT_TEXT', rowNumber, columnName(18), '图片', '图片所在行必须包含文字内容'));
        continue;
      }
      if (sourceRows.length >= maxRows) {
        issues.push(issue('ROW_LIMIT', rowNumber, null, 'sourceRows', `最多允许 ${maxRows} 条数据行`));
        break;
      }

      const groupName = values[4] ?? '';
      if (!GROUP_SET.has(groupName)) {
        issues.push(issue(
          'INVALID_SOP_GROUP',
          rowNumber,
          columnName(5),
          'SOP归属',
          `SOP归属必须是以下五类之一：${MENOKIN_SOP_SEVERITY_ORDER.join('、')}`,
        ));
        continue;
      }
      const sopGroup = groupName as MenokinSopGroup;
      const step = values[8] ?? '';
      const title = values[3] ? values[3] : null;
      const bodyText = [values[5], values[10]].filter(Boolean).join('\n');
      const body = bodyText ? bodyText : null;
      const node = stepNode(step, title, body);
      const targetNodeKey = node.nodeKey;

      const fields: readonly MenokinSourceField[] = values[9]
        ? [{ key: 'field', value: values[9], targetNodeKey }]
        : [];
      const paths: readonly MenokinSourcePath[] = values[7]
        ? [{ fromNodeKey: targetNodeKey, toNodeKey: null, condition: values[7] }]
        : [];
      const scripts: readonly MenokinSourceScript[] = values[11]
        ? [{ targetNodeKey, text: values[11], riskLevel: 'unresolved' }]
        : [];
      const quickPhrases: readonly MenokinSourceQuickPhrase[] = values[12]
        ? [{ targetNodeKey, text: values[12] }]
        : [];
      const images: readonly MenokinSourceImage[] = [
        ...embeddedImages.map((image) => ({
          referenceKind: 'embedded' as const,
          columnNumber: image.columnNumber,
          contentSha256: image.contentSha256,
          referenceHash: null,
          mime: image.mime,
          bytes: image.bytes,
          targetNodeKey,
        })),
        ...(imageReferenceHash
          ? [{
              referenceKind: 'external' as const,
              columnNumber: 18,
              contentSha256: null,
              referenceHash: imageReferenceHash,
              mime: null,
              bytes: null,
              targetNodeKey,
            }]
          : []),
      ];

      sourceRows.push({
        sourceSha256,
        sheetName: sopGroup,
        sopGroup,
        rowNumber,
        rowHash: rowHash(MENOKIN_FLAT_SOP_WORKBOOK_HEADERS, values),
        sourceEntryCode: sourceEntryCode(sourceSha256, rowNumber),
        nodes: [node],
        fields,
        paths,
        scripts,
        quickPhrases,
        images,
        knowledge: knowledgeEntries(values, targetNodeKey),
      });
      parsedRowNumbers.add(rowNumber);
    }

    for (const rowNumber of imagesByRow.keys()) {
      if (!parsedRowNumbers.has(rowNumber)) {
        issues.push(issue('MEDIA_ROW_UNBOUNDED', rowNumber, columnName(18), 'images', '图片必须锚定在有效数据行'));
      }
    }
    for (const rowNumber of wpsImagesByRow.keys()) {
      if (!parsedRowNumbers.has(rowNumber)) {
        issues.push(issue('MEDIA_ROW_UNBOUNDED', rowNumber, columnName(18), 'images', '图片必须锚定在有效数据行'));
      }
    }
    if (sourceRows.length === 0) {
      issues.push(issue('EMPTY_DATA', 2, null, 'sourceRows', '至少需要一条文字数据行'));
    }
    if (issues.length === 0) {
      const sourceIssues = validateMenokinSourceRows(sourceRows);
      for (const sourceIssue of sourceIssues) {
        const sourceRow = sourceIssue.rowIndex === null ? undefined : sourceRows[sourceIssue.rowIndex];
        issues.push(issue(
          sourceIssue.code,
          sourceRow?.rowNumber ?? null,
          null,
          sourceIssue.field,
          '修正对应来源行后重新导入',
          sourceRow?.sopGroup,
        ));
      }
    }
    return issues.length > 0 ? failed(sourceSha256, issues) : {
      ok: true,
      sourceSha256,
      sourceRows,
      issues: [],
    };
  } catch (error) {
    const code = error instanceof IntakeFailure ? error.code : 'INVALID_XLSX';
    return failed(sourceSha256, [issue(code, null, null, '$', '检查文件后重新导出完整的 XLSX 工作簿')]);
  }
}
