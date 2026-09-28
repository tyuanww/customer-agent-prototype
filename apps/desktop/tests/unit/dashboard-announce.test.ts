import { expect, it } from 'vitest';
import {
  isDashboardAnnounceResult,
  dashboardAnnounceUnavailable,
} from '../../src/shared/dashboard-announce';

const view = {
  ok: true,
  signedIn: true,
  releaseId: 'rel_25',
  announcement: { title: '九月活动上新', summary: '售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用', createdAt: '2026-09-28T00:00:00.000Z' },
  counts: { product: 106, campaign: 4, presale: 75, aftersale: 223 },
  unread: true,
  unreadDomains: ['presale'],
};

it('accepts the four-card projection with null counts and rejects malformed shapes', () => {
  expect(isDashboardAnnounceResult(view)).toBe(true);
  expect(isDashboardAnnounceResult({ ...view, counts: null, unread: false, unreadDomains: [] })).toBe(true);
  // unread must agree with the domains list.
  expect(isDashboardAnnounceResult({ ...view, unread: false })).toBe(false);
  expect(isDashboardAnnounceResult({ ...view, unreadDomains: ['presale', 'presale'] })).toBe(false);
  expect(isDashboardAnnounceResult({ ...view, releaseId: '' })).toBe(false);
  expect(isDashboardAnnounceResult({ ...view, domainHashes: { product: 'p' } })).toBe(false);
  expect(isDashboardAnnounceResult({ ...view, counts: { product: 1 } })).toBe(false);
  expect(isDashboardAnnounceResult(dashboardAnnounceUnavailable('NO_CURRENT'))).toBe(true);
  expect(isDashboardAnnounceResult(dashboardAnnounceUnavailable('FORBIDDEN', true))).toBe(true);
  expect(isDashboardAnnounceResult({ ok: false, code: 'OTHER', signedIn: false })).toBe(false);
});
