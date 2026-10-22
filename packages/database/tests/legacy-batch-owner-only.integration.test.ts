import type { Client, DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/runner.js';
import { Pg15Harness } from '../src/testkit/index.js';

const enabled = process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1';

/** A refusal is a PostgreSQL error, never a returned row. Reading `code`/`detail` here
 *  proves the function itself chose FORBIDDEN rather than the caller mapping a failure. */
async function refusalOf(run: () => Promise<unknown>): Promise<DatabaseError> {
  try {
    await run();
  } catch (error) {
    return error as DatabaseError;
  }
  throw new Error('expected the function to refuse');
}

/** The historical chain is reachable only through these four SECURITY DEFINER functions,
 *  so the binding-role gate has to hold when a caller skips the API entirely. Each case
 *  below pairs a non-operator refusal with an operator call that gets a different error,
 *  which is what makes the refusal attributable to this gate and not to a later check. */
describe.skipIf(!enabled)('historical batch chain requires an owner binding at the SQL boundary', () => {
  let harness: Pg15Harness;
  let admin: Client;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    admin = await harness.connect(harness.createDatabase('batch_owner_only').config);
    await applyDatabaseMigrations(admin);
    await admin.query('BEGIN');
    try {
      for (const [binding, user, role] of [
        ['batch-owner', 'usr_batch_owner', 'owner'],
        ['batch-coach', 'usr_batch_coach', 'coach'],
      ] as const) {
        await admin.query(`INSERT INTO backend_identity.subject_bindings(
            binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
          VALUES ($1,'synthetic','synthetic-tenant',$1,$2,repeat('a',64),true,$3)`,
        [binding, user, role]);
      }
      // Both principals have fresh facts: the operator must therefore fail later than the
      // gate, and the coach can only be refused by the gate itself.
      for (const principal of ['batch-owner', 'batch-coach']) {
        await admin.query(`INSERT INTO content_intake.principals(
            principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version, revocation_generation)
          VALUES ($1,$2,'tenant-batch','app-batch','confirmed-synthetic',$1,1,0)`,
        [principal, principal === 'batch-owner' ? 'usr_batch_owner' : 'usr_batch_coach']);
        await admin.query(`INSERT INTO content_intake.principal_facts(
            principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
          VALUES ($1,1,ARRAY['dept-batch'],'job-batch-director',true,
            statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`,
        [principal]);
      }
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  const enqueue = (user: string) => admin.query(
    'SELECT * FROM public.enqueue_content_import($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
    ['imp_batch_owner_only', 'csv', 'obj_batch_owner_only', 'a'.repeat(64), 1, '[]', user, 'coach'],
  );

  it('refuses enqueue from a coach and reaches validation for an owner', async () => {
    const refused = await refusalOf(() => enqueue('usr_batch_coach'));
    expect(refused.code).toBe('ZA005');
    expect(refused.detail).toBe('FORBIDDEN');

    // Any later validation proves the owner reached the body past this gate.
    const allowed = await refusalOf(() => enqueue('usr_batch_owner'));
    expect(allowed.code).toBe('ZA001');
    expect(allowed.detail).not.toBe('FORBIDDEN');
  });

  it('refuses publish from a coach', async () => {
    const refused = await refusalOf(() => admin.query(
      'SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)',
      ['imp_batch_owner_only', 'title', 'summary', 'usr_batch_coach', 'coach'],
    ));
    expect(refused.code).toBe('ZA005');
    expect(refused.detail).toBe('FORBIDDEN');
  });

  it('refuses rollback from a coach and reaches NOT_FOUND for an owner', async () => {
    const rollback = (user: string) => admin.query(
      'SELECT * FROM public.rollback_content_release($1,$2,$3,$4,$5)',
      ['rel_batch_owner_only_missing', 'title', 'summary', user, 'coach'],
    );
    const refused = await refusalOf(() => rollback('usr_batch_coach'));
    expect(refused.code).toBe('ZA005');
    expect(refused.detail).toBe('FORBIDDEN');

    const allowed = await refusalOf(() => rollback('usr_batch_owner'));
    expect(allowed.code).toBe('ZA002');
    expect(allowed.detail).toBe('NOT_FOUND');
  });

  it('refuses previous-release resolution from a coach and reaches NOT_FOUND for an owner', async () => {
    const resolve = (user: string) => admin.query(
      'SELECT release_id, release_seq FROM public.resolve_previous_content_release($1)',
      [user],
    );
    const refused = await refusalOf(() => resolve('usr_batch_coach'));
    expect(refused.code).toBe('ZA005');
    expect(refused.detail).toBe('FORBIDDEN');

    const allowed = await refusalOf(() => resolve('usr_batch_owner'));
    expect(allowed.code).toBe('ZA002');
    expect(allowed.detail).toBe('NOT_FOUND');
  });
});
