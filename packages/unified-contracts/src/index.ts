/**
 * Handwritten cross-service contracts for the unified architecture program.
 *
 * `packages/contracts` remains the owner of the frozen upstream OpenAPI
 * snapshot. This package owns the decision, query, operation, release, and
 * overlay semantics that are not generated from that snapshot.
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type UserId = Brand<string, 'UserId'>;
export type SessionEpoch = Brand<number, 'SessionEpoch'>;
export type ReleaseId = Brand<string, 'ReleaseId'>;
export type OperationId = Brand<string, 'OperationId'>;
export type QueryId = Brand<string, 'QueryId'>;
export type RequestId = Brand<string, 'RequestId'>;
export type DatasetId = Brand<string, 'DatasetId'>;
export type KeyedQueryFingerprint = Brand<string, 'KeyedQueryFingerprint'>;

export const QUERY_KINDS = ['ordinary', 'sop'] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

export const QUERY_INTENTS = [
  'product', 'activity', 'after-sale', 'sop', 'general', 'unknown',
] as const;
export type QueryIntent = (typeof QUERY_INTENTS)[number];

export const OBSERVABILITY_STAGES = [
  'request', 'access', 'release-read', 'recall', 'fusion', 'rerank',
  'response-validation', 'transport', 'sop-match', 'sop-path-expansion',
  'sop-branch-selection', 'sop-response-validation', 'copy',
  'dashboard-operation', 'content-parse', 'content-publish',
  'release-invalidation',
] as const;
export type ObservabilityStage = (typeof OBSERVABILITY_STAGES)[number];

export const STAGE_OUTCOMES = ['succeeded', 'failed', 'cancelled', 'stale', 'unknown'] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

export const BUDGET_CLASSES = ['interactive', 'background', 'maintenance'] as const;
export type BudgetClass = (typeof BUDGET_CLASSES)[number];

export const EVALUATION_LIMITERS = [
  'none', 'dataset-size', 'concurrency', 'time-budget', 'external-model',
] as const;
export type EvaluationLimiter = (typeof EVALUATION_LIMITERS)[number];

export const ALERT_KINDS = [
  'budget_breach', 'unknown_operation', 'dead_letter_growth',
  'stale_release', 'release_index_failure',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export type AccessRole = (typeof ACCESS_ROLES)[number];
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type ScopeKind = 'tenant' | 'brand' | 'shop' | 'source';
export const DOMAINS = ['product', 'activity', 'after-sale', 'aftersale', 'general', 'sop'] as const;
export type Domain = (typeof DOMAINS)[number];
const domainSet = new Set<unknown>(DOMAINS);
export function isDomain(value: unknown): value is Domain {
  return domainSet.has(value);
}

export const ACCESS_ROLES = [
  'agent', 'director', 'enabler', 'engineer', 'lead', 'manager', 'supervisor',
] as const;

export const ACCESS_ACTIONS = [
  'query', 'content-manage', 'import', 'source-confirm', 'review', 'publish',
  'candidate-cancel', 'rollback', 'dashboard-read', 'grants-manage', 'accounts-manage',
] as const;

const SCOPE_KINDS = ['tenant', 'brand', 'shop', 'source'] as const;
const DENY_REASONS = [
  'MISSING_PRINCIPAL', 'AMBIGUOUS_ROLE', 'ROLE_CEILING', 'EXPIRED_GRANT',
  'REVOKED_GRANT', 'EXPIRED_FACTS', 'SOURCE_OUTSIDE_SET', 'STORE_SET_CHANGED',
  'SESSION_EXPIRED', 'POLICY_DENIED',
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

type StringRecord = Record<string, unknown>;
type BrandId = Brand<string, 'BrandId'>;
type ShopId = Brand<string, 'ShopId'>;
type SourceId = Brand<string, 'SourceId'>;
type TenantId = Brand<string, 'TenantId'>;
type AppId = Brand<string, 'AppId'>;

export type Scope = {
  kind: ScopeKind;
  tenantId: TenantId;
  appId: AppId;
  brandId?: BrandId;
  shopId?: ShopId;
  domain?: Domain;
  sourceId?: SourceId;
};

export type AllowedScope = {
  scope: Scope;
  actions: AccessAction[];
  validUntil: string;
};

export type AccessDecision = {
  userId: UserId;
  role: AccessRole;
  state: 'allowed' | 'denied';
  allowedScopes: AllowedScope[];
  accessRevision: number;
  factsVersion: number;
  revocationGeneration: number;
  policyVersion: number;
  storeSetVersion: number;
  resolvedAt: string;
  expiresAt: string;
  denyReason: DenyReason | null;
};

export type QueryAccessView = {
  state: 'allowed' | 'denied';
  scopes: Array<{ scope: Scope; validUntil: string }>;
  accessRevision: number;
  factsVersion: number;
  revocationGeneration: number;
  policyVersion: number;
  storeSetVersion: number;
  expiresAt: string;
  denyReason: DenyReason | null;
};

export type DashboardSettingsView = {
  state: 'open' | 'closed';
  grants: 'open' | 'closed';
  accounts: 'open' | 'closed';
  accessRevision: number;
  expiresAt: string;
  denyReason: DenyReason | null;
};

export type AdminAccessView = {
  state: 'open' | 'closed';
  role: AccessRole;
  grants: { state: 'open' | 'closed'; scopes: Array<{ scope: Scope; validUntil: string }> };
  accounts: { state: 'open' | 'closed'; scopes: Array<{ scope: Scope; validUntil: string }> };
  accessRevision: number;
  policyVersion: number;
  expiresAt: string;
  denyReason: DenyReason | null;
};

export type ContentCandidate = {
  candidateId: string;
  title: string;
  body: string;
  copyHandle: string;
  rank: number;
};

export type SopStep = {
  stepId: string;
  kind: 'instruction' | 'decision' | 'terminal';
  sequence: number;
  text: string;
  media: string[];
};

export type SopFlow = {
  sopId: string;
  title: string;
  entryStepId: string;
  steps: SopStep[];
  branches: Array<{
    branchId: string;
    sourceStepId: string;
    label: string;
    targetStepId: string;
  }>;
};

export type QueryOutcome =
  | { kind: 'content'; queryId: QueryId; releaseId: ReleaseId; candidates: ContentCandidate[] }
  | { kind: 'sop'; queryId: QueryId; releaseId: ReleaseId; flow: SopFlow }
  | { kind: 'no-hit'; queryId: QueryId; reason: string }
  | { kind: 'failure'; queryId: QueryId; failureCode: string; retryable: boolean; message: string };

export type OperationCommand = AccessAction | 'query' | 'settings-preview' | 'settings-save';
export type Cancellation = { mode: 'cooperative' | 'before-commit'; deadline: string };

export type OperationEnvelope = {
  operationId: OperationId;
  actor: { userId: UserId; sessionEpoch: SessionEpoch };
  command: OperationCommand;
  requestHash: string;
  idempotencyKey: string;
  expectedVersion: number;
  accessRevision: number;
  cancellation: Cancellation;
  createdAt: string;
  recoveryDeadline: string;
};

export const OPERATION_TRANSITIONS = {
  accepted: ['running', 'cancelled', 'failed', 'unknown'],
  running: ['committed', 'cancelled', 'failed', 'unknown'],
  unknown: ['committed', 'cancelled', 'failed', 'expired'],
  committed: [], failed: [], cancelled: [], expired: [],
} as const;

export type OperationState = keyof typeof OPERATION_TRANSITIONS;
export type OperationReceipt =
  | { kind: 'committed'; committedAt: string; resultRef: string }
  | { kind: 'failed'; failedAt: string; failureCode: string }
  | { kind: 'cancelled'; cancelledAt: string }
  | { kind: 'expired'; expiredAt: string };
export type OperationStatus = {
  operationId: OperationId;
  userId: UserId;
  sessionEpoch: SessionEpoch;
  command: OperationCommand;
  state: OperationState;
  updatedAt: string;
  recoveryDeadline: string;
  receipt: OperationReceipt | null;
};

export type ReleaseProjection = {
  state: 'ready' | 'empty';
  indexId: string | null;
  indexVersion: number | null;
  itemCount: number;
  indexHash: string | null;
};
export type ReleaseSnapshot = {
  releaseId: ReleaseId;
  sequence: number;
  publishedAt: string;
  content: ReleaseProjection;
  sop: ReleaseProjection;
};

export type OverlaySnapshot = {
  role: 'fox' | 'query';
  sessionEpoch: SessionEpoch;
  generation: number;
  phase: 'parked' | 'opening' | 'active' | 'closing' | 'closed';
  activeSurface: 'fox' | 'query';
  handoffSequence: number;
  layoutSequence: number;
  releaseId: ReleaseId;
};

type TraceSessionCorrelation =
  | { sessionEpoch: SessionEpoch; generation: number }
  | { sessionEpoch: null; generation: null };

export type TraceIdentity = {
  requestId: RequestId;
  operationId: OperationId | null;
  queryId: QueryId;
  parentQueryId: QueryId | null;
  releaseId: ReleaseId | null;
  kind: QueryKind;
} & TraceSessionCorrelation;

type QueryTelemetryBase = {
  trace: TraceIdentity | null;
  releaseId: ReleaseId;
  queryFingerprint: KeyedQueryFingerprint;
  queryLength: number;
};

export type QueryTelemetryRecord =
  | (QueryTelemetryBase & { kind: 'ordinary'; intent: Exclude<QueryIntent, 'sop'> })
  | (QueryTelemetryBase & { kind: 'sop'; intent: 'sop' });

type StageRecordBase = {
  trace: TraceIdentity | null;
  stage: ObservabilityStage;
  startedAt: string;
  durationMs: number;
  budgetClass: BudgetClass;
  external: boolean;
};

type StageErrorState =
  | { outcome: 'failed'; errorCode: string }
  | { outcome: 'succeeded'; errorCode: null }
  | { outcome: 'cancelled' | 'stale' | 'unknown'; errorCode: string | null };

export type StageRecord = StageRecordBase & StageErrorState;

export type OrdinaryEvaluationMetrics = {
  recallAtK: number;
  topK: number;
  noHitCount: number;
  responseValidationFailureCount: number;
};

export type SopEvaluationMetrics = {
  matchedCount: number;
  validPathCount: number;
  validBranchCount: number;
  staleReleaseRejectedCount: number;
  unauthorizedResourceRejectedCount: number;
};

type EvaluationBase = {
  datasetId: DatasetId;
  datasetVersion: number;
  samples: number;
  errors: number;
  limiter: EvaluationLimiter;
};

export type EvaluationRecord =
  | (EvaluationBase & { kind: 'ordinary'; metrics: OrdinaryEvaluationMetrics })
  | (EvaluationBase & { kind: 'sop'; metrics: SopEvaluationMetrics });

export type BudgetBreachAlert = {
  kind: 'budget_breach';
  observedAt: string;
  stage: ObservabilityStage;
  budgetClass: BudgetClass;
  percentile: 'p50' | 'p95' | 'p99';
  thresholdMs: number;
  observedMs: number;
  sampleCount: number;
};

export type UnknownOperationAlert = {
  kind: 'unknown_operation';
  observedAt: string;
  operationId: OperationId;
  reasonCode: string;
};

export type DeadLetterQueue = 'content-parse' | 'release-index' | 'dashboard-operation';

export type DeadLetterGrowthAlert = {
  kind: 'dead_letter_growth';
  observedAt: string;
  queue: DeadLetterQueue;
  previousDepth: number;
  currentDepth: number;
};

export type StaleReleaseAlert = {
  kind: 'stale_release';
  observedAt: string;
  trace: TraceIdentity;
  expectedReleaseId: ReleaseId;
};

export type ReleaseIndexFailureAlert = {
  kind: 'release_index_failure';
  observedAt: string;
  releaseId: ReleaseId;
  projection: 'content' | 'sop';
  errorCode: string;
};

export type AlertRecord =
  | BudgetBreachAlert
  | UnknownOperationAlert
  | DeadLetterGrowthAlert
  | StaleReleaseAlert
  | ReleaseIndexFailureAlert;

export type PolicyConstraint = {
  maxScope: ScopeKind;
  requiresCurrentFacts: boolean;
  requiresDatabaseCheck: boolean;
};
export type RoleCeilingPolicy = {
  role: AccessRole;
  businessActions: readonly AccessAction[];
  mayAllocate: boolean;
  mayDelegate: boolean;
  maySkipImportParent: boolean;
};
export type AuthorizationMatrixEntry = {
  role: AccessRole;
  action: AccessAction;
  scopeKind: ScopeKind;
  constraints: PolicyConstraint;
};

const policy = (role: AccessRole, action: AccessAction, scopeKind: ScopeKind, requiresCurrentFacts = true): AuthorizationMatrixEntry => Object.freeze({
  role, action, scopeKind,
  constraints: Object.freeze({ maxScope: scopeKind, requiresCurrentFacts, requiresDatabaseCheck: true }),
});

const businessActions = Object.freeze([
  'query', 'content-manage', 'import', 'source-confirm',
  'review', 'publish', 'candidate-cancel', 'rollback',
] as const satisfies readonly AccessAction[]);
const queryBusinessActions = Object.freeze(['query'] as const);
const rolePolicy = (
  role: AccessRole,
  actions: readonly AccessAction[],
  mayAllocate: boolean,
  mayDelegate: boolean,
  maySkipImportParent: boolean,
): RoleCeilingPolicy => Object.freeze({
  role,
  businessActions: actions,
  mayAllocate,
  mayDelegate,
  maySkipImportParent,
});

/**
 * The canonical values mirror `content_intake.role_ceiling`. The database
 * remains the runtime authority; this data only generates reviewable seed SQL
 * and derives the local ACL shape used by contract validation.
 */
