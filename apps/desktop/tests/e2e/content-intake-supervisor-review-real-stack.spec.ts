import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

type AuthServer=Parameters<typeof import('../../../api/dist/product-auth-routes.js').registerProductAuthRoutes>[0];

async function cleanupAll(tasks: (()=>Promise<void>)[]) {
  const failures: unknown[]=[];
  for(const task of tasks) {try {await task();} catch(error) {failures.push(error);}}
  if(failures.length)throw new AggregateError(failures,'Synthetic supervisor cleanup failed');
}

async function freePort() {
  const server=createServer();
  return new Promise<number>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      if (!address || typeof address==='string') { server.close(); reject(new Error('No local port')); return; }
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}

test('a real synthetic supervisor seat is available for business grants', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(240_000);
  const stackRoot=mkdtempSync(path.join(tmpdir(),'intake-supervisor-seat-'));
  const environment={ CUSTOMER_AGENT_STACK_ROOT:stackRoot, SEAT_TENANT_ID:'tenant-a', SEAT_APP_ID:'app-a', SEAT_DEPARTMENT_ID:'dept-a' };
  const previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
  Object.assign(process.env,environment);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  let host: Awaited<ReturnType<typeof createIntakeSyntheticHost>> | undefined;
  try {
    host=await createIntakeSyntheticHost({profile:'purpose-runtime'});
    const create=await host.requestAs('roster-director','/v1/intake/seats',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        displayName:'合成审核主管',username:'review_seat',password:'synthetic-review-password',post:'客服主管',
      }),
    });
    expect(create.status).toBe(200);
    expect(await create.json()).toMatchObject({seat:{username:'review_seat',post:'客服主管',enabled:true}});
    const directory=await host.requestAs('roster-director','/v1/intake/principals?sourceId=source-a&purpose=grant-recipient&limit=100');
    const directoryBody: unknown=await directory.json();
    expect(directory.status,JSON.stringify(directoryBody)).toBe(200);
    expect(directoryBody).toMatchObject({items:expect.arrayContaining([expect.objectContaining({displayLabel:'合成审核主管'})])});
  } finally {
    try { if(host)await host.close(); }
    finally {
      for(const [key,value] of Object.entries(previous)) { if(value===undefined)delete process.env[key];else process.env[key]=value; }
      rmSync(stackRoot,{recursive:true,force:true});
    }
  }
});

