import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { IntakePool } from '../src/content-intake/transaction.js';
import { assertConsumerSource, createSyntheticConsumerPool } from '../experiments/intake-runtime/consumer-pool.js';

describe('offline exact session-lock compatibility', () => {
  it('pins the complete original transaction source and refuses drift', async () => {
    const source = await readFile(new URL('../src/content-intake/transaction.ts', import.meta.url), 'utf8');
    expect(() => assertConsumerSource(source)).not.toThrow();
    expect(() => assertConsumerSource(`${source}\n// changed`)).toThrow('CONSUMER_TRANSACTION_DRIFT');
  });
  it('changes only the pinned query, preserves parameters and never closes the borrowed pool', async () => {
    const source = await readFile(new URL('../src/content-intake/transaction.ts', import.meta.url), 'utf8');
    const sql = /`(SELECT s.expires_at[\s\S]*?FOR SHARE OF s,b)`/.exec(source)![1]!;
    const seen: { sql: string; params: unknown[] | undefined }[] = [];
    let released = false;
    const raw = { query: async (sql: string, params?: unknown[]) => { seen.push({ sql, params }); return { rows: [] }; }, release: () => { released = true; } };
    const pool = await createSyntheticConsumerPool({ connect: async () => raw } as unknown as IntakePool);
    const client = await pool.connect(); const params = ['a'.repeat(64), 'synthetic-user'];
    await client.query(sql, params); await client.query('SELECT 1', []);
    await client.query(`${sql} `, params); client.release();
    expect(seen.map(v => v.sql)).toEqual(['SELECT intake_runtime_probe.lock_product_session($1,$2) AS expires_at', 'SELECT 1', `${sql} `]);
    expect(seen[0]!.params).toBe(params); expect(released).toBe(true);
  });
  it('maps only the narrow session rejection and preserves other database failures', async () => {
    const source = await readFile(new URL('../src/content-intake/transaction.ts', import.meta.url), 'utf8');
    const sql = /`(SELECT s.expires_at[\s\S]*?FOR SHARE OF s,b)`/.exec(source)![1]!;
    let fault = Object.assign(new Error('SESSION_UNAVAILABLE'), { code: 'ZA003' });
    const pool = await createSyntheticConsumerPool({ connect: async () => ({ query: async () => { throw fault; }, release: () => undefined }) } as unknown as IntakePool);
    const client = await pool.connect();
    await expect(client.query(sql)).rejects.toMatchObject({ reason: 'SCOPE_DENIED', code: 'UNAUTHORIZED' });
    await expect(client.query('SELECT 1')).rejects.toBe(fault);
    fault = Object.assign(new Error('other failure'), { code: 'ZA003' });
    await expect(client.query(sql)).rejects.toBe(fault);
    client.release();
  });
});
