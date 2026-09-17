export type SopCopyResult =
  | { ok: true }
  | { ok: false; message: string };

export const SOP_WINDOW_ERROR_CODES = [
  'INVALID',
  'UNAVAILABLE',
  'FAILED',
  'SOP_LOAD_FAILED',
  'SOP_LAYOUT_TIMEOUT',
  'SOP_FIXTURE_MISSING',
] as const;

export type SopWindowErrorCode = (typeof SOP_WINDOW_ERROR_CODES)[number];

export type SopWindowResult =
  | { ok: true }
  | { ok: false; code: SopWindowErrorCode; message: string };

export type SopNodeKind = 'copyable' | 'decision' | 'internal';
export type SopShellState = 'opening' | 'ready' | 'failed';

export type SopProjectedEdge = Readonly<{
  id: string;
  label: string;
}>;

export type SopProjectedScript = Readonly<{
  scriptId: string;
  domain: '售后';
  questionVariants: readonly string[];
  answerText: string;
  platform: string;
  scopeLabel: string;
  riskLevel: 'low' | 'medium' | 'high';
  effectiveFrom: string;
  effectiveTo: string;
  rank: 1;
  score: 0;
  matchKind: 'exact';
  matchLabel: string;
}>;

export type SopProjection = Readonly<{
  sceneId: string;
  sceneTitle: string;
  stageLabel: string;
  stepIndex: number;
  sessionId: number;
  demo: true;
  shellState: SopShellState;
  nodeKind: SopNodeKind | 'opening';
  highRiskBanner: string;
  prompt: string;
  internalNote: string | null;
  internalTask: string | null;
  script: SopProjectedScript | null;
  unpublished: boolean;
  edges: readonly SopProjectedEdge[];
  canNext: boolean;
  terminal: boolean;
  copied: boolean;
  failCode: SopWindowErrorCode | null;
  failMessage: string | null;
}>;

export type SopLayoutRequest = {
  sessionId: number;
  sequence: number;
  desiredHeight: number;
};

export type SopLayoutAck = {
  ok: boolean;
  sessionId: number;
  sequence: number;
  height: number;
};

export type SopWindowApi = {
  close(): Promise<void>;
  endFlow(): Promise<void>;
  restart(): Promise<void>;
  chooseEdge(edgeId: string): Promise<SopWindowResult>;
  nextStep(): Promise<SopWindowResult>;
  moveBy(dx: number, dy: number, finished?: boolean): Promise<void>;
  reportLayout(request: SopLayoutRequest): Promise<SopLayoutAck>;
  copyCurrent(): Promise<SopCopyResult>;
  onProjection(cb: (projection: SopProjection) => void): () => void;
};

export type QuerySopWindowApi = {
  open(sceneId: string): Promise<SopWindowResult>;
  entryAvailable(): Promise<boolean>;
  resumeAvailable(): Promise<boolean>;
};

const SOP_LAYOUT_KEYS = ['sessionId', 'sequence', 'desiredHeight'] as const;
const SOP_LAYOUT_ACK_KEYS = ['ok', 'sessionId', 'sequence', 'height'] as const;
const SOP_PROJECTION_KEYS = [
  'sceneId',
  'sceneTitle',
  'stageLabel',
  'stepIndex',
  'sessionId',
  'demo',
  'shellState',
  'nodeKind',
  'highRiskBanner',
  'prompt',
  'internalNote',
  'internalTask',
  'script',
  'unpublished',
  'edges',
  'canNext',
  'terminal',
  'copied',
  'failCode',
  'failMessage',
] as const;

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isSafePositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function sopWindowFailure(
  code: SopWindowErrorCode,
  message: string,
): Extract<SopWindowResult, { ok: false }> {
  return { ok: false, code, message };
}

export function isSopWindowResult(value: unknown): value is SopWindowResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    return Object.keys(record).length === 1;
  }
  return (
    record.ok === false
    && typeof record.code === 'string'
    && SOP_WINDOW_ERROR_CODES.includes(record.code as SopWindowErrorCode)
    && typeof record.message === 'string'
    && Object.keys(record).length === 3
  );
}

export function isSopLayoutRequest(value: unknown): value is SopLayoutRequest {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, SOP_LAYOUT_KEYS)) {
    return false;
  }
  const record = value as Partial<SopLayoutRequest>;
  return (
    isSafePositiveInt(record.sessionId)
    && isSafePositiveInt(record.sequence)
    && typeof record.desiredHeight === 'number'
    && Number.isFinite(record.desiredHeight)
  );
}

