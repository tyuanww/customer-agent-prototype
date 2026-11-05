import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  dashboardContentFailure,
  isDashboardContentPublishRequest,
  type DashboardContentPublishResult,
  type DashboardContentRollbackResult,
  type DashboardContentSessionResult,
} from '../shared/dashboard-content';
import {
  LIBRARY_DOMAINS,
  composeLibraryDelta,
  type LibraryDomainCounts,
} from '../shared/library-delta';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardContentParseUpload,
  dashboardContentPublish,
  dashboardContentRollbackPrevious,
  dashboardContentCancelInFlight,
  dashboardContentSession,
  type DashboardContentAfterPublish,
  type DashboardContentSessionClient,
} from './dashboard-content';
import {
  DashboardControlPlane,
  DashboardControlPlaneError,
  dashboardControlPlaneForSession,
  MemoryDashboardOperationStore,
  type DashboardDomainOutcome,
  type DashboardOperationView,
} from './dashboard-control-plane';

const OPERATION_CURRENT = 'dashboard:operation-current';
const OPERATION_COMMAND = 'dashboard:operation-command';
const OPERATION_CHANGED = 'dashboard:operation-changed';
const OPERATION_DOMAINS = new Set(['release', 'permissions', 'accounts', 'materials', 'rollback', 'ops-loop']);
const REGISTERED_PLANES = new WeakSet<DashboardControlPlane>();
let disabledOperationPlane: DashboardControlPlane | null = null;

function disabledPlane(): DashboardControlPlane {
  disabledOperationPlane ??= new DashboardControlPlane({
    session: {
      view: () => ({
        ok: true,
        enabled: false,
        signedIn: false,
        sessionEpoch: 1,
        userId: null,
        role: null,
      }),
      request: async () => {
        throw new DashboardControlPlaneError('UNAUTHORIZED', '请先登录。');
      },
    },
    store: new MemoryDashboardOperationStore(),
  });
  return disabledOperationPlane;
}

