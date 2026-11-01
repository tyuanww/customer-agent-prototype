import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { crc32 } from 'node:zlib';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { inspectArchive } from './archive.js';
import { INTAKE_POLICY as P, IntakeFailure, type Issue } from './policy.js';
import { isEntryCode, isSopGif, SOP_GIF_UNSUPPORTED_FIX } from './sop.js';

/** Offline authoring formats, distinct from registered runtime SOP imports. */
export const SOP_MAINTENANCE_TEMPLATE_VERSION = 'sop-manual-authoring-v1.1';
const PREVIOUS_MAINTENANCE_TEMPLATE_VERSION = 'sop-manual-authoring-v1';
type MaintenanceTemplateVersion = typeof SOP_MAINTENANCE_TEMPLATE_VERSION | typeof PREVIOUS_MAINTENANCE_TEMPLATE_VERSION;
const REVIEW_HEADERS = ['维护状态', '业务确认人', '待确认事项'] as const;
const TASK_ROW_FIELDS: Readonly<Record<string, readonly string[]>> = {
  任务: ['记录类型', '任务编号', '场景编号', '阶段', '任务名称', '任务类型', '操作要求', '确认项配置', '下一任务编号', '关联知识编号', '关联资源编号', '可见对象', ...REVIEW_HEADERS],
  话术引用: ['记录类型', '任务编号', '关联编号', '话术编号', '适用条件', '话术关系', ...REVIEW_HEADERS],
  确认项: ['记录类型', '任务编号', '确认项编号', '确认项文字', '确认项顺序', ...REVIEW_HEADERS],
};
export const SOP_MAINTENANCE_HEADERS = {
  场景目录: ['场景编号', '场景名称', '适用范围', '起始任务编号', '入口词', '生效时间', '失效时间', ...REVIEW_HEADERS],
  执行任务: ['记录类型', '任务编号', '场景编号', '阶段', '任务名称', '任务类型', '操作要求', '确认项配置', '下一任务编号', '关联知识编号', '关联资源编号', '可见对象', '关联编号', '话术编号', '适用条件', '话术关系', '确认项编号', '确认项文字', '确认项顺序', ...REVIEW_HEADERS],
  判断分支: ['分支编号', '任务编号', '选项', '判断依据', '目标任务编号', '是否无法判断', '匹配词', '分支顺序', ...REVIEW_HEADERS],
  客户话术: ['话术编号', '话术标题', '对客正文', '关联资源编号', ...REVIEW_HEADERS],
  知识与案例: ['知识编号', '标题', '正文', '可见对象', '关联资源编号', ...REVIEW_HEADERS],
  资源与图片: ['资源编号', '资源类型', '资源名称', '可见对象', '适用范围', '资源内容', '图片', ...REVIEW_HEADERS],
} as const;

/** Creates only the offline maintenance skeleton. Business rows are supplied by
 * the author; a blank template deliberately fails the content checks. */
