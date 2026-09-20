import { exactKeys, PRODUCT_ERRORS, type ProductErrorCode } from './product-session';

export const DASHBOARD_CONTENT_DOMAINS = ['presale', 'campaign', 'aftersale', 'product'] as const;
export type DashboardContentDomain = (typeof DASHBOARD_CONTENT_DOMAINS)[number];
export type DashboardContentRole = 'agent' | 'coach' | 'owner';

export type DashboardContentRow = Readonly<{
  scene: string;
  script: string;
  domain?: DashboardContentDomain;
}>;

export type DashboardContentBinding = Readonly<{
  domain: DashboardContentDomain;
  source_version_id: string;
}>;

export const CONTENT_SOURCE_VERSION_ID = /^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;
export const CONTENT_IMPORT_MAX_BYTES = 64 * 1024;
export const CONTENT_IMPORT_MAX_ROWS = 50;
export const CONTENT_IMPORT_TIMEOUT_MS = 30_000;

export const CONTENT_PUBLISH_COPY = Object.freeze({
  noProduct: '当前没有产品会话，无法发布',
  noSession: '请先登录后再发布',
  noDraft: '请先导入待审核草稿后再发布',
  agent: '坐席不能发布内容',
  sensitive: '售后、过敏或赔付内容需管理员发布',
  coachScope: '话术师只能发布已标注的产品或活动内容',
  missingBindings: '缺少来源绑定，无法导入',
  submitting: '正在提交发布',
});

const CONTENT_FAILURE_CODES = [
  'UNAUTHORIZED',
  'VALIDATION',
  'FORBIDDEN',
  'GONE',
  'CONFLICT',
  'UNAVAILABLE',
  'OVERLOADED',
  'RATE_LIMITED',
  'CANCELLED',
  'STALE',
] as const satisfies readonly ProductErrorCode[];

export type DashboardContentFailureCode = (typeof CONTENT_FAILURE_CODES)[number];

export type DashboardContentFailure = Readonly<{
  ok: false;
  code: DashboardContentFailureCode;
  message: string;
}>;

export type DashboardContentSessionView = Readonly<{
  ok: true;
  enabled: boolean;
  signedIn: boolean;
  role: DashboardContentRole | null;
}>;

export type DashboardContentSessionResult = DashboardContentSessionView | DashboardContentFailure;

export type DashboardContentImportRequest = Readonly<{
  sourceName: string;
  csvText: string;
  sourceBindings: readonly DashboardContentBinding[];
}>;

export type DashboardContentImportView = Readonly<{
  ok: true;
  importBatchId: string;
}>;

export type DashboardContentImportResult = DashboardContentImportView | DashboardContentFailure;

export type DashboardContentPublishRequest = Readonly<{
  sourceName: string;
  csvText: string;
  rows: readonly DashboardContentRow[];
  title: string;
  summary: string | null;
  sourceBindings: readonly DashboardContentBinding[];
}>;

export type DashboardContentPublishView = Readonly<{
  ok: true;
  releaseId: string;
  releaseSeq: number;
}>;

export type DashboardContentPublishResult = DashboardContentPublishView | DashboardContentFailure;

export type DashboardContentApi = {
  session(): Promise<DashboardContentSessionResult>;
  importDraft(request: DashboardContentImportRequest): Promise<DashboardContentImportResult>;
  publishDraft(request: DashboardContentPublishRequest): Promise<DashboardContentPublishResult>;
};

export type ContentPublishGateInput = Readonly<{
  productAvailable: boolean;
  signedIn: boolean;
  role: DashboardContentRole | null;
  rows: readonly DashboardContentRow[];
  sourceBindings?: readonly DashboardContentBinding[];
}>;

export type ContentPublishGate =
  | Readonly<{ allowed: true }>
  | Readonly<{
    allowed: false;
    code: Extract<DashboardContentFailureCode, 'UNAVAILABLE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION'>;
    message: string;
  }>;

export function dashboardContentFailure(
  code: DashboardContentFailureCode,
  message?: string,
): DashboardContentFailure {
  return Object.freeze({
    ok: false,
    code,
    message: message ?? PRODUCT_ERRORS[code],
  });
}

export function rowRequiresOwner(row: DashboardContentRow): boolean {
  if (row.domain === 'aftersale') return true;
  return row.scene.includes('过敏') || row.scene.includes('赔付')
    || row.script.includes('过敏') || row.script.includes('赔付');
}

export function rowCoachPublishable(row: DashboardContentRow): boolean {
  return row.domain === 'product' || row.domain === 'campaign';
}

