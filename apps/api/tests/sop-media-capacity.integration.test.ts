import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Client, type PoolConfig } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, verifyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSyntheticSopWorkbook } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../src/auth-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createIntakeTransactions, type IntakePool, type IntakeResult } from '../src/content-intake/transaction.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { mediaObjectId } from '../src/content-intake/linked-preview.js';
import { createSopMediaLifecycle, attachmentDescriptor } from '../experiments/sop-row-deletion/media-lifecycle.js';
import { createTrustedSopStage } from '../experiments/sop-row-deletion/trusted-stage.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actor = (id = 'enabler'): AuthenticatedUser => ({ user_id: `user-${id}`, role: 'owner', auth_mode: 'mock' });
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const report = (_id: string, _error: unknown) => undefined;
type Reservation = { objectId: string; mediaObjectId: string; sourceId: string; sha256: string; bytes: number;
  mime: 'image/png'; state: 'reserved' | 'persisted' | 'adopted' | 'releasing' | 'released' };
function value<T>(result: IntakeResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

describe.skipIf(!enabled)('Versioned SOP media capacity and purpose boundaries on real PG15', () => {
  let pg: Pg15Harness, admin: Client, business: IntakePurposePool, config: PoolConfig;
  let store: ReturnType<typeof createContentObjectStore>, service: ReturnType<typeof createContentIntakeService>;
  let lifecycle: ReturnType<typeof createSopMediaLifecycle>, png: Buffer, jobId: string;
  beforeEach(async () => {
    pg = new Pg15Harness(); pg.start(); const db = pg.createDatabase('sop_media_capacity'); config = db.config;
    admin = await pg.connect(db.config); await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin, 'product', 'xlsx', true);
    expect(await verifyDatabaseMigrations(admin)).toMatchObject({ status: 'PASS', migrationCount: 52 });
    await admin.query(`CREATE ROLE capacity_business LOGIN NOINHERIT; GRANT intake_business TO capacity_business;
      CREATE ROLE capacity_usage LOGIN NOINHERIT; GRANT intake_usage TO capacity_usage;
      CREATE ROLE capacity_worker LOGIN NOINHERIT; GRANT intake_worker TO capacity_worker;
      CREATE ROLE capacity_org LOGIN NOINHERIT; GRANT intake_org_writer TO capacity_org`);
    business = createIntakePurposePool({ ...db.config, user: 'capacity_business', max: 4 }, 'business');
    store = createContentObjectStore(path.join(pg.root, 'objects'));
    service = createContentIntakeService(business, store, report);
    lifecycle = createSopMediaLifecycle(createIntakeTransactions(business, report), store);
    const workbook = await createSyntheticSopWorkbook(); png = workbook.png;
    const form = new FormData(); form.set('operationId', 'capacity-upload');
    form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await service.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const job = value(await service.receive(actor(), 'source-sop', { operationId: 'capacity-receive', objectId: object.objectId,
      sourceVersion: 1, baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    jobId = job.jobId;
  }, 60_000);
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of [() => business?.end(), () => admin?.end(), () => pg?.stop()]) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Capacity fixture cleanup failed');
  });
  const reserveSql = 'SELECT content_intake.reserve_sop_media_payload($1,$2,$3,$4,$5,$6) AS value';
  const args = (bytes: Buffer) => ['enabler', jobId, mediaObjectId('source-sop', bytes), sha(bytes), bytes.length, 'image/png'];
  async function reserve(bytes = png): Promise<Reservation> {
    const client = await business.connect();
    try { return (await client.query(reserveSql, args(bytes))).rows[0].value; } finally { client.release(); }
  }
  async function charged() {
    return Number((await admin.query(`SELECT coalesce((SELECT sum(bytes) FROM content_intake.objects WHERE tenant_id='tenant-a'),0)
      +coalesce((SELECT sum(reserved_bytes) FROM content_intake.object_reservations WHERE tenant_id='tenant-a' AND state IN ('reserved','persisted','releasing')),0) AS bytes`)).rows[0].bytes);
  }
  async function fillLeaving(bytes: number) {
    const filler = 1073741824 - await charged() - bytes; expect(filler).toBeGreaterThan(0);
    await admin.query(`INSERT INTO content_intake.object_reservations(object_id,tenant_id,app_id,actor_id,source_id,purpose,reserved_bytes,state)
      VALUES($1,'tenant-a','app-a','enabler','source-sop','sop-media',$2,'reserved')`, [`obj_${'e'.repeat(64)}`, filler]);
  }
  async function revokeImport() {
    await admin.query(`UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE grant_id='business-enabler-import-sop'`);
  }
  const filename = (r: Reservation) => path.join(store.rootDirectory, 'objects', r.objectId);

  it('business executes all four capabilities; usage, worker and organization get 42501', async () => {
    const persisted = value(await lifecycle.persist(actor(), jobId, 'source-sop', png, 'image/png')) as Reservation;
    expect(persisted.state).toBe('persisted'); expect(await store.readAttachment(attachmentDescriptor(persisted))).toEqual(png);
    for (const [login, role] of [['capacity_usage', 'intake_usage'], ['capacity_worker', 'intake_worker'], ['capacity_org', 'intake_org_writer']]) {
      const client = new Client({ ...config, user: login }); await client.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        await expect(client.query(reserveSql, args(png))).rejects.toMatchObject({ code: '42501' });
        for (const name of ['complete_sop_media_payload', 'begin_sop_media_release', 'complete_sop_media_release']) {
          await expect(client.query(`SELECT content_intake.${name}($1,$2,$3,$4)`, ['enabler', jobId, persisted.mediaObjectId, persisted.objectId])).rejects.toMatchObject({ code: '42501' });
        }
      } finally { await client.end(); }
    }
    expect(value(await lifecycle.release(actor(), jobId, persisted)).state).toBe('released');
    expect(existsSync(filename(persisted))).toBe(false);
  }, 60_000);

  it('rejects another actor and another tenant without allocating a payload', async () => {
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO backend_identity.subject_bindings VALUES('capacity-other','synthetic','tenant-other','capacity-other','user-capacity-other',repeat('a',64),true,'owner');
      INSERT INTO content_intake.principals VALUES('capacity-other','user-capacity-other','tenant-other','app-a','confirmed-synthetic','capacity-other',1,0);
      INSERT INTO content_intake.principal_facts VALUES('capacity-other',1,ARRAY['dept-a'],'job-lead',true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '200 seconds',repeat('a',64));
      INSERT INTO content_intake.role_rules VALUES('tenant-other','app-a','dept-a','job-lead',1,'lead')`);
    await admin.query('COMMIT');
    for (const id of ['reviewer', 'capacity-other']) expect(await lifecycle.persist(actor(id), jobId, 'source-sop', png, 'image/png'))
      .toMatchObject({ ok: false, reason: 'SCOPE_DENIED', commit: 'rolled_back' });
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_payload_bindings')).rows[0].n).toBe(0);
  }, 60_000);

  it('allows exactly full quota and stable replay, rejects the next byte', async () => {
    await fillLeaving(png.length); const first = await reserve(); expect(await charged()).toBe(1073741824);
    expect((await reserve()).objectId).toBe(first.objectId); expect(await charged()).toBe(1073741824);
    await expect(reserve(Buffer.from([1]))).rejects.toMatchObject({ code: 'ZA003', message: 'QUOTA_EXCEEDED' });
    expect(await lifecycle.persist(actor(), jobId, 'source-sop', Buffer.from([1]), 'image/png'))
      .toMatchObject({ ok: false, code: 'RATE_LIMITED', reason: 'QUOTA_EXCEEDED', commit: 'rolled_back' });
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_payload_bindings')).rows[0].n).toBe(1);
  }, 60_000);

  it('serializes two actual reservation transactions before rejecting over-quota contender', async () => {
    await fillLeaving(png.length); const other = Buffer.from(png); other[other.length - 1] = other[other.length - 1]! ^ 1;
    const first = await business.connect(), second = await business.connect();
    try {
      await first.query('BEGIN'); await first.query(reserveSql, args(png));
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const denied = expect(second.query(reserveSql, args(other))).rejects.toMatchObject({ code: 'ZA003', message: 'QUOTA_EXCEEDED' });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await admin.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); await first.query('COMMIT'); await denied;
      expect(await charged()).toBe(1073741824);
      expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_payload_bindings')).rows[0].n).toBe(1);
    } finally { await first.query('ROLLBACK'); first.release(); second.release(); }
  }, 60_000);

  it('recovers the same reservation after an actual COMMIT with lost acknowledgment', async () => {
    const before = await charged(); let lost = false;
    const uncertain: IntakePool = { async connect() {
      const client = await business.connect();
      return new Proxy(client, { get(target, property) {
        if (property === 'query') return async (sql: string, parameters?: unknown[]) => {
          const result = await target.query(sql, parameters);
          if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('synthetic lost COMMIT acknowledgment'); }
          return result;
        };
        const member = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
      } });
    } };
    const first = await createSopMediaLifecycle(createIntakeTransactions(uncertain, report), store).persist(actor(), jobId, 'source-sop', png, 'image/png');
    expect(first).toMatchObject({ ok: false, commit: 'unknown', reason: 'COMMIT_UNKNOWN' });
    const id = (await admin.query('SELECT object_id FROM content_intake.sop_payload_bindings')).rows[0].object_id;
    const recovered = value(await lifecycle.persist(actor(), jobId, 'source-sop', png, 'image/png'));
    expect(recovered).toMatchObject({ objectId: id, state: 'persisted' }); expect(await charged()).toBe(before + png.length);
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_payload_bindings')).rows[0].n).toBe(1);
  }, 60_000);

  it('releases reservation on a real attachment validation failure', async () => {
    const before = await charged();
    await expect(lifecycle.persist(actor(), jobId, 'source-sop', Buffer.from('not a png'), 'image/png')).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
    expect((await admin.query(`SELECT state FROM content_intake.object_reservations WHERE purpose='sop-media'`)).rows.map(r => r.state)).toEqual(['released']);
    expect(await charged()).toBe(before);
  }, 60_000);

  it('allows own unadopted cleanup after import revocation, denies another actor', async () => {
    const persisted = value(await lifecycle.persist(actor(), jobId, 'source-sop', png, 'image/png')) as Reservation; await revokeImport();
    expect(await lifecycle.release(actor('reviewer'), jobId, persisted)).toMatchObject({ ok: false, reason: 'SCOPE_DENIED', commit: 'rolled_back' });
    expect(existsSync(filename(persisted))).toBe(true);
    expect(value(await lifecycle.release(actor(), jobId, persisted)).state).toBe('released'); expect(existsSync(filename(persisted))).toBe(false);
  }, 60_000);

  it('never removes adopted bytes even after import revocation', async () => {
    value(await createTrustedSopStage(business, store, false)(actor(), jobId));
    const adopted = await reserve(); expect(adopted.state).toBe('adopted'); await revokeImport();
    expect(value(await lifecycle.release(actor(), jobId, adopted)).state).toBe('adopted');
    expect(await store.readAttachment(attachmentDescriptor(adopted))).toEqual(png);
    expect((await admin.query(`SELECT count(*)::int n FROM content_intake.objects WHERE purpose='sop-media'`)).rows[0].n).toBe(1);
  }, 60_000);

  it.each(['reserve', 'complete'] as const)('rolls back %s when actual import grant expires after SQL and before COMMIT', async phase => {
    await revokeImport();
    await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
      to_jsonb(g)||jsonb_build_object('grant_id','capacity-short-grant','version',1,'last_change_reason',NULL,'revoked_at',NULL,
        'expires_at',clock_timestamp()+interval '700 milliseconds'))).*
      FROM content_intake.grants g WHERE grant_id='business-enabler-import-sop'`);
    let delayed = false;
    const commits: string[][] = [];
    const gated: IntakePool = { async connect() {
      const client = await business.connect();
      return new Proxy(client, { get(target, property) {
        if (property === 'query') return async (sql: string, parameters?: unknown[]) => {
          const result = await target.query(sql, parameters);
          if (!delayed && sql.startsWith(`SELECT content_intake.${phase}_sop_media_payload(`)) {
            delayed = true;
            // Real clock progression after the actual function returned. Neither
            // its result nor authorization reads are replaced by a test double.
            await admin.query(`SELECT pg_sleep(greatest(0,extract(epoch FROM expires_at-clock_timestamp()))+0.05)
              FROM content_intake.grants WHERE grant_id='capacity-short-grant'`);
            expect((await admin.query(`SELECT expires_at<=clock_timestamp() expired FROM content_intake.grants
              WHERE grant_id='capacity-short-grant'`)).rows[0].expired).toBe(true);
          }
          if (sql === 'COMMIT' && delayed) commits.push((await admin.query(`SELECT state FROM content_intake.object_reservations
            WHERE purpose='sop-media' ORDER BY object_id`)).rows.map(r => r.state));
          return result;
        };
        const member = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
      } });
    } };
    const result = await createSopMediaLifecycle(createIntakeTransactions(gated, report), store)
      .persist(actor(), jobId, 'source-sop', png, 'image/png');
    expect(delayed).toBe(true);
    expect(result).toMatchObject({ ok: false, commit: 'rolled_back' });
    // Cleanup may commit releasing/released, but the expired operation itself
    // must never durably create a reserved/persisted state.
    expect(commits.flat()).not.toContain(phase === 'reserve' ? 'reserved' : 'persisted');
    const states = (await admin.query(`SELECT state FROM content_intake.object_reservations WHERE purpose='sop-media'`)).rows.map(r => r.state);
    expect(states).toEqual(phase === 'reserve' ? [] : ['released']);
  }, 60_000);

  it('a real terminated DB connection does not let another store bypass the live writer lock', async () => {
    const reservation = await reserve(); const ready = latch(), finish = latch(); const errors: unknown[] = [];
    const writer = new Client({ ...config, user: 'capacity_business' }); writer.on('error', error => errors.push(error)); await writer.connect();
    let pid = 0;
    const writing = store.withObjectLock(reservation.objectId, async locked => {
      await writer.query('SET ROLE intake_business'); await writer.query('BEGIN');
      pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await writer.query('SELECT backend_review.lock_content()'); ready.release(); await finish.promise;
      await locked.persistAttachment(attachmentDescriptor(reservation), png);
    });
    try {
      await ready.promise; expect((await admin.query('SELECT pg_terminate_backend($1) AS killed', [pid])).rows[0].killed).toBe(true);
      const otherStore = createContentObjectStore(store.rootDirectory);
      const cleaner = createSopMediaLifecycle(createIntakeTransactions(business, report), otherStore);
      await expect(cleaner.release(actor(), jobId, reservation)).rejects.toThrow('CONTENT_OBJECT_BUSY');
      expect((await admin.query('SELECT state FROM content_intake.object_reservations WHERE object_id=$1', [reservation.objectId])).rows[0].state).toBe('reserved');
      finish.release(); await writing; expect(errors.length).toBeGreaterThan(0);
      expect(await otherStore.readAttachment(attachmentDescriptor(reservation))).toEqual(png);
      expect(value(await cleaner.release(actor(), jobId, reservation)).state).toBe('released'); expect(existsSync(filename(reservation))).toBe(false);
    } finally { finish.release(); await writing; await writer.end(); }
  }, 60_000);
});
