import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { createSopMaintenanceTemplate, parseSopMaintenance, SOP_MAINTENANCE_HEADERS, type MaintenanceCheck } from './maintenance.js';
import { inspectSyntheticSopSource, type InspectedSource, type SourceImage, type SourceObject } from './sop-source-inventory.js';
import { INTAKE_POLICY as P } from './policy.js';

export const SOURCE_DECISIONS_VERSION = 'sop-synthetic-decisions-v1';
type Disposition = 'mapped' | 'excluded' | 'pending';
type Segment = { start: number; end: number; disposition: Disposition; reason: string; targets: string[] };
type ObjectDecision = { source: SourceObject; segments: Segment[] };
type SheetName = keyof typeof SOP_MAINTENANCE_HEADERS;
export type DraftReport = Readonly<{
  sourceSha256: string; workbookSha256: string; publishable: false; mappingComplete: boolean;
  counts: Readonly<{ objects: number; segments: number; mapped: number; excluded: number; pending: number; unsupported: number; imagesNeedingReview: number }>;
  ledger: readonly Readonly<{ sourceId: string; kind: SourceObject['kind']; sheet: string; location: string;
    position: SourceImage['position']; mediaSha256: string | null; reviewWarnings: readonly string[];
    segments: readonly Readonly<{ start: number; end: number; disposition: Disposition; reason: string; targets: readonly string[] }>[] }>[];
  targets: readonly Readonly<{ key: string; sheet: SheetName; recordType: string; businessId: string; parentTaskId: string;
    origin: 'source' | 'new'; reason: string }>[];
  maintenance: MaintenanceCheck;
}>;
export type BuiltDraft = Readonly<{ workbook: Buffer; report: DraftReport }>;
type SourceCheckIssue = 'WORKBOOK_CHANGED' | 'PENDING_SOURCES' | 'UNSUPPORTED_SOURCE_OBJECTS'
  | 'IMAGE_REVIEW_REQUIRED' | 'MAINTENANCE_NOT_REVIEWED';
type SourceDraftCheckDetails = Readonly<{
  mode: 'synthetic-source';
  publishable: false; sourceSha256: string; decisionsSha256: string; workbookSha256: string;
  workbookMatchesMapping: boolean; counts: DraftReport['counts']; reasons: readonly SourceCheckIssue[];
  maintenance: MaintenanceCheck;
}>;
export type SourceDraftCheck = SourceDraftCheckDetails & (
  | Readonly<{ status: 'invalid' | 'needs-review'; sourceCheck: 'needs-review' }>
  | Readonly<{ status: 'reviewed'; sourceCheck: 'complete' }>
);

const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** ZIP metadata can change without changing an XLSX part; all part bytes still have to match. */
async function workbookPartsDigest(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes), hash = createHash('sha256');
  for (const name of Object.keys(zip.files).filter(name => !zip.files[name]?.dir).sort()) {
    const part = zip.file(name);
    if (!part) throw new Error('MISSING_WORKBOOK_PART');
    const content = await part.async('nodebuffer');
    hash.update(JSON.stringify([name, content.length])).update('\0').update(content);
  }
  return hash.digest('hex');
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`INVALID_${label}`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`INVALID_${label}`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`INVALID_${label}`);
  return value;
}
function keys(value: Record<string, unknown>, permitted: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !permitted.includes(key))) throw new Error(`INVALID_${label}`);
}
function disposition(value: unknown): Disposition {
  if (value !== 'mapped' && value !== 'excluded' && value !== 'pending') throw new Error('INVALID_DISPOSITION');
  return value;
}
function reason(value: unknown, state: Disposition): string {
  const text = value === undefined ? '' : string(value, 'REASON');
  if (text.length > 1024 || (state === 'excluded' && !text.trim())) throw new Error('INVALID_REASON');
  return text;
}
function sourceLocation(source: SourceObject): string {
  return source.kind === 'text' ? source.cell : source.location;
}

/** A skeleton makes every source object pending until a person decides otherwise. */
export function createSourceDecisionTemplate(source: InspectedSource): unknown {
  return {
    version: SOURCE_DECISIONS_VERSION, sourceSha256: source.inventory.sourceSha256,
    decisions: source.inventory.objects.map(item => item.kind === 'text'
      ? { sourceId: item.id, segments: [{ start: 0, end: item.codePoints, disposition: 'pending', reason: '' }] }
      : { sourceId: item.id, disposition: 'pending', reason: '' }),
    rows: [],
  };
}

