import type { SeatAccountIntent, SeatAccountReply } from '../../apps/desktop/src/shared/seat-account-intent.ts';
import { createSeatAccount, disableSeatAccount, resetSeatPassword, type SeatPeople, type SeatPasswords } from './seat-accounts.ts';

const MESSAGE: Record<string, string> = {
  'missing-person': '没有可授权的人。',
  'missing-post': '请选择岗位。',
  'missing-hash': '请设定密码。',
  'person-write-failed': '人员没有写入，已停止。',
  'password-write-failed': '口令没有写入，已停止。',
};

function fail(error: string): { ok: false; message: string } {
  return { ok: false, message: MESSAGE[error] ?? '账号没有保存。' };
}

export async function runSeatCommand(
  people: SeatPeople,
  passwords: SeatPasswords,
  intent: SeatAccountIntent,
): Promise<SeatAccountReply> {
  if (intent.action === 'disable') {
    const disabled = await disableSeatAccount(people, intent);
    if (!disabled.ok) return fail(disabled.error);
    return { ok: true, action: 'disable', username: intent.username };
  }
  if (intent.action === 'reset') {
    const reset = await resetSeatPassword(people, passwords, intent);
    if (!reset.ok) return fail(reset.error);
    return { ok: true, action: 'reset', username: reset.username };
  }
  const created = await createSeatAccount(people, passwords, intent);
  if (!created.ok) return fail(created.error);
  return {
    ok: true,
    action: 'create',
    seat: { displayName: intent.displayName.trim(), username: created.username, post: created.post, enabled: true },
  };
}
