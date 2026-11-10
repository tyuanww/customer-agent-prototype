import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/product-auth-service.js', () => ({
  authenticatedProductSession: (actor: { user_id: string }) => actor.user_id === 'synthetic-user' ? 'c'.repeat(64) : null,
}));
import { withIntakeView } from '../src/content-intake/contract-view.js';
import type { IntakePool } from '../src/content-intake/transaction.js';
import { createSopContinuationService } from '../src/sop-continuation.js';
import { sopContinuationHash } from '../src/sop-continuation-action.js';

const actor = { user_id: 'synthetic-user', role: 'agent', auth_mode: 'mock' } as const;
const handle = `sct_${'d'.repeat(64)}`;
function fixture() {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  let denied = false, lostCommit = false;
  const query = async (sql: string, values: readonly unknown[] = []) => {
    queries.push({ sql, values });
    if (sql === 'SELECT clock_timestamp() AS time') return { rows: [{ time: new Date(1000) }] };
    if (sql.includes('intake_runtime.lock_product_session')) return { rows: [{ expires_at: new Date(20000) }] };
    if (sql.includes('FROM content_intake.principals')) return { rows: [{ principal_id: 'synthetic-principal', user_id: actor.user_id,
      tenant_id: 'synthetic-tenant', app_id: 'synthetic-app', identity_scope: 'synthetic', person_key: 'synthetic-person',
      current_facts_version: '1', revocation_generation: '0', enabled: true, checked_at: new Date(0), valid_until: new Date(20000), roles: ['agent'] }] };
    if (sql.includes('authorize_sop_continuation_resource') && denied) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'ZA002' });
    if (sql === 'COMMIT' && lostCommit) { lostCommit = false; throw new Error('synthetic COMMIT acknowledgement lost'); }
    return { rows: [] };
  };
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool: IntakePool = { connect: async () => client };
  return { service: createSopContinuationService(pool), queries, deny: () => { denied = true; }, loseCommit: () => { lostCommit = true; } };
}

describe('continuation close transaction adapter', () => {
  it('sends only the handle hash to SQL and keeps close outside raw-handle receipts', async () => {
    const f = fixture();
    const result = await withIntakeView('graph', () => f.service.close(actor, { continuationId: handle }));
    expect(result).toEqual({ ok: true, value: null });
    const authorize = f.queries.find(item => item.sql.includes('authorize_sop_continuation_resource'))!;
    const close = f.queries.find(item => item.sql.includes('close_sop_active_use'))!;
    expect(f.queries.indexOf(authorize)).toBeLessThan(f.queries.indexOf(close));
    expect(close.values).toEqual(['synthetic-principal', 'c'.repeat(64), sopContinuationHash(handle)]);
    expect(JSON.stringify(f.queries)).not.toContain(handle);
    expect(f.queries.some(item => item.sql.includes('INSERT INTO backend_review.receipts'))).toBe(false);
    expect(f.queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('authorizes the addressed resource before rejecting an unsupported or legacy view', async () => {
    for (const view of ['legacy', 'unsupported'] as const) {
      const f = fixture();
      expect(await withIntakeView(view, () => f.service.close(actor, { continuationId: handle })))
        .toMatchObject({ ok: false, reason: 'UPGRADE_REQUIRED', commit: 'rolled_back' });
      expect(f.queries.some(item => item.sql.includes('authorize_sop_continuation_resource'))).toBe(true);
      expect(f.queries.some(item => item.sql.includes('close_sop_active_use'))).toBe(false);
      const denied = fixture(); denied.deny();
      expect(await withIntakeView(view, () => denied.service.close(actor, { continuationId: handle })))
        .toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' });
    }
  });

  it('validates the complete frozen close body before its first state change', async () => {
    const f = fixture();
    expect(await withIntakeView('graph', () => f.service.close(actor, { continuationId: handle, operationId: 'invented' })))
      .toMatchObject({ ok: false, code: 'VALIDATION', reason: 'FILE_INVALID' });
    expect(f.queries.some(item => item.sql.includes('close_sop_active_use'))).toBe(false);
  });

  it('recovers an uncertain close by executing the same hash-bound SQL command again', async () => {
    const f = fixture(); f.loseCommit();
    expect(await withIntakeView('graph', () => f.service.close(actor, { continuationId: handle })))
      .toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
    expect(await withIntakeView('graph', () => f.service.close(actor, { continuationId: handle }))).toEqual({ ok: true, value: null });
    expect(f.queries.filter(item => item.sql.includes('close_sop_active_use')).map(item => item.values[2]))
      .toEqual([sopContinuationHash(handle), sopContinuationHash(handle)]);
  });
});
