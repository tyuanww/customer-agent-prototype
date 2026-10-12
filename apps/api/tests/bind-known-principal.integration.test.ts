import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client, QueryResult, QueryResultRow } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { bindKnownPrincipal, PRINCIPAL_BINDING_CONFLICT } from '../src/content-intake/bind-known-principal.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const named = ['principal-cs-director', 'principal-cs-manager', 'principal-dev-weiwei'];
const binding = {
  principalId: 'principal-review', userId: 'user-review', tenantId: 'tenant-review', appId: 'app-review',
  identityScope: 'scope-review', personKey: 'person-review', departmentIds: ['dept-review'], jobId: 'job-review',
};

async function seedBinding(client: Client) {
  await applyDatabaseMigrations(client);
  await client.query(`INSERT INTO backend_identity.subject_bindings
    (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
    VALUES ('binding-review','synthetic','login-tenant','subject-review',$1,repeat('ab',32),true,'owner')`, [binding.userId]);
}

async function waitUntilBlocked(observer: Client, waitingPid: number, blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = (await observer.query<{ blocked: boolean }>(
      'SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked', [waitingPid, blockerPid])).rows[0];
    if (row?.blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Concurrent binding did not reach the expected database lock');
}

describe.skipIf(!enabled)('bind a principal only from an enabled subject binding', () => {
  let harness: Pg15Harness;
  beforeEach(() => { harness = new Pg15Harness(); harness.start(); }, 120_000);
  afterEach(() => harness.stop());

  it.each(['tenantId', 'appId', 'identityScope', 'personKey'] as const)(
    'rejects a changed %s without writing facts and leaves the caller transaction usable', async field => {
      const database = harness.createDatabase('bind_identity');
      const client = await harness.connect(database.config);
      try {
        await seedBinding(client);
        await bindKnownPrincipal(client, binding);
        await client.query('BEGIN');
        await expect(bindKnownPrincipal(client, {
          ...binding, [field]: `${binding[field]}-changed`, jobId: 'job-changed', departmentIds: ['dept-changed'],
        })).rejects.toThrow(PRINCIPAL_BINDING_CONFLICT);
        expect((await client.query(`SELECT current_facts_version::text AS version FROM content_intake.principals`)).rows).toEqual([{ version: '1' }]);
        expect((await client.query('SELECT tenant_id,app_id,identity_scope,person_key FROM content_intake.principals')).rows).toEqual([
          { tenant_id: binding.tenantId, app_id: binding.appId, identity_scope: binding.identityScope, person_key: binding.personKey },
        ]);
        expect((await client.query(`SELECT job_id, department_ids FROM content_intake.principal_facts`)).rows).toEqual([
          { job_id: binding.jobId, department_ids: binding.departmentIds },
        ]);
        await client.query('COMMIT');
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    }, 30_000,
  );

  it.each(['same-pair', 'different-principal'] as const)(
    'handles an actual two-session %s insert race in explicit transactions', async scenario => {
      const database = harness.createDatabase('bind_race');
      const first = await harness.connect(database.config);
      const second = await harness.connect(database.config);
      let pending: Promise<{ value?: string; error?: unknown }> | undefined;
      try {
        await seedBinding(first);
        const firstPid = Number((await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        const secondPid = Number((await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        await first.query('BEGIN');
        await second.query('BEGIN');
        await second.query("SET LOCAL statement_timeout='10s'");
        expect(await bindKnownPrincipal(first, binding)).toBe('bound');
        pending = bindKnownPrincipal(second, scenario === 'same-pair' ? binding : { ...binding, principalId: 'principal-competing' })
          .then(value => ({ value }), (error: unknown) => ({ error }));
        await waitUntilBlocked(first, secondPid, firstPid);
        await first.query('COMMIT');
        const result = await pending;
        if (scenario === 'same-pair') {
          expect(result).toEqual({ value: 'bound' });
          await second.query('COMMIT');
        } else {
          expect(result.error).toBeInstanceOf(Error);
          expect((result.error as Error).message).toBe(PRINCIPAL_BINDING_CONFLICT);
          expect((result.error as Error).cause).toMatchObject({ code: '23505', constraint: 'principals_user_id_key' });
          // A database constraint failure belongs to the caller's transaction: it must roll back.
          await expect(second.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' });
          await second.query('ROLLBACK');
        }
        const expected = scenario === 'same-pair' ? '2' : '1';
        expect((await first.query('SELECT principal_id,current_facts_version::text AS version FROM content_intake.principals')).rows)
          .toEqual([{ principal_id: binding.principalId, version: expected }]);
        expect((await first.query('SELECT facts_version::text AS version FROM content_intake.principal_facts ORDER BY facts_version')).rows)
          .toEqual(scenario === 'same-pair' ? [{ version: '1' }, { version: '2' }] : [{ version: '1' }]);
      } finally {
        await first.query('ROLLBACK');
        await pending;
        await second.query('ROLLBACK');
        await first.end();
        await second.end();
      }
    }, 30_000,
  );

  it('preserves a non-identity unique violation without issuing a second query', async () => {
    const database = harness.createDatabase('bind_other_unique');
    const client = await harness.connect(database.config);
    try {
      await client.query('CREATE TEMP TABLE non_identity (id int CONSTRAINT non_identity_pkey PRIMARY KEY)');
      await client.query('INSERT INTO non_identity VALUES (1)');
      await client.query('BEGIN');
      let calls = 0;
      const wrapped = {
        query: async <T extends QueryResultRow>(): Promise<QueryResult<T>> => {
          calls++;
          return client.query<T>('INSERT INTO non_identity VALUES (1)');
        },
      };
      await expect(bindKnownPrincipal(wrapped, binding)).rejects.toMatchObject({ code: '23505', constraint: 'non_identity_pkey' });
      expect(calls).toBe(1);
      await client.query('ROLLBACK');
    } finally { await client.end(); }
  }, 30_000);

  it('refreshes the same pair, rejects a disabled or conflicting user, and writes no grant', async () => {
    const database = harness.createDatabase('principal_bind');
    const client = await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client);
      const uniqueDefs = (await client.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'content_intake.principals'::regclass AND contype IN ('p','u')`)).rows.map(row => row.def);
      expect(uniqueDefs).toContain('PRIMARY KEY (principal_id)');
      expect(uniqueDefs).toContain('UNIQUE (user_id)');
      const seeds = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/database/seeds');
      const seedText = readdirSync(seeds).filter(name => name.endsWith('.sql')).map(name => readFileSync(path.join(seeds, name), 'utf8')).join('\n');
      for (const id of named) expect(seedText).not.toContain(id);
      const grantsBefore = Number((await client.query('SELECT count(*)::int AS count FROM content_intake.grants')).rows[0].count);
      await client.query(`INSERT INTO backend_identity.subject_bindings
        (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ('bind-known','synthetic','identity-tenant','known-subject','user-known',repeat('ab',32),true,'owner')`);
      const input = {
        principalId: 'principal-bind-known', userId: 'user-known', tenantId: 'tenant-synthetic', appId: 'app-a',
        identityScope: 'confirmed-synthetic', personKey: 'person-known', departmentIds: ['dept-a'], jobId: 'job-known',
      };
      expect(await bindKnownPrincipal(client, input)).toBe('bound');
      expect(await bindKnownPrincipal(client, input)).toBe('bound');
      const fact = (await client.query<{ tenant_id: string; facts_version: string; window_seconds: string; fact_count: number }>(`
        SELECT person.tenant_id, facts.facts_version::text, extract(epoch FROM facts.valid_until - facts.checked_at)::text AS window_seconds,
          (SELECT count(*)::int FROM content_intake.principal_facts WHERE principal_id='principal-bind-known') AS fact_count
        FROM content_intake.principal_facts facts
        JOIN content_intake.principals person USING (principal_id)
        WHERE facts.principal_id='principal-bind-known'
        ORDER BY facts.facts_version DESC
        LIMIT 1`)).rows[0];
      expect(fact?.tenant_id).toBe('tenant-synthetic');
      expect(fact?.facts_version).toBe('2');
      expect(Number(fact?.window_seconds)).toBe(300);
      expect(fact?.fact_count).toBe(2);
      expect(await bindKnownPrincipal(client, { ...input, principalId: 'principal-bind-missing', userId: 'user-missing', personKey: 'person-missing' })).toBe('missing');
      expect((await client.query("SELECT principal_id FROM content_intake.principals WHERE user_id='user-missing'")).rows).toEqual([]);
      await client.query(`INSERT INTO backend_identity.subject_bindings
        (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ('bind-disabled','synthetic','identity-tenant','disabled-subject','user-disabled',repeat('ef',32),false,'owner')`);
      expect(await bindKnownPrincipal(client, { ...input, principalId: 'principal-bind-disabled', userId: 'user-disabled', personKey: 'person-disabled' })).toBe('missing');
      expect((await client.query("SELECT principal_id FROM content_intake.principals WHERE user_id='user-disabled'")).rows).toEqual([]);
      await expect(bindKnownPrincipal(client, { ...input, principalId: 'principal-bind-other', personKey: 'person-other' })).rejects.toThrow(PRINCIPAL_BINDING_CONFLICT);
      expect((await client.query("SELECT principal_id FROM content_intake.principals WHERE user_id='user-known'")).rows).toEqual([{ principal_id: 'principal-bind-known' }]);
      expect((await client.query("SELECT principal_id FROM content_intake.principals WHERE principal_id='principal-bind-other'")).rows).toEqual([]);
      expect(Number((await client.query("SELECT count(*)::int AS count FROM content_intake.principal_facts WHERE principal_id='principal-bind-known'")).rows[0].count)).toBe(2);
      await client.query(`INSERT INTO backend_identity.subject_bindings
        (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ('bind-other-user','synthetic','identity-tenant','other-subject','user-other',repeat('cd',32),true,'owner')`);
      await expect(bindKnownPrincipal(client, { ...input, principalId: 'principal-same-person', userId: 'user-other' }))
        .rejects.toMatchObject({ message: PRINCIPAL_BINDING_CONFLICT, cause: { code: '23505', constraint: 'principals_tenant_id_app_id_identity_scope_person_key_key' } });
      expect((await client.query("SELECT principal_id FROM content_intake.principals WHERE principal_id='principal-same-person'")).rows).toEqual([]);
      expect(Number((await client.query("SELECT count(*)::int AS count FROM content_intake.principal_facts WHERE principal_id='principal-bind-known'")).rows[0].count)).toBe(2);
      await expect(bindKnownPrincipal(client, { ...input, userId: 'user-other', personKey: 'person-other-user' })).rejects.toThrow(PRINCIPAL_BINDING_CONFLICT);
      expect((await client.query("SELECT user_id FROM content_intake.principals WHERE principal_id='principal-bind-known'")).rows).toEqual([{ user_id: 'user-known' }]);
      expect((await client.query("SELECT principal_id FROM content_intake.principals WHERE user_id='user-other'")).rows).toEqual([]);
      expect(Number((await client.query("SELECT count(*)::int AS count FROM content_intake.principal_facts WHERE principal_id='principal-bind-known'")).rows[0].count)).toBe(2);
      expect((await client.query('SELECT principal_id FROM content_intake.principals WHERE principal_id = ANY($1::text[])', [named])).rowCount).toBe(0);
      expect(Number((await client.query('SELECT count(*)::int AS count FROM content_intake.grants')).rows[0].count)).toBe(grantsBefore);
    } finally {
      await client.end();
    }
  }, 180_000);
});
