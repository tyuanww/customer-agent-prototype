import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isQuerySopNavigation, isQuerySopWindowIntent } from '../shared/query-sop-window';
import { SOP_UNAVAILABLE, isSopDraftIdentity, isSopDraftStart, isSopDraftUpdate, isSopDraftDiscard, isSopShowQueryReady, isSopExecutionCommand, isSopExecutionCopy, isSopExecutionRename, isSopRenameRequest, isSopReadyRequest,
  isQuerySopRevision, sopWindowFailure } from '../shared/sop-window';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayController } from './overlay-controller';
import type { SopWindowController } from './sop-window-controller';
import type { SopHost, SopPresentationOwner } from './sop-presentation-owner';

export type SopWindowIpcHost = { getOverlay(): OverlayController | null; getSop(): SopWindowController | null; getPresentation(): SopPresentationOwner | null };
export function registerSopWindowIpc(host: SopWindowIpcHost): void {
  const guard = (event: IpcMainInvokeEvent, expected: SopHost): boolean => {
    const overlay = host.getOverlay();
    if (!overlay) return false;
    const contents = expected === 'query' ? overlay.trustedContents().filter(item => overlay.overlayRoleOf(item) === 'query')
      : host.getPresentation()?.floatingTaskFor(event.sender) ? [event.sender] : [];
    return isTrustedMainFrameSender(event, contents, overlay.rendererDevServerUrl)
      && new URL(event.sender.getURL()).searchParams.get('role') === (expected === 'query' ? 'query' : 'sop-floating');
  };
  const failure = () => sopWindowFailure('INVALID', '流程操作无效，请重新选择');
  for (const source of ['query', 'floating'] as const) {
    const prefix = source === 'query' ? 'query-sop' : 'sop-floating';
    const floatingTask = (event: IpcMainInvokeEvent) => source === 'floating' ? host.getPresentation()?.floatingTaskFor(event.sender) ?? undefined : undefined;
    ipcMain.handle(`${prefix}:current`, event => guard(event, source) ? host.getPresentation()?.currentSnapshot(source, floatingTask(event)) ?? SOP_UNAVAILABLE : SOP_UNAVAILABLE);
    ipcMain.handle(`${prefix}:ready`, (event, request: unknown) => guard(event, source) && isSopReadyRequest(request) && host.getPresentation()?.ready(source, request, floatingTask(event)) === true);
    ipcMain.handle(`${prefix}:window`, (event, request: unknown) => guard(event, source) && isQuerySopWindowIntent(request)
      ? host.getPresentation()?.windowIntent(source, request, floatingTask(event)) ?? false : false);
    ipcMain.handle(`${prefix}:command`, (event, request: unknown) => {
      if (!guard(event, source) || !isSopExecutionCommand(request)
        || !host.getPresentation()?.canExecute(source, request.taskId, request.hostEpoch, floatingTask(event))) return failure();
      const { hostEpoch: _epoch, ...command } = request;
      return host.getSop()?.command(command) ?? failure();
    });
    ipcMain.handle(`${prefix}:copy`, (event, request: unknown) => {
      if (!guard(event, source) || !isSopExecutionCopy(request)
        || !host.getPresentation()?.canExecute(source, request.taskId, request.hostEpoch, floatingTask(event))) return { ok: false, message: '步骤已变化，请按当前步骤复制' };
      const { hostEpoch: _epoch, ...copy } = request;
      return host.getSop()?.copyCurrent(copy) ?? { ok: false, message: '流程暂不可用' };
    });
    ipcMain.handle(`${prefix}:rename-current`, (event, request: unknown) => {
      if (!guard(event, source) || !isSopExecutionRename(request)
        || !host.getPresentation()?.canExecute(source, request.taskId, request.hostEpoch, floatingTask(event))) return failure();
      const { hostEpoch: _epoch, ...rename } = request;
      const result = host.getSop()?.rename(rename) ?? failure();
      if (result.ok) host.getPresentation()?.clearDraft(request.taskId);
      return result;
    });
    ipcMain.handle(`${prefix}:draft-current`, (event, request: unknown) => {
      const owner = host.getPresentation();
      if (!guard(event, source) || !isSopDraftIdentity(request) || !owner?.canEditDraft(source, request.taskId, request.hostEpoch, floatingTask(event))) return { ok: false };
      return { ok: true, draft: owner.draftCurrent(request.taskId) };
    });
    ipcMain.handle(`${prefix}:draft-start`, (event, request: unknown) => {
      const owner = host.getPresentation();
      if (!guard(event, source) || !isSopDraftStart(request) || !owner?.canEditDraft(source, request.taskId, request.hostEpoch, floatingTask(event))) return { ok: false };
      const draft = owner.draftStart(request.taskId, request.revision);
      return draft ? { ok: true, draft } : { ok: false };
    });
    ipcMain.handle(`${prefix}:draft-update`, (event, request: unknown) => {
      const owner = host.getPresentation();
      return guard(event, source) && isSopDraftUpdate(request) && !!owner?.canEditDraft(source, request.taskId, request.hostEpoch, floatingTask(event))
        && owner.draftUpdate(request.taskId, request.draftId, request.sequence, request.value);
    });
    ipcMain.handle(`${prefix}:draft-discard`, (event, request: unknown) => {
      const owner = host.getPresentation();
      return guard(event, source) && isSopDraftDiscard(request) && !!owner?.canEditDraft(source, request.taskId, request.hostEpoch, floatingTask(event))
        && owner.draftDiscard(request.taskId, request.draftId);
    });
  }
  ipcMain.handle('query-sop:show-query-ready', (event, request: unknown) => guard(event, 'query') && isSopShowQueryReady(request)
    && host.getPresentation()?.showQueryReady(request) === true);
  ipcMain.handle('query-sop:navigate', (event, request: unknown) => {
    if (!guard(event, 'query') || !isQuerySopNavigation(request)) return failure();
    const owner = host.getPresentation(), overlay = host.getOverlay();
    if (!owner || !overlay || request.viewEpoch !== overlay.queryPresentation().viewEpoch) return failure();
    if (request.type === 'view-finished' && owner.finishTransition()) return { ok: true };
    if (request.type === 'restore') return host.getSop()?.restore(request.taskId, request.revision) ?? failure();
    if (request.type === 'home' || request.type === 'results') owner.showQuery();
    return overlay.navigateQuery({ ...request, viewEpoch: overlay.queryPresentation().viewEpoch }) ? { ok: true } : failure();
  });
  ipcMain.handle('query-sop:rename', (event, request: unknown) => guard(event, 'query') && isSopRenameRequest(request) ? host.getSop()?.rename(request) ?? failure() : failure());
  ipcMain.handle('query-sop:end-task', (event, request: unknown) => {
    if (!guard(event, 'query') || !isQuerySopRevision(request)) return failure();
    return host.getSop()?.command({ ...request, type: 'end' }) ?? failure();
  });
  ipcMain.handle('sop-window:open', (event, sceneId: unknown) => guard(event, 'query') && typeof sceneId === 'string' && sceneId.length <= 64
    ? host.getSop()?.open(sceneId) ?? failure() : failure());
  ipcMain.handle('sop-window:entry-available', event => guard(event, 'query') && host.getSop()?.entryAvailable() === true);
  ipcMain.handle('sop-window:resume-available', event => guard(event, 'query') && host.getSop()?.resumeAvailable() === true);
}
