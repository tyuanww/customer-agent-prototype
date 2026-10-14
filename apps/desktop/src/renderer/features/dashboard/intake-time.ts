/** Display only: use the local offset at the given instant, including daylight saving.
 * Callers keep the original timestamp for commands, deadlines and authorization. */
export function formatIntakeTime(value: string | null | undefined): string {
  if (!value?.trim()) return '未提供时间';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间无效';
  const pad = (part: number) => String(part).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}（${zone}）`;
}

/** setTimeout fires immediately above 2^31-1 ms (~24.8 days). Wait in chunks until the absolute target. */
export function timeoutUntil(run: () => void, targetEpochMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = () => {
    const left = targetEpochMs - Date.now();
    if (left <= 0) { run(); return; }
    timer = setTimeout(step, Math.min(left, 2_147_000_000));
  };
  step();
  return () => { if (timer !== undefined) clearTimeout(timer); };
}

/** Display only: how long until `value`. Returns null when the time is missing, invalid or already past. */
export function remainingLabel(value: string | null | undefined, now: number = Date.now()): string | null {
  if (!value?.trim()) return null;
  const left = Date.parse(value) - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const hour = 3_600_000, day = 24 * hour;
  if (left >= day) return `还有 ${Math.floor(left / day)} 天到期`;
  if (left >= hour) return `还有 ${Math.floor(left / hour)} 小时到期`;
  return '1 小时内到期';
}

/** Display only: 「10-13 15:42」in local time. Missing or invalid input yields an em dash. */
export function formatShortTime(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Display only: 「2026-10-01」in local time. Missing or invalid input yields an em dash. */
export function formatIntakeDay(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
