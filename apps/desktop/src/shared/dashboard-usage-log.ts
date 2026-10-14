/**
 * 系统同步 · 使用情况。坐席每次提问的一行记录，供运营复盘与后续训练样本。
 * 契约由前端先定，后端按此实现；renderer 只读，导出由 Main 写文件，数据不经过 renderer。
 */
export type UsageLogResult = 'copied' | 'viewed' | 'miss';
export const USAGE_LOG_RESULTS: readonly UsageLogResult[] = ['copied', 'viewed', 'miss'];

export type UsageLogRow = {
  id: string;
  /** ISO 8601。 */
  askedAt: string;
  /** 坐席显示名。 */
  agent: string;
  /** 客户问题原文；被脱敏策略抑制时为 null，界面写「已脱敏」。 */
  question: string | null;
  /** 命中的话术标题；未命中为 null。SOP 命中时标题自带「(SOP)」后缀由后端给出。 */
  scriptTitle: string | null;
  /**
   * copied：话术被复制进输入框（不等于已发送）。
   * viewed：展示过但没复制。miss：库里没找到。
   */
  result: UsageLogResult;
  /** 坐席当时用的是旧的本机快照，话术可能已被改过或删除。 */
  snapshotStale: boolean;
};

export type UsageLogFilter = {
  result: UsageLogResult | '';
  /** 按问题或坐席名模糊匹配；空串表示不过滤。 */
  query: string;
  /** 上一页返回的游标；首页为 null。 */
  cursor: string | null;
};

export type UsageLogReply =
  | { ok: true; rows: UsageLogRow[]; nextCursor: string | null; canExport: boolean }
  | { ok: false; code: string; message: string };

export type UsageLogExportPreview =
  | { ok: true; exportable: number; redacted: number; withoutConsent: number }
  | { ok: false; code: string; message: string };

export type UsageLogExportReply =
  | { ok: true; written: number }
  | { ok: false; code: string; message: string };

export type DashboardUsageLogApi = {
  list(filter: UsageLogFilter): Promise<UsageLogReply>;
  /** 只统计，不写文件。 */
  previewExport(): Promise<UsageLogExportPreview>;
  /** Main 弹系统保存框并写 CSV；用户取消返回 ok:false, code:'CANCELLED'。 */
  export(): Promise<UsageLogExportReply>;
};

export function isUsageLogResult(value: unknown): value is UsageLogResult {
  return value === 'copied' || value === 'viewed' || value === 'miss';
}
