import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { inspectArchive } from './archive.js';
import { INTAKE_POLICY as P, IntakeFailure } from './policy.js';
import { prepareSopWorkbookBytes } from './sop.js';
import {
  extractWpsDisplayImages,
  type WpsImage,
  type WpsImageCoordinate,
  type WpsImageIssue,
} from './sop-wps-image.js';

export const SOP_AUTHORING_POLICY_VERSION = 'sop-authoring-v1';
export const SOP_AUTHORING_SHEET_NAMES = [
  'SOP场景',
  'SOP步骤',
  'SOP分支',
  'SOP话术',
  'SOP资源',
  'SOP搜索词',
] as const;

export const SOP_GROUP_IDS = [
  'allergy',
  'acne',
  'quality-after-sale',
  'minor-error-broken',
  'tax',
] as const;
export type SopGroupId = (typeof SOP_GROUP_IDS)[number];

export const SOP_GROUP_LABELS: Readonly<Record<SopGroupId, string>> = Object.freeze({
  allergy: '过敏流程SOP',
  acne: '长痘痘SOP',
  'quality-after-sale': '品质售后SOP',
  'minor-error-broken': '少错破SOP',
  tax: '税收相关规则',
});

export const SOP_GATE_B_NODE_IDS = [
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'DS',
  'E1',
  'E2',
] as const;
const GATE_B_NODES = new Set<string>(SOP_GATE_B_NODE_IDS);
const DECISION_NODES = new Set(['A', 'B', 'C']);
const DECISION_CHILD = /^[ABC][1-9][0-9]*$/u;

export type SopStepKind = 'ordered' | 'decision' | 'execution' | 'jump' | 'terminal';
export type SopRiskLevel = 'low' | 'medium' | 'high';

export type SopAuthoringStep = Readonly<{
  stepId: string;
  kind: SopStepKind;
  sequence: number;
  parentStepId: string | null;
  nextStepId: string | null;
  targetStepId: string | null;
  title: string;
  description: string;
}>;

export type SopAuthoringBranch = Readonly<{
  branchId: string;
  sourceStepId: string;
  label: string;
  targetStepId: string;
}>;

export type SopAuthoringMessage = Readonly<{
  messageId: string;
  stepId: string;
  text: string;
  riskLevel: SopRiskLevel;
}>;

export type SopAuthoringResource = Readonly<{
  resourceId: string;
  stepId: string;
  mediaId: string;
  ordinal: number;
  description: string;
}>;

export type SopAuthoringSearchEntry = Readonly<{
  entryId: string;
  stepId: string;
  purpose: 'classify' | 'step';
  text: string;
}>;

export type SopAuthoringDefinition = Readonly<{
  sopId: string;
  sceneId: string;
  groupId: SopGroupId;
  title: string;
  entryStepId: string;
  steps: readonly SopAuthoringStep[];
  branches: readonly SopAuthoringBranch[];
  messages: readonly SopAuthoringMessage[];
  resources: readonly SopAuthoringResource[];
  searchEntries: readonly SopAuthoringSearchEntry[];
}>;

export type SopAuthoringDocument = Readonly<{
  definitions: readonly SopAuthoringDefinition[];
}>;

export type SopAuthoringParseContext = Readonly<{
  sourceId: string;
  brandId: string;
  scope: string;
  scopeKind: 'brand' | 'shop';
}>;

export type SopAuthoringIssueCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_XLSX'
  | 'MISSING_SHEET'
  | 'UNKNOWN_SHEET'
  | 'SOP_HEADER_MISMATCH'
  | 'SOP_NON_TEXT_CELL'
  | 'SOP_ROW_INVALID'
  | 'SOP_GROUP_INVALID'
  | 'SOP_DUPLICATE_SCENE'
  | 'SOP_DUPLICATE_SOP'
  | 'SOP_DUPLICATE_NODE'
  | 'SOP_DUPLICATE_FACT'
  | 'SOP_UNKNOWN_OWNER'
  | 'SOP_NODE_TYPE_INVALID'
  | 'SOP_GATE_B_UNRESOLVED'
  | 'SOP_STEP_ORDER'
  | 'SOP_DANGLING_TARGET'
  | 'SOP_CYCLE'
  | 'SOP_MISSING_MESSAGE'
  | 'SOP_RESOURCE_BINDING'
  | 'SOP_SEARCH_BINDING'
  | 'SOP_EMPTY'
  | typeof SOP_READER_FAILURE_CODES[number];

const SOP_READER_FAILURE_CODES = [
  'FILE_TOO_LARGE',
  'INVALID_ZIP',
  'INVALID_COORDINATE',
  'COORDINATE_LIMIT',
  'ZIP_ENTRY_LIMIT',
  'UNSAFE_ZIP_PATH',
  'ZIP_NAME_MISMATCH',
  'ACTIVE_CONTENT',
  'EXPANDED_LIMIT',
  'MEDIA_LIMIT',
  'EXTERNAL_RESOURCE',
  'ZIP_SIZE_MISMATCH',
  'INVALID_ZIP_XML',
  'NORMALIZED_TEXT_LIMIT',
  'CELL_TEXT_LIMIT',
  'AMBIGUOUS_COORDINATE',
  'CELL_LIMIT',
  'STRING_LIMIT',
] as const;
const READER_FAILURE_CODES = new Set<string>(SOP_READER_FAILURE_CODES);
type SopReaderFailureCode = typeof SOP_READER_FAILURE_CODES[number];

