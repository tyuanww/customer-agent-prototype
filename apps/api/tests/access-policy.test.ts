import { describe, expect, it } from 'vitest';
import {
  ACCESS_PUBLIC_ROUTES,
  PROTECTED_ROUTE_POLICIES,
  createRoutePolicyRegistry,
  policyForRoute,
} from '../src/access/policy.js';

describe('access route policy registry', () => {
  it('keeps each public route in an explicit profile allowlist', () => {
    expect(ACCESS_PUBLIC_ROUTES).toEqual({
      mock: ['GET /health', 'GET /ready', 'POST /v1/auth/mock-login'],
      product: [
        'GET /health',
        'GET /ready',
        'POST /v1/auth/login-requests',
        'POST /v1/auth/login-requests/:login_id/exchange',
        'GET /v1/auth/callback',
      ],
    });
    for (const entries of Object.values(ACCESS_PUBLIC_ROUTES)) {
      expect(entries.every((entry) => !entry.includes('*'))).toBe(true);
      expect(new Set(entries).size).toBe(entries.length);
    }
  });

  it('does not let the public list double as a wildcard for protected routes', () => {
    expect(policyForRoute('POST', '/v1/search', 'product')).toMatchObject({
      kind: 'requires',
      anyOf: ['query'],
    });
    expect(() => policyForRoute('GET', '/v1/not-registered', 'product')).toThrowError(
      'ACCESS_ROUTE_POLICY_MISSING',
    );
  });

  it('rejects duplicate declarations instead of allowing the last one to win', () => {
    expect(() => createRoutePolicyRegistry([
      ['GET /v1/search', { kind: 'requires', anyOf: ['query'] }],
      ['GET /v1/search', { kind: 'requires', anyOf: ['publish'] }],
    ])).toThrowError('ACCESS_ROUTE_POLICY_DUPLICATE');
  });

  it('covers every currently registered protected route exactly once', () => {
    expect(PROTECTED_ROUTE_POLICIES.has('GET /v1/access/query')).toBe(true);
    expect(PROTECTED_ROUTE_POLICIES.has('GET /v1/access/settings')).toBe(true);
    expect(PROTECTED_ROUTE_POLICIES.has('GET /v1/access/admin')).toBe(true);
    expect(PROTECTED_ROUTE_POLICIES.has('GET /v1/intake/seats/administration')).toBe(true);
    expect(PROTECTED_ROUTE_POLICIES.has('PATCH /v1/intake/grants/:grantId')).toBe(true);
    expect(PROTECTED_ROUTE_POLICIES.size).toBeGreaterThan(50);
  });
});