export function isSopLayoutAck(value: unknown): value is SopLayoutAck {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, SOP_LAYOUT_ACK_KEYS)) {
    return false;
  }
  const record = value as Partial<SopLayoutAck>;
  return (
    typeof record.ok === 'boolean'
    && typeof record.sessionId === 'number'
    && Number.isSafeInteger(record.sessionId)
    && record.sessionId >= 0
    && typeof record.sequence === 'number'
    && Number.isSafeInteger(record.sequence)
    && record.sequence >= 0
    && typeof record.height === 'number'
    && Number.isSafeInteger(record.height)
    && record.height > 0
    && record.height <= 4096
  );
}

export function rejectedSopLayoutAck(sessionId = 0, sequence = 0, height = 240): SopLayoutAck {
  return { ok: false, sessionId, sequence, height };
}

function isProjectedEdge(value: unknown): value is SopProjectedEdge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<SopProjectedEdge>;
  return isNonEmptyString(record.id) && isNonEmptyString(record.label);
}

function isProjectedScript(value: unknown): value is SopProjectedScript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<SopProjectedScript>;
  return (
    isNonEmptyString(record.scriptId)
    && record.domain === '售后'
    && Array.isArray(record.questionVariants)
    && isNonEmptyString(record.answerText)
    && isNonEmptyString(record.platform)
    && isNonEmptyString(record.scopeLabel)
    && (record.riskLevel === 'low' || record.riskLevel === 'medium' || record.riskLevel === 'high')
    && isNonEmptyString(record.effectiveFrom)
    && isNonEmptyString(record.effectiveTo)
    && record.rank === 1
    && record.score === 0
    && record.matchKind === 'exact'
    && isNonEmptyString(record.matchLabel)
    && !('productCopy' in record)
  );
}

export function isSopProjection(value: unknown): value is SopProjection {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, SOP_PROJECTION_KEYS)) {
    return false;
  }
  const record = value as Partial<SopProjection>;
  const nodeKindOk =
    record.nodeKind === 'copyable'
    || record.nodeKind === 'decision'
    || record.nodeKind === 'internal'
    || record.nodeKind === 'opening';
  const shellOk =
    record.shellState === 'opening'
    || record.shellState === 'ready'
    || record.shellState === 'failed';
  const failCodeOk =
    record.failCode === null
    || (typeof record.failCode === 'string'
      && SOP_WINDOW_ERROR_CODES.includes(record.failCode as SopWindowErrorCode));
  return (
    isNonEmptyString(record.sceneId)
    && isNonEmptyString(record.sceneTitle)
    && isNonEmptyString(record.stageLabel)
    && isSafePositiveInt(record.stepIndex)
    && isSafePositiveInt(record.sessionId)
    && record.demo === true
    && shellOk
    && nodeKindOk
    && typeof record.highRiskBanner === 'string'
    && typeof record.prompt === 'string'
    && (record.internalNote === null || typeof record.internalNote === 'string')
    && (record.internalTask === null || typeof record.internalTask === 'string')
    && (record.script === null || isProjectedScript(record.script))
    && (record.unpublished === true || record.unpublished === false)
    && Array.isArray(record.edges)
    && record.edges.length <= 4
    && record.edges.every(isProjectedEdge)
    && typeof record.canNext === 'boolean'
    && typeof record.terminal === 'boolean'
    && typeof record.copied === 'boolean'
    && failCodeOk
    && (record.failMessage === null || typeof record.failMessage === 'string')
  );
}

export const SOP_HIGH_RISK_BANNER = '本步只给话术，不建单、不指令仓配';
export const SOP_INTERNAL_NOTE_PREFIX = '内部说明 · 不要发给客户';
export const SOP_OPENING_MESSAGE = '正在打开过敏流程';
export const SOP_OPEN_FAILURE_MESSAGE = '过敏流程没打开';
export const SOP_ENTRY_HINT = '过敏可走售后流程 · 建议先要凭证';
export const SOP_ENTRY_BUTTON = '打开过敏售后流程';
export const SOP_RESUME_BUTTON = '继续过敏售后流程';
export const SOP_TERMINAL_MESSAGE = '本流程没有下一步';
export const SOP_UNPUBLISHED_MESSAGE = '该话术尚未发布';
export const SOP_END_FLOW_LABEL = '结束并清除进度';
