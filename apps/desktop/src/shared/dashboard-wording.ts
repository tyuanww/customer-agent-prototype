import { exactKeys } from './product-session';

export type DashboardWordingDomain = 'presale' | 'campaign' | 'aftersale' | 'product';

export type DashboardWordingEntry = Readonly<{
  scriptId: string;
  domain: DashboardWordingDomain;
  title: string;
  scene: string;
  answerPreview: string;
  platform: string;
  version: string;
  effectiveWindow: string;
  risk: 'low' | 'medium' | 'high';
  lifecycle: 'published';
  lifecycleLabel: '已发布';
  ownerRole: string;
  dataClass: 'local-catalog';
}>;

export type DashboardWordingView = Readonly<{
  ok: true;
  releaseId: string | null;
  total: number;
  entries: readonly DashboardWordingEntry[];
}>;

export type DashboardWordingFailure = Readonly<{
  ok: false;
  code: 'FORBIDDEN' | 'VALIDATION' | 'UNAVAILABLE';
}>;

export type DashboardWordingResult = DashboardWordingView | DashboardWordingFailure;

export type DashboardWordingApi = {
  list(): Promise<DashboardWordingResult>;
};

export function dashboardWordingFailure(
  code: DashboardWordingFailure['code'],
): DashboardWordingFailure {
  return Object.freeze({ ok: false, code });
}

export function isDashboardWordingResult(value: unknown): value is DashboardWordingResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return exactKeys(record, ['ok', 'code'])
      && (record.code === 'FORBIDDEN' || record.code === 'VALIDATION' || record.code === 'UNAVAILABLE');
  }
  if (record.ok !== true || !exactKeys(record, ['ok', 'releaseId', 'total', 'entries'])) return false;
  if (!(record.releaseId === null || typeof record.releaseId === 'string')) return false;
  if (!Number.isSafeInteger(record.total) || (record.total as number) < 0) return false;
  return Array.isArray(record.entries) && record.entries.length === record.total;
}
