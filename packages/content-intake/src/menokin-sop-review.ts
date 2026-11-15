import { createHash } from 'node:crypto';
import {
  MENOKIN_FLAT_SOP_WORKBOOK_HEADERS, parseMenokinFlatSopWorkbook,
  type MenokinFlatSopColumn, type MenokinFlatSopRowFact,
} from './menokin-sop-flat-workbook.js';
import { SOP_TASK_HEADERS, SOP_TASK_SHEETS, SOP_TASK_STRUCTURE_SHA256, type SopTaskSheet } from './sop-task-workbook.js';

export const MENOKIN_SOP_REVIEW_VERSION = 'menokin-flat-review-v1';
export type MenokinSopSelection = Readonly<{ rowIds?: readonly string[]; flowIds?: readonly string[] }>;
export type MenokinSopExcerpt = Readonly<{
  rowId: string; column: MenokinFlatSopColumn; start: number; end: number; text: string;
}>;
/** Source excerpts bind UTF-16 character offsets to the original display text.
 * A deliberate rewrite is an explicit reviewed value covered by the record's review basis. */
export type MenokinSopReviewedField = Readonly<{ column: string }> & (
  | Readonly<{ kind: 'source'; excerpts: readonly MenokinSopExcerpt[]; separator: string }>
  | Readonly<{ kind: 'reviewed'; value: string }>
);
export type MenokinSopReviewedEntity = Readonly<{
  sheet: SopTaskSheet; entityId: string; rowIds: readonly string[]; maintenance: '启用'; fields: readonly MenokinSopReviewedField[];
}>;
export type MenokinSopRowDecision = Readonly<{ rowId: string }> & (
  | Readonly<{ kind: 'mapped'; entityIds: readonly string[] }>
  | Readonly<{ kind: 'excluded'; reason: string }>
  | Readonly<{ kind: 'pending'; reason: string }>
);
export type MenokinSopHold = Readonly<{
  id: string; rowIds: readonly string[]; reason: string;
  appliesTo: Readonly<{ kind: 'rows' }> | Readonly<{ kind: 'flows'; flowIds: readonly string[] }>;
}> & (Readonly<{ kind: 'pending' }> | Readonly<{ kind: 'resolved'; resolution: string }>);
/** One responsible person's complete structured review. This is local preparation,
 * not source registration, a release approval, or a per-cell signing protocol. */
export type MenokinSopReviewRecord = Readonly<{
  version: typeof MENOKIN_SOP_REVIEW_VERSION; sourceSha256: string; targetDigest: string;
  reviewer: string; reviewedAt: string; basis: string; entities: readonly MenokinSopReviewedEntity[];
  rows: readonly MenokinSopRowDecision[]; holds: readonly MenokinSopHold[];
  images: readonly Readonly<{ resourceId: string; rowId: string; contentSha256: string }>[];
}>;
export type MenokinSopReviewIssue = Readonly<{ code: string; target: string; rowIds: readonly string[] }>;
export type MenokinSopAuthoringRow = Readonly<{ entityId: string; rowIds: readonly string[]; values: Readonly<Record<string, string>> }>;
export type MenokinSopAuthoringPlan = Readonly<{
  version: typeof MENOKIN_SOP_REVIEW_VERSION; sourceSha256: string; targetDigest: string; reviewDigest: string;
  includedFlowIds: readonly string[]; excludedFlowIds: readonly string[];
  tables: Readonly<Record<SopTaskSheet, readonly MenokinSopAuthoringRow[]>>;
  imageBindings: MenokinSopReviewRecord['images'];
  registrationRequirements: Readonly<{
    flowIds: readonly string[]; entryIds: readonly string[]; imageResourceIds: readonly string[];
    fields: readonly ['flows.anchorEntry/audience', 'entries', 'images.required/alt/ordinal', 'sourceClaim', 'riskLevel'];
  }>;
}>;
export type MenokinSopReviewReport = Readonly<{
  version: typeof MENOKIN_SOP_REVIEW_VERSION; sourceSha256: string; targetDigest: string;
  selection: Readonly<{ rowIds: readonly string[]; flowIds: readonly string[] | null }>;
  sourceRows: readonly MenokinFlatSopRowFact[];
  coverage: readonly Readonly<{ rowId: string; selected: boolean; decision: MenokinSopRowDecision; outputs: readonly string[] }>[];
  tables: MenokinSopAuthoringPlan['tables'];
  media: readonly Readonly<{ rowId: string; facts: MenokinFlatSopRowFact['images']; bindings: MenokinSopReviewRecord['images'] }>[];
  holds: readonly MenokinSopHold[]; issues: readonly MenokinSopReviewIssue[];
  reviewRecord: MenokinSopReviewRecord | null;
}>;
export type MenokinSopReviewPreparation =
  | Readonly<{ kind: 'invalid-input'; issues: readonly MenokinSopReviewIssue[] }>
  | Readonly<{ kind: 'needs-review'; review: MenokinSopReviewReport }>
  | Readonly<{ kind: 'authoring-ready'; review: MenokinSopReviewReport; authoringPlan: MenokinSopAuthoringPlan }>;

