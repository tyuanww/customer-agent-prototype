import { describe, expect, it } from 'vitest';
import {
  ContractValidationError,
  OPERATION_TRANSITIONS,
  classifyOperationReuse,
  parseAccessDecision,
  parseOperationEnvelope,
  parseOperationStatus,
  parseOverlaySnapshot,
  parseQueryOutcome,
  parseReleaseSnapshot,
  toAdminAccessView,
  toDashboardSettingsView,
  toQueryAccessView,
  validateAccessDecision,
  validateQueryOutcome,
} from '../src/index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RESOLVED_AT = '2026-11-05T08:00:00Z';
const EXPIRES_AT = '2026-11-05T09:00:00Z';

function accessDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'user-owner',
    role: 'director',
    state: 'allowed',
    allowedScopes: [
      {
        scope: {
          kind: 'source',
          tenantId: 'tenant-a',
          appId: 'app-a',
          brandId: 'brand-a',
          shopId: 'shop-a',
          domain: 'aftersale',
          sourceId: 'source-a',
        },
        actions: ['query', 'publish', 'grants-manage'],
        validUntil: EXPIRES_AT,
      },
      {
        scope: { kind: 'tenant', tenantId: 'tenant-a', appId: 'app-a' },
        actions: ['accounts-manage'],
        validUntil: EXPIRES_AT,
      },
    ],
    accessRevision: 12,
    factsVersion: 8,
    revocationGeneration: 3,
    policyVersion: 5,
    storeSetVersion: 4,
    resolvedAt: RESOLVED_AT,
    expiresAt: EXPIRES_AT,
    denyReason: null,
    ...overrides,
  };
}

function contentOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'content',
    queryId: 'query-1',
    releaseId: 'release-2',
    candidates: [
      {
        candidateId: 'script-1',
        title: '合成发货说明',
        body: '合成正文，只用于合同测试。',
        copyHandle: 'copy-1',
        rank: 1,
      },
    ],
    ...overrides,
  };
}

function sopOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'sop',
    queryId: 'query-2',
    releaseId: 'release-2',
    flow: {
      sopId: 'sop-allergy',
      title: '过敏流程SOP',
      entryStepId: 'step-1',
      steps: [
        {
          stepId: 'step-1',
          kind: 'decision',
          sequence: 1,
          text: '先确认是否过敏。',
          media: [],
        },
      ],
      branches: [
        { branchId: 'branch-a', sourceStepId: 'step-1', label: '是', targetStepId: 'step-1' },
      ],
    },
    ...overrides,
  };
}

function operationEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: 'operation-1',
    actor: { userId: 'user-owner', sessionEpoch: 7 },
    command: 'publish',
    requestHash: HASH_A,
    idempotencyKey: 'idempotency-1',
    expectedVersion: 3,
    accessRevision: 12,
    cancellation: {
      mode: 'before-commit',
      deadline: '2026-11-05T08:00:10Z',
    },
    createdAt: '2026-11-05T08:00:00Z',
    recoveryDeadline: '2026-11-05T08:05:00Z',
    ...overrides,
  };
}

