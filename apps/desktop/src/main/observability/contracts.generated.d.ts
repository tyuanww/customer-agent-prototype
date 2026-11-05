/**
 * Generated from @customer-agent/unified-contracts by
 * scripts/observability/sync-contract-types.ts. Do not edit.
 * Source SHA-256: 84e2ec8b4147a92e6b82c3f38cbba2627492be868119246cddad4b5747d47aba
 */

/**
 * Handwritten cross-service contracts for the unified architecture program.
 *
 * `packages/contracts` remains the owner of the frozen upstream OpenAPI
 * snapshot. This package owns the decision, query, operation, release, and
 * overlay semantics that are not generated from that snapshot.
 */
export type Brand<T, Name extends string> = T & {
    readonly __brand: Name;
};
export type UserId = Brand<string, 'UserId'>;
export type SessionEpoch = Brand<number, 'SessionEpoch'>;
export type ReleaseId = Brand<string, 'ReleaseId'>;
export type OperationId = Brand<string, 'OperationId'>;
export type QueryId = Brand<string, 'QueryId'>;
export type RequestId = Brand<string, 'RequestId'>;
export type DatasetId = Brand<string, 'DatasetId'>;
export type KeyedQueryFingerprint = Brand<string, 'KeyedQueryFingerprint'>;
export declare const QUERY_KINDS: readonly ["ordinary", "sop"];
export type QueryKind = (typeof QUERY_KINDS)[number];
export declare const QUERY_INTENTS: readonly ["product", "activity", "after-sale", "sop", "general", "unknown"];
export type QueryIntent = (typeof QUERY_INTENTS)[number];
export declare const OBSERVABILITY_STAGES: readonly ["request", "access", "release-read", "recall", "fusion", "rerank", "response-validation", "transport", "sop-match", "sop-path-expansion", "sop-branch-selection", "sop-response-validation", "copy", "dashboard-operation", "content-parse", "content-publish", "release-invalidation"];
export type ObservabilityStage = (typeof OBSERVABILITY_STAGES)[number];
export declare const STAGE_OUTCOMES: readonly ["succeeded", "failed", "cancelled", "stale", "unknown"];
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];
export declare const BUDGET_CLASSES: readonly ["interactive", "background", "maintenance"];
export type BudgetClass = (typeof BUDGET_CLASSES)[number];
export declare const EVALUATION_LIMITERS: readonly ["none", "dataset-size", "concurrency", "time-budget", "external-model"];
export type EvaluationLimiter = (typeof EVALUATION_LIMITERS)[number];
export declare const ALERT_KINDS: readonly ["budget_breach", "unknown_operation", "dead_letter_growth", "stale_release", "release_index_failure"];
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AccessRole = (typeof ACCESS_ROLES)[number];
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type ScopeKind = 'tenant' | 'brand' | 'shop' | 'source';
export type Domain = 'product' | 'activity' | 'after-sale' | 'aftersale' | 'general';
export declare const ACCESS_ROLES: readonly ["agent", "director", "enabler", "engineer", "lead", "manager", "supervisor"];
export declare const ACCESS_ACTIONS: readonly ["query", "content-manage", "import", "source-confirm", "review", "publish", "candidate-cancel", "rollback", "dashboard-read", "grants-manage", "accounts-manage"];
declare const _DENY_REASONS: readonly ["MISSING_PRINCIPAL", "AMBIGUOUS_ROLE", "ROLE_CEILING", "EXPIRED_GRANT", "REVOKED_GRANT", "EXPIRED_FACTS", "SOURCE_OUTSIDE_SET", "STORE_SET_CHANGED", "SESSION_EXPIRED", "POLICY_DENIED"];
export type DenyReason = (typeof _DENY_REASONS)[number];
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
    scopes: Array<{
        scope: Scope;
        validUntil: string;
    }>;
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
    grants: {
        state: 'open' | 'closed';
        scopes: Array<{
            scope: Scope;
            validUntil: string;
        }>;
    };
    accounts: {
        state: 'open' | 'closed';
        scopes: Array<{
            scope: Scope;
            validUntil: string;
        }>;
    };
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
export type QueryOutcome = {
    kind: 'content';
    queryId: QueryId;
    releaseId: ReleaseId;
    candidates: ContentCandidate[];
} | {
    kind: 'sop';
    queryId: QueryId;
    releaseId: ReleaseId;
    flow: SopFlow;
} | {
    kind: 'no-hit';
    queryId: QueryId;
    reason: string;
} | {
    kind: 'failure';
    queryId: QueryId;
    failureCode: string;
    retryable: boolean;
    message: string;
};
export type OperationCommand = AccessAction | 'query' | 'settings-preview' | 'settings-save';
export type Cancellation = {
    mode: 'cooperative' | 'before-commit';
    deadline: string;
};
export type OperationEnvelope = {
    operationId: OperationId;
    actor: {
        userId: UserId;
        sessionEpoch: SessionEpoch;
    };
    command: OperationCommand;
    requestHash: string;
    idempotencyKey: string;
    expectedVersion: number;
    accessRevision: number;
    cancellation: Cancellation;
    createdAt: string;
    recoveryDeadline: string;
};
export declare const OPERATION_TRANSITIONS: {
    readonly accepted: readonly ["running", "cancelled", "failed", "unknown"];
    readonly running: readonly ["committed", "cancelled", "failed", "unknown"];
    readonly unknown: readonly ["committed", "cancelled", "failed", "expired"];
    readonly committed: readonly [];
    readonly failed: readonly [];
    readonly cancelled: readonly [];
    readonly expired: readonly [];
};
export type OperationState = keyof typeof OPERATION_TRANSITIONS;
export type OperationReceipt = {
    kind: 'committed';
    committedAt: string;
    resultRef: string;
} | {
    kind: 'failed';
    failedAt: string;
    failureCode: string;
} | {
    kind: 'cancelled';
    cancelledAt: string;
} | {
    kind: 'expired';
    expiredAt: string;
};
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
type TraceSessionCorrelation = {
    sessionEpoch: SessionEpoch;
    generation: number;
} | {
    sessionEpoch: null;
    generation: null;
};
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
export type QueryTelemetryRecord = (QueryTelemetryBase & {
    kind: 'ordinary';
    intent: Exclude<QueryIntent, 'sop'>;
}) | (QueryTelemetryBase & {
    kind: 'sop';
    intent: 'sop';
});
type StageRecordBase = {
    trace: TraceIdentity | null;
    stage: ObservabilityStage;
    startedAt: string;
    durationMs: number;
    budgetClass: BudgetClass;
    external: boolean;
};
type StageErrorState = {
    outcome: 'failed';
    errorCode: string;
} | {
    outcome: 'succeeded';
    errorCode: null;
} | {
    outcome: 'cancelled' | 'stale' | 'unknown';
    errorCode: string | null;
};
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
export type EvaluationRecord = (EvaluationBase & {
    kind: 'ordinary';
    metrics: OrdinaryEvaluationMetrics;
}) | (EvaluationBase & {
    kind: 'sop';
    metrics: SopEvaluationMetrics;
});
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
export type AlertRecord = BudgetBreachAlert | UnknownOperationAlert | DeadLetterGrowthAlert | StaleReleaseAlert | ReleaseIndexFailureAlert;
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
/**
 * The canonical values mirror `content_intake.role_ceiling`. The database
 * remains the runtime authority; this data only generates reviewable seed SQL
 * and derives the local ACL shape used by contract validation.
 */
