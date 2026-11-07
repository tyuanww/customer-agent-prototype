import { createHash } from 'node:crypto';
import { validateMenokinSopGraph } from './menokin-sop-graph-validator.js';

/** Candidate-only projection into the six Menokin SOP tables.
 *
 * This module owns candidate validation and deterministic identity. Source
 * provenance and the approved runtime profile belong to the caller.
 */
export const MENOKIN_SOP_CANDIDATE_VERSION = 'menokin-sop-candidate-v1';

export const MENOKIN_SOP_SEVERITY_ORDER = Object.freeze([
  '过敏流程SOP',
  '长痘痘SOP',
  '品质售后SOP',
  '少错破SOP',
  '税收相关规则',
] as const);

export const MENOKIN_SOP_TABLE_NAMES = Object.freeze([
  '场景目录',
  '执行任务',
  '判断分支',
  '客户话术',
  '知识与案例',
  '资源与图片',
] as const);

export const MENOKIN_SOP_EXECUTION_KEYS = Object.freeze([
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'DS',
] as const);

export const MENOKIN_SOP_TERMINAL_KEYS = Object.freeze(['E1', 'E2'] as const);
export const MENOKIN_SOP_EXECUTION_STEP = 3;

export const MENOKIN_SOP_CANDIDATE_POLICY = Object.freeze({
  maxRows: 1_000,
  maxNodesPerRow: 128,
  maxPathsPerRow: 256,
  maxScriptsPerRow: 256,
  maxQuickPhrasesPerRow: 256,
  maxImagesPerRow: 128,
  maxFieldsPerRow: 256,
  maxKnowledgePerRow: 256,
  maxTextCharacters: 32_767,
});

export type MenokinSopGroup = (typeof MENOKIN_SOP_SEVERITY_ORDER)[number];
export type MenokinSopTableName = (typeof MENOKIN_SOP_TABLE_NAMES)[number];
export type MenokinExecutionKey = (typeof MENOKIN_SOP_EXECUTION_KEYS)[number];
export type MenokinTerminalKey = (typeof MENOKIN_SOP_TERMINAL_KEYS)[number];

export type MenokinSourceNode = Readonly<{
  nodeKey: string | null;
  nodeType: 'execution' | 'terminal' | 'unresolved';
  stepNumber: number | null;
  title: string | null;
  body: string | null;
}>;

export type MenokinSourceField = Readonly<{
  key: string;
  value: string;
  targetNodeKey: string | null;
}>;

export type MenokinSourcePath = Readonly<{
  fromNodeKey: string | null;
  toNodeKey: string | null;
  condition: string;
}>;

export type MenokinSourceScript = Readonly<{
  targetNodeKey: string | null;
  text: string;
  riskLevel: 'routine' | 'sensitive' | 'unresolved';
}>;

export type MenokinSourceQuickPhrase = Readonly<{
  targetNodeKey: string | null;
  text: string;
}>;

export type MenokinSourceKnowledge = Readonly<{
  kind: 'knowledge' | 'case';
  key: string;
  text: string;
  targetNodeKey: string | null;
}>;

export type MenokinSourceImage = Readonly<{
  referenceKind: 'embedded' | 'external';
  columnNumber: number;
  contentSha256: string | null;
  referenceHash: string | null;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | null;
  bytes: number | null;
  targetNodeKey: string | null;
}>;

/**
 * One already-extracted row from a flat SOP source. Media references are
 * represented as hashes and worksheet coordinates; absolute paths, URLs and
 * image bytes never enter this boundary.
 */
export type MenokinSourceRow = Readonly<{
  sourceSha256: string;
  sheetName: MenokinSopGroup;
  sopGroup: MenokinSopGroup;
  rowNumber: number;
  rowHash: string;
  sourceEntryCode: string;
  nodes: readonly MenokinSourceNode[];
  fields: readonly MenokinSourceField[];
  paths: readonly MenokinSourcePath[];
  scripts: readonly MenokinSourceScript[];
  quickPhrases: readonly MenokinSourceQuickPhrase[];
  images: readonly MenokinSourceImage[];
  knowledge: readonly MenokinSourceKnowledge[];
}>;

export type MenokinSourceRef = Readonly<{
  sourceSha256: string;
  sheetName: MenokinSopGroup;
  rowNumber: number;
  rowHash: string;
  sourceEntryCode: string;
}>;

export const MENOKIN_SOP_BLOCKER_CODES = Object.freeze([
  'ALLERGY_REQUIRED_CONTEXT',
  'BRANCH_SOURCE_UNRESOLVED',
  'BRANCH_TARGET_UNRESOLVED',
  'DUPLICATE_FIELD_KEY',
  'DUPLICATE_NODE_KEY',
  'EXECUTION_STEP_CONFLICT',
  'MEDIA_EXTERNAL_REFERENCE',
  'MEDIA_TARGET_UNRESOLVED',
  'NODE_KEY_UNRESOLVED',
  'NODE_TYPE_CONFLICT',
  'NODE_TYPE_UNRESOLVED',
  'SCRIPT_RISK_UNRESOLVED',
  'SCRIPT_TARGET_UNRESOLVED',
] as const);

export type MenokinBlockerCode = (typeof MENOKIN_SOP_BLOCKER_CODES)[number];

export type MenokinPendingCode =
  | 'NODE_METADATA_REVIEW'
  | 'SCRIPT_RISK_REVIEW';

export type MenokinMaintenanceStatus = 'candidate' | 'needs_confirmation' | 'blocked';

export type MenokinCandidateBlocker = Readonly<{
  code: MenokinBlockerCode;
  tableName: MenokinSopTableName;
  rowId: string;
  field: string | null;
}>;

type CandidateBaseRow = Readonly<{
  id: string;
  sourceRefs: readonly MenokinSourceRef[];
  maintenanceStatus: MenokinMaintenanceStatus;
  pendingConfirmations: readonly MenokinPendingCode[];
  blockers: readonly MenokinCandidateBlocker[];
}>;

export type MenokinScenarioRow = CandidateBaseRow & Readonly<{
  group: MenokinSopGroup;
  label: string;
  severityRank: number;
}>;

export type MenokinExecutionRow = CandidateBaseRow & Readonly<{
  nodeKey: string | null;
  nodeType: 'execution' | 'terminal' | 'unresolved';
  stepNumber: number | null;
  title: string | null;
  body: string | null;
}>;

export type MenokinBranchRow = CandidateBaseRow & Readonly<{
  fromExecutionId: string | null;
  targetExecutionId: string | null;
  fromNodeKey: string | null;
  targetNodeKey: string | null;
  condition: string;
}>;

export type MenokinCustomerScriptRow = CandidateBaseRow & Readonly<{
  kind: 'answer';
  targetExecutionId: string | null;
  targetNodeKey: string | null;
  text: string;
  riskLevel: 'routine' | 'sensitive' | 'unresolved';
}>;

export type MenokinKnowledgeRow = CandidateBaseRow & Readonly<{
  kind: 'field' | 'quick_phrase' | 'knowledge' | 'case';
  key: string;
  text: string;
  targetExecutionId: string | null;
  targetNodeKey: string | null;
}>;

export type MenokinResourceImageRow = CandidateBaseRow & Readonly<{
  referenceKind: 'embedded' | 'external';
  columnNumber: number;
  contentSha256: string | null;
  referenceHash: string | null;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | null;
  bytes: number | null;
  targetExecutionId: string | null;
  targetNodeKey: string | null;
}>;

