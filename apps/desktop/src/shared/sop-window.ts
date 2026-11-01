import type { QuerySopNavigation, QuerySopPresentation, QuerySopWindowIntent } from './query-sop-window';

export type SopCopyResult =
  | (Readonly<{ ok: true; source: QuerySopRevision; sourceTitle: string; copyGeneration: number }> & (
    | Readonly<{ outcome: 'copied-advanced' }>
    | Readonly<{ outcome: 'copied-stayed'; reason: 'requirements' | 'decision' | 'terminal' }>
  ))
  | Readonly<{ ok: false; message: string }>;
export const MAX_SOP_TASKS = 8;
export const MAX_SOP_DISPLAY_NAME_LENGTH = 20;
export type SopTaskSummary = Readonly<{ taskId: string; ordinal: number; displayName: string | null; revision: number; sceneId: string; sceneTitle: string; taskTitle: string; stepIndex: number; waiting: 'customer' | 'internal' | null }>;
export type QuerySopSnapshot =
  | (Readonly<{ kind: 'ready'; sequence: number; copyGeneration: number; tasks: readonly SopTaskSummary[]; mode: 'query' | 'floating' }> & Omit<QuerySopPresentation, 'view'> & (
    | Readonly<{ view: { kind: 'sop'; taskId: string }; projection: SopProjection; access: Exclude<SopAccess, {kind:'none'}> }>
    | Readonly<{ view: { kind: 'query-home' | 'query-results' }; projection: null; access: {kind:'none'} }>
  ))
  | Readonly<{ kind: 'unavailable'; message: string }>;
export type SopFloatingSnapshot =
  | (Extract<QuerySopSnapshot, { kind: 'ready' }> & Readonly<{ seenActiveTaskIds: readonly string[]; collapsed: boolean }>)
  | Extract<QuerySopSnapshot, { kind: 'unavailable' }>;
export const SOP_UNAVAILABLE: Extract<QuerySopSnapshot, { kind: 'unavailable' }> = { kind: 'unavailable', message: '无法读取流程进度，请重新读取' };
export const SOP_WINDOW_ERROR_CODES = ['INVALID', 'UNAVAILABLE', 'FAILED'] as const;
export type SopWindowErrorCode = (typeof SOP_WINDOW_ERROR_CODES)[number];
export type SopWindowResult = { ok: true } | { ok: false; code: SopWindowErrorCode; message: string };
export type SopNodeKind = 'action' | 'decision' | 'terminal';
/** Only bounded, self-contained raster images belong in a synthetic SOP projection. */
export type SopImage = Readonly<{ alt: string; dataUrl: string }>;
export type SopProjectedEdge = Readonly<{ id: string; label: string; criterion: string; matchTerms: readonly string[] }>;
export type SopProjectedScript =
  | Readonly<{ scriptId: string; unpublished: true; images: readonly [] }>
  | Readonly<{ scriptId: string; unpublished: false; title: string; answerText: string; condition: string; images: readonly SopImage[] }>;
