import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/product-auth-service.js', () => ({ authenticatedProductSession: (actor: { user_id: string }) => actor.user_id === 'synthetic-user' ? 'a'.repeat(64) : undefined }));
import { createIntakeTransactions, IntakeRejection, lockProductSession, type IntakePool } from '../src/content-intake/transaction.js';
const actor = { user_id: 'synthetic-user', role: 'owner', auth_mode: 'mock' } as const;

describe('formal transaction lock and finalizer ownership', () => {
  it('calls the versioned lock with authenticated identity and narrows only its declared rejection', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ expires_at: new Date(5000) }] });
    const validUntil = vi.fn(); const client = { query: query as unknown as PoolClient['query'], validUntil };
    expect(await lockProductSession(client, actor)).toEqual({ hash: 'a'.repeat(64), validUntil: 5000 });
    expect(query).toHaveBeenCalledWith('SELECT intake_runtime.lock_product_session($1,$2) AS expires_at', ['a'.repeat(64), actor.user_id]);
    expect(validUntil).toHaveBeenCalledWith(5000);
    query.mockRejectedValueOnce(Object.assign(new Error('SESSION_UNAVAILABLE'), { code: 'ZA003' }));
    await expect(lockProductSession(client, actor)).rejects.toMatchObject({ reason: 'SCOPE_DENIED', code: 'UNAUTHORIZED' });
    const unexpected = Object.assign(new Error('other'), { code: 'ZA003' }); query.mockRejectedValueOnce(unexpected);
    await expect(lockProductSession(client, actor)).rejects.toBe(unexpected);
    const calls = query.mock.calls.length;
    await expect(lockProductSession(client, { ...actor, user_id: 'forged' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(query).toHaveBeenCalledTimes(calls);
  });
  function fixture(options: { failRollback?: boolean } = {}) {
    const events: string[] = []; let now = 1000;
    const reports: { diagnosticId: string; error: unknown }[] = [];
    const query = async (sql: string) => {
      events.push(sql);
      if (sql === 'ROLLBACK' && options.failRollback) throw new Error('synthetic rollback failure');
      if (sql === 'SELECT clock_timestamp() AS time') return { rows: [{ time: new Date(now) }] };
      if (sql.includes('FROM content_intake.principals')) return { rows: [{ principal_id: 'actor', user_id: actor.user_id, tenant_id: 'tenant', app_id: 'app', identity_scope: 'scope', person_key: 'person', current_facts_version: '1', revocation_generation: '0', enabled: true, checked_at: new Date(0), valid_until: new Date(20000), roles: ['director'] }] };
      return { rows: [] };
    };
    const release = vi.fn(); const pool = { connect: async () => ({ query, release }) } as unknown as IntakePool;
    return { events, release, reports, run: createIntakeTransactions(pool, (diagnosticId, error) => { reports.push({ diagnosticId, error }); }), advance: (value: number) => { now = value; } };
  }
  it('runs finalizers after receipt, then rechecks authority and clock before COMMIT', async () => {
    const f = fixture();
    const result = await f.run(actor, 'test', {}, 'operation', async client => { client.beforeCommit(async () => { f.events.push('FINALIZE'); }); return true; }, Boolean);
    expect(result).toEqual({ ok: true, value: true });
    const finalizer = f.events.indexOf('FINALIZE');
    expect(finalizer).toBeGreaterThan(f.events.findIndex(s => s.includes('INSERT INTO backend_review.receipts')));
    expect(f.events.slice(finalizer + 1).some(s => s.includes('FROM content_intake.principals'))).toBe(true);
    expect(f.events.at(-1)).toBe('COMMIT'); expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each([
    ['VALIDATION', 'SOURCE_FORMAT_MISMATCH'], ['FORBIDDEN', 'PERMISSION_CHANGED'],
    ['UNAUTHORIZED', 'SCOPE_DENIED'], ['CONFLICT', 'SHOP_DIRECTORY_CHANGED'], ['NOT_FOUND', 'SCOPE_DENIED'],
  ] as const)('rolls back %s after receipt and before COMMIT', async (code, reason) => {
    const f = fixture();
    const result = await f.run(actor, 'test', {}, 'operation', async client => { client.beforeCommit(async () => { throw new IntakeRejection(reason, code); }); return true; }, Boolean);
    expect(result).toMatchObject({ ok: false, code, reason, commit: 'rolled_back' });
    expect(f.events.some(sql => sql.includes('INSERT INTO backend_review.receipts'))).toBe(true);
    expect(f.events.at(-1)).toBe('ROLLBACK'); expect(f.events).not.toContain('COMMIT');
  });
  it('never exposes a definitive code when ROLLBACK itself fails', async () => {
    const f = fixture({ failRollback: true });
    const result = await f.run(actor, 'test', {}, 'operation', async client => {
      client.beforeCommit(async () => { throw new IntakeRejection('PERMISSION_CHANGED', 'FORBIDDEN'); });
      return true;
    }, Boolean);
    expect(result).toMatchObject({ ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
    expect(f.events.at(-1)).toBe('ROLLBACK'); expect(f.events).not.toContain('COMMIT');
    expect(f.release).toHaveBeenCalledWith(true);
    expect(f.reports).toHaveLength(1);
    expect(f.reports[0]!.diagnosticId).toBe(!result.ok ? result.diagnosticId : '');
    expect(f.reports[0]!.error).toBeInstanceOf(AggregateError);
    const causes=(f.reports[0]!.error as AggregateError).errors;
    expect(causes[0]).toMatchObject({ code: 'FORBIDDEN', reason: 'PERMISSION_CHANGED' });
    expect(causes[1]).toMatchObject({ message: 'synthetic rollback failure' });
  });
  it.each([
    ['ZA003', 'SOURCE_FORMAT_MISMATCH', 'VALIDATION', 'SOURCE_FORMAT_MISMATCH'],
    ['42501', 'SOURCE_FORMAT_MISMATCH', 'INTERNAL_ERROR', 'COMMIT_UNKNOWN'],
    ['ZA003', 'OTHER_PRIVATE_FAILURE', 'INTERNAL_ERROR', 'COMMIT_UNKNOWN'],
  ] as const)('normalizes only the frozen format rejection (%s/%s)', async (sqlstate, message, code, reason) => {
    const f = fixture();
    const result = await f.run(actor, 'test', {}, 'format-operation', async () => { throw Object.assign(new Error(message), { code: sqlstate }); }, Boolean);
    expect(result).toMatchObject({ ok: false, code, reason, commit: 'rolled_back' });
    expect(f.events.at(-1)).toBe('ROLLBACK'); expect(f.events).not.toContain('COMMIT');
    expect(f.events.some(sql => sql.includes('INSERT INTO backend_review.receipts'))).toBe(false);
  });
  it('does not borrow time spent in a successful finalizer past its deadline', async () => {
    const f = fixture();
    const result = await f.run(actor, 'test', null, null, async client => { client.validUntil(2000); client.beforeCommit(async () => { f.advance(2000); }); return true; }, Boolean);
    expect(result).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED', code: 'FORBIDDEN', commit: 'rolled_back' });
    expect(f.events).not.toContain('COMMIT');
  });
});