type Entity = MenokinSopAuthoringRow & { sheet: SopTaskSheet };
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (): never => { throw new Error('REVIEW_INVALID'); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !(key in value))) invalid();
}
const text = (value: unknown): string => typeof value === 'string' && value.length <= 32_767 ? value : invalid();
const required = (value: unknown): string => { const result = text(value); return result.trim() ? result : invalid(); };
const id = (value: unknown): string => {
  const result = required(value); return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u.test(result) ? result : invalid();
};
function array<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 20_000) return invalid();
  return value.map(read);
}
const strings = (value: unknown): string[] => array(value, required);
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) invalid(); }
function readExcerpt(value: unknown): MenokinSopExcerpt {
  const v = object(value); keys(v, ['rowId', 'column', 'start', 'end', 'text']);
  const column = MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.find(header => header === v.column);
  if (!column || !Number.isSafeInteger(v.start) || !Number.isSafeInteger(v.end)
    || Number(v.start) < 0 || Number(v.end) <= Number(v.start)) return invalid();
  return { rowId: required(v.rowId), column, start: Number(v.start), end: Number(v.end), text: required(v.text) };
}
function readField(value: unknown): MenokinSopReviewedField {
  const v = object(value), column = required(v.column);
  if (v.kind === 'source') {
    keys(v, ['column', 'kind', 'excerpts', 'separator']);
    const excerpts = array(v.excerpts, readExcerpt); if (!excerpts.length) return invalid();
    return { column, kind: 'source', excerpts, separator: text(v.separator) };
  }
  if (v.kind !== 'reviewed') return invalid();
  keys(v, ['column', 'kind', 'value']);
  return { column, kind: 'reviewed', value: text(v.value) };
}
function readEntity(value: unknown): MenokinSopReviewedEntity {
  const v = object(value); keys(v, ['sheet', 'entityId', 'rowIds', 'maintenance', 'fields']);
  if (v.maintenance !== '启用') return invalid();
  const sheet = SOP_TASK_SHEETS.find(name => name === v.sheet); if (!sheet) return invalid();
  const rowIds = strings(v.rowIds), fields = array(v.fields, readField);
  if (!rowIds.length) return invalid(); unique(rowIds); unique(fields.map(field => field.column));
  if (fields.some(field => !(SOP_TASK_HEADERS[sheet] as readonly string[]).includes(field.column)
    || ['维护状态', '业务确认人', '待确认事项'].includes(field.column))) return invalid();
  return { sheet, entityId: id(v.entityId), rowIds, maintenance: v.maintenance, fields };
}
function readRow(value: unknown): MenokinSopRowDecision {
  const v = object(value), rowId = required(v.rowId);
  if (v.kind === 'mapped') {
    keys(v, ['rowId', 'kind', 'entityIds']); const entityIds = array(v.entityIds, id);
    if (!entityIds.length) return invalid(); unique(entityIds); return { rowId, kind: 'mapped', entityIds };
  }
  if (v.kind !== 'pending' && v.kind !== 'excluded') return invalid();
  keys(v, ['rowId', 'kind', 'reason']); return { rowId, kind: v.kind, reason: required(v.reason) };
}
function readHold(value: unknown): MenokinSopHold {
  const v = object(value), rowIds = strings(v.rowIds); if (!rowIds.length) return invalid(); unique(rowIds);
  const target = object(v.appliesTo);
  let appliesTo: MenokinSopHold['appliesTo'];
  if (target.kind === 'rows') { keys(target, ['kind']); appliesTo = { kind: 'rows' }; }
  else {
    keys(target, ['kind', 'flowIds']); if (target.kind !== 'flows') return invalid();
    const flowIds = array(target.flowIds, id); if (!flowIds.length) return invalid(); unique(flowIds);
    appliesTo = { kind: 'flows', flowIds };
  }
  const base = { id: id(v.id), rowIds, reason: required(v.reason), appliesTo };
  if (v.kind === 'pending') { keys(v, ['id', 'rowIds', 'reason', 'kind', 'appliesTo']); return { ...base, kind: 'pending' }; }
  if (v.kind !== 'resolved') return invalid();
  keys(v, ['id', 'rowIds', 'reason', 'kind', 'appliesTo', 'resolution']);
  return { ...base, kind: 'resolved', resolution: required(v.resolution) };
}
function readReview(value: unknown): MenokinSopReviewRecord {
  const v = object(value); keys(v, ['version', 'sourceSha256', 'targetDigest', 'reviewer', 'reviewedAt', 'basis', 'entities', 'rows', 'holds', 'images']);
  if (v.version !== MENOKIN_SOP_REVIEW_VERSION) return invalid();
  const reviewedAt = required(v.reviewedAt);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(reviewedAt) || !Number.isFinite(Date.parse(reviewedAt))) return invalid();
  const entities = array(v.entities, readEntity), rows = array(v.rows, readRow), holds = array(v.holds, readHold);
  const images = array(v.images, value => {
    const image = object(value); keys(image, ['resourceId', 'rowId', 'contentSha256']);
    const contentSha256 = required(image.contentSha256); if (!/^[a-f0-9]{64}$/u.test(contentSha256)) return invalid();
    return { resourceId: id(image.resourceId), rowId: required(image.rowId), contentSha256 };
  });
  unique(entities.map(entity => entity.entityId)); unique(rows.map(row => row.rowId)); unique(holds.map(hold => hold.id)); unique(images.map(image => image.resourceId));
  return { version: MENOKIN_SOP_REVIEW_VERSION, sourceSha256: required(v.sourceSha256), targetDigest: required(v.targetDigest),
    reviewer: required(v.reviewer), reviewedAt, basis: required(v.basis), entities, rows, holds, images };
}
const tablesFor = (entities: readonly Entity[]): Record<SopTaskSheet, MenokinSopAuthoringRow[]> => ({
  场景目录: entities.filter(entity => entity.sheet === '场景目录'), 执行任务: entities.filter(entity => entity.sheet === '执行任务'),
  判断分支: entities.filter(entity => entity.sheet === '判断分支'), 客户话术: entities.filter(entity => entity.sheet === '客户话术'),
  知识与案例: entities.filter(entity => entity.sheet === '知识与案例'), 资源与图片: entities.filter(entity => entity.sheet === '资源与图片'),
});
const value = (entity: Entity, column: string): string => entity.values[column] ?? '';
const primaryColumn: Record<SopTaskSheet, string> = {
  场景目录: '场景编号', 执行任务: '任务编号', 判断分支: '分支编号', 客户话术: '话术编号', 知识与案例: '知识编号', 资源与图片: '资源编号',
};

