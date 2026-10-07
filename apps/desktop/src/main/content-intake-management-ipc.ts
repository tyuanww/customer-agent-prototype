import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { isIntakeManagementCommand, type IntakeManagementReply } from '../shared/content-intake-management';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import { isTrustedMainFrameSender } from './sender-guard';
import { ContentIntakeManagement } from './content-intake-management';
import { createIntakeNativeFiles } from './content-intake-native-files';
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
      detail: risk === 'pending' ? '建议留在页面按提示确认原操作结果。强制关闭不会撤销服务端操作，重新打开后须核对候选状态。' : '已经提交到服务端的记录仍会保留。',
      buttons: ['继续检查', '仍然关闭'], defaultId: 0, cancelId: 0, noLink: true });
    return choice === 1;
  };
  const reasonMessages: Record<string, string> = {
    MATERIAL_CHANGED: '候选版本或状态已改变，请刷新候选。修订失败不会替换旧版；结果不明时先恢复原操作。',
    ALREADY_PUBLISHED: '该候选已经发布，不能再修订或取消。后续更正须重新上传并审批。',
    BASE_CHANGED: '发布基线已改变，请重新导入形成新候选后再审核发布。',
    SOURCE_MISMATCH: '来源证据已改变，请刷新候选和材料后重新核对。',
    APPROVAL_CHANGED: '审批证据已改变，请刷新候选并读取最新审批状态。',
    AWAITING_APPROVAL: '组织审批尚未通过，请完成审批后刷新结果。',
    HUMAN_REVIEW_REQUIRED: '需要具备资格的人员完成审核后再发布。',
    FILE_LIMIT: '文件超过限制。请选择不大于 10 MiB 的合成 XLSX 工作簿，并整批修正后重新上传。',
    FILE_INVALID: '文件格式或内容无效，请重新导出标准 XLSX 模板。',
    APPROVAL_REVOKED: '组织审批已撤回，请核对后重新发起审批。',
  };
  const failure = (code: string, manager?: ContentIntakeManagement, reason?: string): IntakeManagementReply => ({ ok: false, code,
    message: (reason && Object.hasOwn(reasonMessages, reason) ? reasonMessages[reason] : undefined) ?? (code === 'VALIDATION' ? '请检查输入。确认来源须填写版本与说明，发布须填写标题和摘要，缺陷须说明原因。请遵守各输入长度提示。'
      : code === 'CONFLICT' ? '请先处理未完成操作或明确放弃尚未提交的判断。'
        : code === 'UNAUTHORIZED' ? '请先在查询窗口登录。' : '请求未完成或权限已改变。请刷新候选；结果不明时按页面提示确认原操作结果。'),
    view: manager?.view() ?? null });
  for (const channel of CHANNELS) ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const wc = dashboard();
    if (!wc || !isTrustedMainFrameSender(event, [wc], devUrl())) return failure('FORBIDDEN');
    if (channel === 'dashboard:intake-command' ? args.length !== 1 || !isIntakeManagementCommand(args[0]) : args.length !== 0) return failure('VALIDATION');
    if (channel === 'dashboard:intake-mode') return { ok: true, enabled: session !== null };
    if (!session) return failure('UNAVAILABLE');
    let manager = windows.get(wc);
    if (!manager) {
      const win = BrowserWindow.fromWebContents(wc);
      if (!win || win.isDestroyed()) return failure('FORBIDDEN');
      manager = new ContentIntakeManagement(session, createIntakeNativeFiles(win)); windows.set(wc, manager);
      const owned = manager;
      const close = (event: { preventDefault(): void }) => { if (!allowClose(owned)) event.preventDefault(); };
      win?.on('close', close);
      owned.subscribe(() => { if (!wc.isDestroyed()) wc.send('dashboard:intake-invalidated'); });
      wc.once('destroyed', () => { win?.removeListener('close', close); windows.delete(wc); owned.dispose(); });
    }
    try {
      return { ok: true, view: channel === 'dashboard:intake-current' ? manager.view() : await manager.command(args[0] as Parameters<ContentIntakeManagement['command']>[0]) };
    } catch (error) { return failure(error instanceof ProductHttpError ? error.code : 'UNAVAILABLE', manager, error instanceof ProductHttpError ? error.reason : undefined); }
  });
  return { allowClose: () => { if (!allowClose()) return false; closing = true; return true; }, dispose: () => {
    closing = true; for (const m of windows.values()) m.dispose(); windows.clear();
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  } };
}
