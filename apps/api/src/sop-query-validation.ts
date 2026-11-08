import type {
  SopBranch,
  SopEmptyResult,
  SopMediaRef,
  SopMessage,
  SopNode,
  SopQueryReadResult,
  SopQueryReason,
  SopQueryResponse,
  SopReadyResult,
} from './sop-query-model.js';

type RecordValue = Readonly<Record<string, unknown>>;

const REASON_CODES = new Set([
  'SCOPE_DENIED',
  'LEASE_EXPIRED',
  'APPROVAL_REVOKED',
  'SOURCE_GATE_NOT_READY',
  'GRAPH_UNRESOLVED',
  'TERMINAL_HAS_OUTGOING_EDGE',
  'SAFETY_REVIEW_REQUIRED',
  'MEDIA_UNVERIFIED',
  'STALE_RELEASE',
  'IDEMPOTENCY_CONFLICT',
]);
const NODE_KINDS = new Set(['instruction', 'decision', 'terminal']);
const RISK_LEVELS = new Set(['unclassified', 'low', 'medium', 'high', 'critical']);
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isReason(value: unknown): value is SopQueryReason {
  if (!isRecord(value) || !hasOnlyKeys(value, ['code', 'source_ref']) || !REASON_CODES.has(String(value.code))) {
    return false;
  }
  return value.source_ref === undefined || boundedString(value.source_ref, 1, 512);
}

function isNode(value: unknown): value is SopNode {
  return isRecord(value) && hasOnlyKeys(value, ['node_id', 'scenario_id', 'sequence', 'kind', 'terminal', 'source_ref'])
    && boundedString(value.node_id, 1, 256)
    && boundedString(value.scenario_id, 1, 128)
    && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0 && value.sequence <= 10000
    && NODE_KINDS.has(String(value.kind))
    && typeof value.terminal === 'boolean'
    && boundedString(value.source_ref, 1, 512);
}

function isBranch(value: unknown): value is SopBranch {
  return isRecord(value) && hasOnlyKeys(value, ['branch_id', 'source_node_id', 'option', 'target_node_id', 'is_unresolved'])
    && boundedString(value.branch_id, 1, 256)
    && boundedString(value.source_node_id, 1, 256)
    && boundedString(value.option, 1, 512)
    && (value.target_node_id === null || boundedString(value.target_node_id, 1, 256))
    && typeof value.is_unresolved === 'boolean';
}

function isMessage(value: unknown): value is SopMessage {
  return isRecord(value) && hasOnlyKeys(value, ['message_id', 'node_id', 'title', 'body', 'risk_level', 'copy_allowed'])
    && boundedString(value.message_id, 1, 256)
    && boundedString(value.node_id, 1, 256)
    && boundedString(value.title, 1, 512)
    && boundedString(value.body, 1, 8192)
    && RISK_LEVELS.has(String(value.risk_level))
    && typeof value.copy_allowed === 'boolean';
}

function isMediaRef(value: unknown): value is SopMediaRef {
  return isRecord(value) && hasOnlyKeys(value, ['media_id', 'node_id', 'content_type', 'preview_handle', 'expires_at'])
    && boundedString(value.media_id, 1, 256)
    && boundedString(value.node_id, 1, 256)
    && MEDIA_TYPES.has(String(value.content_type))
    && boundedString(value.preview_handle, 1, 512)
    && typeof value.expires_at === 'string' && ISO_DATE.test(value.expires_at)
    && !Number.isNaN(Date.parse(value.expires_at));
}

function isReadyResult(value: unknown): value is SopReadyResult {
  return isRecord(value) && hasOnlyKeys(value, ['entry_node_id', 'nodes', 'branches', 'messages', 'media_refs'])
    && boundedString(value.entry_node_id, 1, 256)
    && Array.isArray(value.nodes) && value.nodes.length <= 128 && value.nodes.every(isNode)
    && Array.isArray(value.branches) && value.branches.length <= 512 && value.branches.every(isBranch)
    && Array.isArray(value.messages) && value.messages.length <= 256 && value.messages.every(isMessage)
    && Array.isArray(value.media_refs) && value.media_refs.length <= 500 && value.media_refs.every(isMediaRef);
}

function isEmptyResult(value: unknown): value is SopEmptyResult {
  return isRecord(value) && hasOnlyKeys(value, ['nodes', 'branches', 'messages', 'media_refs'])
    && Array.isArray(value.nodes) && value.nodes.length === 0
    && Array.isArray(value.branches) && value.branches.length === 0
    && Array.isArray(value.messages) && value.messages.length === 0
    && Array.isArray(value.media_refs) && value.media_refs.length === 0;
}

/** Validates the server-owned release result before it crosses into HTTP or Main. */
export function isSopQueryReadResult(value: unknown): value is SopQueryReadResult {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'status', 'release_id', 'lease_expires_at', 'result', 'reasons',
  ]) || !Array.isArray(value.reasons) || value.reasons.length > 8 || !value.reasons.every(isReason)) return false;
  if (value.status === 'ready') {
    return boundedString(value.release_id, 1, 256)
      && typeof value.lease_expires_at === 'string' && ISO_DATE.test(value.lease_expires_at)
      && !Number.isNaN(Date.parse(value.lease_expires_at))
      && isReadyResult(value.result) && value.reasons.length === 0;
  }
  if (value.status === 'blocked') {
    return value.release_id === null && value.lease_expires_at === null
      && value.result === null && value.reasons.length >= 1;
  }
  if (value.status === 'stale') {
    return (value.release_id === null || boundedString(value.release_id, 1, 256))
      && value.lease_expires_at === null && value.result === null && value.reasons.length >= 1;
  }
  if (value.status === 'no_match') {
    return boundedString(value.release_id, 1, 256)
      && typeof value.lease_expires_at === 'string' && ISO_DATE.test(value.lease_expires_at)
      && !Number.isNaN(Date.parse(value.lease_expires_at))
      && isEmptyResult(value.result) && value.reasons.length === 0;
  }
  return false;
}

export function isSopQueryResponse(value: unknown): value is SopQueryResponse {
  return isRecord(value) && hasOnlyKeys(value, [
    'status', 'request_id', 'release_id', 'lease_expires_at', 'result', 'reasons',
  ]) && typeof value.request_id === 'string' && UUID.test(value.request_id)
    && isSopQueryReadResult({
      status: value.status,
      release_id: value.release_id,
      lease_expires_at: value.lease_expires_at,
      result: value.result,
      reasons: value.reasons,
    });
}
