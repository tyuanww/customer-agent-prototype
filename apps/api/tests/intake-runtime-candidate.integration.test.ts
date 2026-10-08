import path from 'node:path';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createTemplate } from '@customer-agent/content-intake';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { installIntakeRuntimeCandidate } from './support/intake-runtime-candidate.js';
import type { IntakeResult } from '../src/content-intake/transaction.js';
function value<T>(result: IntakeResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result)); return result.value; }

it.skipIf(process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION !== '1')('candidate install pins actual overlay ledger and LOGIN capability guards block cross-purpose and forged cancellation outcomes', async () => {
  const pg = new Pg15Harness(); pg.start();
  const db = pg.createDatabase('candidate_boundary');
  const admin = await pg.connect(db.config), owner = new Pool({ ...db.config, max: 1 });
  let login: Awaited<ReturnType<Pg15Harness['connect']>> | undefined;
  try {
    await applyDatabaseMigrations(admin); await seedIntakeSyntheticHost(admin);
    await admin.query('BEGIN');
    await admin.query("UPDATE customer_agent_meta.schema_migrations SET migration_sha256=repeat('0',64) WHERE position=1");
    await expect(installIntakeRuntimeCandidate(admin)).rejects.toThrow('CANDIDATE_INSTALLED_OVERLAY_DRIFT');
    await admin.query('ROLLBACK');
    expect((await admin.query("SELECT to_regnamespace('intake_runtime') AS n")).rows[0].n).toBeNull();
    await installIntakeRuntimeCandidate(admin);
    await admin.query('CREATE ROLE synthetic_guard LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT intake_business TO synthetic_guard');
    login = await pg.connect({ ...db.config, user: 'synthetic_guard' });
    await expect(login.query("SELECT intake_runtime.assert_purpose('business')")).rejects.toMatchObject({ code: '42501' });
    await login.query('SET ROLE intake_business');
    await login.query("SELECT intake_runtime.assert_purpose('business')");
    expect((await login.query('SELECT session_user,current_user')).rows[0]).toEqual({ session_user: 'synthetic_guard', current_user: 'intake_business' });
    await expect(login.query("SELECT intake_runtime.assert_purpose('usage')")).rejects.toMatchObject({ code: '42501' });
    for (const role of ['intake_runtime_fn_owner', 'intake_usage']) await expect(login.query(`SET ROLE ${role}`)).rejects.toMatchObject({ code: '42501' });
    await admin.query('ALTER ROLE synthetic_guard REPLICATION');
    await expect(login.query("SELECT intake_runtime.assert_purpose('business')")).rejects.toMatchObject({ code: '42501' });
    await admin.query('ALTER ROLE synthetic_guard NOREPLICATION; GRANT intake_usage TO synthetic_guard');
    await expect(login.query("SELECT intake_runtime.assert_purpose('business')")).rejects.toMatchObject({ code: '42501' });
    await admin.query('REVOKE intake_usage FROM synthetic_guard');
    await login.query("SELECT intake_runtime.assert_purpose('business')");
    for (const sql of ["UPDATE backend_identity.subject_bindings SET enabled=true", "UPDATE backend_identity.sessions SET revoked_at=NULL", "UPDATE content_intake.principal_facts SET enabled=true", 'CREATE TABLE public.forbidden(id integer)']) await expect(login.query(sql)).rejects.toMatchObject({ code: '42501' });
    // Parse one real candidate; do not bypass its foreign keys with invented material.
    const service = createContentIntakeService(owner, createContentObjectStore(path.join(pg.root, 'objects')));
    const actor = { user_id: 'user-enabler', role: 'owner' as const, auth_mode: 'mock' as const };
    const bytes = await createTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' }, [['faq-guard', '合成边界问题', '合成回答', '', '', '', '', '启用', '', '', '', '', '', '', 'false']]);
    const form = new FormData(); form.set('operationId', 'guard-upload'); form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic.xlsx');
    const request = new Request('http://127.0.0.1/', { method: 'POST', body: form });
    const object = value(await service.upload(actor, 'source-a', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const job = value(await service.receive(actor, 'source-a', { operationId: 'guard-receive', objectId: object.objectId, sourceVersion: 1, baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    const candidate = value(await service.parse(actor, job.jobId));
    const insert = `INSERT INTO content_intake.write_attempts(actor_id,operation_id,action,candidate_id,candidate_version,candidate_digest,payload_digest,state,created_at,publication_policy) VALUES ('enabler',$1,$2,$3,$4,$5,repeat('a',64),$6,clock_timestamp(),'direct-v1')`;
    const params = (id: string, action: string, state: string) => [id, action, candidate.key.candidateId, candidate.key.version, candidate.key.digest, state];
    for (const action of ['publish', 'rollback']) await expect(login.query(insert, params(`forged-${action}`, action, 'pending'))).rejects.toMatchObject({ code: '42501', message: 'BUSINESS_CANCEL_ATTEMPT_ONLY' });
    await expect(login.query(insert, params('forged-state', 'cancel', 'published'))).rejects.toMatchObject({ code: '42501' });
    await login.query(insert, params('legitimate-cancel', 'cancel', 'pending'));
    await expect(login.query("UPDATE content_intake.write_attempts SET state='published' WHERE operation_id='legitimate-cancel'")).rejects.toMatchObject({ code: '42501' });
    await login.query("UPDATE content_intake.write_attempts SET state='cancelled' WHERE operation_id='legitimate-cancel'");
    await expect(login.query("UPDATE content_intake.write_attempts SET state='pending' WHERE operation_id='legitimate-cancel'")).rejects.toMatchObject({ code: '42501' });
  } finally { await login?.end(); await owner.end(); await admin.end(); pg.stop(); }
}, 60_000);
