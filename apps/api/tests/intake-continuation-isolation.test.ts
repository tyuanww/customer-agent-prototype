import type { PoolClient } from 'pg';
import { expect, it, vi } from 'vitest';
vi.mock('../src/product-auth-service.js', () => ({ authenticatedProductSession: () => 'c'.repeat(64) }));
import { withIntakeView } from '../src/content-intake/contract-view.js';
import { createIntakeTransactions } from '../src/content-intake/transaction.js';
import { createIntakeUsage } from '../src/content-intake/usage.js';

const actor = { user_id: 'synthetic-user', role: 'agent', auth_mode: 'mock' } as const;

it.each(['preview'] as const)('rejects continuation qualification before ordinary %s content reads', async method => {
  const protectedRead = vi.fn();
  const query = async (sql: string) => {
    if (sql.includes('FROM content_intake.entitlements e')) return { rows: [{ sop_continuation_hash: 'd'.repeat(64),
      shop_id: 'synthetic-shop', context_generation: '1', principal_generation: '0', valid_until: new Date(20000),
      expires_at: new Date(20000), product_ids: [], scenario_ids: [], contract_view: 'graph' }] };
    if (sql === 'SELECT clock_timestamp() AS time') return { rows: [{ time: new Date(1000) }] };
    if (sql.includes('intake_runtime.lock_product_session')) return { rows: [{ expires_at: new Date(20000) }] };
    if (sql.includes('FROM content_intake.principals')) return { rows: [{ principal_id: 'synthetic-principal', user_id: actor.user_id,
      tenant_id: 'synthetic-tenant', app_id: 'synthetic-app', identity_scope: 'synthetic', person_key: 'synthetic-person',
      current_facts_version: '1', revocation_generation: '0', enabled: true, checked_at: new Date(0), valid_until: new Date(20000), roles: ['agent'] }] };
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT backend_review.lock_content)/.test(sql)) return { rows: [] };
    protectedRead(sql); throw new Error('unexpected protected read after continuation entitlement');
  };
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const usage = createIntakeUsage(createIntakeTransactions({ connect: async () => client }, () => undefined, { requireProductSession: true }));
  const result = await withIntakeView('graph', () => usage[method](actor, { entitlementId: 'synthetic-entitlement' }));
  expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED', commit: 'rolled_back' });
  expect(protectedRead).not.toHaveBeenCalled();
});
