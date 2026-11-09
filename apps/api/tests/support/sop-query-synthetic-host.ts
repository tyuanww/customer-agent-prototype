import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createServer } from 'node:http';
import Fastify from 'fastify';
import { Pool, type Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { installSopQueryCandidate } from '../../../../packages/database/candidates/0084_sop_query/install.test-only.ts';
import { createProductAuthService, IdentityFailure } from '../../dist/product-auth-service.js';
import { registerProductAuthRoutes } from '../../dist/product-auth-routes.js';
import { registerSopQueryRoute } from '../../dist/sop-query-routes.js';
import { createSopQueryOperation } from '../../dist/sop-query-operation.js';
import { createSopQueryDatabaseReadPort } from '../../dist/sop-query-database-read-port.js';
import { MENOKIN_SOP_QUERY_CONTRACT_SET_ID } from '../../dist/sop-query-model.js';
import { seedSopQuerySource, seedSopQueryGraph, seedSopQueryRelease } from './sop-query-synthetic.ts';

import { createContentObjectStore } from '../../dist/content-object-store.js';
import { createContentIntakeService } from '../../dist/content-intake/service.js';
import { contentIntakeUsageRoutes } from '../../dist/content-intake/usage-http.js';
import { createDatabaseAccessEvaluator } from '../../dist/access/database.js';
import { registerAccessRoutes } from '../../dist/access/routes.js';
import { registerAuthRoutes } from '../../dist/auth-routes.js';
import { readAuthorizationActions, readStoredRosterPermission } from '../../dist/project-roster-login.js';
import { reserveAdjacentLoopbackPorts } from './intake-synthetic-host.ts';
import { seedIntakeSyntheticDirectory } from './intake-synthetic-directory.ts';

/** Disposable PG15 and actual loopback HTTP. No existing connection string is accepted. */
export async function createSopQuerySyntheticHost(options: { initial?: 'ready' | 'empty' } = {}) {
  if (process.env.CUSTOMER_AGENT_SOP_QUERY_CANDIDATE !== '1') throw new Error('Explicit SOP synthetic profile required');
  const pg = new Pg15Harness();
  const app = Fastify();
  let admin: Client | undefined;
  let pool: Pool | undefined;
  let auth: Awaited<ReturnType<typeof createProductAuthService>> | undefined;
  let apiOrigin = '';
  let identityOrigin = '';
  let ports: Awaited<ReturnType<typeof reserveAdjacentLoopbackPorts>> | undefined;
  const identity = createServer((request,response)=>{
    if (!identityOrigin || request.headers.host!==new URL(identityOrigin).host || request.method!=='GET') {
      response.writeHead(403).end(); return;
    }
    const url=new URL(request.url ?? '/',identityOrigin);
    const state=url.searchParams.get('state');
    if (url.pathname!=='/authorize' || !state || state.length>512) { response.writeHead(400).end(); return; }
    const code=randomBytes(24).toString('hex'); codes.add(code);
    response.writeHead(302,{'cache-control':'no-store',location:`${apiOrigin}/v1/auth/callback?${new URLSearchParams({state,code})}`}).end();
  });
  let closed = false;
  const codes = new Set<string>();
  async function close() {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    for (const cleanup of [() => app.close(),
      () => new Promise<void>((resolve,reject)=>{ if (!identity.listening) resolve(); else identity.close(error=>error ? reject(error) : resolve()); }),
      () => ports?.close(), () => auth?.close(), () => pool?.end(), () => admin?.end(), () => pg.stop()]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures,'SOP synthetic host cleanup failed');
  }
  try {
    pg.start();
    const db = pg.createDatabase('sop_query');
    admin = await pg.connect(db.config);
    await applyDatabaseMigrations(admin);
    await installSopQueryCandidate(admin);
    await seedSopQuerySource(admin);
    await seedIntakeSyntheticDirectory(admin);
    await admin.query(`CREATE ROLE synthetic_sop_usage LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT intake_usage TO synthetic_sop_usage;
      CREATE ROLE synthetic_sop_auth LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT app_backend_auth TO synthetic_sop_auth`);
    pool = new Pool({ ...db.config,user:'synthetic_sop_usage',max:4,statement_timeout:5000 });
    ports=await reserveAdjacentLoopbackPorts();
    apiOrigin=`http://127.0.0.1:${ports.apiPort}`;
    identityOrigin=`http://127.0.0.1:${ports.identityPort}`;
    await ports.releaseIdentity();
    await new Promise<void>((resolve,reject)=>{ identity.once('error',reject); identity.listen(ports!.identityPort,'127.0.0.1',resolve); });
    auth = await createProductAuthService({connectionString:`postgresql://synthetic_sop_auth@localhost/${db.name}?${new URLSearchParams({host:pg.socket,port:String(pg.port)})}`,
      poolMax:2,connectionTimeoutMs:2000,readinessTimeoutMs:3000}, {
      authorizeUrl:state=>`${identityOrigin}/authorize?state=${encodeURIComponent(state)}`,
      exchange:async code=>{ if (!codes.delete(code)) throw new IdentityFailure('LOGIN_INVALID'); return 'agent'; },
      close:()=>undefined,
    },'mock');
    app.addHook('onRequest',async (request,reply)=>{
      if (request.headers.host !== new URL(apiOrigin).host) return reply.code(403).send();
    });
    registerProductAuthRoutes(app,auth);
    registerAuthRoutes(app,auth,userId=>readStoredRosterPermission(admin!,userId),user=>readAuthorizationActions(admin!,user));
    registerAccessRoutes(app,createDatabaseAccessEvaluator(pool),auth);
    const store=createContentObjectStore(path.join(pg.root,'objects'));
    const usage=createContentIntakeService(pool,store,undefined,undefined,{requireProductSession:true});
    await app.register(contentIntakeUsageRoutes,{auth,usage});
    registerSopQueryRoute(app,auth,{operation:createSopQueryOperation(createSopQueryDatabaseReadPort(pool))});
    const graph=await seedSopQueryGraph(admin);
    if (options.initial !== 'empty') await seedSopQueryRelease(admin,graph,'rel_graph_initial');
    await ports.releaseApi();
    apiOrigin=await app.listen({host:'127.0.0.1',port:ports.apiPort});
    return {
      apiOrigin,identityOrigin,contractSetId:MENOKIN_SOP_QUERY_CONTRACT_SET_ID,graph,
      // Tests receive private handles in process. The CLI never prints them or accepts SQL.
      admin,pool,
      async login() {
        const verifier=randomBytes(32).toString('base64url');
        const response=await fetch(`${apiOrigin}/v1/auth/login-requests`,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({client_challenge:createHash('sha256').update(verifier).digest('base64url'),challenge_method:'S256'})});
        if (response.status!==201) throw new Error(`Synthetic login failed: ${response.status}`);
        const login=await response.json() as {login_id:string;authorize_url:string};
        const callback=await fetch(login.authorize_url);
        if (!callback.ok) throw new Error(`Synthetic callback failed: ${callback.status}`);
        const exchange=await fetch(`${apiOrigin}/v1/auth/login-requests/${login.login_id}/exchange`,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({client_verifier:verifier})});
        if (!exchange.ok) throw new Error(`Synthetic exchange failed: ${exchange.status}`);
        return (await exchange.json() as {access_token:string}).access_token;
      },
      async revokeQuery() {
        await admin!.query("UPDATE content_intake.grants SET version=version+1,revoked_at=clock_timestamp(),last_change_reason='synthetic parent revoke' WHERE grant_id='root-query' AND revoked_at IS NULL");
      },
      async publishFixture(releaseId:string) { await seedSopQueryRelease(admin!,graph,releaseId); },
      close,
    };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error,cleanup],'SOP synthetic startup and cleanup failed'); }
    throw error;
  }
}