export const ROLE_CEILING_POLICY: readonly RoleCeilingPolicy[] = Object.freeze([
  rolePolicy('agent', queryBusinessActions, false, false, false),
  rolePolicy('director', businessActions, true, true, true),
  rolePolicy('enabler', queryBusinessActions, false, false, false),
  rolePolicy('engineer', businessActions, true, true, true),
  rolePolicy('lead', businessActions, false, false, false),
  rolePolicy('manager', businessActions, true, true, true),
  rolePolicy('supervisor', businessActions, false, false, false),
]);

const dashboardReadRoles = new Set<AccessRole>([
  'director', 'engineer', 'lead', 'manager', 'supervisor',
]);

export const AUTHORIZATION_MATRIX: readonly AuthorizationMatrixEntry[] = Object.freeze(ROLE_CEILING_POLICY.flatMap((entry) => {
  const entries = entry.businessActions.map((action) => policy(entry.role, action, 'source'));
  if (dashboardReadRoles.has(entry.role)) entries.push(policy(entry.role, 'dashboard-read', 'tenant'));
  if (entry.mayAllocate) {
    entries.push(policy(entry.role, 'grants-manage', 'source'));
    entries.push(policy(entry.role, 'accounts-manage', 'tenant'));
  }
  return entries;
}));

export class ContractValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) { super(`${path}: ${message}`); this.name = 'ContractValidationError'; this.path = path; }
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: ContractValidationError };
const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = (path: string, message: string): ValidationResult<never> => ({ ok: false, error: new ContractValidationError(path, message) });
const isRecord = (value: unknown): value is StringRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: StringRecord, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));
const stringAt = (value: unknown, path: string, nonEmpty = true): ValidationResult<string> => typeof value === 'string' && (!nonEmpty || value.length > 0) ? ok(value) : fail(path, 'expected non-empty string');
const intAt = (value: unknown, path: string, minimum = 0): ValidationResult<number> => Number.isInteger(value) && (value as number) >= minimum ? ok(value as number) : fail(path, `expected integer >= ${minimum}`);
const MAX_ISO_DATETIME_LENGTH = 64;
const isoAt = (value: unknown, path: string): ValidationResult<string> => {
  if (typeof value !== 'string' || value.length > MAX_ISO_DATETIME_LENGTH) return fail(path, 'expected ISO date-time');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u);
  if (!match) return fail(path, 'expected ISO date-time');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
    || Number.isNaN(Date.parse(value))) {
    return fail(path, 'expected ISO date-time');
  }
  return ok(value);
};
const branded = <T>(value: string): T => value as T;
const epoch = (value: number): SessionEpoch => value as SessionEpoch;
const dateOrder = (a: string, b: string): boolean => Date.parse(a) < Date.parse(b);
const resultOrThrow = <T>(result: ValidationResult<T>): T => { if (!result.ok) throw result.error; return result.value; };
const exactRecord = (value: unknown, path: string, keys: readonly string[]): ValidationResult<StringRecord> => isRecord(value) && hasOnly(value, keys) ? ok(value) : fail(path, 'unexpected or missing object shape');

