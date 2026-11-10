import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { inspectArchive } from './archive.js';
import { INTAKE_POLICY, IntakeFailure, type Issue } from './policy.js';
import { prepareSopWorkbookBytes, readSopCellText } from './sop.js';
import { extractWpsDisplayImages, type WpsImageCoordinate } from './sop-wps-image.js';

const review = ['维护状态', '业务确认人', '待确认事项'];
export const SOP_TASK_FORMAT = Object.freeze({ templateVersion: 'sop-manual-authoring-v1.1',
  ruleVersion: 'sop-task-graph-v2', mappingVersion: 'sop-manual-to-task-graph-v2' });
export const SOP_RESOURCE_FORMAT = Object.freeze({ templateVersion: SOP_TASK_FORMAT.templateVersion,
  ruleVersion: 'sop-task-graph-resource-disable-v1', mappingVersion: 'sop-manual-to-task-graph-resource-disable-v1' });
export type SopTaskRuleVersion = typeof SOP_TASK_FORMAT.ruleVersion | typeof SOP_RESOURCE_FORMAT.ruleVersion;
export const SOP_TASK_HEADERS = {
  场景目录: ['场景编号', '场景名称', '适用范围', '起始任务编号', '入口词', '生效时间', '失效时间', ...review],
  执行任务: ['记录类型', '任务编号', '场景编号', '阶段', '任务名称', '任务类型', '操作要求', '确认项配置', '下一任务编号', '关联知识编号', '关联资源编号', '可见对象', '关联编号', '话术编号', '适用条件', '话术关系', '确认项编号', '确认项文字', '确认项顺序', ...review],
  判断分支: ['分支编号', '任务编号', '选项', '判断依据', '目标任务编号', '是否无法判断', '匹配词', '分支顺序', ...review],
  客户话术: ['话术编号', '话术标题', '对客正文', '关联资源编号', ...review],
  知识与案例: ['知识编号', '标题', '正文', '可见对象', '关联资源编号', ...review],
  资源与图片: ['资源编号', '资源类型', '资源名称', '可见对象', '适用范围', '资源内容', '图片', ...review],
} as const;
export type SopTaskSheet = keyof typeof SOP_TASK_HEADERS;
export const SOP_TASK_SHEETS = Object.keys(SOP_TASK_HEADERS) as SopTaskSheet[];
export const SOP_TASK_STRUCTURE_SHA256 = createHash('sha256').update(JSON.stringify(SOP_TASK_HEADERS)).digest('hex');
export type SopTaskRow = { row: number; values: Readonly<Record<string, string>> };
export type SopTaskImage = { resourceId: string; bytes: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/gif' };
export type SopTaskWorkbook = { sheets: Record<SopTaskSheet, SopTaskRow[]>; images: SopTaskImage[] };
export class SopTaskWorkbookFailure extends IntakeFailure {
  constructor(readonly issue: Issue) { super(issue.code); }
}

/** Reads the registered six-table format only. Identity, authority and mapping
 * remain server-owned. A rejected row never produces a partial usable graph. */
export async function parseSopTaskWorkbook(bytes: Buffer,
  ruleVersion: SopTaskRuleVersion = SOP_TASK_FORMAT.ruleVersion): Promise<SopTaskWorkbook> {
  await inspectArchive(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await prepareSopWorkbookBytes(bytes) as unknown as ExcelJS.Buffer);
  if (book.worksheets.length !== SOP_TASK_SHEETS.length) throw new IntakeFailure('SOP_MAPPING_REQUIRED');
  const sheets = {} as Record<SopTaskSheet, SopTaskRow[]>;
  const images: SopTaskImage[] = [];
  const coordinates: WpsImageCoordinate[] = [];
  const resourceRows = new Map<number, string>();
  let textBytes = 0;
  for (const name of SOP_TASK_SHEETS) {
    const sheet = book.getWorksheet(name), headers = SOP_TASK_HEADERS[name];
    if (!sheet || sheet.model.merges?.length || sheet.columnCount > headers.length
      || sheet.getBackgroundImageId() !== undefined) throw new IntakeFailure('SOP_MAPPING_REQUIRED');
    const text = (cell: ExcelJS.Cell): string => {
      if (cell.value === null) return '';
      const value = typeof cell.value === 'object' && 'richText' in cell.value ? readSopCellText(cell.value) : cell.value;
      if (typeof value !== 'string') throw new SopTaskWorkbookFailure({ code: 'NON_TEXT_CELL', sheet: name,
        row: Number(cell.row), column: cell.address.replace(/[0-9]/g, ''), fix: '使用明确文本字段' });
      textBytes += Buffer.byteLength(value);
      if (value.length > INTAKE_POLICY.cellChars || textBytes > INTAKE_POLICY.outputBytes) throw new IntakeFailure('FILE_LIMIT');
      return value;
    };
    headers.forEach((header, i) => {
      const cell = sheet.getCell(1, i + 1);
      if (text(cell) !== header) throw new SopTaskWorkbookFailure({ code: 'SOP_MAPPING_REQUIRED', sheet: name,
        row: 1, column: cell.address.replace(/[0-9]/g, ''), fix: `使用已登记表头 ${header}` });
    });
    sheets[name] = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const values: Record<string, string> = {};
      headers.forEach((header, i) => {
        const cell = row.getCell(i + 1);
        if (name === '资源与图片' && header === '图片' && cell.type === ExcelJS.ValueType.Formula) {
          coordinates.push({ sheet: name, row: number, column: 'G', formula: cell.formula });
          values[header] = '';
        } else values[header] = text(cell);
      });
      if (Object.values(values).every(value => value === '')) return;
      if (!['启用', '停用'].includes(values['维护状态'] ?? '') || !values['业务确认人']?.trim()
        || values['待确认事项'] !== '') throw new SopTaskWorkbookFailure({ code: 'SOP_MAPPING_REQUIRED', sheet: name,
          row: number, column: row.getCell(headers.length).address.replace(/[0-9]/g, ''), fix: '逐行明确维护状态、确认人及待确认事项' });
      const resourceDisable = name === '资源与图片' && values['维护状态'] === '停用';
      if (resourceDisable && ruleVersion !== SOP_RESOURCE_FORMAT.ruleVersion) throw new SopTaskWorkbookFailure({
        code: 'SOP_MAPPING_REQUIRED', sheet: name, row: number, column: 'H',
        fix: '冻结材料缺少可审阅的资源独立停用及对应质量目标，补齐合同后重新接收',
      });
      if (name !== '场景目录' && name !== '客户话术' && !resourceDisable && values['维护状态'] === '停用') throw new IntakeFailure('SOP_MAPPING_REQUIRED');
      sheets[name].push({ row: number, values });
      if (name === '资源与图片') resourceRows.set(number, values['资源编号'] ?? '');
    });
    for (const image of sheet.getImages()) {
      if (name !== '资源与图片' || image.range.tl.nativeCol !== 6) throw new IntakeFailure('SOP_MAPPING_REQUIRED');
      const resourceId = resourceRows.get(image.range.tl.nativeRow + 1);
      const data = book.getImage(Number(image.imageId));
      if (!resourceId || !data?.buffer) throw new IntakeFailure('SOP_MEDIA_UNAVAILABLE');
      const payload = Buffer.from(data.buffer);
      const mime = imageMime(payload);
      images.push({ resourceId, bytes: payload, mime });
    }
  }
  const wps = await extractWpsDisplayImages(await JSZip.loadAsync(bytes), coordinates);
  if (wps.issues.length) throw new IntakeFailure('SOP_MEDIA_UNAVAILABLE');
  for (const item of wps.items) {
    const resourceId = resourceRows.get(item.row);
    if (!resourceId) throw new IntakeFailure('SOP_MAPPING_REQUIRED');
    images.push({ resourceId, bytes: item.data, mime: item.mime });
  }
  if (images.length > 500 || new Set(images.map(image => image.resourceId)).size !== images.length) throw new IntakeFailure('SOP_MAPPING_REQUIRED');
  return { sheets, images };
}

function imageMime(bytes: Buffer): SopTaskImage['mime'] {
  if (bytes.length < 1 || bytes.length > 5_242_880) throw new IntakeFailure('FILE_LIMIT');
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  throw new IntakeFailure('SOP_MEDIA_UNAVAILABLE');
}
