import { readFile } from 'node:fs/promises';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyHistoricalIntakeMigrations } from './support/intake-historical-migrations.js';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { assessIntakeRuntimeAssembly, readShopAuthorization, type AssemblyClient } from '../experiments/intake-runtime/assembly.js';
import { createOrganizationFactsWriter } from '../src/content-intake/organization/facts-writer.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';

// Disposable cluster only. shop-a/shop-b and the empty rel_native_base catalog
// come from the existing synthetic seed. This file does not supply a claim list.
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const absent = { claimManifest: null };
const scope = { tenantId: 'tenant-a', appId: 'app-a' };

describe.skipIf(!enabled)('intake scope runtime assembly refusals (synthetic only)', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let probePool: Pool;
  let writerPool: Pool;
  let write: ReturnType<typeof createOrganizationFactsWriter>;
  const diagnostics: unknown[] = [];

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('intake_scope_runtime');
    admin = await harness.connect(db.config);
    await applyHistoricalIntakeMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    await admin.query(`CREATE ROLE synthetic_usage_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
      CREATE ROLE synthetic_facts_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
      GRANT USAGE ON SCHEMA content_intake, backend_review TO synthetic_facts_writer;
      GRANT SELECT ON content_intake.principals, content_intake.principal_facts TO synthetic_facts_writer;
      GRANT INSERT ON content_intake.principal_facts TO synthetic_facts_writer;
      GRANT UPDATE (current_facts_version, revocation_generation) ON content_intake.principals TO synthetic_facts_writer;
      GRANT EXECUTE ON FUNCTION backend_review.lock_content() TO synthetic_facts_writer;`);
    probePool = new Pool({ ...db.config, user: 'synthetic_usage_probe', max: 1 });
    writerPool = new Pool({ ...db.config, user: 'synthetic_facts_writer', max: 1 });
    write = createOrganizationFactsWriter(writerPool, scope, error => diagnostics.push(error));
  }, 120_000);

  afterAll(async () => {
    await writerPool?.end();
    await probePool?.end();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  function clientOf(queryable: { query: Client['query'] | Pool['query'] }): AssemblyClient {
    return { query: (sql, params) => queryable.query(sql, params as never[]) };
  }

  async function ledger() {
    const tables = [
      'content_intake.release_catalogs', 'content_intake.release_lineage', 'content_intake.grants',
      'content_intake.publications', 'public.content_current', 'backend_identity.sessions',
      'backend_identity.subject_bindings', 'backend_identity.capability_bindings', 'backend_identity.login_requests',
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) counts[table] = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
    const current = await admin.query<{ current_release_id: string }>('SELECT current_release_id FROM public.content_current WHERE id=1');
    return { counts, current: current.rows[0]!.current_release_id };
  }

  it('does not treat the seeded empty catalog or the administrator pool as a claimed legacy directory', async () => {
    const before = await ledger();
    const decision = await assessIntakeRuntimeAssembly(clientOf(admin), absent);
    expect(decision).toEqual({
      ready: false, legacyAdopted: false, reason: 'CLAIM_MANIFEST_ABSENT', actor: 'gate_owner',
      releaseId: 'rel_native_base', catalogPresent: true, lineageCount: 0, legacyItemCount: 0,
      emptyCatalog: true, administratorPool: true, identityWritable: true, canInheritLegacyCatalog: true,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(await ledger()).toEqual(before);
  });

  it('rejects a supplied manifest without reading it into the catalog', async () => {
    const before = await ledger();
    const samples: unknown[] = [
      null, {}, { claimManifest: [] }, { claimManifest: {} },
      { claimManifest: null, adopt: true }, { claimManifest: undefined },
      { claimManifest: [{ sourceId: 'source-a', shopId: 'shop-a', legacyEntryKey: 'not-a-claim' }] },
    ];
    for (const sample of samples) {
      await expect(assessIntakeRuntimeAssembly(clientOf(admin), sample)).rejects.toMatchObject({ reason: 'CLAIM_LIST_UNUSABLE' });
    }
    await expect(assessIntakeRuntimeAssembly(clientOf(admin), samples[6])).rejects.toThrow('CLAIM_LIST_UNUSABLE');
    expect(await ledger()).toEqual(before);
  });

  it('refuses an empty catalog from a restricted account and keeps that account off identity tables', async () => {
    const probe = clientOf(probePool);
    expect(await assessIntakeRuntimeAssembly(probe, absent)).toMatchObject({
      ready: false, legacyAdopted: false, reason: 'ASSEMBLY_UNREADABLE', administratorPool: false,
    });
    await admin.query(`GRANT USAGE ON SCHEMA content_intake TO synthetic_usage_probe;
      GRANT SELECT ON content_intake.release_catalogs, content_intake.release_lineage TO synthetic_usage_probe;
      GRANT SELECT ON public.content_current, public.release_items TO synthetic_usage_probe;`);
    const seen = await assessIntakeRuntimeAssembly(probe, absent);
    expect(seen).toMatchObject({
      ready: false, legacyAdopted: false, reason: 'CLAIM_MANIFEST_ABSENT', actor: 'synthetic_usage_probe',
      releaseId: 'rel_native_base', emptyCatalog: true, administratorPool: false,
      identityWritable: false, canInheritLegacyCatalog: false,
    });
    await admin.query(await readFile(new URL('../experiments/intake-runtime/session-lock.sql', import.meta.url), 'utf8'));
    await admin.query(`REVOKE USAGE ON SCHEMA backend_identity FROM synthetic_usage_probe;
      CREATE ROLE synthetic_lock_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
      GRANT USAGE ON SCHEMA backend_identity, intake_runtime_probe TO synthetic_lock_owner;
      GRANT SELECT ON backend_identity.sessions, backend_identity.subject_bindings TO synthetic_lock_owner;
      GRANT UPDATE (revoked_at) ON backend_identity.sessions TO synthetic_lock_owner;
      GRANT UPDATE (enabled) ON backend_identity.subject_bindings TO synthetic_lock_owner;
      ALTER FUNCTION intake_runtime_probe.lock_product_session(TEXT, TEXT) OWNER TO synthetic_lock_owner;
      GRANT USAGE ON SCHEMA intake_runtime_probe TO synthetic_usage_probe;
      GRANT EXECUTE ON FUNCTION intake_runtime_probe.lock_product_session(TEXT, TEXT) TO synthetic_usage_probe;`);
    const before = await ledger();
    for (const sql of [
      "UPDATE backend_identity.sessions SET revoked_at=NULL",
      "INSERT INTO backend_identity.sessions(token_hash,login_id,binding_id,issued_at,expires_at) VALUES (repeat('b',64),'login','agent',clock_timestamp(),clock_timestamp())",
      'DELETE FROM backend_identity.sessions',
      "UPDATE backend_identity.subject_bindings SET enabled=true",
      "UPDATE backend_identity.subject_bindings SET role='owner'",
      "INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role) VALUES ('forged','synthetic','tenant-a','forged','user-forged',repeat('b',64),true,'owner')",
      'DELETE FROM backend_identity.subject_bindings',
      "INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,version,evidence_id) VALUES ('user-agent','content_review_lead',true,1,'EVD-SYNTHETIC1')",
      'UPDATE backend_identity.capability_bindings SET enabled=true',
      'DELETE FROM backend_identity.login_requests',
      'TRUNCATE backend_identity.sessions',
      "CREATE OR REPLACE FUNCTION intake_runtime_probe.lock_product_session(p_hash TEXT, p_user TEXT) RETURNS TIMESTAMPTZ LANGUAGE sql AS 'SELECT clock_timestamp()'",
      'ALTER FUNCTION intake_runtime_probe.lock_product_session(TEXT, TEXT) OWNER TO synthetic_usage_probe',
      'SET ROLE synthetic_lock_owner',
      "INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until) VALUES ('rel_native_base','source-a','entry',1,'candidate',1,'review',clock_timestamp())",
      "SELECT content_intake.inherit_legacy_catalog('rel_native_base','rel_native_base')",
    ]) await expect(probePool.query(sql), sql).rejects.toMatchObject({ code: '42501' });
    const body = await admin.query<{ prosrc: string }>(`SELECT p.prosrc FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='intake_runtime_probe' AND p.proname='lock_product_session'`);
    expect(body.rows[0]!.prosrc).not.toMatch(/\b(insert|update|delete|truncate|grant)\b/i);
    expect(await assessIntakeRuntimeAssembly(probe, absent)).toMatchObject({ legacyAdopted: false, emptyCatalog: true, administratorPool: false });
    expect(await ledger()).toEqual(before);
  });

  it('does not give disabled, transferred, or out-of-scope synthetic subjects a shop from a role label', async () => {
    const db = clientOf(admin);
    const grants = (await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM content_intake.grants')).rows[0]!.n;
    const shopB = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM content_intake.grants g
      JOIN content_intake.scopes s ON s.scope_id=g.scope_id WHERE s.shop_id='shop-b' AND g.revoked_at IS NULL`)).rows[0]!.n;
    expect(shopB).toBe(0);
    expect(await readShopAuthorization(db, 'director', 'query', 'scope-a', 'source-a')).toMatchObject({
      granted: false, loginRole: 'owner', matchedRoles: ['director'],
    });
    expect(await readShopAuthorization(db, 'director', 'publish', 'scope-b', 'source-b')).toMatchObject({ granted: false });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-a', 'source-a')).toMatchObject({
      granted: true, loginRole: 'agent', matchedRoles: ['agent'],
    });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-b', 'source-b')).toMatchObject({ granted: false });
    expect(await readShopAuthorization(db, 'agent', 'publish', 'scope-a', 'source-a')).toMatchObject({ granted: false });

    await admin.query("UPDATE backend_identity.subject_bindings SET role='owner' WHERE user_id='user-agent'");
    await admin.query("UPDATE content_intake.role_rules SET role='director' WHERE tenant_id='tenant-a' AND app_id='app-a' AND department_id='dept-a' AND job_id='job-agent'");
    await expect(admin.query("UPDATE backend_identity.subject_bindings SET role='title-label' WHERE user_id='user-agent'")).rejects.toMatchObject({ code: '23514' });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-a', 'source-a')).toMatchObject({
      granted: true, loginRole: 'owner', matchedRoles: ['director'],
    });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-b', 'source-b')).toMatchObject({
      granted: false, loginRole: 'owner', matchedRoles: ['director'],
    });
    expect(await readShopAuthorization(db, 'agent', 'publish', 'scope-a', 'source-a')).toMatchObject({
      granted: false, loginRole: 'owner', matchedRoles: ['director'],
    });
    expect(await readShopAuthorization(db, 'agent', 'content-manage', 'scope-a', 'source-a')).toMatchObject({ granted: false });

    const now = async () => (await admin.query<{ time: Date }>('SELECT clock_timestamp() AS time')).rows[0]!.time;
    const observation = async (expectedFactsVersion: number, changes: Record<string, unknown> = {}) => {
      const clock = await now();
      return {
        principalId: 'agent', expectedFactsVersion, departmentIds: ['dept-a'], jobId: 'job-agent', enabled: true,
        checkedAt: clock.toISOString(), validUntil: new Date(clock.getTime() + 60_000).toISOString(), ...changes,
      };
    };
    expect(await write(await observation(1, { enabled: false })), JSON.stringify(diagnostics)).toMatchObject({ ok: true, status: 'applied' });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-a', 'source-a')).toMatchObject({
      granted: false, loginRole: 'owner', matchedRoles: ['director'],
    });

    await admin.query(`INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
      VALUES ('tenant-a','app-a','dept-a','job-moved',1,'director')`);
    expect(await write(await observation(2, { enabled: true, jobId: 'job-moved' })), JSON.stringify(diagnostics)).toMatchObject({ ok: true, status: 'applied' });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-a', 'source-a')).toMatchObject({
      granted: true, loginRole: 'owner', matchedRoles: ['director'],
    });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-b', 'source-b')).toMatchObject({ granted: false, matchedRoles: ['director'] });
    expect(await readShopAuthorization(db, 'agent', 'publish', 'scope-a', 'source-a')).toMatchObject({ granted: false, matchedRoles: ['director'] });

    expect(await write(await observation(3, { enabled: true, jobId: 'job-moved', departmentIds: ['dept-out'] })), JSON.stringify(diagnostics)).toMatchObject({ ok: true });
    expect(await readShopAuthorization(db, 'agent', 'query', 'scope-a', 'source-a')).toMatchObject({
      granted: false, loginRole: 'owner', matchedRoles: [],
    });
    expect((await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM content_intake.grants')).rows[0]!.n).toBe(grants);
    expect((await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM content_intake.grants g
      JOIN content_intake.scopes s ON s.scope_id=g.scope_id WHERE s.shop_id='shop-b' AND g.revoked_at IS NULL`)).rows[0]!.n).toBe(0);
  });

  it('does not move content_current id=1 when sources.mode is not v2-preview or the catalog row is absent', async () => {
    // Success path that does move id=1: scripts/intake-synthetic/host.test.ts publishes
    // against the seeded rel_native_base catalog, then snapshot.releaseId === currentReleaseId.
    const pointer = async () => (await admin.query<{ current_release_id: string }>(
      'SELECT current_release_id FROM public.content_current WHERE id=1',
    )).rows[0]!.current_release_id;
    expect(await pointer()).toBe('rel_native_base');
    const catalogsBefore = (await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM content_intake.release_catalogs')).rows[0]!.n;
    await admin.query('BEGIN');
    try {
      await admin.query(`INSERT INTO content_intake.objects(
        object_id, source_id, actor_id, tenant_id, app_id, object_key, sha256, bytes, mime, purpose, received_at)
        VALUES ('gate-object','source-a','enabler','tenant-a','app-a','intake/gate-object.xlsx', repeat('a',64), 1,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input', clock_timestamp())`);
      await admin.query(`INSERT INTO content_intake.candidate_versions(
        candidate_id, version, source_id, scope_id, source_version, object_id, file_sha256, actor_id, base_release_id,
        canonical_encoding, canonical_material, material, risk, explicit_disable_count, created_at, updated_at, publication_policy)
        SELECT 'gate-candidate', 1, 'source-a', 'scope-a', 1, 'gate-object', repeat('a',64), 'enabler', 'rel_native_base',
          'candidate-p1.1', material::text, material, 'routine', 0, clock_timestamp(), clock_timestamp(), 'direct-v1'
        FROM (
          SELECT jsonb_build_object(
            'canonicalEncodingVersion', 'candidate-p1.1',
            'scope', jsonb_build_object('tenantId', s.tenant_id, 'appId', s.app_id, 'brandId', s.brand_id,
              'shopId', s.shop_id, 'domain', s.domain, 'sourceId', 'source-a'),
            'object', jsonb_build_object('objectId', 'gate-object', 'sha256', repeat('a',64)),
            'sourceClaim', jsonb_build_object('fileSha256', repeat('a',64)),
            'contributors', jsonb_build_array('enabler'),
            'baseReleaseId', 'rel_native_base',
            'risk', jsonb_build_object('level', 'routine', 'explicitDisableCount', 0),
            'entries', '[]'::jsonb
          ) AS material
          FROM content_intake.scopes s WHERE s.scope_id='scope-a'
        ) built`);
      const digest = (await admin.query<{ digest: string }>(
        `SELECT digest FROM content_intake.candidate_versions WHERE candidate_id='gate-candidate' AND version=1`,
      )).rows[0]!.digest;
      const request = {
        confirmed: true,
        key: { candidateId: 'gate-candidate', version: 1, digest },
        baseReleaseId: 'rel_native_base',
        operationId: 'gate-deny',
        sourceEvidenceVersion: 0,
        title: '合成门禁',
        summary: '指针不动',
      };
      const deny = () => admin.query(
        `SELECT content_intake.publish_candidate('enabler',$1::jsonb,'null'::jsonb)`,
        [JSON.stringify(request)],
      );
      await admin.query(`UPDATE content_intake.sources SET mode='legacy', mode_version=mode_version+1 WHERE source_id='source-a'`);
      await admin.query('SAVEPOINT gate');
      await expect(deny()).rejects.toMatchObject({ code: 'ZA003', message: 'MODE_CONFLICT' });
      await admin.query('ROLLBACK TO SAVEPOINT gate');
      expect(await pointer()).toBe('rel_native_base');
      await admin.query(`UPDATE content_intake.sources SET mode='v2-preview', mode_version=mode_version+1 WHERE source_id='source-a'`);
      await admin.query(`SELECT set_config('app.publishing','on',true)`);
      await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
        SELECT 'rel_gate_plain', nextval('public.content_release_seq'), '合成无目录基线', 'published', source_binding_hash, tenant_id
        FROM public.content_releases WHERE release_id='rel_native_base'`);
      await admin.query(`INSERT INTO public.release_source_bindings(release_id,domain,source_version_id)
        SELECT 'rel_gate_plain', domain, source_version_id FROM public.release_source_bindings WHERE release_id='rel_native_base'`);
      await admin.query(`UPDATE public.content_current SET current_release_id='rel_gate_plain' WHERE id=1`);
      await admin.query(`INSERT INTO content_intake.candidate_versions(
        candidate_id, version, source_id, scope_id, source_version, object_id, file_sha256, actor_id, base_release_id,
        canonical_encoding, canonical_material, material, risk, explicit_disable_count, created_at, updated_at, publication_policy)
        SELECT 'gate-plain', 1, 'source-a', 'scope-a', 1, 'gate-object', repeat('a',64), 'enabler', 'rel_gate_plain',
          'candidate-p1.1', material::text, material, 'routine', 0, clock_timestamp(), clock_timestamp(), 'direct-v1'
        FROM (
          SELECT jsonb_build_object(
            'canonicalEncodingVersion', 'candidate-p1.1',
            'scope', jsonb_build_object('tenantId', s.tenant_id, 'appId', s.app_id, 'brandId', s.brand_id,
              'shopId', s.shop_id, 'domain', s.domain, 'sourceId', 'source-a'),
            'object', jsonb_build_object('objectId', 'gate-object', 'sha256', repeat('a',64)),
            'sourceClaim', jsonb_build_object('fileSha256', repeat('a',64)),
            'contributors', jsonb_build_array('enabler'),
            'baseReleaseId', 'rel_gate_plain',
            'risk', jsonb_build_object('level', 'routine', 'explicitDisableCount', 0),
            'entries', '[]'::jsonb
          ) AS material
          FROM content_intake.scopes s WHERE s.scope_id='scope-a'
        ) built`);
      const plainDigest = (await admin.query<{ digest: string }>(
        `SELECT digest FROM content_intake.candidate_versions WHERE candidate_id='gate-plain' AND version=1`,
      )).rows[0]!.digest;
      expect(await pointer()).toBe('rel_gate_plain');
      await admin.query('SAVEPOINT gate');
      await expect(admin.query(
        `SELECT content_intake.publish_candidate('enabler',$1::jsonb,'null'::jsonb)`,
        [JSON.stringify({ ...request, operationId: 'gate-plain', baseReleaseId: 'rel_gate_plain', key: { candidateId: 'gate-plain', version: 1, digest: plainDigest } })],
      )).rejects.toMatchObject({ code: 'ZA003', message: 'MODE_CONFLICT' });
      await admin.query('ROLLBACK TO SAVEPOINT gate');
      expect(await pointer()).toBe('rel_gate_plain');
      expect((await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM content_intake.publications')).rows[0]!.n).toBe(0);
      expect((await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM content_intake.release_catalogs WHERE release_id='rel_gate_plain'`,
      )).rows[0]!.n).toBe(0);
    } finally {
      await admin.query('ROLLBACK');
    }
    expect(await pointer()).toBe('rel_native_base');
    expect((await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM content_intake.release_catalogs')).rows[0]!.n).toBe(catalogsBefore);
    expect((await admin.query<{ mode: string }>(`SELECT mode FROM content_intake.sources WHERE source_id='source-a'`)).rows[0]!.mode).toBe('v2-preview');
  }, 30_000);
});