function parseScope(value: unknown, path: string): ValidationResult<Scope> {
  if (!isRecord(value) || !SCOPE_KINDS.includes(value.kind as typeof SCOPE_KINDS[number])) return fail(path, 'invalid scope kind');
  const kind = value.kind as ScopeKind;
  const allowed: Record<ScopeKind, readonly string[]> = {
    tenant: ['kind', 'tenantId', 'appId'],
    brand: ['kind', 'tenantId', 'appId', 'brandId'],
    shop: ['kind', 'tenantId', 'appId', 'brandId', 'shopId'],
    source: ['kind', 'tenantId', 'appId', 'brandId', 'shopId', 'domain', 'sourceId'],
  };
  if (!hasOnly(value, allowed[kind])) return fail(path, 'field is not allowed for this scope kind');
  for (const key of ['tenantId', 'appId'] as const) if (typeof value[key] !== 'string' || value[key].length === 0) return fail(`${path}.${key}`, 'required');
  const required: Record<ScopeKind, string[]> = { tenant: [], brand: ['brandId'], shop: ['brandId', 'shopId'], source: ['brandId', 'shopId', 'domain', 'sourceId'] };
  for (const key of required[kind]) if (typeof value[key] !== 'string' || value[key].length === 0) return fail(`${path}.${key}`, 'required for scope kind');
  if (value.domain !== undefined && !isDomain(value.domain)) return fail(`${path}.domain`, 'invalid domain');
  return ok(value as Scope);
}

function parseAllowedScope(value: unknown, path: string): ValidationResult<AllowedScope> {
  if (!isRecord(value) || !hasOnly(value, ['scope', 'actions', 'validUntil'])) return fail(path, 'invalid allowed scope shape');
  const scope = parseScope(value.scope, `${path}.scope`); if (!scope.ok) return scope;
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.some((x) => !ACCESS_ACTIONS.includes(x as AccessAction))) return fail(`${path}.actions`, 'invalid actions');
  const validUntil = isoAt(value.validUntil, `${path}.validUntil`); if (!validUntil.ok) return validUntil;
  return ok({ scope: scope.value, actions: [...new Set(value.actions as AccessAction[])], validUntil: validUntil.value });
}

function isRoleAllowed(role: AccessRole, action: AccessAction, scopeKind: ScopeKind): boolean {
  return AUTHORIZATION_MATRIX.some((entry) => entry.role === role && entry.action === action && entry.scopeKind === scopeKind);
}

export function validateAccessDecision(value: unknown): ValidationResult<AccessDecision> {
  const shape = exactRecord(value, '$', ['userId', 'role', 'state', 'allowedScopes', 'accessRevision', 'factsVersion', 'revocationGeneration', 'policyVersion', 'storeSetVersion', 'resolvedAt', 'expiresAt', 'denyReason']); if (!shape.ok) return shape;
  const userId = stringAt(shape.value.userId, '$.userId'); if (!userId.ok) return userId;
  if (!ACCESS_ROLES.includes(shape.value.role as AccessRole)) return fail('$.role', 'invalid role');
  if (shape.value.state !== 'allowed' && shape.value.state !== 'denied') return fail('$.state', 'invalid state');
  if (!Array.isArray(shape.value.allowedScopes)) return fail('$.allowedScopes', 'expected array');
  const scopes: AllowedScope[] = [];
  for (let i = 0; i < shape.value.allowedScopes.length; i += 1) {
    const parsed = parseAllowedScope(shape.value.allowedScopes[i], `$.allowedScopes[${i}]`); if (!parsed.ok) return parsed;
    for (const action of parsed.value.actions) if (!isRoleAllowed(shape.value.role as AccessRole, action, parsed.value.scope.kind)) return fail(`$.allowedScopes[${i}].actions`, 'role/action/scope is outside matrix');
    scopes.push(parsed.value);
  }
  for (const [key, min] of [['accessRevision', 1], ['factsVersion', 1], ['revocationGeneration', 0], ['policyVersion', 1], ['storeSetVersion', 1]] as const) { const parsed = intAt(shape.value[key], `$.${key}`, min); if (!parsed.ok) return parsed; }
  const resolvedAt = isoAt(shape.value.resolvedAt, '$.resolvedAt'); if (!resolvedAt.ok) return resolvedAt;
  const expiresAt = isoAt(shape.value.expiresAt, '$.expiresAt'); if (!expiresAt.ok) return expiresAt;
  if (!dateOrder(resolvedAt.value, expiresAt.value)) return fail('$.expiresAt', 'must be after resolvedAt');
  if (shape.value.denyReason !== null && !DENY_REASONS.includes(shape.value.denyReason as DenyReason)) return fail('$.denyReason', 'invalid deny reason');
  if (shape.value.state === 'allowed' && (scopes.length === 0 || shape.value.denyReason !== null)) return fail('$', 'allowed decision must have scopes and no deny reason');
  if (shape.value.state === 'denied' && (scopes.length !== 0 || shape.value.denyReason === null)) return fail('$', 'denied decision must have a stable reason and no scopes');
  const role = shape.value.role as AccessRole;
  return ok({ userId: branded<UserId>(userId.value), role, state: shape.value.state, allowedScopes: scopes, accessRevision: shape.value.accessRevision as number, factsVersion: shape.value.factsVersion as number, revocationGeneration: shape.value.revocationGeneration as number, policyVersion: shape.value.policyVersion as number, storeSetVersion: shape.value.storeSetVersion as number, resolvedAt: resolvedAt.value, expiresAt: expiresAt.value, denyReason: shape.value.denyReason as DenyReason | null });
}
export const parseAccessDecision = (value: unknown): AccessDecision => resultOrThrow(validateAccessDecision(value));

const scopesFor = (decision: AccessDecision, action: AccessAction) => decision.allowedScopes.filter((entry) => entry.actions.includes(action)).map(({ scope, validUntil }) => ({ scope, validUntil }));
export const toQueryAccessView = (decision: AccessDecision): QueryAccessView => ({ state: decision.state, scopes: scopesFor(decision, 'query'), accessRevision: decision.accessRevision, factsVersion: decision.factsVersion, revocationGeneration: decision.revocationGeneration, policyVersion: decision.policyVersion, storeSetVersion: decision.storeSetVersion, expiresAt: decision.expiresAt, denyReason: decision.denyReason });
export const toDashboardSettingsView = (decision: AccessDecision): DashboardSettingsView => ({ state: decision.state === 'allowed' ? 'open' : 'closed', grants: scopesFor(decision, 'grants-manage').length > 0 ? 'open' : 'closed', accounts: scopesFor(decision, 'accounts-manage').length > 0 ? 'open' : 'closed', accessRevision: decision.accessRevision, expiresAt: decision.expiresAt, denyReason: decision.denyReason });
export const toAdminAccessView = (decision: AccessDecision): AdminAccessView => ({ state: decision.state === 'allowed' ? 'open' : 'closed', role: decision.role, grants: { state: scopesFor(decision, 'grants-manage').length > 0 ? 'open' : 'closed', scopes: scopesFor(decision, 'grants-manage') }, accounts: { state: scopesFor(decision, 'accounts-manage').length > 0 ? 'open' : 'closed', scopes: scopesFor(decision, 'accounts-manage') }, accessRevision: decision.accessRevision, policyVersion: decision.policyVersion, expiresAt: decision.expiresAt, denyReason: decision.denyReason });