describe('AccessDecision and minimal projections', () => {
  it('parses one decision model and derives least-privilege projections', () => {
    const decision = parseAccessDecision(accessDecision());

    expect(toQueryAccessView(decision)).toEqual({
      state: 'allowed',
      scopes: [{
        scope: {
          kind: 'source',
          tenantId: 'tenant-a',
          appId: 'app-a',
          brandId: 'brand-a',
          shopId: 'shop-a',
          domain: 'aftersale',
          sourceId: 'source-a',
        },
        validUntil: EXPIRES_AT,
      }],
      accessRevision: 12,
      factsVersion: 8,
      revocationGeneration: 3,
      policyVersion: 5,
      storeSetVersion: 4,
      expiresAt: EXPIRES_AT,
      denyReason: null,
    });
    expect(toDashboardSettingsView(decision)).toEqual({
      state: 'open',
      grants: 'open',
      accounts: 'open',
      accessRevision: 12,
      expiresAt: EXPIRES_AT,
      denyReason: null,
    });
    expect(toAdminAccessView(decision)).toEqual({
      state: 'open',
      role: 'director',
      grants: {
        state: 'open',
        scopes: [{
          scope: {
            kind: 'source',
            tenantId: 'tenant-a',
            appId: 'app-a',
            brandId: 'brand-a',
            shopId: 'shop-a',
            domain: 'aftersale',
            sourceId: 'source-a',
          },
          validUntil: EXPIRES_AT,
        }],
      },
      accounts: {
        state: 'open',
        scopes: [{
          scope: { kind: 'tenant', tenantId: 'tenant-a', appId: 'app-a' },
          validUntil: EXPIRES_AT,
        }],
      },
      accessRevision: 12,
      policyVersion: 5,
      expiresAt: EXPIRES_AT,
      denyReason: null,
    });
  });

  it('derives settings projections from the actions actually granted', () => {
    const decision = parseAccessDecision(accessDecision({
      userId: 'user-engineer',
      role: 'engineer',
      allowedScopes: [{
        scope: { kind: 'tenant', tenantId: 'tenant-a', appId: 'app-a' },
        actions: ['accounts-manage'],
        validUntil: EXPIRES_AT,
      }],
    }));

    expect(toDashboardSettingsView(decision)).toMatchObject({
      state: 'open',
      grants: 'closed',
      accounts: 'open',
    });
    expect(toQueryAccessView(decision).scopes).toEqual([]);
    expect(toAdminAccessView(decision)).toMatchObject({
      grants: { state: 'closed', scopes: [] },
      accounts: { state: 'open' },
    });
  });

  it('rejects administration actions in Query projections and ambiguous decisions', () => {
    const invalid = accessDecision({
      allowedScopes: [{
        scope: { kind: 'tenant', tenantId: 'tenant-a', appId: 'app-a' },
        actions: ['query'],
        validUntil: EXPIRES_AT,
      }],
    });
    expect(validateAccessDecision(invalid).ok).toBe(false);

    for (const change of [
      { state: 'denied', denyReason: null },
      { state: 'allowed', denyReason: 'EXPIRED_FACTS' },
      { state: 'allowed', allowedScopes: [] },
      { expiresAt: RESOLVED_AT },
      { role: 'agent', allowedScopes: [{
        scope: { kind: 'tenant', tenantId: 'tenant-a', appId: 'app-a' },
        actions: ['accounts-manage'],
        validUntil: EXPIRES_AT,
      }] },
      { unexpected: true },
    ]) {
      expect(validateAccessDecision(accessDecision(change)).ok).toBe(false);
    }
  });

  it('rejects fields hidden by the conditional scope kind', () => {
    for (const scope of [
      {
        kind: 'tenant',
        tenantId: 'tenant-a',
        appId: 'app-a',
        shopId: 'shop-a',
        domain: 'aftersale',
        sourceId: 'source-a',
      },
      {
        kind: 'brand',
        tenantId: 'tenant-a',
        appId: 'app-a',
        brandId: 'brand-a',
        domain: 'aftersale',
        sourceId: 'source-a',
      },
      {
        kind: 'shop',
        tenantId: 'tenant-a',
        appId: 'app-a',
        brandId: 'brand-a',
        shopId: 'shop-a',
        sourceId: 'source-a',
      },
    ]) {
      expect(validateAccessDecision(accessDecision({
        allowedScopes: [{
          scope,
          actions: ['query'],
          validUntil: EXPIRES_AT,
        }],
      })).ok).toBe(false);
    }
  });
});

describe('QueryOutcome', () => {
  it.each([
    ['content', contentOutcome()],
    ['sop', sopOutcome()],
    ['no-hit', { kind: 'no-hit', queryId: 'query-3', reason: 'no-authorized-match' }],
    ['failure', {
      kind: 'failure',
      queryId: 'query-4',
      failureCode: 'UNAVAILABLE',
      retryable: true,
      message: '服务暂不可用，请重试',
    }],
  ])('accepts the %s variant', (_name, value) => {
    expect(parseQueryOutcome(value)).toEqual(value);
  });

  it('rejects mixed and ambiguous variants', () => {
    for (const value of [
      contentOutcome({ flow: sopOutcome().flow }),
      sopOutcome({ candidates: contentOutcome().candidates }),
      { ...contentOutcome(), kind: 'content-sop' },
      { ...contentOutcome(), candidates: [] },
      sopOutcome({
        flow: {
          ...(sopOutcome().flow as Record<string, unknown>),
          branches: [{
            branchId: 'branch-a',
            sourceStepId: 'step-1',
            label: '是',
            targetStepId: 'missing-step',
          }],
        },
      }),
    ]) {
      expect(validateQueryOutcome(value).ok).toBe(false);
    }
  });

  it('requires unique Top 3 ranks and copy handles', () => {
    const first = (contentOutcome().candidates as Array<Record<string, unknown>>)[0];
    for (const candidates of [
      [first, { ...first, candidateId: 'script-2' }],
      [first, { ...first, candidateId: 'script-2', rank: 2 }],
      [first, { ...first, candidateId: 'script-2', copyHandle: 'copy-2', rank: 4 }],
      [first, { ...first, candidateId: 'script-2', copyHandle: 'copy-2', rank: 2 },
        { ...first, candidateId: 'script-3', copyHandle: 'copy-3', rank: 3 },
        { ...first, candidateId: 'script-4', copyHandle: 'copy-4', rank: 4 }],
    ]) {
      expect(validateQueryOutcome(contentOutcome({ candidates })).ok).toBe(false);
    }
  });

  it('binds each branch to a decision source and keeps branch and sequence identities unique', () => {
    const flow = sopOutcome().flow as Record<string, unknown>;
    const branches = flow.branches as Array<Record<string, unknown>>;
    for (const value of [
      sopOutcome({
        flow: {
          ...flow,
          steps: [
            ...(flow.steps as Array<Record<string, unknown>>),
            { stepId: 'step-2', kind: 'instruction', sequence: 2, text: '补凭证。', media: [] },
          ],
          branches: [{ ...branches[0], sourceStepId: 'step-2' }],
        },
      }),
      sopOutcome({
        flow: {
          ...flow,
          branches: [
            branches[0],
            { ...branches[0], sourceStepId: 'step-1' },
          ],
        },
      }),
      sopOutcome({
        flow: {
          ...flow,
          steps: [
            ...(flow.steps as Array<Record<string, unknown>>),
            { stepId: 'step-2', kind: 'terminal', sequence: 1, text: '结束。', media: [] },
          ],
        },
      }),
      sopOutcome({
        flow: {
          ...flow,
          branches: [{ branchId: 'branch-a', label: '是', targetStepId: 'step-1' }],
        },
      }),
    ]) {
      expect(validateQueryOutcome(value).ok).toBe(false);
    }
  });
});

