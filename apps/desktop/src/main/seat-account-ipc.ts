import { ipcMain, type WebContents } from 'electron';
import { isSeatAccountIntent, type SeatAccountIntent, type SeatAccountRecord, type SeatAccountReply } from '../shared/seat-account-intent';
import { isTrustedMainFrameSender } from './sender-guard';
import type { ProductSession } from './product-session';
import { ProductHttpError } from './product-http';
import { WORKBENCH_EMPTY } from '../shared/workbench-empty';

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
const NOT_SAVED: SeatAccountReply = { ok: false, message: '账号没有保存。' };
const INVALID: SeatAccountReply = { ok: false, message: '账号输入无效。' };
const NO_SESSION: SeatAccountReply = { ok: false, message: WORKBENCH_EMPTY.intakeUnmounted };
const DENIED: SeatAccountReply = { ok: false, message: '没有权限，请找人开通。' };

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

export function registerSeatAccountIpc(
  session: ProductSession | null,
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
  enabled: () => boolean,
  allowsWrite: () => boolean,
) {
  async function request(epoch: number, path: string, init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown }) {
    const response = await session!.request(epoch, path, { ...init, maxResponseBytes: 262_144 });
    return response.value;
  }

  async function perform(intent: SeatAccountIntent): Promise<SeatAccountReply> {
    if (!session || !session.view().signedIn) return NO_SESSION;
    const epoch = session.view().sessionEpoch;
    try {
      if (intent.action === 'list') {
        const value = await request(epoch, '/v1/intake/seats', { method: 'GET' });
        const rows = (value as { seats?: unknown }).seats;
        if (!Array.isArray(rows)) return NOT_SAVED;
        const seats: SeatAccountRecord[] = [];
        for (const row of rows) {
          const seat = sameRow(row);
          if (!seat) return NOT_SAVED;
          seats.push(seat as SeatAccountRecord);
        }
        return { ok: true, action: 'list', seats };
      }
      if (intent.action === 'create') {
        const value = await request(epoch, '/v1/intake/seats', {
          method: 'POST',
          body: { displayName: intent.displayName, username: intent.username, password: intent.password, post: intent.post },
        });
        const seat = sameRow((value as { seat?: unknown }).seat);
        return seat ? { ok: true, action: 'create', seat: seat as SeatAccountRecord } : NOT_SAVED;
      }
      if (intent.action === 'reset') {
        await request(epoch, `/v1/intake/seats/${encodeURIComponent(intent.username)}/password`, {
          method: 'POST', body: { password: intent.password },
        });
        return { ok: true, action: 'reset', username: intent.username };
      }
      await request(epoch, `/v1/intake/seats/${encodeURIComponent(intent.username)}`, { method: 'DELETE' });
      return { ok: true, action: 'disable', username: intent.username };
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
    if (intent.action !== 'list' && !allowsWrite()) return DENIED;
    return perform(intent);
  });
  return { dispose: () => { ipcMain.removeHandler(CHANNEL); } };
}