function parseQueryId(value: unknown, path: string): ValidationResult<QueryId> { const parsed = stringAt(value, path); return parsed.ok ? ok(branded<QueryId>(parsed.value)) : parsed; }
function parseReleaseId(value: unknown, path: string): ValidationResult<ReleaseId> { const parsed = stringAt(value, path); return parsed.ok ? ok(branded<ReleaseId>(parsed.value)) : parsed; }
function parseCandidate(value: unknown, path: string): ValidationResult<ContentCandidate> { const s = exactRecord(value, path, ['candidateId', 'title', 'body', 'copyHandle', 'rank']); if (!s.ok) return s; for (const k of ['candidateId', 'title', 'body', 'copyHandle'] as const) { const v = stringAt(s.value[k], `${path}.${k}`); if (!v.ok) return v; } const rank = intAt(s.value.rank, `${path}.rank`, 1); if (!rank.ok || rank.value > 3) return fail(`${path}.rank`, 'expected integer from 1 through 3'); return ok(s.value as ContentCandidate); }
function parseFlow(value: unknown, path: string): ValidationResult<SopFlow> {
  const s = exactRecord(value, path, ['sopId', 'title', 'entryStepId', 'steps', 'branches']); if (!s.ok) return s;
  for (const k of ['sopId', 'title', 'entryStepId'] as const) { const v = stringAt(s.value[k], `${path}.${k}`); if (!v.ok) return v; }
  if (!Array.isArray(s.value.steps) || s.value.steps.length === 0) return fail(`${path}.steps`, 'expected non-empty array');
  const steps: SopStep[] = []; const stepIds = new Set<string>(); const decisionStepIds = new Set<string>(); const sequences = new Set<number>();
  for (let i = 0; i < s.value.steps.length; i += 1) { const step = exactRecord(s.value.steps[i], `${path}.steps[${i}]`, ['stepId', 'kind', 'sequence', 'text', 'media']); if (!step.ok) return step; if (typeof step.value.stepId !== 'string' || step.value.stepId.length === 0 || stepIds.has(step.value.stepId)) return fail(`${path}.steps[${i}].stepId`, 'unique non-empty step id required'); if (!['instruction', 'decision', 'terminal'].includes(step.value.kind as string)) return fail(`${path}.steps[${i}].kind`, 'invalid step kind'); const seq = intAt(step.value.sequence, `${path}.steps[${i}].sequence`, 1); if (!seq.ok) return seq; if (sequences.has(seq.value)) return fail(`${path}.steps[${i}].sequence`, 'step sequences must be unique'); const text = stringAt(step.value.text, `${path}.steps[${i}].text`); if (!text.ok) return text; if (!Array.isArray(step.value.media) || step.value.media.some((m) => typeof m !== 'string')) return fail(`${path}.steps[${i}].media`, 'expected string array'); stepIds.add(step.value.stepId); sequences.add(seq.value); if (step.value.kind === 'decision') decisionStepIds.add(step.value.stepId); steps.push(step.value as SopStep); }
  if (!stepIds.has(s.value.entryStepId as string)) return fail(`${path}.entryStepId`, 'must reference a step');
  if (!Array.isArray(s.value.branches)) return fail(`${path}.branches`, 'expected array'); const branches = [] as SopFlow['branches']; const branchIds = new Set<string>();
  for (let i = 0; i < s.value.branches.length; i += 1) { const branch = exactRecord(s.value.branches[i], `${path}.branches[${i}]`, ['branchId', 'sourceStepId', 'label', 'targetStepId']); if (!branch.ok) return branch; for (const k of ['branchId', 'sourceStepId', 'label', 'targetStepId'] as const) { const v = stringAt(branch.value[k], `${path}.branches[${i}].${k}`); if (!v.ok) return v; } if (branchIds.has(branch.value.branchId as string)) return fail(`${path}.branches[${i}].branchId`, 'branch ids must be unique'); if (!decisionStepIds.has(branch.value.sourceStepId as string)) return fail(`${path}.branches[${i}].sourceStepId`, 'must reference a decision step'); if (!stepIds.has(branch.value.targetStepId as string)) return fail(`${path}.branches[${i}].targetStepId`, 'must reference a step'); branchIds.add(branch.value.branchId as string); branches.push(branch.value as SopFlow['branches'][number]); }
  return ok({ sopId: s.value.sopId as string, title: s.value.title as string, entryStepId: s.value.entryStepId as string, steps, branches });
}
export function validateQueryOutcome(value: unknown): ValidationResult<QueryOutcome> {
  if (!isRecord(value) || typeof value.kind !== 'string') return fail('$', 'query outcome needs a discriminator');
  if (value.kind === 'content') { const s = exactRecord(value, '$', ['kind', 'queryId', 'releaseId', 'candidates']); if (!s.ok) return s; const q = parseQueryId(s.value.queryId, '$.queryId'); if (!q.ok) return q; const r = parseReleaseId(s.value.releaseId, '$.releaseId'); if (!r.ok) return r; if (!Array.isArray(s.value.candidates) || s.value.candidates.length === 0 || s.value.candidates.length > 3) return fail('$.candidates', 'content needs one to three candidates'); const candidates: ContentCandidate[] = []; const ranks = new Set<number>(); const copyHandles = new Set<string>(); for (let i = 0; i < s.value.candidates.length; i += 1) { const c = parseCandidate(s.value.candidates[i], `$.candidates[${i}]`); if (!c.ok) return c; if (ranks.has(c.value.rank)) return fail(`$.candidates[${i}].rank`, 'ranks must be unique'); if (copyHandles.has(c.value.copyHandle)) return fail(`$.candidates[${i}].copyHandle`, 'copy handles must be unique'); ranks.add(c.value.rank); copyHandles.add(c.value.copyHandle); candidates.push(c.value); } return ok({ kind: 'content', queryId: q.value, releaseId: r.value, candidates }); }
  if (value.kind === 'sop') { const s = exactRecord(value, '$', ['kind', 'queryId', 'releaseId', 'flow']); if (!s.ok) return s; const q = parseQueryId(s.value.queryId, '$.queryId'); if (!q.ok) return q; const r = parseReleaseId(s.value.releaseId, '$.releaseId'); if (!r.ok) return r; const f = parseFlow(s.value.flow, '$.flow'); if (!f.ok) return f; return ok({ kind: 'sop', queryId: q.value, releaseId: r.value, flow: f.value }); }
  if (value.kind === 'no-hit') { const s = exactRecord(value, '$', ['kind', 'queryId', 'reason']); if (!s.ok) return s; const q = parseQueryId(s.value.queryId, '$.queryId'); if (!q.ok) return q; const reason = stringAt(s.value.reason, '$.reason'); if (!reason.ok) return reason; return ok({ kind: 'no-hit', queryId: q.value, reason: reason.value }); }
  if (value.kind === 'failure') { const s = exactRecord(value, '$', ['kind', 'queryId', 'failureCode', 'retryable', 'message']); if (!s.ok) return s; const q = parseQueryId(s.value.queryId, '$.queryId'); if (!q.ok) return q; for (const k of ['failureCode', 'message'] as const) { const v = stringAt(s.value[k], `$.${k}`); if (!v.ok) return v; } if (typeof s.value.retryable !== 'boolean') return fail('$.retryable', 'expected boolean'); return ok({ kind: 'failure', queryId: q.value, failureCode: s.value.failureCode as string, retryable: s.value.retryable, message: s.value.message as string }); }
  return fail('$.kind', 'unknown query outcome variant');
}
export const parseQueryOutcome = (value: unknown): QueryOutcome => resultOrThrow(validateQueryOutcome(value));

