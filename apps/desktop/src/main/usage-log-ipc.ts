import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import type { UsageLogExportPreview, UsageLogExportReply, UsageLogReply } from '../shared/dashboard-usage-log';
import { usageExportPreviewCounts, type UsageSourceRow } from '../shared/usage-log-csv';
import type { UsageLogFilter } from '../shared/dashboard-usage-log';
import { usageReplyFromSources, type UsageMount } from '../shared/usage-feed';
import { isTrustedMainFrameSender } from './sender-guard';
import { saveUsageLogCsv } from './usage-log-export';

const LIST = 'dashboard:usage-list';
const PREVIEW = 'dashboard:usage-preview';
const EXPORT = 'dashboard:usage-export';

let usageMount: UsageMount = { kind: 'unmounted' };
let readUsageRows: (actorId: string) => readonly UsageSourceRow[] = () => [];
let readRemoteUsage: (() => Promise<readonly UsageSourceRow[]>) | null = null;

export function bindUsageFeed(read: (actorId: string) => readonly UsageSourceRow[]): void {
  readUsageRows = read;
}

export function bindRemoteUsage(read: (() => Promise<readonly UsageSourceRow[]>) | null): void {
  readRemoteUsage = read;
}

export function setUsageMount(mount: UsageMount): void {
  usageMount = mount;
}

function loadReply(filter: Partial<UsageLogFilter> | null | undefined): Promise<UsageLogReply> {
  return usageReplyFromSources(usageMount, readUsageRows, readRemoteUsage, filter);
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

  ipcMain.handle(LIST, async (event, filter: UsageLogFilter | undefined): Promise<UsageLogReply> => {
    if (!guard(event)) return { ok: false, code: 'FORBIDDEN', message: '请稍后再试。' };
    return loadReply(filter);
  });

  ipcMain.handle(PREVIEW, async (event): Promise<UsageLogExportPreview> => {
    if (!guard(event)) return unavailable();
    const current = await loadReply(null);
    if (!current.ok) return { ok: false, code: current.code, message: current.message };
    return { ok: true, ...usageExportPreviewCounts(current.rows) };
  });

  ipcMain.handle(EXPORT, async (event): Promise<UsageLogExportReply> => {
    if (!guard(event)) return unavailable();
    const current = await loadReply(null);
    if (!current.ok) return { ok: false, code: current.code, message: current.message };
    const snapshot = current.rows;
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