export declare const ROLE_CEILING_POLICY: readonly RoleCeilingPolicy[];
export declare const AUTHORIZATION_MATRIX: readonly AuthorizationMatrixEntry[];
export declare class ContractValidationError extends Error {
    readonly path: string;
    constructor(path: string, message: string);
}
type ValidationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: ContractValidationError;
};
export declare function validateAccessDecision(value: unknown): ValidationResult<AccessDecision>;
export declare const parseAccessDecision: (value: unknown) => AccessDecision;
export declare const toQueryAccessView: (decision: AccessDecision) => QueryAccessView;
export declare const toDashboardSettingsView: (decision: AccessDecision) => DashboardSettingsView;
export declare const toAdminAccessView: (decision: AccessDecision) => AdminAccessView;
export declare function validateQueryOutcome(value: unknown): ValidationResult<QueryOutcome>;
export declare const parseQueryOutcome: (value: unknown) => QueryOutcome;
export declare function validateOperationEnvelope(value: unknown): ValidationResult<OperationEnvelope>;
export declare const parseOperationEnvelope: (value: unknown) => OperationEnvelope;
export type OperationReuse = 'new' | 'replay' | 'conflict' | 'stale-session';
export declare function classifyOperationReuse(existing: OperationEnvelope | undefined, incoming: OperationEnvelope): OperationReuse;
export declare function parseOperationStatus(value: unknown): OperationStatus;
export declare function validateOperationStatus(value: unknown): ValidationResult<OperationStatus>;
export declare function parseReleaseSnapshot(value: unknown): ReleaseSnapshot;
export declare function validateReleaseSnapshot(value: unknown): ValidationResult<ReleaseSnapshot>;
export declare function parseOverlaySnapshot(value: unknown): OverlaySnapshot;
export declare function validateOverlaySnapshot(value: unknown): ValidationResult<OverlaySnapshot>;
export declare function validateTraceIdentity(value: unknown): ValidationResult<TraceIdentity>;
export declare const parseTraceIdentity: (value: unknown) => TraceIdentity;
export declare function validateQueryTelemetryRecord(value: unknown): ValidationResult<QueryTelemetryRecord>;
export declare const parseQueryTelemetryRecord: (value: unknown) => QueryTelemetryRecord;
export declare function validateStageRecord(value: unknown): ValidationResult<StageRecord>;
export declare const parseStageRecord: (value: unknown) => StageRecord;
export declare function validateEvaluationRecord(value: unknown): ValidationResult<EvaluationRecord>;
export declare const parseEvaluationRecord: (value: unknown) => EvaluationRecord;
export declare function validateAlertRecord(value: unknown): ValidationResult<AlertRecord>;
export declare const parseAlertRecord: (value: unknown) => AlertRecord;
export declare function renderPolicyMatrixJson(): string;
export declare function renderRoleCeilingSeedSql(): string;
export {};