export type SopAuthoringIssue = Readonly<{
  code: SopAuthoringIssueCode | WpsImageIssue['code'];
  sheet: string;
  row: number;
  column: string;
  fix: string;
  nodeId?: string;
}>;

export type SopAuthoringParseResult = Readonly<{
  ok: boolean;
  policyVersion: typeof SOP_AUTHORING_POLICY_VERSION;
  rawSha256: string;
  version: string;
  document: SopAuthoringDocument | null;
  images: readonly WpsImage[];
  issues: readonly SopAuthoringIssue[];
  expandedBytes: number;
  mediaCount: number;
}>;

export type SopReleaseSearchEntry = Readonly<{
  entryId: string;
  sceneId: string;
  stepId: string;
  purpose: 'classify' | 'step';
  text: string;
  normalizedText: string;
}>;

export type SopReleaseProjection = Readonly<{
  schemaVersion: 'sop-release-v1';
  releaseId: string;
  indexHash: string;
  itemCount: number;
  severityOrder: readonly SopGroupId[] | null;
  definitions: readonly Readonly<{
    sopId: string;
    sceneId: string;
    groupId: SopGroupId;
    title: string;
    entryStepId: string;
    steps: readonly Readonly<{
      stepId: string;
      kind: 'instruction' | 'decision' | 'terminal';
      sequence: number;
      text: string;
      media: readonly string[];
    }>[];
    branches: readonly Readonly<{
      branchId: string;
      sourceStepId: string;
      label: string;
      targetStepId: string;
    }>[];
  }>[];
  searchEntries: readonly SopReleaseSearchEntry[];
}>;

export type SopReleaseFacts = Readonly<{
  releaseId: string;
  definitions: readonly SopAuthoringDefinition[];
  projection: SopReleaseProjection;
}>;

export type SopAuthoringPreview = Readonly<{
  scenes: readonly Readonly<{
    sopId: string;
    sceneId: string;
    groupId: SopGroupId;
    title: string;
    steps: readonly Readonly<{
      stepId: string;
      kind: SopStepKind;
      sequence: number;
      title: string;
      messages: readonly Readonly<{
        messageId: string;
        text: string;
        riskLevel: SopRiskLevel;
      }>[];
      resources: readonly Readonly<{
        resourceId: string;
        mediaId: string;
        mime: WpsImage['mime'];
        sha256: string;
        bytes: number;
        sheet: string;
        row: number;
        column: string;
      }>[];
    }>[];
    branches: readonly SopAuthoringBranch[];
  }>[];
}>;

type RowRecord = Readonly<{
  row: number;
  values: readonly string[];
  formulas: readonly (string | null)[];
}>;

type Builder = {
  issues: SopAuthoringIssue[];
  textChars: number;
};

function isReaderFailureCode(value: string): value is SopReaderFailureCode {
  return READER_FAILURE_CODES.has(value);
}

const AUTHORING_HEADERS = {
  'SOP场景': ['场景编码', 'SOP编码', 'SOP类型', '标题', '起始步骤'],
  'SOP步骤': ['SOP编码', '节点编码', '节点类型', '顺序', '父节点', '下一节点', '跳转目标', '标题', '说明'],
  'SOP分支': ['SOP编码', '分支编码', '决策节点', '标签', '目标节点'],
  'SOP话术': ['SOP编码', '话术编码', '步骤编码', '正文', '风险级别'],
  'SOP资源': ['SOP编码', '资源编码', '步骤编码', '图片公式', '序号', '说明'],
  'SOP搜索词': ['SOP编码', '词条编码', '步骤编码', '用途', '文本'],
} as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const NODE_TYPES = new Set<SopStepKind>(['ordered', 'decision', 'execution', 'jump', 'terminal']);
const RISK_LEVELS = new Set<SopRiskLevel>(['low', 'medium', 'high']);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  builder: Builder,
  code: SopAuthoringIssue['code'],
  sheet: string,
  row: number,
  column: string,
  fix: string,
  nodeId?: string,
): void {
  builder.issues.push({
    code,
    sheet,
    row,
    column,
    fix,
    ...(nodeId === undefined ? {} : { nodeId }),
  });
}

function columnName(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'object') return null;
  if ('richText' in value && Array.isArray(value.richText)
    && value.richText.every((part) => typeof part.text === 'string')) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value && typeof value.text === 'string') return value.text;
  return null;
}

function cellFormula(value: ExcelJS.CellValue): string | null {
  if (!value || typeof value !== 'object' || !('formula' in value)) return null;
  return typeof value.formula === 'string' ? `=${value.formula}` : null;
}