export type SopManualImageProjection = Readonly<{
  sceneId: string; nodeId: string; images: readonly SopImage[];
  scripts: readonly Readonly<{ scriptId: string; images: readonly SopImage[] }>[];
  knowledge: readonly Readonly<{ id: string; images: readonly SopImage[] }>[];
}>;
export type SopProjection = Readonly<{
  sceneId: string; sceneTitle: string; version: string; stageLabel: string;
  taskTitle: string; nodeId: string; stepIndex: number; taskId: string; revision: number; demo: true;
  nodeKind: SopNodeKind; prompt: string; images: readonly SopImage[];
  internalNote: string | null;
  scripts: readonly SopProjectedScript[]; selectedScriptId: string | null;
  requirements: readonly Readonly<{ id: string; label: string; checked: boolean }>[];
  knowledge: readonly Readonly<{ id: string; title: string; body: string; images: readonly SopImage[] }>[];
  history: readonly Readonly<{ stepIndex: number; nodeId: string; title: string; instruction: string; choiceLabel: string | null; confirmedRequirements: readonly string[] }>[];
  waiting: 'customer' | 'internal' | null;
  edges: readonly SopProjectedEdge[]; canNext: boolean; canChoose: boolean; terminal: boolean; copied: boolean;
}>;
export type QuerySopRevision = Readonly<{ taskId: string; revision: number; stepIndex: number }>;
export type QuerySopCopyRequest = QuerySopRevision & Readonly<{ scriptId: string }>;
export type SopProjectionUpdate = QuerySopSnapshot;
export type QuerySopCommand = QuerySopRevision & (
  | { [Kind in 'next' | 'end' | 'restart' | 'resume']: { type: Kind } }['next' | 'end' | 'restart' | 'resume']
  | { type: 'choose'; edgeId: string }
  | { type: 'select-script'; scriptId: string }
  | { type: 'check'; requirementId: string; checked: boolean }
  | { type: 'wait'; reason: 'customer' | 'internal' }
  | { type: 'rewind'; targetStepIndex: number }
);
export type SopAccess = { kind: 'none' } | { kind: 'preview'; mountId: number } | { kind: 'executable'; hostEpoch: number };
export type SopExecutionCommand = QuerySopCommand & { hostEpoch: number };
export type SopExecutionCopy = QuerySopCopyRequest & { hostEpoch: number };
export type SopRenameRequest = { taskId: string; revision: number; displayName: string | null };
export type SopExecutionRename = SopRenameRequest & { hostEpoch: number };
export type SopReadyRequest = { mountId: number };
export type SopDraft = Readonly<{ draftId: number; revision: number; initialName: string | null; value: string; sequence: number }>;
export type SopDraftIdentity = Readonly<{ taskId: string; hostEpoch: number }>;
export type SopDraftStart = SopDraftIdentity & Readonly<{ revision: number }>;
export type SopDraftUpdate = SopDraftIdentity & Readonly<{ draftId: number; sequence: number; value: string }>;
export type SopDraftDiscard = SopDraftIdentity & Readonly<{ draftId: number }>;
export type SopDraftResult = Readonly<{ ok: true; draft: SopDraft | null }> | Readonly<{ ok: false }>;
export type SopShowQueryRequest = Readonly<{ requestId: number; taskId: string; hostEpoch: number }>;
export type SopShowQueryReady = SopShowQueryRequest & Readonly<{ accepted: boolean }>;
export type SopFloatingApi = {
  current(): Promise<SopFloatingSnapshot>;
  ready(request: SopReadyRequest): Promise<boolean>;
  command(request: SopExecutionCommand): Promise<SopWindowResult>;
  copyCurrent(request: SopExecutionCopy): Promise<SopCopyResult>;
  renameCurrent(request: SopExecutionRename): Promise<SopWindowResult>;
  draftCurrent?(request: SopDraftIdentity): Promise<SopDraftResult>;
  draftStart?(request: SopDraftStart): Promise<SopDraftResult>;
  draftUpdate?(request: SopDraftUpdate): Promise<boolean>;
  draftDiscard?(request: SopDraftDiscard): Promise<boolean>;
  windowIntent(request: QuerySopWindowIntent): Promise<boolean>;
  onProjection(cb: (update: SopFloatingSnapshot) => void): () => void;
};
export type QuerySopWindowApi = {
  ready?(request: SopReadyRequest): Promise<boolean>;
  endTask?(request: QuerySopRevision): Promise<SopWindowResult>;
  rename?(request: SopRenameRequest): Promise<SopWindowResult>;
  renameCurrent?(request: SopExecutionRename): Promise<SopWindowResult>;
  draftCurrent?(request: SopDraftIdentity): Promise<SopDraftResult>;
  draftStart?(request: SopDraftStart): Promise<SopDraftResult>;
  draftUpdate?(request: SopDraftUpdate): Promise<boolean>;
  draftDiscard?(request: SopDraftDiscard): Promise<boolean>;
  onShowQueryRequest?(callback: (request: SopShowQueryRequest) => void): () => void;
  showQueryReady?(request: SopShowQueryReady): Promise<boolean>;
  windowIntent?(request: QuerySopWindowIntent): Promise<boolean>;
  command?(request: SopExecutionCommand): Promise<SopWindowResult>;
  current?(): Promise<QuerySopSnapshot>;
  navigate?(request: QuerySopNavigation): Promise<SopWindowResult>;
  copyCurrent?(expected: SopExecutionCopy): Promise<SopCopyResult>;
  onProjection?(cb: (update: SopProjectionUpdate) => void): () => void;
  open(sceneId: string): Promise<SopWindowResult>;
  entryAvailable(): Promise<boolean>;
  resumeAvailable(): Promise<boolean>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const id = (value: unknown): value is string => text(value) && value.length <= 128 && value.trim() === value;

// These limits bound the offline fixture projection; they are not the P4b media contract.
const MAX_SYNTHETIC_SOP_IMAGE_DATA_URL = 128 * 1024;
export const MAX_SYNTHETIC_SOP_IMAGE_TOTAL = 1024 * 1024;
const MAX_SYNTHETIC_SOP_IMAGE_DIMENSION = 2048;
const MAX_SYNTHETIC_SOP_IMAGE_PIXELS = 1024 * 1024;
const IMAGE_URL = /^data:image\/(png|jpeg|gif);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/;

function imageDimensions(format: string, bytes: string): readonly [number, number] | null {
  const byte = (index: number) => bytes.charCodeAt(index);
  const be16 = (index: number) => byte(index) * 256 + byte(index + 1);
  const be32 = (index: number) => be16(index) * 65536 + be16(index + 2);
  if (format === 'png') {
    if (bytes.length < 45 || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n'
      || be32(8) !== 13 || bytes.slice(12, 16) !== 'IHDR') return null;
    let offset = 8, hasData = false;
    while (offset + 12 <= bytes.length) {
      const length = be32(offset), kind = bytes.slice(offset + 4, offset + 8);
      if (length > bytes.length - offset - 12 || ['acTL', 'fcTL', 'fdAT'].includes(kind)) return null;
      if (kind === 'IDAT') hasData = true;
      offset += length + 12;
      if (kind === 'IEND') return hasData && length === 0 && offset === bytes.length ? [be32(16), be32(20)] : null;
    }
    return null;
  }
  if (format === 'gif') {
    if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.slice(0, 6))) return null;
    const le16 = (index: number) => byte(index) + byte(index + 1) * 256;
    const width = le16(6), height = le16(8);
    let offset = 13 + (byte(10) & 0x80 ? 3 * 2 ** ((byte(10) & 7) + 1) : 0);
    let frames = 0;
    const skipBlocks = (): boolean => {
      while (offset < bytes.length) {
        const length = byte(offset++);
        if (length === 0) return true;
        if (offset + length > bytes.length) return false;
        offset += length;
      }
      return false;
    };
    while (offset < bytes.length) {
      const marker = byte(offset++);
      if (marker === 0x3b) return frames === 1 && offset === bytes.length ? [width, height] : null;
      if (marker === 0x21) {
        if (offset >= bytes.length) return null;
        offset += 1;
        if (!skipBlocks()) return null;
      } else if (marker === 0x2c) {
        if (offset + 9 > bytes.length || ++frames > 1) return null;
        const left = le16(offset), top = le16(offset + 2), frameWidth = le16(offset + 4), frameHeight = le16(offset + 6), packed = byte(offset + 8);
        if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) return null;
        offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
        if (offset >= bytes.length || byte(offset) < 2 || byte(offset) > 8) return null;
        offset += 1;
        if (!skipBlocks()) return null;
      } else return null;
    }
    return null;
  }
  if (format !== 'jpeg' || bytes.length < 12 || byte(0) !== 0xff || byte(1) !== 0xd8
    || byte(bytes.length - 2) !== 0xff || byte(bytes.length - 1) !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (byte(offset) !== 0xff) return null;
    while (byte(offset) === 0xff) offset += 1;
    const marker = byte(offset++);
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = be16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return null;
      return [be16(offset + 5), be16(offset + 3)];
    }
    offset += length;
  }
  return null;
}

