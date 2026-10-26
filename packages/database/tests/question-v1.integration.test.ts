import type { Client, DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/runner.js';
import { Pg15Harness } from '../src/testkit/index.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

const HASH = 'a'.repeat(64);
const START = '2026-03-01 00:00:00+00';
const END = '2026-03-02 00:00:00+00';
const BEFORE = '2026-02-28 23:59:59.999999+00';
const AFTER = '2026-03-02 00:00:00.000001+00';
const MID = '2026-03-01 12:00:00+00';
const OUTSIDE = '2026-02-01 00:00:00+00';
const REPORT_ONLY = '2026-04-01 00:00:00+00';

type QuestionRow = {
  query_count: string;
  hit_count: string;
  no_hit_count: string;
  other_count: string;
  inaccuracy_count: string;
  hit_rate: string | null;
  no_hit_rate: string | null;
  inaccuracy_rate: string | null;
};

async function asRole<T>(client: Client, role: string, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    const value = await run();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function refusalOf(error: unknown): DatabaseError {
  return error as DatabaseError;
}

async function ask(
  client: Client,
  start: string | null,
  end: string | null,
  role = 'app_owner_read',
): Promise<QuestionRow> {
  const result = await asRole(client, role, () => client.query<QuestionRow>(
    'SELECT * FROM analytics.question_v1($1::timestamptz, $2::timestamptz)',
    [start, end],
  ));
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function expectRate(
  client: Client,
  actual: string | null,
  numerator: number,
  denominator: number,
): Promise<void> {
  if (denominator === 0) {
    expect(actual).toBeNull();
    return;
  }
  const compared = await client.query<{ same: boolean }>(
    'SELECT $1::numeric = ($2::numeric / $3::numeric) AS same',
    [actual, numerator, denominator],
  );
  expect(compared.rows[0]?.same).toBe(true);
}

describe.skipIf(!enabled)('analytics.question_v1', () => {
  let harness: Pg15Harness;
  let client: Client;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    client = await harness.connect(harness.createDatabase('question_v1').config);
    await applyDatabaseMigrations(client);
    // query_events.release_id needs a parent. The release trigger demands four
    // source domains, and the search-telemetry trigger demands that release be
    // the current ready source set. This fixture only needs the parent key.
    await client.query('ALTER TABLE public.content_releases DISABLE TRIGGER release_source_set_complete');
    await client.query('ALTER TABLE public.query_events DISABLE TRIGGER query_source_gate_telemetry_guard');
    await client.query(
      `INSERT INTO public.content_releases (release_id, release_seq, status, source_binding_hash)
       VALUES ('rel_question_v1', 1, 'published', $1)`,
      [HASH],
    );
    // The table only allows hit and no_hit. A third value is what proves other_count
    // is not folded into no_hit.
    await client.query('ALTER TABLE public.query_events DROP CONSTRAINT query_events_hit_status_check');
    await client.query(
      `INSERT INTO public.query_events (
         query_id, user_id, request_hash, request_hash_key_version, hash_key_version,
         query_text_redacted, query_text_hash, text_storage_status, collection_mode,
         platform_source, redaction_policy_version, hit_status, release_id, created_at
       ) VALUES
         ('q-hit', 'usr_q', $1, 'k', 'k', 'hello', $1, 'stored', 'synthetic', 'manual', 'v1', 'hit', 'rel_question_v1', $2),
         ('q-suppressed', 'usr_q', $1, 'k', 'k', NULL, NULL, 'suppressed', 'synthetic', 'manual', 'v1', 'no_hit', 'rel_question_v1', $3),
         ('q-before', 'usr_q', $1, 'k', 'k', 'early', $1, 'stored', 'synthetic', 'manual', 'v1', 'hit', 'rel_question_v1', $4),
         ('q-after', 'usr_q', $1, 'k', 'k', 'late', $1, 'stored', 'synthetic', 'manual', 'v1', 'no_hit', 'rel_question_v1', $5),
         ('q-other', 'usr_q', $1, 'k', 'k', 'side', $1, 'stored', 'synthetic', 'manual', 'v1', 'other', 'rel_question_v1', $6),
         ('q-outside', 'usr_q', $1, 'k', 'k', 'out', $1, 'stored', 'synthetic', 'manual', 'v1', 'hit', 'rel_question_v1', $7)`,
      [HASH, START, END, BEFORE, AFTER, MID, OUTSIDE],
    );
    await client.query(
      `INSERT INTO ops_loop.inaccuracy_reports (
         query_id, script_id, actor_user_id, evidence_hash, created_at
       ) VALUES
         ('q-hit', 'script-a', 'usr_q', $1, $2),
         ('q-hit', 'script-b', 'usr_q', $1, $2),
         ('q-hit', 'script-e', 'usr_q', $1, $2),
         ('q-outside', 'script-c', 'usr_q', $1, $2),
         ('q-outside', 'script-d', 'usr_q', $1, $3)`,
      [HASH, MID, REPORT_ONLY],
    );
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    harness?.stop();
  }, 60_000);

  it('counts the closed window, keeps other and suppressed rows, and divides in numeric', async () => {
    const row = await ask(client, START, END);
    expect(row).toMatchObject({
      query_count: '3',
      hit_count: '1',
      no_hit_count: '1',
      other_count: '1',
      inaccuracy_count: '4',
    });
    await expectRate(client, row.hit_rate, 1, 3);
    await expectRate(client, row.no_hit_rate, 1, 3);
    await expectRate(client, row.inaccuracy_rate, 4, 3);
  });

  it('leaves rates null when the window has no queries, even if reports exist', async () => {
    const empty = await ask(client, '2026-05-01 00:00:00+00', '2026-05-02 00:00:00+00');
    expect(empty).toMatchObject({
      query_count: '0',
      hit_count: '0',
      no_hit_count: '0',
      other_count: '0',
      inaccuracy_count: '0',
      hit_rate: null,
      no_hit_rate: null,
      inaccuracy_rate: null,
    });
    const reportsOnly = await ask(client, REPORT_ONLY, REPORT_ONLY);
    expect(reportsOnly).toMatchObject({
      query_count: '0',
      hit_count: '0',
      no_hit_count: '0',
      other_count: '0',
      inaccuracy_count: '1',
      hit_rate: null,
      no_hit_rate: null,
      inaccuracy_rate: null,
    });
  });

  it('rejects a null or reversed window', async () => {
    for (const [start, end] of [
      [null, END],
      [START, null],
      [END, START],
    ] as const) {
      try {
        await ask(client, start, end);
        throw new Error(`expected ${start}..${end} to fail`);
      } catch (error) {
        expect(refusalOf(error).code).toBe('P0001');
      }
    }
  });

  it('lets app_owner_read execute and keeps the base tables closed', async () => {
    await ask(client, START, END, 'app_owner_read');
    await expect(asRole(client, 'app_runtime', () => client.query(
      'SELECT * FROM analytics.question_v1($1::timestamptz, $2::timestamptz)',
      [START, END],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(client, 'app_owner_read', () => client.query(
      'SELECT query_id FROM public.query_events',
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(client, 'app_owner_read', () => client.query(
      'SELECT query_id FROM ops_loop.inaccuracy_reports',
    ))).rejects.toMatchObject({ code: '42501' });
  });
});