function rowsFor(
  book: ExcelJS.Workbook,
  builder: Builder,
  sheetName: typeof SOP_AUTHORING_SHEET_NAMES[number],
): readonly RowRecord[] {
  const sheet = book.getWorksheet(sheetName);
  if (!sheet) return [];
  const headers = AUTHORING_HEADERS[sheetName];
  const actualHeaders = headers.map((_, index) => {
    const value = cellText(sheet.getCell(1, index + 1).value);
    return value === null ? '' : value.trim();
  });
  if (actualHeaders.some((value, index) => value !== headers[index])) {
    issue(
      builder,
      'SOP_HEADER_MISMATCH',
      sheetName,
      1,
      'A',
      `恢复表头：${headers.join('、')}`,
    );
    return [];
  }
  if (sheet.columnCount > headers.length) {
    issue(builder, 'SOP_HEADER_MISMATCH', sheetName, 1, columnName(headers.length + 1), '删除规范表之外的列');
  }
  const output: RowRecord[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: string[] = [];
    const formulas: (string | null)[] = [];
    let nonEmpty = false;
    for (let column = 1; column <= headers.length; column += 1) {
      const cell = row.getCell(column);
      const formula = cellFormula(cell.value);
      const text = cellText(cell.value);
      formulas.push(formula);
      if (formula !== null && sheetName !== 'SOP资源') {
        issue(builder, 'SOP_NON_TEXT_CELL', sheetName, rowNumber, columnName(column), '改成纯文本或富文本');
        values.push('');
        continue;
      }
      if (formula !== null && sheetName === 'SOP资源') {
        values.push(formula);
        nonEmpty = true;
        continue;
      }
      if (text === null) {
        issue(builder, 'SOP_NON_TEXT_CELL', sheetName, rowNumber, columnName(column), '改成纯文本或富文本');
        values.push('');
        continue;
      }
      const value = text.trim();
      builder.textChars += value.length;
      if (builder.textChars > P.normalizedTextChars) throw new IntakeFailure('NORMALIZED_TEXT_LIMIT');
      if (value.length > P.cellChars) {
        issue(builder, 'SOP_NON_TEXT_CELL', sheetName, rowNumber, columnName(column), '缩短单元格');
      }
      values.push(value);
      nonEmpty ||= value.length > 0 || formula !== null;
    }
    if (nonEmpty) output.push({ row: rowNumber, values, formulas });
  });
  return output;
}

function emptyResult(rawSha256: string, issues: readonly SopAuthoringIssue[]): SopAuthoringParseResult {
  return {
    ok: false,
    policyVersion: SOP_AUTHORING_POLICY_VERSION,
    rawSha256,
    version: rawSha256,
    document: null,
    images: [],
    issues,
    expandedBytes: 0,
    mediaCount: 0,
  };
}

function validContext(context: SopAuthoringParseContext): boolean {
  return ['brand', 'shop'].includes(context.scopeKind)
    && [context.sourceId, context.brandId, context.scope].every((value) => ID.test(value));
}