function operationUserDataDirectory(): string | null {
  try {
    return app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}

function controlFailure(error: unknown) {
  if (!(error instanceof DashboardControlPlaneError)) {
    return dashboardContentFailure('UNAVAILABLE', '操作暂未完成，请刷新后核对。');
  }
  if (error.code === 'UNAUTHORIZED') return dashboardContentFailure('UNAUTHORIZED', '请先登录后再操作。');
  if (error.code === 'FORBIDDEN') return dashboardContentFailure('FORBIDDEN', error.message);
  if (error.code === 'VALIDATION') return dashboardContentFailure('VALIDATION', error.message);
  if (error.code === 'CONFLICT') return dashboardContentFailure('CONFLICT', error.message);
  if (error.code === 'STALE') return dashboardContentFailure('STALE', error.message);
  return dashboardContentFailure('UNAVAILABLE', error.message);
}

function contentOutcome<T extends DashboardContentPublishResult | DashboardContentRollbackResult | { ok: true }>(
  result: T,
): DashboardDomainOutcome<T> {
  if (result.ok) {
    const releaseId = 'releaseId' in result ? result.releaseId : undefined;
    return {
      kind: 'committed',
      result,
      resultRef: releaseId ?? 'cancelled-import',
      ...(releaseId ? { releaseId } : {}),
    };
  }
  if (result.code === 'CANCELLED') return { kind: 'cancelled', result };
  if (result.code === 'UNAVAILABLE' || result.code === 'STALE') {
    return { kind: 'unknown', result };
  }
  return { kind: 'failed', result, failureCode: result.code };
}

function missingReplayResult(): DashboardContentPublishResult {
  return dashboardContentFailure('UNAVAILABLE', '操作已完成，请刷新页面核对结果。');
}

function publishSummaryWithCounts(
  payload: unknown,
  counts: LibraryDomainCounts,
): string | null {
  if (!isDashboardContentPublishRequest(payload)) return null;
  const bound = new Set(payload.sourceBindings.map((binding) => binding.domain));
  return composeLibraryDelta(LIBRARY_DOMAINS
    .filter((domain) => bound.has(domain))
    .map((domain) => ({ domain, count: counts[domain] ?? null })));
}

function operationReply(value: unknown, plane: DashboardControlPlane | null) {
  return {
    ok: true as const,
    view: value as DashboardOperationView | null,
    views: plane?.currentSync() ?? [],
  };
}

function registerOperationIpc(
  plane: DashboardControlPlane | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
): void {
  if (!plane) return;
  if (REGISTERED_PLANES.has(plane)) return;
  REGISTERED_PLANES.add(plane);
  if (process.env.DEMO_E2E === '1') {
    Object.defineProperty(globalThis, '__dashboardOperationTest', {
      value: Object.freeze({ plane }),
      configurable: true,
    });
  }
  const guard = (event: IpcMainInvokeEvent) => {
    const current = dashboardContents();
    return !!current && isTrustedMainFrameSender(event, [current], devUrl());
  };
  plane.subscribe(() => {
    const current = dashboardContents();
    if (current && !current.isDestroyed()) current.send(OPERATION_CHANGED);
  });
  ipcMain.handle(OPERATION_CURRENT, async (event, ...args: unknown[]) => {
    if (!guard(event)) {
      return { ok: false as const, code: 'FORBIDDEN', message: '无权访问此窗口能力。', views: [] };
    }
    if (args.length !== 0) {
      return { ok: false as const, code: 'VALIDATION', message: '操作输入无效。', views: [] };
    }
    try {
      return { ok: true as const, view: null, views: await plane.current() };
    } catch {
      return { ok: false as const, code: 'UNAVAILABLE', message: '操作记录暂不可用。', views: [] };
    }
  });
  ipcMain.handle(OPERATION_COMMAND, async (event, ...args: unknown[]) => {
    if (!guard(event)) {
      return { ok: false as const, code: 'FORBIDDEN', message: '无权访问此窗口能力。', views: [] };
    }
    const command = args[0];
    if (args.length !== 1 || !command || typeof command !== 'object' || Array.isArray(command)
      || Object.keys(command).length !== 2
      || !('action' in command) || !('domain' in command)
      || (command.action !== 'cancel' && command.action !== 'recover')
      || typeof command.domain !== 'string' || !OPERATION_DOMAINS.has(command.domain)) {
      return {
        ok: false as const,
        code: 'VALIDATION',
        message: '操作输入无效。',
        views: plane.currentSync(),
      };
    }
    try {
      const view = command.action === 'cancel'
        ? await plane.cancel(command.domain as Parameters<DashboardControlPlane['cancel']>[0])
        : await plane.recover(command.domain as Parameters<DashboardControlPlane['recover']>[0]);
      return operationReply(view, plane);
    } catch (error) {
      return {
        ok: false as const,
        code: error instanceof DashboardControlPlaneError ? error.code : 'UNAVAILABLE',
        message: error instanceof Error ? error.message : '操作结果仍待确认。',
        views: plane.currentSync(),
      };
    }
  });
}

export function registerDashboardContentIpc(
  session: (DashboardContentSessionClient & Pick<import('./product-session').ProductSession, 'logout'>) | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
  afterPublish?: DashboardContentAfterPublish,
): void {
  const plane = session
    ? dashboardControlPlaneForSession(session, operationUserDataDirectory())
    : null;
  registerOperationIpc(plane ?? disabledPlane(), dashboardContents, devUrl);

  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_SESSION,
    (event, ...args: unknown[]): DashboardContentSessionResult => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardContentFailure('VALIDATION');
      try {
        return dashboardContentSession(session);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.DASHBOARD_LOGOUT, async (event, ...args: unknown[]) => {
    if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
    if (args.length !== 0) return dashboardContentFailure('VALIDATION');
    if (!session) return dashboardContentFailure('UNAVAILABLE');
    try {
      const result = await session.logout();
      return result.ok ? { ok: true as const } : dashboardContentFailure('UNAVAILABLE', '已退出本机，服务端退出未确认。');
    } catch {
      return dashboardContentFailure('UNAVAILABLE', '退出未完成，请重试。');
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_PARSE,
    (event, ...args: unknown[]) => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardContentFailure('VALIDATION');
      try {
        return dashboardContentParseUpload(args[0]);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_PUBLISH,
    async (event, ...args: unknown[]): Promise<DashboardContentPublishResult> => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardContentFailure('VALIDATION');
      try {
        if (!plane) return dashboardContentPublish(session, args[0], afterPublish);
        if (!isDashboardContentPublishRequest(args[0])) {
          return dashboardContentPublish(session, args[0], afterPublish);
        }
        let counts: LibraryDomainCounts | null = null;
        const run = await plane.submit({
          domain: 'release',
          command: 'publish',
          expectedVersion: 0,
          intent: args[0],
          ...(afterPublish ? {
            onReleaseInvalidation: async (value) => {
              counts = await afterPublish(value.sessionEpoch);
            },
          } : {}),
          execute: async (context) => {
            const result = await dashboardContentPublish(session, args[0], undefined, context);
            return contentOutcome(result);
          },
        });
        const result = run.result ?? missingReplayResult();
        if (!result.ok || counts === null) return result;
        const withCounts = { ...result, summary: publishSummaryWithCounts(args[0], counts) };
        plane.replaceResult(run.view.operationId, withCounts);
        return withCounts;
      } catch (error) {
        return controlFailure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_ROLLBACK_PREVIOUS,
    async (event, ...args: unknown[]): Promise<DashboardContentRollbackResult> => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardContentFailure('VALIDATION');
      try {
        if (!plane) return dashboardContentRollbackPrevious(session);
        const run = await plane.submit({
          domain: 'rollback',
          command: 'rollback',
          expectedVersion: 0,
          intent: { action: 'rollback-previous' },
          ...(afterPublish ? {
            onReleaseInvalidation: async (value) => {
              await afterPublish(value.sessionEpoch);
            },
          } : {}),
          execute: async (context) => {
            const result = await dashboardContentRollbackPrevious(session, context);
            return contentOutcome(result);
          },
        });
        return run.result ?? dashboardContentFailure('UNAVAILABLE', '回退已完成，请刷新页面核对结果。');
      } catch (error) {
        return controlFailure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_CANCEL_IN_FLIGHT,
    async (event, ...args: unknown[]) => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardContentFailure('VALIDATION');
      try {
        if (!plane) return dashboardContentCancelInFlight(session);
        const run = await plane.submit({
          domain: 'materials',
          command: 'candidate-cancel',
          expectedVersion: 0,
          intent: { action: 'cancel-release-import' },
          execute: async (context) => {
            const result = await dashboardContentCancelInFlight(session, context);
            return contentOutcome(result);
          },
        });
        return run.result ?? dashboardContentFailure('UNAVAILABLE', '取消结果尚未确认。');
      } catch (error) {
        return controlFailure(error);
      }
    },
  );
}
