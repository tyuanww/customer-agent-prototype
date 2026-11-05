import { app, ipcMain, type WebContents } from 'electron';
import { isSeatAccountIntent, type SeatAccountIntent, type SeatAccountRecord, type SeatAccountReply } from '../shared/seat-account-intent';
import { isTrustedMainFrameSender } from './sender-guard';
import type { ProductSession } from './product-session';
import { ProductHttpError } from './product-http';
import { WORKBENCH_EMPTY } from '../shared/workbench-empty';
import {
  DashboardControlPlaneError,
  dashboardControlPlaneForSession,
  type DashboardOperationContext,
  type DashboardDomainOutcome,
} from './dashboard-control-plane';

/**
 * Seat administration over the product API.
 *
 * This used to spawn `scripts/synthetic-stack/seat-account-runtime.ts`, which connected as the
 * cluster owner to `customer_agent_synthetic` over a Unix socket under the stack root. Neither the
 * script nor that socket exists on an operator's machine, and the packaged app ships only `out/`
 * and `package.json`, so the call always failed there. The work now goes to the server, where
 * `backend_identity.create_seat` owns the identity writes.
 *
 * The renderer contract is unchanged: `dashboard:seats-command` still takes the same four intents
 * and still answers with the same reply shape. Only the transport moved.
 */
const CHANNEL = 'dashboard:seats-command';
const NOT_SAVED_MESSAGE = '账号没有保存。';
const NOT_SAVED: SeatAccountReply = { ok: false, message: NOT_SAVED_MESSAGE };
const INVALID: SeatAccountReply = { ok: false, message: '账号输入无效。' };
const NO_SESSION: SeatAccountReply = { ok: false, message: WORKBENCH_EMPTY.intakeUnmounted };
const DENIED: SeatAccountReply = { ok: false, message: '没有权限，请找人开通。' };

function userDataDirectory(): string | null {
  try {
    return app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}

function seatOutcome(
  reply: SeatAccountReply,
  username: string,
): DashboardDomainOutcome<SeatAccountReply> {
  if (reply.ok) return { kind: 'committed', result: reply, resultRef: username };
  const failure = reply as { ok: false; message: string };
  if (failure.message === NOT_SAVED_MESSAGE) {
    return { kind: 'unknown', result: reply };
  }
  return { kind: 'failed', result: reply, failureCode: 'FORBIDDEN' };
}

function controlSeatFailure(error: unknown): SeatAccountReply {
  if (!(error instanceof DashboardControlPlaneError)) return NOT_SAVED;
  if (error.code === 'UNAUTHORIZED') return NO_SESSION;
  if (error.code === 'FORBIDDEN') return DENIED;
  if (error.code === 'VALIDATION') return INVALID;
  return { ok: false, message: '操作结果还未确认。请刷新账号列表核对。' };
}

/** Server refusals the operator can act on, keyed by the reason the API returns. Anything else is
 *  a state change or an outage, and "try again" would be the wrong instruction. */
const REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  SEAT_USERNAME_INVALID: '登录名只能用字母、数字、下划线或连字符，最长 64 位。',
  SEAT_DISPLAY_NAME_INVALID: '姓名不能为空，最长 256 字，也不能含控制字符。',
  SEAT_POST_INVALID: '请选择岗位。',
  SEAT_ROLE_NOT_IN_CEILING: '这个岗位在当前策略里没有对应角色，请先配置。',
  SEAT_HOME_UNKNOWN: '服务端没有这个租户的策略，账号没有保存。',
  SEAT_EXISTS: '这个登录名已经存在，请换一个或改用重置口令。',
  SEAT_DISPLAY_NAME_TAKEN: '已经有同名的人，请在姓名里加区分。',
  FILE_INVALID: '账号输入无效。',
  SCOPE_DENIED: '当前身份不能管理账号。',
  SEAT_FORBIDDEN: '当前身份不能管理账号。',
  SEAT_PASSWORD_NOT_WRITTEN: '身份记录没有丢失，但口令没有写入。请从账号列表重试重置密码。',
});

type SeatRow = Readonly<{ displayName: string; username: string; post: string; enabled: boolean }>;

function sameRow(value: unknown): SeatRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.displayName !== 'string' || typeof row.username !== 'string'
    || typeof row.post !== 'string' || typeof row.enabled !== 'boolean') return null;
  return { displayName: row.displayName, username: row.username, post: row.post, enabled: row.enabled };
}

/** Reasons arrive as `details.reason` on an intake failure, which `ProductHttpError` carries
 *  through unchanged. The enum is open on the server side, so read the field rather than a closed
 *  contract schema these routes sit outside of. */
function refusalReason(error: unknown): string | null {
  return error instanceof ProductHttpError && typeof error.reason === 'string' ? error.reason : null;
}

