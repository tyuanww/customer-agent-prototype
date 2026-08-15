import { describe, expect, it } from 'vitest';
import { canOpenDashboard } from '../../src/shared/dashboard-access';

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