export type MenokinSopCandidateTables = Readonly<{
  scenarioDirectory: Readonly<{ tableName: '场景目录'; rows: readonly MenokinScenarioRow[] }>;
  executionTasks: Readonly<{ tableName: '执行任务'; rows: readonly MenokinExecutionRow[] }>;
  decisionBranches: Readonly<{ tableName: '判断分支'; rows: readonly MenokinBranchRow[] }>;
  customerScripts: Readonly<{ tableName: '客户话术'; rows: readonly MenokinCustomerScriptRow[] }>;
  knowledgeCases: Readonly<{ tableName: '知识与案例'; rows: readonly MenokinKnowledgeRow[] }>;
  resourcesImages: Readonly<{ tableName: '资源与图片'; rows: readonly MenokinResourceImageRow[] }>;
}>;

export type MenokinSopCandidate = Readonly<{
  schemaVersion: typeof MENOKIN_SOP_CANDIDATE_VERSION;
  severityOrder: typeof MENOKIN_SOP_SEVERITY_ORDER;
  sourceSha256: string;
  tables: MenokinSopCandidateTables;
  blockers: readonly MenokinCandidateBlocker[];
}>;

export type MenokinSourceInputIssueCode =
  | 'ARRAY_REQUIRED'
  | 'DUPLICATE_SOURCE_ROW'
  | 'EMPTY_INPUT'
  | 'INVALID_ENUM'
  | 'INVALID_FIELD'
  | 'INVALID_NUMBER'
  | 'INVALID_OBJECT'
  | 'INVALID_ROW_COUNT'
  | 'INVALID_SHA256'
  | 'INVALID_TEXT'
  | 'MISMATCHED_SOP_GROUP'
  | 'MIXED_SOURCE_SHA256'
  | 'MISSING_FIELD'
  | 'UNKNOWN_FIELD';

export type MenokinSourceInputIssue = Readonly<{
  code: MenokinSourceInputIssueCode;
  rowIndex: number | null;
  field: string;
}>;

export type MenokinSopValidationIssueCode =
  | 'ALLERGY_REQUIRED_CONTEXT'
  | 'BLOCKERS_PRESENT'
  | 'BRANCH_TARGET_MISSING'
  | 'CANDIDATE_SHAPE_INVALID'
  | 'DUPLICATE_ROW_ID'
  | 'EXECUTION_STEP_CONFLICT'
  | 'GRAPH_INVALID'
  | 'MAINTENANCE_STATUS_MISMATCH'
  | 'MEDIA_BINDING_UNRESOLVED'
  | 'NODE_REFERENCE_MISMATCH'
  | 'NODE_KEY_CONFLICT'
  | 'NODE_TYPE_UNRESOLVED'
  | 'SCENARIO_GROUP_MISMATCH'
  | 'SCENARIO_ORDER_MISMATCH'
  | 'SCRIPT_RISK_UNRESOLVED'
  | 'SENSITIVE_SCRIPT_NOT_CONFIRMED'
  | 'SOURCE_BINDING_MISMATCH'
  | 'TERMINAL_HAS_OUTGOING_EDGE';

export type MenokinSopValidationIssue = Readonly<{
  code: MenokinSopValidationIssueCode;
  rowId: string | null;
  field: string | null;
}>;

export type MenokinSopValidationReport = Readonly<{
  ok: boolean;
  ready: boolean;
  status: 'ready' | 'needs_confirmation' | 'blocked' | 'invalid';
  issues: readonly MenokinSopValidationIssue[];
  tableRowCounts: Readonly<Record<MenokinSopTableName, number>> | null;
}>;

export type MenokinSopProjectionResult = Readonly<{
  ok: boolean;
  candidate: MenokinSopCandidate | null;
  inputIssues: readonly MenokinSourceInputIssue[];
  validation: MenokinSopValidationReport | null;
}>;

export type MenokinSopDecisionSummary = Readonly<{
  schemaVersion: typeof MENOKIN_SOP_CANDIDATE_VERSION;
  status: MenokinSopValidationReport['status'];
  ready: boolean;
  tableRows: readonly Readonly<{
    tableName: MenokinSopTableName;
    rowIds: readonly string[];
  }>[];
  blockerCodes: readonly string[];
}>;

const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_ENTRY_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const NODE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const STABLE_ID = /^sop-(?:scenario|execution|branch|script|knowledge|resource)-[0-9a-f]{24}$/u;
const GROUP_SET = new Set<string>(MENOKIN_SOP_SEVERITY_ORDER);
const EXECUTION_KEY_SET = new Set<string>(MENOKIN_SOP_EXECUTION_KEYS);
const TERMINAL_KEY_SET = new Set<string>(MENOKIN_SOP_TERMINAL_KEYS);
const BLOCKER_CODE_SET = new Set<string>(MENOKIN_SOP_BLOCKER_CODES);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};

const text = (value: unknown, allowEmpty = false): value is string => typeof value === 'string'
  && value.length <= MENOKIN_SOP_CANDIDATE_POLICY.maxTextCharacters
  && (allowEmpty || (value.length > 0 && value.trim() === value));

const nullableText = (value: unknown): value is string | null => value === null || text(value);
const nullableNodeKey = (value: unknown): value is string | null => value === null || (typeof value === 'string' && NODE_KEY.test(value));
const safePositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const safeIntegerOrNull = (value: unknown): value is number | null => value === null
  || (Number.isSafeInteger(value) && Number(value) >= 0);