/** Local-only conversion. No registration metadata, media bytes, or authority is
 * invented. A ready plan still needs the native parser and registered import. */
export async function prepareMenokinSopReview(bytes: Buffer, options: {
  selection?: MenokinSopSelection; review?: unknown;
} = {}): Promise<MenokinSopReviewPreparation> {
  const parsed = await parseMenokinFlatSopWorkbook(bytes);
  if (!parsed.ok) return { kind: 'invalid-input', issues: parsed.issues.map(issue => ({ code: issue.code,
    target: `${issue.sheet}:${issue.row ?? ''}:${issue.column ?? ''}`, rowIds: [] })) };
  try {
    const selection = options.selection ?? {};
    const rawSelection = object(selection);
    if (Object.keys(rawSelection).some(key => !['rowIds', 'flowIds'].includes(key))) return invalid();
    const selected = selection.rowIds === undefined ? parsed.flatFacts.map(row => row.rowId) : strings(selection.rowIds);
    unique(selected); if (!selected.length || selected.some(rowId => !parsed.flatFacts.some(row => row.rowId === rowId))) return invalid();
    const flowIds = selection.flowIds === undefined ? null : array(selection.flowIds, id);
    if (flowIds) { if (!flowIds.length) return invalid(); flowIds.forEach(id); unique(flowIds); }
    selected.sort(); flowIds?.sort();
    const targetDigest = hash([MENOKIN_SOP_REVIEW_VERSION, SOP_TASK_STRUCTURE_SHA256, parsed.sourceSha256, selected, flowIds]);
    const record = options.review === undefined ? null : readReview(options.review);
    if (record && (record.sourceSha256 !== parsed.sourceSha256 || record.targetDigest !== targetDigest)) {
      return { kind: 'invalid-input', issues: [{ code: 'STALE_REVIEW', target: 'review', rowIds: [] }] };
    }
    return project(parsed.flatFacts, { rowIds: selected, flowIds }, targetDigest, record);
  } catch {
    return { kind: 'invalid-input', issues: [{ code: 'REVIEW_INVALID', target: 'review/selection', rowIds: [] }] };
  }
}

