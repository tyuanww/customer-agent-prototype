import type { RosterPermissionState } from '@customer-agent/job-roster';
import { resolveJobTitle, type BoardRights, type BoardRole, type JobDirectoryEntry } from './workbench-job';

/** Public session projection. Credentials never cross preload. Epoch is owned by main. */
export type ProductSessionView = {
  ok: true; enabled: boolean; signedIn: boolean; sessionEpoch: number;
  userId: string | null; role: 'agent' | 'coach' | 'owner' | null;
  authMode: 'mock' | 'feishu' | null; expiresAt: string | null;
  displayName: string | null;
  job: SessionJobView | null;
};

export const UNRESOLVED_JOB_LABEL = '职务未识别';
export const PERMISSION_DENIAL_MESSAGE = '没有权限，请找人开通。';

export function permissionNotice(state: RosterPermissionState | undefined): string | null {
  if (!state || state === 'ready' || state === 'unknown') return null;
  return PERMISSION_DENIAL_MESSAGE;
}

const NO_JOB_RIGHTS: BoardRights = {
  publish: false, grant: false, uploadSop: false, search: false, readCatalog: false,
};

export type SessionJobView =
  | {
    readonly status: 'resolved';
    readonly title: string;
    readonly role: BoardRole;
    readonly label: string;
    readonly rights: BoardRights;
    readonly permission: RosterPermissionState | null;
    readonly notice: string | null;
  }
  | {
    readonly status: 'unresolved';
    readonly reason: 'blank' | 'unknown' | 'duplicate' | 'missing';
    readonly label: typeof UNRESOLVED_JOB_LABEL;
    readonly rights: BoardRights;
    readonly permission: RosterPermissionState | null;
    readonly notice: string | null;
  };

export type JobSnapshot = {
  readonly title: string;
  readonly directory: readonly JobDirectoryEntry[];
  readonly permissionState?: RosterPermissionState;
};

export function observeSessionJob(snapshot: JobSnapshot | null): SessionJobView {
  if (snapshot === null) {
    return { status: 'unresolved', reason: 'missing', label: UNRESOLVED_JOB_LABEL, rights: { ...NO_JOB_RIGHTS }, permission: null, notice: null };
  }
  const lookup = resolveJobTitle(snapshot.title, snapshot.directory);
  const permission = snapshot.permissionState ?? null;
  const notice = permissionNotice(snapshot.permissionState);
  if (lookup.status === 'unresolved') {
    return { status: 'unresolved', reason: lookup.reason, label: UNRESOLVED_JOB_LABEL, rights: { ...NO_JOB_RIGHTS }, permission, notice };
  }
  const queryReady = snapshot.permissionState === 'ready';
  return {
    status: 'resolved',
    title: lookup.title,
    role: lookup.role,
    label: lookup.title,
    rights: {
      ...lookup.rights,
      search: lookup.rights.search && queryReady,
      readCatalog: lookup.rights.readCatalog && queryReady,
    },
    permission,
    notice,
  };
}
export const PRODUCT_ERRORS = {
  UNAUTHORIZED: '请先登录，或重新登录后继续', VALIDATION: '请求内容无效',
  FORBIDDEN: '当前身份不能执行此操作', GONE: '登录请求已过期，请重试',
  CONFLICT: '操作已在进行或已完成', UNAVAILABLE: '服务暂不可用，请重试',
  OVERLOADED: '服务繁忙，请稍后重试', RATE_LIMITED: '操作过于频繁，请稍后重试',
  CANCELLED: '操作已取消', STALE: '内容已变化，请重新查询',
  CLIPBOARD_FAILED: '复制失败，请重试', SOURCE_GATE_NOT_READY: '内容暂不可用，请联系话术师核实',
} as const;
export type ProductErrorCode = keyof typeof PRODUCT_ERRORS;
export type ProductFailure = { ok: false; sessionEpoch: number; code: ProductErrorCode; message: string };
export type ProductSessionResult = ProductSessionView | ProductFailure;
export function productFailure(code: ProductErrorCode, sessionEpoch = 0): ProductFailure {
  return { ok: false, code, sessionEpoch, message: PRODUCT_ERRORS[code] };
}
export function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
export function isProductSessionResult(value: unknown): value is ProductSessionResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.sessionEpoch) || (v.sessionEpoch as number) < 0) return false;
  if (v.ok === false) return exactKeys(v, ['ok', 'code', 'sessionEpoch', 'message'])
    && typeof v.code === 'string' && Object.hasOwn(PRODUCT_ERRORS, v.code)
    && v.message === PRODUCT_ERRORS[v.code as ProductErrorCode];
  if (!exactKeys(v, ['ok', 'enabled', 'signedIn', 'sessionEpoch', 'userId', 'role', 'authMode', 'expiresAt', 'displayName', 'job'])
    || v.ok !== true || typeof v.enabled !== 'boolean' || typeof v.signedIn !== 'boolean') return false;
  if (!v.signedIn) {
    return v.userId === null && v.role === null && v.authMode === null && v.expiresAt === null
      && v.displayName === null && v.job === null;
  }
  return v.enabled && typeof v.userId === 'string' && v.userId.length > 0 && v.userId.length <= 128
    && ['agent', 'coach', 'owner'].includes(v.role as string)
    && ['mock', 'feishu'].includes(v.authMode as string)
    && typeof v.expiresAt === 'string' && Number.isFinite(Date.parse(v.expiresAt))
    && typeof v.displayName === 'string' && v.displayName.length > 0 && v.displayName.length <= 64
    && isSessionJob(v.job);
}

