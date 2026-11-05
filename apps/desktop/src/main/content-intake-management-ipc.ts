import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { isIntakeManagementCommand, type IntakeManagementReply } from '../shared/content-intake-management';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import { isTrustedMainFrameSender } from './sender-guard';
import { ContentIntakeManagement } from './content-intake-management';
import { createIntakeNativeFiles } from './content-intake-native-files';
import { projectIntakeShellLine, type PackagedProductProfile } from './product-runtime-config';
import { WORKBENCH_EMPTY } from '../shared/workbench-empty';
import type { OperationCommand } from '../../../../packages/unified-contracts/src/index.ts';
import {
  DashboardControlPlaneError,
  dashboardControlPlaneForSession,
  type DashboardDomainOutcome,
  type DashboardOperationDomain,
  type DashboardRecoveryOutcome,
} from './dashboard-control-plane';
const CHANNELS = ['dashboard:intake-mode', 'dashboard:intake-shell-line', 'dashboard:intake-current', 'dashboard:intake-command'] as const;

function userDataDirectory(): string | null {
  try {
    return app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}

function writeBoundary(
  command: Parameters<ContentIntakeManagement['command']>[0],
): { domain: DashboardOperationDomain; operationCommand: 'source-confirm' | 'publish' | 'review' | 'candidate-cancel' | 'rollback' } | null {
  if (command.action === 'rollback-execute') return { domain: 'rollback', operationCommand: 'rollback' };
  if (command.action === 'confirm-source') return { domain: 'materials', operationCommand: 'source-confirm' };
  if (command.action === 'publish') return { domain: 'materials', operationCommand: 'publish' };
  if (command.action === 'cancel-candidate') return { domain: 'materials', operationCommand: 'candidate-cancel' };
  if (command.action === 'freeze' || command.action === 'submit') {
    return { domain: 'materials', operationCommand: 'review' };
  }
  return null;
}

type ManagedOperationCommand = NonNullable<ReturnType<typeof writeBoundary>>['operationCommand'];

function operationScope(view: ReturnType<ContentIntakeManagement['view']>) {
  return {
    selected: view.selected ? {
      key: view.selected.key,
      sourceId: view.selected.sourceId,
      state: view.selected.state,
    } : null,
    rollback: view.rollback.impact ? {
      baseReleaseId: view.rollback.impact.baseReleaseId,
      targetReleaseId: view.rollback.impact.targetReleaseId,
    } : null,
  };
}

function effectIdentity(
  view: ReturnType<ContentIntakeManagement['view']>,
  boundary: NonNullable<ReturnType<typeof writeBoundary>>,
): string | null {
  if (view.pending) return `pending:${view.pending.operationId}`;
  if (boundary.domain === 'rollback') {
    const result = view.rollback.result;
    return result ? `rollback:${result.state}:${result.releaseId ?? ''}` : null;
  }
  const workflow = view.workflowResult;
  if (boundary.operationCommand === 'publish' && workflow?.action === 'publish') {
    return `publish:${workflow.operationId}`;
  }
  if (boundary.operationCommand === 'candidate-cancel' && workflow?.action === 'cancel') {
    return `cancel:${workflow.operationId}`;
  }
  if (boundary.operationCommand === 'source-confirm' && workflow?.action === 'source-confirm') {
    return `source-confirm:${workflow.operationId}`;
  }
  if (boundary.operationCommand === 'review' && view.receipt) {
    return `review:${view.receipt.operationId}`;
  }
  return null;
}

function domainReference(
  view: ReturnType<ContentIntakeManagement['view']>,
  boundary: NonNullable<ReturnType<typeof writeBoundary>>,
): string | null {
  if (view.pending?.operationId) return view.pending.operationId;
  if (boundary.domain === 'rollback') return null;
  const workflow = view.workflowResult;
  if (workflow?.operationId) return workflow.operationId;
  return boundary.operationCommand === 'review' ? view.receipt?.operationId ?? null : null;
}

export function operationRecoveryCommand(
  domain: DashboardOperationDomain,
  command: ManagedOperationCommand,
): Parameters<ContentIntakeManagement['command']>[0] {
  if (domain === 'rollback') return { action: 'rollback-recover' };
  return { action: command === 'source-confirm' ? 'retry' : 'recover' };
}

export function operationRecoveryOutcome(
  view: ReturnType<ContentIntakeManagement['view']>,
  domain: DashboardOperationDomain,
  command: ManagedOperationCommand,
  operationId: string,
  domainRef: string | null,
): DashboardRecoveryOutcome {
  if (domain === 'rollback') {
    if (view.rollback.pending) return { kind: 'unknown' };
    const result = view.rollback.result;
    if (result?.state === 'published' && result.releaseId) {
      return { kind: 'committed', resultRef: result.releaseId, releaseId: result.releaseId };
    }
    if (result?.state === 'cancelled') return { kind: 'committed', resultRef: operationId };
    if (result?.state === 'failed') return { kind: 'failed', failureCode: 'ROLLBACK_FAILED' };
    return { kind: 'unknown' };
  }
  if (view.pending) return { kind: 'unknown' };
  const workflow = view.workflowResult;
  if (command === 'publish' && workflow?.action === 'publish'
    && workflow.operationId === domainRef
    && workflow.state === 'published' && workflow.releaseId) {
    return { kind: 'committed', resultRef: workflow.releaseId, releaseId: workflow.releaseId };
  }
  if (command === 'candidate-cancel' && workflow?.action === 'cancel'
    && workflow.operationId === domainRef && workflow.state === 'cancelled') {
    return { kind: 'committed', resultRef: workflow.operationId };
  }
  if (command === 'source-confirm' && workflow?.action === 'source-confirm'
    && workflow.operationId === domainRef && workflow.state === 'confirmed') {
    return { kind: 'committed', resultRef: workflow.operationId };
  }
  if (command === 'review' && view.receipt?.operationId === domainRef) {
    return { kind: 'committed', resultRef: view.receipt.operationId };
  }
  return { kind: 'unknown' };
}

function mutationOutcome(
  view: ReturnType<ContentIntakeManagement['view']>,
  boundary: NonNullable<ReturnType<typeof writeBoundary>>,
  operationId: string,
  effect: string | null,
): DashboardDomainOutcome<ReturnType<ContentIntakeManagement['view']>> {
  if (view.pending || view.rollback.pending) return { kind: 'unknown', result: view };
  if (boundary.domain === 'rollback') {
    const result = view.rollback.result;
    if (result?.state === 'published' && result.releaseId && effect) {
      return { kind: 'committed', result: view, resultRef: result.releaseId, releaseId: result.releaseId };
    }
    if (result?.state === 'cancelled' && effect) return { kind: 'committed', result: view, resultRef: operationId };
    if (result?.state === 'failed') return { kind: 'failed', result: view, failureCode: 'ROLLBACK_FAILED' };
    if (result?.state === 'pending' || result?.state === 'unknown') return { kind: 'unknown', result: view };
    return { kind: 'cancelled', result: view };
  }
  const workflow = view.workflowResult;
  if (boundary.operationCommand === 'publish'
    && workflow?.action === 'publish'
    && effect
    && workflow.state === 'published'
    && workflow.releaseId) {
    return { kind: 'committed', result: view, resultRef: workflow.releaseId, releaseId: workflow.releaseId };
  }
  if (boundary.operationCommand === 'candidate-cancel'
    && workflow?.action === 'cancel'
    && effect
    && workflow.state === 'cancelled') {
    return { kind: 'committed', result: view, resultRef: workflow.operationId };
  }
  if (boundary.operationCommand === 'source-confirm'
    && workflow?.action === 'source-confirm'
    && effect
    && workflow.state === 'confirmed') {
    return { kind: 'committed', result: view, resultRef: workflow.operationId };
  }
  if (boundary.operationCommand === 'review' && view.receipt && effect) {
    return { kind: 'committed', result: view, resultRef: view.receipt.operationId };
  }
  return { kind: 'cancelled', result: view };
}

/** The explicit synthetic profile and a packaged https profile both provide a
 * session. No renderer supplies an identity. */
export function registerContentIntakeManagementIpc(session: ProductSession | null,
  dashboard: () => WebContents | null, devUrl: () => string | undefined,
  profile: PackagedProductProfile | null = null) {
  const windows = new Map<WebContents, ContentIntakeManagement>();
  const plane = session
    ? dashboardControlPlaneForSession(session, userDataDirectory())
    : null;
  let closing = false;
  const allowClose = (manager?: ContentIntakeManagement) => {
    if (closing) return true;
    const risk = manager?.closeRisk() ?? [...windows.values()].map(m => m.closeRisk()).find(Boolean);
    if (!risk) return true;
    const choice = dialog.showMessageBoxSync({ type: 'warning', title: '关闭资料',
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
    if (channel === 'dashboard:intake-shell-line') {
      const line = projectIntakeShellLine(profile);
      return { ok: true, profileMode: line?.profileMode ?? null, contentIntake: line?.contentIntake ?? null };
    }
    if (!session) return { ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.intakeUnmounted, view: null };
    let manager = windows.get(wc);
    if (!manager) {
      const win = BrowserWindow.fromWebContents(wc);
      if (!win || win.isDestroyed()) return failure('FORBIDDEN');
      const nativeFiles = createIntakeNativeFiles(win);
      manager = new ContentIntakeManagement(session, nativeFiles, nativeFiles.confirmPublication); windows.set(wc, manager);
      const owned = manager;
      if (plane) {
        plane.registerRecovery('materials', async (context): Promise<DashboardRecoveryOutcome> => {
          if (!context.domainRef && !owned.view().pending) return { kind: 'unknown' };
          try {
            const command = commandForRecovery(context.command);
            return operationRecoveryOutcome(
              await owned.command(operationRecoveryCommand('materials', command)),
              'materials',
              command,
              context.operationId,
              context.domainRef,
            );
          } catch {
            return { kind: 'unknown' };
          }
        });
        plane.registerRecovery('rollback', async (context): Promise<DashboardRecoveryOutcome> => {
          if (!context.domainRef && !owned.view().rollback.pending) return { kind: 'unknown' };
          try {
            return operationRecoveryOutcome(
              await owned.command(operationRecoveryCommand('rollback', 'rollback')),
              'rollback',
              'rollback',
              context.operationId,
              context.domainRef,
            );
          } catch {
            return { kind: 'unknown' };
          }
        });
      }
      const close = (event: { preventDefault(): void }) => { if (!allowClose(owned)) event.preventDefault(); };
      win?.on('close', close);
      owned.subscribe(() => { if (!wc.isDestroyed()) wc.send('dashboard:intake-invalidated'); });
      wc.once('destroyed', () => { win?.removeListener('close', close); windows.delete(wc); owned.dispose(); });
    }
    try {
      if (channel === 'dashboard:intake-current') await manager.settleUpload();
      if (channel === 'dashboard:intake-current') return { ok: true, view: manager.view() };
      const command = args[0] as Parameters<ContentIntakeManagement['command']>[0];
      if (command.action === 'recover' || command.action === 'rollback-recover') {
        const recovered = await plane?.recover(
          command.action === 'rollback-recover' ? 'rollback' : 'materials',
        );
        if (!recovered) return { ok: true, view: await manager.command(command) };
        return { ok: true, view: manager.view() };
      }
      const boundary = writeBoundary(command);
      if (!plane || !boundary) return { ok: true, view: await manager.command(command) };
      const run = await plane.submit({
        domain: boundary.domain,
        command: boundary.operationCommand,
        capability: boundary.domain === 'rollback'
          ? 'rollback:execute'
          : `materials:${boundary.operationCommand}`,
        expectedVersion: 0,
        scope: operationScope(manager.view()),
        intent: command,
        execute: async (operation) => {
          const beforeEffect = effectIdentity(manager.view(), boundary);
          try {
            const view = await manager.command(command, operation);
            const currentEffect = effectIdentity(view, boundary);
            const effect = currentEffect !== null && currentEffect !== beforeEffect
              ? currentEffect
              : null;
            const outcome = mutationOutcome(view, boundary, operation.operationId, effect);
            const reference = domainReference(view, boundary);
            if (reference) await operation.noteDomainRef(reference);
            return outcome;
          } catch (error) {
            const view = manager.view();
            const reference = domainReference(view, boundary);
            if (reference) await operation.noteDomainRef(reference);
            if (view.pending || view.rollback.pending) return { kind: 'unknown', result: view };
            if (error instanceof ProductHttpError && ['VALIDATION','FORBIDDEN','CONFLICT'].includes(error.code)) {
              return { kind: 'failed', result: view, failureCode: error.code };
            }
            return { kind: 'unknown', result: view };
          }
        },
      });
      return { ok: true, view: run.result ?? manager.view() };
    } catch (error) {
      if (error instanceof DashboardControlPlaneError) {
        return failure(error.code, manager, error.message);
      }
      return failure(error instanceof ProductHttpError ? error.code : 'UNAVAILABLE', manager, error instanceof ProductHttpError ? error.reason : undefined);
    }
  });
  return { allowClose: () => { if (!allowClose()) return false; closing = true; return true; }, dispose: () => {
    closing = true; for (const m of windows.values()) m.dispose(); windows.clear();
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  } };
}

function commandForRecovery(value: OperationCommand): ManagedOperationCommand {
  switch (value) {
    case 'source-confirm':
    case 'publish':
    case 'review':
    case 'candidate-cancel':
    case 'rollback':
      return value;
    default:
      return 'review';
  }
}
