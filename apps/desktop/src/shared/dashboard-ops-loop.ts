import { exactKeys } from './product-session';

export const OPS_LOOP_COPY = Object.freeze({
  noProduct: '请先登录。',
  noSession: '请先登录。',
  forbidden: '你现在不能做这一步。',
  sopUploadJob: '你还不能上传 SOP。请联系客服主管开通。',
  grantJob: '当前职务不能授权。请让客服经理或客服总监开通。',
  unavailable: '服务暂不可用，请重试',
  retireHint: '提交后，要等下一次发布，坐席才搜不到这条。',
  retirePending: '已提交下架。下一次发布后，坐席才搜不到这条。',
  noVersion: '还没有可发布的版本。',
  selectWording: '请先选中话术。',
  selectSop: '请先选中节点。',
  sopChannel: '现在不能保存 SOP。请稍后再试。',
  sopTooLarge: 'SOP 文件超过 256KB。',
  allergyStop: '过敏步骤没有写停手和确认，不能发。',
  noSoftwareCurrent: '现在还没有可下载的安装包。',
  softwareDownloadNotHttps: '下载地址打不开。',
  softwareOpened: '已打开下载页',
  softwareChannel: '现在还没有可下载的安装包。',
});

/** Catalog download_url before shell.openExternal. https only, no userinfo. */
export function isSoftwareDownloadUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:'
    && parsed.username === ''
    && parsed.password === ''
    && parsed.hostname.length > 0;
}

export function sopAllergyStepNeedsStopCopy(title: string, body: string): boolean {
  if (!title.includes('过敏') && !body.includes('过敏')) return false;
  return !(body.includes('停手') && body.includes('确认'));
}

function splitSopCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function sopCsvAllergyStopMissing(csvText: string): boolean {
  const lines = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  for (const line of lines.slice(1)) {
    if (line.trim().length < 1) continue;
    const cells = splitSopCsvLine(line);
    if (cells.length < 4) continue;
    if (sopAllergyStepNeedsStopCopy(cells[2]?.trim() ?? '', cells[3] ?? '')) return true;
  }
  return false;
}

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

export type DashboardQuestionRates = Readonly<{
  ok: true;
  queryCount: number;
  hitCount: number;
  noHitCount: number;
  otherCount: number;
  inaccuracyCount: number;
  hitRate: string | null;
  noHitRate: string | null;
  inaccuracyRate: string | null;
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

export type DashboardSoftwareOpenDownload = Readonly<{
  ok: true;
  opened: true;
  version: string;
}>;

export type DashboardOpsApi = {
  retrieval(window: RetrievalWindow): Promise<DashboardRetrievalMetrics | DashboardOpsFailure>;
  questionRates?(start: string, end: string): Promise<DashboardQuestionRates | DashboardOpsFailure>;
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
  scriptDelete(request: {
    scriptId: string;
    expectedVersion: number;
  }): Promise<DashboardScriptMutation | DashboardOpsFailure>;
  softwareCatalog(): Promise<DashboardSoftwareCatalog | DashboardOpsFailure>;
  softwareOpenDownload(): Promise<DashboardSoftwareOpenDownload | DashboardOpsFailure>;
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