function project(facts: readonly MenokinFlatSopRowFact[], selection: MenokinSopReviewReport['selection'], targetDigest: string,
  record: MenokinSopReviewRecord | null): MenokinSopReviewPreparation {
  const sourceSha256 = facts[0]?.sourceSha256 ?? '', selected = new Set(selection.rowIds), factById = new Map(facts.map(row => [row.rowId, row]));
  const issues: MenokinSopReviewIssue[] = [];
  const add = (code: string, target: string, rowIds: readonly string[] = []) => { issues.push({ code, target, rowIds }); };
  const entities: Entity[] = [];
  for (const entity of record?.entities ?? []) {
    if (entity.rowIds.some(rowId => !selected.has(rowId))) return invalid();
    const values: Record<string, string> = Object.fromEntries(SOP_TASK_HEADERS[entity.sheet].map(column => [column, '']));
    for (const field of entity.fields) {
      if (field.kind === 'reviewed') values[field.column] = field.value;
      else {
        for (const excerpt of field.excerpts) {
          const cell = factById.get(excerpt.rowId)?.cells.find(cell => cell.column === excerpt.column);
          if (!entity.rowIds.includes(excerpt.rowId) || !cell || cell.originalDisplayText === null || excerpt.end > cell.originalDisplayText.length
            || cell.originalDisplayText.slice(excerpt.start, excerpt.end) !== excerpt.text) return invalid();
        }
        values[field.column] = field.excerpts.map(excerpt => excerpt.text).join(field.separator);
      }
    }
    values['维护状态'] = '待确认';
    values['业务确认人'] = record?.reviewer ?? '';
    values['待确认事项'] = '审核报告，等待完整流程闭包确认';
    entities.push({ sheet: entity.sheet, entityId: entity.entityId, rowIds: entity.rowIds, values });
  }
  const byEntity = new Map(entities.map(entity => [entity.entityId, entity]));
  const rows = new Map((record?.rows ?? []).map(row => [row.rowId, row]));
  for (const row of rows.values()) {
    if (!selected.has(row.rowId)) return invalid();
    if (row.kind === 'mapped' && row.entityIds.some(entityId => !byEntity.get(entityId)?.rowIds.includes(row.rowId))) return invalid();
  }
  for (const entity of entities) for (const rowId of entity.rowIds) {
    const decision = rows.get(rowId); if (decision?.kind !== 'mapped' || !decision.entityIds.includes(entity.entityId)) return invalid();
  }
  for (const hold of record?.holds ?? []) if (hold.rowIds.some(rowId => !selected.has(rowId))) return invalid();
  validateTables(entities, add);
  const flowById = new Map(entities.filter(entity => entity.sheet === '场景目录').map(entity => [value(entity, '场景编号'), entity]));
  const includedFlowIds = selection.flowIds ?? [...flowById.keys()];
  if (!includedFlowIds.length) add('FLOW_PENDING', 'flows');
  for (const flowId of includedFlowIds) if (!flowById.has(flowId)) add('FLOW_PENDING', flowId);
  const list = (entity: Entity, column: string): string[] => {
    const raw = value(entity, column); if (raw === '') return [];
    try { const result = array(JSON.parse(raw), id); unique(result); return result; }
    catch { add('INVALID_LIST', `${entity.entityId}.${column}`, entity.rowIds); return []; }
  };
  const find = (sheet: SopTaskSheet, column: string, target: string, owner: Entity): Entity | undefined => {
    const matches = entities.filter(entity => entity.sheet === sheet && value(entity, column) === target);
    if (matches.length !== 1) { add('DEPENDENCY_PENDING', `${owner.entityId}.${column}:${target}`, owner.rowIds); return undefined; }
    return matches[0];
  };
  const include = (entity: Entity, closure: Set<string>): void => {
    if (closure.has(entity.entityId)) return;
    closure.add(entity.entityId);
    if (entity.sheet === '执行任务') {
      if (value(entity, '记录类型') === '话术引用') {
        const target = find('客户话术', '话术编号', value(entity, '话术编号'), entity);
        if (target) include(target, closure);
      }
      if (value(entity, '记录类型') !== '任务') return;
      for (const knowledgeId of list(entity, '关联知识编号')) {
        const target = find('知识与案例', '知识编号', knowledgeId, entity);
        if (target) include(target, closure);
      }
    }
    for (const resourceId of list(entity, '关联资源编号')) {
      const target = find('资源与图片', '资源编号', resourceId, entity);
      if (target) include(target, closure);
    }
  };
  const flowClosures = new Map<string, Set<string>>();
  for (const [flowId, flow] of flowById) {
    const closure = new Set<string>();
    include(flow, closure);
    const tasks = entities.filter(entity => entity.sheet === '执行任务' && value(entity, '场景编号') === flowId);
    for (const task of tasks) include(task, closure);
    const taskIds = new Set(tasks.filter(task => value(task, '记录类型') === '任务').map(task => value(task, '任务编号')));
    for (const branch of entities.filter(entity => entity.sheet === '判断分支' && taskIds.has(value(entity, '任务编号')))) include(branch, closure);
    flowClosures.set(flowId, closure);
    for (const resource of entities.filter(entity => entity.sheet === '资源与图片' && closure.has(entity.entityId))) {
      const child = readScope(value(resource, '适用范围'));
      const parent = readScope(value(flow, '适用范围'));
      if (!child || !parent) continue;
      const compatible = (['productRefs', 'scenarioRefs'] as const).every(kind => {
        const same = (ref: ScopeRef, other: ScopeRef) => ref.id === other.id && ref.displayVersion === other.displayVersion;
        if (value(resource, '资源类型') === '资料') {
          return child[kind].length === parent[kind].length && child[kind].every(ref => parent[kind].some(other => same(ref, other)));
        }
        return parent[kind].length === 0 || child[kind].length > 0 && child[kind].every(ref => parent[kind].some(other => same(ref, other)));
      });
      if (!compatible) add('RESOURCE_SCOPE_PENDING', resource.entityId, resource.rowIds);
    }
  }
  const closure = new Set(includedFlowIds.flatMap(flowId => [...(flowClosures.get(flowId) ?? [])]));
  const included = entities.filter(entity => closure.has(entity.entityId));
  const rowFlows = new Map<string, Set<string>>();
  for (const entity of entities) {
    const owners = [...flowClosures].filter(([, members]) => members.has(entity.entityId)).map(([flowId]) => flowId);
    if (!owners.length) add('UNREFERENCED_ENTITY', entity.entityId, entity.rowIds);
    for (const rowId of entity.rowIds) {
      const scopes = rowFlows.get(rowId) ?? new Set<string>();
      for (const flowId of owners) scopes.add(flowId);
      rowFlows.set(rowId, scopes);
    }
  }
  for (const hold of record?.holds ?? []) {
    if (hold.appliesTo.kind !== 'flows') continue;
    const targets = hold.appliesTo.flowIds;
    if (targets.some(flowId => !flowById.has(flowId) || !hold.rowIds.some(rowId => rowFlows.get(rowId)?.has(flowId)))
      || hold.rowIds.some(rowId => !targets.some(flowId => rowFlows.get(rowId)?.has(flowId)))) {
      add('HOLD_SCOPE_PENDING', hold.id, hold.rowIds);
    }
  }
  const requiredRows = new Set(included.flatMap(entity => entity.rowIds));
  for (const rowId of selection.rowIds) {
    const decision = rows.get(rowId);
    if (!decision || decision.kind === 'pending') add('ROW_PENDING', rowId, [rowId]);
  }
  for (const hold of record?.holds ?? []) if (hold.kind === 'pending') add('BUSINESS_PENDING', hold.id, hold.rowIds);
  const imageBindings = (record?.images ?? []).filter(binding => included.some(entity => entity.sheet === '资源与图片'
    && value(entity, '资源编号') === binding.resourceId));
  for (const binding of record?.images ?? []) {
    const resource = entities.find(entity => entity.sheet === '资源与图片' && value(entity, '资源编号') === binding.resourceId);
    const source = factById.get(binding.rowId);
    if (!resource || !resource.rowIds.includes(binding.rowId) || value(resource, '资源类型') !== '图片'
      || !source?.images.some(image => image.referenceKind === 'embedded' && image.contentSha256 === binding.contentSha256)) return invalid();
  }
  for (const entity of included.filter(entity => entity.sheet === '资源与图片' && value(entity, '资源类型') === '图片')) {
    if (!imageBindings.some(binding => binding.resourceId === value(entity, '资源编号'))) add('MEDIA_PENDING', entity.entityId, entity.rowIds);
  }
  for (const rowId of requiredRows) {
    const source = factById.get(rowId);
    if (source?.images.some(image => image.referenceKind === 'external')) add('MEDIA_BYTES_PENDING', rowId, [rowId]);
    for (const image of source?.images ?? []) if (!imageBindings.some(binding => binding.rowId === rowId && binding.contentSha256 === image.contentSha256)) {
      add('MEDIA_SCOPE_PENDING', rowId, [rowId]);
    }
  }
  const allTables = tablesFor(entities.map(entity => {
    const reasons = (record?.holds ?? []).filter(hold => hold.kind === 'pending' && (hold.appliesTo.kind === 'rows'
      ? hold.rowIds.some(rowId => entity.rowIds.includes(rowId))
      : hold.appliesTo.flowIds.some(flowId => flowClosures.get(flowId)?.has(entity.entityId)))).map(hold => hold.reason);
    return { ...entity, values: { ...entity.values, 待确认事项: [...new Set([value(entity, '待确认事项'), ...reasons])].join('；') } };
  }));
  const review: MenokinSopReviewReport = {
    version: MENOKIN_SOP_REVIEW_VERSION, sourceSha256, targetDigest, selection, sourceRows: facts,
    coverage: facts.map(fact => ({ rowId: fact.rowId, selected: selected.has(fact.rowId), decision: rows.get(fact.rowId)
      ?? (selected.has(fact.rowId) ? { rowId: fact.rowId, kind: 'pending', reason: '尚无审核决定' }
        : { rowId: fact.rowId, kind: 'excluded', reason: '不在本次显式选择范围' }),
      outputs: entities.filter(entity => entity.rowIds.includes(fact.rowId)).map(entity => entity.entityId) })),
    tables: allTables, holds: record?.holds ?? [], issues, reviewRecord: record,
    media: facts.filter(fact => fact.images.length).map(fact => ({ rowId: fact.rowId, facts: fact.images,
      bindings: (record?.images ?? []).filter(binding => binding.rowId === fact.rowId) })),
  };
  const blockers = issues.filter(issue => {
    if (issue.code !== 'BUSINESS_PENDING') return true;
    const hold = record?.holds.find(hold => hold.id === issue.target);
    if (hold?.appliesTo.kind === 'flows') {
      return hold.appliesTo.flowIds.some(flowId => includedFlowIds.includes(flowId));
    }
    return issue.rowIds.some(rowId => rows.get(rowId)?.kind !== 'excluded'
      && (requiredRows.has(rowId) || !rowFlows.get(rowId)?.size));
  });
  if (!record || blockers.length) return { kind: 'needs-review', review };
  const tables = tablesFor(included.map(entity => ({ ...entity, values: {
    ...entity.values, 维护状态: '启用', 业务确认人: record.reviewer, 待确认事项: '',
  } })));
  return { kind: 'authoring-ready', review, authoringPlan: {
    version: MENOKIN_SOP_REVIEW_VERSION, sourceSha256, targetDigest, reviewDigest: hash(record),
    includedFlowIds, excludedFlowIds: [...flowById.keys()].filter(id => !includedFlowIds.includes(id)), tables, imageBindings,
    registrationRequirements: {
      flowIds: includedFlowIds, entryIds: tables['客户话术'].map(entity => entity.values['话术编号'] ?? ''),
      imageResourceIds: imageBindings.map(binding => binding.resourceId),
      fields: ['flows.anchorEntry/audience', 'entries', 'images.required/alt/ordinal', 'sourceClaim', 'riskLevel'],
    },
  } };
}

