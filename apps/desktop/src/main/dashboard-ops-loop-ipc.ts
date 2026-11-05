import { app, ipcMain, shell, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  OPS_LOOP_COPY,
  dashboardOpsFailure,
  isDashboardOpsFailure,
  type DashboardOpsFailure,
} from '../shared/dashboard-ops-loop';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardQuestionRates,
  dashboardRetrievalMetrics,
  dashboardScriptDelete,
  dashboardSoftwareCatalog,
  dashboardSoftwareOpenDownload,
  dashboardSopCatalog,
  dashboardSopDelete,
  dashboardSopImport,
  dashboardSopPatch,
  type DashboardOpsSessionClient,
} from './dashboard-ops-loop';
import type { PageUseReader } from './page-use';
import {
  DashboardControlPlaneError,
  bindDashboardOperationSession,
  dashboardControlPlaneForSession,
  type DashboardDomainOutcome,
  type DashboardOperationDomain,
} from './dashboard-control-plane';

function userDataDirectory(): string | null {
  try {
    return app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}

function controlFailure(error: unknown): DashboardOpsFailure {
  if (!(error instanceof DashboardControlPlaneError)) return dashboardOpsFailure('UNAVAILABLE');
  if (error.code === 'FORBIDDEN') return dashboardOpsFailure('FORBIDDEN', error.message);
  if (error.code === 'VALIDATION') return dashboardOpsFailure('VALIDATION', error.message);
  if (error.code === 'CONFLICT') return dashboardOpsFailure('CONFLICT', error.message);
  if (error.code === 'UNAUTHORIZED') return dashboardOpsFailure('UNAUTHORIZED', OPS_LOOP_COPY.noSession);
  if (error.code === 'STALE') return dashboardOpsFailure('UNAVAILABLE', '会话已变化，请重新读取。');
  return dashboardOpsFailure('UNAVAILABLE');
}

function writeOutcome<T extends object>(
  result: T,
  resultRef: (success: Exclude<T, DashboardOpsFailure>, operationId: string) => string,
  operationId: string,
): DashboardDomainOutcome<T> {
  if (isDashboardOpsFailure(result)) {
    if (result.code === 'UNAVAILABLE') return { kind: 'unknown', result };
    return { kind: 'failed', result, failureCode: result.code };
  }
  return {
    kind: 'committed',
    result,
    resultRef: resultRef(result as Exclude<T, DashboardOpsFailure>, operationId),
  };
}

export function registerDashboardOpsLoopIpc(
  session: DashboardOpsSessionClient | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
  openExternal: (url: string) => Promise<void> = async (url) => {
    await shell.openExternal(url);
  },
  pageUse: PageUseReader | null = null,
): void {
  const plane = session
    ? dashboardControlPlaneForSession(session, userDataDirectory())
    : null;
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  const wrap = async (
    event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0],
    args: unknown[],
    expected: number,
    work: () => Promise<unknown>,
  ): Promise<unknown | DashboardOpsFailure> => {
    if (!guard(event)) return dashboardOpsFailure('FORBIDDEN');
    if (args.length !== expected) return dashboardOpsFailure('VALIDATION');
    try {
      return await work();
    } catch {
      return dashboardOpsFailure('UNAVAILABLE');
    }
  };

  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_RETRIEVAL, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => {
      const window = args[0];
      if (window !== 'current_release' && window !== 'last_7d') {
        return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      }
      return dashboardRetrievalMetrics(session, window);
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_QUESTION_RATES, (event, ...args: unknown[]) =>
    wrap(event, args, 2, () => {
      const start = args[0];
      const end = args[1];
      if (typeof start !== 'string' || typeof end !== 'string') return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      const startAt = new Date(start);
      const endAt = new Date(end);
      if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf()) || startAt > endAt) {
        return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      }
      const shopRateWindowMs = 366 * 24 * 60 * 60 * 1000;
      if (endAt.getTime() - startAt.getTime() >= shopRateWindowMs) {
        return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      }
      return dashboardQuestionRates(session, start, end);
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_CATALOG, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSopCatalog(session)));
  const followWrite = async (result: unknown) => {
    if (!pageUse || !session) return result;
    const epoch = session.view().sessionEpoch;
    if (result && typeof result === 'object' && 'ok' in result && result.ok === true) {
      await pageUse.afterSopWrite(epoch, { ok: true });
      return result;
    }
    if (result && typeof result === 'object' && 'ok' in result && result.ok === false && 'code' in result && typeof result.code === 'string') {
      await pageUse.afterSopWrite(epoch, { ok: false, code: result.code });
    }
    return result;
  };
  const runWrite = async <T extends object>(
    domain: DashboardOperationDomain,
    command: 'content-manage' | 'import' | 'publish' | 'candidate-cancel',
    intent: unknown,
    expectedVersion: number,
    work: (client: DashboardOpsSessionClient) => Promise<T>,
    resultRef: (result: Exclude<T, DashboardOpsFailure>, operationId: string) => string,
  ): Promise<T | DashboardOpsFailure> => {
    if (!plane) return work(session!);
    try {
      const run = await plane.submit({
        domain,
        command,
        expectedVersion,
        intent,
        execute: async (operation) => {
          const result = await work(bindDashboardOperationSession(session!, operation));
          return operation.signal.aborted
            ? { kind: 'cancelled', result }
            : writeOutcome(result, resultRef, operation.operationId);
        },
      });
      return run.result ?? dashboardOpsFailure('UNAVAILABLE', '操作已完成，请刷新查看。');
    } catch (error) {
      return controlFailure(error);
    }
  };
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_IMPORT, (event, ...args: unknown[]) =>
    wrap(event, args, 1, async () => {
      if (typeof args[0] !== 'string') return dashboardSopImport(session, '');
      return followWrite(await runWrite(
        'ops-loop',
        'import',
        args[0],
        0,
        (client) => dashboardSopImport(client, args[0] as string),
        (_result, operationId) => `sop-import:${operationId}`,
      ));
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_PATCH, (event, ...args: unknown[]) =>
    wrap(event, args, 1, async () => {
      const request = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] as Record<string, unknown>
        : null;
      return followWrite(await runWrite(
        'ops-loop',
        'content-manage',
        args[0],
        typeof request?.expectedVersion === 'number' ? request.expectedVersion : 0,
        (client) => dashboardSopPatch(client, args[0]),
        (result) => `${result.nodeId}:${String(result.version)}`,
      ));
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_DELETE, (event, ...args: unknown[]) =>
    wrap(event, args, 1, async () => {
      const request = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] as Record<string, unknown>
        : null;
      return followWrite(await runWrite(
        'ops-loop',
        'content-manage',
        args[0],
        typeof request?.expectedVersion === 'number' ? request.expectedVersion : 0,
        (client) => dashboardSopDelete(client, args[0]),
        (result) => `${result.nodeId}:${String(result.version)}`,
      ));
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SCRIPT_DELETE, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => {
      const request = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] as Record<string, unknown>
        : null;
      return runWrite(
        'ops-loop',
        'content-manage',
        args[0],
        typeof request?.expectedVersion === 'number' ? request.expectedVersion : 0,
        (client) => dashboardScriptDelete(client, args[0]),
        (result) => `${result.scriptId}:${result.mutationId}`,
      );
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOFTWARE, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSoftwareCatalog(session)));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOFTWARE_OPEN, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSoftwareOpenDownload(session, openExternal)));
}
