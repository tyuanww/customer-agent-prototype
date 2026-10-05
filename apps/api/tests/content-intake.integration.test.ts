import path from 'node:path';
import { Pool, type Client, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createTemplate } from '@customer-agent/content-intake';
import type { components } from '@customer-agent/contracts';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import type { IntakeResult } from '../src/content-intake/transaction.js';
import type { AuthenticatedUser } from '../src/auth-service.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actor = (id: string): AuthenticatedUser => ({ user_id: `user-${id}`, role: 'owner', auth_mode: 'mock' });
const scope: C['IntakeScope'] = { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product', sourceId: 'source-a' };
function value<T>(result: IntakeResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe.skipIf(!enabled)('P2 sealed synthetic authority and durable candidates', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let pool: Pool;
  let service: ReturnType<typeof createContentIntakeService>;
  let store: ReturnType<typeof createContentObjectStore>;
  let policyVersion: number;
  const diagnostics: unknown[] = [];

  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('intake');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    pool = new Pool({ ...db.config, max: 4 });
    store = createContentObjectStore(path.join(harness.root, db.name));
    service = createContentIntakeService(pool, store, (_id, error) => diagnostics.push(error));
    diagnostics.length = 0;
    await admin.query('BEGIN');
    for (const [id, role] of [['director','director'], ['manager','manager'], ['supervisor','supervisor'], ['enabler','enabler'], ['other','enabler'], ['agent','agent']] as const) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-a',$1,$2,repeat('a',64),true,'owner')`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principals VALUES ($1,$2,'tenant-a','app-a','confirmed-synthetic',$1,1,0)`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ($1,1,ARRAY['dept-a'],$2,true,
        statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`, [id, `job-${role}`]);
      await admin.query(`INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a',$1,1,$2) ON CONFLICT DO NOTHING`, [`job-${role}`, role]);
    }
    for (const [id, shop] of [['a','shop-a'], ['b','shop-b'], ['brand',null]] as const) {
      await admin.query(`INSERT INTO content_intake.scopes VALUES ($1,'tenant-a','app-a','brand-a',$2,'product')`, [`scope-${id}`, shop]);
      await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,$2,1,'v2-preview')`, [`source-${id}`, `scope-${id}`]);
      await admin.query(`INSERT INTO content_intake.source_mappings VALUES ($1,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`, [`source-${id}`]);
    }
    const actions = ['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'];
    for (const action of actions) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','director','director','tenant-a','app-a','scope-a',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','合成根资格','director')`, [`root-${action}`, action]);
      for (const recipient of ['enabler', 'other', ...(action === 'query' ? ['agent'] : [])]) {
        await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
          VALUES ($1,'business','director',$2,'tenant-a','app-a','scope-a','source-a',$3,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour','合成业务授权','director',$4)`, [`business-${recipient}-${action}`, recipient, action, `root-${action}`]);
      }
    }
    await admin.query('COMMIT');
    policyVersion = Number((await admin.query('SELECT version FROM content_intake.policy_versions')).rows[0].version);
  }, 60_000);
  afterEach(async () => { await pool?.end(); await admin?.end(); harness?.stop(); }, 60_000);

  function batch(recipient: string, action: C['IntakeAction'] = 'import', kind: 'business' | 'delegation' = 'business', op = 'batch-one'): C['IntakeGrantBatch'] {
    return { operationId: op, issuerFactsVersion: 1, policyVersion, items: [{ kind, recipientPrincipalId: recipient,
      recipientFactsVersion: 1, action, scope, startsAt: new Date().toISOString(), expiresAt: new Date(Date.now()+600_000).toISOString(), reason: '合成授权' }] };
  }
  async function input(op: string, prior: C['IntakeCandidateKey'] | null = null, rows = [
    ['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','风险提示','','false'],
  ]): Promise<C['IntakeReceive']> {
    const bytes = await createTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' }, rows);
    const obj = await store.persist((async function* () { yield bytes; })(), 'excel');
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES ($1,'source-a','enabler','tenant-a','app-a',$2,$3,$4,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp())`,
    [obj.objectId, `intake/${obj.objectId}`, obj.sha256, obj.sizeBytes]);
    return { operationId: op, objectId: obj.objectId, sourceVersion: 1, baseReleaseId: null,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['other'], confirmed: true }, expectedPriorKey: prior };
  }
  async function candidate(op = 'receive-one') {
    const received = value(await service.receive(actor('enabler'), 'source-a', await input(op)));
    const parsed = await service.parse(actor('enabler'), received.jobId);
    if (!parsed.ok) throw new Error(JSON.stringify({ parsed, diagnostics, report: await service.job(actor('enabler'), received.jobId) }));
    return value(parsed);
  }

  it('ignores the login owner label; enabler needs an exact shop/source business grant', async () => {
    value(await service.authorization(actor('enabler'), 'source-a', 'import'));
    expect(await service.authorization(actor('agent'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    value(await service.authorization(actor('agent'), 'source-a', 'query'));
    expect(await service.authorization(actor('director'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    for (const id of ['source-b','source-brand','missing']) expect(await service.authorization(actor('enabler'), id, 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a','job-enabler',1,'agent') ON CONFLICT (tenant_id,app_id,department_id,job_id) DO UPDATE SET role='agent'");
    expect(await service.authorization(actor('enabler'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-enabler'");
    expect(await service.authorization(actor('enabler'), 'source-a', 'query')).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    const acl = await admin.query("SELECT has_schema_privilege('app_content_admin','content_intake','USAGE') AS allowed");
    expect(acl.rows[0].allowed).toBe(false);
  });

  it('commits multi-action batches atomically; rejects self, agent writes, wider scope, stale policy and redelegation', async () => {
    const good = batch('manager');
    const atomic = { ...good, items: [...good.items, { ...good.items[0]!, recipientPrincipalId: 'agent' }] };
    expect(await service.grantBatch(actor('director'), atomic)).toMatchObject({ ok: false, reason: 'ROLE_CEILING' });
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('0');
    expect(await service.grantBatch(actor('director'), batch('director'))).toMatchObject({ ok: false, reason: 'SELF_ESCALATION' });
    expect(await service.grantBatch(actor('director'), { ...good, policyVersion: 999 })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect(await service.grantBatch(actor('director'), { ...good, items: [{ ...good.items[0]!, scope: { ...scope, shopId: 'shop-b' } }] })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const delegation = value(await service.grantBatch(actor('director'), batch('enabler', 'import', 'delegation'))).items[0]!;
    const delegated = batch('manager', 'import', 'business', 'delegated');
    delegated.items[0]!.expiresAt = new Date(Date.parse(delegation.expiresAt)-1000).toISOString();
    value(await service.grantBatch(actor('enabler'), delegated));
    expect(await service.grantBatch(actor('enabler'), batch('manager','import','delegation','again'))).toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
    const revoked = value(await service.changeGrant(actor('director'), delegation.grantId,
      { operationId: 'revoke', expectedVersion: 1, change: 'revoke', stewardPrincipalId: null, reason: '合成撤资格' }));
    expect(revoked.version).toBe(2);
    const child = (await admin.query("SELECT * FROM content_intake.grants WHERE parent_grant_id=$1", [delegation.grantId])).rows[0];
    expect(child).toMatchObject({ issuer_id: 'enabler', revoked_at: null, steward_id: null, version: '2', reason: '合成授权', last_change_reason: '合成撤资格' });
    value(await service.authorization(actor('manager'), 'source-a', 'import'));
    expect(await service.grantBatch(actor('enabler'), { ...delegated, operationId: 'after-revocation' })).toMatchObject({ ok: false, reason: 'GRANT_AUTHORITY_DENIED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.grant_history WHERE grant_id=$1', [child.grant_id])).rows[0].count).toBe('2');
    // Delegation is independent of the recipient's own business ceiling (§12.1).
    const agentDelegation = value(await service.grantBatch(actor('director'), batch('agent', 'import', 'delegation', 'agent-allocator'))).items[0]!;
    const byAgent = batch('manager', 'import', 'business', 'agent-distributes');
    byAgent.items[0]!.expiresAt = new Date(Date.parse(agentDelegation.expiresAt)-1000).toISOString();
    value(await service.grantBatch(actor('agent'), byAgent));
    expect(await service.authorization(actor('agent'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.grantBatch(actor('agent'), batch('other', 'import', 'delegation', 'agent-redelegates')))
      .toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
  });

  it('recovers lost COMMIT responses using the original durable operation and rejects payload changes', async () => {
    let injected = false;
    const uncertainPool = { async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql === 'COMMIT' && !injected) { injected = true; throw new Error('synthetic lost response after commit'); }
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const uncertain = createContentIntakeService(uncertainPool, store);
    const req = batch('manager');
    expect(await uncertain.grantBatch(actor('director'), req)).toMatchObject({ ok: false, commit: 'unknown' });
    const replay = value(await service.grantBatch(actor('director'), req));
    expect(replay.items).toHaveLength(1);
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('1');
    expect(await service.grantBatch(actor('director'), { ...req, items: [{ ...req.items[0]!, reason: '变更载荷' }] })).toMatchObject({ ok: false, reason: 'IDEMPOTENCY_CONFLICT' });
  });

  it('keeps permanent operation replay independent of retired HTTP HMAC keys', async () => {
    const req = batch('manager');
    const first = value(await service.grantBatch(actor('director'), req));
    const restarted = createContentIntakeService(pool, store);
    expect(value(await restarted.grantBatch(actor('director'), req))).toEqual(first);
    // No rotating HTTP key is accepted by this permanent-receipt service.
    const receipt = (await admin.query("SELECT request_hash FROM backend_review.receipts WHERE operation='intake:grants'")).rows[0];
    expect(receipt.request_hash).toMatch(/^intake-request-v1:[a-f0-9]{64}$/);
  });

  it('rejects admission when its business grant expires after authorization but before commit', async () => {
    const req = await input('expiry-during-admission');
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成短时授权取代' WHERE grant_id='business-enabler-import'");
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES ('short-import','business','director','enabler','tenant-a','app-a','scope-a','source-a','import',clock_timestamp()-interval '1 second',clock_timestamp()+interval '0.2 seconds','合成短时授权','director','root-import')`);
    const delayed = { async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql.includes('AS actor_jobs')) await target.query('SELECT pg_sleep(0.25)');
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    expect(await createContentIntakeService(delayed, store).receive(actor('enabler'), 'source-a', req))
      .toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.parse_jobs')).rows[0].count).toBe('0');
  });

  it('allows a newly qualified supervisor to take over and revoke existing business grants', async () => {
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('new-supervisor','allocation','director','supervisor','tenant-a','app-a','scope-a','source-a','import',clock_timestamp()-interval '1 second',clock_timestamp()+interval '10 minutes','合成新任范围负责人','director')`);
    const takeover = { operationId: 'new-steward', expectedVersion: 1, change: 'takeover' as const, stewardPrincipalId: 'supervisor', reason: '合成接管' };
    const changed = value(await service.changeGrant(actor('supervisor'), 'business-enabler-import', takeover));
    expect(changed).toMatchObject({ issuerPrincipalId: 'director', stewardPrincipalId: 'supervisor', version: 2, revokedAt: null });
    value(await service.authorization(actor('enabler'), 'source-a', 'import'));
    value(await service.changeGrant(actor('supervisor'), changed.grantId, { ...takeover, operationId: 'new-steward-revoke', expectedVersion: 2, change: 'revoke', stewardPrincipalId: null }));
    expect(await service.authorization(actor('enabler'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('fences legacy publication while admitting against an empty current pointer', async () => {
    const req = await input('legacy-base-race');
    let reached!: () => void;
    const atBase = new Promise<void>(resolve => { reached = resolve; });
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const delayed = { async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql.startsWith('SELECT current_release_id')) { reached(); await gate; }
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const pending = createContentIntakeService(delayed, store).receive(actor('enabler'), 'source-a', req);
    await atBase;
    let acquired: boolean;
    try {
      await admin.query('BEGIN');
      acquired = (await admin.query("SELECT pg_try_advisory_xact_lock(hashtext('cs_ai_content_publish')) AS acquired")).rows[0].acquired;
    } finally { await admin.query('ROLLBACK'); resume(); }
    value(await pending);
    expect(acquired).toBe(false);
  });

  it('parses an actual stored workbook, freezes contributors/material, and supports another authorized manager', async () => {
    const c = await candidate();
    expect(c.state).toBe('awaiting-evidence');
    expect(c.key.version).toBe(1);
    expect(c.readinessReasons).toContain('AWAITING_APPROVAL');
    value(await service.candidate(actor('other'), c.key.candidateId, 1));
    expect(await service.candidate(actor('agent'), c.key.candidateId, 1)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const persisted = (await admin.query('SELECT * FROM content_intake.candidate_versions WHERE candidate_id=$1', [c.key.candidateId])).rows[0];
    expect(persisted.digest).toBe(c.key.digest);
    expect(persisted.material.contributors).toEqual(['enabler','other']);
    expect(persisted.material.entries[0].answerText).toBe('第一行。\n第二行。');
    expect(persisted.material.entries[0].internalNote).toBe('内部说明');
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.import_batches')).rows[0].count).toBe('0');
  });

  it('keeps the old candidate on bad input and durably reopens the actual error report', async () => {
    const c = await candidate();
    const req = await input('bad-revision', c.key, [['bad','标题','','','','','','启用','','','','','','','false']]);
    const j = value(await service.receive(actor('enabler'), 'source-a', req));
    expect(await service.parse(actor('enabler'), j.jobId)).toMatchObject({ ok: false, reason: 'FILE_INVALID' });
    const report = value(await service.job(actor('other'), j.jobId));
    expect(report.state).toBe('failed');
    expect(report.reportObjectId).not.toBeNull();
    expect(report.issues.some(i => i.location.sheet === 'FAQ' && i.location.row === 2 && i.location.column === 3)).toBe(true);
    const original = value(await service.candidate(actor('enabler'), c.key.candidateId, 1));
    expect(original.state).toBe('awaiting-evidence');
    expect(original.key.digest).toBe(c.key.digest);
  });

  it('serializes two revisions against one key and prevents cancelled material from reviving', async () => {
    const c = await candidate();
    const a = value(await service.receive(actor('enabler'), 'source-a', await input('revision-a', c.key)));
    const b = value(await service.receive(actor('enabler'), 'source-a', await input('revision-b', c.key)));
    const otherService = createContentIntakeService(pool, store);
    const results = await Promise.all([service.parse(actor('enabler'), a.jobId), otherService.parse(actor('enabler'), b.jobId)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    const next = value(results.find(r => r.ok)!);
    expect(next.key.version).toBe(2);
    expect(value(await service.candidate(actor('enabler'), c.key.candidateId, 1)).state).toBe('invalidated');
    const cancel = { operationId: 'cancel-one', key: next.key };
    expect(value(await service.cancel(actor('other'), cancel)).state).toBe('cancelled');
    expect(value(await service.cancel(actor('other'), cancel)).state).toBe('cancelled');
    expect(await service.receive(actor('enabler'), 'source-a', await input('after-cancel', next.key))).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED' });
    expect((await admin.query("SELECT count(*) FROM content_intake.write_attempts WHERE action='cancel'")).rows[0].count).toBe('1');
  });

  it('reserves quotas atomically and records parser cancellation without a candidate', async () => {
    const reqs: C['IntakeReceive'][] = [];
    for (let i = 0; i < 11; i++) reqs.push(await input(`quota-${i}`));
    const results = await Promise.all(reqs.map(req => service.receive(actor('enabler'), 'source-a', req)));
    expect(results.filter(r => r.ok)).toHaveLength(10);
    expect(results.find(r => !r.ok)).toMatchObject({ ok: false, reason: 'QUOTA_EXCEEDED' });
    const j = value(results.find(r => r.ok)!);
    const abort = new AbortController(); abort.abort();
    expect(await service.parse(actor('enabler'), j.jobId, abort.signal)).toMatchObject({ ok: false });
    expect(value(await service.job(actor('enabler'), j.jobId)).state).toBe('cancelled');
    expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('0');
  });

  it('rechecks revocation after waiting on the same content lock', async () => {
    await admin.query('BEGIN');
    await admin.query('SELECT backend_review.lock_content()');
    const request = service.authorization(actor('enabler'), 'source-a', 'import');
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE grant_id='business-enabler-import'");
    await admin.query('COMMIT');
    expect(await request).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('resumes a durable parsing job after restart and replays its successful result', async () => {
    const j = value(await service.receive(actor('enabler'), 'source-a', await input('restart')));
    await admin.query("UPDATE content_intake.parse_jobs SET state='parsing' WHERE job_id=$1", [j.jobId]);
    const restarted = createContentIntakeService(pool, store);
    const c = value(await restarted.parse(actor('enabler'), j.jobId));
    const replay = value(await restarted.parse(actor('enabler'), j.jobId));
    expect(replay.key).toEqual(c.key);
    expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('1');
  });

  it('cannot freeze after import permission is revoked during object I/O, and releases the failed job slot', async () => {
    const j = value(await service.receive(actor('enabler'), 'source-a', await input('revoke-during-parse')));
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const slow = createContentIntakeService(pool, { ...store, async readPayload(id) {
      entered(); await gate; return store.readPayload(id);
    } });
    const pending = slow.parse(actor('enabler'), j.jobId);
    await reading;
    value(await service.changeGrant(actor('director'), 'business-enabler-import',
      { operationId: 'revoke-import', expectedVersion: 1, change: 'revoke', stewardPrincipalId: null, reason: '合成撤权竞争' }));
    resume();
    expect(await pending).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await admin.query('SELECT state FROM content_intake.parse_jobs WHERE job_id=$1', [j.jobId])).rows[0].state).toBe('failed');
    expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('0');
  });

  it('refuses expiry while queued and unknown wire fields without persisting mutations', async () => {
    expect(await service.grantBatch(actor('director'), { ...batch('manager'), actorPrincipalId: 'director' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    await admin.query('BEGIN');
    await admin.query('SELECT backend_review.lock_content()');
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('enabler',2,ARRAY['dept-a'],'job-enabler',true,
      statement_timestamp()-interval '10 seconds',statement_timestamp()+interval '0.2 seconds',repeat('b',64))`);
    await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='enabler'");
    const waiting = service.authorization(actor('enabler'), 'source-a', 'import');
    await admin.query('SELECT pg_sleep(0.25)');
    await admin.query('COMMIT');
    expect(await waiting).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('0');
  });
});