export function validateOperationEnvelope(value: unknown): ValidationResult<OperationEnvelope> {
  const s = exactRecord(value, '$', ['operationId', 'actor', 'command', 'requestHash', 'idempotencyKey', 'expectedVersion', 'accessRevision', 'cancellation', 'createdAt', 'recoveryDeadline']); if (!s.ok) return s; const id = stringAt(s.value.operationId, '$.operationId'); if (!id.ok) return id; if (!isRecord(s.value.actor) || !hasOnly(s.value.actor, ['userId', 'sessionEpoch'])) return fail('$.actor', 'invalid actor'); const u = stringAt(s.value.actor.userId, '$.actor.userId'); if (!u.ok) return u; const e = intAt(s.value.actor.sessionEpoch, '$.actor.sessionEpoch', 1); if (!e.ok) return e; if (!ACCESS_ACTIONS.includes(s.value.command as AccessAction) && !['query', 'settings-preview', 'settings-save'].includes(s.value.command as string)) return fail('$.command', 'invalid command'); const hash = stringAt(s.value.requestHash, '$.requestHash'); if (!hash.ok || !/^[a-f0-9]{64}$/u.test(hash.value)) return fail('$.requestHash', 'expected lowercase SHA-256'); const idem = stringAt(s.value.idempotencyKey, '$.idempotencyKey'); if (!idem.ok) return idem; const expected = intAt(s.value.expectedVersion, '$.expectedVersion'); if (!expected.ok) return expected; const revision = intAt(s.value.accessRevision, '$.accessRevision', 1); if (!revision.ok) return revision; if (!isRecord(s.value.cancellation) || !hasOnly(s.value.cancellation, ['mode', 'deadline'])) return fail('$.cancellation', 'invalid cancellation'); if (!['cooperative', 'before-commit'].includes(s.value.cancellation.mode as string)) return fail('$.cancellation.mode', 'invalid mode'); const created = isoAt(s.value.createdAt, '$.createdAt'); if (!created.ok) return created; const deadline = isoAt(s.value.cancellation.deadline, '$.cancellation.deadline'); if (!deadline.ok || !dateOrder(created.value, deadline.value) || Date.parse(deadline.value) - Date.parse(created.value) > 300_000) return fail('$.cancellation.deadline', 'must be within a five-minute bound'); const recovery = isoAt(s.value.recoveryDeadline, '$.recoveryDeadline'); if (!recovery.ok || !dateOrder(deadline.value, recovery.value) || Date.parse(recovery.value) - Date.parse(created.value) > 86_400_000) return fail('$.recoveryDeadline', 'must be after cancellation and within one day'); return ok({ operationId: branded<OperationId>(id.value), actor: { userId: branded<UserId>(u.value), sessionEpoch: epoch(e.value) }, command: s.value.command as OperationCommand, requestHash: hash.value, idempotencyKey: idem.value, expectedVersion: expected.value, accessRevision: revision.value, cancellation: { mode: s.value.cancellation.mode as Cancellation['mode'], deadline: deadline.value }, createdAt: created.value, recoveryDeadline: recovery.value });
}
export const parseOperationEnvelope = (value: unknown): OperationEnvelope => resultOrThrow(validateOperationEnvelope(value));
export type OperationReuse = 'new' | 'replay' | 'conflict' | 'stale-session';
export function classifyOperationReuse(existing: OperationEnvelope | undefined, incoming: OperationEnvelope): OperationReuse { if (!existing) return 'new'; if (existing.actor.userId !== incoming.actor.userId || existing.command !== incoming.command || existing.requestHash !== incoming.requestHash) return 'conflict'; if (existing.actor.sessionEpoch !== incoming.actor.sessionEpoch) return 'stale-session'; return existing.operationId === incoming.operationId && existing.idempotencyKey === incoming.idempotencyKey ? 'replay' : 'conflict'; }

function parseReceipt(
  value: unknown,
  state: OperationState,
  updatedAt: string,
  path: string,
): ValidationResult<OperationReceipt | null> {
  if (state === 'unknown') return value === null ? ok(null) : fail(path, 'unknown status cannot carry a receipt');
  if (state === 'accepted' || state === 'running') return value === null ? ok(null) : fail(path, 'non-terminal status cannot carry a receipt');
  const terminal: Record<Exclude<OperationState, 'accepted' | 'running' | 'unknown'>, {
    keys: readonly string[];
    timestamp: string;
  }> = {
    committed: { keys: ['kind', 'committedAt', 'resultRef'], timestamp: 'committedAt' },
    failed: { keys: ['kind', 'failedAt', 'failureCode'], timestamp: 'failedAt' },
    cancelled: { keys: ['kind', 'cancelledAt'], timestamp: 'cancelledAt' },
    expired: { keys: ['kind', 'expiredAt'], timestamp: 'expiredAt' },
  };
  const expected = terminal[state];
  const receipt = exactRecord(value, path, expected.keys);
  if (!receipt.ok) return receipt;
  if (receipt.value.kind !== state) return fail(path, 'receipt kind must match terminal state');
  const at = isoAt(receipt.value[expected.timestamp], `${path}.${expected.timestamp}`);
  if (!at.ok) return at;
  if (Date.parse(at.value) > Date.parse(updatedAt)) return fail(path, 'receipt timestamp cannot follow updatedAt');
  if (state === 'committed') {
    const resultRef = stringAt(receipt.value.resultRef, `${path}.resultRef`);
    if (!resultRef.ok) return resultRef;
    return ok({ kind: 'committed', committedAt: at.value, resultRef: resultRef.value });
  }
  if (state === 'failed') {
    const failureCode = stringAt(receipt.value.failureCode, `${path}.failureCode`);
    if (!failureCode.ok) return failureCode;
    return ok({ kind: 'failed', failedAt: at.value, failureCode: failureCode.value });
  }
  if (state === 'cancelled') return ok({ kind: 'cancelled', cancelledAt: at.value });
  return ok({ kind: 'expired', expiredAt: at.value });
}
export function parseOperationStatus(value: unknown): OperationStatus {
  const s = exactRecord(value, '$', ['operationId', 'userId', 'sessionEpoch', 'command', 'state', 'updatedAt', 'recoveryDeadline', 'receipt']);
  if (!s.ok) throw s.error;
  const id = stringAt(s.value.operationId, '$.operationId');
  if (!id.ok) throw id.error;
  const user = stringAt(s.value.userId, '$.userId');
  if (!user.ok) throw user.error;
  const ep = intAt(s.value.sessionEpoch, '$.sessionEpoch', 1);
  if (!ep.ok) throw ep.error;
  if (!Object.hasOwn(OPERATION_TRANSITIONS, s.value.state as string)) throw new ContractValidationError('$.state', 'invalid state');
  const command = s.value.command;
  if (!ACCESS_ACTIONS.includes(command as AccessAction) && !['query', 'settings-preview', 'settings-save'].includes(command as string)) throw new ContractValidationError('$.command', 'invalid command');
  const updated = isoAt(s.value.updatedAt, '$.updatedAt');
  if (!updated.ok) throw updated.error;
  const recovery = isoAt(s.value.recoveryDeadline, '$.recoveryDeadline');
  if (!recovery.ok) throw recovery.error;
  if (Date.parse(recovery.value) < Date.parse(updated.value)) throw new ContractValidationError('$.recoveryDeadline', 'must not precede updatedAt');
  const receipt = parseReceipt(s.value.receipt, s.value.state as OperationState, updated.value, '$.receipt');
  if (!receipt.ok) throw receipt.error;
  return { operationId: branded<OperationId>(id.value), userId: branded<UserId>(user.value), sessionEpoch: epoch(ep.value), command: command as OperationCommand, state: s.value.state as OperationState, updatedAt: updated.value, recoveryDeadline: recovery.value, receipt: receipt.value };
}
export function validateOperationStatus(value: unknown): ValidationResult<OperationStatus> { try { return ok(parseOperationStatus(value)); } catch (error) { return fail(error instanceof ContractValidationError ? error.path : '$', error instanceof Error ? error.message : 'invalid operation status'); } }

