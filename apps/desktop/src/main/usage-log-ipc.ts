import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import type { UsageLogExportPreview, UsageLogExportReply, UsageLogReply } from '../shared/dashboard-usage-log';
import { listUsageLog, usageExportPreviewCounts, type UsageSourceRow } from '../shared/usage-log-csv';
import type { UsageLogFilter } from '../shared/dashboard-usage-log';
import { isTrustedMainFrameSender } from './sender-guard';
import { saveUsageLogCsv } from './usage-log-export';

const LIST = 'dashboard:usage-list';
const PREVIEW = 'dashboard:usage-preview';
const EXPORT = 'dashboard:usage-export';

let usageSource: readonly UsageSourceRow[] | null = null;

export function setUsageLogSource(rows: readonly UsageSourceRow[] | null): void {
  usageSource = rows;
}

function unavailable(message = '请稍后再试。'): { ok: false; code: 'UNAVAILABLE'; message: string } {
  return { ok: false, code: 'UNAVAILABLE', message };
}

export function registerUsageLogIpc(
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
): void {
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  ipcMain.handle(LIST, (event, filter: UsageLogFilter | undefined): UsageLogReply => {
    if (!guard(event)) return { ok: false, code: 'FORBIDDEN', message: '请稍后再试。' };
    return listUsageLog(usageSource, filter);
  });

  ipcMain.handle(PREVIEW, (event): UsageLogExportPreview => {
    if (!guard(event) || usageSource === null) return unavailable();
    return { ok: true, ...usageExportPreviewCounts(usageSource) };
  });

  ipcMain.handle(EXPORT, async (event): Promise<UsageLogExportReply> => {
    if (!guard(event) || usageSource === null) return unavailable();
    const snapshot = usageSource;
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '导出训练样本',
      defaultPath: 'usage.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    const chosen = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (chosen.canceled || !chosen.filePath) return { ok: false, code: 'CANCELLED', message: '已取消' };
    try {
      const { written } = await saveUsageLogCsv(chosen.filePath, snapshot);
      return { ok: true, written };
    } catch {
      return { ok: false, code: 'FAILED', message: '导出失败，请重试。' };
    }
  });
}