function decisionsFor(source: InspectedSource, input: unknown): { decisions: Map<string, ObjectDecision>; rows: unknown[] } {
  const root = object(input, 'DECISIONS');
  keys(root, ['version', 'sourceSha256', 'decisions', 'rows'], 'DECISIONS');
  if (root.version !== SOURCE_DECISIONS_VERSION || root.sourceSha256 !== source.inventory.sourceSha256) throw new Error('SOURCE_IDENTITY_MISMATCH');
  const rawDecisions = array(root.decisions, 'DECISIONS'), rows = array(root.rows, 'ROWS');
  if (rawDecisions.length > source.inventory.objects.length || rows.length > P.rows) throw new Error('DECISION_LIMIT');
  const rawById = new Map<string, Record<string, unknown>>();
  for (const value of rawDecisions) {
    const raw = object(value, 'DECISION'), id = string(raw.sourceId, 'SOURCE_ID');
    if (rawById.has(id)) throw new Error('DUPLICATE_DECISION');
    rawById.set(id, raw);
  }
  const decisions = new Map<string, ObjectDecision>();
  for (const item of source.inventory.objects) {
    const raw = rawById.get(item.id);
    let segments: Segment[];
    if (item.kind === 'text') {
      if (raw) keys(raw, ['sourceId', 'segments'], 'DECISION');
      const parts = raw ? array(raw.segments, 'SEGMENTS') : [{ start: 0, end: item.codePoints, disposition: 'pending' }];
      if (!parts.length || parts.length > item.codePoints) throw new Error('INVALID_SEGMENTS');
      let cursor = 0;
      segments = parts.map(value => {
        const part = object(value, 'SEGMENT');
        keys(part, ['start', 'end', 'disposition', 'reason'], 'SEGMENT');
        const start = part.start, end = part.end, state = disposition(part.disposition);
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || start !== cursor || end <= start || end > item.codePoints) throw new Error('INVALID_SEGMENTS');
        cursor = end;
        return { start, end, disposition: state, reason: reason(part.reason, state), targets: [] };
      });
      if (cursor !== item.codePoints) throw new Error('INVALID_SEGMENTS');
    } else {
      if (raw) keys(raw, ['sourceId', 'disposition', 'reason'], 'DECISION');
      const state = raw ? disposition(raw.disposition) : 'pending';
      if (item.kind === 'unsupported' && state === 'mapped') throw new Error('UNSUPPORTED_SOURCE_MAPPING');
      segments = [{ start: 0, end: 1, disposition: state, reason: reason(raw?.reason, state), targets: [] }];
    }
    decisions.set(item.id, { source: item, segments });
    rawById.delete(item.id);
  }
  if (rawById.size) throw new Error('UNKNOWN_SOURCE_ID');
  return { decisions, rows };
}

function addTarget(segment: Segment, target: string): void {
  if (segment.disposition !== 'mapped') throw new Error('UNCONFIRMED_SOURCE_REFERENCE');
  segment.targets.push(target);
}
function fieldValue(value: unknown, decisions: Map<string, ObjectDecision>, target: string): string {
  if (typeof value === 'string') return string(value, 'FIELD');
  const spec = object(value, 'FIELD');
  keys(spec, ['from', 'separator'], 'FIELD');
  const references = array(spec.from, 'FIELD_REFERENCES');
  if (!references.length || references.length > 1000) throw new Error('INVALID_FIELD_REFERENCES');
  if (references.length > 1 && spec.separator === undefined) throw new Error('SEPARATOR_REQUIRED');
  const separator = spec.separator === undefined ? '' : string(spec.separator, 'SEPARATOR');
  if (separator.length > 32) throw new Error('INVALID_SEPARATOR');
  return references.map(value => {
    const ref = object(value, 'TEXT_REFERENCE');
    keys(ref, ['sourceId', 'start', 'end'], 'TEXT_REFERENCE');
    const id = string(ref.sourceId, 'SOURCE_ID'), entry = decisions.get(id);
    if (!entry || entry.source.kind !== 'text') throw new Error('INVALID_TEXT_REFERENCE');
    const segment = entry.segments.find(item => item.start === ref.start && item.end === ref.end);
    if (!segment) throw new Error('INVALID_TEXT_REFERENCE');
    addTarget(segment, target);
    return Array.from(entry.source.text).slice(segment.start, segment.end).join('');
  }).join(separator);
}