export function isSyntheticSopImage(value: unknown): value is SopImage {
  if (!record(value) || !keys(value, ['alt', 'dataUrl']) || !text(value.alt) || value.alt.length > 160
    || value.alt !== value.alt.trim() || typeof value.dataUrl !== 'string' || value.dataUrl.length > MAX_SYNTHETIC_SOP_IMAGE_DATA_URL) return false;
  const match = IMAGE_URL.exec(value.dataUrl);
  if (!match || !match[2]) return false;
  try {
    const bytes = atob(match[2]);
    if (btoa(bytes) !== match[2]) return false;
    const dimensions = imageDimensions(match[1], bytes);
    return dimensions !== null && dimensions.every(size => size > 0 && size <= MAX_SYNTHETIC_SOP_IMAGE_DIMENSION)
      && dimensions[0] * dimensions[1] <= MAX_SYNTHETIC_SOP_IMAGE_PIXELS;
  } catch {
    // Invalid base64 or image headers fail closed at the projection boundary.
    return false;
  }
}

export function isSyntheticSopImages(value: unknown): value is readonly SopImage[] {
  return Array.isArray(value) && value.length <= 3 && value.every(isSyntheticSopImage);
}
function imageTotal(groups: readonly (readonly SopImage[])[]): number {
  return groups.reduce((sum, images) => sum + images.reduce((total, image) => total + image.dataUrl.length, 0), 0);
}
function errorCode(value: unknown): value is SopWindowErrorCode { return SOP_WINDOW_ERROR_CODES.some(code => code === value); }
export function sopWindowFailure(code: SopWindowErrorCode, message: string): Extract<SopWindowResult, { ok: false }> {
  return { ok: false, code, message };
}
export function isSopWindowResult(value: unknown): value is SopWindowResult {
  return record(value) && (value.ok === true ? keys(value, ['ok'])
    : value.ok === false && keys(value, ['ok', 'code', 'message']) && errorCode(value.code) && text(value.message));
}
export function isQuerySopRevision(value: unknown): value is QuerySopRevision {
  return record(value) && keys(value, ['taskId', 'revision', 'stepIndex']) && id(value.taskId) && positive(value.revision) && positive(value.stepIndex);
}
export function isQuerySopCopyRequest(value: unknown): value is QuerySopCopyRequest {
  return record(value) && keys(value, ['taskId', 'revision', 'stepIndex', 'scriptId'])
    && id(value.taskId) && positive(value.revision) && positive(value.stepIndex) && id(value.scriptId);
}
export function isQuerySopCommand(value: unknown): value is QuerySopCommand {
  if (!record(value) || !id(value.taskId) || !positive(value.revision) || !positive(value.stepIndex)) return false;
  const base = ['type', 'taskId', 'revision', 'stepIndex'];
  switch (value.type) {
    case 'next': case 'end': case 'restart': case 'resume': return keys(value, base);
    case 'choose': return keys(value, [...base, 'edgeId']) && id(value.edgeId);
    case 'select-script': return keys(value, [...base, 'scriptId']) && id(value.scriptId);
    case 'check': return keys(value, [...base, 'requirementId', 'checked']) && id(value.requirementId) && typeof value.checked === 'boolean';
    case 'wait': return keys(value, [...base, 'reason']) && (value.reason === 'customer' || value.reason === 'internal');
    case 'rewind': return keys(value, [...base, 'targetStepIndex']) && positive(value.targetStepIndex);
    default: return false;
  }
}
function script(value: unknown): value is SopProjectedScript {
  if (!record(value) || !id(value.scriptId) || !isSyntheticSopImages(value.images)) return false;
  if (value.unpublished === true) return keys(value, ['scriptId', 'unpublished', 'images']) && value.images.length === 0;
  return value.unpublished === false && keys(value, ['scriptId', 'title', 'answerText', 'condition', 'unpublished', 'images'])
    && text(value.title) && text(value.answerText) && text(value.condition);
}
export function isSopTerm(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 128
    && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value);
}

