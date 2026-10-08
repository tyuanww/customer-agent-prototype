import { createIntakeCapacity, intakeCapacityDryRun, INTAKE_TEMPORARY_BYTES } from '../src/content-intake/capacity.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Pool, type Client, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createTemplate } from '@customer-agent/content-intake';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { contentIntakeUsageRoutes } from '../src/content-intake/usage-http.js';
import { contentIntakeManagementRoutes } from '../src/content-intake/management-http.js';
import type { IntakePool, IntakeResult } from '../src/content-intake/transaction.js';
import type { IntakePrincipalLabels } from '../src/content-intake/discovery.js';
import { authenticateRequestHeaders, type AuthenticatedUser, type ProductAuthService } from '../src/auth-service.js';
import { createProductAuthService, authenticatedProductSession } from '../src/product-auth-service.js';
import type { ApiDatabaseBootstrapConfig } from '../src/runtime-config.js';
import { createApprovalAdapter, type ApprovalTransport } from '../src/content-intake/approval-adapter.js';
import { syntheticApproval } from './support/intake-approval.js';
import { canonical, digest } from '../src/content-intake/material.js';
import { seedSyntheticG1aRelease } from './support/synthetic-g1a.js';
import type { IntakeQualityPreview, IntakeQualityProgress, QualityCheck } from '../src/content-intake/quality.js';

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
  let auth: ProductAuthService | undefined;
  let authConfig: ApiDatabaseBootstrapConfig;
  const seats=new Map<string,{actor:AuthenticatedUser;token:string;expiresAt:string}>();
  async function seat(id='agent',name='primary') {
    const key=`${id}:${name}`;
    const cached=seats.get(key);if(cached)return cached;
    auth ??= await createProductAuthService(authConfig,{
      authorizeUrl:state=>`http://127.0.0.1:45000/authorize?state=${state}`,
      exchange:async code=>code,close:()=>undefined,
    },'mock');
    const verifier='v'.repeat(43);
    const login=await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!,id);
    const session=await auth.exchange(login.login_id,verifier);
    expect(session).not.toBeNull();
    const user=await auth.authenticate({authorization:`Bearer ${session!.access_token}`});
    expect(user).not.toBeNull();
    const value={actor:user!,token:session!.access_token,expiresAt:session!.expires_at};seats.set(key,value);return value;
  }
  const diagnostics: unknown[] = [];
  const principalLabels = new Map<string, string>();
  const label: IntakePrincipalLabels = ({ principalId, tenantId, appId }) =>
    tenantId === 'tenant-a' && appId === 'app-a' ? principalLabels.get(principalId) ?? null : null;
  let provider: ReturnType<typeof syntheticApproval>;
  const route = { tenantId:'tenant-a',appId:'app-a',definitionId:'synthetic-definition',nodeId:'manual-node' };
  function evidenceService(transport: ApprovalTransport = provider.transport) {
    return createContentIntakeService(pool,store,(_id,error) => diagnostics.push(error),createApprovalAdapter(route,transport), { principalLabels: label });
  }

  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('intake');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    pool = new Pool({ ...db.config, max: 4 });
    auth=undefined;seats.clear();
    await admin.query('CREATE ROLE synthetic_intake_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_intake_auth');
    authConfig={connectionString:`postgresql://synthetic_intake_auth@localhost/${db.name}?${new URLSearchParams({host:harness.socket,port:String(harness.port)})}`,
      poolMax:2,connectionTimeoutMs:2000,readinessTimeoutMs:3000};
    store = createContentObjectStore(path.join(harness.root, db.name));
    provider = syntheticApproval();
    service = evidenceService();
    diagnostics.length = 0;
    await admin.query('BEGIN');
    principalLabels.clear();
    for (const [id, role, display] of [['director','director','合成总监'], ['manager','manager','合成经理'], ['supervisor','supervisor','合成主管'],
      // id 是历史夹具名，当前职务角色是 lead。
      ['enabler','lead','合成整理人'], ['other','lead','合成其他贡献人'], ['reviewer','supervisor','合成复核人'], ['agent','agent','合成坐席']] as const) {
      principalLabels.set(id, display);
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-a',$1,$2,repeat('a',64),true,'owner')`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principals VALUES ($1,$2,'tenant-a','app-a','confirmed-synthetic',$1,1,0)`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ($1,1,ARRAY['dept-a'],$2,true,
        statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`, [id, `job-${role}`]);
      await admin.query(`INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a',$1,1,$2) ON CONFLICT DO NOTHING`, [`job-${role}`, role]);
    }
    principalLabels.set('legacy-enabler', '合成历史赋能师');
    await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('legacy-enabler','synthetic','tenant-a','legacy-enabler','user-legacy-enabler',repeat('a',64),true,'owner')`);
    await admin.query(`INSERT INTO content_intake.principals VALUES ('legacy-enabler','user-legacy-enabler','tenant-a','app-a','confirmed-synthetic','legacy-enabler',1,0)`);
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('legacy-enabler',1,ARRAY['dept-a'],'job-enabler',true,
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`);
    await admin.query(`INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a','job-enabler',1,'enabler') ON CONFLICT DO NOTHING`);
    for (const [id, shop] of [['a','shop-a'], ['b','shop-b'], ['brand',null]] as const) {
      await admin.query(`INSERT INTO content_intake.scopes VALUES ($1,'tenant-a','app-a','brand-a',$2,'product')`, [`scope-${id}`, shop]);
      await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,$2,1,'v2-preview')`, [`source-${id}`, `scope-${id}`]);
      await admin.query(`INSERT INTO content_intake.source_mappings VALUES ($1,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`, [`source-${id}`]);
    }
    const actions = ['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'];
    for (const action of actions) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','director','director','tenant-a','app-a','scope-a',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','合成根资格','director')`, [`root-${action}`, action]);
      for (const recipient of ['enabler', 'other', 'reviewer', ...(action === 'query' ? ['agent'] : [])]) {
        await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
          VALUES ($1,'business','director',$2,'tenant-a','app-a','scope-a','source-a',$3,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour','合成业务授权','director',$4)`, [`business-${recipient}-${action}`, recipient, action, `root-${action}`]);
      }
    }
    // Historical rows stay. The enabler ceiling makes import unusable and leaves query usable.
    for (const action of ['import', 'query']) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
        VALUES ($1,'business','director','legacy-enabler','tenant-a','app-a','scope-a','source-a',$2,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour','合成历史授权','director',$3)`,
      [`legacy-enabler-${action}`, action, `root-${action}`]);
    }
    await admin.query('COMMIT');
    policyVersion = Number((await admin.query('SELECT version FROM content_intake.policy_versions')).rows[0].version);
  }, 60_000);
  afterEach(async () => { await auth?.close(); await pool?.end(); await admin?.end(); harness?.stop(); }, 60_000);

  function batch(recipient: string, action: C['IntakeAction'] = 'import', kind: 'business' | 'delegation' = 'business', op = 'batch-one'): C['IntakeGrantBatch'] {
    return { operationId: op, issuerFactsVersion: 1, policyVersion, items: [{ kind, recipientPrincipalId: recipient,
      recipientFactsVersion: 1, action, scope, startsAt: new Date().toISOString(), expiresAt: new Date(Date.now()+600_000).toISOString(), reason: '合成授权' }] };
  }
  async function input(op: string, prior: C['IntakeCandidateKey'] | null = null, rows = [
    ['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','风险提示','','false'],
  ], source = 'a'): Promise<C['IntakeReceive']> {
    const registered = (await admin.query<{ brand_id: string; shop_id: string | null; domain: C['IntakeScope']['domain'] }>(
      'SELECT brand_id,shop_id,domain FROM content_intake.sources JOIN content_intake.scopes USING(scope_id) WHERE source_id=$1', [`source-${source}`])).rows[0]!;
    const bytes = await createTemplate({ sourceId: `source-${source}`, brandId: registered.brand_id, scope: registered.shop_id ?? 'brand', domain: registered.domain, sheet: 'FAQ', templateVersion: 'faq-p1.1' }, rows);
    const obj = await store.persist((async function* () { yield bytes; })(), 'excel');
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES ($1,$5,'enabler','tenant-a','app-a',$2,$3,$4,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp())`,
    [obj.objectId, `intake/${obj.objectId}`, obj.sha256, obj.sizeBytes,`source-${source}`]);
    return { operationId: op, objectId: obj.objectId, sourceVersion: 1, baseReleaseId: null,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['other'], confirmed: true }, expectedPriorKey: prior };
  }
  async function managementHost(customStore = store, hostPool: IntakePool = pool, transport: ApprovalTransport | null = provider.transport,
    labels: IntakePrincipalLabels = label, identity = 'enabler') {
    const logged = await seat(identity);
    const app = Fastify({ routerOptions: { maxParamLength: 128 } });
    app.get('/v1/auth/me', async (request, reply) => (await authenticateRequestHeaders(auth!, request.headers)) ?? reply.code(401).send());
    app.post('/v1/auth/logout', async (request, reply) => {
      const header = request.headers.authorization;
      if (header?.startsWith('Bearer ')) await auth!.logout(header.slice(7));
      return reply.code(204).send();
    });
    await app.register(contentIntakeUsageRoutes, { auth: auth!, usage: service });
    await app.register(contentIntakeManagementRoutes, { auth: auth!, pool: hostPool, store: customStore,
      ...(transport ? { approval: createApprovalAdapter(route, transport) } : {}),
      principalLabels: labels, report: (_id, error) => diagnostics.push(error) });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const headers = { authorization: `Bearer ${logged.token}` };
    async function upload(bytes: Buffer, operationId = 'http-upload', sourceId = 'source-a') {
      const form = new FormData();
      form.set('operationId', operationId);
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '../../synthetic.xlsx');
      return fetch(`${origin}/v1/intake/sources/${sourceId}/objects`, { method: 'POST', headers, body: form });
    }
    async function receive(objectId: string, operationId = 'http-receive', prior: C['IntakeCandidateKey'] | null = null, baseReleaseId: string | null = null) {
      return app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/candidates', headers,
        payload: { operationId, objectId, sourceVersion: 1, baseReleaseId,
          contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['other'], confirmed: true }, expectedPriorKey: prior } });
    }
    async function settled(id: string) {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const response = await app.inject({ url: `/v1/intake/parse-jobs/${id}`, headers });
        expect(response.statusCode, response.body).toBe(200);
        const job = parseContractSchema('IntakeParseJob', response.json());
        if (job.state !== 'reading' && job.state !== 'parsing') return job;
        if (Date.now() >= deadline) throw new Error('HTTP_PARSE_DID_NOT_SETTLE');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    return { app, origin, headers, upload, receive, settled, logged };
  }
  const httpWorkbook = (bodies = ['第一行。\n第二行。', '合成第二条。', '合成第三条。'], critical = false) => createTemplate(
    { sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' },
    bodies.map((body, index) => [`faq-${index}`, `合成问题${index}`, body, '', '', '分类', '', '启用', '', '', '', '合成内部说明', critical ? '合成风险提示' : '', '', 'false']));

  async function httpCandidate(host: Awaited<ReturnType<typeof managementHost>>, label = 'workflow', critical = false) {
    const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook(undefined, critical), `${label}-upload`)).json());
    const baseReleaseId = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0]?.current_release_id ?? null;
    const received = await host.receive(object.objectId, `${label}-receive`, null, baseReleaseId);
    expect(received.statusCode, received.body).toBe(202);
    const job = await host.settled(received.json<C['IntakeParseJob']>().jobId);
    expect(job.state, JSON.stringify(job.issues)).toBe('validated');
    const url = `${host.origin}/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`;
    const c = parseContractSchema('IntakeCandidate', await (await fetch(url, { headers: host.headers })).json());
    const source: C['IntakeSourceConfirmation'] = { operationId: `${label}-source`, key: c.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-export-one', acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成人工来源确认' };
    const publish: C['IntakePublish'] = { operationId: `${label}-publish`, key: c.key, baseReleaseId,
      sourceEvidenceVersion: 1, confirmed: true, title: '合成 HTTP 发布', summary: '三条 FAQ' };
    const post = (suffix: string, body: unknown, headers = host.headers) => fetch(`${url}/${suffix}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { c, url, source, publish, post };
  }
  async function httpConfirm(f: Awaited<ReturnType<typeof httpCandidate>>) {
    const confirmed = await f.post('source-confirmation', f.source);
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    return parseContractSchema('IntakeCandidate', await confirmed.json());
  }
  async function httpQuality(host: Awaited<ReturnType<typeof managementHost>>, c: C['IntakeCandidate']) {
    const headers = { authorization: `Bearer ${(await seat('reviewer')).token}`, 'content-type': 'application/json' };
    const url = `${host.origin}/v1/intake/candidates/${c.key.candidateId}/versions/${c.key.version}/quality`;
    const frozen = await fetch(`${url}/freeze`, { method: 'POST', headers, body: JSON.stringify({ operationId: `quality-${c.key.candidateId}`, key: c.key }) });
    expect(frozen.status, await frozen.clone().text()).toBe(200);
    const status = parseContractSchema('IntakeQualityStatus', await (await fetch(`${url}?digest=${c.key.digest}`, { headers })).json());
    const checks: C['IntakeQualityCheck'][] = [];
    let cursor: string | null = null;
    do {
      const q: URLSearchParams = new URLSearchParams({ digest: c.key.digest, viewHash: status.viewHash, phase: 'initial', limit: '2', ...(cursor ? { cursor } : {}) });
      const page: C['IntakeQualitySamplePage'] = parseContractSchema('IntakeQualitySamplePage', await (await fetch(`${url}/samples?${q}`, { headers })).json());
      checks.push(...page.items.map(i => ({ scriptId: i.scriptId, contentHash: i.contentHash, defect: false, reason: '' })));
      cursor = page.nextCursor;
    } while (cursor);
    const checked = await fetch(`${url}/checks`, { method: 'POST', headers, body: JSON.stringify({ operationId: `checks-${c.key.candidateId}`, key: c.key, phase: 'initial', checks }) });
    expect(checked.status, await checked.clone().text()).toBe(200);
    expect(parseContractSchema('IntakeQualityReceipt', await checked.json()).state).toBe('passed');
  }

  async function qualityWire(host: Awaited<ReturnType<typeof managementHost>>, c: C['IntakeCandidate'], id = 'enabler', session = 'primary') {
    const logged = await seat(id, session), headers = { authorization: `Bearer ${logged.token}`, 'content-type': 'application/json' };
    const url = `/v1/intake/candidates/${c.key.candidateId}/versions/${c.key.version}/quality`;
    const get = (query = `digest=${c.key.digest}`) => host.app.inject({ url: `${url}?${query}`, headers });
    const status = async () => {
      const r = await get(); expect(r.statusCode, r.body).toBe(200); return parseContractSchema('IntakeQualityStatus', r.json());
    };
    const page = (s: C['IntakeQualityStatus'], phase = 'initial', cursor?: string, limit = 2) => host.app.inject({
      url: `${url}/samples?${new URLSearchParams({ digest: c.key.digest, viewHash: s.viewHash, phase, limit: String(limit), ...(cursor ? { cursor } : {}) })}`, headers });
    const samples = async (s: C['IntakeQualityStatus'], phase = 'initial', limit = 100) => {
      const items: C['IntakeQualitySample'][] = []; let cursor: string | undefined;
      do {
        const r = await page(s, phase, cursor, limit); expect(r.statusCode, r.body).toBe(200);
        expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(8_388_608);
        const body: C['IntakeQualitySamplePage'] = parseContractSchema('IntakeQualitySamplePage', r.json());
        items.push(...body.items); cursor = body.nextCursor ?? undefined;
      } while (cursor);
      expect(new Set(items.map(i => i.scriptId)).size).toBe(items.length);
      return items;
    };
    const post = (suffix: 'freeze' | 'checks', payload: unknown, extra: Record<string, string> = {}) => host.app.inject({ method: 'POST', url: `${url}/${suffix}`, headers: { ...headers, ...extra }, payload: JSON.stringify(payload) });
    const receipt = (op: string, action = 'quality-check') => host.app.inject({ url: `/v1/intake/quality/operations/${op}?action=${action}`, headers });
    return { url, headers, logged, get, status, page, samples, post, receipt };
  }
  const wireChecks = (items: C['IntakeQualitySample'][]) => items.map(i => i.check ?? ({ scriptId: i.scriptId, contentHash: i.contentHash, defect: false, reason: '' }));

  it('capacity: serializes tenfold admission before bytes, protects unknown commits, retries cleanup and consumes the dry-run CLI', async () => {
    const cap = createIntakeCapacity(pool, store, error => diagnostics.push(error));
    const filler = `obj_${'f'.repeat(64)}`;
    await admin.query(`INSERT INTO content_intake.object_reservations
      (object_id,tenant_id,app_id,actor_id,source_id,purpose,reserved_bytes,state)
      VALUES($1,'tenant-a','app-a','enabler','source-a','input',$2,'reserved')`, [filler, INTAKE_TEMPORARY_BYTES - 10]);
    for (const contenders of [10, 100]) {
      let consumed = 0;
      const start = performance.now();
      const attempts = await Promise.allSettled(Array.from({length: contenders}, () => cap.persist('user-enabler','source-a','input',
        (async function* () { consumed++; yield Buffer.from('synthetic'); })(), 'csv', 10)));
      const successes = attempts.filter(r => r.status === 'fulfilled');
      expect(successes).toHaveLength(1); expect(consumed).toBe(1);
      for (const rejected of attempts.filter(r => r.status === 'rejected')) expect(rejected.reason).toMatchObject({reason:'QUOTA_EXCEEDED'});
      console.log(JSON.stringify({probe:'capacity-admission',contenders,adoptable:successes.length,elapsedMs:performance.now()-start}));
      await cap.discard(successes[0]!.value.objectId);
    }
    await admin.query('DELETE FROM content_intake.object_reservations WHERE object_id=$1',[filler]); // synthetic fixture only
    for (const phase of ['admission','persisted'] as const) {
      let injected = false;
      const uncertain: IntakePool = {async connect() {
        const client = await pool.connect(); let target = false;
        return new Proxy(client,{get(c,k) {
          if(k==='query')return async(sql:string,args?:unknown[])=>{
            const result=await c.query(sql,args);
            if(phase==='admission' ? sql.includes('INSERT INTO content_intake.object_reservations') : sql.includes("SET state='persisted'"))target=true;
            if(sql==='COMMIT'&&target&&!injected){injected=true;throw new Error('synthetic lost capacity commit');}return result;
          }; const v:unknown=Reflect.get(c,k);return typeof v==='function'?v.bind(c):v;
        }}) as PoolClient;
      }};
      const before=Number((await admin.query('SELECT count(*) FROM content_intake.object_reservations')).rows[0].count);
      await expect(createIntakeCapacity(uncertain,store,()=>undefined).persist('user-enabler','source-a','input',
        (async function*(){yield Buffer.from('synthetic');})(),'csv',10)).rejects.toThrow('synthetic lost capacity commit');
      expect(injected).toBe(true);
      expect(Number((await admin.query('SELECT count(*) FROM content_intake.object_reservations')).rows[0].count)).toBe(before+1);
    }
    let fail = true;
    const failing = createIntakeCapacity(pool, {...store, async reclaim(id) {
      if(fail){fail=false;throw new Error('synthetic disk error');}return store.reclaim(id);
    }},()=>undefined);
    const obj = await failing.persist('user-enabler','source-a','report',(async function*(){yield Buffer.from('report');})(),'csv',6);
    await expect(failing.discard(obj.objectId)).rejects.toThrow('synthetic disk error');
    expect((await admin.query('SELECT state FROM content_intake.object_reservations WHERE object_id=$1',[obj.objectId])).rows[0].state).toBe('releasing');
    await failing.discard(obj.objectId);
    expect(await store.verify(obj.objectId,obj.sha256,obj.sizeBytes)).toBe(false);
    const report = await intakeCapacityDryRun(admin);
    expect(report).toMatchObject({historicalDeletionAllowed:false,retentionPolicy:'pending-approval',
      reservations:expect.arrayContaining([{state:'reserved',objects:'1',charged_bytes:'10'},{state:'persisted',objects:'1',charged_bytes:'10'}])});
    const params = pool.options;
    const dsn = `postgresql://${encodeURIComponent(String(params.user))}@localhost/${params.database}?${new URLSearchParams({host:String(params.host),port:String(params.port)})}`;
    const cli = path.resolve('../../scripts/content-retention.ts');
    const output = await promisify(execFile)(process.execPath,[cli,'--group','intake-objects','--dsn',dsn]);
    expect(JSON.parse(output.stdout)).toEqual(report);
    await expect(promisify(execFile)(process.execPath,[cli,'--group','intake-objects','--dsn',dsn,'--apply','--confirm','0']))
      .rejects.toMatchObject({stderr:expect.stringContaining('dry-run only')});
  },60_000);

  it('capacity: adopted references resist cleanup and releasing tombstones reject late adoption', async () => {
    const cap = createIntakeCapacity(pool,store,()=>undefined);
    const persist = () => cap.persist('user-enabler','source-a','report',(async function*(){yield Buffer.from('report');})(),'csv',6);
    async function adopt(obj: Awaited<ReturnType<typeof persist>>) {
      await admin.query('BEGIN');
      try {
        await admin.query('SELECT backend_review.lock_content()');
        await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
          VALUES($1,'source-a','enabler','tenant-a','app-a',$2,$3,$4,'application/json','report',clock_timestamp())`,
        [obj.objectId,`intake/${obj.objectId}`,obj.sha256,obj.sizeBytes]);
        await cap.adopt(admin,obj); await admin.query('COMMIT');
      } catch(error){await admin.query('ROLLBACK');throw error;}
    }
    const adopted=await persist();await adopt(adopted);await cap.discard(adopted.objectId);
    expect(await store.verify(adopted.objectId,adopted.sha256,adopted.sizeBytes)).toBe(true);
    const replay=await persist();
    let release!:()=>void;let arrived!:()=>void;
    const waiting=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{arrived=resolve;});
    const cleanup=createIntakeCapacity(pool,{...store,async reclaim(id){arrived();await waiting;return store.reclaim(id);}},()=>undefined);
    const discarding=cleanup.discard(replay.objectId);
    try {
      await started;
      await expect(adopt(replay)).rejects.toMatchObject({reason:'COMMIT_UNKNOWN'});
      expect((await admin.query('SELECT object_id FROM content_intake.objects WHERE object_id=$1',[replay.objectId])).rowCount).toBe(0);
    } finally {release();await discarding;}
    expect(await store.verify(replay.objectId,replay.sha256,replay.sizeBytes)).toBe(false);
    await expect(cap.persist('user-enabler','source-a','input',(async function*(){yield Buffer.from('too large');})(),'csv',1)).rejects.toThrow('CONTENT_UPLOAD_TOO_LARGE');
    expect((await admin.query("SELECT count(*) FROM content_intake.object_reservations WHERE state IN ('reserved','persisted','releasing')")).rows[0].count).toBe('0');
  });

  it('capacity: report quota refusal terminates failed and cancelled jobs even with one pool connection', async () => {
    const one = new Pool({...pool.options,max:1,connectionTimeoutMillis:2000});
    try {
      const limited = createContentIntakeService(one,store);
      const req = await input('full-report', null, [['faq-one','合成问题','','','','分类','','启用','','','','','','','false']]);
      const used = Number((await admin.query('SELECT sum(bytes) bytes FROM content_intake.objects')).rows[0].bytes);
      await admin.query(`INSERT INTO content_intake.object_reservations(object_id,tenant_id,app_id,actor_id,purpose,reserved_bytes,state)
        VALUES($1,'tenant-a','app-a','enabler','input',$2,'reserved')`,[`obj_${'f'.repeat(64)}`,INTAKE_TEMPORARY_BYTES-used]);
      for (const cancelled of [false,true]) {
        const job=value(await limited.receive(actor('enabler'),'source-a',{...req,operationId:`full-${cancelled}`}));
        const signal=cancelled?AbortSignal.abort():undefined;
        const result=await limited.parse(actor('enabler'),job.jobId,signal);
        expect(result).toMatchObject({ok:false,reason:'QUOTA_EXCEEDED'});
        expect((await admin.query('SELECT state,report_object_id FROM content_intake.parse_jobs WHERE job_id=$1',[job.jobId])).rows[0])
          .toEqual({state:cancelled?'cancelled':'failed',report_object_id:null});
      }
    } finally { await one.end(); }
  },30_000);

  it('quality HTTP requires an explicit empty initial round when all entries are withdrawn', async () => {
    await publicationBase();
    const base = await publishable('zero-base');
    const published = value(await service.publish(actor('enabler'), base.request));
    const req = await input('withdrawn-only', null, [['faq-one', '合成标题', '合成正文', '', '', '分类', '', '停用', '', '', '', '', '', '', 'false']]);
    req.baseReleaseId = published.releaseId;
    const c = value(await service.parse(actor('enabler'), value(await service.receive(actor('enabler'), 'source-a', req)).jobId));
    const host = await managementHost();
    try {
      const q = await qualityWire(host, c);
      expect((await q.status()).plan).toMatchObject({ initialCount: 0, expandedCount: 0, withdrawalCount: 1 });
      expect(await q.samples(await q.status())).toEqual([]);
      expect((await q.post('checks', { operationId: 'before-zero-freeze', key: c.key, phase: 'initial', checks: [] })).statusCode).toBe(409);
      expect((await q.post('freeze', { operationId: 'zero-freeze', key: c.key })).json().state).toBe('initial_required');
      const done = await q.post('checks', { operationId: 'zero-check', key: c.key, phase: 'initial', checks: [] });
      expect(done.statusCode, done.body).toBe(200); expect(done.json().state).toBe('passed');
      expect((await q.status()).rounds[0]).toMatchObject({ phase: 'initial', checkedCount: 0, defectCount: 0 });
      expect((await admin.query('SELECT jsonb_array_length(checks) AS count FROM content_intake.quality_rounds WHERE candidate_id=$1', [c.key.candidateId])).rows).toEqual([{ count: 0 }]);
    } finally { await host.app.close(); }
  });

  it('quality HTTP strictly binds inputs, preserves text and returns compact historical receipts', async () => {
    const host = await managementHost();
    try {
      const f = await httpCandidate(host, 'wire'); const q = await qualityWire(host, f.c);
      const preview = await q.status();
      expect(preview).toMatchObject({ state: 'not_frozen', frozen: null, rounds: [], plan: { initialCount: 3, ordinaryCount: 3 } });
      expect(JSON.stringify(preview)).not.toMatch(/staging_id|internalNote|合成内部说明/);
      for (const query of ['', `digest=${f.c.key.digest}&digest=${f.c.key.digest}`, `digest=${f.c.key.digest}&userId=enabler`]) expect((await q.get(query)).statusCode).toBe(400);
      const command = { operationId: 'wire-freeze', key: f.c.key };
      for (const bad of [{ ...command, actor: 'enabler' }, { ...command, key: { ...f.c.key, version: 2 } }]) expect((await q.post('freeze', bad)).statusCode).toBe(400);
      expect((await q.post('freeze', command, { 'content-encoding': 'gzip' })).statusCode).toBe(400);
      const frozen = await q.post('freeze', command); expect(frozen.statusCode, frozen.body).toBe(200);
      const s = await q.status(); expect(s.frozen).toMatchObject({ principalId: 'enabler', factsVersion: 1 });
      expect((await q.page(preview)).statusCode).toBe(409);
      const items = await q.samples(s, 'initial', 2); expect(items).toHaveLength(3);
      expect(items.map(i => i.entry.answerText)).toContain('第一行。\n第二行。');
      expect(items.every(i => i.entry.internalNote === '合成内部说明' && i.check === null)).toBe(true);
      const checks = wireChecks(items), req = { operationId: 'wire-check', key: f.c.key, phase: 'initial', checks };
      for (const bad of [[], [...checks, checks[0]!], checks.map(c => ({ ...c, contentHash: 'f'.repeat(64) }))]) expect((await q.post('checks', { ...req, checks: bad })).statusCode).toBe(400);
      for (const reason of ['\u0000', '\ud800', '🙂'.repeat(1001)]) expect((await q.post('checks', { ...req, checks: checks.map(c => ({ ...c, reason })) })).statusCode).toBe(400);
      const accepted = { ...req, checks: checks.map(c => ({ ...c, reason: '🙂'.repeat(1000) })) };
      const done = await q.post('checks', accepted); expect(done.statusCode, done.body).toBe(200);
      expect(Object.keys(done.json()).sort()).toEqual(['action', 'key', 'operationId', 'phase', 'state']);
      expect(done.json()).toMatchObject({ state: 'passed', phase: 'initial' });
      expect((await q.post('checks', accepted)).json()).toEqual(done.json());
      expect((await q.receipt(req.operationId)).json()).toEqual(done.json());
      expect((await q.receipt(command.operationId, 'quality-freeze')).json()).toEqual(frozen.json());
      expect((await q.post('checks', req)).statusCode).toBe(409);
      expect((await q.page(s)).statusCode).toBe(409);
      const current = await q.status(); expect(current.rounds[0]).toMatchObject({ checkedCount: 3, defectCount: 0 });
      expect((await q.samples(current))[0]!.check?.reason).toBe('🙂'.repeat(1000));
      expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('1');
    } finally { await host.app.close(); }
  });

  it('quality HTTP cursors expire across sessions, phase, limit, restart and current authorization changes', async () => {
    const host = await managementHost(); let restarted: Awaited<ReturnType<typeof managementHost>> | undefined;
    try {
      const f = await httpCandidate(host, 'cursor'); const q = await qualityWire(host, f.c);
      const s = await q.status(), first = await q.page(s); expect(first.statusCode).toBe(200);
      const cursor = first.json<C['IntakeQualitySamplePage']>().nextCursor!; expect(cursor).toBeTruthy();
      const other = await qualityWire(host, f.c, 'enabler', 'another');
      for (const r of [await other.page(s, 'initial', cursor), await q.page(s, 'expanded', cursor), await q.page(s, 'initial', cursor, 3), await q.page(s, 'initial', `${cursor}x`)]) expect(r.statusCode).toBe(409);
      const agent = await qualityWire(host, f.c, 'agent'); expect((await agent.get()).statusCode).toBe(404);
      const b = await input('other-shop-quality', null, undefined, 'b');
      expect(await service.receive(actor('enabler'), 'source-b', b)).toMatchObject({ ok: false, reason: 'SCOPE_DENIED' });
      restarted = await managementHost(); const restart = await qualityWire(restarted, f.c);
      expect((await restart.page(s, 'initial', cursor)).statusCode).toBe(409);
      value(await service.changeGrant(actor('director'), 'business-enabler-review', { operationId: 'quality-revoke', expectedVersion: 1, change: 'revoke', reason: '合成撤权', stewardPrincipalId: null }));
      expect((await q.get()).statusCode).toBe(404); expect((await q.page(s, 'initial', cursor)).statusCode).toBe(404);
      expect((await q.post('freeze', { operationId: 'denied-freeze', key: f.c.key })).statusCode).toBe(404);
      await auth!.logout(q.logged.token); expect((await q.get()).statusCode).toBe(401);
    } finally { await restarted?.app.close(); await host.app.close(); }
  });

  it('quality HTTP recovers a lost COMMIT after restart and review revocation without disclosing check reasons', async () => {
    const c = await routine(); let lost = false;
    const uncertain: IntakePool = { async connect() {
      const client = await pool.connect(); let writes = false;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, args?: unknown[]) => {
          const result = await target.query(sql, args);
          if (sql.includes('INSERT INTO content_intake.quality_rounds')) writes = true;
          if (sql === 'COMMIT' && writes && !lost) { lost = true; throw new Error('synthetic quality COMMIT response lost'); }
          return result;
        };
        const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const host = await managementHost(store, uncertain); let second: Awaited<ReturnType<typeof managementHost>> | undefined;
    try {
      const q = await qualityWire(host, c); expect((await q.post('freeze', { operationId: 'uncertain-freeze', key: c.key })).statusCode).toBe(200);
      const checks = wireChecks(await q.samples(await q.status())).map(c => ({ ...c, reason: '合成保密质量原因' }));
      const request = { operationId: 'uncertain-check', key: c.key, phase: 'initial', checks };
      const result = await q.post('checks', request); expect(result.statusCode, result.body).toBe(503); expect(result.json().error.details.reason).toBe('COMMIT_UNKNOWN');
      await host.app.close(); second = await managementHost();
      const recovered = await qualityWire(second, c);
      value(await service.changeGrant(actor('director'), 'business-enabler-review', { operationId: 'revoke-recover', expectedVersion: 1, change: 'revoke', reason: '合成撤权', stewardPrincipalId: null }));
      expect((await recovered.get()).statusCode).toBe(404);
      const receipt = await recovered.receipt(request.operationId); expect(receipt.statusCode, receipt.body).toBe(200);
      expect(receipt.json()).toMatchObject({ state: 'passed', phase: 'initial' }); expect(receipt.body).not.toMatch(/checks|reason|population|合成保密/);
      expect((await recovered.post('checks', request)).json()).toEqual(receipt.json());
      expect((await recovered.post('checks', { ...request, operationId: 'new-after-revoke' })).statusCode).toBe(404);
      const other = await qualityWire(second, c, 'other');
      expect((await other.receipt(request.operationId)).statusCode).toBe(404);
      expect((await recovered.receipt('missing')).json().error.details.reason).toBe('COMMIT_UNKNOWN');
      expect((await recovered.receipt(request.operationId, 'publish')).statusCode).toBe(400);
      await auth!.logout(recovered.logged.token); expect((await recovered.receipt(request.operationId)).statusCode).toBe(401);
      expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('1');
      expect((await admin.query("SELECT count(*) FROM backend_review.receipts WHERE operation='intake:quality-check'")).rows[0].count).toBe('1');
    } finally { await second?.app.close(); await host.app.close(); }
  });

  it('quality HTTP rejects raw and PostgreSQL byte excess atomically, then accepts all 5000 critical checks', async () => {
    const rows = Array.from({ length: 5000 }, (_, n) => [`faq-${n}`, '合成标题', '合成正文', '', '', '分类', '', '启用', '', '', '', '', '合成风险', '', 'false']);
    const req = await input('wire-capacity', null, rows);
    const c = value(await service.parse(actor('enabler'), value(await service.receive(actor('enabler'), 'source-a', req)).jobId));
    const host = await managementHost();
    try {
      const q = await qualityWire(host, c, 'reviewer');
      expect((await q.post('freeze', { operationId: 'capacity-freeze', key: c.key })).statusCode).toBe(200);
      const s = await q.status(); expect(s.plan.initialCount).toBe(5000);
      const items = await q.samples(s); expect(items).toHaveLength(5000); expect(items.every(i => i.mandatory)).toBe(true);
      const checks = wireChecks(items), request = { operationId: 'capacity-check', key: c.key, phase: 'initial', checks };
      const contributor = await qualityWire(host, c);
      expect((await contributor.post('checks', request)).json().error.details.reason).toBe('HUMAN_REVIEW_REQUIRED');
      const rawExcess = { ...request, checks: checks.map(c => ({ ...c, reason: '🙂'.repeat(1000) })) };
      expect((await q.post('checks', rawExcess)).statusCode).toBe(413);
      // Pick a valid code-point count whose compact HTTP body fits but whose
      // PostgreSQL jsonb spaces push it beyond the independently owned limit.
      const databaseExcess = { ...request, checks: checks.map(c => ({ ...c, reason: '🙂'.repeat(370) })) };
      const httpBytes = Buffer.byteLength(JSON.stringify(databaseExcess));
      const pgBytes = Number((await admin.query('SELECT octet_length($1::jsonb::text) AS bytes', [JSON.stringify(databaseExcess.checks)])).rows[0].bytes);
      expect(httpBytes).toBeLessThanOrEqual(8_388_608); expect(pgBytes).toBeGreaterThan(8_388_608);
      const over = await q.post('checks', databaseExcess); expect(over.statusCode, over.body).toBe(413); expect(over.json().error.details.reason).toBe('FILE_LIMIT');
      expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('0');
      expect((await q.receipt(request.operationId)).statusCode).toBe(404);
      const result = await q.post('checks', request); expect(result.statusCode, result.body).toBe(200); expect(result.json().state).toBe('passed');
      console.log(JSON.stringify({ probe: 'quality-http-capacity', samples: items.length, httpBytes, pgBytes, limit: 8_388_608, rowsCommitted: 5000 }));
    } finally { await host.app.close(); }
  }, 60_000);

  it('quality HTTP expands from immutable initial checks and rejects old keys after revision', async () => {
    const rows = Array.from({ length: 501 }, (_, n) => [`faq-${n}`, '合成标题', '合成正文', '', '', '分类', '', '启用', '', '', '', '', '', '', 'false']);
    const request = await input('http-expanded', null, rows);
    const c = value(await service.parse(actor('enabler'), value(await service.receive(actor('enabler'), 'source-a', request)).jobId));
    const host = await managementHost();
    try {
      const q = await qualityWire(host, c);
      expect((await q.post('freeze', { operationId: 'expanded-freeze', key: c.key })).statusCode).toBe(200);
      const s = await q.status(), initial = wireChecks(await q.samples(s)).map((c, i) => ({ ...c, defect: i < 3, reason: i < 3 ? '合成缺陷' : '' }));
      expect((await q.post('checks', { operationId: 'expanded-initial', key: c.key, phase: 'initial', checks: initial })).json().state).toBe('expansion_required');
      const next = await q.status(); expect((await q.page(s, 'expanded')).statusCode).toBe(409);
      const expanded = wireChecks(await q.samples(next, 'expanded'));
      expect(expanded.filter(c => c.defect)).toHaveLength(3);
      const submit = { operationId: 'expanded-complete', key: c.key, phase: 'expanded', checks: expanded };
      expect((await q.post('checks', { ...submit, checks: expanded.map(c => ({ ...c, defect: false, reason: '' })) })).statusCode).toBe(400);
      expect((await q.post('checks', submit)).json()).toMatchObject({ state: 'revision_required', phase: 'expanded' });
      expect((await q.receipt(submit.operationId)).json()).toMatchObject({ state: 'revision_required', phase: 'expanded' });
      const revision = await input('http-quality-revision', c.key, rows);
      value(await service.parse(actor('enabler'), value(await service.receive(actor('enabler'), 'source-a', revision)).jobId));
      expect((await q.get()).statusCode).toBe(409);
    } finally { await host.app.close(); }
  }, 30_000);

  it('workflow HTTP publishes the uploaded material after real evidence gates and a second seat consumes that release', async () => {
    await publicationBase();
    const host = await managementHost();
    const reader = Fastify();
    await reader.register(contentIntakeUsageRoutes, { auth: auth!, usage: service });
    const origin = await reader.listen({ host: '127.0.0.1', port: 0 });
    try {
      const f = await httpCandidate(host);
      await httpConfirm(f);
      expect((await f.post('publish', f.publish)).status).toBe(409);
      await noPublication();
      expect((await admin.query('SELECT count(*) FROM content_intake.review_bindings')).rows[0].count).toBe('0');
      const qualitySeat = await seat('reviewer');
      const child = spawn(process.execPath, [fileURLToPath(new URL('../../../scripts/probe-intake-usage-consumer.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
      const ended = once(child, 'close'); let output = '';
      const collect = (chunk: Buffer) => { output += String(chunk); if (output.length > 1_048_576) child.kill('SIGKILL'); };
      child.stdout!.on('data', collect); child.stderr!.on('data', collect);
      const deadline = setTimeout(() => child.kill('SIGKILL'), 45_000);
      try {
        child.stdin!.end(JSON.stringify({ origin: host.origin, token: qualitySeat.token, expiresAt: qualitySeat.expiresAt, releaseId: '', qualityKey: f.c.key }));
        expect((await ended)[0], output.replaceAll(qualitySeat.token, '[credential]')).toBe(0);
        expect(JSON.parse(output)).toEqual({ status: 'PASS', actualSession: true, quality: true, unknownCommitRecovery: true });
      } finally { clearTimeout(deadline); if (child.exitCode === null) { child.kill('SIGKILL'); await ended; } }
      const published = await f.post('publish', f.publish);
      expect(published.status, await published.clone().text()).toBe(202);
      const receipt = parseContractSchema('IntakeReceipt', await published.json());
      expect(receipt).toMatchObject({ state: 'published', action: 'publish', key: f.c.key });
      expect(await (await f.post('publish', f.publish)).json()).toEqual(receipt);
      expect((await f.post('publish', { ...f.publish, summary: '改写重放' })).status).toBe(409);
      expect(await (await fetch(`${host.origin}/v1/intake/operations/${f.publish.operationId}?action=publish`, { headers: host.headers })).json()).toEqual(receipt);
      expect((await f.post('cancel', { operationId: 'too-late', key: f.c.key })).status).toBe(409);
      const secondSeat = await seat('agent');
      const headers = { authorization: `Bearer ${secondSeat.token}` };
      const entitlementResponse = await fetch(`${origin}/v1/intake/entitlements`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...usage, releaseId: receipt.releaseId }) });
      expect(entitlementResponse.status).toBe(200);
      const entitlement = parseContractSchema('IntakeEntitlement', await entitlementResponse.json());
      const response = await fetch(`${origin}/v1/intake/snapshot?entitlementId=${entitlement.entitlementId}`, { headers });
      expect(response.status).toBe(200);
      const snapshot = parseContractSchema('IntakeSnapshot', await response.json());
      expect(snapshot.releaseId).toBe(receipt.releaseId);
      expect(snapshot.faq).toHaveLength(3);
      expect(snapshot.faq[0]!.entry.answerText).toBe('第一行。\n第二行。');
      expect(JSON.stringify(snapshot)).not.toContain('合成内部说明');
      console.log(JSON.stringify({ probe: 'workflow-http-second-seat', source: 'uploaded-synthetic-xlsx', releaseId: receipt.releaseId,
        faqRows: snapshot.faq.length, multilinePreserved: true, qualityTransport: 'Main-ProductSession-HTTP', publicationPolicy: 'direct-v1' }));
    } finally { await reader.close(); await host.app.close(); }
  }, 40_000);

  it('workflow HTTP validates exact candidate paths, complete bodies and action namespaces without trusting caller approval', async () => {
    const host = await managementHost();
    try {
      const f = await httpCandidate(host);
      const agent = { authorization: `Bearer ${(await seat('agent')).token}` };
      const commands = [['source-confirmation', f.source], ['review', reviewRequest(f.c)], ['review/refresh', reviewRequest(f.c, 1)],
        ['publish', f.publish], ['cancel', { operationId: 'cancel', key: f.c.key }]] as const;
      for (const [suffix, body] of commands) {
        expect((await f.post(suffix, body, {} as typeof host.headers)).status).toBe(401);
        expect((await f.post(suffix, body, agent)).status).toBe(404);
        for (const key of [{ ...f.c.key, candidateId: 'different-candidate' }, { ...f.c.key, version: 2 }])
          expect((await f.post(suffix, { ...body, key })).status).toBe(400);
        expect((await f.post(suffix, { ...body, approved: true })).status).toBe(400);
        expect((await f.post(`${suffix}?unknown=1`, body)).status).toBe(400);
        expect((await fetch(`${f.url.replace('/versions/1', '/versions/01')}/${suffix}`, { method: 'POST', headers: { ...host.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
      }
      const wrongDigest = await f.post('source-confirmation', { ...f.source, key: { ...f.c.key, digest: 'f'.repeat(64) } });
      expect(wrongDigest.status).toBe(409);
      expect((await fetch(`${f.url}/review`, { headers: agent })).status).toBe(404);
      expect((await fetch(`${f.url}/review?key=spoof`, { headers: host.headers })).status).toBe(400);
      for (const query of ['', '?action=publish&action=cancel', '?action=review', '?action=publish&extra=1'])
        expect((await fetch(`${host.origin}/v1/intake/operations/unknown${query}`, { headers: host.headers })).status).toBe(400);
      expect(provider.calls()).toBe(0);
      expect((await admin.query('SELECT count(*) FROM content_intake.source_confirmations')).rows[0].count).toBe('0');
    } finally { await host.app.close(); }
  }, 40_000);

  it('workflow HTTP recovers a lost publish COMMIT through actor/action-scoped receipts without another publication', async () => {
    await publicationBase();
    let lost = false;
    const uncertain: IntakePool = { async connect() {
      const client = await pool.connect(); let publishes = false;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, args?: unknown[]) => {
          const result = await target.query(sql, args);
          if (sql.includes('content_intake.publish_candidate(')) publishes = true;
          if (sql === 'COMMIT' && publishes && !lost) { lost = true; throw new Error('synthetic lost publish COMMIT'); }
          return result;
        };
        const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const host = await managementHost(store, uncertain);
    try {
      const f = await httpCandidate(host);
      await httpConfirm(f); await httpQuality(host, f.c);
      const first = await f.post('publish', f.publish);
      expect(first.status).toBe(503);
      expect(await first.json()).toMatchObject({ error: { details: { reason: 'COMMIT_UNKNOWN' } } });
      const url = `${host.origin}/v1/intake/operations/${f.publish.operationId}`;
      const recovered = parseContractSchema('IntakeReceipt', await (await fetch(`${url}?action=publish`, { headers: host.headers })).json());
      expect(recovered.state).toBe('published');
      expect((await fetch(`${url}?action=publish`, { headers: { authorization: `Bearer ${(await seat('other')).token}` } })).status).toBe(404);
      expect((await fetch(`${url}?action=cancel`, { headers: host.headers })).status).toBe(404);
      const observations = provider.instanceCalls();
      expect(await (await f.post('publish', f.publish)).json()).toEqual(recovered);
      expect(provider.instanceCalls()).toBe(observations);
      expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('1');
    } finally { await host.app.close(); }
  }, 40_000);

  it('workflow HTTP preserves historical cancellation receipts and requires a live owning session to recover them', async () => {
    const host = await managementHost();
    try {
      const f = await httpCandidate(host);
      const req = { operationId: 'http-cancel', key: f.c.key };
      const cancelled = await f.post('cancel', req);
      expect(cancelled.status).toBe(200);
      const receipt = parseContractSchema('IntakeReceipt', await cancelled.json());
      expect(receipt).toMatchObject({ operationId: req.operationId, key: f.c.key, state: 'cancelled', action: 'cancel', releaseId: null });
      const stored = (await admin.query("SELECT response FROM backend_review.receipts WHERE operation='intake:cancel'")).rows[0].response;
      expect(parseContractSchema('IntakeCandidate', stored).state).toBe('cancelled'); // existing durable format retained
      expect(await (await f.post('cancel', req)).json()).toEqual(receipt);
      const url = `${host.origin}/v1/intake/operations/${req.operationId}?action=cancel`;
      value(await service.changeGrant(actor('director'), 'business-enabler-candidate-cancel', {
        operationId: 'cancel-revoke', expectedVersion: 1, change: 'revoke', reason: '合成撤权', stewardPrincipalId: null }));
      expect(await (await fetch(url, { headers: host.headers })).json()).toEqual(receipt);
      expect((await fetch(url, { headers: { authorization: `Bearer ${(await seat('other')).token}` } })).status).toBe(404);
      await auth!.logout(host.logged.token);
      expect((await fetch(url, { headers: host.headers })).status).toBe(401);
    } finally { await host.app.close(); }
  }, 40_000);

  it('management HTTP uploads real bytes idempotently, drives parse and pages immutable authorized material', async () => {
    const host = await managementHost();
    try {
      const bytes = await httpWorkbook();
      const first = await host.upload(bytes);
      expect(first.status).toBe(201);
      const object = parseContractSchema('IntakeObject', await first.json());
      expect(object).toMatchObject({ sha256: digest(bytes), bytes: bytes.length, sourceId: 'source-a' });
      expect(await (await host.upload(bytes)).json()).toEqual(object);
      expect((await admin.query("SELECT count(*) FROM content_intake.objects WHERE purpose='input'")).rows[0].count).toBe('1');
      const changed = await host.upload(await httpWorkbook(['另一份合成文件。']));
      expect(changed.status).toBe(409);
      expect(await changed.json()).toMatchObject({ error: { details: { reason: 'IDEMPOTENCY_CONFLICT' } } });
      const received = await host.receive(object.objectId);
      expect(received.statusCode, received.body).toBe(202);
      const job = await host.settled(received.json<C['IntakeParseJob']>().jobId);
      expect(job.state).toBe('validated');
      const candidatePath = `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`;
      const candidateResponse = await host.app.inject({ url: candidatePath, headers: host.headers });
      expect(candidateResponse.statusCode).toBe(200);
      const candidate = parseContractSchema('IntakeCandidate', candidateResponse.json());
      const page = parseContractSchema('IntakeCandidatePage', (await host.app.inject({ url: `${candidatePath}/material?limit=2`, headers: host.headers })).json());
      expect(page.key).toEqual(candidate.key);
      expect(page.entries).toHaveLength(2);
      expect(page.entries[0]!.answerText).toBe('第一行。\n第二行。');
      expect(page.materialHeader.object.sha256).toBe(object.sha256);
      expect(page.nextCursor).not.toBeNull();
      const nextPath = `${candidatePath}/material?limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`;
      const next = parseContractSchema('IntakeCandidatePage', (await host.app.inject({ url: nextPath, headers: host.headers })).json());
      expect(next.entries).toHaveLength(1);
      expect(next.nextCursor).toBeNull();
      expect(next.materialHeader).toEqual(page.materialHeader);
      const secondSession = await seat('enabler', 'another-session');
      expect((await host.app.inject({ url: nextPath, headers: { authorization: `Bearer ${secondSession.token}` } })).statusCode).toBe(409);
      const agent = await seat('agent');
      expect((await host.app.inject({ url: candidatePath, headers: { authorization: `Bearer ${agent.token}` } })).statusCode).toBe(404);
      expect((await host.app.inject({ url: `${candidatePath}/material?limit=2&limit=3`, headers: host.headers })).statusCode).toBe(400);
      expect((await host.app.inject({ url: candidatePath.replace('/versions/1', '/versions/01'), headers: host.headers })).statusCode).toBe(400);
      expect((await host.app.inject({ url: `/v1/intake/parse-jobs/${job.jobId}/report`, headers: host.headers })).statusCode).toBe(404);
      expect((await host.receive(object.objectId)).json()).toEqual(received.json());
      expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('1');
    } finally { await host.app.close(); }
  }, 40_000);

  it('management HTTP blocks the entire bad revision and exports an XLSX report consumed by ExcelJS', async () => {
    const old = await candidate();
    const host = await managementHost();
    try {
      const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook(['', '合成有效行。']))).json());
      const received = await host.receive(object.objectId, 'bad-revision', old.key);
      expect(received.statusCode, received.body).toBe(202);
      const job = await host.settled(received.json<C['IntakeParseJob']>().jobId);
      expect(job.state).toBe('failed');
      expect(job.candidateId).toBeNull();
      expect(job.issues.some(i => i.location.sheet === 'FAQ' && i.location.row === 2)).toBe(true);
      const download = await fetch(`${host.origin}/v1/intake/parse-jobs/${job.jobId}/report`, { headers: host.headers });
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toContain('spreadsheetml.sheet');
      const bytes = Buffer.from(await download.arrayBuffer());
      // A separate downstream process loads the actual HTTP artifact using the
      // parser package's installed mature dependency, not our report writer.
      const consumer = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import ExcelJS from 'exceljs'; import {readFileSync} from 'node:fs';
        const book=new ExcelJS.Workbook(); await book.xlsx.load(readFileSync(0));
        console.log(JSON.stringify({sheet:book.worksheets[0].name, rows:book.worksheets[0].getSheetValues()}));
      `], { cwd: fileURLToPath(new URL('../../../packages/content-intake/', import.meta.url)), input: bytes, timeout: 30_000 });
      const report = JSON.parse(consumer.toString()) as { sheet: string; rows: unknown[] };
      expect(report.sheet).toBe('校验问题');
      expect(report.rows).toHaveLength(job.totalIssues + 2);
      expect(JSON.stringify(report)).toContain('FAQ');
      expect(JSON.stringify(report)).not.toContain('合成有效行。');
      expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('1');
      expect(value(await service.candidate(actor('enabler'), old.key.candidateId, old.key.version)).state).toBe('awaiting-evidence');
      console.log(JSON.stringify({ probe: 'management-report-consumer', artifactBytes: bytes.length, sha256: digest(bytes), issueRows: job.totalIssues, consumer: 'ExcelJS', wholeBatchBlocked: true }));
    } finally { await host.app.close(); }
  }, 40_000);

  it('management HTTP rejects anonymous/agent/cross-shop upload and untrusted multipart or receive fields', async () => {
    const host = await managementHost();
    try {
      expect((await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/objects' })).statusCode).toBe(401);
      expect((await host.upload(await httpWorkbook(), 'cross-shop', 'source-b')).status).toBe(404);
      const agent = await seat('agent');
      const boundary = 'management-invalid';
      const multipart = (extra: string, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') => Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="operationId"\r\n\r\ninvalid-test\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"\r\nContent-Type: ${type}\r\n\r\nPK00\r\n${extra}--${boundary}--\r\n`);
      const headers = { ...host.headers, 'content-type': `multipart/form-data; boundary=${boundary}` };
      expect((await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/objects', headers: { ...headers, authorization: `Bearer ${agent.token}` }, payload: multipart('') })).statusCode).toBe(404);
      for (const payload of [multipart(`--${boundary}\r\nContent-Disposition: form-data; name="sha256"\r\n\r\nclaimed\r\n`), multipart('', 'text/csv'), multipart('')]) {
        expect((await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/objects', headers, payload })).statusCode).toBe(400);
      }
      expect((await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/candidates', headers: host.headers,
        payload: { rows: [{ body: '客户端伪造正文' }], userId: 'user-director' } })).statusCode).toBe(400);
      expect((await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/candidates', headers, payload: multipart('') })).statusCode).toBe(400);
      expect((await admin.query('SELECT count(*) FROM content_intake.objects')).rows[0].count).toBe('0');
    } finally { await host.app.close(); }
  }, 30_000);

  it('management HTTP rechecks the real session after upload I/O and cannot admit with a cloned actor', async () => {
    const logged = await seat('enabler');
    const host = await managementHost({ ...store, async persist(...args) {
      const object = await store.persist(...args);
      await admin.query('UPDATE backend_identity.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [authenticatedProductSession(logged.actor)]);
      return object;
    } });
    try {
      const uploaded = await host.upload(await httpWorkbook());
      expect(uploaded.status).toBe(401);
      expect((await admin.query('SELECT count(*) FROM content_intake.objects')).rows[0].count).toBe('0');
      const required = createContentIntakeService(pool, store, undefined, undefined, { requireProductSession: true });
      const req = await input('forged-receive');
      expect(await required.receive({ ...logged.actor }, 'source-a', req)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
      expect((await admin.query('SELECT count(*) FROM content_intake.parse_jobs')).rows[0].count).toBe('0');
    } finally { await host.app.close(); }
  }, 30_000);

  it('management HTTP records terminal failure when session revocation happens during parser I/O', async () => {
    const logged = await seat('enabler');
    let revoke = true;
    const host = await managementHost({ ...store, async readPayload(id) {
      const bytes = await store.readPayload(id);
      if (revoke) {
        revoke = false;
        await admin.query('UPDATE backend_identity.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [authenticatedProductSession(logged.actor)]);
      }
      return bytes;
    } });
    try {
      const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook())).json());
      const received = await host.receive(object.objectId);
      expect(received.statusCode).toBe(202);
      const jobId = received.json<C['IntakeParseJob']>().jobId;
      const deadline = Date.now() + 15_000;
      while (['reading', 'parsing'].includes((await admin.query('SELECT state FROM content_intake.parse_jobs WHERE job_id=$1', [jobId])).rows[0].state)) {
        if (Date.now() > deadline) throw new Error('REVOKED_PARSE_DID_NOT_SETTLE');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect((await admin.query('SELECT state,report_object_id FROM content_intake.parse_jobs WHERE job_id=$1', [jobId])).rows[0]).toMatchObject({ state: 'failed', report_object_id: expect.any(String) });
      expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('0');
      expect(value(await service.job(actor('other'), jobId)).issues.length).toBeGreaterThan(0);
    } finally { await host.app.close(); }
  }, 30_000);

  it('management HTTP retains a committed object after a lost response and recovers it on exact replay', async () => {
    let lost = false;
    const uncertainPool = { async connect() {
      const client = await pool.connect();
      let registering = false;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          if (sql.includes('INSERT INTO content_intake.objects')) registering = true;
          const result = await target.query(sql, values);
          if (sql === 'COMMIT' && registering && !lost) { lost = true; throw new Error('synthetic upload COMMIT response lost'); }
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const host = await managementHost(store, uncertainPool);
    try {
      const bytes = await httpWorkbook();
      const failed = await host.upload(bytes);
      expect(failed.status).toBe(503);
      expect(await failed.json()).toMatchObject({ error: { details: { reason: 'COMMIT_UNKNOWN' } } });
      const stored = (await admin.query('SELECT object_id,sha256,bytes FROM content_intake.objects')).rows[0];
      expect(await store.verify(stored.object_id, stored.sha256, Number(stored.bytes))).toBe(true);
      const recovered = parseContractSchema('IntakeObject', await (await host.upload(bytes)).json());
      expect(recovered.objectId).toBe(stored.object_id);
      expect((await admin.query('SELECT count(*) FROM content_intake.objects')).rows[0].count).toBe('1');
      const receive = await host.receive(recovered.objectId);
      expect((await host.settled(receive.json<C['IntakeParseJob']>().jobId)).state).toBe('validated');
    } finally { await host.app.close(); }
  }, 40_000);

  // Value: protects=terminal receive replay has no new disk effect;
  // fails_when=worker persists reports for already-terminal jobs;
  // why_new=previous idempotency checks counted DB rows only; seam=none.
  it('management HTTP replay of a terminal failed job creates no unreferenced report objects', async () => {
    const host = await managementHost();
    try {
      const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook(['']))).json());
      const received = await host.receive(object.objectId);
      expect((await host.settled(received.json<C['IntakeParseJob']>().jobId)).state).toBe('failed');
      const before = (await readdir(path.join(store.rootDirectory, 'objects'))).sort();
      expect(before).toHaveLength(2); // uploaded workbook + authoritative error report
      for (let i = 0; i < 3; i++) expect((await host.receive(object.objectId)).json()).toEqual(received.json());
      await host.app.close();
      expect((await readdir(path.join(store.rootDirectory, 'objects'))).sort()).toEqual(before);
      expect((await admin.query('SELECT count(*) FROM content_intake.objects')).rows[0].count).toBe('2');
      expect((await admin.query('SELECT count(*) FROM content_intake.parse_jobs')).rows[0].count).toBe('1');
    } finally { await host.app.close(); }
  }, 30_000);

  it('management concurrent failure finalizers keep exactly one referenced report', async () => {
    const logged = await seat('enabler');
    let arriving = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sharedStore = { ...store, async persist(...args: Parameters<typeof store.persist>) {
      if (args[1] === 'csv') { if (++arriving === 2) release(); await gate; }
      return store.persist(...args);
    } };
    const first = createContentIntakeService(pool, sharedStore, undefined, undefined, { requireProductSession: true });
    const second = createContentIntakeService(pool, sharedStore, undefined, undefined, { requireProductSession: true });
    const req = await input('concurrent-errors', null, [['faq-one', '合成问题', '', '', '', '', '', '启用', '', '', '', '', '', '', 'false']]);
    const job = value(await first.receive(logged.actor, 'source-a', req));
    const result = await Promise.all([first.parse(logged.actor, job.jobId), second.parse(logged.actor, job.jobId)]);
    expect(result.every(r => !r.ok)).toBe(true);
    expect(arriving).toBe(2);
    expect((await readdir(path.join(store.rootDirectory, 'objects'))).length).toBe(2);
    expect((await admin.query('SELECT count(*) FROM content_intake.objects')).rows[0].count).toBe('2');
    expect(value(await first.job(logged.actor, job.jobId)).state).toBe('failed');
  }, 30_000);

  it('management HTTP bounds the queue and settles accepted jobs when its host closes', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { entered = resolve; });
    let first = true;
    const host = await managementHost({ ...store, async readPayload(id) {
      if (first) { first = false; entered(); await gate; }
      return store.readPayload(id);
    } });
    try {
      const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook())).json());
      expect((await host.receive(object.objectId, 'queue-0')).statusCode).toBe(202);
      await reading;
      for (let i = 1; i < 10; i++) expect((await host.receive(object.objectId, `queue-${i}`)).statusCode).toBe(202);
      expect((await host.receive(object.objectId, 'queue-full')).statusCode).toBe(503);
      const closing = host.app.close(); release(); await closing;
      const rows = (await admin.query('SELECT state FROM content_intake.parse_jobs')).rows as {state:string}[];
      expect(rows).toHaveLength(10);
      expect(rows.every(row => row.state === 'cancelled' || row.state === 'validated')).toBe(true);
    } finally { release(); await host.app.close(); }
  }, 40_000);

  it('management session-bound parser closes an admitted job revoked before queue execution', async () => {
    const logged = await seat('enabler');
    const required = createContentIntakeService(pool, store, undefined, undefined, { requireProductSession: true });
    const received = value(await required.receive(logged.actor, 'source-a', await input('queued-revocation')));
    await admin.query('UPDATE backend_identity.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [authenticatedProductSession(logged.actor)]);
    expect(await required.parse(logged.actor, received.jobId)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    const terminal = value(await service.job(actor('other'), received.jobId));
    expect(terminal).toMatchObject({ state: 'failed', candidateId: null });
    expect(terminal.issues[0]!.code).toBe('SCOPE_DENIED');
  }, 30_000);

  async function candidate(op = 'receive-one') {
    const received = value(await service.receive(actor('enabler'), 'source-a', await input(op)));
    const parsed = await service.parse(actor('enabler'), received.jobId);
    if (!parsed.ok) throw new Error(JSON.stringify({ parsed, diagnostics, report: await service.job(actor('enabler'), received.jobId) }));
    return value(parsed);
  }
  async function routine() {
    const req = await input('routine',null,[['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','','','false']]);
    return value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
  }
  async function confirm(c: C['IntakeCandidate'], op = 'source-confirm-one', expected = 0) {
    const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2',[c.key.candidateId,c.key.version])).rows[0].material as C['IntakeMaterial'];
    const req: C['IntakeSourceConfirmation'] = { operationId:op,key:c.key,expectedEvidenceVersion:expected,
      confirmedVersionKind:'opaque',confirmedVersionValue:'synthetic-export-one',acquisition:'controlled-synthetic-export',objectSha256:material.object.sha256,reason:'合成人工确认来源' };
    return { req,result:await service.confirmSource(actor('enabler'),req) };
  }
  const reviewRequest = (c: C['IntakeCandidate'], expected = 0, op = 'review-one'): C['IntakeReviewRequest'] =>
    ({ operationId:op,key:c.key,expectedEvidenceVersion:expected });

  async function grantQuerySources(ids: string[]) {
    for (const id of ids) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        SELECT 'root-discovery-'||source_id,'allocation','director','director','tenant-a','app-a',scope_id,'query',
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成发现根范围','director'
        FROM content_intake.sources WHERE source_id=$1`,[id]);
      const req=batch('agent','query','business',`discover-grant-${id}`);
      req.items[0]!.scope={...scope,sourceId:id,shopId:id==='source-brand'?null:'shop-b'};
      value(await service.grantBatch(actor('director'),req));
    }
  }

  async function registerDirectoryIdentity(id: string, options: { tenant?: string; app?: string; enabled?: boolean; role?: string; display?: string } = {}) {
    const tenant = options.tenant ?? 'tenant-a', app = options.app ?? 'app-a';
    const userId = `directory-${digest(id).slice(0, 32)}`;
    await admin.query('BEGIN');
    try {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic',$2,$1,$3,repeat('a',64),true,'agent')`, [id, tenant, userId]);
      await admin.query(`INSERT INTO content_intake.principals VALUES ($1,$2,$3,$4,'confirmed-synthetic',$1,1,0)`, [id, userId, tenant, app]);
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ($1,1,ARRAY['dept-a'],$2,$3,
        statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`, [id, `job-${options.role ?? 'enabler'}`, options.enabled ?? true]);
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
    principalLabels.set(id, options.display ?? '合成已登记参与人');
  }
  const directoryQuery = { sourceId: 'source-a', purpose: 'contributor' };


  it('management context: real HTTP exposes only source, current base and authenticated principal with no business writes or leases', async () => {
    const host = await managementHost();
    const snapshot = async () => {
      const rows = [];
      for (const table of ['content_intake.entitlements', 'content_intake.entitlement_contexts', 'content_intake.grants',
        'content_intake.principals', 'content_intake.parse_jobs', 'content_intake.candidate_versions', 'content_intake.objects',
        'backend_review.receipts', 'public.content_current', 'public.snapshot_offline_leases', 'public.client_sync_state']) {
        rows.push((await admin.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);
      }
      return rows;
    };
    try {
      // An unrelated query grant must not shorten an import-only projection.
      await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成无关短资格' WHERE grant_id='business-enabler-query'");
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
        VALUES ('short-context-query','business','director','enabler','tenant-a','app-a','scope-a','source-a','query',
        clock_timestamp()-interval '1 second',clock_timestamp()+interval '5 seconds','合成无关短资格','director','root-query')`);
      const deadline = (await admin.query("UPDATE backend_identity.sessions SET expires_at=clock_timestamp()+interval '180 seconds' WHERE token_hash=$1 RETURNING expires_at", [authenticatedProductSession(host.logged.actor)])).rows[0].expires_at as Date;
      let before = await snapshot();
      const response = await fetch(`${host.origin}/v1/intake/sources/source-a/management-context`, { headers: host.headers });
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text(), context = parseContractSchema('IntakeManagementContext', JSON.parse(text));
      expect(context).toEqual({ sourceId: 'source-a', sourceVersion: 1, baseReleaseId: null,
        principalId: 'enabler', factsVersion: 1, validUntil: deadline.toISOString() });
      expect(context.principalId).not.toBe(host.logged.actor.user_id);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65_536);
      expect(await snapshot()).toEqual(before);
      await publicationBase();
      await admin.query(`INSERT INTO content_intake.source_mappings SELECT source_id,2,template_version,rule_version,mapping_version,structure_digest
        FROM content_intake.source_mappings WHERE source_id='source-a';
        UPDATE content_intake.sources SET current_mapping_version=2,mode='legacy',mode_version=2 WHERE source_id='source-a'`);
      before = await snapshot();
      const latest = await fetch(`${host.origin}/v1/intake/sources/source-a/management-context`, { headers: host.headers });
      expect(latest.status).toBe(200);
      expect(parseContractSchema('IntakeManagementContext', await latest.json())).toMatchObject({ sourceVersion: 2, baseReleaseId: 'rel_native_base' });
      expect(await snapshot()).toEqual(before);
    } finally { await host.app.close(); }
  });

  it('management context: import scope and the private session reject other permissions, tenants, apps, missing sessions and actor clones', async () => {
    const host = await managementHost();
    try {
      for (const [id, tenant, app] of [['foreign-tenant', 'tenant-b', 'app-a'], ['foreign-app', 'tenant-a', 'app-b']] as const) {
        await admin.query("INSERT INTO content_intake.scopes VALUES ($1,$2,$3,'brand-a','shop-a','product')", [`scope-${id}`, tenant, app]);
        await admin.query('BEGIN');
        await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,$2,1,'v2-preview')", [id, `scope-${id}`]);
        await admin.query("INSERT INTO content_intake.source_mappings VALUES ($1,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))", [id]);
        await admin.query('COMMIT');
        await registerDirectoryIdentity(id, { tenant, app });
        const foreign = await seat(id);
        const denied = await host.app.inject({ url: '/v1/intake/sources/source-a/management-context', headers: { authorization: `Bearer ${foreign.token}` } });
        expect(denied.statusCode).toBe(404);
      }
      for (const id of ['source-b', 'missing', 'foreign-tenant', 'foreign-app']) {
        const denied = await host.app.inject({ url: `/v1/intake/sources/${id}/management-context`, headers: host.headers });
        expect(denied.statusCode).toBe(404); expect(parseContractSchema('IntakeError', denied.json()).error.details.reason).toBe('SCOPE_DENIED');
      }
      for (const id of ['agent', 'director']) {
        const logged = await seat(id);
        expect((await host.app.inject({ url: '/v1/intake/sources/source-a/management-context', headers: { authorization: `Bearer ${logged.token}` } })).statusCode).toBe(404);
      }
      expect((await host.app.inject({ url: '/v1/intake/sources/source-a/management-context' })).statusCode).toBe(401);
      expect(await service.managementContext(actor('enabler'), 'source-a')).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
      expect(await service.managementContext({ ...host.logged.actor }, 'source-a')).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
      value(await service.changeGrant(actor('director'), 'business-enabler-import', { operationId: 'context-revoke-import', expectedVersion: 1,
        change: 'revoke', reason: '合成取消导入权限', stewardPrincipalId: null }));
      expect((await host.app.inject({ url: '/v1/intake/sources/source-a/management-context', headers: host.headers })).statusCode).toBe(404);
      value(await service.authorization(actor('enabler'), 'source-a', 'content-manage'));
    } finally { await host.app.close(); }
  });

  it.each(['session', 'grant', 'facts'] as const)('management context: slow current read cannot borrow time beyond its original %s deadline', async kind => {
    let delayed = false;
    const slow: IntakePool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql: string, parameters?: unknown[]) => {
        const result = await client.query(sql, parameters);
        if (sql === 'SELECT current_release_id FROM public.content_current WHERE id=1') {
          delayed = true; await new Promise(resolve => setTimeout(resolve, 350));
        }
        return result;
      }, release: (broken?: boolean) => client.release(broken) } as PoolClient;
    } };
    const host = await managementHost(store, slow);
    try {
      if (kind === 'session') await admin.query("UPDATE backend_identity.sessions SET expires_at=clock_timestamp()+interval '250 milliseconds' WHERE token_hash=$1", [authenticatedProductSession(host.logged.actor)]);
      if (kind === 'grant') {
        value(await service.changeGrant(actor('director'), 'business-enabler-import', { operationId: 'short-context-grant', expectedVersion: 1,
          change: 'revoke', reason: '合成短期授权替代', stewardPrincipalId: null }));
        await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
          VALUES ('short-context-import','business','director','enabler','tenant-a','app-a','scope-a','source-a','import',
          clock_timestamp()-interval '1 second',clock_timestamp()+interval '250 milliseconds','合成短期导入权','director','root-import')`);
      }
      if (kind === 'facts') await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('enabler',2,ARRAY['dept-a'],'job-lead',true,
        clock_timestamp(),clock_timestamp()+interval '250 milliseconds',repeat('b',64)); UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='enabler'`);
      const response = await fetch(`${host.origin}/v1/intake/sources/source-a/management-context`, { headers: host.headers });
      expect(response.status).toBe(403); parseContractSchema('IntakeError', await response.json());
      expect(delayed).toBe(true);
      expect((await admin.query('SELECT count(*) FROM backend_review.receipts')).rows[0].count).toBe(kind === 'grant' ? '1' : '0');
    } finally { await host.app.close(); }
  });

  it('management context: waits for the existing publication lock and reads the committed current pointer', async () => {
    let reached!: () => void;
    const atLock = new Promise<void>(resolve => { reached = resolve; });
    const observing: IntakePool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql: string, parameters?: unknown[]) => {
        if (sql === "SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))") reached();
        return client.query(sql, parameters);
      }, release: (broken?: boolean) => client.release(broken) } as PoolClient;
    } };
    const host = await managementHost(store, observing);
    const publisher = await pool.connect();
    let reading: Promise<Response> | undefined;
    try {
      await publisher.query('BEGIN');
      await publisher.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
      reading = fetch(`${host.origin}/v1/intake/sources/source-a/management-context`, { headers: host.headers });
      await atLock;
      // Explicit synthetic bootstrap stands in for the legacy writer, which takes
      // this publication lock but does not participate in lock_content().
      await publicationBase();
      await publisher.query('COMMIT');
      const response = await reading; expect(response.status).toBe(200);
      expect(parseContractSchema('IntakeManagementContext', await response.json()).baseReleaseId).toBe('rel_native_base');
    } finally {
      await publisher.query('ROLLBACK'); publisher.release();
      await reading; await host.app.close();
    }
  });

  it('management context: real publication and source remapping invalidate stale receive hints without admitting a job or receipt', async () => {
    await publicationBase();
    const ready = await publishable('context-race'), host = await managementHost();
    try {
      const first = await fetch(`${host.origin}/v1/intake/sources/source-a/management-context`, { headers: host.headers });
      const context = parseContractSchema('IntakeManagementContext', await first.json());
      const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook(), 'context-stale-upload')).json());
      const request: C['IntakeReceive'] = { operationId: 'context-stale-receive', objectId: object.objectId,
        sourceVersion: context.sourceVersion, baseReleaseId: context.baseReleaseId, expectedPriorKey: null,
        contributorDeclaration: { preparerPrincipalId: context.principalId, editorPrincipalIds: [context.principalId], confirmed: true } };
      const jobsBefore = (await admin.query('SELECT count(*) FROM content_intake.parse_jobs')).rows[0].count;
      const published = value(await service.publish(actor('enabler'), ready.request));
      expect(published.releaseId).not.toBe(context.baseReleaseId);
      const stale = await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/candidates', headers: host.headers, payload: request });
      expect(stale.statusCode).toBe(409); expect(parseContractSchema('IntakeError', stale.json()).error.details.reason).toBe('BASE_CHANGED');
      const current = parseContractSchema('IntakeManagementContext', await (await fetch(`${host.origin}/v1/intake/sources/source-a/management-context`, { headers: host.headers })).json());
      await admin.query(`INSERT INTO content_intake.source_mappings SELECT source_id,2,template_version,rule_version,mapping_version,structure_digest
        FROM content_intake.source_mappings WHERE source_id='source-a'; UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'`);
      const remapped = await host.app.inject({ method: 'POST', url: '/v1/intake/sources/source-a/candidates', headers: host.headers,
        payload: { ...request, operationId: 'context-remapped-receive', baseReleaseId: current.baseReleaseId } });
      expect(remapped.statusCode).toBe(409); expect(parseContractSchema('IntakeError', remapped.json()).error.details.reason).toBe('SOURCE_MISMATCH');
      expect((await admin.query('SELECT count(*) FROM content_intake.parse_jobs')).rows[0].count).toBe(jobsBefore);
      expect((await admin.query("SELECT request_key FROM backend_review.receipts WHERE request_key IN ('context-stale-receive','context-remapped-receive')")).rows).toEqual([]);
    } finally { await host.app.close(); }
  });

  it('management context: strict GET rejects every query or body and accepts the maximum legal source id over HTTP', async () => {
    const id = 's'.repeat(128);
    await admin.query('BEGIN');
    await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,'scope-a',1,'v2-preview')", [id]);
    await admin.query("INSERT INTO content_intake.source_mappings VALUES ($1,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))", [id]);
    await admin.query('COMMIT');
    await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
      to_jsonb(g)||jsonb_build_object('grant_id','context-max-id','source_id',$1::text))).* FROM content_intake.grants g WHERE grant_id='business-enabler-import'`, [id]);
    const host = await managementHost();
    try {
      const valid = await fetch(`${host.origin}/v1/intake/sources/${id}/management-context`, { headers: host.headers });
      expect(valid.status).toBe(200); expect(parseContractSchema('IntakeManagementContext', await valid.json()).sourceId).toBe(id);
      const url = '/v1/intake/sources/source-a/management-context';
      for (const query of ['?sourceVersion=1', '?limit=1', '?sourceId=source-a', '?x=1&x=2', '?=']) {
        const response = await host.app.inject({ url: url + query, headers: host.headers });
        expect(response.statusCode).toBe(400); expect(parseContractSchema('IntakeError', response.json()).error.details.reason).toBe('FILE_INVALID');
      }
      for (const headers of [{ 'content-type': 'application/json', 'content-length': '2' }, { 'transfer-encoding': 'chunked' }]) {
        const response = await host.app.inject({ method: 'GET', url, headers: { ...host.headers, ...headers }, payload: '{}' });
        expect(response.statusCode).toBe(400);
      }
      expect((await host.app.inject({ method: 'HEAD', url, headers: host.headers })).statusCode).toBe(404);
      expect((await host.app.inject({ url: '/v1/intake/sources/bad%20id/management-context', headers: host.headers })).statusCode).toBe(400);
      expect(await service.managementContext(host.logged.actor, 's'.repeat(129))).toMatchObject({ ok: false, code: 'VALIDATION' });
    } finally { await host.app.close(); }
  });

  it('management context: actual Main ProductHttp/ProductSession uses context to receive and parse, then rejects cancelled and logged-out responses', async () => {
    const host = await managementHost(), logged = host.logged;
    let child: ReturnType<typeof spawn> | undefined, ended: Promise<unknown[]> | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const object = parseContractSchema('IntakeObject', await (await host.upload(await httpWorkbook(), 'context-main-upload')).json());
      child = spawn(process.execPath, [fileURLToPath(new URL('../../../scripts/probe-intake-usage-consumer.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
      ended = once(child, 'close'); let stdout = '', stderr = '';
      child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
      timeout = setTimeout(() => child?.kill('SIGTERM'), 45_000);
      child.stdin!.end(JSON.stringify({ origin: host.origin, token: logged.token, expiresAt: logged.expiresAt,
        releaseId: 'not-used-by-management-context', managementContext: true, objectId: object.objectId }));
      expect((await ended)[0], stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ status: 'PASS', actualSession: true, managementContext: true, receive: true, cancellation: true, logoutLateResponse: true });
      expect(stdout + stderr).not.toContain(logged.token);
      const jobs = (await admin.query('SELECT actor_id,contributor_ids::text[] AS contributor_ids,source_version,base_release_id,state FROM content_intake.parse_jobs WHERE object_id=$1', [object.objectId])).rows;
      expect(jobs).toEqual([{ actor_id: 'enabler', contributor_ids: ['enabler'], source_version: '1', base_release_id: null, state: 'validated' }]);
      const received = (await admin.query("SELECT response FROM backend_review.receipts WHERE operation='intake:receive' AND request_key='context-main-receive'")).rows;
      expect(received).toHaveLength(1);
    } finally {
      clearTimeout(timeout);
      if (child && ended) {
        const kill = setTimeout(() => child?.kill('SIGKILL'), 2_000);
        if (child.exitCode === null) child.kill('SIGTERM');
        try { await ended; } finally { clearTimeout(kill); }
      }
      await host.app.close();
    }
  }, 60_000);

  it('principals: HTTP only exposes scoped confirmed identities, including disabled or ungranted contributors, with no write side effects', async () => {
    await registerDirectoryIdentity('external-app', { app: 'app-b' });
    await registerDirectoryIdentity('external-tenant', { tenant: 'tenant-b' });
    await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-reviewer'");
    const host = await managementHost();
    const tables = ['content_intake.entitlements', 'content_intake.entitlement_contexts', 'content_intake.grants',
      'content_intake.principals', 'backend_review.receipts', 'public.content_current', 'public.snapshot_offline_leases', 'public.client_sync_state'];
    const snapshot = async () => {
      const rows = [];
      // One pg Client owns this snapshot; queue queries sequentially rather than
      // relying on the driver's deprecated implicit concurrent-query queue.
      for (const table of tables) rows.push((await admin.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);
      return rows;
    };
    try {
      const before = await snapshot();
      const response = await fetch(`${host.origin}/v1/intake/principals?${new URLSearchParams(directoryQuery)}`, { headers: host.headers });
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
      const page = parseContractSchema('IntakePrincipalPage', await response.json());
      expect(page.items.map(item => item.principalId)).toEqual(['agent', 'director', 'enabler', 'legacy-enabler', 'manager', 'other', 'reviewer', 'supervisor']);
      expect(page.items.find(item => item.principalId === 'reviewer')).toMatchObject({ enabled: false, displayLabel: '合成复核人' });
      expect(page.items.find(item => item.principalId === 'manager')).toMatchObject({ factsVersion: 1 });
      expect(page.items.every(item => Object.keys(item).sort().join(',') === 'displayLabel,enabled,factsVersion,principalId,validUntil')).toBe(true);
      expect(await snapshot()).toEqual(before);
      for (const sourceId of ['source-b', 'missing']) {
        const denied = await host.app.inject({ url: `/v1/intake/principals?sourceId=${sourceId}&purpose=contributor`, headers: host.headers });
        expect(denied.statusCode).toBe(404); expect(parseContractSchema('IntakeError', denied.json()).error.details.reason).toBe('SCOPE_DENIED');
      }
      const ordinary = await seat('agent');
      expect((await host.app.inject({ url: '/v1/intake/principals?sourceId=source-a&purpose=contributor', headers: { authorization: `Bearer ${ordinary.token}` } })).statusCode).toBe(404);
      expect((await host.app.inject({ url: '/v1/intake/principals?sourceId=source-a&purpose=contributor' })).statusCode).toBe(401);
      expect(await service.principals(actor('enabler'), directoryQuery)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
      expect(await service.principals({ ...(await seat('enabler')).actor }, directoryQuery)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    } finally { await host.app.close(); }
  });

  it('principals: grant recipients include first-time targets, exclude stale/ineligible/self identities and advance an empty filtered page', async () => {
    await registerDirectoryIdentity('A-disabled', { enabled: false });
    await registerDirectoryIdentity('B-unmapped', { role: 'unmapped' });
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('reviewer',2,ARRAY['dept-a'],'job-supervisor',true,
      clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',repeat('b',64));
      UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='reviewer'`);
    const logged = await seat('director'), query = { sourceId: 'source-a', purpose: 'grant-recipient', limit: 1 };
    const first = value(await service.principals(logged.actor, query));
    expect(first.items).toEqual([]); expect(first.nextCursor).toEqual(expect.any(String));
    const second = value(await service.principals(logged.actor, { ...query, cursor: first.nextCursor }));
    expect(second.items).toEqual([]); expect(second.nextCursor).not.toBe(first.nextCursor);
    const all = value(await service.principals(logged.actor, { ...query, limit: 100 }));
    expect(all.items.map(item => item.principalId)).toEqual(['agent', 'enabler', 'legacy-enabler', 'manager', 'other', 'supervisor']);
    expect(value(await service.principals((await seat('enabler')).actor, directoryQuery)).items.find(item => item.principalId === 'reviewer')?.validUntil).toBeDefined();
    expect(await service.principals((await seat('enabler')).actor, query)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // Choice does not create a grant; the existing transaction accepts a fresh
    // first-time manager using its returned factsVersion, then CAS rejects stale.
    const recipient = all.items.find(item => item.principalId === 'manager')!;
    const request = batch(recipient.principalId, 'import'); request.items[0]!.recipientFactsVersion = recipient.factsVersion;
    expect(value(await service.grantBatch(logged.actor, request)).items).toHaveLength(1);
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('manager',2,ARRAY['dept-a'],'job-manager',true,
      clock_timestamp(),clock_timestamp()+interval '1 minute',repeat('b',64));
      UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='manager'`);
    expect(await service.grantBatch(logged.actor, { ...request, operationId: 'stale-directory-selection' })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
  });

  it('principals: strict HTTP queries reject unknowns, duplicates, noncanonical limits, body and oversize cursor', async () => {
    const host = await managementHost();
    try {
      for (const query of ['sourceId=source-a', 'purpose=contributor', 'sourceId=source-a&sourceId=source-b&purpose=contributor',
        'sourceId=source-a&purpose=contributor&purpose=grant-recipient', 'sourceId=source-a&purpose=contributor&actor=enabler',
        ...['0', '101', '1e2', '01', '1.0', ''].map(limit => `sourceId=source-a&purpose=contributor&limit=${limit}`),
        'sourceId=source-a&purpose=other', 'sourceId=source-a&purpose=contributor&limit=1&limit=2',
        'sourceId=source-a&purpose=contributor&cursor=', `sourceId=source-a&purpose=contributor&cursor=${'a'.repeat(513)}`]) {
        const response = await host.app.inject({ url: `/v1/intake/principals?${query}`, headers: host.headers });
        expect(response.statusCode, query).toBe(400); parseContractSchema('IntakeError', response.json());
      }
      const body = await host.app.inject({ method: 'GET', url: '/v1/intake/principals?sourceId=source-a&purpose=contributor',
        headers: { ...host.headers, 'content-type': 'application/json' }, payload: '{}' });
      expect(body.statusCode).toBe(400);
      expect((await host.app.inject({ method: 'HEAD', url: '/v1/intake/principals', headers: host.headers })).statusCode).toBe(404);
    } finally { await host.app.close(); }
  });

  it('principals: 100 maximum Unicode labels survive standard HTTP JSON, keyset scans are bounded and use ASCII order', async () => {
    for (let i = 0; i < 101; i++) await registerDirectoryIdentity(`A${String(i).padStart(3, '0')}${'x'.repeat(124)}`, { display: '😀'.repeat(256) });
    const scans: { limit: number; count: number }[] = [];
    let identityQueries = 0;
    const observed: IntakePool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql: string, parameters?: unknown[]) => {
        const result = await client.query(sql, parameters);
        if (sql.includes('WITH registered AS MATERIALIZED')) scans.push({ limit: Number(parameters?.[3]), count: result.rowCount ?? 0 });
        if (sql.includes('JOIN content_intake.principal_facts')) identityQueries++;
        return result;
      }, release: (broken?: boolean) => client.release(broken) } as PoolClient;
    } };
    const host = await managementHost(store, observed);
    try {
      const response = await fetch(`${host.origin}/v1/intake/principals?${new URLSearchParams({ ...directoryQuery, limit: '100' })}`, { headers: host.headers });
      expect(response.status).toBe(200);
      const text = await response.text(), page = parseContractSchema('IntakePrincipalPage', JSON.parse(text));
      expect(page.items).toHaveLength(100); expect(page.items.every(item => item.displayLabel === '😀'.repeat(256))).toBe(true);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262_144); expect(page.nextCursor!.length).toBeLessThanOrEqual(512);
      expect(scans).toEqual([{ limit: 101, count: 101 }]); expect(identityQueries).toBe(3); // actor, bulk page, final actor
      const next = await fetch(`${host.origin}/v1/intake/principals?${new URLSearchParams({ ...directoryQuery, limit: '100', cursor: page.nextCursor! })}`, { headers: host.headers });
      const second = parseContractSchema('IntakePrincipalPage', await next.json());
      expect(second.items).toHaveLength(9); expect(second.nextCursor).toBeNull();
      const ids = [...page.items, ...second.items].map(item => item.principalId);
      expect(new Set(ids).size).toBe(109); expect(ids).toEqual([...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
      console.log(JSON.stringify({ probe: 'principals-capacity', items: ids.length, firstPageBytes: Buffer.byteLength(text), cursorLength: page.nextCursor!.length, scans }));
    } finally { await host.app.close(); }
  }, 60_000);

  it('principals: cursors bind session, source, purpose, limit, authority and service lifetime', async () => {
    const logged = await seat('enabler'), query = { ...directoryQuery, limit: 1 };
    const first = value(await service.principals(logged.actor, query)), cursor = first.nextCursor!;
    for (const changed of [{ limit: 2 }, { sourceId: 'source-b' }, { purpose: 'grant-recipient' }]) {
      expect(await service.principals(logged.actor, { ...query, cursor, ...changed })).toMatchObject({ ok: false });
    }
    expect(await service.principals((await seat('enabler', 'second')).actor, { ...query, cursor })).toMatchObject({ ok: false });
    expect(await evidenceService().principals(logged.actor, { ...query, cursor })).toMatchObject({ ok: false });
    const parts = cursor.split('.'); parts[0] = (parts[0]![0] === 'a' ? 'b' : 'a') + parts[0]!.slice(1);
    expect(await service.principals(logged.actor, { ...query, cursor: parts.join('.') })).toMatchObject({ ok: false });
    value(await service.changeGrant(actor('director'), 'business-enabler-review', { operationId: 'directory-change', expectedVersion: 1,
      change: 'revoke', reason: '合成权限版本变更', stewardPrincipalId: null }));
    expect(await service.principals(logged.actor, { ...query, cursor })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    const refreshed = value(await service.principals(logged.actor, query));
    value(await service.changeGrant(actor('director'), 'business-enabler-import', { operationId: 'directory-revoke', expectedVersion: 1,
      change: 'revoke', reason: '合成来源撤权', stewardPrincipalId: null }));
    expect(await service.principals(logged.actor, { ...query, cursor: refreshed.nextCursor })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await auth!.logout(logged.token);
    expect(await service.principals(logged.actor, query)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('principals: missing, unavailable and invalid labels fail the whole page without guessing or disclosing label content', async () => {
    const logged = await seat('enabler');
    expect(await createContentIntakeService(pool, store).principals(logged.actor, directoryQuery)).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    for (const supplied of [() => null, () => '', () => 'x'.repeat(257)]) {
      const host = await managementHost(store, pool, provider.transport, supplied);
      try {
        const response = await host.app.inject({ url: '/v1/intake/principals?sourceId=source-a&purpose=contributor', headers: host.headers });
        expect(response.statusCode).toBe(503); expect(parseContractSchema('IntakeError', response.json()).error.details.reason).toBe('ORG_FACTS_UNAVAILABLE');
        expect(response.body).not.toContain('items'); expect(response.body).not.toContain('x'.repeat(257));
      } finally { await host.app.close(); }
    }
  });

  it.each(['session', 'grant', 'facts'] as const)('principals: slow bulk read cannot outlive the original %s deadline', async kind => {
    const logged = await seat('enabler');
    if (kind === 'session') await admin.query("UPDATE backend_identity.sessions SET expires_at=clock_timestamp()+interval '250 milliseconds' WHERE token_hash=$1", [authenticatedProductSession(logged.actor)]);
    if (kind === 'grant') {
      value(await service.changeGrant(actor('director'), 'business-enabler-import', { operationId: 'short-directory-grant', expectedVersion: 1,
        change: 'revoke', reason: '合成短期授权替代', stewardPrincipalId: null }));
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
        VALUES ('short-directory-import','business','director','enabler','tenant-a','app-a','scope-a','source-a','import',
        clock_timestamp()-interval '1 second',clock_timestamp()+interval '250 milliseconds','合成短期导入权','director','root-import')`);
    }
    if (kind === 'facts') await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('enabler',2,ARRAY['dept-a'],'job-lead',true,
      clock_timestamp(),clock_timestamp()+interval '250 milliseconds',repeat('b',64)); UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='enabler'`);
    let delayed = false;
    const slow: IntakePool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql: string, parameters?: unknown[]) => {
        const result = await client.query(sql, parameters);
        if (sql.includes('WITH registered AS MATERIALIZED')) { delayed = true; await new Promise(resolve => setTimeout(resolve, 300)); }
        return result;
      }, release: (broken?: boolean) => client.release(broken) } as PoolClient;
    } };
    const reading = createContentIntakeService(slow, store, undefined, undefined, { principalLabels: label });
    expect(await reading.principals(logged.actor, directoryQuery)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(delayed).toBe(true);
  });

  it('principals: actual Main ProductHttp/ProductSession consumes every page and discards cancelled or logged-out responses', async () => {
    const host = await managementHost(), logged = await seat('enabler');
    let child: ReturnType<typeof spawn> | undefined, ended: Promise<unknown[]> | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      child = spawn(process.execPath, [fileURLToPath(new URL('../../../scripts/probe-intake-usage-consumer.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
      ended = once(child, 'close'); let stdout = '', stderr = '';
      child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
      timeout = setTimeout(() => child?.kill('SIGTERM'), 45_000);
      child.stdin!.end(JSON.stringify({ origin: host.origin, token: logged.token, expiresAt: logged.expiresAt, releaseId: 'not-used-by-principals', principals: true }));
      expect((await ended)[0], stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ status: 'PASS', actualSession: true, principals: true, pagination: true, cancellation: true, logoutLateResponse: true });
      expect(stdout + stderr).not.toContain(logged.token);
    } finally {
      clearTimeout(timeout);
      if (child && ended) {
        const kill = setTimeout(() => child?.kill('SIGKILL'), 2_000);
        if (child.exitCode === null) child.kill('SIGTERM');
        try { await ended; } finally { clearTimeout(kill); }
      }
      await host.app.close();
    }
  }, 60_000);

  it('candidate discovery: session and scope bound keyset paging with live state filters', async () => {
    const one = await candidate('menu-one'), two = await candidate('menu-two');
    const user = (await seat('enabler')).actor;
    expect(value(await service.candidates((await seat()).actor, {})).items).toEqual([]);
    expect(await service.candidates(user, { sourceId: 'source-b' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.candidates(user, { unknown: 'x' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    const first = value(await service.candidates(user, { limit: 1 }));
    const second = value(await service.candidates(user, { limit: 1, cursor: first.nextCursor }));
    expect(new Set([...first.items, ...second.items].map(c => c.key.candidateId))).toEqual(new Set([one.key.candidateId, two.key.candidateId]));
    expect(second.nextCursor).toBeNull();
    expect(await service.candidates((await seat('enabler','other-session')).actor, { cursor: first.nextCursor })).toMatchObject({ ok: false });
    expect(await service.candidates(user, { cursor: first.nextCursor, state: 'published' })).toMatchObject({ ok: false });
    // Persisted ready is not authoritative after the source mapping changes.
    for (const c of [one, two]) {
      value((await confirm(c, `menu-confirm-${c.key.candidateId}`)).result);
      const frozen = value(await service.freezeQuality(actor('reviewer'), {operationId:`menu-freeze-${c.key.candidateId}`,key:c.key}));
      value(await service.checkQuality(actor('reviewer'), {operationId:`menu-quality-${c.key.candidateId}`,key:c.key,phase:'initial',checks:qualityChecks(frozen)}));
    }
    await admin.query("INSERT INTO content_intake.source_mappings SELECT source_id,2,template_version,rule_version,mapping_version,structure_digest FROM content_intake.source_mappings WHERE source_id='source-a'");
    await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
    expect(value(await service.candidates(user, { state: 'ready', limit: 1 }))).toMatchObject({ items: [], nextCursor: expect.any(String) });
    expect(value(await service.candidates(user, { state: 'awaiting-evidence' })).items).toHaveLength(2);
    const host = await managementHost();
    try {
      const response = await host.app.inject({ url: '/v1/intake/candidates?limit=1', headers: host.headers });
      expect(response.statusCode, response.body).toBe(200); parseContractSchema('IntakeCandidateList', response.json());
      value(await service.changeGrant(actor('director'), 'business-enabler-content-manage', { operationId: 'menu-revoke-enabler', expectedVersion: 1, change: 'revoke', reason: '合成撤权', stewardPrincipalId: null }));
      expect(await service.candidates(user, { cursor: first.nextCursor })).toMatchObject({ ok: false });
      expect(value(await service.candidates(user, {})).items).toEqual([]);
      await auth!.logout((await seat('enabler')).token);
      expect(await service.candidates(user, {})).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    } finally { await host.app.close(); }
  }, 30_000);

  it('vocabulary: paginates current labels for an ordinary seat, isolates scope and rejects changed or foreign cursors through HTTP', async () => {
    for (const [id, scopeId, kind, active] of [
      ['a-brand','scope-brand','product',true], ['b-product','scope-a','product',true],
      ['c-scene','scope-a','scenario',true], ['hidden-shop','scope-b','product',true], ['inactive','scope-a','product',false],
    ] as const) {
      await admin.query("INSERT INTO content_intake.vocabulary VALUES ($1,$2,$3,repeat('a',64),$4)",[id,scopeId,kind,active]);
      await admin.query("INSERT INTO content_intake.vocabulary_displays VALUES ($1,1,'合成词项')",[id]);
    }
    const logged = await seat(), app = Fastify();
    await app.register(contentIntakeUsageRoutes, { auth: auth!, usage: service });
    const headers = { authorization: `Bearer ${logged.token}` };
    const url = '/v1/intake/sources/source-a/vocabulary';
    try {
      expect((await app.inject({ url })).statusCode).toBe(401);
      for (const query of ['?unknown=1','?limit=101','?limit=1&limit=2','?cursor=']) {
        expect((await app.inject({ url: url+query, headers })).statusCode).toBe(400);
      }
      expect((await app.inject({ method:'HEAD',url,headers })).statusCode).toBe(404);
      const firstResponse = await app.inject({ url: url+'?limit=1', headers });
      expect(firstResponse.statusCode,firstResponse.body).toBe(200);
      const first = parseContractSchema('IntakeVocabularyList',firstResponse.json());
      expect(first.items.map(v=>v.id)).toEqual(['a-brand']);
      const nextUrl = url+'?'+new URLSearchParams({limit:'1',cursor:first.nextCursor!});
      const second = await app.inject({url:nextUrl,headers});
      expect(second.statusCode,second.body).toBe(200);
      expect(second.json().items.map((v: C['IntakeVocabulary'])=>v.id)).toEqual(['b-product']);
      const all = value(await service.vocabulary(logged.actor,'source-a',{}));
      expect(all.items.map(v=>v.id)).toEqual(['a-brand','b-product','c-scene']);
      expect(await service.vocabulary(logged.actor,'source-b',{})).toMatchObject({ok:false});
      const otherSession = await seat('agent','other');
      expect(await service.vocabulary(otherSession.actor,'source-a',{limit:1,cursor:first.nextCursor})).toMatchObject({ok:false});
      expect(await service.vocabulary(logged.actor,'source-a',{limit:2,cursor:first.nextCursor})).toMatchObject({ok:false});
      await admin.query("INSERT INTO content_intake.vocabulary_displays VALUES ('b-product',2,'合成新名称')");
      expect((await app.inject({url:nextUrl,headers})).statusCode).toBe(409);
      expect(value(await service.vocabulary(logged.actor,'source-a',{})).items[1]!.displayName).toBe('合成新名称');
      value(await service.changeGrant(actor('director'),'business-agent-query',{operationId:'vocabulary-revoke',expectedVersion:1,change:'revoke',reason:'合成撤权',stewardPrincipalId:null}));
      expect((await app.inject({url,headers})).statusCode).not.toBe(200);
      expect(diagnostics.every(error => error instanceof Error && ['FILE_INVALID','SCOPE_DENIED','PERMISSION_CHANGED'].includes(error.message))).toBe(true);
    } finally { await app.close(); }
  });

  it('discovery: uses real session authority, keeps brand and multi-shop scopes distinct, and hides other tenants', async () => {
    const user=(await seat()).actor;
    const first=value(await service.authorizations(user,{}));
    expect(first.capabilities.map(c=>[c.scope.sourceId,c.actions,c.mayAllocate,c.mayDelegate])).toEqual([['source-a',['query'],[],[]]]);
    expect(value(await service.sources(user,{})).items.map(s=>s.scope.sourceId)).toEqual(['source-a']);
    await grantQuerySources(['source-b','source-brand']);
    await admin.query(`BEGIN;
      INSERT INTO content_intake.scopes VALUES ('other-scope','other-tenant','other-app','other-brand','other-shop','product');
      INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version) VALUES ('other-source','other-scope',1);
      INSERT INTO content_intake.source_mappings VALUES ('other-source',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64)); COMMIT`);
    const current=value(await service.authorizations(user,{}));
    expect(current.capabilities.map(c=>c.scope.shopId)).toEqual(['shop-a','shop-b',null]);
    expect(value(await service.sources(user,{})).items.map(s=>s.scope.sourceId)).toEqual(['source-a','source-b','source-brand']);
    for (const invalid of [actor('agent'),{...user}]) {
      expect(await service.authorizations(invalid,{})).toMatchObject({ok:false,code:'UNAUTHORIZED'});
      expect(await service.sources(invalid,{})).toMatchObject({ok:false,code:'UNAUTHORIZED'});
    }
    await auth!.logout((await seat()).token);
    expect(await service.authorizations(user,{})).toMatchObject({ok:false,code:'UNAUTHORIZED'});
  });

  it('discovery: shows allocation separately and keeps non-allocator ceilings empty', async () => {
    const director=value(await service.authorizations((await seat('director')).actor,{})).capabilities[0]!;
    expect(director.actions).toEqual([]);expect(director.mayAllocate).toHaveLength(8);expect(director.mayDelegate).toHaveLength(8);
    value(await service.grantBatch(actor('director'),batch('manager','publish','delegation','discovery-delegation')));
    const manager=value(await service.authorizations((await seat('manager')).actor,{})).capabilities[0]!;
    expect(manager.actions).toEqual([]);expect(manager.mayAllocate).toEqual(['publish']);expect(manager.mayDelegate).toEqual([]);
    expect(await service.grantBatch(actor('director'),batch('agent','publish','delegation','discovery-agent'))).toMatchObject({ok:false,reason:'ROLE_CEILING'});
    const lead=value(await service.authorizations((await seat('enabler')).actor,{})).capabilities[0]!;
    expect(lead.mayAllocate).toEqual([]);expect(lead.mayDelegate).toEqual([]);
    const legacy=value(await service.authorizations((await seat('legacy-enabler')).actor,{})).capabilities[0]!;
    expect(legacy.actions).toEqual(['query']);expect(legacy.mayAllocate).toEqual([]);expect(legacy.mayDelegate).toEqual([]);
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('supervisor-allocation','allocation','director','supervisor','tenant-a','app-a','scope-a','source-a','publish',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成主管分配凭证','director')`);
    const supervisor=value(await service.authorizations((await seat('supervisor')).actor,{})).capabilities;
    expect(supervisor.every(c=>c.mayAllocate.length===0&&c.mayDelegate.length===0)).toBe(true);
    const agent=value(await service.authorizations((await seat()).actor,{})).capabilities[0]!;
    expect(agent.actions).toEqual(['query']);expect(agent.mayAllocate).toEqual([]);expect(agent.mayDelegate).toEqual([]);
    expect(await service.authorization((await seat()).actor,'source-a','publish')).toMatchObject({ok:false});
  });

  it('discovery: signs paging to a live session, route, complete projection and service lifetime', async () => {
    await grantQuerySources(['source-b','source-brand']);
    const user=(await seat()).actor;
    const first=value(await service.authorizations(user,{limit:1}));expect(first.nextCursor).not.toBeNull();
    expect(value(await service.authorizations(user,{limit:1,cursor:first.nextCursor})).capabilities[0]!.scope.sourceId).toBe('source-b');
    const sourcePage=value(await service.sources(user,{limit:1}));
    expect(await service.sources(user,{cursor:first.nextCursor})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    expect(await service.authorizations((await seat('agent','second')).actor,{cursor:first.nextCursor})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    expect(await evidenceService().authorizations(user,{cursor:first.nextCursor})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    expect(await service.authorizations(user,{cursor:first.nextCursor!.replace(/^./,c=>c==='a'?'b':'a')})).toMatchObject({ok:false});
    await admin.query("UPDATE content_intake.sources SET mode='legacy',mode_version=mode_version+1 WHERE source_id='source-b'");
    expect(await service.sources(user,{cursor:sourcePage.nextCursor})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    const current=value(await service.authorizations(user,{limit:1}));
    value(await service.changeGrant(actor('director'),'business-agent-query',{operationId:'discovery-revoke',expectedVersion:1,change:'revoke',reason:'合成撤权',stewardPrincipalId:null}));
    expect(await service.authorizations(user,{cursor:current.nextCursor})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
  });

  it('discovery: handles zero scope, conflicting role, expired facts and strict query shapes without inventing access', async () => {
    const user=(await seat('supervisor')).actor;
    expect(value(await service.authorizations(user,{})).capabilities).toEqual([]);
    expect(value(await service.sources(user,{})).items).toEqual([]);
    for (const raw of [null,[],{limit:null},{limit:0},{limit:101},{limit:'1'},{limit:[1,2]},{cursor:''},{cursor:'x'.repeat(513)},{userId:'agent'},{shopId:'shop-a'}]) {
      expect(await service.authorizations(user,raw)).toMatchObject({ok:false,code:'VALIDATION'});
      expect(await service.sources(user,raw)).toMatchObject({ok:false,code:'VALIDATION'});
    }
    await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a','job-agent',1,'agent') ON CONFLICT DO NOTHING");
    await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-b','job-agent',1,'enabler')");
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',2,ARRAY['dept-a','dept-b'],'job-agent',true,
      clock_timestamp(),clock_timestamp()+interval '1 minute',repeat('b',64)); UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='agent'`);
    expect(value(await service.authorizations((await seat()).actor,{})).capabilities).toEqual([]);
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',3,ARRAY['dept-a'],'job-agent',true,
      clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',repeat('c',64)); UPDATE content_intake.principals SET current_facts_version=3 WHERE principal_id='agent'`);
    expect(await service.sources((await seat()).actor,{})).toMatchObject({ok:false,reason:'ORG_FACTS_UNAVAILABLE'});
  });

  it('discovery: pages more than 100 authorized sources with no loss and rejects a logged-out cursor', async () => {
    await admin.query(`BEGIN;
      INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
        SELECT 'page-'||lpad(i::text,3,'0'),'scope-a',1,'v2-preview' FROM generate_series(1,101) i;
      INSERT INTO content_intake.source_mappings SELECT source_id,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64)
        FROM content_intake.sources WHERE source_id LIKE 'page-%'; COMMIT`);
    const req=batch('agent','query','business','discovery-whole-scope');req.items[0]!.scope={...scope,sourceId:null};
    value(await service.grantBatch(actor('director'),req));
    const user=(await seat()).actor;
    const first=value(await service.sources(user,{limit:100}));expect(first.items).toHaveLength(100);
    const second=value(await service.sources(user,{cursor:first.nextCursor}));expect(second.items).toHaveLength(2);expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items,...second.items].map(s=>s.scope.sourceId)).size).toBe(102);
    await auth!.logout((await seat()).token);
    expect(await service.sources(user,{cursor:first.nextCursor})).toMatchObject({ok:false,code:'UNAUTHORIZED'});
  });

  it('discovery: folds 5000 overlapping grants without changing effective authority or exceeding the SQL deadline', async () => {
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      SELECT 'overlap-'||i,'business','director','agent','tenant-a','app-a','scope-a','source-a','query',
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成重叠授权','director','root-query'
      FROM generate_series(1,5000) i;
      ANALYZE content_intake.grants`);
    const user = (await seat()).actor, started = performance.now();
    const rights = value(await service.authorizations(user,{}));
    expect(rights.capabilities).toHaveLength(1);
    expect(rights.capabilities[0]).toMatchObject({scope,actions:['query'],mayAllocate:[],mayDelegate:[]});
    expect(value(await service.sources(user,{})).items.map(s => s.scope.sourceId)).toEqual(['source-a']);
    expect(await service.authorization(user,'source-a','query')).toMatchObject({ok:true});
    expect(await service.authorization(user,'source-a','publish')).toMatchObject({ok:false});
    console.log(JSON.stringify({probe:'discovery-overlap',additionalGrants:5000,elapsedMs:Math.round(performance.now()-started)}));
  });

  it('discovery: completes the 5000-source menu through real HTTP and Main before authority expires', async () => {
    await admin.query(`BEGIN;
      INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
        SELECT 'capacity-'||lpad(i::text,4,'0'),'scope-a',1,'v2-preview' FROM generate_series(1,4999) i;
      INSERT INTO content_intake.source_mappings SELECT source_id,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64)
        FROM content_intake.sources WHERE source_id LIKE 'capacity-%';
      INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
        SELECT 'grant-'||source_id,'business','director','agent','tenant-a','app-a','scope-a',source_id,'query',
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成独立来源授权','director','root-query'
        FROM content_intake.sources WHERE source_id LIKE 'capacity-%'; COMMIT;
      ANALYZE content_intake.sources; ANALYZE content_intake.source_mappings; ANALYZE content_intake.grants`);
    const logged = await seat();
    const server = Fastify({logger:false,exposeHeadRoutes:false});
    const routes: Record<string, number> = {};
    let pages = 0, child: ReturnType<typeof spawn> | undefined, ended: Promise<unknown[]> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      server.get('/v1/auth/me', async (request,reply) => (await authenticateRequestHeaders(auth!,request.headers)) ?? reply.code(401).send());
      server.addHook('onResponse', async request => {
        const route = request.url.split('?')[0]!;
        if (route.startsWith('/v1/intake/')) { pages++; routes[route] = (routes[route] ?? 0) + 1; }
      });
      await server.register(contentIntakeUsageRoutes,{auth:auth!,usage:service});
      const origin = await server.listen({port:0,host:'127.0.0.1'});
      child = spawn(process.execPath,[fileURLToPath(new URL('../../../scripts/probe-intake-usage-consumer.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
      ended = once(child,'close'); let stdout = '', stderr = '';
      const collect = (chunk: Buffer, error = false) => {
        if(stdout.length + stderr.length > 1_048_576) { child?.kill('SIGKILL'); return; }
        if(error) stderr += String(chunk); else stdout += String(chunk);
      };
      child.stdout!.on('data',collect); child.stderr!.on('data',chunk => collect(chunk,true));
      timeout = setTimeout(() => child?.kill('SIGTERM'),120_000);
      const started = performance.now();
      child.stdin!.end(JSON.stringify({origin,token:logged.token,expiresAt:logged.expiresAt,releaseId:'',discoverySources:5000}));
      expect((await ended)[0],stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({status:'PASS',actualSession:true,discovery:true,sourceCount:5000});
      // Current Main resolves the shop label once in addition to its unchanged
      // authorization/source pages; no extra business or arbitrary route is allowed.
      expect(routes).toEqual({ '/v1/intake/authorization': 100, '/v1/intake/sources': 50, '/v1/intake/shop-directory': 1 });
      expect(pages).toBe(151);
      expect(stdout + stderr).not.toContain(logged.token);
      console.log(JSON.stringify({probe:'discovery-capacity',sources:5000,pages,elapsedMs:Math.round(performance.now()-started)}));
    } finally {
      clearTimeout(timeout);
      if(child && ended) {
        const kill = setTimeout(() => child?.kill('SIGKILL'),2000);
        if(child.exitCode===null) child.kill('SIGTERM');
        try { await ended; } finally { clearTimeout(kill); }
      }
      await server.close();
    }
  },150_000);

  // A consumer probe, not a production bridge: synthetic legacy batch/lease only.
  // No staging, native review-to-owner conversion, publication or mode activation.
  async function freezeQualityProbe(p: IntakeQualityPreview, label = 'one') {
    const batchId = `quality-probe-${label}`;
    const planId = `qplan_probe-${label}`;
    const jobId = `quality-job-${label}`;
    await admin.query(`INSERT INTO public.import_batches(import_batch_id,source_type,source_binding_hash,status)
      VALUES ($1,'other',repeat('a',64),'validating')`, [batchId]);
    await admin.query(`INSERT INTO public.outbox_jobs(job_id,job_type,payload,status,lease_owner,lease_version,lease_expires_at)
      VALUES ($1,'import_validate',jsonb_build_object('import_batch_id',$2::text),'running','quality-probe',1,clock_timestamp()+interval '60 seconds')`, [jobId,batchId]);
    const frozen = await admin.query(`SELECT * FROM public.freeze_content_quality_review_plan(
      $1,'quality-probe',1,$2,$3,'quality-sampling-v1',clock_timestamp(),$4,$5,$6,$7,$8,'sha256-ranked-v1',$9::jsonb)`,
    [jobId,batchId,planId,p.population.length,p.ordinaryCount,p.mandatoryCount,p.seedHash,p.selectionManifestHash,JSON.stringify(p.population)]);
    expect(frozen.rows[0]).toEqual({ frozen_plan_id:planId, initial_sample_target:p.initialTarget, expanded_sample_target:p.expandedTarget });
    const stored = (await admin.query('SELECT * FROM public.content_quality_review_plans WHERE plan_id=$1',[planId])).rows[0];
    expect(stored).toMatchObject({ population_manifest_hash:p.populationManifestHash,selection_manifest_hash:p.selectionManifestHash });
    return planId;
  }

  function qualityChecks(p: IntakeQualityProgress, phase: 'initial' | 'expanded' = 'initial', defects = 0): QualityCheck[] {
    const plan = p.plan!;
    const prior = new Map(p.rounds.flatMap(r => r.checks).map(c => [c.scriptId,c]));
    const hashes = new Map(plan.population.map(r => [r.script_id,r.content_hash]));
    return (phase === 'initial' ? plan.initialScriptIds : plan.expandedScriptIds).map((id,index) => prior.get(id)
      ?? { scriptId:id,contentHash:hashes.get(id)!,defect:index<defects,reason:index<defects?'合成阻断错误':'' });
  }
  const freezeQuality = (c: C['IntakeCandidate']) => service.freezeQuality(actor('reviewer'),{ operationId:'freeze-quality',key:c.key });

  // Explicit synthetic catalog bootstrap, outside the product service. Real legacy
  // adoption/initial-source registration remains separately governed.
  async function publicationBase() {
    const domains = ['aftersale','campaign','presale','product'];
    const sourceHash = digest(domains.map(d => `${d}:srcv_pub_${d}`).join('|'));
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.publishing','on',true)");
    for (const domain of domains) await admin.query(`INSERT INTO public.authoritative_source_versions(
      source_version_id,source_ref,domain,upstream_version,snapshot_sha256,use_class,owner_role,approval_evd,approved_by,approved_at,review_due_at,tenant_id)
      VALUES ($1,$3,$2,'synthetic-publication-v1',repeat('a',64),'canonical','ROLE-CONTENT-LEAD','EVD-SYNTHETIC-PUBLICATION','synthetic-owner',
        '2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','tenant-a')`,[`srcv_pub_${domain}`,domain,`SRC-SYNTH-PUB-${domain.toUpperCase()}`]);
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      VALUES ('rel_native_base',1,'合成空目录基线','published',$1,'tenant-a')`,[sourceHash]);
    for (const domain of domains) await admin.query('INSERT INTO public.release_source_bindings(release_id,domain,source_version_id) VALUES ($1,$2,$3)',
      ['rel_native_base',domain,`srcv_pub_${domain}`]);
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ('rel_native_base','intake-v2.1')");
    await admin.query("INSERT INTO public.content_current(id,current_release_id) VALUES (1,'rel_native_base')");
    await admin.query("SELECT setval('public.content_release_seq',1,true)");
    await admin.query('COMMIT');
  }
  async function publishable(label='one', rows=[['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','','','false']], source='a') {
    const req = await input(`pub-input-${label}`,null,rows,source);
    req.baseReleaseId=(await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0]?.current_release_id ?? null;
    const job=value(await service.receive(actor('enabler'),`source-${source}`,req)).jobId;
    const parsed=await service.parse(actor('enabler'),job);
    if (!parsed.ok) throw new Error(JSON.stringify({parsed,diagnostics:diagnostics.map(e=>String(e)),report:await service.job(actor('enabler'),job)}));
    const c = value(parsed);
    value((await confirm(c,`pub-source-${label}`)).result);
    const frozen = value(await service.freezeQuality(actor('reviewer'),{ operationId:`pub-freeze-${label}`,key:c.key }));
    value(await service.checkQuality(actor('reviewer'),{ operationId:`pub-quality-${label}`,key:c.key,phase:'initial',checks:qualityChecks(frozen) }));
    const request: C['IntakePublish']={ operationId:`pub-${label}`,key:c.key,baseReleaseId:req.baseReleaseId,
      sourceEvidenceVersion:1,confirmed:true,title:'合成发布',summary:'合成 FAQ 更新' };
    return { c,request };
  }
  async function noPublication() {
    for (const table of ['content_intake.publications','content_intake.commit_tickets','content_intake.write_attempts','public.announcements']) {
      expect((await admin.query(`SELECT count(*) FROM ${table} ${table.endsWith('write_attempts') ? "WHERE action='publish'" : ''}`)).rows[0].count,table).toBe('0');
    }
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows).toEqual([{ current_release_id:'rel_native_base' }]);
  }

  const usage: Omit<C['IntakeEntitlementRequest'],'releaseId'>={shopId:'shop-a',contextGeneration:1,productIds:[],scenarioIds:[]};
  const issue=async(ctx=usage,releaseId: string|null=null)=>{
    const result=await service.issueEntitlement((await seat()).actor,{...ctx,releaseId});
    if (!result.ok && result.code==='INTERNAL_ERROR') throw new Error(JSON.stringify(diagnostics.map(e=>String(e))));
    return result;
  };
  const snapshot=async(id: string,extra={})=>service.snapshot((await seat()).actor,{entitlementId:id,...extra});
  async function cloneScopeGrants(suffix: string) {
    await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
      to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-'||$1,'scope_id','scope-'||$1,
        'source_id',CASE WHEN source_id IS NULL THEN NULL ELSE 'source-'||$1 END,
        'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'-'||$1 END))).*
      FROM content_intake.grants g WHERE scope_id='scope-a' ORDER BY (kind='allocation') DESC`,[suffix]);
  }

  // Family scenarios use the public workbook grammar and confirmed direct publication;
  // only organization/source registration is synthetic setup.
  function familyRow(id: string, options: { family?: string; body?: string; title?: string; products?: string; scenarios?: string;
    from?: string; to?: string; disabled?: boolean; protected?: boolean } = {}) {
    return [id, options.title ?? '合成相同问题标题', options.body ?? `${id} 第一行。\n第二行。`, options.products ?? '', options.scenarios ?? '',
      '分类', '', options.disabled ? '停用' : '启用', options.from ?? '', options.to ?? '', options.family ?? '', '仅管理内部说明', '', '', String(options.protected ?? false)];
  }
  async function familySource(suffix: string, shopId: string | null, brandId = 'brand-a', domain: C['IntakeScope']['domain'] = 'product') {
    await admin.query('BEGIN');
    await admin.query('INSERT INTO content_intake.scopes VALUES ($1,\'tenant-a\',\'app-a\',$2,$3,$4)', [`scope-${suffix}`,brandId,shopId,domain]);
    await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,$2,1,'v2-preview')", [`source-${suffix}`,`scope-${suffix}`]);
    await admin.query("INSERT INTO content_intake.source_mappings VALUES ($1,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))", [`source-${suffix}`]);
    await cloneScopeGrants(suffix);
    await admin.query('COMMIT');
  }
  async function familySiblingSource() {
    await admin.query('BEGIN');
    await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ('source-a-second','scope-a',1,'v2-preview')");
    await admin.query("INSERT INTO content_intake.source_mappings VALUES ('source-a-second',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))");
    await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
      to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-second','source_id','source-a-second'))).*
      FROM content_intake.grants g WHERE source_id='source-a' AND kind='business'`);
    await admin.query('COMMIT');
  }
  async function familyPublish(label: string, rows: string[][], source = 'a') {
    const prepared = await publishable(label,rows,source);
    return { ...prepared, receipt: value(await service.publish(actor('enabler'),prepared.request)) };
  }
  async function familySnapshot(context = usage, limit = 1) {
    const entitlement = value(await issue(context));
    const entries: C['IntakeSnapshot']['faq'] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeSnapshot'] = value(await snapshot(entitlement.entitlementId,{limit,...(cursor ? {cursor} : {})}));
      expect(page.releaseId).toBe(entitlement.releaseId);
      entries.push(...page.faq);pageSizes.push(page.faq.length);cursor=page.nextCursor;
    } while(cursor);
    expect(new Set(entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`)).size).toBe(entries.length);
    return {entries,pageSizes,entitlement};
  }
  async function familyVocabulary() {
    for (const [id,kind] of [['product-one','product'],['product-two','product'],['scenario-one','scenario'],['scenario-two','scenario']]) {
      await admin.query("INSERT INTO content_intake.vocabulary VALUES ($1,'scope-brand',$2,repeat('a',64),true)",[id,kind]);
      await admin.query("INSERT INTO content_intake.vocabulary_displays VALUES ($1,1,'合成适用词项')",[id]);
    }
  }

  it('family: explicit source/entry roots select each shop override before pagination without merging equal titles', async()=>{
    await publicationBase();await cloneScopeGrants('brand');await cloneScopeGrants('b');
    await familyPublish('family-roots',[familyRow('root'),familyRow('unrelated',{body:'同名独立通用条目'})],'brand');
    await familyPublish('family-shop-a',[familyRow('local',{family:'source-brand/root',body:'A店第一行。\nA店第二行。'})]);
    await familyPublish('family-shop-b',[familyRow('local',{family:'source-brand/root',body:'B店专用原文'})],'b');
    const a=await familySnapshot();
    expect(a.entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`)).toEqual(['source-a/local','source-brand/unrelated']);
    expect(a.pageSizes).toEqual([1,1]);
    expect(a.entries.map(e=>e.entry.answerText)).toEqual(['A店第一行。\nA店第二行。','同名独立通用条目']);
    expect(JSON.stringify(a.entries)).not.toContain('仅管理内部说明');
    const b=await familySnapshot({...usage,shopId:'shop-b'});
    expect(b.entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`).sort()).toEqual(['source-b/local','source-brand/unrelated']);
    expect(b.entries.find(e=>e.sourceId==='source-b')!.entry.answerText).toBe('B店专用原文');
    const material=(await admin.query('SELECT material FROM content_intake.candidate_versions WHERE source_id=\'source-a\'')).rows[0].material;
    expect(material.entries[0]).toMatchObject({familySourceId:'source-brand',familyBusinessEntryId:'root'});
  },60_000);

  it('family: inapplicable time, product and scenario overrides fall back to their exact generic roots', async()=>{
    await publicationBase();await cloneScopeGrants('brand');await familyVocabulary();
    const roots=['future','expired','product','scenario','combined'];
    await familyPublish('fallback-roots',roots.map(id=>familyRow(id)),'brand');
    await familyPublish('fallback-overrides',[
      familyRow('future-local',{family:'source-brand/future',from:'2098-01-01T00:00:00Z'}),
      familyRow('expired-local',{family:'source-brand/expired',from:'2020-01-01T00:00:00Z',to:'2021-01-01T00:00:00Z'}),
      familyRow('product-local',{family:'source-brand/product',products:'product-one'}),
      familyRow('scenario-local',{family:'source-brand/scenario',scenarios:'scenario-one'}),
      familyRow('combined-local',{family:'source-brand/combined',products:'product-one',scenarios:'scenario-one'}),
    ]);
    const without=await familySnapshot();
    expect(without.entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`).sort()).toEqual(roots.map(id=>`source-brand/${id}`).sort());
    expect(without.pageSizes).toEqual([1,1,1,1,1]);
    const matched=await familySnapshot({...usage,productIds:['product-one'],scenarioIds:['scenario-one']},2);
    expect(matched.entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`).sort()).toEqual([
      'source-a/combined-local','source-a/product-local','source-a/scenario-local','source-brand/expired','source-brand/future']);
    expect(matched.pageSizes).toEqual([2,2,1]);
    const productOnly=await familySnapshot({...usage,productIds:['product-one']});
    expect(productOnly.entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`).sort()).toEqual([
      'source-a/product-local','source-brand/combined','source-brand/expired','source-brand/future','source-brand/scenario']);
  },60_000);

  it('family: actual HTTP and Main query/copy consume shop overrides and another shop generic fallback',async()=>{
    await publicationBase();await cloneScopeGrants('brand');await cloneScopeGrants('b');
    const generic='品牌通用第一行。\n品牌通用第二行。',local='A店专用第一行。\nA店专用第二行。',independent='相同标题但独立的合成答案。';
    await familyPublish('main-family-root',[familyRow('root',{body:generic}),familyRow('unrelated',{body:independent})],'brand');
    const published=await familyPublish('main-family-local',[familyRow('local',{family:'source-brand/root',body:local})]);
    const logged=await seat(),server=Fastify({logger:false,exposeHeadRoutes:false});
    let child:ReturnType<typeof spawn>|undefined,ended:Promise<unknown[]>|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
    try {
      server.get('/v1/auth/me',async(request,reply)=>(await authenticateRequestHeaders(auth!,request.headers))??reply.code(401).send());
      server.post('/v1/auth/logout',async(request,reply)=>{
        const header=request.headers.authorization;if(header?.startsWith('Bearer '))await auth!.logout(header.slice(7));
        return reply.code(204).send();
      });
      await server.register(contentIntakeUsageRoutes,{auth:auth!,usage:service});
      const origin=await server.listen({host:'127.0.0.1',port:0});
      child=spawn(process.execPath,[fileURLToPath(new URL('../../../scripts/probe-intake-usage-consumer.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
      ended=once(child,'close');let stdout='',stderr='';
      child.stdout!.on('data',chunk=>{stdout+=String(chunk);});child.stderr!.on('data',chunk=>{stderr+=String(chunk);});
      timeout=setTimeout(()=>child?.kill('SIGTERM'),45_000);
      child.stdin!.end(JSON.stringify({origin,token:logged.token,expiresAt:logged.expiresAt,releaseId:published.receipt.releaseId,family:true,
        cases:[{shopId:'shop-a',answers:[local,independent]},{shopId:'shop-b',answers:[generic,independent]}]}));
      expect((await ended)[0],stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({status:'PASS',actualSession:true,family:true,shopFallback:true,publishedText:true,queryCopy:true});
      expect(stdout+stderr).not.toContain(logged.token);
    } finally {
      clearTimeout(timeout);
      if(child&&ended) {
        const kill=setTimeout(()=>child?.kill('SIGKILL'),2_000);
        if(child.exitCode===null)child.kill('SIGTERM');
        try {await ended;} finally {clearTimeout(kill);}
      }
      await server.close();
    }
  },60_000);

  it.each(['missing-root','foreign-brand','foreign-domain','linked-root','same-shop-overlap','cross-source-overlap','protected-root'] as const)(
    'family: publication rejects %s atomically after actual parsing and quality checks',async conflict=>{
      await publicationBase();await cloneScopeGrants('brand');
      let target='source-brand/root';
      if(conflict==='foreign-brand'||conflict==='foreign-domain') {
        await familySource('foreign',null,conflict==='foreign-brand'?'brand-b':'brand-a',conflict==='foreign-domain'?'campaign':'product');
        await familyPublish('foreign-root',[familyRow('root',{to:'2098-01-01T00:00:00Z'})],'foreign');target='source-foreign/root';
      } else if(conflict!=='missing-root') {
        await familyPublish('conflict-root',[familyRow('root',{protected:conflict==='protected-root'})],'brand');
      }
      let source='a';
      if(conflict==='linked-root') {
        await familyPublish('linked-root',[familyRow('child',{family:target})]);
        await cloneScopeGrants('b');source='b';target='source-a/child';
      }
      if(conflict==='cross-source-overlap') {
        await familyPublish('first-source-override',[familyRow('override-one',{family:target})]);
        await familySiblingSource();source='a-second';
      }
      const rows=[familyRow('override-one',{family:target})];
      if(conflict==='same-shop-overlap') rows.push(familyRow('override-two',{family:target}));
      const prepared=await publishable(`conflict-${conflict}`,rows,source);
      const before=(await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id;
      const published=(await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count;
      const announcements=(await admin.query('SELECT count(*) FROM public.announcements')).rows[0].count;
      expect(await service.publish(actor('enabler'),prepared.request)).toMatchObject({ok:false,reason:'SOURCE_MISMATCH'});
      expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe(before);
      expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe(published);
      expect((await admin.query('SELECT count(*) FROM public.announcements')).rows[0].count).toBe(announcements);
      expect(value(await service.candidate(actor('enabler'),prepared.c.key.candidateId,prepared.c.key.version)).state).not.toBe('published');
    },60_000);

  it.each(['products','scenarios','half-open-time'] as const)('family: nonoverlapping %s allow two same-shop overrides',async dimension=>{
    await publicationBase();await cloneScopeGrants('brand');await familyVocabulary();
    await familyPublish('disjoint-root',[familyRow('root')],'brand');
    const first={family:'source-brand/root'},second={family:'source-brand/root'};
    const conditions=dimension==='products'?[{products:'product-one'},{products:'product-two'}]
      :dimension==='scenarios'?[{scenarios:'scenario-one'},{scenarios:'scenario-two'}]
        :[{from:'2020-01-01T00:00:00Z',to:'2021-01-01T00:00:00Z'},{from:'2021-01-01T00:00:00Z'}];
    await familyPublish(`disjoint-${dimension}`,[familyRow('first',{...first,...conditions[0]}),familyRow('second',{...second,...conditions[1]})]);
    const selected=dimension==='products'?{...usage,productIds:['product-two']}:dimension==='scenarios'?{...usage,scenarioIds:['scenario-two']}:usage;
    expect((await familySnapshot(selected)).entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`)).toEqual(['source-a/second']);
  },60_000);

  it('family: a disabled override does not block later explicit disable of its generic root',async()=>{
    await publicationBase();await cloneScopeGrants('brand');
    await familyPublish('disable-root',[familyRow('root')],'brand');
    await familyPublish('disable-child',[familyRow('child',{family:'source-brand/root'})]);
    await familyPublish('disable-child-next',[familyRow('child',{family:'source-brand/root',disabled:true})]);
    expect((await familySnapshot()).entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`)).toEqual(['source-brand/root']);
    await familyPublish('disable-root-next',[familyRow('root',{disabled:true})],'brand');
    expect((await familySnapshot()).entries).toEqual([]);
  },60_000);

  it('family: multiple selections retain every uncovered root cell and suppress only complete override coverage',async()=>{
    await publicationBase();await cloneScopeGrants('brand');await familyVocabulary();
    await familyPublish('multiselect-roots',[
      familyRow('protected',{products:'product-one',protected:true}),familyRow('wildcard'),
      familyRow('restricted',{products:'product-one,product-two'}),familyRow('covered'),familyRow('cross-gap'),
    ],'brand');
    await familyPublish('multiselect-children',[
      familyRow('protected-two',{family:'source-brand/protected',products:'product-two'}),
      familyRow('wildcard-one',{family:'source-brand/wildcard',products:'product-one'}),
      familyRow('restricted-one',{family:'source-brand/restricted',products:'product-one'}),
      familyRow('covered-one',{family:'source-brand/covered',products:'product-one',scenarios:'scenario-one,scenario-two'}),
      familyRow('covered-two',{family:'source-brand/covered',products:'product-two',scenarios:'scenario-one,scenario-two'}),
      familyRow('cross-one',{family:'source-brand/cross-gap',products:'product-one',scenarios:'scenario-one'}),
      familyRow('cross-two',{family:'source-brand/cross-gap',products:'product-two',scenarios:'scenario-two'}),
    ]);
    const context={...usage,productIds:['product-one','product-two'],scenarioIds:['scenario-one','scenario-two']};
    const result=await familySnapshot(context,3);
    expect(result.entries.map(e=>`${e.sourceId}/${e.entry.businessEntryId}`).sort()).toEqual([
      'source-a/covered-one','source-a/covered-two','source-a/cross-one','source-a/cross-two',
      'source-a/protected-two','source-a/restricted-one','source-a/wildcard-one',
      'source-brand/cross-gap','source-brand/protected','source-brand/restricted','source-brand/wildcard']);
    expect(result.pageSizes).toEqual([3,3,3,2]);
    expect((await familySnapshot({...context,productIds:['product-one'],scenarioIds:['scenario-one']},3)).entries
      .filter(e=>e.sourceId==='source-brand').map(e=>e.entry.businessEntryId)).toEqual(['protected']);
  },60_000);

  it('family: a historical catalog guard rejection fails closed for issuance and every existing snapshot page',async()=>{
    await publicationBase();await cloneScopeGrants('brand');
    await familyPublish('guard-root',[familyRow('root')],'brand');
    await familyPublish('guard-child',[familyRow('child',{family:'source-brand/root'})]);
    const entitlement=value(await issue()),logged=await seat();
    const count=(await admin.query('SELECT count(*) FROM content_intake.entitlements')).rows[0].count;
    // Fault injection at the shared SQL guard models a historical catalog which
    // no longer satisfies the invariant, without editing immutable evidence.
    let rejected=0;
    const guarded:IntakePool={async connect(){
      const client=await pool.connect();return new Proxy(client,{get(target,key){
        if(key==='query')return async(sql:string,args?:unknown[])=>{
          if(sql==='SELECT content_intake.assert_family_catalog($1::text)') {
            rejected++;throw Object.assign(new Error('SOURCE_MISMATCH'),{code:'ZA003'});
          }
          return target.query(sql,args);
        };
        const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
      }}) as PoolClient;
    }};
    const reader=createContentIntakeService(guarded,store);
    const expected={ok:false,code:'FORBIDDEN',reason:'SOURCE_MISMATCH',commit:'rolled_back'};
    expect(await reader.issueEntitlement(logged.actor,{...usage,releaseId:null})).toMatchObject(expected);
    expect(await reader.snapshot(logged.actor,{entitlementId:entitlement.entitlementId,limit:1})).toMatchObject(expected);
    expect(rejected).toBe(2);
    expect((await admin.query('SELECT count(*) FROM content_intake.entitlements')).rows[0].count).toBe(count);
  },60_000);

  it('family: use qualifications expire at both override boundaries before switching generic and shop answers',async()=>{
    await publicationBase();await cloneScopeGrants('brand');
    await familyPublish('lease-root',[familyRow('root',{body:'边界外的通用答案'})],'brand');
    const starts=Math.floor(Date.now()/1000)*1000+8000,ends=starts+2000;
    const startText=new Date(starts).toISOString(),endText=new Date(ends).toISOString();
    await familyPublish('lease-child',[familyRow('child',{family:'source-brand/root',body:'边界内的店铺答案',
      from:startText.replace('.000Z','Z'),to:endText.replace('.000Z','Z')})]);
    const before=value(await issue());expect(before.validUntil).toBe(startText);
    expect(value(await snapshot(before.entitlementId)).faq.map(e=>e.entry.answerText)).toEqual(['边界外的通用答案']);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,starts-Date.now())+30));
    expect(await snapshot(before.entitlementId)).toMatchObject({ok:false,reason:'LEASE_EXPIRED'});
    const active=value(await issue());expect(active.validUntil).toBe(endText);
    expect(value(await snapshot(active.entitlementId)).faq.map(e=>e.entry.answerText)).toEqual(['边界内的店铺答案']);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,ends-Date.now())+30));
    expect(await snapshot(active.entitlementId)).toMatchObject({ok:false,reason:'LEASE_EXPIRED'});
    const after=value(await issue());
    expect(value(await snapshot(after.entitlementId)).faq.map(e=>e.entry.answerText)).toEqual(['边界外的通用答案']);
  },60_000);

  async function rollbackPair() {
    await publicationBase();
    const first=await publishable('rollback-first');const target=value(await service.publish(actor('enabler'),first.request)).releaseId!;
    const second=await publishable('rollback-second',[['faq-one','合成问题','待纠正的合成正文','','','分类','','启用','','','','内部说明','','','false']]);
    const base=value(await service.publish(actor('enabler'),second.request)).releaseId!;
    return {first,second,base,target};
  }
  it('rollback: HTTP confirmed direct intent publishes a new release consumed by another seat and replays the original operation', async()=>{
    const {base,target}=await rollbackPair();const host=await managementHost();
    const post=(url:string,payload:unknown)=>host.app.inject({method:'POST',url,headers:{...host.headers,'content-type':'application/json'},payload:JSON.stringify(payload)});
    try {
      const preview=await post('/v1/intake/rollback/preview',{baseReleaseId:base,targetReleaseId:target});expect(preview.statusCode,preview.body).toBe(200);
      const p=parseContractSchema('IntakeRollbackImpact',preview.json());expect(p.scopes.map(s=>s.sourceId)).toEqual(['source-a']);
      for(const suffix of ['', '/refresh']){
        const disabled=await post(`/v1/intake/rollback/${p.rollbackPlanId}/review${suffix}`,{operationId:'disabled-rollback-review',impactDigest:p.impactDigest,expectedEvidenceVersion:0});
        expect(disabled.statusCode,disabled.body).toBe(409);expect(disabled.json()).toMatchObject({error:{details:{reason:'MODE_CONFLICT'}}});
      }
      const req:C['IntakeRollback']={operationId:'rollback-submit',rollbackPlanId:p.rollbackPlanId,baseReleaseId:base,targetReleaseId:target,impactDigest:p.impactDigest,confirmed:true};
      const submitted=await post('/v1/intake/rollback',req);expect(submitted.statusCode,submitted.body).toBe(202);
      const receipt=parseContractSchema('IntakeRollbackReceipt',submitted.json());expect(receipt.state).toBe('published');expect(receipt.releaseId).not.toBe(target);
      const ent=value(await issue());expect(ent.releaseId).toBe(receipt.releaseId);expect(value(await snapshot(ent.entitlementId)).faq[0]!.entry.answerText).toBe('第一行。\n第二行。');
      expect((await post('/v1/intake/rollback',req)).json()).toEqual(receipt);
      expect((await host.app.inject({url:'/v1/intake/operations/rollback-submit?action=rollback',headers:host.headers})).json()).toEqual(receipt);
      expect((await admin.query('SELECT count(*) FROM content_intake.review_bindings')).rows[0].count).toBe('0');
    } finally {await host.app.close();}
  });
  async function readyRollback() {
    const pair=await rollbackPair();
    const p=value(await service.rollbackPreview(actor('enabler'),{baseReleaseId:pair.base,targetReleaseId:pair.target}));
    const req:C['IntakeRollback']={operationId:'rollback-submit',rollbackPlanId:p.rollbackPlanId,baseReleaseId:pair.base,targetReleaseId:pair.target,impactDigest:p.impactDigest,confirmed:true};
    return {...pair,p,req};
  }
  it('rollback: lost COMMIT recovers the original permanent receipt without observing the provider again',async()=>{
    const {req}=await readyRollback();let lost=false;
    const uncertain:IntakePool={async connect(){const client=await pool.connect();let writing=false;return new Proxy(client,{get(target,key){
      if(key==='query')return async(sql:string,args?:unknown[])=>{const result=await target.query(sql,args);if(sql.includes('execute_rollback('))writing=true;
        if(sql==='COMMIT'&&writing&&!lost){lost=true;throw new Error('synthetic rollback COMMIT lost');}return result;};
      const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
    }}) as PoolClient;}};
    const first=createContentIntakeService(uncertain,store,(_id,e)=>diagnostics.push(e),createApprovalAdapter(route,provider.transport));
    expect(await first.rollback(actor('enabler'),req)).toMatchObject({ok:false,commit:'unknown',reason:'COMMIT_UNKNOWN'});
    const restarted=createContentIntakeService(pool,store);const receipt=value(await restarted.operationReceipt(actor('enabler'),req.operationId,'rollback'));
    const calls=provider.instanceCalls();expect(value(await restarted.rollback(actor('enabler'),req))).toEqual(receipt);expect(provider.instanceCalls()).toBe(calls);
    expect(await restarted.rollback(actor('enabler'),{...req,targetReleaseId:'different'})).toMatchObject({ok:false,reason:'IDEMPOTENCY_CONFLICT'});
    expect(await restarted.operationReceipt(actor('other'),req.operationId,'rollback')).toMatchObject({ok:false,code:'NOT_FOUND'});
    expect((await admin.query("SELECT count(*) FROM content_intake.publications WHERE action='rollback'")).rows[0].count).toBe('1');
  });

  it('rollback: a synthetic two-source catalog proves full impact authorization without exposing denied scopes',async()=>{
    await publicationBase();await cloneScopeGrants('b');let old='';let target='';
    for(const [label,source,text] of [['old-a','a','旧A'],['old-b','b','旧B'],['new-a','a','新A'],['new-b','b','新B']]){
      const candidate=await publishable(label,[['faq-one','合成问题',text!,'','','分类','','启用','','','','内部说明','','','false']],source);
      const release=value(await service.publish(actor('enabler'),candidate.request)).releaseId!;
      if(label==='old-b')old=release;if(label==='new-b')target=release;
    }
    // Test-only composite catalog fixture: native single-source publish cannot
    // change two shops at once. Preserve actual immutable source/candidate proofs.
    await admin.query('BEGIN');await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      SELECT 'rel_composite',nextval('public.content_release_seq'),'合成双来源差集','published',source_binding_hash,tenant_id FROM public.content_releases WHERE release_id=$1`,[old]);
    await admin.query(`INSERT INTO public.release_source_bindings SELECT 'rel_composite',domain,source_version_id FROM public.release_source_bindings WHERE release_id=$1`,[old]);
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES('rel_composite','intake-v2.1')");
    await admin.query(`INSERT INTO content_intake.release_lineage SELECT 'rel_composite',source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy FROM content_intake.release_lineage WHERE release_id=$1`,[old]);
    await admin.query("UPDATE public.content_current SET current_release_id='rel_composite' WHERE id=1");await admin.query('COMMIT');
    const full=value(await service.rollbackPreview(actor('enabler'),{baseReleaseId:'rel_composite',targetReleaseId:target}));
    expect(full.scopes.map(s=>s.sourceId)).toEqual(['source-a','source-b']);expect(full.requiresCorrectiveCandidate).toBe(false);
    value(await service.changeGrant(actor('director'),'business-enabler-rollback-b',{operationId:'partial-rb',expectedVersion:1,change:'revoke',reason:'合成部分权限',stewardPrincipalId:null}));
    const partial=value(await service.rollbackPreview(actor('enabler'),{baseReleaseId:'rel_composite',targetReleaseId:target}));
    expect(partial.scopes.map(s=>s.sourceId)).toEqual(['source-a']);expect(partial.requiresCorrectiveCandidate).toBe(true);
    expect(await service.rollback(actor('enabler'),{operationId:'partial-rollback',rollbackPlanId:partial.rollbackPlanId,baseReleaseId:'rel_composite',targetReleaseId:target,impactDigest:partial.impactDigest,confirmed:true})).toMatchObject({ok:false,reason:'SCOPE_DENIED'});
    expect((await admin.query('SELECT source_id FROM content_intake.rollback_scopes WHERE rollback_plan_id=$1 ORDER BY source_id',[partial.rollbackPlanId])).rows).toEqual([{source_id:'source-a'},{source_id:'source-b'}]);
  });

  it('rollback: preview cannot retain a plan after its consumed grant expires before COMMIT',async()=>{
    const {base,target}=await rollbackPair();
    value(await service.changeGrant(actor('director'),'business-enabler-rollback',{operationId:'short-revoke',expectedVersion:1,change:'revoke',reason:'合成短授权',stewardPrincipalId:null}));
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES('short-rollback','business','director','enabler','tenant-a','app-a','scope-a','source-a','rollback',clock_timestamp()-interval '1 second',clock_timestamp()+interval '0.2 seconds','合成短授权','director','root-rollback')`);
    const delayed:IntakePool={async connect(){const client=await pool.connect();return new Proxy(client,{get(target,key){
      if(key==='query')return async(sql:string,args?:unknown[])=>{const result=await target.query(sql,args);if(sql.includes('INSERT INTO content_intake.rollback_plans'))await target.query('SELECT pg_sleep(0.25)');return result;};
      const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
    }}) as PoolClient;}};
    expect(await createContentIntakeService(delayed,store).rollbackPreview(actor('enabler'),{baseReleaseId:base,targetReleaseId:target})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    expect((await admin.query('SELECT count(*) FROM content_intake.rollback_plans')).rows[0].count).toBe('0');
  });

  it('rollback: partial scopes require a corrective candidate and cannot leak the unowned source',async()=>{
    await publicationBase();await cloneScopeGrants('b');
    const first=await publishable('rb-scope-a');const target=value(await service.publish(actor('enabler'),first.request)).releaseId!;
    const second=await publishable('rb-scope-b',undefined,'b');const base=value(await service.publish(actor('enabler'),second.request)).releaseId!;
    value(await service.changeGrant(actor('director'),'business-enabler-rollback-b',{operationId:'rb-scope-revoke',expectedVersion:1,change:'revoke',reason:'合成撤权',stewardPrincipalId:null}));
    // This rollback affects only source-b, so no authorized impact remains.
    expect(await service.rollbackPreview(actor('enabler'),{baseReleaseId:base,targetReleaseId:target})).toMatchObject({ok:false,reason:'SCOPE_DENIED'});
    expect(await service.rollbackPreview(actor('agent'),{baseReleaseId:base,targetReleaseId:target})).toMatchObject({ok:false,reason:'SCOPE_DENIED'});
  });

  it('usage: another agent consumes only its selected shop and separately authorized brand, with safe durable pages', async () => {
    await publicationBase();await cloneScopeGrants('b');await cloneScopeGrants('brand');
    for (const source of ['a','b','brand']) {
      const c=await publishable(`usage-${source}`,[['faq-one','相同标题',`${source} 第一行。\n第二行。`,'','','分类','适用说明','启用','','','','管理内部说明','','','false']],source);
      value(await service.publish(actor('enabler'),c.request));
    }
    const ent=value(await issue());
    expect(ent.scopes.map(s=>s.sourceId).sort()).toEqual(['source-a','source-brand']);
    const first=value(await snapshot(ent.entitlementId,{limit:1}));
    expect(first.faq.map(f=>f.sourceId)).toEqual(['source-a']);expect(first.nextCursor).not.toBeNull();
    const restarted=createContentIntakeService(pool,store);
    const next=value(await restarted.snapshot((await seat()).actor,{entitlementId:ent.entitlementId,cursor:first.nextCursor,limit:1}));
    expect(next.faq.map(f=>f.sourceId)).toEqual(['source-brand']);expect(next.nextCursor).toBeNull();
    expect(next.releaseId).toBe(first.releaseId);
    expect(first.faq[0]!.entry.answerText).toBe('a 第一行。\n第二行。');
    expect(JSON.stringify([first,next])).not.toMatch(/internalNote|attachmentNote|管理内部说明/);
    expect(first).toMatchObject({sopNodes:[],sopEdges:[],media:[]});
    expect(await service.candidate(actor('agent'),'unknown',1)).toMatchObject({ok:false,code:'NOT_FOUND'});
    expect(await service.snapshot((await seat('agent','relogin')).actor,{entitlementId:ent.entitlementId})).toMatchObject({ok:false,code:'NOT_FOUND'});
    expect(await service.snapshot({...((await seat()).actor)},{entitlementId:ent.entitlementId})).toMatchObject({ok:false,code:'UNAUTHORIZED'});
    expect(await snapshot(ent.entitlementId,{shopId:'shop-b'})).toMatchObject({ok:false,code:'VALIDATION'});
    expect(await service.snapshot((await seat('other')).actor,{entitlementId:ent.entitlementId})).toMatchObject({ok:false,code:'NOT_FOUND'});
    expect(await snapshot(digest(ent.entitlementId))).toMatchObject({ok:false,code:'NOT_FOUND'});
    expect(await snapshot(ent.entitlementId,{limit:101})).toMatchObject({ok:false,code:'VALIDATION'});
    const other=value(await issue());
    expect(await snapshot(other.entitlementId,{cursor:first.nextCursor})).toMatchObject({ok:false,code:'VALIDATION'});
    expect((await admin.query('SELECT entitlement_hash FROM content_intake.entitlements')).rows.map(r=>r.entitlement_hash)).not.toContain(ent.entitlementId);
  });

  it.each(['logout','cleanup','disabled','expired'] as const)('usage: stored qualification immediately rejects a %s session', async change => {
    await publicationBase();const logged=await seat();const ent=value(await issue());
    const sessionHash=authenticatedProductSession(logged.actor)!;
    expect(sessionHash).toBe(digest(logged.token));
    expect(JSON.stringify(logged.actor)).not.toContain(sessionHash);
    expect(JSON.stringify(ent)).not.toContain(sessionHash);
    if(change==='logout')await auth!.logout(logged.token);
    if(change==='cleanup')await admin.query('DELETE FROM backend_identity.sessions WHERE token_hash=$1',[sessionHash]);
    if(change==='disabled')await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id='agent'");
    if(change==='expired')await admin.query("UPDATE backend_identity.sessions SET issued_at=statement_timestamp()-interval '20 minutes',expires_at=statement_timestamp()-interval '10 minutes' WHERE token_hash=$1",[sessionHash]);
    expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false});
    expect(await issue()).toMatchObject({ok:false});
    // Historical context survives session retention, but can never recreate authority.
    expect((await admin.query('SELECT count(*) FROM content_intake.entitlement_contexts')).rows[0].count).toBe('1');
  });

  it('usage: caps issuance at session expiry and reauthenticates persisted selection after a service restart', async () => {
    await publicationBase();const logged=await seat();
    const expiry=new Date(Date.now()+20_000);
    await admin.query('UPDATE backend_identity.sessions SET expires_at=$2 WHERE token_hash=$1',[digest(logged.token),expiry]);
    const ent=value(await issue());expect(ent.validUntil).toBe(expiry.toISOString());
    await auth!.close();
    auth=await createProductAuthService(authConfig,{authorizeUrl:s=>`http://127.0.0.1:45000/?state=${s}`,exchange:async c=>c,close:()=>undefined},'mock');
    const resumed=await auth.authenticate({authorization:`Bearer ${logged.token}`});
    const restarted=createContentIntakeService(pool,store);
    expect(value(await restarted.snapshot(resumed!,{entitlementId:ent.entitlementId})).faq).toEqual([]);
    expect(await restarted.issueEntitlement({...resumed!},{...usage,releaseId:null})).toMatchObject({ok:false,code:'UNAUTHORIZED'});
  });

  it('usage: validates explicit selections by kind and scope without expanding source access', async () => {
    await publicationBase();
    await admin.query("INSERT INTO content_intake.scopes VALUES ('scope-foreign','tenant-other','app-a','brand-a','shop-a','product')");
    for(const [id,kind,scopeId,active] of [
      ['Z-product','product','scope-a',true],['a-product','product','scope-a',true],
      ['brand-product','product','scope-brand',true],['scene','scenario','scope-a',true],
      ['other-shop','product','scope-b',true],['foreign','product','scope-foreign',true],
      ['inactive','product','scope-a',false],
    ]) await admin.query("INSERT INTO content_intake.vocabulary VALUES ($1,$2,$3,repeat('a',64),$4)",[id,scopeId,kind,active]);
    for(const productIds of [['missing'],['scene'],['other-shop'],['foreign'],['inactive']]) {
      expect(await issue({...usage,productIds})).toMatchObject({ok:false,code:'NOT_FOUND'});
    }
    for(const productIds of [['Z-product','Z-product'],Array.from({length:101},(_,i)=>`id-${i}`),['bad id']]) {
      expect(await issue({...usage,productIds})).toMatchObject({ok:false,code:'VALIDATION'});
    }
    const ent=value(await issue({...usage,productIds:['a-product','brand-product','Z-product'],scenarioIds:['scene']}));
    expect(ent.scopes.map(s=>s.sourceId)).toEqual(['source-a']);
    expect((await admin.query('SELECT product_ids FROM content_intake.entitlement_contexts')).rows).toEqual([{product_ids:['Z-product','a-product','brand-product']}]);
  });

  it.each(['reader-first','logout-first'] as const)('usage: linearizes the page with logout (%s)', async order => {
    await publicationBase();const logged=await seat();const ent=value(await issue());
    const control=await pool.connect();
    try {
      if(order==='logout-first') {
        await control.query('BEGIN');
        await control.query('UPDATE backend_identity.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[digest(logged.token)]);
        const reading=snapshot(ent.entitlementId);
        await control.query('COMMIT');
        expect(await reading).toMatchObject({ok:false,code:'UNAUTHORIZED'});
      } else {
        let reached!:()=>void;const atLock=new Promise<void>(r=>{reached=r;});
        let proceed!:()=>void;const resume=new Promise<void>(r=>{proceed=r;});
        const gated={connect:async()=>{
          const client=await pool.connect();
          return new Proxy(client,{get(target,key){
            if(key!=='query'){const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}
            return async(sql:string,args?:unknown[])=>{
              const result=await target.query(sql,args);
              if(sql.includes('intake_runtime.lock_product_session')){reached();await resume;}
              return result;
            };
          }});
        }};
        const reading=createContentIntakeService(gated,store).snapshot(logged.actor,{entitlementId:ent.entitlementId});
        await atLock;
        // NOWAIT proves the API holds a real session row lock until the page commits.
        try {
          await expect(control.query('SELECT 1 FROM backend_identity.sessions WHERE token_hash=$1 FOR UPDATE NOWAIT',[digest(logged.token)]))
            .rejects.toMatchObject({code:'55P03'});
        } finally {proceed();}
        expect(value(await reading).faq).toEqual([]);
        await auth!.logout(logged.token);
        expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false,code:'UNAUTHORIZED'});
      }
    } finally {await control.query('ROLLBACK');control.release();}
  });

  it('usage: Main consumes actual synthetic HTTP pages and handles publication and revocation', async () => {
    await publicationBase();
    // The first HTTP page exceeds the legacy client's 1 MiB default. The second
    // page proves the actual Main consumer assembles one complete qualification.
    const rows=[['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','','','false'],
      ...Array.from({length:100},(_,i)=>[`zz-large-${String(i).padStart(3,'0')}`,'合成长话术','合成答复'.repeat(1000),'','','分类','','启用','','','','内部说明','','','false'])];
    const prepared=await publishable('main-consumer',rows);
    const release=value(await service.publish(actor('enabler'),prepared.request));
    const logged=await seat();
    // Test-only loopback host. The API has no desktop import; the root-owned
    // consumer launches the actual desktop adapters across HTTP in isolation.
    let expireNext=false;let expiring:{id:string;until:number}|null=null;
    let holdNext=false;const gate:{release:(()=>void)|null}={release:null};
    const server=Fastify({logger:false,exposeHeadRoutes:false});
    let child:ReturnType<typeof spawn>|undefined;let ended:Promise<unknown[]>|undefined;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try {
      server.get('/v1/auth/me',async(request,reply)=>{
        const current=await authenticateRequestHeaders(auth!,request.headers);
        return current??reply.code(401).send({error:{code:'UNAUTHORIZED'}});
      });
      server.post('/v1/auth/logout',async(request,reply)=>{
        const header=request.headers.authorization;
        if(header?.startsWith('Bearer '))await auth!.logout(header.slice(7));
        return reply.code(204).send();
      });
      await server.register(contentIntakeUsageRoutes,{auth:auth!,usage:{
        authorizations:service.authorizations,sources:service.sources,vocabulary:service.vocabulary,shopDirectory:service.shopDirectory,
        issueEntitlement:async(current,body)=>{
          if(expireNext) {
            await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',2,ARRAY['dept-a'],'job-agent',true,
              clock_timestamp(),clock_timestamp()+interval '1 second',repeat('b',64))`);
            await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='agent'");
          }
          const result=await service.issueEntitlement(current,body);
          if(expireNext) {
            const short=value(result);expiring={id:short.entitlementId,until:Date.parse(short.validUntil)};expireNext=false;
            await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',3,ARRAY['dept-a'],'job-agent',true,
              clock_timestamp(),clock_timestamp()+interval '5 minutes',repeat('c',64))`);
            await admin.query("UPDATE content_intake.principals SET current_facts_version=3 WHERE principal_id='agent'");
          }
          return result;
        },
        snapshot:async(current,query)=>{
          if(holdNext){holdNext=false;await new Promise<void>(resolve=>{gate.release=resolve;});gate.release=null;}
          if(expiring?.id===(query as {entitlementId:string}).entitlementId) {
            await new Promise(r=>setTimeout(r,Math.max(0,expiring!.until-Date.now())+20));expiring=null;
          }
          return service.snapshot(current,query);
        },
      }});
      server.post('/__synthetic__/:action',async(request,reply)=>{
        if(!await authenticateRequestHeaders(auth!,request.headers))return reply.code(401).send();
        switch((request.params as {action:string}).action){
          case 'hold-next':holdNext=true;break;
          case 'gate':return {waiting:gate.release!==null};
          case 'release-gate':gate.release?.();break;
          case 'expire-next':expireNext=true;break;
          case 'next-release':{
            const next=await publishable('main-disable',rows.map(row=>row.map((cell,index)=>index===7?'停用':cell)));
            value(await service.publish(actor('enabler'),next.request));break;
          }
          case 'revoke':
            value(await service.changeGrant(actor('director'),'business-agent-query',
              {operationId:'main-revoke',expectedVersion:1,change:'revoke',reason:'合成撤权',stewardPrincipalId:null}));break;
          default:return reply.code(404).send();
        }
        return {ok:true};
      });
      const origin=await server.listen({port:0,host:'127.0.0.1'});
      for(const query of ['entitlementId=a&limit=0','entitlementId=a&limit=101','entitlementId=a&limit=1e2',
        'entitlementId=a&limit=1&limit=2','entitlementId=a&entitlementId=b','entitlementId=a&sessionId=spoof','entitlementId=a&cursor=']) {
        const rejected=await server.inject({url:`/v1/intake/snapshot?${query}`,headers:{authorization:`Bearer ${logged.token}`}});
        expect(rejected.statusCode).toBe(400);expect(parseContractSchema('IntakeError',rejected.json()).error.code).toBe('VALIDATION');
      }
      for(const headers of [{},{authorization:`Bearer ${logged.token}`,'x-mock-user':'spoof','x-mock-role':'owner'}]) {
        const rejected=await server.inject({url:'/v1/intake/snapshot?entitlementId=missing',headers});
        expect(rejected.statusCode).toBe(401);expect(parseContractSchema('IntakeError',rejected.json()).error.code).toBe('UNAUTHORIZED');
      }
      const spoofed=await server.inject({method:'POST',url:'/v1/intake/entitlements',headers:{authorization:`Bearer ${logged.token}`},
        payload:{...usage,releaseId:null,userId:'spoof'}});
      expect(spoofed.statusCode).toBe(400);expect(parseContractSchema('IntakeError',spoofed.json()).error.code).toBe('VALIDATION');
      child=spawn(process.execPath,[fileURLToPath(new URL('../../../scripts/probe-intake-usage-consumer.mjs',import.meta.url))],
        {stdio:['pipe','pipe','pipe']});
      ended=once(child,'close');let stdout='',stderr='';
      child.stdout!.on('data',chunk=>{stdout+=String(chunk);});child.stderr!.on('data',chunk=>{stderr+=String(chunk);});
      timeout=setTimeout(()=>child?.kill('SIGTERM'),45_000);
      child.stdin!.end(JSON.stringify({origin,token:logged.token,expiresAt:logged.expiresAt,releaseId:release.releaseId}));
      expect((await ended)[0],stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({status:'PASS',actualSession:true,discovery:true,largePage:true,cancellation:true,
        publishedText:true,localExpiry:true,normalUpdate:true,revocationFanout:true});
      expect(stdout+stderr).not.toContain(logged.token);expect(stdout+stderr).not.toContain(digest(logged.token));
    } finally {
      clearTimeout(timeout);gate.release?.();
      if(child && ended) {
        const kill=setTimeout(()=>child?.kill('SIGKILL'),2_000);
        if(child.exitCode===null)child.kill('SIGTERM');
        try {await ended;} catch(error) {diagnostics.push(error);}
        finally {clearTimeout(kill);}
      }
      await server.close();
    }
  },60_000);

  it('usage: contextless predecessor qualifications cannot be guessed or reused', async () => {
    await publicationBase();const ent=value(await issue());
    // Fault injection stands for a pre-0025 history row; no application role can do this.
    await admin.query('BEGIN; ALTER TABLE content_intake.entitlement_contexts DISABLE TRIGGER immutable_history');
    await admin.query('DELETE FROM content_intake.entitlement_contexts WHERE entitlement_hash=$1',[digest(ent.entitlementId)]);
    await admin.query('ALTER TABLE content_intake.entitlement_contexts ENABLE TRIGGER immutable_history; COMMIT');
    expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false,code:'NOT_FOUND'});
    expect(value(await issue()).entitlementId).not.toBe(ent.entitlementId);
  });

  it('usage: shop access does not imply brand access, and brand permission alone cannot select an arbitrary shop', async () => {
    await publicationBase();await cloneScopeGrants('brand');
    value(await service.changeGrant(actor('director'),'business-agent-query-brand',
      {operationId:'no-brand',expectedVersion:1,change:'revoke',reason:'合成品牌隔离',stewardPrincipalId:null}));
    expect(value(await issue()).scopes.map(s=>s.sourceId)).toEqual(['source-a']);
    expect(await issue({...usage,shopId:'shop-b'})).toMatchObject({ok:false,code:'NOT_FOUND'});
    value(await service.grantBatch(actor('director'),{...batch('agent','query','business','brand-only'),items:[{
      ...batch('agent','query').items[0]!,scope:{...scope,shopId:null,sourceId:'source-brand'}}]}));
    value(await service.changeGrant(actor('director'),'business-agent-query',
      {operationId:'no-shop',expectedVersion:1,change:'revoke',reason:'合成店铺撤权',stewardPrincipalId:null}));
    expect(await issue()).toMatchObject({ok:false,code:'NOT_FOUND'});
  });

  it.each(['grant','source','source-mapping','release','facts'] as const)('usage: denies every page after %s changes', async change => {
    await publicationBase();const c=await publishable();value(await service.publish(actor('enabler'),c.request));
    const ent=value(await issue());value(await snapshot(ent.entitlementId));
    if (change==='grant') value(await service.changeGrant(actor('director'),'business-agent-query',
      {operationId:'usage-revoke',expectedVersion:1,change:'revoke',reason:'合成坐席撤权',stewardPrincipalId:null}));
    if (change==='source') await admin.query("UPDATE content_intake.sources SET revocation_generation=revocation_generation+1 WHERE source_id='source-a'");
    if(change==='source-mapping'){
      await admin.query("INSERT INTO content_intake.source_mappings SELECT source_id,2,template_version,rule_version,mapping_version,structure_digest FROM content_intake.source_mappings WHERE source_id='source-a'");
      await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
    }
    if (change==='release') await admin.query('INSERT INTO content_intake.release_revocations VALUES ($1,1,\'合成失效\',clock_timestamp())',[ent.releaseId]);
    if (change==='facts') {
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',2,ARRAY['dept-a'],'job-agent',true,
        clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',repeat('b',64))`);
      await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='agent'");
    }
    expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false});
    if (change!=='source') expect(await issue()).toMatchObject({ok:false});
    expect((await admin.query('SELECT count(*) FROM content_intake.entitlements')).rows[0].count).toBe('1');
  });

  it('usage: a normal new publication preserves a valid old page and a fresh empty snapshot clears explicitly disabled rows', async () => {
    await publicationBase();const c=await publishable();const r=value(await service.publish(actor('enabler'),c.request));
    const old=value(await issue());
    const next=await publishable('disable',[['faq-one','合成问题','第一行。\n第二行。','','','分类','','停用','','','','内部说明','','','false']]);
    const published=value(await service.publish(actor('enabler'),next.request));
    expect(value(await snapshot(old.entitlementId)).faq).toHaveLength(1);
    expect(await issue(usage,r.releaseId)).toMatchObject({ok:false,reason:'BASE_CHANGED'});
    const fresh=value(await issue());expect(fresh.releaseId).toBe(published.releaseId);
    expect(value(await snapshot(fresh.entitlementId)).faq).toEqual([]);
  });

  it('usage: filters product/scenario/time before paging, pins vocabulary labels and expires at the next content boundary', async () => {
    await publicationBase();
    for (const [id,kind] of [['prod-one','product'],['scene-one','scenario']]) {
      await admin.query('INSERT INTO content_intake.vocabulary VALUES ($1,\'scope-a\',$2,repeat(\'a\',64),true)',[id,kind]);
      await admin.query('INSERT INTO content_intake.vocabulary_displays VALUES ($1,1,\'原始标签\')',[id]);
    }
    const boundary=new Date(Math.floor(Date.now()/1000)*1000+30_000).toISOString();
    const c=await publishable('selection',[
      ['faq-one','合成选品','正文','prod-one','scene-one','分类','','启用','2020-01-01T00:00:00Z',boundary.replace('.000Z','Z'),'','内部说明','','','false'],
      ['faq-two','未到生效时间','未来正文','','','分类','','启用','2098-01-01T00:00:00Z','','','','','','false'],
      ['faq-three','过期内容','过期正文','','','分类','','启用','2020-01-01T00:00:00Z','2021-01-01T00:00:00Z','','','','','false'],
    ]);value(await service.publish(actor('enabler'),c.request));
    await admin.query("INSERT INTO content_intake.vocabulary_displays VALUES ('prod-one',2,'新版标签')");
    const ctx={...usage,productIds:['prod-one'],scenarioIds:['scene-one']};
    const ent=value(await issue(ctx));expect(ent.validUntil).toBe(boundary);
    const page=value(await snapshot(ent.entitlementId));expect(page.faq.map(f=>f.entry.businessEntryId)).toEqual(['faq-one']);
    expect(page.vocabulary.map(v=>v.displayName)).toEqual(['原始标签','原始标签']);
    expect(await snapshot(ent.entitlementId,{productIds:[]})).toMatchObject({ok:false,code:'VALIDATION'});
    expect((await admin.query('SELECT product_ids,scenario_ids FROM content_intake.entitlement_contexts WHERE entitlement_hash=$1',[digest(ent.entitlementId)])).rows).toEqual([{product_ids:['prod-one'],scenario_ids:['scene-one']}]);
    const unselected=value(await issue());expect(value(await snapshot(unselected.entitlementId)).faq).toEqual([]);
  });

  it('usage: does not renew or return a page after its immutable deadline, even when facts are refreshed', async () => {
    await publicationBase();
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',2,ARRAY['dept-a'],'job-agent',true,
      clock_timestamp(),clock_timestamp()+interval '1 second',repeat('b',64))`);
    await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='agent'");
    const ent=value(await issue());
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',3,ARRAY['dept-a'],'job-agent',true,
      statement_timestamp(),statement_timestamp()+interval '5 minutes',repeat('c',64))`);
    await admin.query("UPDATE content_intake.principals SET current_facts_version=3 WHERE principal_id='agent'");
    const slow={async connect() {const client=await pool.connect();return new Proxy(client,{get(target,key) {
      if (key==='query') return async(sql:string,args?:unknown[])=>{
        const result=await target.query(sql,args);
        if (sql.includes('SELECT DISTINCT jsonb_build_object')) await target.query('SELECT pg_sleep(1.1)');
        return result;
      };
      const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
    }}) as PoolClient;}};
    expect(await createContentIntakeService(slow,store).snapshot((await seat()).actor,{entitlementId:ent.entitlementId}))
      .toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false,reason:'LEASE_EXPIRED'});
    expect(Date.parse(value(await issue()).validUntil)).toBeGreaterThan(Date.parse(ent.validUntil));
  });

  it('usage: consumes a maximum 5000-row native catalog within bounded transactions without duplicate or missing pages', async () => {
    await publicationBase();
    const rows=Array.from({length:5000},(_,i)=>[`faq-${String(i).padStart(4,'0')}`,'合成问题',`合成正文 ${i}`,'','','分类','','启用','','','','内部说明','','','false']);
    const c=await publishable('maximum',rows);value(await service.publish(actor('enabler'),c.request));
    const ent=value(await issue());
    const ids:string[]=[];let nextCursor:string|null=null;
    do {
      const page:C['IntakeSnapshot']=value(await snapshot(ent.entitlementId,{limit:100,...(nextCursor===null?{}:{cursor:nextCursor})}));
      ids.push(...page.faq.map(f=>f.entry.businessEntryId));nextCursor=page.nextCursor;
    } while (nextCursor!==null);
    expect(ids).toEqual(rows.map(r=>r[0]));expect(new Set(ids).size).toBe(5000);
  },60_000);

  it('usage: pages within the 100 vocabulary budget and rejects an individually unpageable candidate before review', async () => {
    await publicationBase();
    const products=Array.from({length:60},(_,i)=>`prod-${i}`),scenarios=Array.from({length:51},(_,i)=>`scene-${i}`);
    for (const [ids,kind] of [[products,'product'],[scenarios,'scenario']] as const) {
      await admin.query(`INSERT INTO content_intake.vocabulary SELECT id,'scope-a',$2,repeat('a',64),true FROM unnest($1::text[]) id`,[ids,kind]);
      await admin.query(`INSERT INTO content_intake.vocabulary_displays SELECT id,1,'合成标签' FROM unnest($1::text[]) id`,[ids]);
    }
    const row=(id:string,prod:string[],scene:string[])=>[id,'合成词项','完整正文',prod.join(','),scene.join(','),'分类','','启用','','','','','','','false'];
    const c=await publishable('vocabulary-budget',[row('faq-one',products,scenarios.slice(0,20)),row('faq-two',[],scenarios.slice(20))]);
    value(await service.publish(actor('enabler'),c.request));
    const ctx={...usage,productIds:products,scenarioIds:scenarios};const ent=value(await issue(ctx));
    const first=value(await snapshot(ent.entitlementId));expect(first.faq.map(f=>f.entry.businessEntryId)).toEqual(['faq-one']);
    expect(first.vocabulary).toHaveLength(80);expect(first.nextCursor).not.toBeNull();
    const second=value(await snapshot(ent.entitlementId,{cursor:first.nextCursor}));
    expect(second.faq.map(f=>f.entry.businessEntryId)).toEqual(['faq-two']);expect(second.vocabulary).toHaveLength(31);expect(second.nextCursor).toBeNull();
    const bad=await input('unpageable',null,[row('faq-one',products,scenarios)]);bad.baseReleaseId=ent.releaseId;
    const job=value(await service.receive(actor('enabler'),'source-a',bad));
    expect(await service.parse(actor('enabler'),job.jobId)).toMatchObject({ok:false,reason:'FILE_LIMIT'});
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('1');
  });

  it('publishes native material atomically without invented legacy fields, and recovers its permanent receipt', async () => {
    await publicationBase();
    const { c,request }=await publishable('native',[['faq-one','合成问题','多行。\n'+ '长正文'.repeat(1000),'','','分类','适用说明','启用','','','','管理内部说明','','','false']]);
    // Publish is independently delegated; it must not require review/manage authority.
    for (const action of ['review','content-manage']) value(await service.changeGrant(actor('director'),`business-enabler-${action}`,
      { operationId:`remove-${action}`,expectedVersion:1,change:'revoke',reason:'合成只保留发布资格',stewardPrincipalId:null }));
    const published = await service.publish(actor('enabler'),request);
    expect(published.ok,JSON.stringify(diagnostics)).toBe(true);
    const out=value(published);
    expect(out).toMatchObject({ state:'published',action:'publish',key:c.key });
    expect(value(await service.operationReceipt(actor('enabler'),request.operationId,'publish'))).toEqual(out);
    expect(value(await createContentIntakeService(pool,store).publish(actor('enabler'),request))).toEqual(out);
    expect(await service.publish(actor('enabler'),{ ...request,title:'不同载荷' })).toMatchObject({ ok:false,reason:'IDEMPOTENCY_CONFLICT' });
    expect(await service.publish(actor('other'),{ ...request,operationId:'another-publish' })).toMatchObject({ ok:false,reason:'ALREADY_PUBLISHED' });
    const stored=(await admin.query(`SELECT c.material->'entries' AS entries FROM content_intake.release_lineage l
      JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version WHERE l.release_id=$1`,[out.releaseId])).rows[0].entries;
    expect(stored[0]).toMatchObject({ answerText:'多行。\n'+'长正文'.repeat(1000),internalNote:'管理内部说明',attachmentNote:'',applicabilityNote:'适用说明' });
    expect((await admin.query('SELECT * FROM public.release_items WHERE release_id=$1',[out.releaseId])).rows).toEqual([]);
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe(out.releaseId);
    expect((await admin.query('SELECT release_id FROM public.announcements WHERE announcement_id=$1',[out.announcementId])).rows[0].release_id).toBe(out.releaseId);
    expect((await admin.query("SELECT consumed_at IS NOT NULL AS used,expires_at-issued_at<=interval '60 seconds' AS bounded FROM content_intake.commit_tickets")).rows).toEqual([{ used:true,bounded:true }]);
    await expect(admin.query('UPDATE content_intake.commit_tickets SET consumed_at=clock_timestamp()')).rejects.toMatchObject({ message:'TICKET_IMMUTABLE_OR_CONSUMED' });
    expect(await service.cancel(actor('other'),{ operationId:'cancel-published',key:c.key })).toMatchObject({ ok:false,reason:'ALREADY_PUBLISHED' });
  });

  it('retains missing rows, explicit disables and versions across subsequent native releases', async () => {
    await publicationBase();
    const first=await publishable('first',[
      ['faq-one','合成一','正文一','','','分类','','启用','','','','','','','false'],
      ['faq-two','合成二','正文二','','','分类','','启用','','','','','','','false'],
    ]);
    const r1=value(await service.publish(actor('enabler'),first.request));
    const second=await publishable('second',[['faq-one','合成一','正文一','','','分类','','停用','','','','','','','false']]);
    const r2=value(await service.publish(actor('enabler'),second.request));
    expect(r2.releaseId).not.toBe(r1.releaseId);
    const entries=(await admin.query(`SELECT e FROM content_intake.release_lineage l
      JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
      CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
      WHERE l.release_id=$1 AND e->>'businessEntryId'=l.business_entry_id ORDER BY l.business_entry_id`,[r2.releaseId])).rows;
    expect(entries.map(r => [r.e.businessEntryId,r.e.operation,r.e.scriptVersion])).toEqual([['faq-one','disable',2],['faq-two','upsert',1]]);
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('2');
  });

  it('capacity: measures tenfold publication history and a two-source CAS revision without losing the other source', async () => {
    await publicationBase();
    await cloneScopeGrants('b');
    const first = await publishable('race-a');
    const second = await publishable('race-b',undefined,'b');
    const before = performance.now();
    const published = value(await service.publish(actor('enabler'),first.request));
    expect(await service.publish(actor('enabler'),second.request)).toMatchObject({ok:false,reason:'BASE_CHANGED'});
    expect(provider.instances.size).toBe(0);
    const corrected = await publishable('race-b-again',undefined,'b');
    const after = value(await service.publish(actor('enabler'),corrected.request));
    expect(provider.instances.size).toBe(0);
    const lineage = (await admin.query(`SELECT to_jsonb(l)-'release_id' row FROM content_intake.release_lineage l
      WHERE source_id='source-a' AND release_id=ANY($1::text[]) ORDER BY release_id`,[[published.releaseId,after.releaseId]])).rows;
    expect(lineage).toHaveLength(2); expect(lineage[0]).toEqual(lineage[1]);
    console.log(JSON.stringify({probe:'two-source-cas',initialReviews:0,extraReviews:0,
      repeated:['parse-diff','source-confirmation','quality'],syntheticElapsedMs:performance.now()-before,
      publicationPolicy:'direct-v1',preservedOtherSource:true}));
    const start = performance.now();
    for (let n=3;n<=100;n++) {
      const next = await publishable(`history-${n}`, [['faq-one','合成问题',`合成修订 ${n}`,'','','分类','','启用','','','','','','','false']]);
      value(await service.publish(actor('enabler'),next.request));
      if(n===10 || n===100) {
        const checkStart=performance.now();
        const projection=await intakeCapacityDryRun(admin);
        const registered=Number((await admin.query('SELECT count(*) count FROM content_intake.publications')).rows[0].count);
        expect(registered).toBe(n);
        const orphaned=await admin.query(`SELECT 1 FROM content_intake.review_bindings b LEFT JOIN content_intake.objects o
          ON o.object_id=b.package_object_id WHERE o.object_id IS NULL`);
        expect(orphaned.rowCount).toBe(0);
        console.log(JSON.stringify({probe:'publication-history',publications:n,elapsedMs:performance.now()-start,
          dryRunMs:performance.now()-checkStart,objects:projection.registered.objects,allReviewReferencesPresent:true}));
      }
    }
    // Exercise the actual aggregate plan against the tenfold history; no N+1.
    const plan = await admin.query(`EXPLAIN (ANALYZE,FORMAT JSON) SELECT coalesce(sum(bytes),0)
      FROM content_intake.objects WHERE tenant_id='tenant-a'`);
    console.log(JSON.stringify({probe:'capacity-explain',plan:plan.rows[0]['QUERY PLAN']}));
  },180_000);

  it('copies every existing legacy field from a different domain without manufacturing review evidence', async () => {
    await seedSyntheticG1aRelease(admin);
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.publishing','on',true)");
    // Explicit test-only native baseline: no product adoption or identity inference.
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,status,source_binding_hash,tenant_id)
      SELECT 'rel_native_base',2,'published',source_binding_hash,'tenant-a' FROM public.content_releases WHERE release_id='rel_synthetic_g1a_v1'`);
    await admin.query(`INSERT INTO public.release_source_bindings SELECT 'rel_native_base',domain,source_version_id
      FROM public.release_source_bindings WHERE release_id='rel_synthetic_g1a_v1'`);
    await admin.query(`INSERT INTO public.release_items SELECT (jsonb_populate_record(NULL::public.release_items,
      to_jsonb(i)||jsonb_build_object('release_id','rel_native_base'))).* FROM public.release_items i
      WHERE release_id='rel_synthetic_g1a_v1' AND category<>'product'`);
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ('rel_native_base','intake-v2.1')");
    await admin.query("UPDATE public.content_current SET current_release_id='rel_native_base'");
    await admin.query("SELECT setval('public.content_release_seq',2,true)");
    await admin.query('COMMIT');
    const { request }=await publishable('legacy-other-domain');
    const published = await service.publish(actor('enabler'),request);
    expect(published.ok, JSON.stringify(diagnostics.map(error => error instanceof Error ? { ...error, message: error.message } : error))).toBe(true);
    const out=value(published);
    const before=(await admin.query("SELECT to_jsonb(i)-'release_id' AS row FROM public.release_items i WHERE release_id='rel_native_base' ORDER BY script_id")).rows;
    const after=(await admin.query("SELECT to_jsonb(i)-'release_id' AS row FROM public.release_items i WHERE release_id=$1 ORDER BY script_id",[out.releaseId])).rows;
    expect(before.length).toBeGreaterThan(0);expect(after).toEqual(before);
    expect((await admin.query('SELECT count(*) FROM public.owner_acceptance_records')).rows[0].count).toBe('0');
  });

  it.each(['quality','publisher-revoked','cancelled','source-version','suspended-source'] as const)(
    'publication rejects %s with zero release/ticket side effects', async gate => {
      await publicationBase(); const { c,request }=await publishable(gate);
      if (gate==='quality') {
        // New material cannot borrow the already-passed plan.
        const req=await input('unreviewed-revision',c.key);req.baseReleaseId=request.baseReleaseId;
        const revision=value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
        value((await confirm(revision,'revision-source')).result);
        request.key=revision.key;
      } else if (gate==='publisher-revoked') {
        const id='business-enabler-publish';
        value(await service.changeGrant(actor('director'),id,{ operationId:'gate-revoke',expectedVersion:1,change:'revoke',reason:'合成撤权',stewardPrincipalId:null }));
      } else if (gate==='cancelled') value(await service.cancel(actor('other'),{ operationId:'gate-cancel',key:c.key }));
      else if (gate==='suspended-source') await admin.query("SELECT public.suspend_authoritative_source('srcv_pub_aftersale','SOURCE_REVOKED','EVD-SYNTHETIC-REVOKE','synthetic-owner','owner')");
      else {
        await admin.query('BEGIN');
        await admin.query("INSERT INTO content_intake.source_mappings SELECT source_id,2,template_version,rule_version,mapping_version,structure_digest FROM content_intake.source_mappings WHERE source_id='source-a'");
        await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
        await admin.query('COMMIT');
      }
      expect(await service.publish(actor('enabler'),request)).toMatchObject({ ok:false });
      await noPublication();
    });

  it('rolls back ticket, catalog, candidate, current and release on a late announcement failure', async () => {
    await publicationBase();const { c,request }=await publishable();
    await admin.query(`CREATE FUNCTION public.synthetic_announcement_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic late failure'; END $$;
      CREATE TRIGGER synthetic_announcement_failure BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.synthetic_announcement_failure()`);
    expect(await service.publish(actor('enabler'),request)).toMatchObject({ ok:false,commit:'rolled_back' });
    await noPublication();
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,c.key.version)).state).toBe('ready');
    await admin.query('DROP TRIGGER synthetic_announcement_failure ON public.announcements');
    expect(value(await service.publish(actor('enabler'),request)).state).toBe('published');
  });

  it('recovers a lost publication COMMIT after restart without remote I/O or a second release', async () => {
    await publicationBase();const { request }=await publishable();let lost=false;
    const unreliable = { async connect() { const client=await pool.connect();let publishing=false;
      return new Proxy(client,{ get(target,key) {
        if (key==='query') return async (sql: string,args?: unknown[]) => {
          if (sql.includes('content_intake.publish_candidate')) publishing=true;
          const result=await target.query(sql,args);
          if (sql==='COMMIT' && publishing && !lost) { lost=true;throw new Error('synthetic publication response lost'); }
          return result;
        };
        return Reflect.get(target,key,target);
      } }) as PoolClient;
    } };
    const first=createContentIntakeService(unreliable,store,(_id,e)=>diagnostics.push(e),createApprovalAdapter(route,provider.transport));
    expect(await first.publish(actor('enabler'),request)).toMatchObject({ ok:false,commit:'unknown',reason:'COMMIT_UNKNOWN' });
    const restarted=createContentIntakeService(pool,store);
    const recovered=value(await restarted.operationReceipt(actor('enabler'),request.operationId,'publish'));
    expect(value(await restarted.publish(actor('enabler'),request))).toEqual(recovered);
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('1');
    expect((await admin.query('SELECT count(*) FROM content_intake.commit_tickets')).rows[0].count).toBe('1');
    expect(await restarted.operationReceipt(actor('other'),request.operationId,'publish')).toMatchObject({ ok:false });
  });

  it('commits once when cancellation waits behind the final publication transaction', async () => {
    await publicationBase();const { c,request }=await publishable();
    let reached!:()=>void;const committing=new Promise<void>(resolve=>{reached=resolve;});
    let resume!:()=>void;const released=new Promise<void>(resolve=>{resume=resolve;});
    let cancelledAtLock!:()=>void;const waiting=new Promise<void>(resolve=>{cancelledAtLock=resolve;});
    let publishing=false;
    const intercepted={ async connect() { const client=await pool.connect();return new Proxy(client,{ get(target,key) {
      if (key==='query') return async(sql:string,args?:unknown[])=>{
        if (publishing && sql==='SELECT backend_review.lock_content()') cancelledAtLock();
        const result=await target.query(sql,args);
        if (sql.includes('content_intake.publish_candidate')) { publishing=true;reached();await released; }
        return result;
      };
      const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
    } }) as PoolClient; } };
    const runner=createContentIntakeService(intercepted,store,(_id,e)=>diagnostics.push(e),createApprovalAdapter(route,provider.transport));
    const pending=runner.publish(actor('enabler'),request);await committing;
    const cancel=runner.cancel(actor('other'),{ operationId:'waiting-cancel',key:c.key });await waiting;resume();
    expect(value(await pending).state).toBe('published');
    expect(await cancel).toMatchObject({ ok:false,reason:'ALREADY_PUBLISHED' });
  });

  it('requires a new candidate and quality checks after another candidate wins the same base', async () => {
    await publicationBase();const first=await publishable('base-one');const second=await publishable('base-two');
    value(await service.publish(actor('enabler'),first.request));
    expect(await service.publish(actor('enabler'),second.request)).toMatchObject({ ok:false,reason:'BASE_CHANGED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('1');
  });

  it('refuses missing bootstrap and unmapped legacy-domain rows instead of silently replacing them', async () => {
    const empty=await publishable('no-base');
    expect(await service.publish(actor('enabler'),empty.request)).toMatchObject({ ok:false,reason:'MODE_CONFLICT' });
    await seedSyntheticG1aRelease(admin);
    const base='rel_synthetic_g1a_v1';
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ($1,'intake-v2.1')",[base]);
    const mixed=await publishable('legacy-members');
    expect(await service.publish(actor('enabler'),mixed.request)).toMatchObject({ ok:false,reason:'MODE_CONFLICT' });
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe(base);
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('0');
  });

  it('freezes quality before individual checks, survives service recreation and creates no approval or release', async () => {
    const c = await routine();
    expect(value(await service.quality(actor('enabler'),c.key)).state).toBe('not_frozen');
    expect(await service.checkQuality(actor('enabler'),{ operationId:'before-freeze',key:c.key,phase:'initial',checks:[] })).toMatchObject({ ok:false });
    const frozen = value(await freezeQuality(c));
    expect(frozen.state).toBe('initial_required');
    expect(value(await createContentIntakeService(pool,store).quality(actor('enabler'),c.key))).toEqual(frozen);
    expect(value(await service.freezeQuality(actor('other'),{ operationId:'another-freeze',key:c.key }))).toEqual(frozen);
    const req = { operationId:'quality-initial',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    const checked = await service.checkQuality(actor('enabler'),req);
    expect(checked.ok, diagnostics.map(e => e instanceof Error ? e.message : String(e)).join(' | ')).toBe(true);
    const result = value(checked);
    expect(result.state).toBe('passed'); // Routine self-review is allowed.
    expect(result.rounds[0]).toMatchObject({ checkedBy:'enabler',factsVersion:1,checks:req.checks });
    expect(value(await service.checkQuality(actor('enabler'),req))).toEqual(result);
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,c.key.version)).state).toBe('awaiting-evidence');
    for (const table of ['public.content_releases','content_intake.commit_tickets','content_intake.approval_facts']) {
      expect((await admin.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe('0');
    }
    await expect(admin.query("UPDATE content_intake.quality_plans SET plan='{}'::jsonb")).rejects.toMatchObject({ code:'ZA003' });
    await expect(admin.query('DELETE FROM content_intake.quality_rounds')).rejects.toMatchObject({ code:'ZA003' });
  });

  it('rejects omitted, invented, duplicate, changed-content and caller-supplied quality conclusions atomically', async () => {
    const c = await routine(); const p = value(await freezeQuality(c)); const checks = qualityChecks(p);
    const req = { operationId:'invalid-check',key:c.key,phase:'initial',checks };
    for (const bad of [[],[...checks,...checks],[{ ...checks[0]!,contentHash:'f'.repeat(64) }],
      [{ ...checks[0]!,scriptId:`intake_${'f'.repeat(64)}` }],[{ ...checks[0]!,defect:true,reason:'' }]]) {
      expect(await service.checkQuality(actor('reviewer'),{ ...req,checks:bad })).toMatchObject({ ok:false,code:'VALIDATION' });
    }
    expect(await service.checkQuality(actor('reviewer'),{ ...req,conclusion:'passed' })).toMatchObject({ ok:false,code:'VALIDATION' });
    expect(await service.checkQuality(actor('reviewer'),{ ...req,key:{ ...c.key,digest:'f'.repeat(64) } })).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    await expect(admin.query(`INSERT INTO content_intake.quality_rounds VALUES ($1,$2,$3,'initial','[]','reviewer',1,clock_timestamp())`,
      [c.key.candidateId,c.key.version,c.key.digest])).rejects.toMatchObject({ message:'QUALITY_SAMPLE_MISMATCH' });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('0');
    expect((await admin.query("SELECT count(*) FROM backend_review.receipts WHERE operation='intake:quality-check'")).rows[0].count).toBe('0');
    expect(value(await service.checkQuality(actor('reviewer'),req)).state).toBe('passed');
  });

  it.each([[2,'revision_required'],[3,'expansion_required'],[5,'expansion_required'],[6,'blocked']] as const)(
    'derives the 501-row quality state with %s initial defects as %s', async (defects,state) => {
      const rows = Array.from({ length:501 },(_,n) => [`faq-${n}`,'合成标题','合成正文','','','分类','','启用','','','','','','','false']);
      const req = await input('quality-rounds-large',null,rows);
      const c = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
      const frozen = value(await freezeQuality(c));
      expect(await service.checkQuality(actor('reviewer'),{ operationId:'too-early',key:c.key,phase:'expanded',checks:qualityChecks(frozen,'expanded') })).toMatchObject({ ok:false });
      const initial = value(await service.checkQuality(actor('reviewer'),{ operationId:'initial-round',key:c.key,phase:'initial',checks:qualityChecks(frozen,'initial',defects) }));
      expect(initial.state).toBe(state);
      if (state === 'expansion_required') {
        const expanded = qualityChecks(initial,'expanded');
        const altered = expanded.map(c => ({ ...c,defect:false,reason:'' }));
        expect(await service.checkQuality(actor('reviewer'),{ operationId:'changed-prior',key:c.key,phase:'expanded',checks:altered })).toMatchObject({ ok:false,code:'VALIDATION' });
        const final = value(await service.checkQuality(actor('reviewer'),{ operationId:'expanded-round',key:c.key,phase:'expanded',checks:expanded }));
        expect(final.state).toBe('revision_required');
        expect(final.rounds).toHaveLength(2);
      }
      expect(await service.checkQuality(actor('reviewer'),{ operationId:'retry-new-key',key:c.key,phase:'initial',checks:qualityChecks(frozen) })).toMatchObject({ ok:false });
    });

  it('records all 5000 critical checks within the unchanged transaction budget', async () => {
    const rows = Array.from({ length:5000 },(_,n) => [`faq-${n}`,'合成标题','合成正文','','','分类','','启用','','','','','合成风险','','false']);
    const req = await input('quality-max-critical',null,rows);
    const c = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
    const frozen = value(await freezeQuality(c));
    expect(frozen.plan?.mandatoryCount).toBe(5000);
    const checked = await service.checkQuality(actor('reviewer'),{ operationId:'quality-max-check',key:c.key,phase:'initial',checks:qualityChecks(frozen) });
    expect(checked.ok,diagnostics.map(e => e instanceof Error ? e.message : String(e)).join(' | ')).toBe(true);
    expect(value(checked).state).toBe('passed');
    expect((await admin.query('SELECT jsonb_array_length(checks) AS count FROM content_intake.quality_rounds')).rows).toEqual([{ count:5000 }]);
  },30_000);

  it('requires a non-contributing person for critical quality and refuses reuse after revision', async () => {
    const c = await candidate(); const frozen = value(await freezeQuality(c));
    expect(frozen.plan?.mandatoryCount).toBe(1);
    const req = { operationId:'critical-quality',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    for (const id of ['enabler','other']) expect(await service.checkQuality(actor(id),req)).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    expect(value(await service.checkQuality(actor('reviewer'),req)).state).toBe('passed');
    const revision = await input('quality-revision',c.key);
    const next = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',revision)).jobId));
    expect(value(await service.quality(actor('reviewer'),next.key)).state).toBe('not_frozen');
    expect(await service.quality(actor('reviewer'),c.key)).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    expect(await service.checkQuality(actor('reviewer'),{ ...req,key:next.key,operationId:'stale-new-version' })).toMatchObject({ ok:false });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('1');
  });

  it('rechecks scope, revocation and cancellation before recording quality', async () => {
    const c = await routine(); const frozen = value(await freezeQuality(c));
    const req = { operationId:'denied-quality',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    expect(await service.checkQuality(actor('agent'),req)).toMatchObject({ ok:false });
    value(await service.changeGrant(actor('director'),'business-reviewer-review',{ operationId:'revoke-quality',expectedVersion:1,change:'revoke',stewardPrincipalId:null,reason:'合成撤权' }));
    expect(await service.checkQuality(actor('reviewer'),req)).toMatchObject({ ok:false });
    value(await service.cancel(actor('enabler'),{ operationId:'cancel-quality',key:c.key }));
    expect(await service.checkQuality(actor('enabler'),req)).toMatchObject({ ok:false });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('0');
  });

  it('recovers a lost quality COMMIT once and rejects changed payload under the original operation', async () => {
    const c = await routine(); const frozen = value(await freezeQuality(c));
    let injected = false;
    const uncertainPool = { async connect() {
      const client = await pool.connect();
      return new Proxy(client,{ get(target,key) {
        if (key === 'query') return async (sql: string,values?: unknown[]) => {
          const result = await target.query(sql,values);
          if (sql === 'COMMIT' && !injected) { injected=true; throw new Error('synthetic quality response lost'); }
          return result;
        };
        const member: unknown = Reflect.get(target,key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const req = { operationId:'uncertain-quality',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    expect(await createContentIntakeService(uncertainPool,store).checkQuality(actor('enabler'),req)).toMatchObject({ ok:false,commit:'unknown' });
    expect(value(await service.checkQuality(actor('enabler'),req)).state).toBe('passed');
    expect(await service.checkQuality(actor('enabler'),{ ...req,checks:req.checks.map(c => ({ ...c,defect:true,reason:'changed' })) }))
      .toMatchObject({ ok:false,reason:'IDEMPOTENCY_CONFLICT' });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('1');
  });

  it('quality preview preserves the candidate and is actually consumable by the existing SQL plan freezer', async () => {
    const c = await routine();
    const before = (await admin.query('SELECT * FROM content_intake.candidate_versions')).rows;
    const p = value(await service.qualityPreview(actor('reviewer'),c.key));
    expect(p.purpose).toBe('synthetic-quality-preview');
    expect(p.entries[0]?.entry.answerText).toBe('第一行。\n第二行。');
    expect(p.entries[0]?.entry.internalNote).toBe('内部说明');
    expect(p.initialScriptIds).toEqual(p.population.map(r => r.script_id));
    expect(value(await service.qualityPreview(actor('reviewer'),c.key))).toEqual(p);
    expect((await admin.query('SELECT * FROM content_intake.candidate_versions')).rows).toEqual(before);
    expect((await admin.query('SELECT count(*) FROM public.content_quality_review_plans')).rows[0].count).toBe('0');
    await freezeQualityProbe(p);
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.content_quality_review_evidence')).rows[0].count).toBe('0');
  });

  it('quality SQL requires expanded review and rejects a fabricated passing conclusion', async () => {
    const rows = Array.from({ length:501 }, (_, n) => [`faq-${n}`,'合成标题','合成正文','','','分类','','启用','','','','','','','false']);
    const req = await input('quality-large',null,rows);
    const c = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
    const p = value(await service.qualityPreview(actor('reviewer'),c.key));
    expect(p.initialScriptIds).toHaveLength(100);
    expect(p.expandedScriptIds).toHaveLength(151);
    expect(p.initialScriptIds.every(id => p.expandedScriptIds.includes(id))).toBe(true);
    const plan = await freezeQualityProbe(p);
    const record = (expanded: number | null, defects: number | null, conclusion: string) => admin.query(
      `SELECT public.record_content_quality_review_evidence($1,100,3,$2,$3,0,0,491,10,$4,'synthetic-quality-evidence','content_quality_reviewer')`,
      [plan,expanded,defects,conclusion]);
    await expect(record(null,null,'passed')).rejects.toMatchObject({ detail:'QUALITY_EXPANSION_REQUIRED' });
    await expect(record(151,10,'passed')).rejects.toMatchObject({ detail:'QUALITY_THRESHOLD_MISMATCH' });
    expect((await admin.query('SELECT count(*) FROM public.content_quality_review_evidence')).rows[0].count).toBe('0');
    await record(151,10,'blocked');
    expect((await admin.query('SELECT conclusion FROM public.content_quality_review_evidence')).rows).toEqual([{ conclusion:'blocked' }]);
    expect((await admin.query('SELECT quality_gate_passed FROM public.import_batches')).rows).toEqual([{ quality_gate_passed:false }]);
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
  });

  it('critical quality population requires every live entry and does not fabricate owner acceptance', async () => {
    const c = await candidate();
    value((await confirm(c)).result);
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,c.key.version)).readinessReasons).toContain('QUALITY_NOT_PASSED');
    const p = value(await service.qualityPreview(actor('reviewer'),c.key));
    expect(p).toMatchObject({ ordinaryCount:0,mandatoryCount:1,initialTarget:0,expandedTarget:0 });
    expect(p.initialScriptIds).toEqual(p.population.map(r => r.script_id));
    expect(p.expandedScriptIds).toEqual(p.initialScriptIds);
    const plan = await freezeQualityProbe(p);
    await expect(admin.query(`SELECT public.record_content_quality_review_evidence($1,0,0,NULL,NULL,0,0,1,0,'passed','synthetic-evidence','content_quality_reviewer')`,[plan]))
      .rejects.toMatchObject({ detail:'QUALITY_EVIDENCE_INVALID' });
    await admin.query(`SELECT public.record_content_quality_review_evidence($1,0,0,NULL,NULL,1,0,1,0,'passed','synthetic-evidence','content_quality_reviewer')`,[plan]);
    // Native human approval and a quality pass are neither legacy owner evidence
    // nor a P2 publication. Even the old purpose needs a separately registered record.
    for (const purpose of ['native-intake-approval','g1a_offline_only']) await expect(admin.query(
      "SELECT public.assert_owner_acceptance('tenant-a',$1,repeat('a',64),$2,'{}'::jsonb)", [c.key.digest,purpose]))
      .rejects.toMatchObject({ message:'OWNER_ACCEPTANCE_NOT_ACTIVE' });
    expect((await admin.query('SELECT count(*) FROM public.owner_acceptance_records')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM content_intake.commit_tickets')).rows[0].count).toBe('0');
  });

  it('quality preview rechecks role, current grants, the exact key and cancellation on every read', async () => {
    const c = await routine();
    expect(await service.qualityPreview(actor('agent'),c.key)).toMatchObject({ ok:false,code:'NOT_FOUND' });
    expect(await service.qualityPreview(actor('reviewer'),{ ...c.key,digest:'a'.repeat(64) })).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    value(await service.qualityPreview(actor('reviewer'),c.key));
    value(await service.changeGrant(actor('director'),'business-reviewer-review',
      { operationId:'revoke-quality-reviewer',expectedVersion:1,change:'revoke',stewardPrincipalId:null,reason:'合成质量预览撤权' }));
    expect(await service.qualityPreview(actor('reviewer'),c.key)).toMatchObject({ ok:false,code:'NOT_FOUND' });
    value(await service.cancel(actor('enabler'),{ operationId:'cancel-quality',key:c.key }));
    expect(await service.qualityPreview(actor('other'),c.key)).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
  });

  it('ignores the login owner label; enabler needs an exact shop/source business grant', async () => {
    value(await service.authorization(actor('enabler'), 'source-a', 'import'));
    expect(await service.authorization(actor('agent'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    value(await service.authorization(actor('agent'), 'source-a', 'query'));
    expect(await service.authorization(actor('director'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    for (const id of ['source-b','source-brand','missing']) expect(await service.authorization(actor('enabler'), id, 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a','job-lead',1,'agent') ON CONFLICT (tenant_id,app_id,department_id,job_id) DO UPDATE SET role='agent'");
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
    const delegation = value(await service.grantBatch(actor('director'), batch('manager', 'import', 'delegation'))).items[0]!;
    const delegated = batch('supervisor', 'import', 'business', 'delegated');
    delegated.items[0]!.expiresAt = new Date(Date.parse(delegation.expiresAt)-1000).toISOString();
    value(await service.grantBatch(actor('manager'), delegated));
    expect(await service.grantBatch(actor('manager'), batch('director','import','delegation','again'))).toMatchObject({ ok: false, reason: 'GRANT_AUTHORITY_DENIED' });
    const revoked = value(await service.changeGrant(actor('director'), delegation.grantId,
      { operationId: 'revoke', expectedVersion: 1, change: 'revoke', stewardPrincipalId: null, reason: '合成撤资格' }));
    expect(revoked.version).toBe(2);
    const child = (await admin.query("SELECT * FROM content_intake.grants WHERE parent_grant_id=$1", [delegation.grantId])).rows[0];
    expect(child).toMatchObject({ issuer_id: 'manager', revoked_at: null, steward_id: null, version: '2', reason: '合成授权', last_change_reason: '合成撤资格' });
    value(await service.authorization(actor('supervisor'), 'source-a', 'import'));
    expect(await service.grantBatch(actor('manager'), { ...delegated, operationId: 'after-revocation' })).toMatchObject({ ok: false, reason: 'GRANT_AUTHORITY_DENIED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.grant_history WHERE grant_id=$1', [child.grant_id])).rows[0].count).toBe('2');
    for (const recipient of ['agent', 'enabler', 'supervisor', 'legacy-enabler']) {
      expect(await service.grantBatch(actor('director'), batch(recipient, 'import', 'delegation', `deny-${recipient}`)))
        .toMatchObject({ ok: false, reason: 'ROLE_CEILING' });
    }
    expect(await service.authorization(actor('agent'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
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

  it('rejects a supervisor allocation for new grants while a director can take over and revoke', async () => {
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('new-supervisor','allocation','director','supervisor','tenant-a','app-a','scope-a','source-a','import',clock_timestamp()-interval '1 second',clock_timestamp()+interval '10 minutes','合成新任范围负责人','director')`);
    const takeover = { operationId: 'new-steward', expectedVersion: 1, change: 'takeover' as const, stewardPrincipalId: 'director', reason: '合成接管' };
    expect(await service.changeGrant(actor('supervisor'), 'business-enabler-import', takeover)).toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
    expect(await service.grantBatch(actor('supervisor'), batch('manager'))).toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
    expect((await admin.query("SELECT revoked_at FROM content_intake.grants WHERE grant_id='new-supervisor'")).rows[0].revoked_at).toBeNull();
    const changed = value(await service.changeGrant(actor('director'), 'business-enabler-import', takeover));
    expect(changed).toMatchObject({ issuerPrincipalId: 'director', stewardPrincipalId: 'director', version: 2, revokedAt: null });
    value(await service.authorization(actor('enabler'), 'source-a', 'import'));
    value(await service.changeGrant(actor('director'), changed.grantId, { ...takeover, operationId: 'new-steward-revoke', expectedVersion: 2, change: 'revoke', stewardPrincipalId: null }));
    expect(await service.authorization(actor('enabler'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await admin.query("SELECT revoked_at IS NULL AS live FROM content_intake.grants WHERE grant_id='new-supervisor'")).rows[0].live).toBe(true);
  });

  it('keeps a historical enabler business grant and rejects new import, publish and allocation', async () => {
    const row = (await admin.query("SELECT grant_id,kind,action,revoked_at FROM content_intake.grants WHERE grant_id='legacy-enabler-import'")).rows[0];
    expect(row).toMatchObject({ kind: 'business', action: 'import', revoked_at: null });
    expect(await service.authorization(actor('legacy-enabler'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.authorization(actor('legacy-enabler'), 'source-a', 'publish')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.grantBatch(actor('legacy-enabler'), batch('manager', 'query', 'business', 'legacy-assign'))).toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
    expect(await service.grantBatch(actor('director'), batch('legacy-enabler', 'import', 'business', 'legacy-new-import'))).toMatchObject({ ok: false, reason: 'ROLE_CEILING' });
    expect(await service.grantBatch(actor('director'), batch('legacy-enabler', 'publish', 'business', 'legacy-new-publish'))).toMatchObject({ ok: false, reason: 'ROLE_CEILING' });
    value(await service.authorization(actor('legacy-enabler'), 'source-a', 'query'));
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE grant_id='legacy-enabler-import' AND revoked_at IS NULL")).rows[0].count).toBe('1');
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
    expect(c.readinessReasons).toContain('QUALITY_NOT_PASSED');
    expect(c.publicationPolicy).toBe('direct-v1');
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
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('enabler',2,ARRAY['dept-a'],'job-lead',true,
      statement_timestamp()-interval '10 seconds',statement_timestamp()+interval '0.2 seconds',repeat('b',64))`);
    await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='enabler'");
    const waiting = service.authorization(actor('enabler'), 'source-a', 'import');
    await admin.query('SELECT pg_sleep(0.25)');
    await admin.query('COMMIT');
    expect(await waiting).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('0');
  });
  it.each(['director','manager','supervisor','enabler'] as const)('direct HTTP: %s uploads, passes real quality checks and publishes without approval', async id => {
    await publicationBase();
    if(id==='director')await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,to_jsonb(g)||jsonb_build_object('grant_id','manager-root-'||action,'recipient_id','manager'))).* FROM content_intake.grants g WHERE kind='allocation' AND recipient_id='director'`);
    if (id !== 'enabler') await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
      to_jsonb(g)||jsonb_build_object('grant_id','four-post-'||$1||'-'||action,'recipient_id',$1::text,'issuer_id',CASE WHEN $1='director' THEN 'manager' ELSE issuer_id END,'parent_grant_id',CASE WHEN $1='director' THEN 'manager-root-'||action ELSE parent_grant_id END))).*
      FROM content_intake.grants g WHERE recipient_id='enabler' AND kind='business'`,[id]);
    const host=await managementHost(store,pool,provider.transport,label,id);
    try {
      const f=await httpCandidate(host,`four-post-${id}`);expect(f.c.publicationPolicy).toBe('direct-v1');
      expect(f.c.approvalEvidenceVersion).toBe(0);expect(f.c.readinessReasons).not.toContain('AWAITING_APPROVAL');
      await httpConfirm(f);await httpQuality(host,f.c);
      const published=await f.post('publish',f.publish);expect(published.status,JSON.stringify({body:await published.clone().text(),diagnostics:diagnostics.map(e=>String(e))})).toBe(202);
      const receipt=parseContractSchema('IntakeReceipt',await published.json());
      const headers={authorization:`Bearer ${(await seat('agent')).token}`,'content-type':'application/json'};
      const issued=await host.app.inject({method:'POST',url:'/v1/intake/entitlements',headers,payload:{...usage,releaseId:receipt.releaseId}});
      expect(issued.statusCode,issued.body).toBe(200);
      const page=await host.app.inject({url:`/v1/intake/snapshot?entitlementId=${issued.json<C['IntakeEntitlement']>().entitlementId}`,headers});
      expect(page.statusCode,page.body).toBe(200);expect(page.json<C['IntakeSnapshot']>().faq[0]?.entry.answerText).toBe('第一行。\n第二行。');
      for(const table of ['review_bindings','approval_facts','release_rollback_lineage'])expect((await admin.query(`SELECT count(*) FROM content_intake.${table}`)).rows[0].count).toBe('0');
      expect((await admin.query(`SELECT publication_policy,confirmed_at IS NOT NULL AS confirmed FROM content_intake.publications`)).rows).toEqual([{publication_policy:'direct-v1',confirmed:true}]);
      expect((await admin.query(`SELECT reviewer_facts_version,reviewer_generation,approval_facts_version,approval_generation,publication_policy FROM content_intake.commit_tickets`)).rows).toEqual([
        {reviewer_facts_version:null,reviewer_generation:null,approval_facts_version:null,approval_generation:null,publication_policy:'direct-v1'}]);
      expect(provider.calls()).toBe(0);
    }finally{await host.app.close();}
  },40_000);

  it('direct HTTP: disabled approval commands, invalid confirmation and query-only identities cannot create writes',async()=>{
    await publicationBase();const host=await managementHost();
    try{
      const f=await httpCandidate(host,'direct-denials');
      for(const suffix of ['review','review/refresh']){
        const result=await f.post(suffix,reviewRequest(f.c));expect(result.status).toBe(409);
        expect(await result.json()).toMatchObject({error:{code:'CONFLICT',details:{reason:'MODE_CONFLICT'}}});
      }
      const {confirmed: _confirmed,...missing}=f.publish;
      for(const body of [missing,{...f.publish,confirmed:false},{...f.publish,confirmed:'true'},{...f.publish,approvalEvidenceVersion:1},{...f.publish,publicationPolicy:'approval-v1'}])expect((await f.post('publish',body)).status).toBe(400);
      for(const id of ['agent','legacy-enabler']){
        const headers={authorization:`Bearer ${(await seat(id)).token}`};
        expect((await f.post('publish',f.publish,headers)).status).toBe(404);
        const form=new FormData();form.set('operationId',`denied-upload-${id}`);form.set('file',new Blob([new Uint8Array(await httpWorkbook())]),'synthetic.xlsx');
        expect((await fetch(`${host.origin}/v1/intake/sources/source-a/objects`,{method:'POST',headers,body:form})).status).toBe(404);
      }
      expect(provider.calls()).toBe(0);await noPublication();
    }finally{await host.app.close();}
  });

  it('direct publication rolls every write back when its consumed authority expires before COMMIT',async()=>{
    await publicationBase();const {request}=await publishable('late-authority');
    value(await service.changeGrant(actor('director'),'business-enabler-publish',{operationId:'replace-publish-grant',expectedVersion:1,change:'revoke',reason:'合成到期检查',stewardPrincipalId:null}));
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES('short-publish','business','director','enabler','tenant-a','app-a','scope-a','source-a','publish',clock_timestamp()-interval '1 second',clock_timestamp()+interval '0.3 seconds','合成短授权','director','root-publish')`);
    const delayed:IntakePool={async connect(){const client=await pool.connect();return new Proxy(client,{get(target,key){
      if(key==='query')return async(sql:string,args?:unknown[])=>{const result=await target.query(sql,args);if(sql.includes('SELECT content_intake.publish_candidate('))await target.query('SELECT pg_sleep(0.35)');return result;};
      const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
    }})as PoolClient;}};
    expect(await createContentIntakeService(delayed,store).publish(actor('enabler'),request)).toMatchObject({ok:false,commit:'rolled_back'});await noPublication();
  });

  it('direct publication keeps a currently live content deadline through the final COMMIT',async()=>{
    await publicationBase();
    const boundary=new Date(Math.ceil(Date.now()/1000)*1000+3_000).toISOString();
    const {request}=await publishable('late-content',[
      ['faq-one','合成限时问题','合成正文','','','分类','','启用','2020-01-01T00:00:00Z',boundary.replace('.000Z','Z'),'','','','','false'],
    ]);
    let reachedFinalWrite=false;
    const delayed:IntakePool={async connect(){const client=await pool.connect();return new Proxy(client,{get(target,key){
      if(key==='query')return async(sql:string,args?:unknown[])=>{const result=await target.query(sql,args);
        if(sql.includes('SELECT content_intake.publish_candidate(')){reachedFinalWrite=true;await target.query('SELECT pg_sleep($1)',[Math.max(0,Date.parse(boundary)-Date.now())/1000+0.05]);}return result;};
      const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
    }})as PoolClient;}};
    expect(await createContentIntakeService(delayed,store).publish(actor('enabler'),request)).toMatchObject({ok:false,commit:'rolled_back'});
    expect(reachedFinalWrite).toBe(true);
    await noPublication();
  });

  // Explicit historical fixture: immutable approval-v1 records are inserted as
  // pre-existing history. No application API creates an approval or changes policy.
  async function legacyHistory(label='legacy') {
    const inputRequest=await input(`${label}-input`,null,[['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','','','false']]);
    inputRequest.baseReleaseId=(await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0]?.current_release_id??null;
    const c=value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',inputRequest)).jobId));
    const confirmed=value((await confirm(c,`${label}-source`)).result);
    const id=`history-${label}`,reviewId=`history-review-${label}`;
    await admin.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,
      canonical_encoding,canonical_material,material,risk,explicit_disable_count,state,source_evidence_version,approval_evidence_version,revocation_generation,created_at,updated_at,publication_policy)
      SELECT $2,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,
      'awaiting-evidence',0,0,0,created_at,updated_at,'approval-v1' FROM content_intake.candidate_versions WHERE candidate_id=$1`,[c.key.candidateId,id]);
    await admin.query(`INSERT INTO content_intake.source_confirmations SELECT (jsonb_populate_record(NULL::content_intake.source_confirmations,
      to_jsonb(e)||jsonb_build_object('candidate_id',$2::text))).* FROM content_intake.source_confirmations e WHERE candidate_id=$1`,[c.key.candidateId,id]);
    const bytes=Buffer.from(JSON.stringify({format:'historical-synthetic-review',candidateId:id}));
    const object=await store.persist((async function*(){yield bytes;})(),'csv');
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES($1,'source-a','enabler','tenant-a','app-a',$2,$3,$4,'application/json','review-package',clock_timestamp()-interval '10 seconds')`,[object.objectId,`intake/${object.objectId}`,object.sha256,object.sizeBytes]);
    await admin.query(`INSERT INTO content_intake.review_bindings(review_request_id,candidate_id,candidate_version,candidate_digest,evidence_version,tenant_id,app_id,definition_id,node_id,create_uuid,instance_code,package_object_id,package_sha256,attachment_file_code)
      VALUES($1,$2,1,$3,1,'tenant-a','app-a','historical-definition','human-node',gen_random_uuid(),$4,$5,$6,'historical-attachment')`,[reviewId,id,c.key.digest,`instance-${label}`,object.objectId,object.sha256]);
    await admin.query(`INSERT INTO content_intake.approval_facts VALUES($1,1,0,'approved',clock_timestamp(),clock_timestamp()+interval '299 seconds',repeat('a',64),$2,'historical-human-task','reviewer',1,clock_timestamp()-interval '1 second')`,[reviewId,object.sha256]);
    await admin.query('INSERT INTO content_intake.approval_current VALUES($1,1)',[reviewId]);
    await admin.query("UPDATE content_intake.candidate_versions SET source_evidence_version=1,approval_evidence_version=1,revocation_generation=1,state='ready' WHERE candidate_id=$1",[id]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='publishing' WHERE candidate_id=$1",[id]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='published' WHERE candidate_id=$1",[id]);
    return {key:{...confirmed.key,candidateId:id},reviewId,object,original:c};
  }
  async function legacyRelease(h:Awaited<ReturnType<typeof legacyHistory>>,id='rel_legacy_history'){
    await admin.query('BEGIN');await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      SELECT $1,nextval('public.content_release_seq'),'合成历史审批目录','published',source_binding_hash,tenant_id FROM public.content_releases WHERE release_id='rel_native_base'`,[id]);
    await admin.query(`INSERT INTO public.release_source_bindings SELECT $1,domain,source_version_id FROM public.release_source_bindings WHERE release_id='rel_native_base'`,[id]);
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES($1,'intake-v2.1')",[id]);
    await admin.query(`INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy)
      VALUES($1,'source-a','faq-one',1,$2,1,$3,'infinity','approval-v1')`,[id,h.key.candidateId,h.reviewId]);
    await admin.query('UPDATE public.content_current SET current_release_id=$1 WHERE id=1',[id]);await admin.query('COMMIT');return id;
  }
  async function changeHistoricalApproval(reviewId:string,state:'revoked'|'expired'){
    await admin.query(`INSERT INTO content_intake.approval_facts SELECT (jsonb_populate_record(NULL::content_intake.approval_facts,to_jsonb(f)||jsonb_build_object(
      'facts_version',facts_version+1,'revocation_generation',revocation_generation+1,'state',$2::text,
      'decided_at',clock_timestamp()-interval '3 seconds','checked_at',clock_timestamp()-interval '2 seconds','valid_until',CASE WHEN $3 THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+interval '297 seconds' END))).*
      FROM content_intake.approval_current p JOIN content_intake.approval_facts f USING(review_request_id,facts_version) WHERE review_request_id=$1`,[reviewId,state==='revoked'?'revoked':'approved',state==='expired']);
    await admin.query('UPDATE content_intake.approval_current SET facts_version=facts_version+1 WHERE review_request_id=$1',[reviewId]);
  }

  it.each(['revoked','expired']as const)('legacy history: mixed direct catalog never revives %s approval during read, publish or rollback',async state=>{
    await publicationBase();const h=await legacyHistory();const old=await legacyRelease(h);await cloneScopeGrants('b');
    const next=await publishable('mixed-source-b',undefined,'b');const mixed=value(await service.publish(actor('enabler'),next.request)).releaseId!;
    expect((await admin.query('SELECT source_id,publication_policy FROM content_intake.release_lineage WHERE release_id=$1 ORDER BY source_id',[mixed])).rows)
      .toEqual([{source_id:'source-a',publication_policy:'approval-v1'},{source_id:'source-b',publication_policy:'direct-v1'}]);
    const ent=value(await issue());expect(value(await snapshot(ent.entitlementId)).faq).toHaveLength(1);
    const follow=await publishable('after-mixed',undefined,'b');
    await changeHistoricalApproval(h.reviewId,state);
    expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false});expect(await issue()).toMatchObject({ok:false});
    expect(await service.publish(actor('enabler'),follow.request)).toMatchObject({ok:false});
    expect(await service.rollbackPreview(actor('enabler'),{baseReleaseId:mixed,targetReleaseId:old})).toMatchObject({ok:false});
    const history=value(await service.review(actor('enabler'),h.key));expect(history.state).toBe(state==='revoked'?'revoked':'unavailable');
    expect((await admin.query('SELECT max(facts_version) v FROM content_intake.approval_facts')).rows[0].v).toBe('2');
    expect(provider.calls()).toBe(0);
  });

  it('legacy history: absent policy in durable cancellation/source receipts projects approval-v1 without rewriting storage',async()=>{
    const h=await legacyHistory('receipts');const c=value(await service.candidate(actor('enabler'),h.key.candidateId,1));
    const {publicationPolicy:_policy,...old}={...c,state:'cancelled' as const};
    await admin.query(`INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response)
      VALUES('user-enabler','intake:cancel','old-cancel',repeat('a',64),$1::jsonb)`,[JSON.stringify(old)]);
    expect(value(await service.operationReceipt(actor('enabler'),'old-cancel','cancel'))).toMatchObject({state:'cancelled',key:h.key});
    expect((await admin.query("SELECT response ? 'publicationPolicy' AS changed FROM backend_review.receipts WHERE request_key='old-cancel'")).rows[0].changed).toBe(false);
    const raw={operationId:'old-source',key:h.key,expectedEvidenceVersion:0,confirmedVersionKind:'opaque',confirmedVersionValue:'historical',acquisition:'controlled-synthetic-export',objectSha256:'a'.repeat(64),reason:'合成旧回执'};
    await admin.query(`INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response) VALUES('user-enabler','intake:source-confirm','old-source',$1,$2::jsonb)`,
      [`intake-request-v1:${digest(canonical(raw))}`,JSON.stringify({candidate:{...old,state:'awaiting-evidence'},reason:raw.reason})]);
    expect(value(await service.confirmSource(actor('enabler'),raw)).publicationPolicy).toBe('approval-v1');
    for (const action of ['publish','rollback'] as const) {
      const saved={operationId:`old-${action}`,action,state:'published',releaseId:'rel_historical',announcementId:'ann_historical',reason:null,
        ...(action==='publish'?{key:h.key}:{rollbackPlanId:'historical-plan'})};
      await admin.query(`INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response)
        VALUES('user-enabler',$1,$2,repeat('a',64),$3::jsonb)`,[`intake:${action}`,saved.operationId,JSON.stringify(saved)]);
      expect(value(await service.operationReceipt(actor('enabler'),saved.operationId,action))).toEqual(saved);
    }
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('0');
    expect(provider.calls()).toBe(0);
    expect(await service.publish(actor('enabler'),{operationId:'old-unknown',key:h.key,baseReleaseId:null,sourceEvidenceVersion:1,approvalEvidenceVersion:1,title:'旧请求',summary:'原载荷'})).toMatchObject({ok:false,code:'VALIDATION'});
  });

  it.each(['revoked','expired'] as const)('legacy rollback history: inherited %s review still fences a direct release',async state=>{
    const {base,target}=await rollbackPair();const p=value(await service.rollbackPreview(actor('enabler'),{baseReleaseId:base,targetReleaseId:target}));
    const req:C['IntakeRollback']={operationId:'direct-with-history',rollbackPlanId:p.rollbackPlanId,baseReleaseId:base,targetReleaseId:target,impactDigest:p.impactDigest,confirmed:true};
    const historicalObject=await store.persist((async function*(){yield Buffer.from('synthetic historic rollback review');})(),'csv');
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES($1,NULL,'enabler','tenant-a','app-a',$2,$3,$4,'application/json','review-package',clock_timestamp()-interval '10 seconds')`,[historicalObject.objectId,`intake/${historicalObject.objectId}`,historicalObject.sha256,historicalObject.sizeBytes]);
    await admin.query(`INSERT INTO content_intake.review_bindings(review_request_id,rollback_plan_id,impact_digest,evidence_version,tenant_id,app_id,definition_id,node_id,create_uuid,instance_code,package_object_id,package_sha256,attachment_file_code)
      VALUES('historical-rollback-review',$1,$2,1,'tenant-a','app-a','historical-definition','human-node',gen_random_uuid(),'historical-rollback-instance',$3,$4,'historical-rollback-file')`,[p.rollbackPlanId,p.impactDigest,historicalObject.objectId,historicalObject.sha256]);
    await admin.query(`INSERT INTO content_intake.approval_facts VALUES('historical-rollback-review',1,0,'approved',clock_timestamp(),clock_timestamp()+interval '299 seconds',repeat('a',64),$1,'historical-task','reviewer',1,clock_timestamp()-interval '1 second')`,[historicalObject.sha256]);
    await admin.query("INSERT INTO content_intake.approval_current VALUES('historical-rollback-review',1)");
    // Existing target carried this independently approved rollback dependency.
    await admin.query("INSERT INTO content_intake.release_rollback_lineage VALUES($1,'historical-rollback-review')",[target]);
    const restored=value(await service.rollback(actor('enabler'),req)).releaseId!;
    const prepared=await publishable('inherited-rollback-history');
    const current=value(await service.publish(actor('enabler'),prepared.request)).releaseId!;
    expect((await admin.query("SELECT release_id FROM content_intake.release_rollback_lineage WHERE review_request_id='historical-rollback-review' ORDER BY release_id")).rows.map(r=>r.release_id))
      .toEqual([target,restored,current].sort());
    const ent=value(await issue());
    const next=await publishable('after-historical-expiry');
    await changeHistoricalApproval('historical-rollback-review',state);
    expect(await snapshot(ent.entitlementId)).toMatchObject({ok:false});expect(await service.publish(actor('enabler'),next.request)).toMatchObject({ok:false});
    expect(await service.rollbackPreview(actor('enabler'),{baseReleaseId:current,targetReleaseId:target})).toMatchObject({ok:false});
    expect(value(await service.rollbackReview(actor('enabler'),p.rollbackPlanId)).state).toBe(state==='revoked'?'revoked':'unavailable');
    expect(provider.calls()).toBe(0);
  });

  it('legacy unpublished candidate requires explicit revision before its first direct publication',async()=>{
    await publicationBase();const h=await legacyHistory('unpublished');
    // Independent immutable historical version; do not rewrite an existing policy.
    const id='legacy-unpublished';
    await admin.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,
      canonical_encoding,canonical_material,material,risk,explicit_disable_count,state,source_evidence_version,approval_evidence_version,revocation_generation,created_at,updated_at,publication_policy)
      SELECT $2,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,
      'awaiting-evidence',0,0,0,created_at,updated_at,'approval-v1' FROM content_intake.candidate_versions WHERE candidate_id=$1`,[h.key.candidateId,id]);
    await admin.query("UPDATE content_intake.candidate_versions SET source_evidence_version=1 WHERE candidate_id=$1",[id]);
    const old=value(await service.candidate(actor('enabler'),id,1));
    expect(await service.publish(actor('enabler'),{operationId:'legacy-first',key:old.key,baseReleaseId:'rel_native_base',sourceEvidenceVersion:1,confirmed:true,title:'合成发布',summary:'不允许旧候选直发'}))
      .toMatchObject({ok:false,reason:'MODE_CONFLICT'});
    const revised=await input('legacy-explicit-revision',old.key);revised.baseReleaseId='rel_native_base';
    const next=value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',revised)).jobId));
    expect(next).toMatchObject({publicationPolicy:'direct-v1',approvalEvidenceVersion:0,key:{candidateId:id,version:2}});
    expect(value(await service.candidate(actor('enabler'),id,1))).toMatchObject({publicationPolicy:'approval-v1',state:'invalidated'});
  });

});
