import { dialog, ipcMain, type WebContents } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { LOCAL_SOP_WORKBOOK_MAX_BYTES, openLocalSopWorkbook } from '../shared/open-local-sop-workbook';
import type { SopWorkbookOpenReply } from '../shared/sop-workbook-preview';
import { parseLocalSopWorkbook } from './sop-workbook-parser';
import { isTrustedMainFrameSender } from './sender-guard';

const OPEN = 'dashboard:sop-workbook-open';

/** Electron adapter. The dialog and file read stay here. Parsing policy stays in the use case. */
export function registerSopWorkbookIpc(
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
): void {
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  ipcMain.handle(OPEN, async (event): Promise<SopWorkbookOpenReply> => {
    if (!guard(event)) return { ok: false, code: 'UNAVAILABLE', message: '请稍后再试。' };
    const chosen = await dialog.showOpenDialog({
      title: '打开原始 SOP 表',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { ok: false, code: 'CANCELLED', message: '已取消' };
    const filePath = chosen.filePaths[0];
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return { ok: false, code: 'INVALID', message: '这个文件读不开。' };
      if (info.size > LOCAL_SOP_WORKBOOK_MAX_BYTES) return { ok: false, code: 'INVALID', message: '文件超过 10MB，没有读取。' };
      const bytes = await readFile(filePath);
      return openLocalSopWorkbook(basename(filePath), bytes, parseLocalSopWorkbook);
    } catch {
      return { ok: false, code: 'INVALID', message: '这个文件读不开。' };
    }
  });
}