function edge(value: unknown): value is SopProjectedEdge {
  return record(value) && keys(value, ['id', 'label', 'criterion', 'matchTerms']) && id(value.id) && text(value.label) && text(value.criterion)
    && Array.isArray(value.matchTerms) && value.matchTerms.length <= 32
    && value.matchTerms.every(isSopTerm)
    && new Set(value.matchTerms).size === value.matchTerms.length;
}

export function matchSopChoices(input: string, edges: readonly SopProjectedEdge[]): ReadonlyMap<string, readonly string[]> {
  const normalized = input.normalize('NFKC').toLowerCase().trim();
  if (!normalized) return new Map();
  const matches = new Map<string, readonly string[]>();
  for (const edge of edges) {
    const terms = edge.matchTerms.filter(term => {
      const normalizedTerm = term.normalize('NFKC').toLowerCase().trim();
      return normalizedTerm.length > 0 && normalized.includes(normalizedTerm);
    });
    if (terms.length) matches.set(edge.id, terms);
  }
  return matches;
}
const PROJECTION_KEYS = ['sceneId','sceneTitle','version','stageLabel','taskTitle','nodeId','stepIndex','taskId','revision','demo','nodeKind','prompt','images','internalNote','scripts','selectedScriptId','requirements','knowledge','history','waiting','edges','canNext','canChoose','terminal','copied'];
export function isSopProjection(value: unknown): value is SopProjection {
  if (!record(value) || !keys(value, PROJECTION_KEYS)) return false;
  return id(value.sceneId) && text(value.sceneTitle) && text(value.version) && text(value.stageLabel)
    && typeof value.taskTitle === 'string' && id(value.nodeId) && positive(value.stepIndex) && id(value.taskId) && positive(value.revision) && value.demo === true
    && (value.nodeKind === 'action' || value.nodeKind === 'decision' || value.nodeKind === 'terminal')
    && typeof value.prompt === 'string' && isSyntheticSopImages(value.images)
    && (value.internalNote === null || typeof value.internalNote === 'string')
    && Array.isArray(value.scripts) && value.scripts.length <= 32 && value.scripts.every(script)
    && new Set(value.scripts.map(item => item.scriptId)).size === value.scripts.length
    && (value.selectedScriptId === null || (id(value.selectedScriptId) && value.scripts.some(item => item.scriptId === value.selectedScriptId)))
    && Array.isArray(value.requirements) && value.requirements.length <= 32 && value.requirements.every(item => record(item)
      && keys(item, ['id','label','checked']) && id(item.id) && text(item.label) && typeof item.checked === 'boolean')
    && Array.isArray(value.knowledge) && value.knowledge.length <= 32 && value.knowledge.every(item => record(item)
      && keys(item, ['id','title','body','images']) && id(item.id) && text(item.title) && text(item.body) && isSyntheticSopImages(item.images))
    && imageTotal([value.images, ...value.scripts.map(item => item.images), ...value.knowledge.map(item => item.images)]) <= MAX_SYNTHETIC_SOP_IMAGE_TOTAL
    && Array.isArray(value.history) && value.history.length <= 256 && value.history.every(item => record(item)
      && keys(item, ['stepIndex','nodeId','title','instruction','choiceLabel','confirmedRequirements']) && positive(item.stepIndex) && id(item.nodeId) && text(item.title) && typeof item.instruction === 'string' && (item.choiceLabel === null || text(item.choiceLabel)) && Array.isArray(item.confirmedRequirements) && item.confirmedRequirements.every(text))
    && (value.waiting === null || value.waiting === 'customer' || value.waiting === 'internal')
    && Array.isArray(value.edges) && value.edges.length <= 4 && value.edges.every(edge)
    && typeof value.canNext === 'boolean' && typeof value.canChoose === 'boolean' && typeof value.terminal === 'boolean' && typeof value.copied === 'boolean';
}

