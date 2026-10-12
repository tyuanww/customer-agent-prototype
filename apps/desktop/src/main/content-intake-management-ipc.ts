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
    const choice = dialog.showMessageBoxSync({ type: 'warning', title: '关闭资料管理',
      message: risk === 'pending' ? '操作结果尚未确定或请求仍在处理。' : '关闭后会丢失未提交的人工判断。',
      detail: risk === 'pending' ? '建议留在页面按提示确认原操作结果。强制关闭不会撤销服务端操作，重新打开后须核对候选状态。' : '已经提交到服务端的记录仍会保留。',
      buttons: ['继续检查', '仍然关闭'], defaultId: 0, cancelId: 0, noLink: true });
    return choice === 1;
  };
  const reasonMessages: Record<string, string> = {
    MODE_CONFLICT: '当前来源模式、目录基线或历史发布流程不支持此操作。请核对来源；旧候选须显式修订，结果不明的旧发布只能查询原回执。',
    ROLLBACK_PLAN_INVALIDATED: '发布基线或回退材料已改变，原回退计划已失效。请按当前版本重新查看回退影响。',
    MATERIAL_CHANGED: '候选版本或状态已改变，请刷新候选。修订失败不会替换旧版；结果不明时先恢复原操作。',
    ALREADY_PUBLISHED: '该候选已经发布，不能再修订或取消。后续更正须重新上传并检查。',
    BASE_CHANGED: '发布基线已改变，请重新导入形成新候选后再检查发布。',
    SOURCE_MISMATCH: '来源证据已改变，请刷新候选和材料后重新核对。',
    APPROVAL_CHANGED: '审批证据已改变，请刷新候选并读取最新审批状态。',
    AWAITING_APPROVAL: '历史内容未具备有效审批，不能直接复用；请显式修订或重新导入并完成检查。',
    HUMAN_REVIEW_REQUIRED: '当前人工检查资格不满足；关键稿须由有权且未参与改稿的人检查。',
    QUALITY_NOT_PASSED: '质量检查尚未通过，请完成本轮检查并刷新候选状态。',
    FILE_LIMIT: '文件超过限制。请选择不大于 10 MiB 的规范 CSV 或 XLSX 文件，并整批修正后重新上传。',
    FILE_INVALID: '文件格式或内容无效，请按当前来源格式重新导出规范 CSV 或 XLSX 文件。',
    APPROVAL_REVOKED: '历史组织审批已撤回，相关内容不能恢复；请显式修订或重新导入并检查。',
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
      const nativeFiles = createIntakeNativeFiles(win);
      manager = new ContentIntakeManagement(session, nativeFiles, nativeFiles.confirmPublication); windows.set(wc, manager);
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