function parseProjection(value: unknown, path: string): ValidationResult<ReleaseProjection> {
  const s = exactRecord(value, path, ['state', 'indexId', 'indexVersion', 'itemCount', 'indexHash']);
  if (!s.ok) return s;
  if (s.value.state !== 'ready' && s.value.state !== 'empty') return fail(`${path}.state`, 'invalid');
  const count = intAt(s.value.itemCount, `${path}.itemCount`);
  if (!count.ok) return count;
  if (s.value.state === 'ready') {
    const indexId = stringAt(s.value.indexId, `${path}.indexId`);
    if (!indexId.ok) return indexId;
    const indexHash = stringAt(s.value.indexHash, `${path}.indexHash`);
    if (!indexHash.ok) return indexHash;
    const indexVersion = intAt(s.value.indexVersion, `${path}.indexVersion`, 1);
    if (!indexVersion.ok) return indexVersion;
    return ok({
      state: 'ready',
      indexId: indexId.value,
      indexVersion: indexVersion.value,
      itemCount: count.value,
      indexHash: indexHash.value,
    });
  }
  if (s.value.indexId !== null || s.value.indexVersion !== null || s.value.indexHash !== null || count.value !== 0) return fail(path, 'empty projection must have no index or items');
  return ok({ state: 'empty', indexId: null, indexVersion: null, itemCount: 0, indexHash: null });
}
export function parseReleaseSnapshot(value: unknown): ReleaseSnapshot { const s = exactRecord(value, '$', ['releaseId', 'sequence', 'publishedAt', 'content', 'sop']); if (!s.ok) throw s.error; const id = parseReleaseId(s.value.releaseId, '$.releaseId'); if (!id.ok) throw id.error; const seq = intAt(s.value.sequence, '$.sequence', 1); if (!seq.ok) throw seq.error; const pub = isoAt(s.value.publishedAt, '$.publishedAt'); if (!pub.ok) throw pub.error; const content = parseProjection(s.value.content, '$.content'); if (!content.ok) throw content.error; const sop = parseProjection(s.value.sop, '$.sop'); if (!sop.ok) throw sop.error; return { releaseId: id.value, sequence: seq.value, publishedAt: pub.value, content: content.value, sop: sop.value }; }
export function validateReleaseSnapshot(value: unknown): ValidationResult<ReleaseSnapshot> { try { return ok(parseReleaseSnapshot(value)); } catch (error) { return fail(error instanceof ContractValidationError ? error.path : '$', error instanceof Error ? error.message : 'invalid release snapshot'); } }
export function parseOverlaySnapshot(value: unknown): OverlaySnapshot { const s = exactRecord(value, '$', ['role', 'sessionEpoch', 'generation', 'phase', 'activeSurface', 'handoffSequence', 'layoutSequence', 'releaseId']); if (!s.ok) throw s.error; if (s.value.role !== 'fox' && s.value.role !== 'query') throw new ContractValidationError('$.role', 'invalid role'); const role = s.value.role as OverlaySnapshot['role']; const ep = intAt(s.value.sessionEpoch, '$.sessionEpoch', 1); if (!ep.ok) throw ep.error; for (const k of ['generation', 'handoffSequence', 'layoutSequence'] as const) { const v = intAt(s.value[k], `$.${k}`); if (!v.ok) throw v.error; } if (!['parked', 'opening', 'active', 'closing', 'closed'].includes(s.value.phase as string)) throw new ContractValidationError('$.phase', 'invalid phase'); if (s.value.activeSurface !== role) throw new ContractValidationError('$.activeSurface', 'must match role'); const id = parseReleaseId(s.value.releaseId, '$.releaseId'); if (!id.ok) throw id.error; return { role, sessionEpoch: epoch(ep.value), generation: s.value.generation as number, phase: s.value.phase as OverlaySnapshot['phase'], activeSurface: role, handoffSequence: s.value.handoffSequence as number, layoutSequence: s.value.layoutSequence as number, releaseId: id.value }; }
export function validateOverlaySnapshot(value: unknown): ValidationResult<OverlaySnapshot> { try { return ok(parseOverlaySnapshot(value)); } catch (error) { return fail(error instanceof ContractValidationError ? error.path : '$', error instanceof Error ? error.message : 'invalid overlay snapshot'); } }

const STABLE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const KEYED_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_DURATION_MS = 86_400_000;

const tokenAt = (value: unknown, path: string, maximum = 128): ValidationResult<string> => {
  const parsed = stringAt(value, path);
  if (!parsed.ok) return parsed;
  if (parsed.value.length > maximum || !STABLE_TOKEN_PATTERN.test(parsed.value)) {
    return fail(path, `expected stable token with at most ${maximum} characters`);
  }
  return parsed;
};

const nullableTokenAt = (value: unknown, path: string, maximum = 128): ValidationResult<string | null> => (
  value === null ? ok(null) : tokenAt(value, path, maximum)
);

const enumAt = <T extends readonly string[]>(
  value: unknown,
  path: string,
  values: T,
): ValidationResult<T[number]> => (
  typeof value === 'string' && values.includes(value as T[number])
    ? ok(value as T[number])
    : fail(path, `expected one of ${values.join(', ')}`)
);

const finiteBetween = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  minimumExclusive = false,
): ValidationResult<number> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'expected finite number');
  const meetsMinimum = minimumExclusive ? value > minimum : value >= minimum;
  return meetsMinimum && value <= maximum
    ? ok(value)
    : fail(path, `expected number between ${minimumExclusive ? '(' : '['}${minimum}, ${maximum}]`);
};

const integerBetween = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): ValidationResult<number> => {
  const parsed = intAt(value, path, minimum);
  if (!parsed.ok) return parsed;
  return parsed.value <= maximum ? parsed : fail(path, `expected integer from ${minimum} through ${maximum}`);
};

export function validateTraceIdentity(value: unknown): ValidationResult<TraceIdentity> {
  const shape = exactRecord(value, '$', [
    'requestId', 'operationId', 'queryId', 'parentQueryId', 'sessionEpoch',
    'generation', 'releaseId', 'kind',
  ]);
  if (!shape.ok) return shape;

  const requestId = tokenAt(shape.value.requestId, '$.requestId');
  if (!requestId.ok) return requestId;
  const operationId = nullableTokenAt(shape.value.operationId, '$.operationId');
  if (!operationId.ok) return operationId;
  const queryId = tokenAt(shape.value.queryId, '$.queryId');
  if (!queryId.ok) return queryId;
  const parentQueryId = nullableTokenAt(shape.value.parentQueryId, '$.parentQueryId');
  if (!parentQueryId.ok) return parentQueryId;
  if (parentQueryId.value !== null && parentQueryId.value === queryId.value) {
    return fail('$.parentQueryId', 'must differ from queryId');
  }

  const hasSessionEpoch = shape.value.sessionEpoch !== null;
  const hasGeneration = shape.value.generation !== null;
  if (hasSessionEpoch !== hasGeneration) {
    return fail('$', 'sessionEpoch and generation must both be present or both be null');
  }
  let sessionCorrelation: TraceSessionCorrelation;
  if (hasSessionEpoch) {
    const parsedEpoch = intAt(shape.value.sessionEpoch, '$.sessionEpoch', 1);
    if (!parsedEpoch.ok) return parsedEpoch;
    const parsedGeneration = intAt(shape.value.generation, '$.generation', 0);
    if (!parsedGeneration.ok) return parsedGeneration;
    sessionCorrelation = {
      sessionEpoch: epoch(parsedEpoch.value),
      generation: parsedGeneration.value,
    };
  } else {
    sessionCorrelation = { sessionEpoch: null, generation: null };
  }

  const releaseId = nullableTokenAt(shape.value.releaseId, '$.releaseId');
  if (!releaseId.ok) return releaseId;
  const kind = enumAt(shape.value.kind, '$.kind', QUERY_KINDS);
  if (!kind.ok) return kind;

  return ok({
    requestId: branded<RequestId>(requestId.value),
    operationId: operationId.value === null ? null : branded<OperationId>(operationId.value),
    queryId: branded<QueryId>(queryId.value),
    parentQueryId: parentQueryId.value === null ? null : branded<QueryId>(parentQueryId.value),
    releaseId: releaseId.value === null ? null : branded<ReleaseId>(releaseId.value),
    kind: kind.value,
    ...sessionCorrelation,
  });
}

export const parseTraceIdentity = (value: unknown): TraceIdentity => resultOrThrow(validateTraceIdentity(value));

export function validateQueryTelemetryRecord(value: unknown): ValidationResult<QueryTelemetryRecord> {
  const shape = exactRecord(value, '$', [
    'trace', 'kind', 'releaseId', 'queryFingerprint', 'queryLength', 'intent',
  ]);
  if (!shape.ok) return shape;

  let trace: TraceIdentity | null = null;
  if (shape.value.trace !== null) {
    const parsedTrace = validateTraceIdentity(shape.value.trace);
    if (!parsedTrace.ok) return parsedTrace;
    trace = parsedTrace.value;
  }
  const kind = enumAt(shape.value.kind, '$.kind', QUERY_KINDS);
  if (!kind.ok) return kind;
  const releaseId = tokenAt(shape.value.releaseId, '$.releaseId');
  if (!releaseId.ok) return releaseId;
  if (typeof shape.value.queryFingerprint !== 'string'
    || !KEYED_FINGERPRINT_PATTERN.test(shape.value.queryFingerprint)) {
    return fail('$.queryFingerprint', 'expected lowercase HMAC-SHA-256 fingerprint');
  }
  const queryLength = integerBetween(shape.value.queryLength, '$.queryLength', 1, 10_000);
  if (!queryLength.ok) return queryLength;
  const intent = enumAt(shape.value.intent, '$.intent', QUERY_INTENTS);
  if (!intent.ok) return intent;

  if ((kind.value === 'sop') !== (intent.value === 'sop')) {
    return fail('$.intent', 'SOP queries use intent sop; ordinary queries do not');
  }
  if (trace !== null) {
    if (trace.kind !== kind.value) return fail('$.trace.kind', 'must match telemetry kind');
    if (trace.releaseId !== null && trace.releaseId !== releaseId.value) {
      return fail('$.trace.releaseId', 'must match telemetry releaseId');
    }
  }

  const common = {
    trace,
    releaseId: branded<ReleaseId>(releaseId.value),
    queryFingerprint: branded<KeyedQueryFingerprint>(shape.value.queryFingerprint),
    queryLength: queryLength.value,
  };
  if (kind.value === 'ordinary') {
    return ok({
      ...common,
      kind: 'ordinary',
      intent: intent.value as Exclude<QueryIntent, 'sop'>,
    });
  }
  return ok({ ...common, kind: 'sop', intent: 'sop' });
}