export async function createSopMaintenanceTemplate(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, headers] of Object.entries(SOP_MAINTENANCE_HEADERS)) {
    const sheet = book.addWorksheet(name);
    sheet.addRow([SOP_MAINTENANCE_TEMPLATE_VERSION]);
    sheet.addRow([...headers]);
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

type SheetName = keyof typeof SOP_MAINTENANCE_HEADERS;
const isSheetName = (value: string): value is SheetName => Object.hasOwn(SOP_MAINTENANCE_HEADERS, value);
type ReviewState = '待核对' | '草稿' | '待发布' | '启用' | '停用';
type ReaderVisibility = '坐席可读' | '主管可读';
type Visibility = ReaderVisibility | '对客可用';
type RecordLocation = Readonly<{ sheet: SheetName; row: number }>;
type AuthoringRow = RecordLocation & Readonly<{ id: string; state: ReviewState; fields: ReadonlyMap<string, string> }>;
type TaskBase = Readonly<{ record: AuthoringRow; sceneId: string; knowledgeIds: readonly string[]; resourceIds: readonly string[];
  visibility: ReaderVisibility; requirements: MaintenanceTaskBase['requirements'] }>;
type Task = TaskBase & ({ kind: 'action'; nextId: string } | { kind: 'decision' } | { kind: 'terminal' });
type ChoiceOrdinal = 1 | 2 | 3 | 4;
type Branch = Readonly<{ record: AuthoringRow; taskId: string; targetId: string; unknown: boolean;
  matchTerms: readonly string[] | null; ordinal: ChoiceOrdinal | null }>;
type Scene = Readonly<{ record: AuthoringRow; startId: string; entryTerms: readonly string[] | null }>;
type IssueReporter = (code: string, location: RecordLocation | null, field: string, message: string, structural?: boolean) => void;

export type MaintenanceCheck = Readonly<{
  templateVersion: MaintenanceTemplateVersion;
  status: 'invalid' | 'needs-review' | 'reviewed';
  sourceCheck: 'not-checked';
  publishable: false;
  entries: number;
  resources: number;
  images: number;
  counts: Readonly<Record<SheetName, number>>;
  issues: readonly Issue[];
}>;

/** These fields are workbook claims, not authenticated review or authorization. */
export type MaintenanceReview = Readonly<{
  state: ReviewState;
  confirmerText: string;
  pendingText: string;
}>;
type MaintenanceRecord = Readonly<{ id: string; review: MaintenanceReview }>;
export type MaintenanceScene = MaintenanceRecord & Readonly<{
  title: string; scopeText: string; startTaskId: string; entryTerms: readonly string[] | null; effectiveFrom: string; effectiveTo: string;
}>;
type MaintenanceTaskBase = MaintenanceRecord & Readonly<{
  sceneId: string; stage: string; title: string; instruction: string;
  requirements: { kind: 'unconfirmed'; legacyText: string | null } | { kind: 'none' } | { kind: 'specified' };
  knowledgeIds: readonly string[]; resourceIds: readonly string[]; visibility: ReaderVisibility;
}>;
export type MaintenanceTask = MaintenanceTaskBase & (
  | Readonly<{ kind: 'action'; nextTaskId: string }>
  | Readonly<{ kind: 'decision' }>
  | Readonly<{ kind: 'terminal' }>
);
export type MaintenanceBranch = MaintenanceRecord & Readonly<{
  taskId: string; label: string; criterion: string; targetTaskId: string; unableToDetermine: boolean;
  matchTerms: readonly string[] | null; ordinal: ChoiceOrdinal | null;
}>;
export type MaintenanceScript = MaintenanceRecord & Readonly<{
  title: string; answerText: string; resourceIds: readonly string[];
}>;
type ScriptLinkFields = Readonly<{ taskId: string; scriptId: string; condition: string;
  relationship: '独立' | '替代' | '配套'; review: MaintenanceReview }>;
export type MaintenanceScriptLink = ScriptLinkFields & (
  | Readonly<{ origin: 'explicit'; id: string }>
  | Readonly<{ origin: 'legacy'; id: null }>
);
export type MaintenanceRequirement = MaintenanceRecord & Readonly<{
  taskId: string; label: string; ordinal: number | null;
}>;
export type MaintenanceKnowledge = MaintenanceRecord & Readonly<{
  title: string; body: string; visibility: ReaderVisibility; resourceIds: readonly string[];
}>;
export type MaintenanceImage = Readonly<{
  bytes: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/gif'; sha256: string;
}>;
type MaintenanceResourceBase = MaintenanceRecord & Readonly<{
  title: string; visibility: Visibility; scopeText: string; content: string; imageCellText: string;
}>;
export type MaintenanceResource = MaintenanceResourceBase & (
  | Readonly<{ kind: 'image'; images: readonly MaintenanceImage[] }>
  | Readonly<{ kind: 'document' }>
);
/** Array order reflects the workbook only; it does not define business priority.
 * Scope labels, confirmer names and review states require separate verification. */
export type MaintenanceDocument = Readonly<{
  templateVersion: MaintenanceTemplateVersion; publishable: false;
  scenes: readonly MaintenanceScene[]; tasks: readonly MaintenanceTask[]; branches: readonly MaintenanceBranch[];
  scripts: readonly MaintenanceScript[]; scriptLinks: readonly MaintenanceScriptLink[];
  requirements: readonly MaintenanceRequirement[]; knowledge: readonly MaintenanceKnowledge[]; resources: readonly MaintenanceResource[];
}>;
export type MaintenanceParseResult =
  | Readonly<{ kind: 'invalid'; report: MaintenanceCheck & { status: 'invalid' } }>
  | Readonly<{ kind: 'parsed'; report: MaintenanceCheck & { status: 'needs-review' | 'reviewed' }; document: MaintenanceDocument }>;

const text = (row: AuthoringRow, field: string): string => row.fields.get(field) ?? '';
const active = (row: AuthoringRow): boolean => row.state !== '停用';
const states: readonly ReviewState[] = ['待核对', '草稿', '待发布', '启用', '停用'];
function isReviewState(value: string): value is ReviewState { return states.some(state => state === value); }
function visibility(row: AuthoringRow, report: IssueReporter): ReaderVisibility;
function visibility(row: AuthoringRow, report: IssueReporter, customer: true): Visibility;
function visibility(row: AuthoringRow, report: IssueReporter, customer = false): Visibility {
  const value = text(row, '可见对象');
  if (value === '坐席可读' || value === '主管可读' || (customer && value === '对客可用')) return value;
  report('VISIBILITY_REQUIRED', row, '可见对象', '填写明确的可见对象');
  return '主管可读';
}
function review(row: AuthoringRow): MaintenanceReview {
  return { state: row.state, confirmerText: text(row, '业务确认人'), pendingText: text(row, '待确认事项') };
}
function refs(row: AuthoringRow, field: string, report: IssueReporter): string[] {
  const raw = text(row, field);
  if (!raw) return [];
  const ids = raw.split(',').map(value => value.trim());
  if (ids.some(id => !isEntryCode(id)) || new Set(ids).size !== ids.length) {
    report('INVALID_REFERENCES', row, field, '关联编号须合法、不重复，并使用英文逗号分隔');
  }
  return ids;
}
// Version 1 is a read-only historical format, not a partially upgraded v1.1.
function headersFor(name: SheetName, version: MaintenanceTemplateVersion): readonly string[] {
  if (version === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION) {
    if (name === '执行任务') return ['任务编号', '场景编号', '阶段', '任务名称', '任务类型', '操作要求', '必须确认的信息', '下一任务编号', '关联知识编号', '关联资源编号', '可见对象', ...REVIEW_HEADERS];
    if (name === '客户话术') return ['话术编号', '任务编号', '话术标题', '对客正文', '适用条件', '话术关系', '关联资源编号', ...REVIEW_HEADERS];
  }
  const headers: readonly string[] = SOP_MAINTENANCE_HEADERS[name];
  return version === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION
    ? headers.filter(header => !['入口词', '匹配词', '分支顺序'].includes(header)) : headers;
}

/** A blank cell is unresolved. Only a whole match-terms cell can explicitly be empty. */
function terms(row: AuthoringRow, field: '入口词' | '匹配词', report: IssueReporter): readonly string[] | null {
  const raw = text(row, field);
  if (!raw.trim()) {
    report(field === '入口词' ? 'ENTRY_TERMS_PENDING' : 'MATCH_TERMS_PENDING', row, field, '明确填写词项，缺失时需要人工核对', false);
    return null;
  }
  if (field === '匹配词' && raw === '不设置') return [];
  // An extra leading backslash preserves literal terms that would otherwise be reserved.
  const values = raw.split(/\r\n|\r|\n/u).map(value =>
    field === '匹配词' && /^\\+不设置$/u.test(value) ? value.slice(1) : value);
  if (values.length > 32) report('TERMS_LIMIT', row, field, '词项每组最多 32 个');
  if (values.some(value => !/\S/u.test(value) || Array.from(value).length > 128 || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value))) {
    report('INVALID_TERM', row, field, '每行填写一个非空词项，每项最多 128 个字符');
  }
  if (new Set(values).size !== values.length) report('DUPLICATE_TERM', row, field, '同一单元格内的词项不得重复');
  return values;
}