export function isSessionJob(value: unknown): value is SessionJobView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  const rights = job.rights;
  if (!rights || typeof rights !== 'object' || Array.isArray(rights)) return false;
  const row = rights as Record<string, unknown>;
  if (!exactKeys(row, ['publish', 'grant', 'uploadSop', 'search', 'readCatalog'])) return false;
  if (![row.publish, row.grant, row.uploadSop, row.search, row.readCatalog].every((flag) => typeof flag === 'boolean')) return false;
  if (job.notice !== null && job.notice !== PERMISSION_DENIAL_MESSAGE) return false;
  if (job.permission !== null && (typeof job.permission !== 'string'
    || !['unknown', 'pending', 'ready', 'denied', 'expired', 'revoked'].includes(job.permission))) return false;
  if (job.status === 'unresolved') {
    return exactKeys(job, ['status', 'reason', 'label', 'rights', 'permission', 'notice'])
      && (job.reason === 'blank' || job.reason === 'unknown' || job.reason === 'duplicate' || job.reason === 'missing')
      && job.label === UNRESOLVED_JOB_LABEL
      && row.publish === false && row.grant === false && row.uploadSop === false
      && row.search === false && row.readCatalog === false;
  }
  if (job.status !== 'resolved' || !exactKeys(job, ['status', 'title', 'role', 'label', 'rights', 'permission', 'notice'])) return false;
  if (typeof job.title !== 'string' || job.label !== job.title) return false;
  const expected = resolveJobTitle(job.title, [{ name: job.title, enabled: true }]);
  const queryReady = job.permission === 'ready';
  return expected.status === 'resolved'
    && expected.role === job.role
    && expected.rights.publish === row.publish
    && expected.rights.grant === row.grant
    && expected.rights.uploadSop === row.uploadSop
    && row.search === (queryReady && expected.rights.search)
    && row.readCatalog === (queryReady && expected.rights.readCatalog);
}
export type ProductSessionApi = {
  sessionStatus(): Promise<ProductSessionResult>;
  login(): Promise<ProductSessionResult>;
  logout(): Promise<ProductSessionResult>;
  currentNotice?(): Promise<import('./product-notice').ProductNoticeResult>;
  decideNotice?(request: import('./product-notice').ProductNoticeDecisionRequest): Promise<import('./product-notice').ProductNoticeDecisionResult>;
  onSessionChanged(listener: (value: ProductSessionResult) => void): () => void;
};

export const SESSION_ROLE_LABEL = {
  owner: '管理员',
  coach: '话术师',
  agent: '坐席',
} as const;

export function isSessionAccountId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('ou_')
    || trimmed.startsWith('usr_')
    || trimmed.startsWith('synthetic_');
}

/** Operator-facing name. Account ids and synthetic subjects fall back to the role label. */
export function sessionDisplayName(input: {
  role: 'agent' | 'coach' | 'owner' | null;
  mappedName?: string | null;
}): string | null {
  const mapped = input.mappedName?.trim() ?? '';
  if (mapped.length > 0 && !isSessionAccountId(mapped)) return mapped.slice(0, 64);
  if (input.role && SESSION_ROLE_LABEL[input.role]) return SESSION_ROLE_LABEL[input.role];
  return null;
}
