import { describe, expect, it } from 'vitest';
import { remainingLabel, timeoutUntil } from '../../src/renderer/features/dashboard/intake-time';

const NOW = Date.parse('2026-10-13T00:00:00.000Z');

describe('remainingLabel', () => {
  it('counts days, hours, then says within an hour', () => {
    expect(remainingLabel('2026-10-20T00:00:00.000Z', NOW)).toBe('还有 7 天到期');
    expect(remainingLabel('2026-10-13T05:00:00.000Z', NOW)).toBe('还有 5 小时到期');
    expect(remainingLabel('2026-10-13T00:30:00.000Z', NOW)).toBe('1 小时内到期');
  });
  it('returns null for missing, invalid or past times', () => {
    expect(remainingLabel(null, NOW)).toBeNull();
    expect(remainingLabel('not a date', NOW)).toBeNull();
    expect(remainingLabel('2026-10-12T00:00:00.000Z', NOW)).toBeNull();
  });
});

describe('timeoutUntil', () => {
  it('does not fire immediately for a target far beyond the setTimeout limit', async () => {
    let fired = false;
    const cancel = timeoutUntil(() => { fired = true; }, Date.now() + 90 * 24 * 3_600_000);
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(false);
    cancel();
  });
  it('fires when the target is already past', () => {
    let fired = false;
    timeoutUntil(() => { fired = true; }, Date.now() - 1);
    expect(fired).toBe(true);
  });
});