/** A manual image belongs to one scene, task, and, where applicable, script or knowledge item. */
export function isSopManualImageProjections(value: unknown): value is readonly SopManualImageProjection[] {
  if (!Array.isArray(value) || value.length > 128) return false;
  const tasks = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (!record(item) || !keys(item, ['sceneId', 'nodeId', 'images', 'scripts', 'knowledge']) || !id(item.sceneId) || !id(item.nodeId)
      || !isSyntheticSopImages(item.images) || !Array.isArray(item.scripts) || item.scripts.length > 32
      || !item.scripts.every(script => record(script) && keys(script, ['scriptId', 'images']) && id(script.scriptId) && isSyntheticSopImages(script.images))
      || new Set(item.scripts.map(script => script.scriptId)).size !== item.scripts.length
      || !Array.isArray(item.knowledge) || item.knowledge.length > 32
      || !item.knowledge.every(knowledge => record(knowledge) && keys(knowledge, ['id', 'images']) && id(knowledge.id) && isSyntheticSopImages(knowledge.images))
      || new Set(item.knowledge.map(knowledge => knowledge.id)).size !== item.knowledge.length) return false;
    const task = JSON.stringify([item.sceneId, item.nodeId]);
    if (tasks.has(task)) return false;
    tasks.add(task);
    total += imageTotal([item.images, ...item.scripts.map(script => script.images), ...item.knowledge.map(knowledge => knowledge.images)]);
    if (total > MAX_SYNTHETIC_SOP_IMAGE_TOTAL) return false;
  }
  return true;
}

export const SOP_OPEN_FAILURE_MESSAGE = '流程没打开，请重试';

