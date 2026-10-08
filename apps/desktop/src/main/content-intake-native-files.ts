import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { INTAKE_UPLOAD_MAX_BYTES, intakeInputMime } from '../shared/content-intake-upload';
import { ProductHttpError } from './product-http';
import type { IntakePublicationPrompt } from './content-intake-management';

/** Paths never leave Main. Read one bounded, regular CSV or XLSX file; save only to a
 * native user-selected destination, replacing it atomically after a full write.
 * An OS dialog may outlive cancellation, so every result is checked before I/O. */
export function createIntakeNativeFiles(window: BrowserWindow) {
  let dialogPending = false;
  const live = (signal: AbortSignal) => {
    if (signal.aborted || window.isDestroyed()) throw new ProductHttpError('CANCELLED');
  };
  const choose = async <T>(signal: AbortSignal, show: () => Promise<T>): Promise<T> => {
    live(signal);
    if (dialogPending) throw new ProductHttpError('CONFLICT');
    dialogPending = true;
    try { const result = await show(); live(signal); return result; }
    finally { dialogPending = false; }
  };
  return {
    async confirmPublication(prompt: IntakePublicationPrompt, signal: AbortSignal): Promise<boolean> {
      const choice = await choose(signal, () => dialog.showMessageBox(window, {
        type: 'warning', title: '确认发布资料',
        message: prompt.kind === 'candidate' ? `确认发布「${prompt.title}」？` : `确认回退至上一发布版本 ${prompt.targetReleaseId} 的可用内容？`,
        detail: prompt.kind === 'candidate'
          ? `来源：${prompt.sourceId}\n候选版本：${prompt.candidateVersion}\n发布成功后，坐席重新查询将使用更新后的内容。`
          : `当前版本：${prompt.baseReleaseId}\n目标版本：${prompt.targetReleaseId}\n全部影响范围：\n${prompt.scopes.map(scope => `品牌 ${scope.brandId} · ${scope.shopId ? `店铺 ${scope.shopId}` : '品牌通用'} · 来源 ${scope.sourceId}`).join('\n')}\n确认后创建新的发布版本，坐席重新查询后使用更新内容。`,
        buttons: ['取消', '确认发布'], defaultId: 0, cancelId: 0, noLink: true,
      }));
      return choice.response === 1;
    },
    async chooseInputFile(signal: AbortSignal): Promise<{ name: string; bytes: Buffer } | null> {
      live(signal);
      const choice = await choose(signal, () => dialog.showOpenDialog(window, { title: '选择 FAQ 资料文件',
        properties: ['openFile'], filters: [{ name: 'FAQ 资料（CSV / Excel）', extensions: ['csv', 'xlsx'] }] }));
      live(signal);
      if (choice.canceled) return null;
      const path = choice.filePaths[0];
      const mime = path ? intakeInputMime(path) : null;
      if (choice.filePaths.length !== 1 || !path || !mime) throw new ProductHttpError('VALIDATION', 'FILE_INVALID');
      const before = await lstat(path); live(signal);
      if (!before.isFile()) throw new ProductHttpError('VALIDATION', 'FILE_INVALID');
      if (before.size < 1 || before.size > INTAKE_UPLOAD_MAX_BYTES) throw new ProductHttpError('VALIDATION', 'FILE_LIMIT');
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const start = await file.stat(); live(signal);
        if (!start.isFile() || start.size !== before.size || start.dev !== before.dev || start.ino !== before.ino) throw new ProductHttpError('VALIDATION', 'FILE_INVALID');
        const bytes = Buffer.alloc(start.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          live(signal);
          const read = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        const end = await file.stat(); live(signal);
        if (offset !== start.size || end.size !== start.size || end.mtimeMs !== start.mtimeMs || end.ctimeMs !== start.ctimeMs
          || (mime !== 'text/csv' && (offset < 4 || bytes.readUInt32LE(0) !== 0x04034b50))) throw new ProductHttpError('VALIDATION', 'FILE_INVALID');
        return { name: basename(path), bytes: bytes.subarray(0, offset) };
      } finally { await file.close(); }
    },
    async saveReport(bytes: Buffer, signal: AbortSignal): Promise<boolean> {
      live(signal);
      const choice = await choose(signal, () => dialog.showSaveDialog(window, { title: '保存完整校验报告', defaultPath: 'FAQ-校验报告.xlsx',
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] }));
      live(signal);
      if (choice.canceled) return false;
      const path = choice.filePath;
      if (!path || extname(path).toLowerCase() !== '.xlsx') throw new ProductHttpError('VALIDATION', 'FILE_INVALID');
      const temporary = join(dirname(path), `.intake-report-${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      let installed = false;
      try {
        try { live(signal); await file.writeFile(bytes, { signal }); await file.sync(); }
        finally { await file.close(); }
        live(signal);
        await rename(temporary, path); installed = true;
        return true;
      } finally {
        if (!installed) await unlink(temporary);
      }
    },
  };
}
