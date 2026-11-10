import { createHash, randomUUID } from 'node:crypto';
import type { Pool, Client } from 'pg';
import { parseContractSchema } from '@customer-agent/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSopQueryDatabaseReadPort } from '../src/sop-query-database-read-port.js';
import { MENOKIN_SOP_QUERY_CONTRACT_SET_ID } from '../src/sop-query-model.js';
import { seedSopQueryGraph, seedSopQueryRelease } from './support/sop-query-synthetic.ts';
import { createSopQuerySyntheticHost } from './support/sop-query-synthetic-host.ts';

const enabled = process.env.CUSTOMER_AGENT_SOP_QUERY_CANDIDATE === '1';
describe.skipIf(!enabled).sequential('SOP candidate real PostgreSQL 15 to loopback HTTP', () => {
  let host: Awaited<ReturnType<typeof createSopQuerySyntheticHost>>;
  let admin: Client;
  let pool: Pool;
  let origin: string;
  let token: string;
  let graph: Awaited<ReturnType<typeof seedSopQueryGraph>>;
  const request = () => ({ sop_group:'过敏流程SOP',shop_id:'shop-a',query_text:'合成过敏',context_generation:'synthetic-1',request_id:randomUUID() });
  async function query(body = request()) {
    const response = await fetch(`${origin}/v1/sop/query`, { method:'POST', headers:{ authorization:`Bearer ${token}`,
      'content-type':'application/json','x-intake-contract-set':MENOKIN_SOP_QUERY_CONTRACT_SET_ID },body:JSON.stringify(body) });
    return { status:response.status,body:await response.json(),cache:response.headers.get('cache-control') };
  }
  beforeAll(async () => {
    host=await createSopQuerySyntheticHost({initial:'empty'});
    admin=host.admin; pool=host.pool; origin=host.apiOrigin; graph=host.graph;
    expect(Number(new URL(host.identityOrigin).port)).toBe(Number(new URL(host.apiOrigin).port)+1);
    expect(host.identityOrigin).not.toBe(host.apiOrigin);
    token=await host.login();
    const checked=await pool.query('SELECT content_intake.read_sop_query($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      ['user-agent',createHash('sha256').update(token).digest('hex'),'过敏流程SOP','shop-a',null,null,'合成过敏','diagnostic',randomUUID()]);
    expect(checked.rows[0].read_sop_query.status).toBe('blocked');
  },60000);
  afterAll(async () => { await host?.close(); });

  const initiallyBlocked=request();
  it('returns blocked with no release graph, without a lease',async () => {
    expect(await query(initiallyBlocked)).toMatchObject({status:200,cache:'no-store',body:{status:'blocked',result:null}});
    expect((await admin.query('SELECT count(*)::integer AS n FROM content_intake.sop_query_leases')).rows[0].n).toBe(0);
  });
  it('reads immutable graph lineage into ready and no_match HTTP results',async () => {
    await seedSopQueryRelease(admin,graph,'rel_graph_one');
    expect(await query(initiallyBlocked)).toMatchObject({status:200,body:{status:'blocked',result:null}});
    const ready=await query();
    expect(ready).toMatchObject({status:200,body:{status:'ready',release_id:'rel_graph_one',result:{entry_node_id:'start',nodes:expect.any(Array)}}});
    expect(ready.body).toMatchObject({result:{messages:expect.arrayContaining([expect.objectContaining({copy_allowed:false})])}});
    expect(ready.body).toMatchObject({result:{messages:expect.arrayContaining([expect.objectContaining({body:'合成过敏情况请先停手，再确认情况。'})])}});
    expect(await query({...request(),query_text:'no authored match'})).toMatchObject({status:200,body:{status:'no_match',result:{nodes:[]}}});
  });
  it('binds requests, serializes concurrent reuse, and does not renew a lease',async () => {
    const body=request();
    const replies=await Promise.all([query(body),query(body)]);
    expect(replies[0].body).toEqual(replies[1].body);
    expect(replies[0]!.body).toMatchObject({status:'ready'});
    expect(await query({...body,query_text:'changed'})).toMatchObject({status:409,body:{code:'IDEMPOTENCY_CONFLICT'}});
  });
  it('serves real query eligibility and the shop directory on the same host',async () => {
    expect((await admin.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='content_intake' AND table_name='entitlements' AND column_name='contract_view') AS exists`)).rows[0].exists).toBe(false);
    for (const pathname of ['/v1/intake/authorization?limit=100','/v1/intake/sources?limit=100','/v1/intake/shop-directory?limit=100']) {
      const response=await fetch(`${origin}${pathname}`,{headers:{authorization:`Bearer ${token}`}});
      expect(response.status,await response.clone().text()).toBe(200);
      if (pathname.includes('shop-directory')) expect(await response.text()).toContain('合成示例店');
    }
    const response=await fetch(`${origin}/v1/intake/entitlements`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      body:JSON.stringify({shopId:'shop-a',contextGeneration:1,productIds:[],scenarioIds:[],releaseId:'rel_graph_one'})});
    expect(response.status,await response.clone().text()).toBe(200);
    const entitlement = parseContractSchema('IntakeEntitlement', await response.json());
    const snapshot = await fetch(`${origin}/v1/intake/snapshot?entitlementId=${encodeURIComponent(entitlement.entitlementId)}&limit=100`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snapshot.status, await snapshot.clone().text()).toBe(200);
  });
  it('denies cross-shop and guessed session provenance',async () => {
    expect(await query({...request(),shop_id:'shop-b'})).toMatchObject({status:403});
    const result=await createSopQueryDatabaseReadPort(pool).read({actor:{user_id:'user-agent',role:'agent',auth_mode:'mock'},request:request(),session_token_hash:'b'.repeat(64)});
    expect(result).toEqual({ok:false,code:'SCOPE_DENIED'});
  });
  it('new release stales existing requests; a new rollback release gets a new lease',async () => {
    const old=request(); expect((await query(old)).body).toMatchObject({status:'ready'});
    await seedSopQueryRelease(admin,graph,'rel_graph_two');
    expect(await query(old)).toMatchObject({status:200,body:{status:'stale',release_id:'rel_graph_one',result:null}});
    await seedSopQueryRelease(admin,graph,'rel_graph_rollback');
    expect(await query()).toMatchObject({status:200,body:{status:'ready',release_id:'rel_graph_rollback'}});
    expect(await query(old)).toMatchObject({status:200,body:{status:'stale'}});
  });
  it('replays no_match and stale terminals without letting their cache authorize reads',async () => {
    const absent={...request(),query_text:'not an authored term'};
    expect(await query(absent)).toEqual(await query(absent));
    await admin.query(`INSERT INTO content_intake.release_revocations VALUES('rel_graph_rollback',1,'synthetic revoke',clock_timestamp())`);
    const stale=request();
    const original=await query(stale);
    expect(original).toMatchObject({status:200,body:{status:'stale',reasons:[{code:'APPROVAL_REVOKED'}]}});
    await seedSopQueryRelease(admin,graph,'rel_after_revocation');
    expect(await query(stale)).toEqual(original);
    expect((await query()).body).toMatchObject({status:'ready'});
  });
  it('rejects an expired immutable lease and rolls back query receipts with its transaction',async () => {
    const expired=request();
    const sessionHash=createHash('sha256').update(token).digest('hex');
    const binding=createHash('sha256').update(`user-agent:${sessionHash}`).digest('hex');
    await admin.query(`SELECT content_intake.issue_sop_query_lease($1,$2,'rel_after_revocation',$3,
      encode(public.digest(public.jsonb_jcs(jsonb_build_array($4::text,$5::text,null,null,$6::text,$7::text)),'sha256'),'hex'),
      $7,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',0)`,
      [`sopl_${createHash('sha256').update(expired.request_id).digest('hex')}`,binding,expired.request_id,
        expired.sop_group,expired.shop_id,expired.query_text,expired.context_generation]);
    expect(await query(expired)).toMatchObject({status:200,body:{status:'stale',reasons:[{code:'LEASE_EXPIRED'}]}});
    const rolledBack=request();
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const result=await createSopQueryDatabaseReadPort(client).read({actor:{user_id:'user-agent',role:'agent',auth_mode:'mock'},
        request:rolledBack,session_token_hash:sessionHash});
      expect(result).toMatchObject({status:'ready'});
      await client.query('ROLLBACK');
    } finally { client.release(); }
    for (const table of ['sop_query_requests','sop_query_completions','sop_query_leases']) {
      expect((await admin.query(`SELECT count(*)::integer AS n FROM content_intake.${table} WHERE request_id=$1`,[rolledBack.request_id])).rows[0].n).toBe(0);
    }
  });
  it('refuses runtime table reads, annotation writes, and direct lease minting',async () => {
    for (const sql of ['SELECT * FROM content_intake.sop_graph_versions','SELECT * FROM content_intake.sop_query_annotations',
      "UPDATE content_intake.sop_query_annotations SET nodes='[]'",'SELECT * FROM content_intake.sop_query_leases']) {
      await expect(pool.query(sql)).rejects.toMatchObject({code:'42501'});
    }
    expect((await admin.query(`SELECT has_function_privilege('app_runtime','content_intake.issue_sop_query_lease(text,text,text,uuid,text,text,timestamptz,timestamptz,bigint)','execute') AS allowed`)).rows[0].allowed).toBe(false);
  });
  it('keeps undeclared wire fields and unavailable media blocked',async () => {
    const missing=await seedSopQueryGraph(admin,{id:'missing-annotations',annotations:false});
    await seedSopQueryRelease(admin,missing,'rel_missing_annotations');
    expect(await query()).toMatchObject({status:200,body:{status:'blocked',reasons:[{code:'GRAPH_UNRESOLVED'}]}});
    const media=await seedSopQueryGraph(admin,{id:'missing-media',media:true});
    await seedSopQueryRelease(admin,media,'rel_missing_media');
    expect(await query()).toMatchObject({status:200,body:{status:'blocked',reasons:[{code:'MEDIA_UNVERIFIED'}]}});
  });
  it.each([
    ['unclassified','SAFETY_REVIEW_REQUIRED',{risk:'unclassified'}],
    ['fractional-sequence','GRAPH_UNRESOLVED',{sequence:1.5}],
    ['unresolved-target','GRAPH_UNRESOLVED',{fault:'unresolved-target'}],
    ['terminal-outgoing','TERMINAL_HAS_OUTGOING_EDGE',{fault:'terminal-outgoing'}],
    ['cyclic-graph','GRAPH_UNRESOLVED',{fault:'cycle'}],
    ['unsafe-allergy','SAFETY_REVIEW_REQUIRED',{unsafe:true}],
  ] as const)('blocks %s in PostgreSQL before HTTP projection',async (id,code,options) => {
    const invalid=await seedSopQueryGraph(admin,{id,...options});
    await seedSopQueryRelease(admin,invalid,`rel_${id}`);
    expect(await query()).toMatchObject({status:200,body:{status:'blocked',reasons:[{code}]}});
  });
  it('blocks ambiguous explicit matches and uses locale-independent Unicode casefold',async () => {
    const ambiguous=await seedSopQueryGraph(admin,{id:'ambiguous',ambiguous:true});
    await seedSopQueryRelease(admin,ambiguous,'rel_ambiguous');
    expect(await query({...request(),query_text:'合成歧义'})).toMatchObject({status:200,body:{status:'blocked',reasons:[{code:'GRAPH_UNRESOLVED'}]}});
    const normalized=await admin.query("SELECT content_intake.sop_query_normalize('Ｓｔｒａße Σς') AS value");
    expect(normalized.rows[0].value).toBe('strasse σσ');
  });
  it('rechecks parent revocation even for the same leased request',async () => {
    await seedSopQueryRelease(admin,graph,'rel_revoke');
    const body=request(); expect((await query(body)).body).toMatchObject({status:'ready'});
    await admin.query("UPDATE content_intake.grants SET version=version+1,revoked_at=clock_timestamp(),last_change_reason='synthetic parent revoke' WHERE grant_id='root-query'");
    expect(await query(initiallyBlocked)).toMatchObject({status:403,body:{code:'SCOPE_DENIED'}});
    expect(await query(body)).toMatchObject({status:403,body:{code:'SCOPE_DENIED'}});
    expect(await query()).toMatchObject({status:403,body:{code:'SCOPE_DENIED'}});
  });
});