type ScopeRef = Readonly<{ id: string; displayVersion: number }>;
type Scope = Readonly<Record<'productRefs' | 'scenarioRefs', readonly ScopeRef[]>>;
function readScope(raw: string): Scope | null {
  try {
    const scope = object(JSON.parse(raw)); keys(scope, ['productRefs', 'scenarioRefs']);
    const refs = (name: keyof Scope): ScopeRef[] => {
      const result = array(scope[name], item => {
        const ref = object(item); keys(ref, ['id', 'displayVersion']);
        if (!Number.isSafeInteger(ref.displayVersion) || Number(ref.displayVersion) < 1) return invalid();
        return { id: id(ref.id), displayVersion: Number(ref.displayVersion) };
      });
      unique(result.map(ref => ref.id));
      return result;
    };
    return { productRefs: refs('productRefs'), scenarioRefs: refs('scenarioRefs') };
  } catch { return null; }
}

function validateTables(entities: readonly Entity[], add: (code: string, target: string, rowIds?: readonly string[]) => void): void {
  const issue = (entity: Entity, code = 'NATIVE_FORMAT_PENDING') => add(code, entity.entityId, entity.rowIds);
  const list = (entity: Entity, column: string): string[] => {
    try { const raw = value(entity, column); return raw === '' ? [] : array(JSON.parse(raw), required); } catch { issue(entity); return []; }
  };
  const uniqueBy = (items: readonly Entity[], column: string): void => {
    const seen = new Set<string>(); for (const entity of items) {
      const key = value(entity, column); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u.test(key) || seen.has(key)) issue(entity, 'DUPLICATE_OR_INVALID_ID'); seen.add(key);
    }
  };
  for (const sheet of SOP_TASK_SHEETS) {
    const rows = entities.filter(entity => entity.sheet === sheet);
    uniqueBy(sheet === '执行任务' ? rows.filter(entity => value(entity, '记录类型') === '任务') : rows, primaryColumn[sheet]);
  }
  const taskRows = entities.filter(entity => entity.sheet === '执行任务'), tasks = taskRows.filter(entity => value(entity, '记录类型') === '任务');
  uniqueBy(taskRows.filter(entity => value(entity, '记录类型') === '确认项'), '确认项编号');
  uniqueBy(taskRows.filter(entity => value(entity, '记录类型') === '话术引用'), '关联编号');
  const taskById = new Map(tasks.map(task => [value(task, '任务编号'), task]));
  const flows = entities.filter(entity => entity.sheet === '场景目录');
  const branches = entities.filter(entity => entity.sheet === '判断分支');
  const flowIds = new Set(flows.map(flow => value(flow, '场景编号')));
  for (const branch of branches) {
    if (!taskById.has(value(branch, '任务编号'))) issue(branch, 'DEPENDENCY_PENDING');
  }
  const positive = (raw: string) => /^[1-9][0-9]*$/u.test(raw) && Number.isSafeInteger(Number(raw));
  const audience = (raw: string) => ['坐席可读', '主管可读'].includes(raw);
  for (const entity of entities) {
    if (Object.values(entity.values).some(v => v.length > 32_767)) issue(entity);
    if ((entity.sheet === '场景目录' || entity.sheet === '资源与图片') && !readScope(value(entity, '适用范围'))) issue(entity);
    if (entity.sheet === '客户话术' && (!value(entity, '话术标题').trim() || !value(entity, '对客正文').trim())) issue(entity);
    if (entity.sheet === '知识与案例' && (!value(entity, '标题').trim() || !value(entity, '正文').trim() || !audience(value(entity, '可见对象')))) issue(entity);
    if (entity.sheet === '资源与图片' && (!value(entity, '资源名称').trim()
      || !['资料', '图片'].includes(value(entity, '资源类型')) || !['坐席可读', '主管可读', '对客可用'].includes(value(entity, '可见对象'))
      || value(entity, '资源类型') === '资料' && (!value(entity, '资源内容').trim() || value(entity, '可见对象') === '对客可用'))) issue(entity);
  }
  for (const entity of taskRows) {
    const parent = taskById.get(value(entity, '任务编号')), kind = value(entity, '记录类型');
    if (!flowIds.has(value(entity, '场景编号')) || !parent || value(parent, '场景编号') !== value(entity, '场景编号')) issue(entity, 'DEPENDENCY_PENDING');
    if (!['任务', '确认项', '话术引用'].includes(kind)) issue(entity);
    if (kind === '确认项' || kind === '话术引用') {
      for (const column of ['关联知识编号', '关联资源编号']) {
        if (value(entity, column) !== '') add('FIELD_NOT_APPLICABLE', `${entity.entityId}.${column}`, entity.rowIds);
      }
    }
    if (kind === '确认项' && (!value(entity, '确认项文字').trim() || !positive(value(entity, '确认项顺序')))) issue(entity);
    if (kind === '话术引用' && (!value(entity, '适用条件').trim() || !['独立', '替代', '配套'].includes(value(entity, '话术关系')))) issue(entity);
  }
  for (const flow of flows) {
    const flowId = value(flow, '场景编号'), members = tasks.filter(task => value(task, '场景编号') === flowId), memberIds = new Set(members.map(task => value(task, '任务编号')));
    if (!value(flow, '场景名称').trim() || !list(flow, '入口词').length || !Number.isFinite(Date.parse(value(flow, '生效时间')))
      || value(flow, '失效时间') && (!Number.isFinite(Date.parse(value(flow, '失效时间'))) || Date.parse(value(flow, '失效时间')) <= Date.parse(value(flow, '生效时间')))) issue(flow);
    const edges = new Map<string, string[]>();
    for (const task of members) {
      const taskId = value(task, '任务编号'), kind = value(task, '任务类型'), choices = branches.filter(branch => value(branch, '任务编号') === taskId);
      const confirms = taskRows.filter(row => value(row, '记录类型') === '确认项' && value(row, '任务编号') === taskId);
      if (!value(task, '任务名称').trim() || !value(task, '阶段').trim() || !value(task, '操作要求').trim()
        || !audience(value(task, '可见对象')) || !['操作', '判断', '结束'].includes(kind)) issue(task);
      if (value(task, '确认项配置') !== (confirms.length ? '有确认项' : '无确认项')
        || confirms.map(row => Number(value(row, '确认项顺序'))).sort((a,b) => a-b).some((ordinal, i) => ordinal !== i + 1)) issue(task);
      if (/过敏/u.test(value(task, '任务名称') + value(task, '操作要求'))
        && (!value(task, '操作要求').includes('停手') || !value(task, '操作要求').includes('确认'))) issue(task);
      const targets: string[] = [];
      if (kind === '操作') { targets.push(value(task, '下一任务编号')); if (choices.length) issue(task); }
      if (kind === '结束' && (value(task, '下一任务编号') || choices.length)) issue(task);
      if (kind === '判断') {
        if (value(task, '下一任务编号') || choices.length < 2 || choices.length > 4
          || choices.filter(choice => value(choice, '是否无法判断') === '是').length !== 1
          || new Set(choices.map(choice => value(choice, '选项'))).size !== choices.length
          || choices.map(choice => Number(value(choice, '分支顺序'))).sort((a,b) => a-b).some((ordinal, i) => ordinal !== i+1)) issue(task);
        for (const branch of choices) {
          if (!value(branch, '选项').trim() || !value(branch, '判断依据').trim()
            || !['是', '否'].includes(value(branch, '是否无法判断')) || !positive(value(branch, '分支顺序'))) issue(branch);
          list(branch, '匹配词'); targets.push(value(branch, '目标任务编号'));
        }
      }
      if (targets.some(target => !memberIds.has(target))) issue(task, 'TARGET_PENDING'); edges.set(taskId, targets);
    }
    const visited = new Set<string>(), active = new Set<string>();
    const visit = (taskId: string): void => {
      if (active.has(taskId)) { issue(flow, 'GRAPH_CYCLE'); return; }
      if (visited.has(taskId) || !memberIds.has(taskId)) return;
      active.add(taskId); for (const target of edges.get(taskId) ?? []) visit(target); active.delete(taskId); visited.add(taskId);
    };
    visit(value(flow, '起始任务编号')); if (visited.size !== members.length || !members.length) issue(flow, 'GRAPH_UNREACHABLE');
  }
}