export const parseQueryTelemetryRecord = (value: unknown): QueryTelemetryRecord => (
  resultOrThrow(validateQueryTelemetryRecord(value))
);

const ORDINARY_ONLY_STAGES = new Set<ObservabilityStage>([
  'recall', 'fusion', 'rerank', 'response-validation',
]);
const SOP_ONLY_STAGES = new Set<ObservabilityStage>([
  'sop-match', 'sop-path-expansion', 'sop-branch-selection', 'sop-response-validation',
]);

export function validateStageRecord(value: unknown): ValidationResult<StageRecord> {
  const shape = exactRecord(value, '$', [
    'trace', 'stage', 'startedAt', 'durationMs', 'outcome', 'errorCode',
    'budgetClass', 'external',
  ]);
  if (!shape.ok) return shape;

  let trace: TraceIdentity | null = null;
  if (shape.value.trace !== null) {
    const parsedTrace = validateTraceIdentity(shape.value.trace);
    if (!parsedTrace.ok) return parsedTrace;
    trace = parsedTrace.value;
  }
  const stage = enumAt(shape.value.stage, '$.stage', OBSERVABILITY_STAGES);
  if (!stage.ok) return stage;
  const startedAt = isoAt(shape.value.startedAt, '$.startedAt');
  if (!startedAt.ok) return startedAt;
  const durationMs = finiteBetween(
    shape.value.durationMs,
    '$.durationMs',
    0,
    MAX_DURATION_MS,
  );
  if (!durationMs.ok) return durationMs;
  const outcome = enumAt(shape.value.outcome, '$.outcome', STAGE_OUTCOMES);
  if (!outcome.ok) return outcome;
  const errorCode = nullableTokenAt(shape.value.errorCode, '$.errorCode', 64);
  if (!errorCode.ok) return errorCode;
  const budgetClass = enumAt(shape.value.budgetClass, '$.budgetClass', BUDGET_CLASSES);
  if (!budgetClass.ok) return budgetClass;
  if (typeof shape.value.external !== 'boolean') return fail('$.external', 'expected boolean');

  if (outcome.value === 'succeeded' && errorCode.value !== null) {
    return fail('$.errorCode', 'successful stages cannot carry an error code');
  }
  if (outcome.value === 'failed' && errorCode.value === null) {
    return fail('$.errorCode', 'failed stages require a stable error code');
  }
  if (trace?.kind === 'ordinary' && SOP_ONLY_STAGES.has(stage.value)) {
    return fail('$.stage', 'SOP stage cannot use an ordinary trace');
  }
  if (trace?.kind === 'sop' && ORDINARY_ONLY_STAGES.has(stage.value)) {
    return fail('$.stage', 'ordinary stage cannot use a SOP trace');
  }

  const common = {
    trace,
    stage: stage.value,
    startedAt: startedAt.value,
    durationMs: durationMs.value,
    budgetClass: budgetClass.value,
    external: shape.value.external,
  };
  if (outcome.value === 'failed') {
    return ok({ ...common, outcome: 'failed', errorCode: errorCode.value as string });
  }
  if (outcome.value === 'succeeded') {
    return ok({ ...common, outcome: 'succeeded', errorCode: null });
  }
  return ok({ ...common, outcome: outcome.value, errorCode: errorCode.value });
}

export const parseStageRecord = (value: unknown): StageRecord => resultOrThrow(validateStageRecord(value));

function validateEvaluationBase(
  shape: StringRecord,
  path: string,
  kind: QueryKind,
): ValidationResult<EvaluationBase & { kind: QueryKind }> {
  const datasetId = tokenAt(shape.datasetId, `${path}.datasetId`);
  if (!datasetId.ok) return datasetId;
  const datasetVersion = integerBetween(shape.datasetVersion, `${path}.datasetVersion`, 1, 1_000_000);
  if (!datasetVersion.ok) return datasetVersion;
  const samples = integerBetween(shape.samples, `${path}.samples`, 1, 1_000_000);
  if (!samples.ok) return samples;
  const errors = integerBetween(shape.errors, `${path}.errors`, 0, samples.value);
  if (!errors.ok) return errors;
  const limiter = enumAt(shape.limiter, `${path}.limiter`, EVALUATION_LIMITERS);
  if (!limiter.ok) return limiter;
  return ok({
    kind,
    datasetId: branded<DatasetId>(datasetId.value),
    datasetVersion: datasetVersion.value,
    samples: samples.value,
    errors: errors.value,
    limiter: limiter.value,
  });
}

function validateOrdinaryMetrics(
  value: unknown,
  path: string,
  samples: number,
): ValidationResult<OrdinaryEvaluationMetrics> {
  const shape = exactRecord(value, path, [
    'recallAtK', 'topK', 'noHitCount', 'responseValidationFailureCount',
  ]);
  if (!shape.ok) return shape;
  const recallAtK = finiteBetween(shape.value.recallAtK, `${path}.recallAtK`, 0, 1);
  if (!recallAtK.ok) return recallAtK;
  const topK = integerBetween(shape.value.topK, `${path}.topK`, 1, 100);
  if (!topK.ok) return topK;
  const noHitCount = integerBetween(shape.value.noHitCount, `${path}.noHitCount`, 0, samples);
  if (!noHitCount.ok) return noHitCount;
  const responseValidationFailureCount = integerBetween(
    shape.value.responseValidationFailureCount,
    `${path}.responseValidationFailureCount`,
    0,
    samples,
  );
  if (!responseValidationFailureCount.ok) return responseValidationFailureCount;
  return ok({
    recallAtK: recallAtK.value,
    topK: topK.value,
    noHitCount: noHitCount.value,
    responseValidationFailureCount: responseValidationFailureCount.value,
  });
}

function validateSopMetrics(
  value: unknown,
  path: string,
  samples: number,
): ValidationResult<SopEvaluationMetrics> {
  const shape = exactRecord(value, path, [
    'matchedCount', 'validPathCount', 'validBranchCount',
    'staleReleaseRejectedCount', 'unauthorizedResourceRejectedCount',
  ]);
  if (!shape.ok) return shape;
  const matchedCount = integerBetween(shape.value.matchedCount, `${path}.matchedCount`, 0, samples);
  if (!matchedCount.ok) return matchedCount;
  const validPathCount = integerBetween(shape.value.validPathCount, `${path}.validPathCount`, 0, samples);
  if (!validPathCount.ok) return validPathCount;
  const validBranchCount = integerBetween(shape.value.validBranchCount, `${path}.validBranchCount`, 0, samples);
  if (!validBranchCount.ok) return validBranchCount;
  const staleReleaseRejectedCount = integerBetween(
    shape.value.staleReleaseRejectedCount,
    `${path}.staleReleaseRejectedCount`,
    0,
    samples,
  );
  if (!staleReleaseRejectedCount.ok) return staleReleaseRejectedCount;
  const unauthorizedResourceRejectedCount = integerBetween(
    shape.value.unauthorizedResourceRejectedCount,
    `${path}.unauthorizedResourceRejectedCount`,
    0,
    samples,
  );
  if (!unauthorizedResourceRejectedCount.ok) return unauthorizedResourceRejectedCount;
  return ok({
    matchedCount: matchedCount.value,
    validPathCount: validPathCount.value,
    validBranchCount: validBranchCount.value,
    staleReleaseRejectedCount: staleReleaseRejectedCount.value,
    unauthorizedResourceRejectedCount: unauthorizedResourceRejectedCount.value,
  });
}

