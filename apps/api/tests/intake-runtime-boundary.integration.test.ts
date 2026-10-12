import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyHistoricalIntakeMigrations } from './support/intake-historical-migrations.js';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { authenticatedProductSession, createProductAuthService } from '../src/product-auth-service.js';
import type { AuthenticatedUser, ProductAuthService } from '../src/auth-service.js';
import { createIntakeTransactions, IntakeRejection } from '../src/content-intake/transaction.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';

// Historical inline-lock counterexample, retained solely for the pre-0033 fixture.
async function lockProductSession(client: { query: Client['query']; validUntil: (n: number) => void }, actor: AuthenticatedUser) {
  const hash = authenticatedProductSession(actor);
  if (!hash) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
  const result = await client.query(`SELECT s.expires_at FROM backend_identity.sessions s JOIN backend_identity.subject_bindings b USING(binding_id)
    WHERE s.token_hash=$1 AND b.user_id=$2 AND b.enabled AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE OF s,b`, [hash, actor.user_id]);
  if (!result.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
  const validUntil = result.rows[0].expires_at.getTime(); client.validUntil(validUntil); return { hash, validUntil };
}

// A deliberately incomplete role: prove the first runtime assembly boundary,
// not a production ACL or a successful full usage/publish flow.
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
describe.skipIf(!enabled)('intake runtime session-lock permission boundary (synthetic only)', () => {
  let harness: Pg15Harness, admin: Client, reader: Pool, auth: ProductAuthService;
  let actor: AuthenticatedUser;
  const errors: unknown[] = [];
  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('intake_runtime_boundary');
    admin = await harness.connect(db.config);
    await applyHistoricalIntakeMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    // These grants exist only in a newly initialized disposable cluster.
    await admin.query(`CREATE ROLE synthetic_usage_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT USAGE ON SCHEMA backend_identity,backend_review TO synthetic_usage_probe;
      GRANT SELECT ON backend_identity.sessions,backend_identity.subject_bindings TO synthetic_usage_probe;
      GRANT EXECUTE ON FUNCTION backend_review.lock_content() TO synthetic_usage_probe;
      CREATE ROLE synthetic_boundary_auth LOGIN NOINHERIT;
      GRANT app_backend_auth TO synthetic_boundary_auth;`);
    reader = new Pool({ ...db.config, user: 'synthetic_usage_probe', max: 1 });
    auth = await createProductAuthService({
      connectionString: `postgresql://synthetic_boundary_auth@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 1, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    }, { authorizeUrl: state => `http://127.0.0.1/authorize?state=${state}`, exchange: async code => code, close: () => undefined }, 'mock');
    const verifier = 'v'.repeat(43);
    const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, 'agent');
    const session = await auth.exchange(login.login_id, verifier);
    expect(session).not.toBeNull();
    actor = (await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))!;
    expect(actor).not.toBeNull(); errors.length = 0;
  }, 60_000);
  afterEach(async () => {
    try { await auth?.close(); }
    finally { try { await reader?.end(); } finally { try { await admin?.end(); } finally { harness?.stop(); } } }
  }, 60_000);

  async function lockedSession() {
    const client = await reader.connect();
    try {
      await client.query('BEGIN');
      const deadlines: number[] = [];
      const value = await lockProductSession({ query: client.query.bind(client), validUntil: value => deadlines.push(value) }, actor);
      expect(deadlines).toEqual([value.validUntil]);
      return value;
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  }

  it('can SELECT the synthetic session but cannot lock it with SELECT-only privileges', async () => {
    expect((await reader.query('SELECT count(*) FROM backend_identity.sessions')).rows[0].count).toBe('1');
    await expect(lockedSession()).rejects.toMatchObject({ code: '42501', message: 'permission denied for table sessions' });
    // Granting a session UPDATE column moves the same real consumer to the second
    // locked relation. It does not establish a safe role (see the next probe).
    await admin.query('GRANT UPDATE(revoked_at) ON backend_identity.sessions TO synthetic_usage_probe');
    await expect(lockedSession()).rejects.toMatchObject({ code: '42501', message: 'permission denied for table subject_bindings' });
  });

  it('demonstrates why granting security-column UPDATE just to satisfy row locks is unsafe', async () => {
    await admin.query(`GRANT UPDATE(revoked_at) ON backend_identity.sessions TO synthetic_usage_probe;
      GRANT UPDATE(enabled) ON backend_identity.subject_bindings TO synthetic_usage_probe;`);
    await expect(lockedSession()).resolves.toMatchObject({ validUntil: expect.any(Number) });
    // The same role can now reverse an administrator's revocation/disable.
    // This is a counterexample in a disposable fixture, never a proposed grant.
    await admin.query("UPDATE backend_identity.sessions SET revoked_at=clock_timestamp(); UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-agent'");
    await expect(lockedSession()).rejects.toMatchObject({ reason: 'SCOPE_DENIED' });
    const client = await reader.connect();
    try {
      await client.query('BEGIN');
      expect((await client.query('UPDATE backend_identity.sessions SET revoked_at=NULL')).rowCount).toBe(1);
      expect((await client.query("UPDATE backend_identity.subject_bindings SET enabled=true WHERE user_id='user-agent'")).rowCount).toBe(1);
      await expect(lockProductSession({ query: client.query.bind(client), validUntil: () => undefined }, actor))
        .resolves.toMatchObject({ validUntil: expect.any(Number) });
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
    await expect(lockedSession()).rejects.toMatchObject({ reason: 'SCOPE_DENIED' });
  });

  it('fails closed before a business callback and leaves the pool reusable when runtime privileges are missing', async () => {
    const run = createIntakeTransactions(reader, (_id, error) => errors.push(error), { requireProductSession: true });
    let reachedBusiness = false;
    const result = await run(actor, 'permission-probe', null, null, async () => { reachedBusiness = true; return true; }, value => value as boolean);
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR', reason: 'COMMIT_UNKNOWN', commit: 'rolled_back' });
    expect(reachedBusiness).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: '3F000' }); // Formal consumer refuses the historical database without intake_runtime.
    for (const table of ['entitlements', 'entitlement_contexts', 'entitlement_scopes', 'publications']) {
      // Static test-owned table names, not a product input.
      expect((await admin.query(`SELECT count(*) FROM content_intake.${table}`)).rows[0].count).toBe('0');
    }
    expect((await reader.query('SELECT 1 AS reusable')).rows[0].reusable).toBe(1);
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe('rel_native_base');
  });

  it('keeps the candidate read/lock role out of identity writes, authority, publication and DDL', async () => {
    expect((await reader.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0])
      .toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
    for (const sql of [
      'UPDATE backend_identity.sessions SET revoked_at=NULL',
      'UPDATE backend_identity.subject_bindings SET enabled=true',
      "UPDATE backend_identity.subject_bindings SET role='owner'",
      'DELETE FROM content_intake.grants', 'DELETE FROM content_intake.principal_facts',
      'DELETE FROM public.content_current', 'CREATE TABLE backend_identity.probe(id int)',
    ]) await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  async function installNarrowCandidate() {
    await admin.query(await readFile(new URL('../experiments/intake-runtime/session-lock.sql', import.meta.url), 'utf8'));
    await admin.query(`REVOKE SELECT ON backend_identity.sessions,backend_identity.subject_bindings FROM synthetic_usage_probe;
      REVOKE USAGE ON SCHEMA backend_identity FROM synthetic_usage_probe;
      CREATE ROLE synthetic_lock_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT USAGE ON SCHEMA backend_identity,intake_runtime_probe TO synthetic_lock_owner;
      GRANT SELECT ON backend_identity.sessions,backend_identity.subject_bindings TO synthetic_lock_owner;
      GRANT UPDATE(revoked_at) ON backend_identity.sessions TO synthetic_lock_owner;
      GRANT UPDATE(enabled) ON backend_identity.subject_bindings TO synthetic_lock_owner;
      ALTER FUNCTION intake_runtime_probe.lock_product_session(TEXT,TEXT) OWNER TO synthetic_lock_owner;
      GRANT USAGE ON SCHEMA intake_runtime_probe TO synthetic_usage_probe;
      GRANT EXECUTE ON FUNCTION intake_runtime_probe.lock_product_session(TEXT,TEXT) TO synthetic_usage_probe;`);
  }
  const lockSql = 'SELECT intake_runtime_probe.lock_product_session($1,$2) AS deadline';
  const privateArguments = () => [authenticatedProductSession(actor), actor.user_id];

  it('consumes the narrow candidate with no identity SELECT or UPDATE and rejects wrong, disabled and revoked sessions', async () => {
    await installNarrowCandidate();
    const before = (await admin.query('SELECT expires_at FROM backend_identity.sessions')).rows[0].expires_at;
    expect((await reader.query(lockSql, privateArguments())).rows[0].deadline).toEqual(before);
    for (const args of [[null, actor.user_id], ['bad-hash', actor.user_id], ['a'.repeat(64), actor.user_id],
      [authenticatedProductSession(actor), 'another-synthetic-user']]) {
      await expect(reader.query(lockSql, args)).rejects.toMatchObject({ code: 'ZA003', message: 'SESSION_UNAVAILABLE' });
    }
    for (const sql of ['SELECT * FROM backend_identity.sessions', 'SELECT * FROM backend_identity.subject_bindings',
      'UPDATE backend_identity.sessions SET revoked_at=NULL', 'UPDATE backend_identity.subject_bindings SET enabled=true']) {
      await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-agent'");
    await expect(reader.query(lockSql, privateArguments())).rejects.toMatchObject({ code: 'ZA003', message: 'SESSION_UNAVAILABLE' });
    await admin.query("UPDATE backend_identity.subject_bindings SET enabled=true WHERE user_id='user-agent'; UPDATE backend_identity.sessions SET revoked_at=clock_timestamp()");
    await expect(reader.query(lockSql, privateArguments())).rejects.toMatchObject({ code: 'ZA003', message: 'SESSION_UNAVAILABLE' });
    expect((await admin.query('SELECT expires_at FROM backend_identity.sessions')).rows[0].expires_at).toEqual(before);
  });

  it('holds both identity locks until transaction end; subsequent revocation wins the next observation', async () => {
    await installNarrowCandidate();
    const client = await reader.connect();
    try {
      await client.query('BEGIN');
      await client.query(lockSql, privateArguments());
      await admin.query("SET lock_timeout='100ms'");
      for (const sql of ["UPDATE backend_identity.sessions SET revoked_at=clock_timestamp()",
        "UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-agent'"]) {
        await expect(admin.query(sql)).rejects.toMatchObject({ code: '55P03' });
      }
      await client.query('COMMIT');
      await admin.query("UPDATE backend_identity.sessions SET revoked_at=clock_timestamp()");
      await expect(client.query(lockSql, privateArguments())).rejects.toMatchObject({ code: 'ZA003', message: 'SESSION_UNAVAILABLE' });
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  });

  it('does not grant PUBLIC execution or caller schema mutation; caller search_path cannot shadow identity tables', async () => {
    await installNarrowCandidate();
    const fn = await admin.query(`SELECT p.prosecdef,p.proconfig,r.rolsuper,r.rolcanlogin,
      has_function_privilege('synthetic_boundary_auth',p.oid,'EXECUTE') AS other_can_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
      WHERE n.nspname='intake_runtime_probe' AND p.proname='lock_product_session'`);
    expect(fn.rows[0]).toMatchObject({ prosecdef: true, proconfig: ['search_path=pg_catalog'], rolsuper: false, rolcanlogin: false, other_can_execute: false });
    await expect(reader.query('CREATE TABLE intake_runtime_probe.shadow(id int)')).rejects.toMatchObject({ code: '42501' });
    const client = await reader.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TEMP TABLE sessions(token_hash text); CREATE TEMP TABLE subject_bindings(user_id text)');
      await client.query('SET LOCAL search_path=pg_temp,public');
      expect((await client.query(lockSql, privateArguments())).rows[0].deadline).toBeInstanceOf(Date);
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  });


  it('rejects a session that expires while waiting for its lock', async () => {
    await installNarrowCandidate();
    await admin.query("UPDATE backend_identity.sessions SET expires_at=clock_timestamp()+interval '1 second'");
    await admin.query('BEGIN');
    await admin.query('SELECT 1 FROM backend_identity.sessions FOR UPDATE');
    const client = await reader.connect();
    try {
      await client.query("SET statement_timeout='4s'");
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const pending = client.query(lockSql, privateArguments()).then(() => null, (error: unknown) => error);
      // Confirm actual lock contention before allowing the observed deadline to
      // expire; a scheduling delay must not masquerade as the wait-path test.
      let blocked = false;
      for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
        blocked = (await admin.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked;
        if (!blocked) await admin.query('SELECT pg_sleep(0.01)');
      }
      expect(blocked).toBe(true);
      await admin.query('SELECT pg_sleep(1.1)');
      await admin.query('COMMIT');
      expect(await pending).toMatchObject({ code: 'ZA003', message: 'SESSION_UNAVAILABLE' });
    } finally { await admin.query('ROLLBACK'); client.release(); }
  });

});
