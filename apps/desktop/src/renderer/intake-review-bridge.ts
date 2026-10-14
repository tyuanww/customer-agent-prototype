import type { IntakeCatalogView } from '@shared/content-intake-catalog';
import type { IntakeManagementView } from '@shared/content-intake-management';
import type { IntakePermissionView } from '@shared/content-intake-permissions';
import type { DashboardIterationTask } from '@shared/dashboard-iteration';
import type { DashboardUsageLogApi, UsageLogRow } from '@shared/dashboard-usage-log';
import { usageExportPreviewCounts } from '@shared/usage-log-csv';
import type { DashboardWordingEntry, DashboardWordingView } from '@shared/dashboard-wording';
import { DESK_PERSONAS, type DeskItemView, type DeskView } from '@shared/desk-knowledge';
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

function deskItem(id: string, name: string, body: string, statusLabel: string, validity: DeskItemView['validity']): DeskItemView {
  return {
    id, personaId: 'shop', name, category: 'product', customCategory: null, fileName: '问答.txt', body,
    parseState: 'ok', validity, validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2026-12-01T00:00:00.000Z',
    updatedAt: '2026-10-13T02:00:00.000Z', statusLabel, delivered: statusLabel === '生效中',
  };
}

function deskView(): DeskView {
  const items = [
    deskItem('k-live', '运费谁承担', '七天无理由，运费由买家承担。', '生效中', 'always'),
    deskItem('k-due', '退货运费什么时候到', '到点后才发给坐席。', '待生效', 'scheduled'),
    deskItem('k-old', '旧包装说明', '这句已经过了有效期。', '已失效', 'scheduled'),
  ];
  return {
    signedIn: true, role: 'operator', displayName: '运营', personas: DESK_PERSONAS, selectedPersonaId: 'shop',
    items, delivered: items.filter((item) => item.delivered), tacit: [], revision: 1, notice: null, persistence: 'ok',
  };
}

function iterationTask(id: string, status: DashboardIterationTask['status']): DashboardIterationTask {
  return {
    taskId: id, signalId: 'inaccuracy:script-a', clusterKey: 'script-a',
    sampleQueryIds: ['q1', 'q2', 'q3'], suspectedCause: 'content_gap', suggestedScriptIds: ['script-a'],
    status, assigneeRole: 'coach', resolution: null, resolutionNote: null, version: 1,
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', resolvedAt: null,
  };
}

function wordingView(): DashboardWordingView {
  const entry: DashboardWordingEntry = {
    scriptId: 'script-a', domain: 'product', title: '运费谁承担', scene: '退货运费', answerPreview: '买家承担',
    platform: '千牛', version: 'rel_9', scriptVersion: 2, effectiveFrom: '2026-10-14T00:00:00.000Z', effectiveTo: null,
    effectiveWindow: '当前发布', risk: 'low', lifecycle: 'published', lifecycleLabel: '已发布',
    ownerRole: '当前发布', dataClass: 'current-release',
  };
  return { ok: true, releaseId: 'rel_9', total: 1, entries: [entry], catalogRefreshedAt: null, matchesLease: true };
}

function catalogView(): IntakeCatalogView {
  const until = '2099-01-01T00:00:00.000Z';
  return {
    signedIn: true, busy: false,
    context: {
      shops: ['shop-a'], shopNames: [{ id: 'shop-a', label: '合成旗舰店' }], shopNamesValidUntil: until,
      shopId: 'shop-a', products: [], scenarios: [], productIds: [], scenarioIds: [], validUntil: until,
    },
    releaseId: 'rel_9', validUntil: until,
    rows: [{
      id: 'row-1', domain: 'product', title: '运费谁承担', answerText: '七天无理由，运费由买家承担。',
      applicabilityNote: '全店通用', riskNote: '', category: '售后', scriptVersion: 2,
      effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: null,
    }],
  };
}


function usageLogFixture(): DashboardUsageLogApi {
  const rows: UsageLogRow[] = [
    { id: 'u1', askedAt: '2026-10-13T07:42:00Z', agent: '外包甲', question: '这个面膜孕妇能用吗', scriptTitle: '产品材质', result: 'copied', snapshotStale: false },
    { id: 'u2', askedAt: '2026-10-13T07:40:00Z', agent: '外包乙', question: null, scriptTitle: '运费谁承担', result: 'copied', snapshotStale: false },
    { id: 'u3', askedAt: '2026-10-13T07:31:00Z', agent: '外包甲', question: '能开发票吗', scriptTitle: null, result: 'miss', snapshotStale: false },
    { id: 'u4', askedAt: '2026-10-13T07:20:00Z', agent: '外包乙', question: '七天能退吗', scriptTitle: '七天无理由怎么算', result: 'viewed', snapshotStale: false },
    { id: 'u5', askedAt: '2026-10-13T07:02:00Z', agent: '外包甲', question: '什么时候发货', scriptTitle: '发货时间', result: 'copied', snapshotStale: true },
  ];
  return {
    list: async (filter) => ({
      ok: true,
      rows: rows.filter(row => (!filter.result || row.result === filter.result)
        && (!filter.query || row.agent.includes(filter.query) || (row.question ?? '').includes(filter.query))),
      nextCursor: null,
      canExport: true,
    }),
    previewExport: async () => ({ ok: true, ...usageExportPreviewCounts(rows) }),
    export: async () => ({ ok: true, written: usageExportPreviewCounts(rows).exportable }),
  };
}

function exposePreview(key: string, value: unknown): void {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    if (descriptor && descriptor.writable === false && descriptor.configurable === false) return;
    (window as unknown as Record<string, unknown>)[key] = value;
  } catch {
    // Electron preload already published this API as read-only.
  }
}

/** Local layout fixture for the workbench pages. It never reads the account file or the database. */
export function installIntakeReviewBridge(location: Location = window.location): boolean {
  if (!REVIEW_HOSTS.has(location.hostname) || new URLSearchParams(location.search).get('preview') !== 'intake') return false;
  let materials = managementView();
  const permissions = permissionView();
  let seats: SeatAccountRecord[] = [
    { displayName: '外包甲', username: 'seat-jia', post: '客服', enabled: true },
    { displayName: '外包乙', username: 'seat-yi', post: '客服主管', enabled: true },
  ];
  exposePreview('dashboardIntake', {
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
  });
  exposePreview('dashboardPermissions', {
    current: async () => ({ ok: true, view: permissions }),
    command: async () => ({ ok: true, view: permissions }),
    onInvalidated: () => () => undefined,
  });
  const desk = deskView();
  exposePreview('dashboardDesk', {
    current: async () => ({ ok: true, view: desk }),
    command: async () => ({ ok: true, view: desk }),
  });
  exposePreview('dashboardIteration', {
    list: async () => ({ ok: true, items: [iterationTask('task-open', 'open'), iterationTask('task-progress', 'in_progress')], nextCursor: null }),
    start: async () => ({ ok: true, task: iterationTask('task-open', 'in_progress') }),
    close: async () => ({ ok: true, task: iterationTask('task-open', 'resolved') }),
  });
  exposePreview('dashboardWording', { list: async () => wordingView() });
  exposePreview('dashboardUsageLog', usageLogFixture());
  const catalog = catalogView();
  exposePreview('dashboardIntakeCatalog', {
    current: async () => ({ ok: true, view: catalog }),
    command: async () => ({ ok: true, view: catalog }),
    onInvalidated: () => () => undefined,
  });
  exposePreview('dashboardSeats', {
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
  });
  return true;
}