const sourceSha = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);
const group = (value: unknown): value is MenokinSopGroup => typeof value === 'string' && GROUP_SET.has(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const stableId = (kind: 'scenario' | 'execution' | 'branch' | 'script' | 'knowledge' | 'resource', parts: readonly unknown[]): string =>
  `sop-${kind}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;

const sourceRef = (row: MenokinSourceRow): MenokinSourceRef => ({
  sourceSha256: row.sourceSha256,
  sheetName: row.sheetName,
  rowNumber: row.rowNumber,
  rowHash: row.rowHash,
  sourceEntryCode: row.sourceEntryCode,
});

const refKey = (ref: MenokinSourceRef): string => `${ref.sourceSha256}:${ref.sheetName}:${ref.rowHash}:${ref.rowNumber}`;

const dedupeRefs = (refs: readonly MenokinSourceRef[]): readonly MenokinSourceRef[] => {
  const byKey = new Map(refs.map((ref) => [refKey(ref), ref]));
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, ref]) => ref);
};

const blocker = (
  code: MenokinBlockerCode,
  tableName: MenokinSopTableName,
  rowId: string,
  field: string | null,
): MenokinCandidateBlocker => ({ code, tableName, rowId, field });

const statusFor = (
  blockers: readonly MenokinCandidateBlocker[],
  pendingConfirmations: readonly MenokinPendingCode[],
): MenokinMaintenanceStatus => blockers.length ? 'blocked' : pendingConfirmations.length ? 'needs_confirmation' : 'candidate';

const requiredContext = (value: string): boolean => !value.includes('过敏') || (value.includes('停手') && value.includes('确认'));

function validateSourceArray(
  value: unknown,
  max: number,
  rowIndex: number,
  field: string,
  check: (entry: unknown, rowIndex: number, field: string, issues: MenokinSourceInputIssue[]) => void,
  issues: MenokinSourceInputIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ code: 'ARRAY_REQUIRED', rowIndex, field });
    return;
  }
  if (value.length > max) {
    issues.push({ code: 'INVALID_ROW_COUNT', rowIndex, field });
    return;
  }
  value.forEach((entry, index) => check(entry, rowIndex, `${field}[${index}]`, issues));
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  rowIndex: number,
  field: string,
  issues: MenokinSourceInputIssue[],
): value is Record<string, unknown> {
  if (!record(value)) {
    issues.push({ code: 'INVALID_OBJECT', rowIndex, field });
    return false;
  }
  const missing = keys.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  missing.forEach((key) => issues.push({ code: 'MISSING_FIELD', rowIndex, field: `${field}.${key}` }));
  unknown.forEach((key) => issues.push({ code: 'UNKNOWN_FIELD', rowIndex, field: `${field}.${key}` }));
  return missing.length === 0 && unknown.length === 0;
}

/**
 * Validates the complete source-row shape before projection. Any issue returns
 * no candidate, so malformed or ambiguous input cannot leak partial rows.
 */
export function validateMenokinSourceRows(value: unknown): readonly MenokinSourceInputIssue[] {
  const issues: MenokinSourceInputIssue[] = [];
  if (!Array.isArray(value)) return [{ code: 'ARRAY_REQUIRED', rowIndex: null, field: '$' }];
  if (value.length === 0) return [{ code: 'EMPTY_INPUT', rowIndex: null, field: '$' }];
  if (value.length > MENOKIN_SOP_CANDIDATE_POLICY.maxRows) {
    return [{ code: 'INVALID_ROW_COUNT', rowIndex: null, field: '$' }];
  }

  const rowKeys = [
    'sourceSha256', 'sheetName', 'sopGroup', 'rowNumber', 'rowHash', 'sourceEntryCode',
    'nodes', 'fields', 'paths', 'scripts', 'quickPhrases', 'images', 'knowledge',
  ] as const;
  const seenRows = new Set<string>();
  const seenSources = new Set<string>();

  value.forEach((rawRow, rowIndex) => {
    const field = `$[${rowIndex}]`;
    if (!exactObject(rawRow, rowKeys, rowIndex, field, issues)) return;
    const row = rawRow;

    if (!sourceSha(row.sourceSha256)) issues.push({ code: 'INVALID_SHA256', rowIndex, field: `${field}.sourceSha256` });
    if (!sourceSha(row.rowHash)) issues.push({ code: 'INVALID_SHA256', rowIndex, field: `${field}.rowHash` });
    if (!group(row.sheetName)) issues.push({ code: 'INVALID_ENUM', rowIndex, field: `${field}.sheetName` });
    if (!group(row.sopGroup)) issues.push({ code: 'INVALID_ENUM', rowIndex, field: `${field}.sopGroup` });
    if (row.sheetName !== row.sopGroup) issues.push({ code: 'MISMATCHED_SOP_GROUP', rowIndex, field: `${field}.sopGroup` });
    if (!safePositiveInteger(row.rowNumber)) issues.push({ code: 'INVALID_NUMBER', rowIndex, field: `${field}.rowNumber` });
    if (typeof row.sourceEntryCode !== 'string' || !SOURCE_ENTRY_CODE.test(row.sourceEntryCode)) {
      issues.push({ code: 'INVALID_TEXT', rowIndex, field: `${field}.sourceEntryCode` });
    }
    if (sourceSha(row.sourceSha256)) seenSources.add(row.sourceSha256);
    if (sourceSha(row.sourceSha256) && group(row.sheetName) && sourceSha(row.rowHash)) {
      const key = `${row.sourceSha256}:${row.sheetName}:${row.rowHash}`;
      if (seenRows.has(key)) issues.push({ code: 'DUPLICATE_SOURCE_ROW', rowIndex, field });
      seenRows.add(key);
    }

    validateSourceArray(row.nodes, MENOKIN_SOP_CANDIDATE_POLICY.maxNodesPerRow, rowIndex, `${field}.nodes`, (entry, index, at, found) => {
      const keys = ['nodeKey', 'nodeType', 'stepNumber', 'title', 'body'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (!nullableNodeKey(entry.nodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.nodeKey` });
      if (!['execution', 'terminal', 'unresolved'].includes(String(entry.nodeType))) {
        found.push({ code: 'INVALID_ENUM', rowIndex, field: `${at}.nodeType` });
      }
      if (!safeIntegerOrNull(entry.stepNumber)) found.push({ code: 'INVALID_NUMBER', rowIndex, field: `${at}.stepNumber` });
      if (!nullableText(entry.title)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.title` });
      if (!nullableText(entry.body)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.body` });
    }, issues);

    validateSourceArray(row.fields, MENOKIN_SOP_CANDIDATE_POLICY.maxFieldsPerRow, rowIndex, `${field}.fields`, (entry, index, at, found) => {
      const keys = ['key', 'value', 'targetNodeKey'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (typeof entry.key !== 'string' || !KEY.test(entry.key)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.key` });
      if (!text(entry.value)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.value` });
      if (!nullableNodeKey(entry.targetNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.targetNodeKey` });
    }, issues);

    validateSourceArray(row.paths, MENOKIN_SOP_CANDIDATE_POLICY.maxPathsPerRow, rowIndex, `${field}.paths`, (entry, index, at, found) => {
      const keys = ['fromNodeKey', 'toNodeKey', 'condition'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (!nullableNodeKey(entry.fromNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.fromNodeKey` });
      if (!nullableNodeKey(entry.toNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.toNodeKey` });
      if (!text(entry.condition)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.condition` });
    }, issues);

    validateSourceArray(row.scripts, MENOKIN_SOP_CANDIDATE_POLICY.maxScriptsPerRow, rowIndex, `${field}.scripts`, (entry, index, at, found) => {
      const keys = ['targetNodeKey', 'text', 'riskLevel'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (!nullableNodeKey(entry.targetNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.targetNodeKey` });
      if (!text(entry.text)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.text` });
      if (!['routine', 'sensitive', 'unresolved'].includes(String(entry.riskLevel))) {
        found.push({ code: 'INVALID_ENUM', rowIndex, field: `${at}.riskLevel` });
      }
    }, issues);

    validateSourceArray(row.quickPhrases, MENOKIN_SOP_CANDIDATE_POLICY.maxQuickPhrasesPerRow, rowIndex, `${field}.quickPhrases`, (entry, index, at, found) => {
      const keys = ['targetNodeKey', 'text'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (!nullableNodeKey(entry.targetNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.targetNodeKey` });
      if (!text(entry.text)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.text` });
    }, issues);

    validateSourceArray(row.images, MENOKIN_SOP_CANDIDATE_POLICY.maxImagesPerRow, rowIndex, `${field}.images`, (entry, index, at, found) => {
      const keys = ['referenceKind', 'columnNumber', 'contentSha256', 'referenceHash', 'mime', 'bytes', 'targetNodeKey'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (entry.referenceKind !== 'embedded' && entry.referenceKind !== 'external') {
        found.push({ code: 'INVALID_ENUM', rowIndex, field: `${at}.referenceKind` });
      }
      if (!safePositiveInteger(entry.columnNumber)) found.push({ code: 'INVALID_NUMBER', rowIndex, field: `${at}.columnNumber` });
      if (entry.contentSha256 !== null && !sourceSha(entry.contentSha256)) {
        found.push({ code: 'INVALID_SHA256', rowIndex, field: `${at}.contentSha256` });
      }
      if (entry.referenceHash !== null && !sourceSha(entry.referenceHash)) {
        found.push({ code: 'INVALID_SHA256', rowIndex, field: `${at}.referenceHash` });
      }
      if (entry.mime !== null && !['image/png', 'image/jpeg', 'image/gif'].includes(String(entry.mime))) {
        found.push({ code: 'INVALID_ENUM', rowIndex, field: `${at}.mime` });
      }
      if (entry.bytes !== null && !safePositiveInteger(entry.bytes)) found.push({ code: 'INVALID_NUMBER', rowIndex, field: `${at}.bytes` });
      if (!nullableNodeKey(entry.targetNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.targetNodeKey` });
      if (entry.referenceKind === 'embedded' && (entry.contentSha256 === null || entry.mime === null || entry.bytes === null || entry.referenceHash !== null)) {
        found.push({ code: 'INVALID_FIELD', rowIndex, field: at });
      }
      if (entry.referenceKind === 'external' && (entry.referenceHash === null
        || entry.contentSha256 !== null || entry.mime !== null || entry.bytes !== null)) {
        found.push({ code: 'INVALID_FIELD', rowIndex, field: at });
      }
    }, issues);

    validateSourceArray(row.knowledge, MENOKIN_SOP_CANDIDATE_POLICY.maxKnowledgePerRow, rowIndex, `${field}.knowledge`, (entry, index, at, found) => {
      const keys = ['kind', 'key', 'text', 'targetNodeKey'] as const;
      if (!exactObject(entry, keys, rowIndex, at, found)) return;
      if (entry.kind !== 'knowledge' && entry.kind !== 'case') found.push({ code: 'INVALID_ENUM', rowIndex, field: `${at}.kind` });
      if (typeof entry.key !== 'string' || !KEY.test(entry.key)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.key` });
      if (!text(entry.text)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.text` });
      if (!nullableNodeKey(entry.targetNodeKey)) found.push({ code: 'INVALID_TEXT', rowIndex, field: `${at}.targetNodeKey` });
    }, issues);
  });

  if (seenSources.size > 1) issues.push({ code: 'MIXED_SOURCE_SHA256', rowIndex: null, field: '$.sourceSha256' });
  return issues;
}

type LocatedNode = Readonly<{
  row: MenokinSourceRow;
  source: MenokinSourceRef;
  index: number;
  node: MenokinSourceNode;
}>;

const nodeScopeKey = (groupName: MenokinSopGroup, nodeKey: string): string => `${groupName}\u0000${nodeKey}`;

const sortRows = (left: MenokinSourceRow, right: MenokinSourceRow): number => {
  const groupOrder = MENOKIN_SOP_SEVERITY_ORDER.indexOf(left.sopGroup) - MENOKIN_SOP_SEVERITY_ORDER.indexOf(right.sopGroup);
  return groupOrder
    || left.sourceEntryCode.localeCompare(right.sourceEntryCode)
    || left.rowHash.localeCompare(right.rowHash)
    || left.rowNumber - right.rowNumber;
};

const resolveNode = (
  groupName: MenokinSopGroup,
  nodeKey: string | null,
  nodesByKey: ReadonlyMap<string, LocatedNode | null>,
): LocatedNode | null => nodeKey === null ? null : (nodesByKey.get(nodeScopeKey(groupName, nodeKey)) ?? null);

const resolvedNodeId = (
  located: LocatedNode | null,
  idsByLocatedNode: ReadonlyMap<LocatedNode, string>,
): string | null => located ? (idsByLocatedNode.get(located) ?? null) : null;

const expectedNodeType = (nodeKey: string | null): 'execution' | 'terminal' | null => {
  if (nodeKey && EXECUTION_KEY_SET.has(nodeKey)) return 'execution';
  if (nodeKey && TERMINAL_KEY_SET.has(nodeKey)) return 'terminal';
  return null;
};

const blockerKey = (item: MenokinCandidateBlocker): string =>
  `${item.tableName}\u0000${item.rowId}\u0000${item.code}\u0000${item.field ?? ''}`;

const sortBlockers = (items: readonly MenokinCandidateBlocker[]): readonly MenokinCandidateBlocker[] => {
  const deduped = new Map(items.map((item) => [blockerKey(item), item]));
  return [...deduped.values()].sort((left, right) => blockerKey(left).localeCompare(blockerKey(right)));
};

/** Pure projection. Malformed source shape returns null; unresolved semantics stay visible as blockers. */
export function projectMenokinSopSourceRows(value: unknown): MenokinSopProjectionResult {
  const inputIssues = validateMenokinSourceRows(value);
  if (inputIssues.length > 0) {
    return { ok: false, candidate: null, inputIssues, validation: null };
  }
  const rows = [...(value as readonly MenokinSourceRow[])].sort(sortRows);
  const sourceSha256 = rows[0]!.sourceSha256;
  const sourceGroups = new Set(rows.map((row) => row.sopGroup));

  const scenarioRows: MenokinScenarioRow[] = MENOKIN_SOP_SEVERITY_ORDER
    .filter((name) => sourceGroups.has(name))
    .map((name) => {
      const refs = dedupeRefs(rows.filter((row) => row.sopGroup === name).map(sourceRef));
      return {
        id: stableId('scenario', [sourceSha256, name]),
        sourceRefs: refs,
        maintenanceStatus: 'candidate',
        pendingConfirmations: [],
        blockers: [],
        group: name,
        label: name,
        severityRank: MENOKIN_SOP_SEVERITY_ORDER.indexOf(name),
      };
    });

  const locatedNodes: readonly LocatedNode[] = rows.flatMap((row) => row.nodes.map((node, index) => ({
    row, source: sourceRef(row), index, node,
  })));
  const nodesByKeyMutable = new Map<string, LocatedNode | null>();
  locatedNodes.forEach((located) => {
    if (located.node.nodeKey === null) return;
    const key = nodeScopeKey(located.row.sopGroup, located.node.nodeKey);
    nodesByKeyMutable.set(key, nodesByKeyMutable.has(key) ? null : located);
  });
  const nodesByKey: ReadonlyMap<string, LocatedNode | null> = nodesByKeyMutable;

  const executionRows: MenokinExecutionRow[] = locatedNodes.map((located) => {
    const { node, row, index } = located;
    const id = stableId('execution', [row.sourceSha256, row.sopGroup, row.rowHash, index, node.nodeKey]);
    const nodeBlockers: MenokinCandidateBlocker[] = [];
    const expected = expectedNodeType(node.nodeKey);
    let nodeType = node.nodeType;

    if (node.nodeKey === null || node.nodeType === 'unresolved') {
      nodeBlockers.push(blocker('NODE_TYPE_UNRESOLVED', '执行任务', id, 'nodeType'));
      if (node.nodeKey === null) nodeBlockers.push(blocker('NODE_KEY_UNRESOLVED', '执行任务', id, 'nodeKey'));
      nodeType = 'unresolved';
    } else if (expected === null) {
      nodeBlockers.push(blocker('NODE_TYPE_UNRESOLVED', '执行任务', id, 'nodeType'));
      nodeType = 'unresolved';
    } else if (node.nodeType !== expected) {
      nodeBlockers.push(blocker('NODE_TYPE_CONFLICT', '执行任务', id, 'nodeType'));
      nodeType = 'unresolved';
    }

    if (node.nodeKey && EXECUTION_KEY_SET.has(node.nodeKey) && node.stepNumber !== MENOKIN_SOP_EXECUTION_STEP) {
      nodeBlockers.push(blocker('EXECUTION_STEP_CONFLICT', '执行任务', id, 'stepNumber'));
    }
    if (node.nodeKey && nodesByKey.get(nodeScopeKey(row.sopGroup, node.nodeKey)) === null) {
      nodeBlockers.push(blocker('DUPLICATE_NODE_KEY', '执行任务', id, 'nodeKey'));
    }
    if ((node.title?.includes('过敏') || node.body?.includes('过敏'))
      && (!node.body || !node.body.includes('停手') || !node.body.includes('确认'))) {
      nodeBlockers.push(blocker('ALLERGY_REQUIRED_CONTEXT', '执行任务', id, 'body'));
    }

    const pending: MenokinPendingCode[] = node.title === null || node.body === null ? ['NODE_METADATA_REVIEW'] : [];
    const rowBlockers = sortBlockers(nodeBlockers);
    return {
      id,
      sourceRefs: [located.source],
      maintenanceStatus: statusFor(rowBlockers, pending),
      pendingConfirmations: pending,
      blockers: rowBlockers,
      nodeKey: node.nodeKey,
      nodeType,
      stepNumber: node.stepNumber,
      title: node.title,
      body: node.body,
    };
  });

  const idsByLocatedNode = new Map(locatedNodes.map((located, index) => [located, executionRows[index]!.id]));

  const branchRows: MenokinBranchRow[] = rows.flatMap((row) => row.paths.map((path, index) => {
    const id = stableId('branch', [row.sourceSha256, row.sopGroup, row.rowHash, index, path.fromNodeKey, path.toNodeKey, path.condition]);
    const sourceNode = resolveNode(row.sopGroup, path.fromNodeKey, nodesByKey);
    const targetNode = resolveNode(row.sopGroup, path.toNodeKey, nodesByKey);
    const fromExecutionId = resolvedNodeId(sourceNode, idsByLocatedNode);
    const targetExecutionId = resolvedNodeId(targetNode, idsByLocatedNode);
    const rowBlockers: MenokinCandidateBlocker[] = [];
    if (fromExecutionId === null) rowBlockers.push(blocker('BRANCH_SOURCE_UNRESOLVED', '判断分支', id, 'fromNodeKey'));
    if (targetExecutionId === null) rowBlockers.push(blocker('BRANCH_TARGET_UNRESOLVED', '判断分支', id, 'targetNodeKey'));
    const rowBlockersSorted = sortBlockers(rowBlockers);
    return {
      id,
      sourceRefs: [sourceRef(row)],
      maintenanceStatus: statusFor(rowBlockersSorted, []),
      pendingConfirmations: [],
      blockers: rowBlockersSorted,
      fromExecutionId,
      targetExecutionId,
      fromNodeKey: path.fromNodeKey,
      targetNodeKey: path.toNodeKey,
      condition: path.condition,
    };
  }));

  const scriptRows: MenokinCustomerScriptRow[] = rows.flatMap((row) => row.scripts.map((script, index) => {
    const id = stableId('script', [row.sourceSha256, row.sopGroup, row.rowHash, index, script.targetNodeKey, script.text]);
    const target = resolveNode(row.sopGroup, script.targetNodeKey, nodesByKey);
    const targetExecutionId = resolvedNodeId(target, idsByLocatedNode);
    const rowBlockers: MenokinCandidateBlocker[] = [];
    if (targetExecutionId === null) rowBlockers.push(blocker('SCRIPT_TARGET_UNRESOLVED', '客户话术', id, 'targetNodeKey'));
    if (script.riskLevel === 'unresolved') rowBlockers.push(blocker('SCRIPT_RISK_UNRESOLVED', '客户话术', id, 'riskLevel'));
    if (!requiredContext(script.text)) rowBlockers.push(blocker('ALLERGY_REQUIRED_CONTEXT', '客户话术', id, 'text'));
    const pending: MenokinPendingCode[] = script.riskLevel === 'sensitive' ? ['SCRIPT_RISK_REVIEW'] : [];
    const rowBlockersSorted = sortBlockers(rowBlockers);
    return {
      id,
      sourceRefs: [sourceRef(row)],
      maintenanceStatus: statusFor(rowBlockersSorted, pending),
      pendingConfirmations: pending,
      blockers: rowBlockersSorted,
      kind: 'answer',
      targetExecutionId,
      targetNodeKey: script.targetNodeKey,
      text: script.text,
      riskLevel: script.riskLevel,
    };
  }));

  const knowledgeRows: MenokinKnowledgeRow[] = rows.flatMap((row) => {
    const seenFieldKeys = new Set<string>();
    const entries: MenokinKnowledgeRow[] = [];
    const push = (kind: MenokinKnowledgeRow['kind'], key: string, value: string, targetNodeKey: string | null, index: number) => {
      const id = stableId('knowledge', [row.sourceSha256, row.sopGroup, row.rowHash, kind, index, key, value]);
      const target = resolveNode(row.sopGroup, targetNodeKey, nodesByKey);
      const targetExecutionId = resolvedNodeId(target, idsByLocatedNode);
      const rowBlockers = kind === 'field' && seenFieldKeys.has(key)
        ? [blocker('DUPLICATE_FIELD_KEY', '知识与案例', id, 'key')]
        : [];
      seenFieldKeys.add(key);
      const rowBlockersSorted = sortBlockers(rowBlockers);
      entries.push({
        id,
        sourceRefs: [sourceRef(row)],
        maintenanceStatus: statusFor(rowBlockersSorted, []),
        pendingConfirmations: [],
        blockers: rowBlockersSorted,
        kind,
        key,
        text: value,
        targetExecutionId,
        targetNodeKey,
      });
    };
    const texts = [
      ...row.fields.map((item) => ({ kind: 'field' as const, key: item.key, text: item.value, targetNodeKey: item.targetNodeKey })),
      ...row.quickPhrases.map((item, index) => ({ kind: 'quick_phrase' as const, key: `quick-${index + 1}`, text: item.text, targetNodeKey: item.targetNodeKey })),
      ...row.knowledge,
    ];
    texts.forEach((item, index) => push(item.kind, item.key, item.text, item.targetNodeKey, index));
    return entries;
  });

  const resourceRows: MenokinResourceImageRow[] = rows.flatMap((row) => row.images.map((image, index) => {
    const id = stableId('resource', [
      row.sourceSha256, row.sopGroup, row.rowHash, index, image.referenceKind,
      image.contentSha256, image.referenceHash, image.targetNodeKey,
    ]);
    const target = resolveNode(row.sopGroup, image.targetNodeKey, nodesByKey);
    const targetExecutionId = resolvedNodeId(target, idsByLocatedNode);
    const rowBlockers: MenokinCandidateBlocker[] = [];
    if (targetExecutionId === null) rowBlockers.push(blocker('MEDIA_TARGET_UNRESOLVED', '资源与图片', id, 'targetNodeKey'));
    if (image.referenceKind === 'external') rowBlockers.push(blocker('MEDIA_EXTERNAL_REFERENCE', '资源与图片', id, 'referenceKind'));
    const rowBlockersSorted = sortBlockers(rowBlockers);
    return {
      id,
      sourceRefs: [sourceRef(row)],
      maintenanceStatus: statusFor(rowBlockersSorted, []),
      pendingConfirmations: [],
      blockers: rowBlockersSorted,
      referenceKind: image.referenceKind,
      columnNumber: image.columnNumber,
      contentSha256: image.contentSha256,
      referenceHash: image.referenceHash,
      mime: image.mime,
      bytes: image.bytes,
      targetExecutionId,
      targetNodeKey: image.targetNodeKey,
    };
  }));

  const allBlockers = sortBlockers([
    ...executionRows.flatMap((row) => row.blockers),
    ...branchRows.flatMap((row) => row.blockers),
    ...scriptRows.flatMap((row) => row.blockers),
    ...knowledgeRows.flatMap((row) => row.blockers),
    ...resourceRows.flatMap((row) => row.blockers),
  ]);
  const candidate: MenokinSopCandidate = {
    schemaVersion: MENOKIN_SOP_CANDIDATE_VERSION,
    severityOrder: MENOKIN_SOP_SEVERITY_ORDER,
    sourceSha256,
    tables: {
      scenarioDirectory: { tableName: '场景目录', rows: scenarioRows },
      executionTasks: { tableName: '执行任务', rows: executionRows },
      decisionBranches: { tableName: '判断分支', rows: branchRows },
      customerScripts: { tableName: '客户话术', rows: scriptRows },
      knowledgeCases: { tableName: '知识与案例', rows: knowledgeRows },
      resourcesImages: { tableName: '资源与图片', rows: resourceRows },
    },
    blockers: allBlockers,
  };
  const validation = validateMenokinSopCandidate(candidate);
  return { ok: validation.ready, candidate, inputIssues: [], validation };
}

function validateSourceRef(value: unknown, issues: MenokinSopValidationIssue[]): value is MenokinSourceRef {
  const keys = ['sourceSha256', 'sheetName', 'rowNumber', 'rowHash', 'sourceEntryCode'] as const;
  if (!record(value) || !exactKeys(value, keys)
    || !sourceSha(value.sourceSha256)
    || !group(value.sheetName)
    || !safePositiveInteger(value.rowNumber)
    || !sourceSha(value.rowHash)
    || typeof value.sourceEntryCode !== 'string'
    || !SOURCE_ENTRY_CODE.test(value.sourceEntryCode)) {
    issues.push({ code: 'CANDIDATE_SHAPE_INVALID', rowId: null, field: 'sourceRefs' });
    return false;
  }
  return true;
}

function validateCandidateBase(
  value: unknown,
  tableName: MenokinSopTableName,
  keys: readonly string[],
  issues: MenokinSopValidationIssue[],
): value is CandidateBaseRow {
  if (!record(value) || !exactKeys(value, keys)
    || typeof value.id !== 'string' || !STABLE_ID.test(value.id)
    || !Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0
    || !['candidate', 'needs_confirmation', 'blocked'].includes(String(value.maintenanceStatus))
    || !Array.isArray(value.pendingConfirmations)
    || !value.pendingConfirmations.every((item) => item === 'NODE_METADATA_REVIEW' || item === 'SCRIPT_RISK_REVIEW')
    || !Array.isArray(value.blockers)) {
    issues.push({ code: 'CANDIDATE_SHAPE_INVALID', rowId: record(value) && typeof value.id === 'string' ? value.id : null, field: 'row' });
    return false;
  }
  const rowId = value.id as string;
  value.sourceRefs.forEach((source) => validateSourceRef(source, issues));
  value.blockers.forEach((item) => {
    if (!record(item) || !exactKeys(item, ['code', 'tableName', 'rowId', 'field'])
      || !BLOCKER_CODE_SET.has(String(item.code))
      || item.tableName !== tableName
      || item.rowId !== value.id
      || (item.field !== null && typeof item.field !== 'string')) {
      issues.push({ code: 'CANDIDATE_SHAPE_INVALID', rowId, field: 'blockers' });
    }
  });
  const expected = statusFor(
    value.blockers as readonly MenokinCandidateBlocker[],
    value.pendingConfirmations as readonly MenokinPendingCode[],
  );
  if (value.maintenanceStatus !== expected) {
    issues.push({ code: 'MAINTENANCE_STATUS_MISMATCH', rowId: value.id, field: 'maintenanceStatus' });
  }
  return true;
}

const tableCountsFor = (tables: MenokinSopCandidateTables): Readonly<Record<MenokinSopTableName, number>> => ({
  场景目录: tables.scenarioDirectory.rows.length,
  执行任务: tables.executionTasks.rows.length,
  判断分支: tables.decisionBranches.rows.length,
  客户话术: tables.customerScripts.rows.length,
  知识与案例: tables.knowledgeCases.rows.length,
  资源与图片: tables.resourcesImages.rows.length,
});

/**
 * Pure validation of the candidate boundary. The candidate is ready only when
 * shape, identity, graph, D/E, allergy and blocker invariants all hold.
 */
export function validateMenokinSopCandidate(value: unknown): MenokinSopValidationReport {
  const issues: MenokinSopValidationIssue[] = [];
  const invalid = (): MenokinSopValidationReport => ({ ok: false, ready: false, status: 'invalid', issues, tableRowCounts: null });
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'severityOrder', 'sourceSha256', 'tables', 'blockers'])
    || value.schemaVersion !== MENOKIN_SOP_CANDIDATE_VERSION
    || !Array.isArray(value.severityOrder)
    || value.severityOrder.length !== MENOKIN_SOP_SEVERITY_ORDER.length
    || !value.severityOrder.every((item, index) => item === MENOKIN_SOP_SEVERITY_ORDER[index])
    || !sourceSha(value.sourceSha256)
    || !Array.isArray(value.blockers)
    || !record(value.tables)
    || !exactKeys(value.tables, ['scenarioDirectory', 'executionTasks', 'decisionBranches', 'customerScripts', 'knowledgeCases', 'resourcesImages'])) {
    issues.push({ code: 'CANDIDATE_SHAPE_INVALID', rowId: null, field: 'candidate' });
    return invalid();
  }

  const tables = value.tables;
  const tableEntries = [
    ['scenarioDirectory', '场景目录', 'scenarios', [
      'id', 'sourceRefs', 'maintenanceStatus', 'pendingConfirmations', 'blockers', 'group', 'label', 'severityRank',
    ]],
    ['executionTasks', '执行任务', 'executions', [
      'id', 'sourceRefs', 'maintenanceStatus', 'pendingConfirmations', 'blockers', 'nodeKey', 'nodeType', 'stepNumber', 'title', 'body',
    ]],
    ['decisionBranches', '判断分支', 'branches', [
      'id', 'sourceRefs', 'maintenanceStatus', 'pendingConfirmations', 'blockers',
      'fromExecutionId', 'targetExecutionId', 'fromNodeKey', 'targetNodeKey', 'condition',
    ]],
    ['customerScripts', '客户话术', 'scripts', [
      'id', 'sourceRefs', 'maintenanceStatus', 'pendingConfirmations', 'blockers',
      'kind', 'targetExecutionId', 'targetNodeKey', 'text', 'riskLevel',
    ]],
    ['knowledgeCases', '知识与案例', 'knowledge', [
      'id', 'sourceRefs', 'maintenanceStatus', 'pendingConfirmations', 'blockers',
      'kind', 'key', 'text', 'targetExecutionId', 'targetNodeKey',
    ]],
    ['resourcesImages', '资源与图片', 'resources', [
      'id', 'sourceRefs', 'maintenanceStatus', 'pendingConfirmations', 'blockers',
      'referenceKind', 'columnNumber', 'contentSha256', 'referenceHash', 'mime', 'bytes',
      'targetExecutionId', 'targetNodeKey',
    ]],
  ] as const;

  for (const [key, expectedName, , rowKeys] of tableEntries) {
    const table = tables[key];
    if (!record(table) || !exactKeys(table, ['tableName', 'rows'])
      || table.tableName !== expectedName || !Array.isArray(table.rows)) {
      return invalid();
    }
    table.rows.forEach((row) => validateCandidateBase(row, expectedName, rowKeys, issues));
  }
  if (issues.length > 0) return invalid();

  const candidateTables = tables as unknown as MenokinSopCandidateTables;
  const scenarios = candidateTables.scenarioDirectory.rows;
  const executions = candidateTables.executionTasks.rows;
  const branches = candidateTables.decisionBranches.rows;
  const scripts = candidateTables.customerScripts.rows;
  const knowledge = candidateTables.knowledgeCases.rows;
  const resources = candidateTables.resourcesImages.rows;

  const scenarioGroups: MenokinSopGroup[] = [];
  scenarios.forEach((row) => {
    if (!group(row.group) || row.label !== row.group || !Number.isSafeInteger(row.severityRank)
      || row.severityRank !== MENOKIN_SOP_SEVERITY_ORDER.indexOf(row.group)) {
      issues.push({ code: 'SCENARIO_GROUP_MISMATCH', rowId: row.id, field: 'scenario' });
    }
    scenarioGroups.push(row.group);
    if (!row.sourceRefs.every((source) => source.sheetName === row.group
      && source.sourceSha256 === value.sourceSha256)) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
  });
  const expectedScenarioOrder = [...new Set(scenarioGroups)]
    .sort((left, right) => MENOKIN_SOP_SEVERITY_ORDER.indexOf(left) - MENOKIN_SOP_SEVERITY_ORDER.indexOf(right));
  if (scenarioGroups.length !== expectedScenarioOrder.length
    || scenarioGroups.some((name, index) => name !== expectedScenarioOrder[index])) {
    issues.push({ code: 'SCENARIO_ORDER_MISMATCH', rowId: null, field: 'scenarioDirectory' });
  }
  executions.forEach((row) => {
    if (!nullableNodeKey(row.nodeKey)
      || !['execution', 'terminal', 'unresolved'].includes(row.nodeType)
      || !safeIntegerOrNull(row.stepNumber)
      || !nullableText(row.title)
      || !nullableText(row.body)) {
      issues.push({ code: 'NODE_TYPE_UNRESOLVED', rowId: row.id, field: 'execution' });
    }
    if (!row.sourceRefs.every((source) => source.sourceSha256 === value.sourceSha256)) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
  });
  branches.forEach((row) => {
    if ((row.fromExecutionId !== null && typeof row.fromExecutionId !== 'string')
      || (row.targetExecutionId !== null && typeof row.targetExecutionId !== 'string')
      || !nullableNodeKey(row.fromNodeKey)
      || !nullableNodeKey(row.targetNodeKey)
      || !text(row.condition)) {
      issues.push({ code: 'BRANCH_TARGET_MISSING', rowId: row.id, field: 'branch' });
    }
  });
  scripts.forEach((row) => {
    if (row.kind !== 'answer'
      || (row.targetExecutionId !== null && typeof row.targetExecutionId !== 'string')
      || !nullableNodeKey(row.targetNodeKey)
      || !text(row.text)
      || !['routine', 'sensitive', 'unresolved'].includes(row.riskLevel)) {
      issues.push({ code: 'NODE_TYPE_UNRESOLVED', rowId: row.id, field: 'script' });
    }
  });
  knowledge.forEach((row) => {
    if (!['field', 'quick_phrase', 'knowledge', 'case'].includes(row.kind)
      || typeof row.key !== 'string' || !KEY.test(row.key)
      || !text(row.text)
      || (row.targetExecutionId !== null && typeof row.targetExecutionId !== 'string')
      || !nullableNodeKey(row.targetNodeKey)) {
      issues.push({ code: 'MAINTENANCE_STATUS_MISMATCH', rowId: row.id, field: 'knowledge' });
    }
  });
  resources.forEach((row) => {
    if (!['embedded', 'external'].includes(row.referenceKind)
      || !safePositiveInteger(row.columnNumber)
      || (row.contentSha256 !== null && !sourceSha(row.contentSha256))
      || (row.referenceHash !== null && !sourceSha(row.referenceHash))
      || (row.mime !== null && !['image/png', 'image/jpeg', 'image/gif'].includes(row.mime))
      || (row.bytes !== null && !safePositiveInteger(row.bytes))
      || (row.targetExecutionId !== null && typeof row.targetExecutionId !== 'string')
      || !nullableNodeKey(row.targetNodeKey)
      || (row.referenceKind === 'embedded' && (row.contentSha256 === null || row.referenceHash !== null
        || row.mime === null || row.bytes === null))
      || (row.referenceKind === 'external' && (row.referenceHash === null || row.contentSha256 !== null
        || row.mime !== null || row.bytes !== null))) {
      issues.push({ code: 'MEDIA_BINDING_UNRESOLVED', rowId: row.id, field: 'resource' });
    }
  });
  if (issues.length > 0) return invalid();

  const allRows = [...scenarios, ...executions, ...branches, ...scripts, ...knowledge, ...resources];
  const allIds = new Set<string>();
  allRows.forEach((row) => {
    if (allIds.has(row.id)) issues.push({ code: 'DUPLICATE_ROW_ID', rowId: row.id, field: 'id' });
    allIds.add(row.id);
  });

  const executionById = new Map(executions.map((row) => [row.id, row]));
  const executionByKey = new Map<string, Readonly<{
    nodeKey: string;
    groupName: MenokinSopGroup;
    rows: readonly MenokinExecutionRow[];
  }>>();
  executions.forEach((row) => {
    if (row.nodeKey === null) return;
    const groupName = row.sourceRefs[0]!.sheetName;
    const key = nodeScopeKey(groupName, row.nodeKey);
    const current = executionByKey.get(key);
    executionByKey.set(key, {
      nodeKey: row.nodeKey,
      groupName,
      rows: [...(current?.rows ?? []), row],
    });
  });
  executionByKey.forEach(({ nodeKey, groupName, rows: rowsForKey }) => {
    if (rowsForKey.length > 1) issues.push({ code: 'NODE_KEY_CONFLICT', rowId: rowsForKey[0]!.id, field: `${groupName}:${nodeKey}` });
    rowsForKey.forEach((row) => {
      const expected = expectedNodeType(nodeKey);
      if (expected === null || row.nodeType !== expected) {
        issues.push({ code: 'NODE_TYPE_UNRESOLVED', rowId: row.id, field: 'nodeType' });
      }
      if (expected === 'execution' && row.stepNumber !== MENOKIN_SOP_EXECUTION_STEP) {
        issues.push({ code: 'EXECUTION_STEP_CONFLICT', rowId: row.id, field: 'stepNumber' });
      }
    });
  });
  executions.filter((row) => row.nodeKey === null || row.nodeType === 'unresolved').forEach((row) => {
    issues.push({ code: 'NODE_TYPE_UNRESOLVED', rowId: row.id, field: 'nodeType' });
  });

  branches.forEach((row) => {
    if (!row.sourceRefs.every((source) => source.sourceSha256 === value.sourceSha256)) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    if (row.fromExecutionId === null || !executionById.has(row.fromExecutionId)) {
      issues.push({ code: 'BRANCH_TARGET_MISSING', rowId: row.id, field: 'fromExecutionId' });
    }
    if (row.targetExecutionId === null || !executionById.has(row.targetExecutionId)) {
      issues.push({ code: 'BRANCH_TARGET_MISSING', rowId: row.id, field: 'targetExecutionId' });
    }
    const from = row.fromExecutionId === null ? undefined : executionById.get(row.fromExecutionId);
    const target = row.targetExecutionId === null ? undefined : executionById.get(row.targetExecutionId);
    if (from && row.fromNodeKey !== from.nodeKey) {
      issues.push({ code: 'NODE_REFERENCE_MISMATCH', rowId: row.id, field: 'fromNodeKey' });
    }
    if (target && row.targetNodeKey !== target.nodeKey) {
      issues.push({ code: 'NODE_REFERENCE_MISMATCH', rowId: row.id, field: 'targetNodeKey' });
    }
    const branchGroup = row.sourceRefs[0]?.sheetName;
    if (from && branchGroup !== from.sourceRefs[0]?.sheetName) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    if (target && branchGroup !== target.sourceRefs[0]?.sheetName) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    if (from && (from.nodeType === 'terminal' || (from.nodeKey !== null && TERMINAL_KEY_SET.has(from.nodeKey)))) {
      issues.push({ code: 'TERMINAL_HAS_OUTGOING_EDGE', rowId: from.id, field: 'targetExecutionId' });
    }
  });

  scripts.forEach((row) => {
    if (!row.sourceRefs.every((source) => source.sourceSha256 === value.sourceSha256)) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    if (row.riskLevel === 'unresolved') issues.push({ code: 'SCRIPT_RISK_UNRESOLVED', rowId: row.id, field: 'riskLevel' });
    const target = row.targetExecutionId === null ? undefined : executionById.get(row.targetExecutionId);
    if (!target) {
      issues.push({ code: 'BRANCH_TARGET_MISSING', rowId: row.id, field: 'targetExecutionId' });
    }
    if (target && target.nodeKey !== row.targetNodeKey) {
      issues.push({ code: 'NODE_REFERENCE_MISMATCH', rowId: row.id, field: 'targetNodeKey' });
    }
    if (target && row.sourceRefs[0]?.sheetName !== target.sourceRefs[0]?.sheetName) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    if (!requiredContext(row.text)) issues.push({ code: 'ALLERGY_REQUIRED_CONTEXT', rowId: row.id, field: 'text' });
  });
  knowledge.filter((row) => !requiredContext(row.text)).forEach((row) => {
    issues.push({ code: 'ALLERGY_REQUIRED_CONTEXT', rowId: row.id, field: 'text' });
  });
  executions.filter((row) => (row.title?.includes('过敏') || row.body?.includes('过敏'))
    && (!row.body || !row.body.includes('停手') || !row.body.includes('确认'))).forEach((row) => {
    issues.push({ code: 'ALLERGY_REQUIRED_CONTEXT', rowId: row.id, field: 'body' });
  });
  knowledge.forEach((row) => {
    if (!row.sourceRefs.every((source) => source.sourceSha256 === value.sourceSha256)) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    const target = row.targetExecutionId === null ? undefined : executionById.get(row.targetExecutionId);
    if (target && target.nodeKey !== row.targetNodeKey) {
      issues.push({ code: 'NODE_REFERENCE_MISMATCH', rowId: row.id, field: 'targetNodeKey' });
    }
    if (target && row.sourceRefs[0]?.sheetName !== target.sourceRefs[0]?.sheetName) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
  });
  resources.forEach((row) => {
    if (!row.sourceRefs.every((source) => source.sourceSha256 === value.sourceSha256)) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    const target = row.targetExecutionId === null ? undefined : executionById.get(row.targetExecutionId);
    if (!target || target.nodeKey !== row.targetNodeKey) {
      issues.push({ code: 'MEDIA_BINDING_UNRESOLVED', rowId: row.id, field: 'targetExecutionId' });
    }
    if (target && row.sourceRefs[0]?.sheetName !== target.sourceRefs[0]?.sheetName) {
      issues.push({ code: 'SOURCE_BINDING_MISMATCH', rowId: row.id, field: 'sourceRefs' });
    }
    if (row.referenceKind === 'external'
      && !row.blockers.some((item) => item.code === 'MEDIA_EXTERNAL_REFERENCE')) {
      issues.push({ code: 'MEDIA_BINDING_UNRESOLVED', rowId: row.id, field: 'blockers' });
    }
  });

  const graph = validateMenokinSopGraph({
    schemaVersion: value.schemaVersion,
    severityOrder: MENOKIN_SOP_SEVERITY_ORDER,
    sourceSha256: value.sourceSha256,
    tables: candidateTables,
    blockers: value.blockers as readonly MenokinCandidateBlocker[],
  });
  if (!graph.ok) issues.push({ code: 'GRAPH_INVALID', rowId: null, field: 'graph' });

  value.blockers.forEach((item) => {
    if (!record(item) || !exactKeys(item, ['code', 'tableName', 'rowId', 'field'])
      || !BLOCKER_CODE_SET.has(String(item.code))
      || !MENOKIN_SOP_TABLE_NAMES.includes(item.tableName as MenokinSopTableName)
      || typeof item.rowId !== 'string'
      || (item.field !== null && typeof item.field !== 'string')) {
      issues.push({ code: 'CANDIDATE_SHAPE_INVALID', rowId: null, field: 'blockers' });
    }
  });
  const rowBlockers = allRows.flatMap((row) => row.blockers);
  const expectedBlockers = sortBlockers(rowBlockers);
  const actualBlockers = sortBlockers(value.blockers as readonly MenokinCandidateBlocker[]);
  if (JSON.stringify(actualBlockers) !== JSON.stringify(expectedBlockers)) {
    issues.push({ code: 'BLOCKERS_PRESENT', rowId: null, field: 'blockers' });
  }
  if (actualBlockers.length > 0) issues.push({ code: 'BLOCKERS_PRESENT', rowId: null, field: 'blockers' });

  const allPending = allRows.some((row) => row.pendingConfirmations.length > 0);
  scripts.filter((row) => row.riskLevel === 'sensitive'
    && !row.pendingConfirmations.includes('SCRIPT_RISK_REVIEW')).forEach((row) => {
    issues.push({ code: 'SENSITIVE_SCRIPT_NOT_CONFIRMED', rowId: row.id, field: 'pendingConfirmations' });
  });
  const hasBlockingIssue = issues.some((issue) => issue.code !== 'SENSITIVE_SCRIPT_NOT_CONFIRMED');
  const ok = !hasBlockingIssue && actualBlockers.length === 0;
  const needsConfirmation = allPending || scripts.some((row) => row.riskLevel === 'sensitive');
  const status: MenokinSopValidationReport['status'] = ok
    ? (needsConfirmation ? 'needs_confirmation' : 'ready')
    : 'blocked';
  return {
    ok,
    ready: status === 'ready',
    status,
    issues,
    tableRowCounts: tableCountsFor(candidateTables),
  };
}

/** Stable summary suitable for decision replay and later release-graph input. */
export function createMenokinSopDecisionSummary(value: unknown): MenokinSopDecisionSummary | null {
  const validation = validateMenokinSopCandidate(value);
  if (validation.status === 'invalid' || !record(value) || !record(value.tables)) return null;
  const candidate = value as MenokinSopCandidate;
  const tableRows = [
    ['场景目录', candidate.tables.scenarioDirectory.rows.map((row) => row.id)],
    ['执行任务', candidate.tables.executionTasks.rows.map((row) => row.id)],
    ['判断分支', candidate.tables.decisionBranches.rows.map((row) => row.id)],
    ['客户话术', candidate.tables.customerScripts.rows.map((row) => row.id)],
    ['知识与案例', candidate.tables.knowledgeCases.rows.map((row) => row.id)],
    ['资源与图片', candidate.tables.resourcesImages.rows.map((row) => row.id)],
  ] as const;
  return {
    schemaVersion: candidate.schemaVersion,
    status: validation.status,
    ready: validation.ready,
    tableRows: tableRows.map(([tableName, rowIds]) => ({
      tableName,
      rowIds: [...rowIds].sort(),
    })),
    blockerCodes: [...new Set(candidate.blockers.map((item) => item.code))].sort(),
  };
}

export function serializeMenokinSopDecisionSummary(value: unknown): string | null {
  const summary = createMenokinSopDecisionSummary(value);
  return summary === null ? null : JSON.stringify(summary);
}
