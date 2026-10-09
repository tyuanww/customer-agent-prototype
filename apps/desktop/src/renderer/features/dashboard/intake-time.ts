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
