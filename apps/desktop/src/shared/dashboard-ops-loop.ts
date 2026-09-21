import { exactKeys } from './product-session';

export const OPS_LOOP_COPY = Object.freeze({
  noProduct: '未接入：没有产品会话。',
  noSession: '未接入：请先登录。',
  forbidden: '当前角色不能执行这个操作。',
  unavailable: '服务暂不可用，请重试',
  pendingReview: '已进入待审核草稿，发布后才离开当前目录。',
  noVersion: '未接入：没有当前话术版本号。',
  selectWording: '请先选中话术。',
  selectSop: '请先选中节点。',
  sopChannel: '未接入：没有 SOP 写库通道。',
  sopTooLarge: 'SOP 文件超过 256KB。',
});

export const SOP_UPLOAD_MAX_BYTES = 256 * 1024;

export type DashboardOpsFailureCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'OVERLOADED'
  | 'RATE_LIMITED';

export type DashboardOpsFailure = Readonly<{
  ok: false;
  code: DashboardOpsFailureCode;
  message: string;
}>;

export type RetrievalWindow = 'current_release' | 'last_7d';

export type DashboardRetrievalMetrics = Readonly<{
  ok: true;
  noHitRate: number;
  copyCompleteRate: number;
  openTaskCount: number;
  currentReleaseScriptCount: number;
  window: RetrievalWindow;
  releaseId: string | null;
}>;

export type DashboardSopNode = Readonly<{
  nodeId: string;
  parentNodeId: string | null;
  title: string;
  body: string;
  sortKey: number;
  version: number;
  lifecycle: 'active' | 'deleted';
}>;

export type DashboardSopCatalog = Readonly<{
  ok: true;
  productSessionId: string;
  items: readonly DashboardSopNode[];
}>;

export type DashboardSopImport = Readonly<{
  ok: true;
  productSessionId: string;
  nodeCount: number;
}>;

export type DashboardScriptMutation = Readonly<{
  ok: true;
  scriptId: string;
  mutationId: string;
  reviewStatus: 'pending_review';
}>;

export type DashboardSoftwareRelease = Readonly<{
  version: string;
  platform: 'mac-universal' | 'win-x64' | 'linux-x64';
  sha256: string;
  downloadUrl: string;
  createdAt: string;
  signed: boolean;
}>;

export type DashboardSoftwareCatalog = Readonly<{
  ok: true;
  items: readonly DashboardSoftwareRelease[];
  current: DashboardSoftwareRelease | null;
}>;

export type DashboardOpsApi = {
  retrieval(window: RetrievalWindow): Promise<DashboardRetrievalMetrics | DashboardOpsFailure>;
  sopCatalog(): Promise<DashboardSopCatalog | DashboardOpsFailure>;
  sopImport(csvText: string): Promise<DashboardSopImport | DashboardOpsFailure>;
  sopPatch(request: {
    nodeId: string;
    expectedVersion: number;
    title?: string;
    body?: string;
    sortKey?: number;
  }): Promise<DashboardSopNode | DashboardOpsFailure>;
  sopDelete(request: {
    nodeId: string;
    expectedVersion: number;
  }): Promise<DashboardSopNode | DashboardOpsFailure>;
  scriptPatch(request: {
    scriptId: string;
    expectedVersion: number;
    title: string;
    answerText: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }): Promise<DashboardScriptMutation | DashboardOpsFailure>;
  scriptDelete(request: {
    scriptId: string;
    expectedVersion: number;
  }): Promise<DashboardScriptMutation | DashboardOpsFailure>;
  softwareCatalog(): Promise<DashboardSoftwareCatalog | DashboardOpsFailure>;
};

export function dashboardOpsFailure(
  code: DashboardOpsFailureCode,
  message: string = OPS_LOOP_COPY.unavailable,
): DashboardOpsFailure {
  return Object.freeze({ ok: false, code, message });
}

export function isDashboardOpsFailure(value: unknown): value is DashboardOpsFailure {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'code', 'message'])
    && record.ok === false
    && typeof record.code === 'string'
    && typeof record.message === 'string'
    && record.message.length > 0;
}