export function validateEvaluationRecord(value: unknown): ValidationResult<EvaluationRecord> {
  if (!isRecord(value)) return fail('$', 'expected object');
  const kind = enumAt(value.kind, '$.kind', QUERY_KINDS);
  if (!kind.ok) return kind;
  const shape = exactRecord(value, '$', [
    'kind', 'datasetId', 'datasetVersion', 'samples', 'metrics', 'errors', 'limiter',
  ]);
  if (!shape.ok) return shape;
  const base = validateEvaluationBase(shape.value, '$', kind.value);
  if (!base.ok) return base;
  if (kind.value === 'ordinary') {
    const metrics = validateOrdinaryMetrics(shape.value.metrics, '$.metrics', base.value.samples);
    if (!metrics.ok) return metrics;
    return ok({ ...base.value, kind: 'ordinary', metrics: metrics.value });
  }
  const metrics = validateSopMetrics(shape.value.metrics, '$.metrics', base.value.samples);
  if (!metrics.ok) return metrics;
  return ok({ ...base.value, kind: 'sop', metrics: metrics.value });
}

export const parseEvaluationRecord = (value: unknown): EvaluationRecord => (
  resultOrThrow(validateEvaluationRecord(value))
);

export function validateAlertRecord(value: unknown): ValidationResult<AlertRecord> {
  if (!isRecord(value)) return fail('$', 'expected object');
  const kind = enumAt(value.kind, '$.kind', ALERT_KINDS);
  if (!kind.ok) return kind;

  if (kind.value === 'budget_breach') {
    const shape = exactRecord(value, '$', [
      'kind', 'observedAt', 'stage', 'budgetClass', 'percentile',
      'thresholdMs', 'observedMs', 'sampleCount',
    ]);
    if (!shape.ok) return shape;
    const observedAt = isoAt(shape.value.observedAt, '$.observedAt');
    if (!observedAt.ok) return observedAt;
    const stage = enumAt(shape.value.stage, '$.stage', OBSERVABILITY_STAGES);
    if (!stage.ok) return stage;
    const budgetClass = enumAt(shape.value.budgetClass, '$.budgetClass', BUDGET_CLASSES);
    if (!budgetClass.ok) return budgetClass;
    const percentile = enumAt(shape.value.percentile, '$.percentile', ['p50', 'p95', 'p99'] as const);
    if (!percentile.ok) return percentile;
    const thresholdMs = finiteBetween(shape.value.thresholdMs, '$.thresholdMs', 0, MAX_DURATION_MS, true);
    if (!thresholdMs.ok) return thresholdMs;
    const observedMs = finiteBetween(shape.value.observedMs, '$.observedMs', 0, MAX_DURATION_MS, true);
    if (!observedMs.ok) return observedMs;
    if (observedMs.value <= thresholdMs.value) {
      return fail('$.observedMs', 'budget breach requires observedMs above thresholdMs');
    }
    const sampleCount = integerBetween(shape.value.sampleCount, '$.sampleCount', 1, 1_000_000);
    if (!sampleCount.ok) return sampleCount;
    return ok({
      kind: 'budget_breach',
      observedAt: observedAt.value,
      stage: stage.value,
      budgetClass: budgetClass.value,
      percentile: percentile.value,
      thresholdMs: thresholdMs.value,
      observedMs: observedMs.value,
      sampleCount: sampleCount.value,
    });
  }

  if (kind.value === 'unknown_operation') {
    const shape = exactRecord(value, '$', ['kind', 'observedAt', 'operationId', 'reasonCode']);
    if (!shape.ok) return shape;
    const observedAt = isoAt(shape.value.observedAt, '$.observedAt');
    if (!observedAt.ok) return observedAt;
    const operationId = tokenAt(shape.value.operationId, '$.operationId');
    if (!operationId.ok) return operationId;
    const reasonCode = tokenAt(shape.value.reasonCode, '$.reasonCode', 64);
    if (!reasonCode.ok) return reasonCode;
    return ok({
      kind: 'unknown_operation',
      observedAt: observedAt.value,
      operationId: branded<OperationId>(operationId.value),
      reasonCode: reasonCode.value,
    });
  }

  if (kind.value === 'dead_letter_growth') {
    const shape = exactRecord(value, '$', [
      'kind', 'observedAt', 'queue', 'previousDepth', 'currentDepth',
    ]);
    if (!shape.ok) return shape;
    const observedAt = isoAt(shape.value.observedAt, '$.observedAt');
    if (!observedAt.ok) return observedAt;
    const queue = enumAt(
      shape.value.queue,
      '$.queue',
      ['content-parse', 'release-index', 'dashboard-operation'] as const,
    );
    if (!queue.ok) return queue;
    const previousDepth = integerBetween(shape.value.previousDepth, '$.previousDepth', 0, 1_000_000);
    if (!previousDepth.ok) return previousDepth;
    const currentDepth = integerBetween(shape.value.currentDepth, '$.currentDepth', 0, 1_000_000);
    if (!currentDepth.ok) return currentDepth;
    if (currentDepth.value <= previousDepth.value) {
      return fail('$.currentDepth', 'dead-letter growth requires a larger current depth');
    }
    return ok({
      kind: 'dead_letter_growth',
      observedAt: observedAt.value,
      queue: queue.value,
      previousDepth: previousDepth.value,
      currentDepth: currentDepth.value,
    });
  }

  if (kind.value === 'stale_release') {
    const shape = exactRecord(value, '$', [
      'kind', 'observedAt', 'trace', 'expectedReleaseId',
    ]);
    if (!shape.ok) return shape;
    const observedAt = isoAt(shape.value.observedAt, '$.observedAt');
    if (!observedAt.ok) return observedAt;
    const trace = validateTraceIdentity(shape.value.trace);
    if (!trace.ok) return trace;
    if (trace.value.releaseId === null) return fail('$.trace.releaseId', 'stale release requires a trace release');
    const expectedReleaseId = tokenAt(shape.value.expectedReleaseId, '$.expectedReleaseId');
    if (!expectedReleaseId.ok) return expectedReleaseId;
    if (trace.value.releaseId === expectedReleaseId.value) {
      return fail('$.expectedReleaseId', 'must differ from the stale trace release');
    }
    return ok({
      kind: 'stale_release',
      observedAt: observedAt.value,
      trace: trace.value,
      expectedReleaseId: branded<ReleaseId>(expectedReleaseId.value),
    });
  }

  const shape = exactRecord(value, '$', [
    'kind', 'observedAt', 'releaseId', 'projection', 'errorCode',
  ]);
  if (!shape.ok) return shape;
  const observedAt = isoAt(shape.value.observedAt, '$.observedAt');
  if (!observedAt.ok) return observedAt;
  const releaseId = tokenAt(shape.value.releaseId, '$.releaseId');
  if (!releaseId.ok) return releaseId;
  const projection = enumAt(shape.value.projection, '$.projection', ['content', 'sop'] as const);
  if (!projection.ok) return projection;
  const errorCode = tokenAt(shape.value.errorCode, '$.errorCode', 64);
  if (!errorCode.ok) return errorCode;
  return ok({
    kind: 'release_index_failure',
    observedAt: observedAt.value,
    releaseId: branded<ReleaseId>(releaseId.value),
    projection: projection.value,
    errorCode: errorCode.value,
  });
}

export const parseAlertRecord = (value: unknown): AlertRecord => resultOrThrow(validateAlertRecord(value));

export function renderPolicyMatrixJson(): string {
  return `${JSON.stringify({
    version: 2,
    runtimeAuthority: 'database',
    roleCeiling: ROLE_CEILING_POLICY,
    entries: AUTHORIZATION_MATRIX,
  }, null, 2)}\n`;
}
export function renderRoleCeilingSeedSql(): string {
  const rows = ROLE_CEILING_POLICY.map((entry) => {
    const actions = entry.businessActions.map((action) => `'${action}'`).join(',');
    return `  ('${entry.role}', ARRAY[${actions}], ${entry.mayAllocate}, ${entry.mayDelegate}, ${entry.maySkipImportParent})`;
  });
  return `-- GENERATED FILE. DO NOT EDIT. Source: packages/unified-contracts/src/index.ts
INSERT INTO content_intake.role_ceiling (role, business_actions, may_allocate, may_delegate, may_skip_import_parent) VALUES
${rows.join(',\n')}
ON CONFLICT (role) DO UPDATE SET business_actions = EXCLUDED.business_actions, may_allocate = EXCLUDED.may_allocate, may_delegate = EXCLUDED.may_delegate, may_skip_import_parent = EXCLUDED.may_skip_import_parent;
`;
}