describe('OperationEnvelope and durable status', () => {
  it('binds actor, command, request hash, epoch, version, access revision, and recovery', () => {
    const envelope = parseOperationEnvelope(operationEnvelope());
    expect(envelope.actor).toEqual({ userId: 'user-owner', sessionEpoch: 7 });
    expect(envelope.recoveryDeadline).toBe('2026-11-05T08:05:00Z');
    expect(classifyOperationReuse(undefined, envelope)).toBe('new');
    expect(classifyOperationReuse(envelope, envelope)).toBe('replay');
    expect(classifyOperationReuse(envelope, parseOperationEnvelope(operationEnvelope({
      requestHash: HASH_B,
    })))).toBe('conflict');
    expect(classifyOperationReuse(envelope, parseOperationEnvelope(operationEnvelope({
      actor: { userId: 'user-other', sessionEpoch: 7 },
    })))).toBe('conflict');
    expect(classifyOperationReuse(envelope, parseOperationEnvelope(operationEnvelope({
      actor: { userId: 'user-owner', sessionEpoch: 8 },
    })))).toBe('stale-session');
  });

  it('defines every legal transition and no implicit terminal recovery success', () => {
    expect(OPERATION_TRANSITIONS.accepted).toEqual(['running', 'cancelled', 'failed', 'unknown']);
    expect(OPERATION_TRANSITIONS.running).toEqual(['committed', 'cancelled', 'failed', 'unknown']);
    expect(OPERATION_TRANSITIONS.unknown).toEqual(['committed', 'cancelled', 'failed', 'expired']);
    expect(OPERATION_TRANSITIONS.committed).toEqual([]);
    expect(OPERATION_TRANSITIONS.failed).toEqual([]);
    expect(OPERATION_TRANSITIONS.cancelled).toEqual([]);
    expect(OPERATION_TRANSITIONS.expired).toEqual([]);
  });

  it('requires terminal receipts and keeps unknown receipt-free', () => {
    const base = {
      operationId: 'operation-1',
      userId: 'user-owner',
      sessionEpoch: 7,
      command: 'publish',
      updatedAt: '2026-11-05T08:00:01Z',
      recoveryDeadline: '2026-11-05T08:05:00Z',
    };
    expect(parseOperationStatus({
      ...base,
      state: 'committed',
      receipt: {
        kind: 'committed',
        committedAt: '2026-11-05T08:00:01Z',
        resultRef: 'release-2',
      },
    }).state).toBe('committed');
    expect(parseOperationStatus({ ...base, state: 'unknown', receipt: null }).state).toBe('unknown');
    for (const value of [
      { ...base, state: 'committed', receipt: null },
      { ...base, state: 'unknown', receipt: { kind: 'committed', committedAt: base.updatedAt, resultRef: null } },
      { ...base, state: 'failed', receipt: { kind: 'cancelled', cancelledAt: base.updatedAt } },
      { ...base, state: 'committed', receipt: {
        kind: 'committed',
        committedAt: base.updatedAt,
        resultRef: 'release-2',
        extra: true,
      } },
      { ...base, state: 'cancelled', receipt: { kind: 'cancelled', cancelledAt: 'not-a-time' } },
      { ...base, state: 'failed', receipt: { kind: 'failed', failedAt: base.updatedAt } },
      { ...base, state: 'expired', receipt: { kind: 'cancelled', cancelledAt: base.updatedAt } },
    ]) {
      expect(() => parseOperationStatus(value)).toThrow(ContractValidationError);
    }
    expect(parseOperationStatus({
      ...base,
      state: 'expired',
      receipt: { kind: 'expired', expiredAt: base.updatedAt },
    }).state).toBe('expired');
    for (const value of [
      { ...base, state: 'unknown', updatedAt: '2026-02-30T08:00:00Z', receipt: null },
      { ...base, state: 'unknown', recoveryDeadline: '2026-11-05T07:59:59Z', receipt: null },
      { ...base, state: 'committed', receipt: {
        kind: 'committed',
        committedAt: '2026-11-05T08:00:02Z',
        resultRef: 'release-2',
      } },
    ]) {
      expect(() => parseOperationStatus(value)).toThrow(ContractValidationError);
    }
  });

  it('rejects malformed operation identities and unbounded timing', () => {
    for (const value of [
      operationEnvelope({ requestHash: 'ABC' }),
      operationEnvelope({ expectedVersion: -1 }),
      operationEnvelope({ accessRevision: 0 }),
      operationEnvelope({ recoveryDeadline: '2026-11-05T08:00:00Z' }),
      operationEnvelope({ cancellation: { mode: 'before-commit', deadline: '2026-11-05T08:06:00Z' } }),
      operationEnvelope({ actor: { userId: 'user-owner', sessionEpoch: 0 } }),
    ]) {
      expect(() => parseOperationEnvelope(value)).toThrow(ContractValidationError);
    }
  });
});