function validateDefinition(
  builder: Builder,
  sheet: string,
  row: number,
  definition: SopAuthoringDefinition,
): void {
  const nodes = new Map<string, SopAuthoringStep>();
  const sequences = new Set<number>();
  for (const step of definition.steps) {
    if (nodes.has(step.stepId)) {
      issue(builder, 'SOP_DUPLICATE_NODE', sheet, row, 'B', '节点编码在单个 SOP 内必须唯一', step.stepId);
    }
    if (sequences.has(step.sequence)) {
      issue(builder, 'SOP_STEP_ORDER', sheet, row, 'D', '步骤顺序必须唯一', step.stepId);
    }
    sequences.add(step.sequence);
    nodes.set(step.stepId, step);
  }
  const ordered = definition.steps
    .filter((step) => step.kind === 'ordered')
    .sort((left, right) => left.sequence - right.sequence);
  if (ordered.length !== 3 || ordered.some((step, index) => step.sequence !== index + 1)
    || ordered[0]?.nextStepId !== ordered[1]?.stepId
    || ordered[1]?.nextStepId !== ordered[2]?.stepId) {
    issue(builder, 'SOP_STEP_ORDER', sheet, row, 'A', '顶层步骤必须严格为步骤1 → 步骤2 → 步骤3');
  }
  const messageSteps = new Set(definition.messages.map((message) => message.stepId));
  for (const step of definition.steps) {
    if ((step.kind === 'ordered' || step.kind === 'execution') && !messageSteps.has(step.stepId)) {
      issue(builder, 'SOP_MISSING_MESSAGE', sheet, row, 'B', '有序步骤和执行步骤必须绑定客户话术', step.stepId);
    }
    if (DECISION_NODES.has(step.stepId) && step.kind !== 'decision') {
      issue(builder, 'SOP_NODE_TYPE_INVALID', sheet, row, 'C', 'A、B、C 节点必须是决策节点', step.stepId);
    }
    if (DECISION_CHILD.test(step.stepId) && step.kind !== 'execution') {
      issue(builder, 'SOP_NODE_TYPE_INVALID', sheet, row, 'C', 'A1、B1、C1 等节点必须是决策下的执行步骤', step.stepId);
    }
    if (step.parentStepId !== null && !nodes.has(step.parentStepId)) {
      issue(builder, 'SOP_DANGLING_TARGET', sheet, row, 'E', '父节点必须存在', step.stepId);
    }
    if (step.nextStepId !== null && !nodes.has(step.nextStepId)) {
      issue(builder, 'SOP_DANGLING_TARGET', sheet, row, 'F', '下一节点必须存在', step.stepId);
    }
    if (step.targetStepId !== null && !nodes.has(step.targetStepId)) {
      issue(builder, 'SOP_DANGLING_TARGET', sheet, row, 'G', '跳转目标必须存在', step.stepId);
    }
    if (step.kind === 'decision' && step.nextStepId !== null) {
      issue(builder, 'SOP_NODE_TYPE_INVALID', sheet, row, 'F', '决策节点用分支表达去向，不设置下一节点', step.stepId);
    }
    if (step.kind === 'jump' && step.targetStepId === null) {
      issue(builder, 'SOP_NODE_TYPE_INVALID', sheet, row, 'G', '跳转节点必须填写跳转目标', step.stepId);
    }
    if (step.kind === 'terminal' && (step.nextStepId !== null || step.targetStepId !== null)) {
      issue(builder, 'SOP_NODE_TYPE_INVALID', sheet, row, 'F', '终止节点不能有下一节点或跳转目标', step.stepId);
    }
    if (step.kind === 'execution' && (step.parentStepId === null || nodes.get(step.parentStepId)?.kind !== 'decision')) {
      issue(builder, 'SOP_NODE_TYPE_INVALID', sheet, row, 'E', '执行步骤的父节点必须是决策节点', step.stepId);
    }
  }
  const branchIds = new Set<string>();
  const branchSources = new Set<string>();
  for (const branch of definition.branches) {
    if (branchIds.has(branch.branchId)) {
      issue(builder, 'SOP_DUPLICATE_NODE', sheet, row, 'B', '分支编码在单个 SOP 内必须唯一', branch.branchId);
    }
    branchIds.add(branch.branchId);
    branchSources.add(branch.sourceStepId);
    const source = nodes.get(branch.sourceStepId);
    if (source?.kind !== 'decision') {
      issue(builder, 'SOP_DANGLING_TARGET', sheet, row, 'C', '分支来源必须是决策节点', branch.sourceStepId);
    }
    if (!nodes.has(branch.targetStepId)) {
      issue(builder, 'SOP_DANGLING_TARGET', sheet, row, 'E', '分支目标必须存在', branch.targetStepId);
    }
  }
  for (const step of definition.steps) {
    if (step.kind === 'decision' && !branchSources.has(step.stepId)) {
      issue(builder, 'SOP_DANGLING_TARGET', sheet, row, 'B', '决策节点至少需要一个分支', step.stepId);
    }
  }
  const messageIds = new Set<string>();
  for (const message of definition.messages) {
    if (messageIds.has(message.messageId)) {
      issue(builder, 'SOP_DUPLICATE_FACT', 'SOP话术', row, 'B', '话术编码在单个 SOP 内必须唯一', message.messageId);
    }
    messageIds.add(message.messageId);
  }
  const resourceIds = new Set<string>();
  const resourceOrdinals = new Set<string>();
  for (const resource of definition.resources) {
    if (resourceIds.has(resource.resourceId)) {
      issue(builder, 'SOP_DUPLICATE_FACT', 'SOP资源', row, 'B', '资源编码在单个 SOP 内必须唯一', resource.resourceId);
    }
    resourceIds.add(resource.resourceId);
    const ordinalKey = `${resource.stepId}\0${resource.ordinal}`;
    if (resourceOrdinals.has(ordinalKey)) {
      issue(builder, 'SOP_DUPLICATE_FACT', 'SOP资源', row, 'E', '同一步骤的资源序号必须唯一', resource.resourceId);
    }
    resourceOrdinals.add(ordinalKey);
    if (!nodes.has(resource.stepId)) {
      issue(builder, 'SOP_RESOURCE_BINDING', sheet, row, 'C', '资源必须绑定到存在的步骤', resource.resourceId);
    }
    if (!messageSteps.has(resource.stepId)) {
      issue(builder, 'SOP_MISSING_MESSAGE', sheet, row, 'C', '带图片的步骤必须同时有客户话术', resource.stepId);
    }
  }
  const searchEntryIds = new Set<string>();
  for (const entry of definition.searchEntries) {
    if (searchEntryIds.has(entry.entryId)) {
      issue(builder, 'SOP_DUPLICATE_FACT', 'SOP搜索词', row, 'B', '搜索词编码在单个 SOP 内必须唯一', entry.entryId);
    }
    searchEntryIds.add(entry.entryId);
    if (!nodes.has(entry.stepId)) {
      issue(builder, 'SOP_SEARCH_BINDING', sheet, row, 'C', '搜索词必须绑定到存在的步骤', entry.entryId);
    }
  }
  const graph = new Map<string, string[]>();
  for (const step of definition.steps) {
    graph.set(step.stepId, [
      ...(step.nextStepId === null ? [] : [step.nextStepId]),
      ...(step.targetStepId === null ? [] : [step.targetStepId]),
      ...definition.branches
        .filter((branch) => branch.sourceStepId === step.stepId)
        .map((branch) => branch.targetStepId),
    ]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      issue(builder, 'SOP_CYCLE', sheet, row, 'B', 'SOP 图不能有循环', nodeId);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of graph.get(nodeId) ?? []) {
      if (nodes.has(target)) walk(target);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodes.keys()) walk(nodeId);
}

function groupId(value: string): SopGroupId | null {
  return SOP_GROUP_IDS.includes(value as SopGroupId) ? value as SopGroupId : null;
}

function parseDocument(
  builder: Builder,
  scenes: readonly RowRecord[],
  steps: readonly RowRecord[],
  branchRows: readonly RowRecord[],
  messageRows: readonly RowRecord[],
  resourceRows: readonly RowRecord[],
  searchRows: readonly RowRecord[],
  images: readonly WpsImage[],
): SopAuthoringDocument | null {
  const sceneBySop = new Map<string, { sceneId: string; groupId: SopGroupId; title: string; entryStepId: string }>();
  const sceneIds = new Set<string>();
  for (const record of scenes) {
    const [sceneId, sopId, rawGroup, title, entryStepId] = record.values;
    if (!sceneId || !sopId || !rawGroup || !title || !entryStepId
      || !ID.test(sceneId) || !ID.test(sopId) || !ID.test(entryStepId)) {
      issue(builder, 'SOP_ROW_INVALID', 'SOP场景', record.row, 'A', '场景编码、SOP编码和起始步骤必须是稳定编码');
      continue;
    }
    if (sceneBySop.has(sopId)) {
      issue(builder, 'SOP_DUPLICATE_SOP', 'SOP场景', record.row, 'B', 'SOP 编码必须唯一', sopId);
    }
    if (sceneIds.has(sceneId)) {
      issue(builder, 'SOP_DUPLICATE_SCENE', 'SOP场景', record.row, 'A', '场景编码必须唯一', sceneId);
    }
    const parsedGroup = groupId(rawGroup);
    if (!parsedGroup) {
      issue(builder, 'SOP_GROUP_INVALID', 'SOP场景', record.row, 'C', `SOP类型必须是 ${SOP_GROUP_IDS.join('、')}`);
      continue;
    }
    sceneIds.add(sceneId);
    sceneBySop.set(sopId, { sceneId, groupId: parsedGroup, title, entryStepId });
  }
  for (const sopId of sceneBySop.keys()) {
    const groups = new Set(
      steps.filter((record) => record.values[0] === sopId).map((record) => record.values[1] ?? ''),
    );
    if (groups.size === 0) {
      issue(builder, 'SOP_EMPTY', 'SOP步骤', 2, 'A', '每个 SOP 至少要有步骤1、步骤2和步骤3', sopId);
    }
  }
  for (const [sheet, records] of [
    ['SOP步骤', steps],
    ['SOP分支', branchRows],
    ['SOP话术', messageRows],
    ['SOP资源', resourceRows],
    ['SOP搜索词', searchRows],
  ] as const) {
    for (const record of records) {
      const owner = record.values[0];
      if (owner && !sceneBySop.has(owner)) {
        issue(builder, 'SOP_UNKNOWN_OWNER', sheet, record.row, 'A', 'SOP编码必须在 SOP场景 中登记', owner);
      }
    }
  }
  const definitions: SopAuthoringDefinition[] = [];
  for (const [sopId, scene] of sceneBySop) {
    const parsedSteps: SopAuthoringStep[] = [];
    for (const record of steps.filter((entry) => entry.values[0] === sopId)) {
      const [owner, stepId, rawKind, rawSequence, rawParent, rawNext, rawTarget, title, description] = record.values;
      if (owner !== sopId || !stepId || !title) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP步骤', record.row, 'A', '步骤必须填写 SOP 编码、节点编码和标题');
        continue;
      }
      if (!ID.test(stepId)) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP步骤', record.row, 'B', '节点编码只能使用稳定 ASCII 字符', stepId);
      }
      if (!rawKind && GATE_B_NODES.has(stepId)) {
        issue(
          builder,
          'SOP_GATE_B_UNRESOLVED',
          'SOP步骤',
          record.row,
          'C',
          '等待 SOP-CONTENT-B 明确该节点是决策、分支子步骤、特殊跳转或终止节点',
          stepId,
        );
      } else if (!NODE_TYPES.has(rawKind as SopStepKind)) {
        issue(builder, 'SOP_NODE_TYPE_INVALID', 'SOP步骤', record.row, 'C', '节点类型必须是 ordered、decision、execution、jump 或 terminal', stepId);
      }
      if (GATE_B_NODES.has(stepId) && rawKind) {
        // The label is the only evidence accepted here. The parser never maps
        // D/E names to business behavior or supplies a default classification.
      }
      const sequence = Number(rawSequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP步骤', record.row, 'D', '顺序必须是正整数', stepId);
      }
      for (const [column, value] of [['E', rawParent], ['F', rawNext], ['G', rawTarget]] as const) {
        if (value && !ID.test(value)) issue(builder, 'SOP_ROW_INVALID', 'SOP步骤', record.row, column, '节点引用必须是稳定编码', stepId);
      }
      if (!NODE_TYPES.has(rawKind as SopStepKind) || !Number.isSafeInteger(sequence)) continue;
      parsedSteps.push({
        stepId,
        kind: rawKind as SopStepKind,
        sequence,
        parentStepId: rawParent || null,
        nextStepId: rawNext || null,
        targetStepId: rawTarget || null,
        title,
        description: description || '',
      });
    }
    const parsedBranches: SopAuthoringBranch[] = [];
    for (const record of branchRows.filter((entry) => entry.values[0] === sopId)) {
      const [, branchId, sourceStepId, label, targetStepId] = record.values;
      if (!branchId || !sourceStepId || !label || !targetStepId
        || !ID.test(branchId) || !ID.test(sourceStepId) || !ID.test(targetStepId)) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP分支', record.row, 'A', '分支必须填写编码、决策节点、标签和目标节点');
        continue;
      }
      parsedBranches.push({ branchId, sourceStepId, label, targetStepId });
    }
    const parsedMessages: SopAuthoringMessage[] = [];
    for (const record of messageRows.filter((entry) => entry.values[0] === sopId)) {
      const [, messageId, stepId, text, rawRisk] = record.values;
      if (!messageId || !stepId || !text || !ID.test(messageId) || !ID.test(stepId)
        || !RISK_LEVELS.has(rawRisk as SopRiskLevel)) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP话术', record.row, 'A', '话术必须填写编码、步骤、正文和 low、medium 或 high 风险级别');
        continue;
      }
      parsedMessages.push({ messageId, stepId, text, riskLevel: rawRisk as SopRiskLevel });
    }
    const parsedResources: SopAuthoringResource[] = [];
    for (const record of resourceRows.filter((entry) => entry.values[0] === sopId)) {
      const [, resourceId, stepId, formula, rawOrdinal, description] = record.values;
      if (!resourceId || !stepId || !ID.test(resourceId) || !ID.test(stepId)) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP资源', record.row, 'A', '资源必须填写编码和步骤');
        continue;
      }
      const ordinal = Number(rawOrdinal);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP资源', record.row, 'E', '资源序号必须是正整数', resourceId);
      }
      const image = images.find((item) => item.sheet === 'SOP资源'
        && item.row === record.row && item.column === columnName(4));
      if (!formula || !image) {
        issue(builder, 'SOP_RESOURCE_BINDING', 'SOP资源', record.row, 'D', '资源必须引用可读取的 WPS DISPIMG 图片', resourceId);
      }
      if (image && Number.isSafeInteger(ordinal)) {
        parsedResources.push({
          resourceId,
          stepId,
          mediaId: image.id,
          ordinal,
          description: description || '',
        });
      }
    }
    const parsedSearch: SopAuthoringSearchEntry[] = [];
    for (const record of searchRows.filter((entry) => entry.values[0] === sopId)) {
      const [, entryId, stepId, rawPurpose, text] = record.values;
      if (!entryId || !stepId || !text || !ID.test(entryId) || !ID.test(stepId)
        || (rawPurpose !== 'classify' && rawPurpose !== 'step')) {
        issue(builder, 'SOP_ROW_INVALID', 'SOP搜索词', record.row, 'A', '搜索词必须填写编码、步骤、classify 或 step 用途和文本');
        continue;
      }
      parsedSearch.push({ entryId, stepId, purpose: rawPurpose, text });
    }
    const definition: SopAuthoringDefinition = {
      sopId,
      sceneId: scene.sceneId,
      groupId: scene.groupId,
      title: scene.title,
      entryStepId: scene.entryStepId,
      steps: parsedSteps,
      branches: parsedBranches,
      messages: parsedMessages,
      resources: parsedResources,
      searchEntries: parsedSearch,
    };
    validateDefinition(builder, 'SOP步骤', 2, definition);
    if (!parsedSteps.some((step) => step.stepId === scene.entryStepId)) {
      issue(builder, 'SOP_DANGLING_TARGET', 'SOP场景', 2, 'E', '起始步骤必须存在', scene.entryStepId);
    }
    definitions.push(definition);
  }
  if (definitions.length === 0) {
    issue(builder, 'SOP_EMPTY', 'SOP场景', 2, 'A', '至少提供一个完整 SOP');
  }
  return definitions.length > 0 ? { definitions } : null;
}

