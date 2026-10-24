import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { ROLE_CEILING } from '../src/content-intake/role-ceiling.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

const HOME = { tenant: 'tenant-menokin', app: 'app-customer-agent', department: 'dept-menokin' };

type Outcome = Readonly<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string }>;

/**
 * Runs one statement as the capability role the API actually uses, so a missing EXECUTE fails here
 * instead of in production. `stack_owner` bypasses every privilege check and would hide it.
 *
 * A successful statement is committed, because later assertions read what it wrote; a refused one
 * is rolled back, because PostgreSQL will not run another statement in an aborted transaction.
 */
async function asIntakeBusiness(client: Client, sql: string, values: readonly unknown[] = []): Promise<Outcome> {
  await client.query('BEGIN');
  let open = true;
  try {
    await client.query('SET LOCAL ROLE intake_business');
    const result = await client.query(sql, values as unknown[]);
    await client.query('COMMIT');
    open = false;
    return { ok: true, rows: result.rows };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false, code: String(failure.code ?? 'unknown'), message: String(failure.message ?? '') };
  } finally {
    if (open) { try { await client.query('ROLLBACK'); } catch { /* the outcome is already recorded */ } }
  }
}

async function seedHome(client: Client): Promise<void> {
  await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version)
    VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [HOME.tenant, HOME.app]);
}

const createSeat = (client: Client, username: unknown, display: unknown, post: unknown) => asIntakeBusiness(client,
  'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
  [username, display, post, HOME.tenant, HOME.app, HOME.department, 'operator']);