describe('ReleaseSnapshot and OverlaySnapshot', () => {
  it('keeps one release identity with separate content and SOP projections', () => {
    const release = {
      releaseId: 'release-2',
      sequence: 2,
      publishedAt: RESOLVED_AT,
      content: {
        state: 'ready',
        indexId: 'content-index-2',
        indexVersion: 1,
        itemCount: 152,
        indexHash: HASH_A,
      },
      sop: {
        state: 'empty',
        indexId: null,
        indexVersion: null,
        itemCount: 0,
        indexHash: null,
      },
    };
    expect(parseReleaseSnapshot(release)).toEqual(release);
    expect(() => parseReleaseSnapshot({
      ...release,
      sop: { ...release.content, state: 'ready' },
      content: { ...release.sop, state: 'empty' },
      contentReleaseId: 'other-release',
    })).toThrow(ContractValidationError);
  });

  it('requires non-empty ready identity and strips all identity from an empty projection', () => {
    const release = {
      releaseId: 'release-2',
      sequence: 2,
      publishedAt: RESOLVED_AT,
      content: {
        state: 'ready',
        indexId: 'content-index-2',
        indexVersion: 1,
        itemCount: 152,
        indexHash: HASH_A,
      },
      sop: {
        state: 'empty',
        indexId: null,
        indexVersion: null,
        itemCount: 0,
        indexHash: null,
      },
    };
    for (const content of [
      { ...release.content, indexId: '' },
      { ...release.content, indexHash: '' },
      { ...release.content, indexVersion: 0 },
      { ...release.content, indexVersion: -1 },
    ]) {
      expect(() => parseReleaseSnapshot({ ...release, content })).toThrow(ContractValidationError);
    }
    expect(() => parseReleaseSnapshot({
      ...release,
      sop: { ...release.sop, itemCount: 1 },
    })).toThrow(ContractValidationError);
    expect(() => parseReleaseSnapshot({
      ...release,
      sop: { ...release.content, state: 'empty' },
    })).toThrow(ContractValidationError);
  });

  it('requires one epoch-bound overlay snapshot with monotonic generations', () => {
    const snapshot = {
      role: 'query',
      sessionEpoch: 7,
      generation: 4,
      phase: 'active',
      activeSurface: 'query',
      handoffSequence: 3,
      layoutSequence: 2,
      releaseId: 'release-2',
    };
    expect(parseOverlaySnapshot(snapshot)).toEqual(snapshot);
    for (const value of [
      { ...snapshot, sessionEpoch: 0 },
      { ...snapshot, generation: -1 },
      { ...snapshot, phase: 'unknown' },
      { ...snapshot, activeSurface: 'dashboard', role: 'fox' },
      { ...snapshot, candidateText: 'mixed state' },
    ]) {
      expect(() => parseOverlaySnapshot(value)).toThrow(ContractValidationError);
    }
  });
});