export const SOP_COPY_FEEDBACK_MS = 1200;

export function isSopCopyResult(value: unknown): value is SopCopyResult {
  if (!record(value)) return false;
  if (value.ok === false) return keys(value, ['ok', 'message']) && text(value.message);
  return value.ok === true && (value.outcome === 'copied-advanced' ? keys(value, ['ok', 'outcome', 'source', 'sourceTitle', 'copyGeneration'])
    : value.outcome === 'copied-stayed' && keys(value, ['ok', 'outcome', 'source', 'sourceTitle', 'reason', 'copyGeneration'])
      && (value.reason === 'requirements' || value.reason === 'decision' || value.reason === 'terminal')) && text(value.sourceTitle)
    && positive(value.copyGeneration)
    && record(value.source) && keys(value.source, ['taskId', 'revision', 'stepIndex'])
    && id(value.source.taskId) && positive(value.source.revision) && positive(value.source.stepIndex);
}
function size(value: unknown): boolean {
  return record(value) && keys(value, ['width', 'height']) && positive(value.width) && positive(value.height)
    && value.width <= 16384 && value.height <= 16384;
}
export function isQuerySopSnapshot(value: unknown): value is QuerySopSnapshot {
  if (!record(value)) return false;
  if (value.kind === 'unavailable') return keys(value, ['kind', 'message']) && text(value.message);
  if (value.kind !== 'ready' || !keys(value, ['kind', 'sequence', 'copyGeneration', 'tasks', 'projection', 'view', 'viewEpoch', 'transition', 'mode', 'access'])
    || (value.mode !== 'query' && value.mode !== 'floating') || !isSopAccess(value.access) || !positive(value.sequence) || !positive(value.viewEpoch) || !Array.isArray(value.tasks) || value.tasks.length > MAX_SOP_TASKS
    || typeof value.copyGeneration !== 'number' || !Number.isSafeInteger(value.copyGeneration) || value.copyGeneration < 0
    || !record(value.view)) return false;
  const view = value.view;
  if (view.kind === 'sop' ? !keys(view, ['kind', 'taskId']) || !id(view.taskId)
    : !keys(view, ['kind']) || (view.kind !== 'query-home' && view.kind !== 'query-results')) return false;
  if (!value.tasks.every(task => record(task) && keys(task, ['taskId', 'ordinal', 'displayName', 'revision', 'sceneId', 'sceneTitle', 'taskTitle', 'stepIndex', 'waiting'])
    && validSopDisplayName(task.displayName) && id(task.taskId) && positive(task.ordinal) && positive(task.revision) && id(task.sceneId) && text(task.sceneTitle)
    && text(task.taskTitle) && positive(task.stepIndex) && (task.waiting === null || task.waiting === 'customer' || task.waiting === 'internal'))
    || new Set(value.tasks.map(task => task.taskId)).size !== value.tasks.length) return false;
  if (value.transition !== null && (!record(value.transition) || !keys(value.transition, ['stage', 'from', 'to'])
    || (value.transition.stage !== 'preparing' && value.transition.stage !== 'animating') || !size(value.transition.from) || !size(value.transition.to))) return false;
  if (view.kind !== 'sop') return value.projection === null && record(value.access) && value.access.kind === 'none';
  if (record(value.access) && value.access.kind === 'none') return false;
  const projection = value.projection;
  return isSopProjection(projection) && projection.taskId === view.taskId
    && value.tasks.some(task => task.taskId === projection.taskId && task.revision === projection.revision && task.stepIndex === projection.stepIndex);
}

export function isSopFloatingSnapshot(value: unknown): value is SopFloatingSnapshot {
  if (!record(value)) return false;
  if (value.kind === 'unavailable') return isQuerySopSnapshot(value);
  if (!Object.hasOwn(value, 'seenActiveTaskIds') || typeof value.collapsed !== 'boolean') return false;
  const { seenActiveTaskIds, collapsed: _collapsed, ...snapshot } = value;
  if (!Array.isArray(seenActiveTaskIds) || seenActiveTaskIds.length > MAX_SOP_TASKS
    || !seenActiveTaskIds.every(id) || new Set(seenActiveTaskIds).size !== seenActiveTaskIds.length
    || !isQuerySopSnapshot(snapshot) || snapshot.kind !== 'ready') return false;
  if (snapshot.transition !== null || snapshot.view.kind === 'query-results') return false;
  return snapshot.projection
    ? snapshot.tasks.length === 1 && seenActiveTaskIds.length === 1 && seenActiveTaskIds[0] === snapshot.projection.taskId
    : snapshot.tasks.length === 0 && seenActiveTaskIds.length === 0;
}