test('the same synthetic supervisor password seat can hold query and review without publish', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15 synthetic gate');
  test.setTimeout(240_000);
  const stackRoot=mkdtempSync(path.join(tmpdir(),'intake-supervisor-authorization-'));
  const environment={ CUSTOMER_AGENT_STACK_ROOT:stackRoot, SEAT_TENANT_ID:'tenant-a', SEAT_APP_ID:'app-a', SEAT_DEPARTMENT_ID:'dept-a' };
  const previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
  Object.assign(process.env,environment);
  const { createIntakeSyntheticHost, INTAKE_SYNTHETIC_FAQ }=await import('../../../api/tests/support/intake-synthetic-host.ts');
  const { Client }=await import('pg');
  const { createIdentityProvider }=await import('../../../../scripts/synthetic-stack/identity-provider.ts');
  const { createProductAuthService }=await import('../../../api/dist/product-auth-service.js');
  const { registerProductAuthRoutes }=await import('../../../api/dist/product-auth-routes.js');
  const { createSyntheticIdentityProvider }=await import('../../../api/dist/synthetic-identity-provider.js');
  const { readStoredRosterPermission }=await import('../../../api/dist/project-roster-login.js');
  const { requireIndependentReviewer }=await import('../../../api/dist/content-intake/reviewer.js');
  const { parseContractSchema }=await import('../../../../packages/contracts/dist/index.js');
  let host: Awaited<ReturnType<typeof createIntakeSyntheticHost>> | undefined;
  let admin: InstanceType<typeof Client> | undefined;
  let business: InstanceType<typeof Client> | undefined;
  let provider: ReturnType<typeof createIdentityProvider> | undefined;
  let auth: Awaited<ReturnType<typeof createProductAuthService>> | undefined;
  let authServer: AuthServer | undefined, proxy: Server | undefined, desktop: ElectronApplication | undefined;
  let allocatorDesktop: ElectronApplication | undefined;
  try {
    host=await createIntakeSyntheticHost({profile:'purpose-runtime'});
    const password='synthetic-review-password';
    const created=await host.requestAs('roster-director','/v1/intake/seats',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        displayName:'合成审核主管',username:'review_seat',password,post:'客服主管',
      }),
    });
    expect(created.status).toBe(200);
    const ordinaryCreated=await host.requestAs('roster-director','/v1/intake/seats',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        displayName:'合成普通客服',username:'ordinary_seat',password:'synthetic-ordinary-password',post:'客服',
      }),
    });
    expect(ordinaryCreated.status).toBe(200);
    const pgPort=Number(readFileSync(path.join(host.root,'data','postmaster.pid'),'utf8').split('\n')[3]);
    const socket=path.join(host.root,'socket');
    const catalog=new Client({host:socket,port:pgPort,user:'gate_owner',database:'postgres'});
    await catalog.connect();
    let database: string;
    try {
      const found=await catalog.query<{datname:string}>("SELECT datname FROM pg_database WHERE datname LIKE 'dev_m0_intake_desktop_%'");
      expect(found.rows).toHaveLength(1);database=found.rows[0]!.datname;
    } finally {await catalog.end();}
    admin=new Client({host:socket,port:pgPort,user:'gate_owner',database});await admin.connect();
    const seat=await admin.query<{user_id:string;job_id:string;business_role:string;session_role:string}>(`
      SELECT person.user_id, facts.job_id, rules.role AS business_role, binding.role AS session_role
      FROM content_intake.principals person
      JOIN content_intake.principal_facts facts ON facts.principal_id=person.principal_id AND facts.facts_version=person.current_facts_version
      JOIN content_intake.role_rules rules ON rules.job_id=facts.job_id AND rules.department_id=ANY(facts.department_ids)
      JOIN backend_identity.subject_bindings binding ON binding.user_id=person.user_id
      WHERE person.principal_id='seat_review_seat'`);
    expect(seat.rows).toHaveLength(1);
    expect(seat.rows[0]).toMatchObject({job_id:'job-seat-supervisor',business_role:'supervisor',session_role:'coach'});

    business=new Client({host:socket,port:pgPort,user:'synthetic_business',database});
    await business.connect();
    await business.query('SET ROLE intake_business');
    expect(await readStoredRosterPermission(business,seat.rows[0]!.user_id)).toEqual({title:'客服主管',state:'pending'});
    expect(await readStoredRosterPermission(business,'user-director')).toBeNull();
    const ordinary=await admin.query<{user_id:string}>("SELECT user_id FROM content_intake.principals WHERE principal_id='seat_ordinary_seat'");
    expect(ordinary.rows).toHaveLength(1);
    expect(await readStoredRosterPermission(business,ordinary.rows[0]!.user_id)).toEqual({title:'客服坐席',state:'pending'});
    const authorization=parseContractSchema('IntakeAuthorization',await (await host.requestAs('director','/v1/intake/authorization')).json());
    const scope=authorization.capabilities.find(item=>item.scope.sourceId==='source-a')?.scope;
    if (!scope) throw new Error('Synthetic source is not available to grant');
    const issuerSetup=await host.requestAs('director','/v1/intake/grants',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:'synthetic-supervisor-issuer-setup',
        issuerFactsVersion:authorization.factsVersion,policyVersion:authorization.policyVersion,
        items:['content-manage','review'].map(action=>({kind:'business',recipientPrincipalId:'roster-director',
          recipientFactsVersion:1,action,scope,startsAt:new Date(Date.now()-1_000).toISOString(),
          expiresAt:new Date(Date.now()+240_000).toISOString(),reason:'合成授权人准备'}))}),
    });
    expect(issuerSetup.status).toBe(200);

    const desktopRoot=fileURLToPath(new URL('../..',import.meta.url));
    const evidenceDirectory=path.join(stackRoot,'evidence');
    const allocatorDirectory=path.join(stackRoot,'allocator-userdata');
    mkdirSync(evidenceDirectory);mkdirSync(allocatorDirectory);
    host.selectIdentity('roster-director');
    allocatorDesktop=await launchIntakeElectron({desktopRoot,userDataDirectory:allocatorDirectory,
      apiOrigin:host.apiOrigin,identityOrigin:host.identityOrigin,evidenceDirectory});
    await expect.poll(()=>allocatorDesktop!.windows().some(window=>window.url().includes('role=query'))).toBe(true);
    const allocatorQuery=allocatorDesktop.windows().find(window=>window.url().includes('role=query'))!;
    await allocatorQuery.waitForFunction(()=>Boolean(window.customerAgent?.product));
    await allocatorDesktop.evaluate(({app})=>app.focus({steal:true}));
    await allocatorQuery.evaluate(()=>window.customerAgent!.openSearch());
    await allocatorQuery.getByRole('button',{name:'登录',exact:true}).click();
    await expect.poll(()=>allocatorDesktop!.windows().some(window=>window.url().includes('role=login'))).toBe(true);
    await allocatorDesktop.windows().find(window=>window.url().includes('role=login'))!.getByRole('button',{name:'飞书登录'}).click();
    await expect.poll(()=>allocatorQuery.evaluate(async()=>{
      const current=await window.customerAgent!.product!.sessionStatus();return current.ok && current.signedIn;
    })).toBe(true);
    expect(await allocatorQuery.evaluate(()=>window.customerAgent!.openDashboard())).toMatchObject({ok:true});
    await expect.poll(()=>allocatorDesktop!.windows().some(window=>window.url().includes('role=dashboard'))).toBe(true);
    const allocator=allocatorDesktop.windows().find(window=>window.url().includes('role=dashboard'))!;
    await allocator.getByRole('tab',{name:'权限',exact:true}).click();
    await expect(allocator.getByRole('region',{name:'权限配置'})).toContainText('新增授权',{timeout:10_000});
    const localTime=(offset:number)=>{
      const date=new Date(Date.now()+offset),pad=(value:number)=>String(value).padStart(2,'0');
      return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    await allocator.getByRole('region',{name:'权限配置'}).getByRole('button',{name:'新增授权'}).click();
    const deniedForm=allocator.getByRole('dialog',{name:'新增业务权限'});
    await deniedForm.getByRole('combobox',{name:'人员'}).click();
    await allocator.getByRole('option',{name:'合成普通客服',exact:true}).click();
    await deniedForm.getByRole('combobox',{name:'授权方案'}).click();
    await allocator.getByRole('option',{name:'资料审核',exact:true}).click();
    await deniedForm.getByLabel('生效时间').fill(localTime(-60_000));
    await deniedForm.getByLabel('生效时间').press('Enter');
    await deniedForm.getByLabel('失效时间').fill(localTime(180_000));
    await deniedForm.getByLabel('失效时间').press('Enter');
    await deniedForm.getByLabel('授权原因').fill('合成普通客服审核上限验证');
    await deniedForm.getByRole('button',{name:'预览权限'}).click();
    await expect(deniedForm.getByRole('alert')).toContainText('所选人员不能执行这些动作');
    await deniedForm.getByRole('button',{name:'取消'}).click();
    const ordinaryReview=await business.query<{allowed:boolean}>(
      "SELECT EXISTS (SELECT 1 FROM content_intake.authorization_sources('seat_ordinary_seat','review',clock_timestamp())) AS allowed");
    expect(ordinaryReview.rows[0]?.allowed).toBe(false);
    for (const choice of ['客服','资料审核']) {
      await allocator.getByRole('region',{name:'权限配置'}).getByRole('button',{name:'新增授权'}).click();
      const form=allocator.getByRole('dialog',{name:'新增业务权限'});
      await form.getByRole('combobox',{name:'人员'}).click();
      await allocator.getByRole('option',{name:'合成审核主管',exact:true}).click();
      await form.getByRole('combobox',{name:'授权方案'}).click();
      await allocator.getByRole('option',{name:choice,exact:true}).click();
      await form.getByLabel('生效时间').fill(localTime(-60_000));
      await form.getByLabel('生效时间').press('Enter');
      await form.getByLabel('失效时间').fill(localTime(180_000));
      await form.getByLabel('失效时间').press('Enter');
      await form.getByLabel('授权原因').fill('合成主管授权验证');
      await form.getByRole('button',{name:'预览权限'}).click();
      const preview=allocator.getByRole('dialog',{name:'预览，尚未保存'});
      if (choice==='资料审核') {
        await expect(preview).toContainText('查看与管理资料、人工质量检查');
        await expect(preview).not.toContainText('发布资料');
      }
      await preview.getByRole('button',{name:'确认保存权限'}).click();
      await expect(allocator.getByRole('region',{name:'权限配置'}).getByRole('status')).toContainText('已保存');
      await allocator.getByRole('region',{name:'权限配置'}).getByRole('button',{name:'刷新权限列表'}).click();
      await expect(allocator.getByRole('region',{name:'权限配置'}).getByRole('button',{name:'新增授权'})).toBeEnabled();
    }
    await expect(allocator.getByRole('table',{name:'人员'}).getByRole('row').filter({hasText:'合成审核主管'}))
      .toContainText('客服 / 资料审核');
    expect(await readStoredRosterPermission(business,seat.rows[0]!.user_id)).toEqual({title:'客服主管',state:'ready'});

    const identityPort=await freePort();
    provider=createIdentityProvider({port:identityPort,accountsFile:path.join(stackRoot,'password-accounts.json'),seatBindingEnabled:async binding=>{
      const result=await admin!.query('SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id=$1 AND enabled',[binding]);
      return (result.rowCount??0)>0;
    }});
    const identityOrigin=await provider.listen();
    const adapter=createSyntheticIdentityProvider(identityOrigin,`${host.apiOrigin}/v1/auth/callback`);
    const connectionString=`postgresql://synthetic_intake_auth@localhost/${database}?${new URLSearchParams({host:socket,port:String(pgPort)})}`;
    let projected=false;
    auth=await createProductAuthService({connectionString,poolMax:2,connectionTimeoutMs:2000,readinessTimeoutMs:3000},adapter,'mock',undefined,async binding=>{
      const result=await admin!.query<{status:string}>('SELECT content_intake.project_seat_login($1) AS status',[binding]);
      projected=result.rows[0]?.status==='projected';
    });
    const passwordResponse=await fetch(`${identityOrigin}/password`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({username:'review_seat',password})});
    expect(passwordResponse.status).toBe(200);
    const passwordResult: unknown=await passwordResponse.json();
    expect(passwordResult).toMatchObject({code:'synthetic_seat_review_seat'});
    if (!passwordResult || typeof passwordResult!=='object' || !('code' in passwordResult) || typeof passwordResult.code!=='string') throw new Error('Invalid synthetic password reply');
    const verifier=randomBytes(32).toString('base64url');
    const login=await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    const state=new URL(login.authorize_url).searchParams.get('state');
    if (!state) throw new Error('Missing synthetic state');
    await auth.callback(state,passwordResult.code);
    const session=await auth.exchange(login.login_id,verifier);
    if (!session) throw new Error('Synthetic seat session was not issued');
    expect(projected).toBe(true);
    const seatRequest=(url:string,options:RequestInit={})=>fetch(`${host!.apiOrigin}${url}`,{
      ...options,headers:{...options.headers,authorization:`Bearer ${session.access_token}`},redirect:'error',
    });
    expect(await (await seatRequest('/v1/auth/me')).json()).toMatchObject({role:'coach'});
    const seatJob=await seatRequest('/v1/auth/job');
    expect(seatJob.status).toBe(200);
    expect(await seatJob.json()).toMatchObject({title:'客服主管',permission_state:'ready',actions:{query:true,publish:false}});
    const directoryAfterLogin=await host.requestAs('roster-director','/v1/intake/principals?sourceId=source-a&purpose=grant-recipient&limit=100');
    expect(directoryAfterLogin.status).toBe(200);
    expect(await directoryAfterLogin.json()).toMatchObject({items:expect.arrayContaining([expect.objectContaining({displayLabel:'合成审核主管'})])});
    const key=host.candidate.key;
    const qualityUrl=`/v1/intake/candidates/${key.candidateId}/versions/${key.version}/quality?digest=${key.digest}`;
    const current=parseContractSchema('IntakeAuthorization',await (await seatRequest('/v1/intake/authorization')).json());
    expect(current.capabilities.find(item=>item.scope.sourceId==='source-a')?.actions).toEqual(['content-manage','query','review']);
    const entitlement=await seatRequest('/v1/intake/entitlements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      shopId:'shop-a',contextGeneration:1,productIds:[],scenarioIds:[],releaseId:null,
    })});
    expect(entitlement.status).toBe(200);
    expect((await seatRequest(qualityUrl)).status).toBe(200);
    const sourceConfirmed=await host.requestAs('enabler',`/v1/intake/candidates/${key.candidateId}/versions/${key.version}/source-confirmation`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:'supervisor-synthetic-source',key,expectedEvidenceVersion:0,
        confirmedVersionKind:'opaque',confirmedVersionValue:'synthetic-export',acquisition:'controlled-synthetic-export',objectSha256:host.object.sha256,reason:'合成来源核对'}),
    });
    expect(sourceConfirmed.status).toBe(200);

    const apiRequire=createRequire(fileURLToPath(new URL('../../../api/package.json',import.meta.url)));
    const createFastify: (options: {logger:boolean})=>AuthServer=apiRequire('fastify');
    authServer=createFastify({logger:false});registerProductAuthRoutes(authServer,auth);
    const authOrigin=await authServer.listen({host:'127.0.0.1',port:0});
    const originalOrigin=host.apiOrigin;
    proxy=createServer((request,response)=>{
      const target=request.url?.startsWith('/v1/auth/login-requests') || request.url?.startsWith('/v1/auth/callback') || request.url?.startsWith('/v1/auth/logout')
        ? authOrigin : originalOrigin;
      const url=new URL(request.url??'/',target);
      const upstream=httpRequest(url,{method:request.method,headers:{...request.headers,host:url.host}},incoming=>{
        response.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(response);
      });
      upstream.on('error',()=>response.writeHead(502).end());request.pipe(upstream);
    });
    const proxyOrigin=await new Promise<string>((resolve,reject)=>{
      proxy!.once('error',reject);proxy!.listen(0,'127.0.0.1',()=>{
        const address=proxy!.address();
        if (!address || typeof address==='string') reject(new Error('Synthetic proxy has no port'));
        else resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    const userDataDirectory=path.join(stackRoot,'reviewer-userdata');
    mkdirSync(userDataDirectory);
    desktop=await launchIntakeElectron({desktopRoot,userDataDirectory,apiOrigin:proxyOrigin,identityOrigin,evidenceDirectory});
    await expect.poll(()=>desktop!.windows().some(window=>window.url().includes('role=query'))).toBe(true);
    const query=desktop.windows().find(window=>window.url().includes('role=query'))!;
    await query.waitForFunction(()=>Boolean(window.customerAgent?.product));
    await desktop.evaluate(({app})=>app.focus({steal:true}));
    await query.evaluate(()=>window.customerAgent!.openSearch());
    await query.getByRole('button',{name:'登录',exact:true}).click();
    await expect.poll(()=>desktop!.windows().some(window=>window.url().includes('role=login'))).toBe(true);
    const loginWindow=desktop.windows().find(window=>window.url().includes('role=login'))!;
    await loginWindow.getByText('账号',{exact:true}).click();
    await loginWindow.getByRole('textbox',{name:'登录名'}).fill('review_seat');
    await loginWindow.locator('input[name="password"]').fill(password);
    await loginWindow.getByRole('button',{name:'登录',exact:true}).click();
    await expect.poll(()=>query.evaluate(async()=>{
      const current=await window.customerAgent!.product!.sessionStatus();return current.ok && current.signedIn && current.role==='coach';
    })).toBe(true);
    const desktopJob=await query.evaluate(async()=>{const current=await window.customerAgent!.product!.sessionStatus();return current.ok?current.job:null;});
    expect(desktopJob).toMatchObject({status:'resolved',title:'客服主管',role:'supervisor',actions:{query:true,publish:false}});
    await query.getByRole('button',{name:'筛选',exact:true}).click();
    const shops=query.getByRole('combobox',{name:'当前店铺'});
    await expect(shops).toBeEnabled();await shops.selectOption('shop-a');
    await query.getByTestId('question-input').fill('合成查询');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('no-hit')).toBeVisible();
    expect(await query.evaluate(()=>window.customerAgent!.openDashboard())).toMatchObject({ok:true});
    await expect.poll(()=>desktop!.windows().some(window=>window.url().includes('role=dashboard'))).toBe(true);
    const dashboard=desktop.windows().find(window=>window.url().includes('role=dashboard'))!;
    await dashboard.getByTestId('nav-materials').click();
    await dashboard.getByRole('region',{name:'候选列表'}).getByRole('button',{name:/第 1 版/}).click();
    await dashboard.getByRole('button',{name:'查看材料'}).click();
    await expect(dashboard.getByRole('region',{name:'当前步骤'})).toContainText('完成质量检查');
    await dashboard.getByRole('button',{name:'读取初检'}).click();
    await expect(dashboard.getByRole('button',{name:'冻结本次抽样'})).toBeVisible();
    await expect(dashboard.getByRole('button',{name:'发布当前候选'})).toHaveCount(0);
    await dashboard.getByRole('button',{name:'冻结本次抽样'}).click();
    await expect(dashboard.getByRole('status').filter({hasText:'操作回执：'})).toBeVisible();
    await dashboard.getByRole('button',{name:'读取初检'}).click();
    const quality=dashboard.getByRole('region',{name:'人工质量检查'});
    await expect(quality.getByRole('article')).toHaveCount(INTAKE_SYNTHETIC_FAQ.length);
    for (const faq of INTAKE_SYNTHETIC_FAQ) {
      const row=quality.getByRole('article').filter({has:dashboard.getByRole('combobox',{name:`检查结论 ${faq.title}`,exact:true})});
      const decision=row.getByRole('combobox');
      await decision.click();
      const listId=await decision.getAttribute('aria-controls');
      expect(listId).toBeTruthy();
      await dashboard.locator(`[id="${listId}"]`).getByRole('option',{name:'无缺陷',exact:true}).click();
      await row.getByRole('button',{name:'保存本条判断'}).click();
    }
    await dashboard.getByRole('button',{name:'提交本轮人工检查'}).click();
    await expect(dashboard.getByRole('status').filter({hasText:'质量检查通过'}).first()).toBeVisible();
    const qualityRound=await admin.query<{checked_by:string;count:number}>(`
      SELECT checked_by,jsonb_array_length(checks) AS count FROM content_intake.quality_rounds
      WHERE candidate_id=$1 AND candidate_version=$2`,[key.candidateId,key.version]);
    expect(qualityRound.rows).toEqual([{checked_by:'seat_review_seat',count:INTAKE_SYNTHETIC_FAQ.length}]);

    await test.step('critical review rejects unlinked identity namespaces',async()=>{
      const identity=await admin!.query<{identity_scope:string;person_key:string}>(
        "SELECT identity_scope,person_key FROM content_intake.principals WHERE principal_id='seat_review_seat'");
      expect(identity.rows).toHaveLength(1);
      const reviewer=identity.rows[0]!;
      expect(reviewer.identity_scope).toBe('confirmed-synthetic');
      const client={query:business!.query.bind(business!),validUntil:()=>undefined,beforeCommit:()=>undefined};
      const critical={risk:{level:'critical' as const},contributors:['director']};
      await expect(requireIndependentReviewer(client,critical,reviewer)).resolves.toBeUndefined();
      await expect(requireIndependentReviewer(client,{...critical,contributors:['seat_review_seat']},reviewer))
        .rejects.toMatchObject({reason:'HUMAN_REVIEW_REQUIRED'});
      await admin!.query('BEGIN');
      try {
        await admin!.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
          VALUES ('probe-admin','synthetic','tenant-a','probe-admin','user-probe-admin',repeat('a',64),true,'owner')`);
        await admin!.query(`INSERT INTO content_intake.principals VALUES
          ('probe-admin','user-probe-admin','tenant-a','app-a','production-admin','probe-admin',1,0)`);
        await admin!.query(`INSERT INTO content_intake.principal_facts VALUES
          ('probe-admin',1,ARRAY['dept-a'],'job-director',true,statement_timestamp()-interval '1 second',
           statement_timestamp()+interval '299 seconds',repeat('a',64))`);
        await admin!.query('COMMIT');
      } catch (error) {await admin!.query('ROLLBACK');throw error;}
      const crossScope={risk:{level:'critical' as const},contributors:['probe-admin']};
      await expect(requireIndependentReviewer(client,crossScope,reviewer)).rejects.toMatchObject({reason:'HUMAN_REVIEW_REQUIRED'});
      await expect(requireIndependentReviewer(client,{...crossScope,risk:{level:'routine'}},reviewer)).resolves.toBeUndefined();
    });
  } finally {
    await cleanupAll([
      async()=>{if(desktop)await closeOwnedElectron(desktop);},
      async()=>{if(allocatorDesktop)await closeOwnedElectron(allocatorDesktop);},
      async()=>{if(proxy){proxy.closeAllConnections();await new Promise<void>((resolve,reject)=>proxy!.close(error=>error?reject(error):resolve()));}},
      async()=>{await authServer?.close();},async()=>{await auth?.close();},async()=>{await provider?.close();},
      async()=>{await business?.end();},async()=>{await admin?.end();},async()=>{if(host)await host.close();},
      async()=>{for(const [key,value] of Object.entries(previous)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
        rmSync(stackRoot,{recursive:true,force:true});},
    ]);
  }
});