/** No edge, picture owner, identity or status is inferred from source order. */
export async function buildSyntheticSopDraft(sourceBytes: Buffer, input: unknown): Promise<BuiltDraft> {
  const source = await inspectSyntheticSopSource(sourceBytes);
  const { decisions, rows } = decisionsFor(source, input);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await createSopMaintenanceTemplate()).buffer);
  book.created = new Date('2000-01-01T00:00:00.000Z');
  book.modified = new Date('2000-01-01T00:00:00.000Z');
  const rowKeys = new Set<string>(), mediaIds = new Map<string, number>();
  const targets: DraftReport['targets'][number][] = [];
  let reviewCell: ExcelJS.Cell | undefined;
  for (const value of rows) {
    const row = object(value, 'ROW');
    keys(row, ['key', 'sheet', 'fields', 'imageSourceId', 'origin'], 'ROW');
    const key = string(row.key, 'ROW_KEY'), name = string(row.sheet, 'SHEET');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(key) || rowKeys.has(key)
      || !Object.hasOwn(SOP_MAINTENANCE_HEADERS, name)) throw new Error('INVALID_ROW');
    rowKeys.add(key);
    const sheetName = name as SheetName, headers: readonly string[] = SOP_MAINTENANCE_HEADERS[sheetName];
    const fields = object(row.fields, 'FIELDS');
    if (Object.keys(fields).some(field => !headers.includes(field))) throw new Error('UNKNOWN_TARGET_FIELD');
    const origin = object(row.origin, 'ORIGIN');
    keys(origin, ['kind', 'reason'], 'ORIGIN');
    if (origin.kind !== 'source' && origin.kind !== 'new') throw new Error('INVALID_ORIGIN');
    const originReason = origin.reason === undefined ? '' : string(origin.reason, 'ORIGIN_REASON');
    if (originReason.length > 1024 || (origin.kind === 'new' && !originReason.trim())) throw new Error('INVALID_ORIGIN');
    const usesSource = row.imageSourceId !== undefined || Object.values(fields).some(field => typeof field !== 'string');
    if (origin.kind === 'source' && !usesSource) throw new Error('SOURCE_ORIGIN_WITHOUT_SOURCE');
    const sheet = book.getWorksheet(sheetName);
    if (!sheet) throw new Error('MISSING_TEMPLATE_SHEET');
    const values = headers.map(field => fields[field] === undefined ? '' : fieldValue(fields[field], decisions, `${key}.${field}`));
    const added = sheet.addRow(values);
    reviewCell ??= added.getCell(headers.indexOf('待确认事项') + 1);
    const field = (name: string): string => values[headers.indexOf(name)] ?? '';
    const recordType = sheetName === '执行任务' ? field('记录类型') : sheetName;
    const idHeader = sheetName === '执行任务' ? recordType === '话术引用' ? '关联编号' : recordType === '确认项' ? '确认项编号' : '任务编号' : headers[0] ?? '';
    targets.push({ key, sheet: sheetName, recordType, businessId: field(idHeader),
      parentTaskId: recordType === '确认项' ? field('任务编号') : '', origin: origin.kind, reason: originReason });
    if (row.imageSourceId !== undefined) {
      if (sheetName !== '资源与图片') throw new Error('INVALID_IMAGE_TARGET');
      const id = string(row.imageSourceId, 'SOURCE_ID'), entry = decisions.get(id);
      if (!entry || (entry.source.kind !== 'image' && entry.source.kind !== 'background')) throw new Error('INVALID_IMAGE_REFERENCE');
      const segment = entry.segments[0];
      if (!segment) throw new Error('INVALID_IMAGE_REFERENCE');
      addTarget(segment, `${key}.图片`);
      const bytes = source.images.get(id);
      if (!bytes) throw new Error('MISSING_IMAGE_BYTES');
      const imageKey = `${entry.source.extension}:${entry.source.sha256}`;
      let mediaId = mediaIds.get(imageKey);
      if (mediaId === undefined) {
        mediaId = book.addImage({ buffer: new Uint8Array(bytes).buffer, extension: entry.source.extension });
        mediaIds.set(imageKey, mediaId);
      }
      // A resource row holds one visible placement; several pictures use several
      // resource rows, which can all be referenced by the same task or knowledge.
      const scale = Math.min(128 / entry.source.width, 96 / entry.source.height, 1);
      added.height = 80;
      sheet.getColumn(headers.indexOf('图片') + 1).width = 24;
      sheet.addImage(mediaId, { tl: { col: headers.indexOf('图片'), row: added.number - 1 },
        ext: { width: Math.max(1, entry.source.width * scale), height: Math.max(1, entry.source.height * scale) } });
    }
  }
  for (const entry of decisions.values()) for (const segment of entry.segments) {
    if (segment.disposition === 'mapped' && !segment.targets.length) throw new Error('MAPPED_WITHOUT_TARGET');
  }
  const entries = [...decisions.values()], segments = entries.flatMap(entry => entry.segments);
  const counts = { objects: entries.length, segments: segments.length,
    mapped: segments.filter(item => item.disposition === 'mapped').length,
    excluded: segments.filter(item => item.disposition === 'excluded').length,
    pending: segments.filter(item => item.disposition === 'pending').length,
    unsupported: entries.filter(entry => entry.source.kind === 'unsupported'
      || ((entry.source.kind === 'image' || entry.source.kind === 'background') && entry.source.extension === 'gif')).length,
    imagesNeedingReview: entries.filter(entry => (entry.source.kind === 'image' || entry.source.kind === 'background')
      && entry.source.reviewWarnings.length > 0).length };
  if (reviewCell && (counts.pending || counts.unsupported || counts.imagesNeedingReview)) {
    const existing = typeof reviewCell.value === 'string' ? reviewCell.value : '';
    const imageNotice = counts.imagesNeedingReview ? `，图片 ${counts.imagesNeedingReview} 处未完整解码或原显示可能变化` : '';
    const notice = `来源 ${source.inventory.sourceSha256}：待确认 ${counts.pending} 条，不支持 ${counts.unsupported} 项${imageNotice}；须核对来源及对账报告`;
    reviewCell.value = [existing, notice].filter(Boolean).join('\n');
  }
  const workbook = Buffer.from(await book.xlsx.writeBuffer());
  const parsed = await parseSopMaintenance(workbook);
  const ledger = entries.map(entry => ({ sourceId: entry.source.id, kind: entry.source.kind,
    sheet: entry.source.sheet, location: sourceLocation(entry.source),
    position: entry.source.kind === 'image' || entry.source.kind === 'background' ? entry.source.position : null,
    mediaSha256: entry.source.kind === 'image' || entry.source.kind === 'background' ? entry.source.sha256 : null,
    reviewWarnings: entry.source.kind === 'image' || entry.source.kind === 'background' ? entry.source.reviewWarnings : [],
    segments: entry.segments }));
  return { workbook, report: { sourceSha256: source.inventory.sourceSha256,
    workbookSha256: digest(workbook), publishable: false,
    mappingComplete: counts.pending === 0 && counts.unsupported === 0 && counts.imagesNeedingReview === 0
      && parsed.kind === 'parsed' && parsed.report.status === 'reviewed',
    counts, ledger, targets, maintenance: parsed.report } };
}

