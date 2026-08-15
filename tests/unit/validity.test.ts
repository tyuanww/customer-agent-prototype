import { describe, expect, it } from 'vitest';
import {
  getValidityInfo,
  isCurrentlyEffective,
} from '../../src/renderer/features/search/validity';

const NOW = new Date('2026-08-13T12:00:00');

describe('validity filter', () => {
  it('treats only the current window as effective', () => {
    expect(isCurrentlyEffective('2026-01-01', '2026-12-31', NOW)).toBe(true);
    expect(isCurrentlyEffective('2026-06-01', '2026-06-30', NOW)).toBe(false);
    expect(isCurrentlyEffective('2026-10-01', '2026-10-31', NOW)).toBe(false);
  });

  it('labels expired and upcoming ranges in text, not only color', () => {
    expect(getValidityInfo('2026-06-01', '2026-06-30', NOW)).toEqual({
      kind: 'expired',
      text: '已过期 2026-06-30',
    });
    expect(getValidityInfo('2026-10-01', '2026-10-31', NOW).kind).toBe('upcoming');
    expect(getValidityInfo('2026-01-01', '2026-12-31', NOW).text).toContain('有效至');
  });

  it('keeps the complete final millisecond of the effective end date active', () => {
    expect(
      isCurrentlyEffective(
        '2026-08-01',
        '2026-08-13',
        new Date('2026-08-13T23:59:59.999'),
      ),
    ).toBe(true);
    expect(
      isCurrentlyEffective(
        '2026-08-01',
        '2026-08-13',
        new Date('2026-08-14T00:00:00.000'),
      ),
    ).toBe(false);
  });

  it('fails closed for malformed, impossible, or reversed date ranges', () => {
    for (const [from, to] of [
      ['not-a-date', '2026-12-31'],
      ['2026-02-30', '2026-12-31'],
      ['2026-12-31', '2026-01-01'],
    ]) {
      expect(isCurrentlyEffective(from, to, NOW)).toBe(false);
      expect(getValidityInfo(from, to, NOW)).toEqual({
        kind: 'invalid',
        text: '有效期异常',
      });
    }
  });
});
