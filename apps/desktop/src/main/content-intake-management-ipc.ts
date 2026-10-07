import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { isIntakeManagementCommand, type IntakeManagementReply } from '../shared/content-intake-management';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import { isTrustedMainFrameSender } from './sender-guard';
import { ContentIntakeManagement } from './content-intake-management';
const CHANNELS = ['dashboard:intake-mode', 'dashboard:intake-current', 'dashboard:intake-command'] as const;
/** Only the explicit synthetic profile provides a session. No legacy product
 * capability is mounted in FAQ Dashboard, and no renderer supplies an identity. */
export function registerContentIntakeManagementIpc(session: ProductSession | null,
  dashboard: () => WebContents | null, devUrl: () => string | undefined) {
  const windows = new Map<WebContents, ContentIntakeManagement>();
  let closing = false;
  const allowClose = (manager?: ContentIntakeManagement) => {
    if (closing) return true;
    const risk = manager?.closeRisk() ?? [...windows.values()].map(m => m.closeRisk()).find(Boolean);
    if (!risk) return true;
    const choice = dialog.showMessageBoxSync({ type: 'warning', title: '关闭资料审核',
      message: risk === 'pending' ? '操作结果尚未确定或请求仍在处理。' : '关闭后会丢失未提交的人工判断。',
      detail: risk === 'pending' ? '建议留在页面查询原操作回执。强制关闭不会撤销服务端操作，重新打开后须核对候选状态。' : '已经提交到服务端的记录仍会保留。',
      buttons: ['继续检查', '仍然关闭'], defaultId: 0, cancelId: 0, noLink: true });
    return choice === 1;
  };
  const failure = (code: string, manager?: ContentIntakeManagement): IntakeManagementReply => ({ ok: false, code,
    message: code === 'VALIDATION' ? '请检查输入。缺陷必须填写原因，每条原因最多 1000 字。'
      : code === 'CONFLICT' ? '请先处理未完成操作或明确放弃尚未提交的判断。'
        : code === 'UNAUTHORIZED' ? '请先在查询窗口登录。' : '请求未完成或权限已改变。请刷新候选；结果不明时先查询原操作回执。',
    view: manager?.view() ?? null });
  for (const channel of CHANNELS) ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const wc = dashboard();
    if (!wc || !isTrustedMainFrameSender(event, [wc], devUrl())) return failure('FORBIDDEN');
    if (channel === 'dashboard:intake-command' ? args.length !== 1 || !isIntakeManagementCommand(args[0]) : args.length !== 0) return failure('VALIDATION');
    if (channel === 'dashboard:intake-mode') return { ok: true, enabled: session !== null };
    if (!session) return failure('UNAVAILABLE');
    let manager = windows.get(wc);
    if (!manager) {
      manager = new ContentIntakeManagement(session); windows.set(wc, manager);
      const owned = manager, win = BrowserWindow.fromWebContents(wc);
      const close = (event: { preventDefault(): void }) => { if (!allowClose(owned)) event.preventDefault(); };
      win?.on('close', close);
      owned.subscribe(() => { if (!wc.isDestroyed()) wc.send('dashboard:intake-invalidated'); });
      wc.once('destroyed', () => { win?.removeListener('close', close); windows.delete(wc); owned.dispose(); });
    }
    try {
      return { ok: true, view: channel === 'dashboard:intake-current' ? manager.view() : await manager.command(args[0] as Parameters<ContentIntakeManagement['command']>[0]) };
    } catch (error) { return failure(error instanceof ProductHttpError ? error.code : 'UNAVAILABLE', manager); }
  });
  return { allowClose: () => { if (!allowClose()) return false; closing = true; return true; }, dispose: () => {
    closing = true; for (const m of windows.values()) m.dispose(); windows.clear();
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  } };
}