export async function parseSopAuthoringWorkbook(
  bytes: Buffer,
  context: SopAuthoringParseContext,
): Promise<SopAuthoringParseResult> {
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!validContext(context)) {
    return emptyResult(rawSha256, [{
      code: 'INVALID_CONTEXT',
      sheet: '',
      row: 0,
      column: '',
      fix: '检查登记来源、品牌和范围',
    }]);
  }
  const builder: Builder = { issues: [], textChars: 0 };
  try {
    const prepared = await prepareSopWorkbookBytes(bytes);
    const archive = await inspectArchive(prepared, { allowExternalHyperlinks: true });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(prepared as unknown as ExcelJS.Buffer);
    const actualSheets = book.worksheets.map((sheet) => sheet.name);
    for (const sheetName of SOP_AUTHORING_SHEET_NAMES) {
      if (!actualSheets.includes(sheetName)) {
        issue(builder, 'MISSING_SHEET', sheetName, 1, 'A', '使用规范 SOP 创作工作簿');
      }
    }
    for (const sheetName of actualSheets) {
      if (!SOP_AUTHORING_SHEET_NAMES.includes(sheetName as typeof SOP_AUTHORING_SHEET_NAMES[number])) {
        issue(builder, 'UNKNOWN_SHEET', sheetName, 1, 'A', '删除未登记工作表');
      }
    }
    if (builder.issues.length > 0) {
      return { ...emptyResult(rawSha256, builder.issues), ...archive };
    }
    const sheetRows = Object.fromEntries(
      SOP_AUTHORING_SHEET_NAMES.map((sheetName) => [
        sheetName,
        rowsFor(book, builder, sheetName),
      ]),
    ) as Record<typeof SOP_AUTHORING_SHEET_NAMES[number], readonly RowRecord[]>;
    const imageCoordinates: WpsImageCoordinate[] = [];
    for (const record of sheetRows['SOP资源']) {
      const formula = record.formulas[3];
      if (formula) {
        imageCoordinates.push({
          sheet: 'SOP资源',
          row: record.row,
          column: columnName(4),
          formula,
        });
      }
    }
    const zip = await JSZip.loadAsync(prepared);
    const extracted = imageCoordinates.length === 0
      ? { items: [], issues: [] }
      : await extractWpsDisplayImages(zip, imageCoordinates);
    builder.issues.push(...extracted.issues);
    const document = parseDocument(
      builder,
      sheetRows['SOP场景'],
      sheetRows['SOP步骤'],
      sheetRows['SOP分支'],
      sheetRows['SOP话术'],
      sheetRows['SOP资源'],
      sheetRows['SOP搜索词'],
      extracted.items,
    );
    const ok = builder.issues.length === 0 && document !== null;
    return {
      ok,
      policyVersion: SOP_AUTHORING_POLICY_VERSION,
      rawSha256,
      version: rawSha256,
      document: ok ? document : null,
      images: ok ? extracted.items : [],
      issues: builder.issues,
      expandedBytes: archive.expandedBytes,
      mediaCount: ok ? extracted.items.length : 0,
    };
  } catch (error) {
    const code = error instanceof IntakeFailure && isReaderFailureCode(error.code)
      ? error.code
      : 'INVALID_XLSX';
    return emptyResult(rawSha256, [{
      code,
      sheet: '',
      row: 0,
      column: '',
      fix: '检查文件并重新导出完整 SOP 工作簿后重试',
    }]);
  }
}