function branchOrdinal(row: AuthoringRow, report: IssueReporter): ChoiceOrdinal | null {
  const raw = text(row, '分支顺序');
  if (!raw.trim()) {
    report('BRANCH_ORDINAL_PENDING', row, '分支顺序', '明确填写分支顺序，缺失时需要人工核对', false);
    return null;
  }
  switch (raw) {
    case '1': return 1;
    case '2': return 2;
    case '3': return 3;
    case '4': return 4;
    default:
      report('INVALID_BRANCH_ORDINAL', row, '分支顺序', '分支顺序填写 1 至 4 的整数文本');
      return null;
  }
}
function requirementOrdinal(row: AuthoringRow, report: IssueReporter): number | null {
  const raw = text(row, '确认项顺序');
  if (!raw.trim()) {
    report('REQUIREMENT_ORDINAL_PENDING', row, '确认项顺序', '明确填写确认项顺序，缺失时需要人工核对', false);
    return null;
  }
  if (!/^(?:[1-9]|[12][0-9]|3[0-2])$/u.test(raw)) {
    report('INVALID_REQUIREMENT_ORDINAL', row, '确认项顺序', '确认项顺序填写 1 至 32 的整数文本');
    return null;
  }
  return Number(raw);
}
function boundedText(row: AuthoringRow, field: string, report: IssueReporter): void {
  const value = text(row, field);
  if (!value.trim() || Array.from(value).length > 1024 || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
    report('INVALID_FIELD_TEXT', row, field, '填写非空文字，最多 1024 个字符');
  }
}
function validTime(value: string): boolean {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const day = new Date(`${parts[1]}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === parts[1]
    && Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60
    && Number(parts[5] ?? 0) < 24 && Number(parts[6] ?? 0) < 60;
}
function requireText(row: AuthoringRow, fields: readonly string[], report: IssueReporter): void {
  for (const field of fields) if (!text(row, field).trim()) report('REQUIRED_FIELD', row, field, '补齐必填内容');
}
function checkScope(row: AuthoringRow, report: IssueReporter): void {
  const scope = text(row, '适用范围').trim();
  if (!scope || scope === '待确认') {
    report('SCOPE_PENDING', row, '适用范围', '明确适用范围，空值不代表通用', false);
  }
}

/** ExcelJS can silently discard valid OOXML anchors. Inspect bounded, already
 * validated archive parts independently before trusting its image objects. */
async function countImageAnchors(bytes: Buffer): Promise<Readonly<{
  counts: ReadonlyMap<string, number>; backgrounds: readonly Readonly<{ sheet: string; resource: string; gif: boolean }>[];
}>> {
  const zip = await JSZip.loadAsync(bytes);
  const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  const drawingMain = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const sheetMain = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  type Frame = { uri: string; local: string; pictures?: number; imageRelation?: string };
  type Relation = { type: string; target: string };
  const relationParts = new Map<string, Map<string, Relation>>();
  const workbookSheets: { name: string; relation: string }[] = [];
  const sheetDrawings = new Map<string, string[]>();
  const sheetBackgrounds = new Map<string, string[]>();
  const drawingPictures = new Map<string, string[]>();
  const attribute = (tag: SaxesTagNS, uri: string, local: string): string | undefined =>
    Object.values(tag.attributes).find(value => value.uri === uri && value.local === local)?.value;
  let count = 0;
  for (const file of Object.values(zip.files)) {
    if (file.dir || !/\.(?:xml|vml|rels)$/iu.test(file.name)) continue;
    const stack: Frame[] = [];
    const xml = new SaxesParser({ xmlns: true });
    xml.on('doctype', () => { throw new IntakeFailure('ACTIVE_CONTENT'); });
    xml.on('opentag', tag => {
      const parent = stack.at(-1), root = stack[0];
      if (tag.uri === packageRelations && tag.local === 'Relationship' && file.name.endsWith('.rels')) {
        const id = attribute(tag, '', 'Id'), type = attribute(tag, '', 'Type'), target = attribute(tag, '', 'Target');
        const entries = relationParts.get(file.name) ?? new Map<string, Relation>();
        if (!id || !type || !target || entries.has(id)) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
        entries.set(id, { type, target }); relationParts.set(file.name, entries);
      }
      if (file.name === 'xl/workbook.xml' && tag.uri === sheetMain && tag.local === 'sheet') {
        const name = attribute(tag, '', 'name'), relation = attribute(tag, relations, 'id');
        if (!name || !relation) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
        workbookSheets.push({ name, relation });
      }
      if (tag.uri === sheetMain && tag.local === 'drawing' && root?.uri === sheetMain && root.local === 'worksheet') {
        const relation = attribute(tag, relations, 'id');
        if (!relation) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
        const values = sheetDrawings.get(file.name) ?? []; values.push(relation); sheetDrawings.set(file.name, values);
      }
      if (tag.uri === sheetMain && tag.local === 'picture' && root?.uri === sheetMain && root.local === 'worksheet') {
        const relation = attribute(tag, relations, 'id');
        if (!relation) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
        const values = sheetBackgrounds.get(file.name) ?? []; values.push(relation); sheetBackgrounds.set(file.name, values);
      }
      if (tag.uri === 'urn:schemas-microsoft-com:vml' && tag.local === 'imagedata') throw new IntakeFailure('UNSUPPORTED_IMAGE_ANCHOR');
      if (tag.uri === drawing && ['oneCellAnchor', 'twoCellAnchor', 'absoluteAnchor'].includes(tag.local)) {
        stack.push({ uri: tag.uri, local: tag.local, pictures: 0 });
        return;
      }
      if (tag.uri === drawing && tag.local === 'pic') {
        if (root?.uri !== drawing || root.local !== 'wsDr' || parent?.uri !== drawing
          || !['oneCellAnchor', 'twoCellAnchor'].includes(parent.local) || stack.length !== 2
          || parent.pictures === undefined || ++parent.pictures !== 1) {
          throw new IntakeFailure('UNSUPPORTED_IMAGE_ANCHOR');
        }
        if (++count > P.mediaCount) throw new IntakeFailure('MEDIA_LIMIT');
        stack.push({ uri: tag.uri, local: tag.local });
        return;
      }
      if (tag.uri === drawingMain && tag.local === 'blip') {
        const picture = [...stack].reverse().find(frame => frame.uri === drawing && frame.local === 'pic');
        const embedded = attribute(tag, relations, 'embed');
        if (!picture || picture.imageRelation !== undefined || !embedded || attribute(tag, relations, 'link') !== undefined) {
          throw new IntakeFailure('UNSUPPORTED_IMAGE_ANCHOR');
        }
        picture.imageRelation = embedded;
      }
      stack.push({ uri: tag.uri, local: tag.local });
    });
    xml.on('closetag', () => {
      const frame = stack.pop();
      if (frame?.uri === drawing && frame.local === 'pic') {
        if (!frame.imageRelation) throw new IntakeFailure('UNSUPPORTED_IMAGE_ANCHOR');
        const values = drawingPictures.get(file.name) ?? []; values.push(frame.imageRelation); drawingPictures.set(file.name, values);
      }
    });
    xml.write(await file.async('string')).close();
  }
  const relationFile = (part: string): string => posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
  const targetFor = (part: string, id: string, type: string): string => {
    const relation = relationParts.get(relationFile(part))?.get(id);
    if (!relation || ![`${relations}/${type}`, `http://purl.oclc.org/ooxml/officeDocument/relationships/${type}`].includes(relation.type)) {
      throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    }
    const target = posix.normalize(posix.join(posix.dirname(part), relation.target));
    if (!target.startsWith('xl/') || !zip.file(target)) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    return target;
  };
  const used = new Set<string>();
  for (const [part, ids] of drawingPictures) for (const id of ids) {
    const target = targetFor(part, id, 'image');
    if (!target.startsWith('xl/media/')) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    used.add(`${relationFile(part)}\0${id}`);
  }
  for (const [part, ids] of sheetBackgrounds) for (const id of ids) {
    const target = targetFor(part, id, 'image');
    if (!target.startsWith('xl/media/')) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    used.add(`${relationFile(part)}\0${id}`);
  }
  for (const [part, entries] of relationParts) for (const [id, relation] of entries) {
    if (relation.type.endsWith('/image') && !used.has(`${part}\0${id}`)) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
  }
  const sheetsByPart = new Map<string, string>();
  for (const sheet of workbookSheets) {
    const part = targetFor('xl/workbook.xml', sheet.relation, 'worksheet');
    if (sheetsByPart.has(part)) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    sheetsByPart.set(part, sheet.name);
  }
  const drawingOwners = new Map<string, string[]>();
  for (const [sheetPart, ids] of sheetDrawings) for (const id of ids) {
    const part = targetFor(sheetPart, id, 'drawing');
    const owners = drawingOwners.get(part) ?? []; owners.push(sheetPart); drawingOwners.set(part, owners);
  }
  const result = new Map<string, number>();
  for (const [part, ids] of drawingPictures) {
    const owners = drawingOwners.get(part) ?? [];
    const owner = owners[0], name = owner && sheetsByPart.get(owner);
    if (owners.length !== 1 || !name || (sheetDrawings.get(owner ?? '')?.length ?? 0) !== 1 || result.has(name)) {
      throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    }
    result.set(name, ids.length);
  }
  const backgrounds: { sheet: string; resource: string; gif: boolean }[] = [];
  for (const [part, ids] of sheetBackgrounds) for (const id of ids) {
    const sheet = sheetsByPart.get(part), resource = targetFor(part, id, 'image');
    const image = zip.file(resource);
    if (!sheet || !image) throw new IntakeFailure('UNRESOLVED_IMAGE_RELATION');
    backgrounds.push({ sheet, resource, gif: isSopGif(posix.extname(resource).slice(1), await image.async('nodebuffer')) });
  }
  return { counts: result, backgrounds };
}