describe.skipIf(!enabled)('seat lifecycle definer functions', () => {
  it('creates a seat for each post and lists them', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const client: Client = await harness.connect(harness.createDatabase('seat_lifecycle').config);
    try {
      await applyDatabaseMigrations(client);
      await seedHome(client);

      for (const [username, post] of [['a', '客服'], ['b', '客服主管']] as const) {
        const created = await createSeat(client, username, `合成${post}`, post);
        expect(created.ok, JSON.stringify(created)).toBe(true);
      }

      const bindings = await client.query<{ binding_id: string; role: string; enabled: boolean }>(
        `SELECT binding_id, role, enabled FROM backend_identity.subject_bindings
          WHERE binding_id LIKE 'synthetic_seat_%' ORDER BY binding_id`);
      expect(bindings.rows).toEqual([
        { binding_id: 'synthetic_seat_a', role: 'agent', enabled: true },
        { binding_id: 'synthetic_seat_b', role: 'coach', enabled: true },
      ]);

      const facts = await client.query<{ job_id: string; department_ids: string[]; capped: boolean }>(
        `SELECT facts.job_id, facts.department_ids,
                (facts.valid_until <= facts.checked_at + interval '5 minutes') AS capped
           FROM content_intake.principals person
           JOIN content_intake.principal_facts facts
             ON facts.principal_id = person.principal_id
            AND facts.facts_version = person.current_facts_version
          WHERE person.principal_id LIKE 'seat_%' ORDER BY person.principal_id`);
      expect(facts.rows).toEqual([
        { job_id: 'job-seat', department_ids: [HOME.department], capped: true },
        { job_id: 'job-seat-supervisor', department_ids: [HOME.department], capped: true },
      ]);

      const rules = await client.query<{ job_id: string; role: string }>(
        `SELECT job_id, role FROM content_intake.role_rules
          WHERE job_id IN ('job-seat','job-seat-supervisor') ORDER BY job_id`);
      expect(rules.rows).toEqual([
        { job_id: 'job-seat', role: 'agent' },
        { job_id: 'job-seat-supervisor', role: 'supervisor' },
      ]);

      const listed = await asIntakeBusiness(client, 'SELECT * FROM backend_identity.list_seats($1,$2)', [HOME.tenant, HOME.app]);
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.rows).toEqual([
          { out_username: 'a', out_display_name: '合成客服', out_post: '客服', out_enabled: true },
          { out_username: 'b', out_display_name: '合成客服主管', out_post: '客服主管', out_enabled: true },
        ]);
      }
    } finally { await client.end(); harness.stop(); }
  }, 180_000);

  it('rejects a malformed login name, an unknown post and a duplicate', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const client: Client = await harness.connect(harness.createDatabase('seat_negative').config);
    try {
      await applyDatabaseMigrations(client);
      await seedHome(client);

      // A login name outside the documented character set, including one that would break the
      // deterministic binding id if it reached string concatenation.
      for (const bad of ['has space', "quote'", '', 'a'.repeat(65), '名字', '../etc']) {
        const outcome = await createSeat(client, bad, '合成人员', '客服');
        expect(outcome.ok, `username ${JSON.stringify(bad)} must be refused`).toBe(false);
        expect(outcome.ok === false && outcome.message).toContain('SEAT_USERNAME_INVALID');
      }

      // A post outside the two the product offers, including role names that exist in the ceiling
      // but are not posts.
      for (const bad of ['supervisor', 'agent', '客服 主管', '', 'admin']) {
        const outcome = await createSeat(client, 'c', '合成人员', bad);
        expect(outcome.ok, `post ${JSON.stringify(bad)} must be refused`).toBe(false);
        expect(outcome.ok === false && outcome.message).toContain('SEAT_POST_INVALID');
      }

      // An empty display name, and one carrying a control character.
      for (const bad of ['   ', '合\n成']) {
        const outcome = await createSeat(client, 'c', bad, '客服');
        expect(outcome.ok, `display ${JSON.stringify(bad)} must be refused`).toBe(false);
        expect(outcome.ok === false && outcome.message).toContain('SEAT_DISPLAY_NAME_INVALID');
      }

      // None of the refusals wrote anything.
      const empty = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM backend_identity.subject_bindings WHERE binding_id LIKE 'synthetic_seat_%'`);
      expect(empty.rows[0]?.n).toBe('0');

      expect((await createSeat(client, 'c', '合成人员', '客服')).ok).toBe(true);

      const duplicate = await createSeat(client, 'c', '另一个人', '客服');
      expect(duplicate.ok).toBe(false);
      expect(duplicate.ok === false && duplicate.message).toContain('SEAT_EXISTS');

      const sameName = await createSeat(client, 'd', '合成人员', '客服');
      expect(sameName.ok).toBe(false);
      expect(sameName.ok === false && sameName.message).toContain('SEAT_DISPLAY_NAME_TAKEN');
    } finally { await client.end(); harness.stop(); }
  }, 180_000);

  it('refuses a capability role other than the one the API uses', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const client: Client = await harness.connect(harness.createDatabase('seat_acl').config);
    try {
      await applyDatabaseMigrations(client);
      await seedHome(client);
      // `intake_usage` is a real capability role with no reason to create identity.
      let outcome: Outcome | null = null;
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE intake_usage');
        const result = await client.query(
          'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
          ['a', '合成人员', '客服', HOME.tenant, HOME.app, HOME.department, 'operator']);
        outcome = { ok: true, rows: result.rows };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        outcome = { ok: false, code: String(failure.code ?? ''), message: String(failure.message ?? '') };
      } finally { await client.query('ROLLBACK'); }
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.code).toBe('42501');

      const written = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM backend_identity.subject_bindings WHERE binding_id LIKE 'synthetic_seat_%'`);
      expect(written.rows[0]?.n).toBe('0');
    } finally { await client.end(); harness.stop(); }
  }, 180_000);

  it('cannot reach a built-in identity, renews facts on login, and disables idempotently', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const client: Client = await harness.connect(harness.createDatabase('seat_disable').config);
    try {
      await applyDatabaseMigrations(client);
      await seedHome(client);

      // The built-in owner binding is what the root allocations resolve through. Naming it here
      // must not switch it off.
      await client.query(`INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
        VALUES ('synthetic_owner','synthetic','synthetic-tenant','内置主账号','usr_synthetic_owner',
          repeat('ab',32), true, 'owner')`);
      const ownerAttempt = await asIntakeBusiness(client,
        'SELECT backend_identity.disable_seat($1,$2,$3)', ['owner', HOME.tenant, HOME.app]);
      expect(ownerAttempt.ok).toBe(false);
      const ownerStill = await client.query<{ enabled: boolean }>(
        `SELECT enabled FROM backend_identity.subject_bindings WHERE binding_id = 'synthetic_owner'`);
      expect(ownerStill.rows[0]?.enabled).toBe(true);

      expect((await createSeat(client, 'a', '合成客服', '客服')).ok).toBe(true);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const renewed = await asIntakeBusiness(client,
          'SELECT content_intake.project_seat_login($1) AS status', ['synthetic_seat_a']);
        expect(renewed.ok && renewed.rows[0]).toEqual({ status: 'projected' });
      }
      const versions = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM content_intake.principal_facts WHERE principal_id = 'seat_a'`);
      // Creation wrote one and each login added one: the window is renewed, not rewritten.
      expect(versions.rows[0]?.n).toBe('3');

      const disabled = await asIntakeBusiness(client,
        'SELECT backend_identity.disable_seat($1,$2,$3)', ['a', HOME.tenant, HOME.app]);
      expect(disabled.ok).toBe(true);
      const afterDisable = await asIntakeBusiness(client,
        'SELECT content_intake.project_seat_login($1) AS status', ['synthetic_seat_a']);
      expect(afterDisable.ok && afterDisable.rows[0]).toEqual({ status: 'missing' });
      // A retry after a successful disable reports success rather than not-found.
      expect((await asIntakeBusiness(client,
        'SELECT backend_identity.disable_seat($1,$2,$3)', ['a', HOME.tenant, HOME.app])).ok).toBe(true);
    } finally { await client.end(); harness.stop(); }
  }, 180_000);
});

/** The definer function carries its own copy of the post-to-role mapping, and `role-ceiling.ts`
 *  carries the role set. Two copies drift unless something compares them, so this reads the
 *  migration text and checks the mapping against the TypeScript ceiling. Adding a role on one side
 *  without the other fails here instead of at a customer's first login. */
describe('seat post mapping agrees with the role ceiling', () => {
  const sql = readFileSync(new URL('../../../packages/database/overlays/0067_seat_lifecycle.sql', import.meta.url), 'utf8');

  it('names only roles the ceiling knows', () => {
    const tuples = [...sql.matchAll(/\('([^']+)',\s*'(job-[^']+)',\s*'([a-z]+)',\s*'([a-z]+)'\)/g)];
    expect(tuples.length).toBe(2);
    for (const [, post, jobId, businessRole, sessionRole] of tuples) {
      expect(post).toBeTruthy();
      expect(Object.keys(ROLE_CEILING), `role ${businessRole} for ${jobId} must exist in role-ceiling.ts`)
        .toContain(businessRole);
      expect(['agent', 'coach'], 'subject_bindings.role allows only these').toContain(sessionRole);
    }
  });

  it('offers exactly the two posts the product names', () => {
    const posts = [...sql.matchAll(/\('(客服[^']*)',\s*'job-/g)].map((match) => match[1]).sort();
    expect(posts).toEqual(['客服', '客服主管']);
  });
});
