import { expect, it } from 'vitest';
import { sessionExpiryAccepted } from '../../src/main/product-session';

const NOW = Date.parse('2026-09-22T04:00:00.000Z');

it('accepts a 15 minute token when the office clock is a few seconds behind the server', () => {
  const expiresAt = new Date(NOW + 15 * 60_000 + 2_000).toISOString();
  expect(sessionExpiryAccepted(expiresAt, NOW)).toBe(true);
});

it('rejects a token that claims far more than 15 minutes', () => {
  const expiresAt = new Date(NOW + 20 * 60_000).toISOString();
  expect(sessionExpiryAccepted(expiresAt, NOW)).toBe(false);
});

it('rejects an already expired token', () => {
  const expiresAt = new Date(NOW - 1_000).toISOString();
  expect(sessionExpiryAccepted(expiresAt, NOW)).toBe(false);
});