/** Validate image containers before returning bytes; this is not a pixel decoder. */
function validPng(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) return false;
    if (!header) {
      if (name !== 'IHDR' || length !== 13 || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) return false;
      header = true;
    } else if (name === 'IHDR') return false;
    if (name === 'IDAT') data = true;
    if (name === 'IEND') return length === 0 && data && end + 4 === bytes.length;
    offset = end + 4;
  }
  return false;
}

function validJpeg(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return false;
  let offset = 2, frame = false, scan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) return false;
    if (marker === 217) return frame && scan && offset === bytes.length;
    if (marker === 0 || marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) return false;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ((marker >= 192 && marker <= 195) || (marker >= 197 && marker <= 199)
      || (marker >= 201 && marker <= 203) || (marker >= 205 && marker <= 207)) {
      if (length < 8 || bytes.readUInt16BE(offset + 3) === 0 || bytes.readUInt16BE(offset + 5) === 0) return false;
      frame = true;
    }
    offset += length;
    if (marker !== 218) continue;
    if (!frame || length < 6) return false;
    scan = true;
    let nextMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 255) { offset++; continue; }
      const start = offset;
      while (bytes[offset] === 255) offset++;
      const next = bytes[offset];
      if (next === undefined) return false;
      if (next === 0 || (next >= 208 && next <= 215)) { offset++; continue; }
      offset = start; nextMarker = true; break;
    }
    if (!nextMarker) return false;
  }
  return false;
}

function gifBlocksEnd(bytes: Buffer, start: number, requireData: boolean): number | null {
  let offset = start, data = false;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === undefined) return null;
    if (length === 0) return !requireData || data ? offset : null;
    if (offset + length > bytes.length) return null;
    data = true; offset += length;
  }
  return null;
}

function validGif(bytes: Buffer): boolean {
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
    || bytes.readUInt16LE(6) === 0 || bytes.readUInt16LE(8) === 0) return false;
  const globalFlags = bytes[10];
  if (globalFlags === undefined) return false;
  let offset = 13 + ((globalFlags & 128) ? 3 * (2 ** ((globalFlags & 7) + 1)) : 0), image = false;
  while (offset < bytes.length) {
    const tag = bytes[offset++];
    if (tag === 59) return image && offset === bytes.length;
    if (tag === 33) {
      if (offset >= bytes.length) return false;
      const end = gifBlocksEnd(bytes, offset + 1, false);
      if (end === null) return false;
      offset = end; continue;
    }
    if (tag !== 44 || offset + 9 > bytes.length || bytes.readUInt16LE(offset + 4) === 0 || bytes.readUInt16LE(offset + 6) === 0) return false;
    const flags = bytes[offset + 8];
    if (flags === undefined) return false;
    offset += 9 + ((flags & 128) ? 3 * (2 ** ((flags & 7) + 1)) : 0);
    const codeSize = bytes[offset++];
    if (codeSize === undefined || codeSize < 2 || codeSize > 8) return false;
    const end = gifBlocksEnd(bytes, offset, true);
    if (end === null) return false;
    offset = end; image = true;
  }
  return false;
}

export function imageMime(bytes: Buffer, extension: string): MaintenanceImage['mime'] | null {
  extension = extension.toLowerCase();
  if (extension === 'png' && validPng(bytes)) return 'image/png';
  if ((extension === 'jpeg' || extension === 'jpg') && validJpeg(bytes)) return 'image/jpeg';
  if (extension === 'gif' && validGif(bytes)) return 'image/gif';
  return null;
}

/** The template assigns an image by its anchor in the image column of one resource
 * row. A drawing that overlaps another row has no unambiguous resource owner. */
function imageAnchorIssue(sheet: ExcelJS.Worksheet, image: ReturnType<ExcelJS.Worksheet['getImages']>[number]): 'column' | 'row' | null {
  const { tl, br } = image.range;
  const imageColumn = SOP_MAINTENANCE_HEADERS.资源与图片.indexOf('图片');
  const column = sheet.getColumn(imageColumn + 1);
  // Match ExcelJS's anchor coordinate model and reject offsets it would clamp.
  const columnWidth = column.isCustomWidth ? Math.floor((column.width ?? NaN) * 10000) : 640000;
  if (!tl || !Number.isSafeInteger(tl.nativeCol) || tl.nativeCol !== imageColumn
    || !Number.isSafeInteger(tl.nativeColOff) || tl.nativeColOff < 0 || column.hidden
    || !Number.isFinite(columnWidth) || columnWidth <= 0 || tl.nativeColOff >= columnWidth) return 'column';
  if (!Number.isSafeInteger(tl.nativeRow) || tl.nativeRow < 2 || tl.nativeRow > P.rows + 1
    || !Number.isSafeInteger(tl.nativeRowOff) || tl.nativeRowOff < 0) return 'row';
  const height = sheet.getRow(tl.nativeRow + 1).height ?? sheet.properties.defaultRowHeight ?? 15;
  if (!Number.isFinite(height) || height <= 0 || tl.nativeRowOff >= height * 12700) return 'row';
  if (br) {
    if (!Number.isSafeInteger(br.nativeRow) || !Number.isSafeInteger(br.nativeRowOff)) return 'row';
    const endsInRow = br.nativeRow === tl.nativeRow && br.nativeRowOff > tl.nativeRowOff && br.nativeRowOff <= height * 12700;
    const endsAtBoundary = br.nativeRow === tl.nativeRow + 1 && br.nativeRowOff === 0;
    return endsInRow || endsAtBoundary ? null : 'row';
  }
  // ExcelJS also reads one-cell anchors with pixel extents instead of `br`.
  if ('ext' in image.range && typeof image.range.ext === 'object' && image.range.ext !== null
    && 'width' in image.range.ext && typeof image.range.ext.width === 'number'
    && Number.isFinite(image.range.ext.width) && image.range.ext.width > 0
    && 'height' in image.range.ext && typeof image.range.ext.height === 'number'
    && Number.isFinite(image.range.ext.height) && image.range.ext.height > 0) {
    if (tl.nativeRowOff + image.range.ext.height * 9525 <= height * 12700) return null;
  }
  return 'row';
}

/** Parse and validate one workbook in memory. Invalid structure never exposes
 * partial contents. A parsed document is still an unapproved maintenance draft. */
