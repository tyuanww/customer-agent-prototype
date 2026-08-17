import { describe, expect, it } from 'vitest';
import {
  OPEN_DASHBOARD_FAILURE_MESSAGE,
  canOpenDashboard,
  isOpenDashboardResult,
  openDashboardUnavailable,
} from '../../src/shared/dashboard-access';

describe('canOpenDashboard', () => {
  it('only allows a trusted query renderer', () => {
    expect(canOpenDashboard({ trusted: true, role: 'query' })).toBe(true);
  });

  it('fails closed for fox, dashboard, unknown, or untrusted senders', () => {
    expect(canOpenDashboard({ trusted: true, role: 'fox' })).toBe(false);
    expect(canOpenDashboard({ trusted: true, role: 'dashboard' })).toBe(false);
    expect(canOpenDashboard({ trusted: true, role: null })).toBe(false);
    expect(canOpenDashboard({ trusted: false, role: 'query' })).toBe(false);
  });
});

describe('open dashboard result contract', () => {
  it('accepts a typed success or a recoverable failure and rejects malformed payloads', () => {
    expect(isOpenDashboardResult({ ok: true })).toBe(true);
    expect(isOpenDashboardResult(openDashboardUnavailable())).toBe(true);
    expect(openDashboardUnavailable()).toEqual({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    expect(isOpenDashboardResult({ ok: true, message: 'extra' })).toBe(false);
    expect(isOpenDashboardResult({ ok: false })).toBe(false);
    expect(isOpenDashboardResult(undefined)).toBe(false);
  });
});