export function normalizeSopSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Authoring preview contains entity relationships and media metadata only. Raw
 * bytes stay in the parser result and are injected by the owning preview adapter. */
export function createSopAuthoringPreview(
  document: SopAuthoringDocument,
  images: readonly WpsImage[],
): SopAuthoringPreview {
  const byMediaId = new Map(images.map((image) => [image.id, image]));
  return {
    scenes: document.definitions.map((definition) => ({
      sopId: definition.sopId,
      sceneId: definition.sceneId,
      groupId: definition.groupId,
      title: definition.title,
      steps: definition.steps
        .slice()
        .sort((left, right) => left.sequence - right.sequence || compareText(left.stepId, right.stepId))
        .map((step) => ({
          stepId: step.stepId,
          kind: step.kind,
          sequence: step.sequence,
          title: step.title,
          messages: definition.messages
            .filter((message) => message.stepId === step.stepId)
            .sort((left, right) => compareText(left.messageId, right.messageId))
            .map((message) => ({
              messageId: message.messageId,
              text: message.text,
              riskLevel: message.riskLevel,
            })),
          resources: definition.resources
            .filter((resource) => resource.stepId === step.stepId)
            .sort((left, right) => left.ordinal - right.ordinal || compareText(left.resourceId, right.resourceId))
            .flatMap((resource) => {
              const image = byMediaId.get(resource.mediaId);
              return image ? [{
                resourceId: resource.resourceId,
                mediaId: resource.mediaId,
                mime: image.mime,
                sha256: image.sha256,
                bytes: image.bytes,
                sheet: image.sheet,
                row: image.row,
                column: image.column,
              }] : [];
            }),
        })),
      branches: definition.branches.map((branch) => ({ ...branch })),
    })),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Parse the immutable release projection at the database boundary. Callers
 * downstream receive a typed value and do not revalidate every lookup. */
export function parseSopReleaseProjection(value: unknown): SopReleaseProjection {
  if (!record(value)
    || value.schemaVersion !== 'sop-release-v1'
    || !nonEmpty(value.releaseId)
    || typeof value.indexHash !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.indexHash)
    || !Number.isSafeInteger(value.itemCount)
    || Number(value.itemCount) < 0
    || (value.severityOrder !== null && !Array.isArray(value.severityOrder))
    || !Array.isArray(value.definitions)
    || !Array.isArray(value.searchEntries)) {
    throw new Error('SOP_PROJECTION_INVALID');
  }
  if (value.severityOrder !== null) {
    validateSeverityOrder(value.severityOrder as readonly SopGroupId[]);
  }
  const definitions = value.definitions.map((definition) => {
    if (!record(definition)
      || !nonEmpty(definition.sopId)
      || !nonEmpty(definition.sceneId)
      || !SOP_GROUP_IDS.includes(definition.groupId as SopGroupId)
      || !nonEmpty(definition.title)
      || !nonEmpty(definition.entryStepId)
      || !Array.isArray(definition.steps)
      || !Array.isArray(definition.branches)) {
      throw new Error('SOP_PROJECTION_INVALID');
    }
    const steps = definition.steps.map((step) => {
      if (!record(step)
        || !nonEmpty(step.stepId)
        || !['instruction', 'decision', 'terminal'].includes(String(step.kind))
        || !Number.isSafeInteger(step.sequence)
        || Number(step.sequence) < 1
        || typeof step.text !== 'string'
        || !Array.isArray(step.media)
        || step.media.some((media) => typeof media !== 'string')) {
        throw new Error('SOP_PROJECTION_INVALID');
      }
      return step as unknown as SopReleaseProjection['definitions'][number]['steps'][number];
    });
    const branches = definition.branches.map((branch) => {
      if (!record(branch)
        || !nonEmpty(branch.branchId)
        || !nonEmpty(branch.sourceStepId)
        || !nonEmpty(branch.label)
        || !nonEmpty(branch.targetStepId)) {
        throw new Error('SOP_PROJECTION_INVALID');
      }
      return branch as unknown as SopReleaseProjection['definitions'][number]['branches'][number];
    });
    return {
      sopId: definition.sopId,
      sceneId: definition.sceneId,
      groupId: definition.groupId as SopGroupId,
      title: definition.title,
      entryStepId: definition.entryStepId,
      steps,
      branches,
    };
  });
  const searchEntries = value.searchEntries.map((entry) => {
    if (!record(entry)
      || !nonEmpty(entry.entryId)
      || !nonEmpty(entry.sceneId)
      || !nonEmpty(entry.stepId)
      || (entry.purpose !== 'classify' && entry.purpose !== 'step')
      || !nonEmpty(entry.text)
      || typeof entry.normalizedText !== 'string'
      || normalizeSopSearchText(entry.text) !== entry.normalizedText) {
      throw new Error('SOP_PROJECTION_INVALID');
    }
    return entry as unknown as SopReleaseSearchEntry;
  });
  return {
    schemaVersion: 'sop-release-v1',
    releaseId: value.releaseId,
    indexHash: value.indexHash,
    itemCount: Number(value.itemCount),
    severityOrder: value.severityOrder as readonly SopGroupId[] | null,
    definitions,
    searchEntries,
  };
}

function validateSeverityOrder(order: readonly SopGroupId[] | null): void {
  if (order === null) return;
  if (order.length !== SOP_GROUP_IDS.length
    || new Set(order).size !== SOP_GROUP_IDS.length
    || SOP_GROUP_IDS.some((groupId) => !order.includes(groupId))) {
    throw new Error('SOP_SEVERITY_ORDER_INVALID');
  }
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => compareText(left, right))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

/** Project validated release facts once. Query consumes this immutable value;
 * it never rebuilds rows, aliases, or a second index at request time. */
export function materializeSopReleaseFacts(
  document: SopAuthoringDocument,
  releaseId: string,
  severityOrder: readonly SopGroupId[] | null,
): SopReleaseFacts {
  validateSeverityOrder(severityOrder);
  if (!ID.test(releaseId)) throw new Error('SOP_RELEASE_ID_INVALID');
  const definitions = document.definitions.map((definition) => {
    const messages = new Map<string, SopAuthoringMessage[]>();
    for (const message of definition.messages) {
      messages.set(message.stepId, [...(messages.get(message.stepId) ?? []), message]);
    }
    const resources = new Map<string, SopAuthoringResource[]>();
    for (const resource of definition.resources) {
      resources.set(resource.stepId, [...(resources.get(resource.stepId) ?? []), resource]);
    }
    return {
      sopId: definition.sopId,
      sceneId: definition.sceneId,
      groupId: definition.groupId,
      title: definition.title,
      entryStepId: definition.entryStepId,
      steps: definition.steps
        .slice()
        .sort((left, right) => left.sequence - right.sequence || compareText(left.stepId, right.stepId))
        .map((step) => ({
          stepId: step.stepId,
          kind: step.kind === 'decision'
            ? 'decision' as const
            : step.kind === 'terminal'
              ? 'terminal' as const
              : 'instruction' as const,
          sequence: step.sequence,
          text: [
            ...messages.get(step.stepId)?.sort((left, right) => compareText(left.messageId, right.messageId)).map((message) => message.text) ?? [],
            ...(step.title ? [step.title] : []),
            ...(step.description ? [step.description] : []),
          ].join('\n'),
          media: (resources.get(step.stepId) ?? [])
            .slice()
            .sort((left, right) => left.ordinal - right.ordinal || compareText(left.resourceId, right.resourceId))
            .map((resource) => resource.mediaId),
        })),
      branches: definition.branches
        .slice()
        .sort((left, right) => compareText(left.branchId, right.branchId)),
    };
  });
  const searchEntries = document.definitions.flatMap((definition) =>
    definition.searchEntries
      .slice()
      .sort((left, right) => compareText(left.entryId, right.entryId))
      .map((entry) => ({
        entryId: entry.entryId,
        sceneId: definition.sopId,
        stepId: entry.stepId,
        purpose: entry.purpose,
        text: entry.text,
        normalizedText: normalizeSopSearchText(entry.text),
      })),
  );
  const itemCount = definitions.length
    + definitions.reduce((total, definition) => total + definition.steps.length + definition.branches.length, 0)
    + searchEntries.length;
  const unsigned = {
    schemaVersion: 'sop-release-v1' as const,
    releaseId,
    itemCount,
    severityOrder,
    definitions,
    searchEntries,
  };
  const indexHash = createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  return {
    releaseId,
    definitions: document.definitions.map((definition) => ({
      ...definition,
      steps: definition.steps.map((step) => ({ ...step })),
      branches: definition.branches.map((branch) => ({ ...branch })),
      messages: definition.messages.map((message) => ({ ...message })),
      resources: definition.resources.map((resource) => ({ ...resource })),
      searchEntries: definition.searchEntries.map((entry) => ({ ...entry })),
    })),
    projection: {
      ...unsigned,
      indexHash,
    },
  };
}
