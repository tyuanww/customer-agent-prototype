import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertConsumerSource } from '../experiments/intake-runtime/consumer-pool.js';
const fake = vi.hoisted(() => ({ connect: vi.fn(), end: vi.fn(), query: vi.fn(), release: vi.fn(), created: vi.fn(), on: vi.fn() }));
vi.mock('pg', () => ({ Pool: class {
  totalCount = 1;
  constructor(config: unknown) { fake.created(config); }
  on = fake.on;
  connect = fake.connect;
  end = fake.end;
} }));
import { createIntakePurposePool, type IntakePurpose } from '../src/content-intake/runtime-pool.js';

beforeEach(() => {
  vi.resetAllMocks();
  fake.query.mockResolvedValue({ rows: [] }); fake.end.mockResolvedValue(undefined);
  fake.connect.mockImplementation(async () => ({ query: fake.query, release: fake.release }));
});
describe('formal purpose-pool ownership', () => {
  it('retires the old source-pinned SQL bridge instead of changing its historical hash', async () => {
    const source = await readFile(new URL('../src/content-intake/transaction.ts', import.meta.url), 'utf8');
    expect(() => assertConsumerSource(source)).toThrow('CONSUMER_TRANSACTION_DRIFT');
    expect(source).toContain('SELECT intake_runtime.lock_product_session($1,$2) AS expires_at');
  });
  it.each([['business', 'intake_business'], ['usage', 'intake_usage'], ['worker', 'intake_worker'], ['organization', 'intake_org_writer']] as const)('checks %s on every checkout, leaving borrower SQL unchanged', async (purpose, role) => {
    const pool = createIntakePurposePool({ user: 'synthetic-login' }, purpose);
    for (let n = 0; n < 2; n++) {
      const client = await pool.connect();
      const args = ['synthetic']; await client.query('SELECT $1', args); client.release();
    }
    expect(fake.query.mock.calls).toEqual(Array.from({ length: 2 }, () => [[`SET ROLE ${role}`], ['SELECT intake_runtime.assert_purpose($1)', [purpose]], ['SELECT $1', ['synthetic']]]).flat());
    expect(fake.created).toHaveBeenCalledWith({ user: 'synthetic-login' });
    expect(fake.release).toHaveBeenCalledTimes(2); expect(pool.totalCount).toBe(1);
    const closing = pool.end(); expect(pool.end()).toBe(closing); await closing;
    expect(fake.end).toHaveBeenCalledTimes(1); await expect(pool.connect()).rejects.toThrow('INTAKE_POOL_CLOSED');
  });
  it.each([1, 2])('destroys an inadmissible connection at boundary %i', async stage => {
    const error = Object.assign(new Error('denied'), { code: '42501' });
    if (stage === 1) fake.query.mockRejectedValueOnce(error);
    else fake.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(error);
    const pool = createIntakePurposePool({}, 'usage');
    await expect(pool.connect()).rejects.toBe(error); expect(fake.release).toHaveBeenCalledWith(true);
    expect(fake.end).not.toHaveBeenCalled(); await pool.end();
  });
  it('does not lend a connection if close races the admission guard', async () => {
    let unblock!: () => void;
    fake.query.mockResolvedValueOnce({ rows: [] }).mockImplementationOnce(() => new Promise<void>(resolve => { unblock = resolve; }));
    const pool = createIntakePurposePool({}, 'usage'); const pending = pool.connect();
    await vi.waitFor(() => expect(unblock).toBeTypeOf('function'));
    await pool.end(); unblock();
    await expect(pending).rejects.toThrow('INTAKE_POOL_CLOSED'); expect(fake.release).toHaveBeenCalledWith(true);
  });
  it('owns idle-client errors even if diagnostics throw', async () => {
    const report = vi.fn(() => { throw new Error('diagnostic failure'); });
    const pool = createIntakePurposePool({}, 'usage', report);
    const listener = fake.on.mock.calls[0]![1] as (error: unknown) => void;
    const error = new Error('idle connection failed');
    expect(() => listener(error)).not.toThrow(); expect(report).toHaveBeenCalledWith(error);
    const client = await pool.connect(); client.release(); await pool.end();
  });
  it('rejects caller-supplied purpose SQL before creating a pool', () => {
    expect(() => createIntakePurposePool({}, 'usage;RESET ROLE' as IntakePurpose)).toThrow('INTAKE_PURPOSE_INVALID');
    expect(fake.created).not.toHaveBeenCalled();
  });
});