export async function parseSopMaintenance(bytes: Buffer): Promise<MaintenanceParseResult> {
  const issues: Issue[] = [];
  let invalid = false, images = 0, taskEntries = 0;
  const referencedMedia = new Set<number>();
  let templateVersion: MaintenanceTemplateVersion = SOP_MAINTENANCE_TEMPLATE_VERSION;
  const counts: Record<SheetName, number> = { 场景目录: 0, 执行任务: 0, 判断分支: 0, 客户话术: 0, 知识与案例: 0, 资源与图片: 0 };
  const report: IssueReporter = (code, location, field, fix, structural = true) => {
    invalid ||= structural;
    const headers: readonly string[] = location ? headersFor(location.sheet, templateVersion) : [];
    const index = headers.indexOf(field);
    issues.push({ code, sheet: location?.sheet ?? '', row: location?.row ?? 0,
      column: index < 0 ? '' : String.fromCharCode(65 + index), fix });
  };
  const result = <Status extends MaintenanceCheck['status']>(status: Status): MaintenanceCheck & { status: Status } => ({
    templateVersion, status, sourceCheck: 'not-checked', publishable: false,
    entries: taskEntries, resources: counts.资源与图片, images, counts, issues });
  const invalidResult = (): MaintenanceParseResult => ({ kind: 'invalid', report: result('invalid') });
  if (bytes.length > P.fileBytes) {
    report('FILE_TOO_LARGE', null, '', '文件超过维护表预算');
    return invalidResult();
  }
  try {
    const archive = await inspectArchive(bytes);
    const inspected = await countImageAnchors(bytes);
    for (const background of inspected.backgrounds) {
      const location = isSheetName(background.sheet) ? { sheet: background.sheet, row: 1 } : null;
      report(background.gif ? 'MEDIA_FORMAT_UNSUPPORTED' : 'UNANCHORED_IMAGE', location, '', background.gif
        ? `工作表背景：${SOP_GIF_UNSUPPORTED_FIX}`
        : '工作表背景无法关联资源行，请调整后重新导入');
    }
    if (inspected.backgrounds.length) return invalidResult();
    const anchorCounts = inspected.counts;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(bytes).buffer);
    if (book.worksheets.some(sheet => sheet.getImages().length !== (anchorCounts.get(sheet.name) ?? 0))
      || [...anchorCounts.keys()].some(name => !book.getWorksheet(name))) {
      report('UNRESOLVED_IMAGE_ANCHOR', null, '', '图片锚点无法完整读取或确定归属');
      return invalidResult();
    }
    if (book.getWorksheet('场景目录')?.getCell('A1').value === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION) {
      templateVersion = PREVIOUS_MAINTENANCE_TEMPLATE_VERSION;
    }
    const sheets = new Map<SheetName, ExcelJS.Worksheet>();
    const tables = new Map<SheetName, AuthoringRow[]>();
    const byId = new Map<string, AuthoringRow>();
    const requirementIdsByTask = new Map<string, Set<string>>();
    let chars = 0;
    const readSheet = (name: SheetName): void => {
      const sheet = book.getWorksheet(name);
      const headers = headersFor(name, templateVersion);
      const location = { sheet: name, row: 1 };
      if (!sheet) { report('MISSING_SHEET', location, '', '恢复维护表工作表'); return; }
      sheets.set(name, sheet);
      if (sheet.getCell('A1').value !== templateVersion || sheet.getRow(1).actualCellCount !== 1) {
        report('TEMPLATE_VERSION', location, '', '第一行仅 A1 填写规定模板版本');
      }
      if (sheet.rowCount > P.rows + 1 || sheet.columnCount > headers.length) {
        report('TABLE_LIMIT', location, '', '核对行数与列数'); return;
      }
      headers.forEach((header, index) => {
        if (sheet.getCell(2, index + 1).value !== header) report('HEADER_MISMATCH', { sheet: name, row: 2 }, header, '恢复固定表头及列顺序');
      });
      const rows: AuthoringRow[] = [];
      sheet.eachRow((row, number) => {
        if (number <= 2) return;
        counts[name]++;
        const cellLocation = { sheet: name, row: number };
        const fields = new Map<string, string>();
        for (const [index, header] of headers.entries()) {
          const cell = row.getCell(index + 1);
          if (cell.isMerged) report('MERGED_CELL', cellLocation, header, '数据行不使用合并单元格');
          if (cell.value !== null && typeof cell.value !== 'string') report('NON_TEXT_CELL', cellLocation, header, '字段使用文本，不接受公式或对象');
          const value = typeof cell.value === 'string' ? cell.value : '';
          chars += value.length;
          if (value.length > P.cellChars) report('CELL_TEXT_LIMIT', cellLocation, header, '缩短单元格');
          fields.set(header, value);
        }
        let idField = headers[0] ?? '';
        let requirementTaskId: string | null = null;
        if (name === '执行任务') {
          const rowType = templateVersion === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION ? '任务' : fields.get('记录类型');
          if (!rowType || !Object.hasOwn(TASK_ROW_FIELDS, rowType)) {
            report('INVALID_RECORD_TYPE', cellLocation, '记录类型', '记录类型填写任务、话术引用或确认项'); return;
          }
          if (rowType === '任务') taskEntries++;
          idField = rowType === '任务' ? '任务编号' : rowType === '话术引用' ? '关联编号' : '确认项编号';
          if (rowType === '确认项') requirementTaskId = fields.get('任务编号') ?? '';
          if (templateVersion !== PREVIOUS_MAINTENANCE_TEMPLATE_VERSION) {
            const permitted = TASK_ROW_FIELDS[rowType] ?? [];
            for (const [field, value] of fields) if (value && !permitted.includes(field)) {
              report('ROW_FIELD_NOT_ALLOWED', cellLocation, field, '该记录类型不能填写此字段');
            }
          }
        }
        const id = fields.get(idField) ?? '';
        const state = fields.get('维护状态') ?? '';
        if (!isReviewState(state)) { report('INVALID_STATE', cellLocation, '维护状态', '填写规定的维护状态'); return; }
        const duplicate = requirementTaskId === null ? byId.has(id) : requirementIdsByTask.get(requirementTaskId)?.has(id);
        if (!isEntryCode(id) || duplicate) {
          report('ENTRY_ID', cellLocation, idField, requirementTaskId === null
            ? '记录的主编号必须合法且唯一' : '确认项编号必须合法且在同一任务内唯一'); return;
        }
        const record: AuthoringRow = { ...cellLocation, id, state, fields };
        rows.push(record);
        if (requirementTaskId === null) byId.set(id, record);
        else {
          const ids = requirementIdsByTask.get(requirementTaskId) ?? new Set<string>();
          ids.add(id); requirementIdsByTask.set(requirementTaskId, ids);
        }
        if (state === '草稿' || state === '待核对') report('REVIEW_PENDING', record, '维护状态', '完成业务核对', false);
        const confirmer = text(record, '业务确认人').trim();
        if (state !== '草稿' && state !== '待核对' && (!confirmer || confirmer === '待确认')) report('OWNER_REQUIRED', record, '业务确认人', '填写实际业务确认人', false);
        if (text(record, '待确认事项').trim()) report('OPEN_QUESTION', record, '待确认事项', '解决待确认事项后再准备发布', false);
      });
      tables.set(name, rows);
      images += sheet.getImages().length;
      for (const image of sheet.getImages()) {
        const id = Number(image.imageId);
        referencedMedia.add(id);
        const asset = book.getImage(id);
        const data = asset?.buffer ? Buffer.from(asset.buffer) : undefined;
        if (!isSopGif(asset?.extension, data)) continue;
        const nativeRow = image.range.tl?.nativeRow, nativeColumn = image.range.tl?.nativeCol;
        const row = Number.isSafeInteger(nativeRow) && nativeRow >= 0 && nativeRow <= P.rows + 1 ? nativeRow + 1 : 0;
        const field = Number.isSafeInteger(nativeColumn) && nativeColumn >= 0 ? headers[nativeColumn] ?? '' : '';
        report('MEDIA_FORMAT_UNSUPPORTED', { sheet: name, row }, field, SOP_GIF_UNSUPPORTED_FIX);
      }
      if (name !== '资源与图片' && sheet.getImages().length) report('MISPLACED_IMAGE', location, '', '图片只放在资源与图片表');
      if (sheet.getBackgroundImageId() !== undefined) report('UNANCHORED_IMAGE', location, '', '背景图片没有明确资源归属');
    };
    readSheet('场景目录'); readSheet('执行任务'); readSheet('判断分支');
    readSheet('客户话术'); readSheet('知识与案例'); readSheet('资源与图片');
    if (book.worksheets.length !== 6 || book.worksheets.some(sheet => !Object.hasOwn(SOP_MAINTENANCE_HEADERS, sheet.name))) {
      report('UNKNOWN_SHEET', null, '', '工作簿只能包含规定的六张工作表');
    }
    if (images > P.mediaCount) report('MEDIA_LIMIT', null, '', '图片数量超过维护表预算');
    if (chars > P.normalizedTextChars) report('TEXT_LIMIT', null, '', '维护表文字超过预算');
    for (const [index, media] of book.model.media.entries()) {
      if (referencedMedia.has(index)) continue;
      const gif = isSopGif(media.extension, media.buffer ? Buffer.from(media.buffer) : undefined);
      report(gif ? 'MEDIA_FORMAT_UNSUPPORTED' : 'UNANCHORED_IMAGE', null, '', gif
        ? `未关联图片资源：${SOP_GIF_UNSUPPORTED_FIX}`
        : '未关联图片资源，请关联资源行或从工作簿移除后重试');
    }
    if (archive.mediaCount > book.model.media.length) report('UNANCHORED_IMAGE', null, '', '工作簿含无法识别的图片资源，请检查后重新导出');
    if (invalid) return invalidResult();
    const rows = (name: SheetName): readonly AuthoringRow[] => tables.get(name) ?? [];
    const isTask = (record: AuthoringRow): boolean => record.sheet === '执行任务'
      && (templateVersion === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION || text(record, '记录类型') === '任务');
    const reference = (source: AuthoringRow, id: string, targetSheet: SheetName, field: string): AuthoringRow | undefined => {
      const target = byId.get(id);
      if (!target || target.sheet !== targetSheet || (targetSheet === '执行任务' && !isTask(target))) {
        report('MISSING_REFERENCE', source, field, '引用编号不存在或属于错误类型'); return;
      }
      if (active(source) && !active(target)) report('STOPPED_REFERENCE', source, field, '有效内容仍引用停用内容', false);
      return target;
    };
    const resourceRefs = (source: AuthoringRow, customer = false): readonly string[] => {
      const ids = refs(source, '关联资源编号', report);
      for (const id of ids) {
        const resource = reference(source, id, '资源与图片', '关联资源编号');
        if (customer && resource && text(resource, '可见对象') !== '对客可用') report('INTERNAL_RESOURCE', source, '关联资源编号', '客户话术不能引用内部参考资源');
        if (!customer && resource && text(source, '可见对象') === '坐席可读' && text(resource, '可见对象') === '主管可读') {
          report('VISIBILITY_MISMATCH', source, '关联资源编号', '坐席内容不能依赖主管专属资源');
        }
      }
      return ids;
    };
    const scenes: Scene[] = rows('场景目录').map(record => {
      requireText(record, ['场景名称', '起始任务编号'], report); checkScope(record, report);
      const start = text(record, '生效时间'), end = text(record, '失效时间');
      for (const field of ['生效时间', '失效时间']) if (text(record, field) && !validTime(text(record, field))) report('INVALID_TIME', record, field, '填写真实日期及带时区的 ISO 时间');
      if (start && end && Date.parse(start) >= Date.parse(end)) report('INVALID_WINDOW', record, '失效时间', '失效时间必须晚于生效时间');
      return { record, startId: text(record, '起始任务编号'), entryTerms: terms(record, '入口词', report) };
    });
    const tasks = new Map<string, Task>();
    for (const record of rows('执行任务').filter(isTask)) {
      requireText(record, ['场景编号', '任务名称', '操作要求'], report);
      if (!text(record, '阶段').trim()) report('STAGE_PENDING', record, '阶段', '明确填写任务阶段', false);
      reference(record, text(record, '场景编号'), '场景目录', '场景编号');
      const knowledgeIds = refs(record, '关联知识编号', report);
      const access = visibility(record, report);
      for (const id of knowledgeIds) {
        const knowledge = reference(record, id, '知识与案例', '关联知识编号');
        if (knowledge && access === '坐席可读' && text(knowledge, '可见对象') === '主管可读') report('VISIBILITY_MISMATCH', record, '关联知识编号', '坐席任务不能依赖主管专属知识');
      }
      let requirements: MaintenanceTaskBase['requirements'];
      const configuration = text(record, '确认项配置');
      if (templateVersion === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION) {
        requirements = { kind: 'unconfirmed', legacyText: text(record, '必须确认的信息') };
        report('LEGACY_REQUIREMENTS_PENDING', record, '必须确认的信息', '旧文本需人工确认并填写确认项编号和顺序', false);
      } else if (!configuration.trim()) {
        requirements = { kind: 'unconfirmed', legacyText: null };
        report('REQUIREMENTS_PENDING', record, '确认项配置', '明确填写有确认项或无确认项', false);
      } else if (configuration === '无确认项') requirements = { kind: 'none' };
      else if (configuration === '有确认项') requirements = { kind: 'specified' };
      else {
        requirements = { kind: 'unconfirmed', legacyText: null };
        report('INVALID_REQUIREMENTS_CONFIG', record, '确认项配置', '确认项配置填写有确认项或无确认项');
      }
      const base: TaskBase = { record, sceneId: text(record, '场景编号'), knowledgeIds, resourceIds: resourceRefs(record), visibility: access, requirements };
      const kind = text(record, '任务类型'), nextId = text(record, '下一任务编号');
      if (kind === '操作') {
        if (!nextId) report('NEXT_REQUIRED', record, '下一任务编号', '操作任务必须指定下一任务');
        tasks.set(record.id, { ...base, kind: 'action', nextId });
      } else if (kind === '判断' || kind === '终点') {
        if (nextId) report('INVALID_NEXT', record, '下一任务编号', '判断和终点任务不能填写默认下一任务');
        tasks.set(record.id, { ...base, kind: kind === '判断' ? 'decision' : 'terminal' });
      } else report('TASK_KIND', record, '任务类型', '任务类型仅允许操作、判断或终点');
    }
    const branches: Branch[] = [];
    for (const record of rows('判断分支')) {
      requireText(record, ['任务编号', '选项', '判断依据', '目标任务编号'], report);
      reference(record, text(record, '任务编号'), '执行任务', '任务编号');
      const unknown = text(record, '是否无法判断');
      if (unknown !== '是' && unknown !== '否') report('UNKNOWN_FLAG', record, '是否无法判断', '填写是或否');
      branches.push({ record, taskId: text(record, '任务编号'), targetId: text(record, '目标任务编号'), unknown: unknown === '是',
        matchTerms: terms(record, '匹配词', report), ordinal: branchOrdinal(record, report) });
    }
    const scripts: MaintenanceScript[] = [];
    const scriptLinks: MaintenanceScriptLink[] = [];
    for (const record of rows('客户话术')) {
      requireText(record, ['话术标题', '对客正文'], report);
      scripts.push({ id: record.id, title: text(record, '话术标题'), answerText: text(record, '对客正文'),
        resourceIds: resourceRefs(record, true), review: review(record) });
      if (templateVersion === PREVIOUS_MAINTENANCE_TEMPLATE_VERSION) {
        requireText(record, ['任务编号', '适用条件'], report);
        reference(record, text(record, '任务编号'), '执行任务', '任务编号');
        const relationship = text(record, '话术关系');
        if (relationship !== '独立' && relationship !== '替代' && relationship !== '配套') {
          report('SCRIPT_RELATION', record, '话术关系', '明确话术为独立、替代或配套');
        } else scriptLinks.push({ origin: 'legacy', id: null, taskId: text(record, '任务编号'), scriptId: record.id,
          condition: text(record, '适用条件'), relationship, review: review(record) });
        report('LEGACY_SCRIPT_LINK_PENDING', record, '任务编号', '旧话术关联需人工补齐稳定关联编号', false);
      }
    }
    const linksByTask = new Map<string, Set<string>>();
    for (const record of rows('执行任务').filter(row => text(row, '记录类型') === '话术引用')) {
      requireText(record, ['任务编号', '话术编号'], report);
      reference(record, text(record, '任务编号'), '执行任务', '任务编号');
      reference(record, text(record, '话术编号'), '客户话术', '话术编号');
      boundedText(record, '适用条件', report);
      const relationship = text(record, '话术关系');
      if (relationship !== '独立' && relationship !== '替代' && relationship !== '配套') {
        report('SCRIPT_RELATION', record, '话术关系', '明确话术为独立、替代或配套');
      } else scriptLinks.push({ origin: 'explicit', id: record.id, taskId: text(record, '任务编号'), scriptId: text(record, '话术编号'),
        condition: text(record, '适用条件'), relationship, review: review(record) });
      if (active(record)) {
        const taskId = text(record, '任务编号'), scriptId = text(record, '话术编号');
        const linked = linksByTask.get(taskId) ?? new Set<string>();
        if (linked.has(scriptId)) report('DUPLICATE_SCRIPT_LINK', record, '话术编号', '同一任务不能重复引用同一有效话术');
        linked.add(scriptId); linksByTask.set(taskId, linked);
        if (linked.size > 32) report('SCRIPT_LINK_LIMIT', record, '话术编号', '同一任务最多引用 32 个有效话术');
      }
    }
    const requirements: MaintenanceRequirement[] = [];
    const requirementRowsByTask = new Map<string, { record: AuthoringRow; ordinal: number | null }[]>();
    for (const record of rows('执行任务').filter(row => text(row, '记录类型') === '确认项')) {
      requireText(record, ['任务编号'], report);
      reference(record, text(record, '任务编号'), '执行任务', '任务编号');
      boundedText(record, '确认项文字', report);
      const ordinal = requirementOrdinal(record, report);
      requirements.push({ id: record.id, taskId: text(record, '任务编号'), label: text(record, '确认项文字'), ordinal, review: review(record) });
      if (active(record)) {
        const taskId = text(record, '任务编号');
        const items = requirementRowsByTask.get(taskId) ?? [];
        items.push({ record, ordinal }); requirementRowsByTask.set(taskId, items);
      }
    }
    for (const task of tasks.values()) {
      const items = requirementRowsByTask.get(task.record.id) ?? [];
      if (task.requirements.kind === 'none' && items.length) {
        report('UNEXPECTED_REQUIREMENT', task.record, '确认项配置', '无确认项的任务不能有有效确认项');
      }
      if (task.requirements.kind === 'specified' && !items.length) {
        report('REQUIREMENTS_EMPTY', task.record, '确认项配置', '补齐确认项或明确选择无确认项', false);
      }
      if (items.length > 32) report('REQUIREMENT_LIMIT', task.record, '确认项配置', '同一任务最多包含 32 个有效确认项');
      const ordinals = new Set<number>();
      for (const { record, ordinal } of items) {
        if (ordinal === null) continue;
        if (ordinals.has(ordinal)) report('DUPLICATE_REQUIREMENT_ORDINAL', record, '确认项顺序', '同一任务的确认项顺序不得重复');
        if (ordinal > items.length) report('REQUIREMENT_ORDINAL_GAP', record, '确认项顺序', '同一任务的确认项顺序必须从 1 连续编号');
        ordinals.add(ordinal);
      }
    }
    const knowledge: MaintenanceKnowledge[] = [];
    for (const record of rows('知识与案例')) {
      requireText(record, ['标题', '正文'], report);
      knowledge.push({ id: record.id, title: text(record, '标题'), body: text(record, '正文'),
        visibility: visibility(record, report), resourceIds: resourceRefs(record), review: review(record) });
    }
    const resourceSheet = sheets.get('资源与图片');
    const resourceRows = new Map(rows('资源与图片').map(record => [record.row, record]));
    const imagesByResource = new Map<string, MaintenanceImage[]>();
    let imageBytes = 0;
    for (const image of resourceSheet?.getImages() ?? []) {
      const anchorRow = image.range.tl?.nativeRow;
      const rowNumber = Number.isSafeInteger(anchorRow) && anchorRow >= 0 && anchorRow <= P.rows + 1 ? anchorRow + 1 : 0;
      const resource = resourceRows.get(rowNumber);
      const anchor = resourceSheet ? imageAnchorIssue(resourceSheet, image) : 'row';
      if (anchor === 'column') report('IMAGE_COLUMN', { sheet: '资源与图片', row: rowNumber }, '图片', '图片锚点必须位于图片列');
      if (anchor === 'row') report('IMAGE_SPANS_ROWS', { sheet: '资源与图片', row: rowNumber }, '图片', '图片必须完整位于一个资源行');
      if (!resource || text(resource, '资源类型') !== '图片') report('ORPHAN_IMAGE', { sheet: '资源与图片', row: rowNumber }, '图片', '图片必须关联图片类型的资源行');
      const data = book.getImage(Number(image.imageId));
      if (!data?.buffer || data.buffer.byteLength === 0) report('MISSING_IMAGE_BYTES', { sheet: '资源与图片', row: rowNumber }, '图片', '图片必须包含可读取字节');
      else if (data.buffer.byteLength > P.mediaBytes - imageBytes) {
        report('MEDIA_LIMIT', { sheet: '资源与图片', row: rowNumber }, '图片', '图片总量超过维护表预算');
      } else {
        imageBytes += data.buffer.byteLength;
        const bytes = Buffer.from(data.buffer);
        const mime = imageMime(bytes, data.extension);
        if (!mime) report('INVALID_IMAGE_BYTES', { sheet: '资源与图片', row: rowNumber }, '图片', '图片字节与声明格式不一致或内容损坏');
        else if (resource && text(resource, '资源类型') === '图片' && anchor === null) {
          const items = imagesByResource.get(resource.id) ?? [];
          items.push({ bytes, mime, sha256: createHash('sha256').update(bytes).digest('hex') });
          imagesByResource.set(resource.id, items);
        }
      }
    }
    const resources: MaintenanceResource[] = [];
    for (const record of rows('资源与图片')) {
      requireText(record, ['资源名称'], report); checkScope(record, report);
      const base: MaintenanceResourceBase = { id: record.id, title: text(record, '资源名称'), visibility: visibility(record, report, true),
        scopeText: text(record, '适用范围'), content: text(record, '资源内容'), imageCellText: text(record, '图片'), review: review(record) };
      const kind = text(record, '资源类型');
      if (kind === '图片') {
        const resourceImages = imagesByResource.get(record.id) ?? [];
        if (!resourceImages.length) report('MISSING_IMAGE', record, '图片', '补齐该资源的嵌入图片');
        resources.push({ ...base, kind: 'image', images: resourceImages });
      } else if (kind === '资料') {
        requireText(record, ['资源内容'], report);
        resources.push({ ...base, kind: 'document' });
      } else report('RESOURCE_KIND', record, '资源类型', '资源类型仅允许图片或资料');
    }
    const edges = new Map<string, string[]>();
    const addEdge = (task: Task, targetId: string, record: AuthoringRow, field: string): void => {
      reference(record, targetId, '执行任务', field);
      const target = tasks.get(targetId);
      if (!target) return;
      if (target.sceneId !== task.sceneId) report('CROSS_SCENE_EDGE', record, field, '流程跳转只能引用同一场景任务');
      if (task.visibility === '坐席可读' && target.visibility === '主管可读') report('VISIBILITY_MISMATCH', record, field, '坐席路径不能直接进入主管专属任务');
      if (active(task.record) && active(record) && active(target.record)) {
        const targets = edges.get(task.record.id) ?? []; targets.push(targetId); edges.set(task.record.id, targets);
      }
    };
    for (const task of tasks.values()) {
      const choices = branches.filter(branch => branch.taskId === task.record.id && active(branch.record));
      if (task.kind === 'action') addEdge(task, task.nextId, task.record, '下一任务编号');
      if (task.kind !== 'decision' && choices.length) report('UNEXPECTED_BRANCH', task.record, '任务类型', '只有判断任务可以关联分支');
      if (task.kind === 'decision' && active(task.record)) {
        const labels = new Set<string>();
        for (const branch of choices) {
          const label = text(branch.record, '选项').replace(/\s+/gu, ' ').trim();
          if (labels.has(label)) report('DUPLICATE_CHOICE', branch.record, '选项', '同一判断任务的选项展示名称必须不同');
          labels.add(label);
        }
        if (choices.length < 2) report('BRANCH_REQUIRED', task.record, '任务类型', '判断任务至少包含两个有效选项');
        if (choices.length > 4) report('BRANCH_LIMIT', task.record, '任务类型', '判断任务最多包含四个有效选项');
        if (choices.filter(branch => branch.unknown).length !== 1) report('UNKNOWN_BRANCH_REQUIRED', task.record, '任务类型', '判断任务必须有且仅有一个无法判断选项');
        const ordinals = new Set<ChoiceOrdinal>();
        for (const branch of choices) {
          if (branch.ordinal === null) continue;
          if (ordinals.has(branch.ordinal)) report('DUPLICATE_BRANCH_ORDINAL', branch.record, '分支顺序', '同一判断任务的分支顺序不得重复');
          if (branch.ordinal > choices.length) report('BRANCH_ORDINAL_GAP', branch.record, '分支顺序', '同一判断任务的顺序必须从 1 连续编号');
          ordinals.add(branch.ordinal);
        }
      }
    }
    for (const branch of branches) {
      const task = tasks.get(branch.taskId);
      if (task) addEdge(task, branch.targetId, branch.record, '目标任务编号');
    }
    const visited = new Set<string>();
    for (const scene of scenes) {
      reference(scene.record, scene.startId, '执行任务', '起始任务编号');
      const start = tasks.get(scene.startId);
      if (start && start.sceneId !== scene.record.id) report('WRONG_START', scene.record, '起始任务编号', '起始任务必须属于当前场景');
      if (!active(scene.record)) continue;
      const stack = [scene.startId];
      while (stack.length) {
        const id = stack.pop();
        if (id === undefined || visited.has(id)) continue;
        visited.add(id); stack.push(...(edges.get(id) ?? []));
      }
    }
    const degree = new Map<string, number>();
    for (const task of tasks.values()) if (active(task.record)) {
      degree.set(task.record.id, 0);
      if (!visited.has(task.record.id)) report('UNREACHABLE_TASK', task.record, '任务编号', '有效任务必须能从所属场景入口到达');
    }
    for (const targets of edges.values()) for (const target of targets) degree.set(target, (degree.get(target) ?? 0) + 1);
    const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id);
    let cursor = 0;
    while (cursor < queue.length) {
      const id = queue[cursor++];
      if (id === undefined) continue;
      degree.delete(id);
      for (const target of edges.get(id) ?? []) {
        const count = degree.get(target);
        if (count === undefined) continue;
        degree.set(target, count - 1); if (count === 1) queue.push(target);
      }
    }
    if (degree.size) report('CYCLE', null, '', '任务图不得存在循环；等待恢复使用同一任务状态');
    if (!scenes.length || !tasks.size) report('EMPTY_DATA', null, '', '场景和任务不能为空，空表不表示清库');
    if (invalid) return invalidResult();
    const sceneDocuments: MaintenanceScene[] = scenes.map(({ record, startId, entryTerms }) => ({ id: record.id, title: text(record, '场景名称'),
      scopeText: text(record, '适用范围'), startTaskId: startId, entryTerms, effectiveFrom: text(record, '生效时间'),
      effectiveTo: text(record, '失效时间'), review: review(record) }));
    const taskDocuments: MaintenanceTask[] = [...tasks.values()].map(task => {
      const { record } = task;
      const base: MaintenanceTaskBase = { id: record.id, sceneId: task.sceneId, stage: text(record, '阶段'),
        title: text(record, '任务名称'), instruction: text(record, '操作要求'), requirements: task.requirements,
        knowledgeIds: task.knowledgeIds, resourceIds: task.resourceIds, visibility: task.visibility, review: review(record) };
      if (task.kind === 'action') return { ...base, kind: 'action', nextTaskId: task.nextId };
      return { ...base, kind: task.kind };
    });
    const branchDocuments: MaintenanceBranch[] = branches.map(({ record, taskId, targetId, unknown, matchTerms, ordinal }) => ({ id: record.id,
      taskId, label: text(record, '选项'), criterion: text(record, '判断依据'), targetTaskId: targetId,
      unableToDetermine: unknown, matchTerms, ordinal, review: review(record) }));
    const status = issues.length ? 'needs-review' : 'reviewed';
    return { kind: 'parsed', report: result(status), document: { templateVersion, publishable: false,
      scenes: sceneDocuments, tasks: taskDocuments, branches: branchDocuments, scripts, scriptLinks, requirements, knowledge, resources } };
  } catch (error) {
    const code = error instanceof IntakeFailure ? error.code : 'INVALID_WORKBOOK';
    report(code, null, '', '文件无法安全读取，重新导出维护表');
    return invalidResult();
  }
}

/** Reports fixed messages and coordinates only; worksheet contents never escape. */
export async function checkSopMaintenance(bytes: Buffer): Promise<MaintenanceCheck> {
  return (await parseSopMaintenance(bytes)).report;
}