function seatFailureReply(error: unknown): SeatAccountReply | null {
  const message = REFUSALS[refusalReason(error) ?? ''];
  if (message) return { ok: false, message };
  if (error instanceof ProductHttpError
    && !['UNAVAILABLE', 'OVERLOADED', 'RATE_LIMITED', 'CANCELLED'].includes(error.code)) {
    return NOT_SAVED;
  }
  return null;
}

export function registerSeatAccountIpc(
  session: ProductSession | null,
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
  enabled: () => boolean,
  canManageAccounts: () => boolean,
  listSeats: ((epoch: number) => Promise<{ readonly seats: readonly SeatAccountRecord[] } | { readonly state: 'closed' }>) | null = null,
) {
  const plane = session
    ? dashboardControlPlaneForSession(session, userDataDirectory())
    : null;
  async function request(
    epoch: number,
    path: string,
    init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown },
    operation?: DashboardOperationContext,
  ) {
    operation?.signal.throwIfAborted();
    operation?.beginCommit();
    const response = await session!.request(epoch, path, {
      ...init,
      ...(operation ? { signal: operation.signal } : {}),
      maxResponseBytes: 262_144,
    });
    return response.value;
  }

  async function perform(intent: SeatAccountIntent): Promise<SeatAccountReply> {
    if (!session || !session.view().signedIn) return NO_SESSION;
    const epoch = session.view().sessionEpoch;
    try {
      if (intent.action === 'list') {
        if (!listSeats) return DENIED;
        const listed = await listSeats(epoch);
        if (!('seats' in listed)) return DENIED;
        return { ok: true, action: 'list', seats: [...listed.seats] };
      }
      const runMutation = async (
        work: (operation?: DashboardOperationContext) => Promise<SeatAccountReply>,
        username: string,
      ): Promise<SeatAccountReply> => {
        if (!plane) return work();
        try {
          const run = await plane.submit({
            domain: 'accounts',
            command: 'accounts-manage',
            expectedVersion: 0,
            intent,
            authorize: (view) => view.accounts === 'open',
            execute: async (operation) => {
              try {
                return seatOutcome(await work(operation), username);
              } catch (error) {
                if (operation.signal.aborted) throw error;
                const reply = seatFailureReply(error);
                if (reply) {
                  return {
                    kind: 'failed',
                    result: reply,
                    failureCode: error instanceof ProductHttpError ? error.code : 'UNAVAILABLE',
                  };
                }
                return { kind: 'unknown', result: NOT_SAVED };
              }
            },
          });
          return run.result ?? {
            ok: false,
            message: run.view.state === 'unknown'
              ? '操作结果还未确认。请刷新账号列表核对。'
              : '操作已完成，请刷新账号列表核对。',
          };
        } catch (error) {
          return controlSeatFailure(error);
        }
      };
      if (intent.action === 'create') {
        return runMutation(async (operation) => {
          const value = await request(epoch, '/v1/intake/seats', {
            method: 'POST',
            body: { displayName: intent.displayName, username: intent.username, password: intent.password, post: intent.post },
          }, operation);
          const seat = sameRow((value as { seat?: unknown }).seat);
          return seat ? { ok: true, action: 'create', seat: seat as SeatAccountRecord } : NOT_SAVED;
        }, intent.username);
      }
      if (intent.action === 'reset') {
        return runMutation(async (operation) => {
          await request(epoch, `/v1/intake/seats/${encodeURIComponent(intent.username)}/password`, {
            method: 'POST', body: { password: intent.password },
          }, operation);
          return { ok: true, action: 'reset', username: intent.username };
        }, intent.username);
      }
      return runMutation(async (operation) => {
        await request(
          epoch,
          `/v1/intake/seats/${encodeURIComponent(intent.username)}`,
          { method: 'DELETE' },
          operation,
        );
        return { ok: true, action: 'disable', username: intent.username };
      }, intent.username);
    } catch (error) {
      const reason = refusalReason(error);
      const message = reason === null ? null : REFUSALS[reason];
      if (message) return { ok: false, message };
      // A refusal that has no operator-facing sentence means the session or the service moved.
      // Say so plainly instead of reporting a save that did not happen.
      console.error(`seat account command failed: ${error instanceof ProductHttpError ? error.code : 'unknown'}`);
      return NOT_SAVED;
    }
  }

  ipcMain.handle(CHANNEL, async (event, intent: unknown): Promise<SeatAccountReply> => {
    const contents = dashboard();
    if (!contents || !isTrustedMainFrameSender(event, [contents], devUrl())) return { ok: false, message: '无权访问此窗口能力。' };
    if (!enabled()) return { ok: false, message: '账号还不能在这里改。' };
    if (!isSeatAccountIntent(intent)) return INVALID;
    if (!canManageAccounts()) return DENIED;
    return perform(intent);
  });
  return { dispose: () => { ipcMain.removeHandler(CHANNEL); } };
}
