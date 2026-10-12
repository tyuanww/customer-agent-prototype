import { exactKeys } from './product-session.ts';
import { isIntakePost, type IntakePost } from './intake-post-actions.ts';

export type SeatAccountIntent =
  | { action: 'list' }
  | { action: 'create'; displayName: string; username: string; password: string; post: IntakePost }
  | { action: 'reset'; username: string; password: string }
  | { action: 'disable'; username: string };

export type SeatAccountRecord = {
  displayName: string;
  username: string;
  post: IntakePost;
  enabled: boolean;
};

export type SeatAccountReply =
  | { ok: true; action: 'list'; seats: SeatAccountRecord[] }
  | { ok: true; action: 'create'; seat: SeatAccountRecord }
  | { ok: true; action: 'reset'; username: string }
  | { ok: true; action: 'disable'; username: string }
  | { ok: false; message: string };

export type SeatAccountApi = {
  command(intent: SeatAccountIntent): Promise<SeatAccountReply>;
};

function text(value: unknown): value is string {
  return typeof value === 'string';
}

export function isSeatAccountIntent(value: unknown): value is SeatAccountIntent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.action === 'list') return exactKeys(record, ['action']);
  if (record.action === 'disable') return exactKeys(record, ['action', 'username']) && text(record.username);
  if (record.action === 'reset') {
    return exactKeys(record, ['action', 'username', 'password']) && text(record.username) && text(record.password);
  }
  return record.action === 'create'
    && exactKeys(record, ['action', 'displayName', 'username', 'password', 'post'])
    && text(record.displayName) && text(record.username) && text(record.password)
    && text(record.post) && isIntakePost(record.post);
}

const SEAT_FAILURES = [
  '没有可授权的人。',
  '请选择岗位。',
  '请设定密码。',
  '人员没有写入，已停止。',
  '口令没有写入，已停止。',
  '账号没有保存。',
  '账号没有读取。',
  '账号输入无效。',
] as const;

function seatFailure(message: string): message is (typeof SEAT_FAILURES)[number] {
  return (SEAT_FAILURES as readonly string[]).includes(message);
}

function seatRecord(value: unknown): { displayName: string; username: string; post: IntakePost; enabled: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exactKeys(row, ['displayName', 'username', 'post', 'enabled'])) return null;
  if (!text(row.displayName) || !text(row.username) || !text(row.post) || !isIntakePost(row.post) || typeof row.enabled !== 'boolean') return null;
  return { displayName: row.displayName, username: row.username, post: row.post, enabled: row.enabled };
}

export function seatAccountReply(value: unknown): SeatAccountReply | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    if (!exactKeys(record, ['ok', 'message']) || !text(record.message) || !seatFailure(record.message)) return null;
    return { ok: false, message: record.message };
  }
  if (record.ok !== true || !text(record.action)) return null;
  if (record.action === 'list') {
    if (!exactKeys(record, ['ok', 'action', 'seats']) || !Array.isArray(record.seats)) return null;
    const seats: SeatAccountRecord[] = [];
    for (const item of record.seats) {
      const seat = seatRecord(item);
      if (!seat) return null;
      seats.push(seat);
    }
    return { ok: true, action: 'list', seats };
  }
  if (record.action === 'reset' || record.action === 'disable') {
    if (!exactKeys(record, ['ok', 'action', 'username']) || !text(record.username)) return null;
    return { ok: true, action: record.action, username: record.username };
  }
  if (record.action !== 'create' || !exactKeys(record, ['ok', 'action', 'seat'])) return null;
  const seat = seatRecord(record.seat);
  if (!seat) return null;
  return { ok: true, action: 'create', seat };
}