export function contentPublishGate(input: ContentPublishGateInput): ContentPublishGate {
  if (!input.productAvailable) {
    return { allowed: false, code: 'UNAVAILABLE', message: CONTENT_PUBLISH_COPY.noProduct };
  }
  if (!input.signedIn || input.role === null) {
    return { allowed: false, code: 'UNAUTHORIZED', message: CONTENT_PUBLISH_COPY.noSession };
  }
  if (input.role === 'agent') {
    return { allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.agent };
  }
  if (input.rows.length < 1) {
    return { allowed: false, code: 'VALIDATION', message: CONTENT_PUBLISH_COPY.noDraft };
  }
  if (input.role === 'owner') {
    if ((input.sourceBindings?.length ?? 0) < 1) {
      return { allowed: false, code: 'VALIDATION', message: CONTENT_PUBLISH_COPY.missingBindings };
    }
    return { allowed: true };
  }
  if (input.rows.some(rowRequiresOwner)) {
    return { allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.sensitive };
  }
  if (!input.rows.every(rowCoachPublishable)) {
    return { allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.coachScope };
  }
  if ((input.sourceBindings?.length ?? 0) < 1) {
    return { allowed: false, code: 'VALIDATION', message: CONTENT_PUBLISH_COPY.missingBindings };
  }
  return { allowed: true };
}

function isContentDomain(value: unknown): value is DashboardContentDomain {
  return value === 'presale' || value === 'campaign' || value === 'aftersale' || value === 'product';
}

function isContentRole(value: unknown): value is DashboardContentRole {
  return value === 'agent' || value === 'coach' || value === 'owner';
}

export function isDashboardContentFailure(value: unknown): value is DashboardContentFailure {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'code', 'message'])
    && record.ok === false
    && typeof record.code === 'string'
    && (CONTENT_FAILURE_CODES as readonly string[]).includes(record.code)
    && typeof record.message === 'string'
    && record.message.length > 0
    && record.message.length <= 200;
}

export function isDashboardContentSessionResult(value: unknown): value is DashboardContentSessionResult {
  if (isDashboardContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !exactKeys(record, ['ok', 'enabled', 'signedIn', 'role'])) return false;
  if (typeof record.enabled !== 'boolean' || typeof record.signedIn !== 'boolean') return false;
  if (record.signedIn) return record.enabled === true && isContentRole(record.role);
  return record.role === null;
}

export function isDashboardContentRow(value: unknown): value is DashboardContentRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.scene !== 'string' || record.scene.trim().length < 1 || record.scene.length > 2000) return false;
  if (typeof record.script !== 'string' || record.script.trim().length < 1 || record.script.length > 2000) return false;
  if (record.domain === undefined) return exactKeys(record, ['scene', 'script']);
  return exactKeys(record, ['scene', 'script', 'domain']) && isContentDomain(record.domain);
}

export function isDashboardContentBinding(value: unknown): value is DashboardContentBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['domain', 'source_version_id'])
    && isContentDomain(record.domain)
    && typeof record.source_version_id === 'string'
    && CONTENT_SOURCE_VERSION_ID.test(record.source_version_id);
}

function isSourceName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255;
}

function isCsvText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= CONTENT_IMPORT_MAX_BYTES
    && !value.includes('\u0000');
}

export function isDashboardContentImportRequest(value: unknown): value is DashboardContentImportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['sourceName', 'csvText', 'sourceBindings'])) return false;
  if (!isSourceName(record.sourceName) || !isCsvText(record.csvText)) return false;
  if (!Array.isArray(record.sourceBindings) || record.sourceBindings.length > 4) return false;
  const domains = new Set<string>();
  for (const item of record.sourceBindings) {
    if (!isDashboardContentBinding(item) || domains.has(item.domain)) return false;
    domains.add(item.domain);
  }
  return true;
}

export function isDashboardContentPublishRequest(value: unknown): value is DashboardContentPublishRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['sourceName', 'csvText', 'rows', 'title', 'summary', 'sourceBindings'])) return false;
  if (!isSourceName(record.sourceName) || !isCsvText(record.csvText)) return false;
  if (typeof record.title !== 'string' || record.title.trim().length < 1 || record.title.length > 200) return false;
  if (!(record.summary === null || (typeof record.summary === 'string' && record.summary.length <= 500))) return false;
  if (!Array.isArray(record.rows) || record.rows.length < 1 || record.rows.length > CONTENT_IMPORT_MAX_ROWS) return false;
  if (!record.rows.every(isDashboardContentRow)) return false;
  if (!Array.isArray(record.sourceBindings) || record.sourceBindings.length > 4) return false;
  const domains = new Set<string>();
  for (const item of record.sourceBindings) {
    if (!isDashboardContentBinding(item) || domains.has(item.domain)) return false;
    domains.add(item.domain);
  }
  return true;
}

export function isDashboardContentImportResult(value: unknown): value is DashboardContentImportResult {
  if (isDashboardContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'importBatchId'])
    && record.ok === true
    && typeof record.importBatchId === 'string'
    && record.importBatchId.length > 0
    && record.importBatchId.length <= 128;
}

export function isDashboardContentPublishResult(value: unknown): value is DashboardContentPublishResult {
  if (isDashboardContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'releaseId', 'releaseSeq'])
    && record.ok === true
    && typeof record.releaseId === 'string'
    && record.releaseId.length > 0
    && record.releaseId.length <= 128
    && Number.isSafeInteger(record.releaseSeq)
    && (record.releaseSeq as number) >= 1;
}
