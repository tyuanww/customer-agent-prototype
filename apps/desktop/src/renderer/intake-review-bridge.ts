import type { IntakeManagementView } from '@shared/content-intake-management';
import type { IntakePermissionView } from '@shared/content-intake-permissions';
import type { SeatAccountIntent, SeatAccountRecord, SeatAccountReply } from '@shared/seat-account-intent';

const REVIEW_HOSTS = new Set(['127.0.0.1', 'localhost']);

function candidate(sourceId: string, state: 'awaiting-evidence' | 'publishing' | 'published'): IntakeManagementView['candidates'][number]['candidate'] {
  return {
    key: { candidateId: `candidate-${sourceId}`, version: 1, digest: 'a'.repeat(64) },
    sourceId,
    publicationPolicy: 'direct-v1',
    state,
    readinessReasons: state === 'awaiting-evidence' ? ['SOURCE_CONFIRMATION_REQUIRED'] : [],
    sourceEvidenceVersion: state === 'awaiting-evidence' ? 0 : 1,
    approvalEvidenceVersion: 0,
    revocationGeneration: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    publishedReleaseId: state === 'published' ? 'rel_2' : null,
  };
}

function managementView(): IntakeManagementView {
  return {
    rollback: { available: true, impact: null, review: null, pending: null, result: null, hasReview: false, canExecute: false },
    upload: {
      draftRevision: 0, phase: 'idle', busy: false, authorized: true, validUntil: '2099-01-01T00:00:00.000Z',
      revisionOf: null,
      sources: [{ selection: 'source-sel-a', label: 'source-a · shop-a', domain: 'product' }],
      sourceSelection: null, file: null, principals: [],
      preparerSelection: null, editorSelections: [], confirmed: false, pending: null, job: null,
      canChoose: true, canSubmit: false, canRetry: false, canRefresh: true,
      canStop: false, canSaveReport: false, canOpen: false, canReset: false, notice: null,
    },
    signedIn: true, displayName: '合成审核员', authorized: true, validUntil: '2099-01-01T00:00:00.000Z',
    candidates: [
      { selection: 'row-open', scopeLabel: 'shop-a · 产品', candidate: candidate('source-a', 'awaiting-evidence') },
      { selection: 'row-publishing', scopeLabel: '品牌通用 · 售后', candidate: candidate('source-b', 'publishing') },
      { selection: 'row-published', scopeLabel: 'shop-b · 活动', candidate: candidate('source-c', 'published') },
    ],
    moreCandidates: false, selected: null, material: null,
    canReview: false, quality: null, hasDraft: false,
    canConfirmSource: false, canPublish: false, canRevise: false, canCancel: false,
    review: null, workflowResult: null, pending: null, receipt: null,
  };
}

function permissionView(): IntakePermissionView {
  const until = '2099-01-01T00:00:00.000Z';
  return {
    signedIn: true, available: true, busy: false, validUntil: until,
    sources: [{ selection: 'scope-1', label: 'shop-a · 产品 · source-a' }],
    source: 'scope-1',
    people: [
      { selection: 'person-a', label: '合成坐席' },
      { selection: 'person-b', label: '合成坐席' },
    ],
    actions: ['query', 'content-manage', 'import', 'source-confirm', 'publish'],
    grants: [{
      selection: 'grant-1', reference: 'grant-demo', person: '合成坐席', personSelection: 'person-a',
      action: 'query', scope: 'shop-a · 产品 · source-a', startsAt: '2026-10-08T02:00:00.000Z',
      reason: '预览夹具', expiresAt: '2026-10-09T02:00:00.000Z', revoked: false, canRevoke: true,
    }],
    preview: null, pending: false, resultUnknown: false, notice: null,
  };
}

/** Local layout fixture for the materials and permissions pages. It never reads the account file or the database. */
export function installIntakeReviewBridge(location: Location = window.location): boolean {
  if (!REVIEW_HOSTS.has(location.hostname) || new URLSearchParams(location.search).get('preview') !== 'intake') return false;
  let materials = managementView();
  const permissions = permissionView();
  let seats: SeatAccountRecord[] = [
    { displayName: '外包甲', username: 'seat-jia', post: '客服', enabled: true },
    { displayName: '外包乙', username: 'seat-yi', post: '客服主管', enabled: true },
  ];
  window.dashboardIntake = {
    mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: true, view: materials }),
    command: async (command) => {
      if (command.action === 'select') {
        const row = materials.candidates.find(item => item.selection === command.selection);
        materials = { ...materials, selected: row?.candidate ?? null };
      }
      if (command.action === 'discard') materials = { ...materials, selected: null };
      return { ok: true, view: materials };
    },
    onInvalidated: () => () => undefined,
  };
  window.dashboardPermissions = {
    current: async () => ({ ok: true, view: permissions }),
    command: async () => ({ ok: true, view: permissions }),
    onInvalidated: () => () => undefined,
  };
  window.dashboardSeats = {
    command: async (intent: SeatAccountIntent): Promise<SeatAccountReply> => {
      if (intent.action === 'list') return { ok: true, action: 'list', seats };
      if (intent.action === 'create') {
        const seat = { displayName: intent.displayName, username: intent.username, post: intent.post, enabled: true };
        seats = [...seats, seat];
        return { ok: true, action: 'create', seat };
      }
      if (intent.action === 'reset') return { ok: true, action: 'reset', username: intent.username };
      seats = seats.map(seat => seat.username === intent.username ? { ...seat, enabled: false } : seat);
      return { ok: true, action: 'disable', username: intent.username };
    },
  };
  return true;
}