export function validSopDisplayName(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value === value.trim() && value.length > 0
    && Array.from(value).length <= MAX_SOP_DISPLAY_NAME_LENGTH && Array.from(value).every(char => (char.codePointAt(0) ?? 0) >= 32 && char.codePointAt(0) !== 127) && !/[\uD800-\uDFFF]/u.test(value));
}
export function isSopRenameRequest(value: unknown): value is SopRenameRequest {
  return record(value) && keys(value, ['taskId', 'revision', 'displayName']) && id(value.taskId) && positive(value.revision) && validSopDisplayName(value.displayName);
}
export function isSopReadyRequest(value: unknown): value is SopReadyRequest {
  return record(value) && keys(value, ['mountId']) && positive(value.mountId);
}
export function isSopShowQueryRequest(value: unknown): value is SopShowQueryRequest {
  return record(value) && keys(value, ['requestId', 'taskId', 'hostEpoch']) && positive(value.requestId) && id(value.taskId) && positive(value.hostEpoch);
}
export function isSopShowQueryReady(value: unknown): value is SopShowQueryReady {
  if (!record(value)) return false;
  const { accepted, ...request } = value;
  return typeof accepted === 'boolean' && isSopShowQueryRequest(request);
}
export function isSopDraftIdentity(value: unknown): value is SopDraftIdentity {
  return record(value) && keys(value, ['taskId', 'hostEpoch']) && id(value.taskId) && positive(value.hostEpoch);
}
export function isSopDraftStart(value: unknown): value is SopDraftStart {
  if (!record(value)) return false;
  const { revision, ...identity } = value;
  return isSopDraftIdentity(identity) && positive(revision);
}
export function isSopDraftUpdate(value: unknown): value is SopDraftUpdate {
  if (!record(value)) return false;
  const { draftId, sequence, value: draftValue, ...identity } = value;
  return isSopDraftIdentity(identity) && positive(draftId) && positive(sequence)
    && typeof draftValue === 'string' && draftValue.length <= 256;
}
export function isSopDraftDiscard(value: unknown): value is SopDraftDiscard {
  if (!record(value)) return false;
  const { draftId, ...identity } = value;
  return isSopDraftIdentity(identity) && positive(draftId);
}
export function isSopDraftResult(value: unknown): value is SopDraftResult {
  if (!record(value)) return false;
  if (value.ok === false) return keys(value, ['ok']);
  if (value.ok !== true || !keys(value, ['ok', 'draft'])) return false;
  const draft = value.draft;
  return draft === null || (record(draft) && keys(draft, ['draftId', 'revision', 'initialName', 'value', 'sequence'])
    && positive(draft.draftId) && positive(draft.revision) && validSopDisplayName(draft.initialName)
    && typeof draft.value === 'string' && draft.value.length <= 256
    && typeof draft.sequence === 'number' && Number.isSafeInteger(draft.sequence) && draft.sequence >= 0);
}
function isSopAccess(value: unknown): value is SopAccess {
  return record(value) && (value.kind === 'none' ? keys(value, ['kind']) : value.kind === 'preview'
    ? keys(value, ['kind', 'mountId']) && positive(value.mountId)
    : value.kind === 'executable' && keys(value, ['kind', 'hostEpoch']) && positive(value.hostEpoch));
}
export function isSopExecutionCommand(value: unknown): value is SopExecutionCommand {
  if (!record(value)) return false;
  const { hostEpoch, ...command } = value;
  return isQuerySopCommand(command) && positive(hostEpoch);
}
export function isSopExecutionCopy(value: unknown): value is SopExecutionCopy {
  if (!record(value)) return false;
  const { hostEpoch, ...copy } = value;
  return positive(hostEpoch) && isQuerySopCopyRequest(copy);
}
export function isSopExecutionRename(value: unknown): value is SopExecutionRename {
  if (!record(value)) return false;
  const { hostEpoch, ...rename } = value;
  return positive(hostEpoch) && isSopRenameRequest(rename);
}