/** Recompute the synthetic source decisions and bind them to the current workbook. */
export async function checkSyntheticSopSourceDraft(input: Readonly<{
  source: Buffer; decisions: unknown; workbook: Buffer;
}>): Promise<SourceDraftCheck> {
  const serialized = JSON.stringify(input.decisions);
  if (!serialized || Buffer.byteLength(serialized) > P.fileBytes) throw new Error('INVALID_DECISIONS');
  const expected = await buildSyntheticSopDraft(input.source, input.decisions);
  const current = await parseSopMaintenance(input.workbook);
  const workbookMatchesMapping = current.kind === 'parsed'
    && await workbookPartsDigest(expected.workbook) === await workbookPartsDigest(input.workbook);
  const counts = expected.report.counts, reasons: SourceCheckIssue[] = [];
  if (!workbookMatchesMapping) reasons.push('WORKBOOK_CHANGED');
  if (counts.pending) reasons.push('PENDING_SOURCES');
  if (counts.unsupported) reasons.push('UNSUPPORTED_SOURCE_OBJECTS');
  if (counts.imagesNeedingReview) reasons.push('IMAGE_REVIEW_REQUIRED');
  if (current.report.status !== 'reviewed') reasons.push('MAINTENANCE_NOT_REVIEWED');
  const complete = reasons.length === 0 && expected.report.mappingComplete;
  const details = { mode: 'synthetic-source', publishable: false,
    sourceSha256: expected.report.sourceSha256, decisionsSha256: digest(serialized), workbookSha256: digest(input.workbook),
    workbookMatchesMapping, counts, reasons, maintenance: current.report } satisfies SourceDraftCheckDetails;
  if (current.kind === 'invalid') return { ...details, status: 'invalid', sourceCheck: 'needs-review' };
  if (!complete) return { ...details, status: 'needs-review', sourceCheck: 'needs-review' };
  return { ...details, status: 'reviewed', sourceCheck: 'complete' };
}
