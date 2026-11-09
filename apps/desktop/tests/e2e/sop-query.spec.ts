import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { intakeQueryData } from '../fixtures/intake-query-data';
import { sopQueryData } from '../fixtures/sop-query-data';
import { SOP_QUERY_CONTRACT } from '../../src/shared/sop-query';
import { closeOwnedElectron } from '../support/owned-electron';

/** Real Electron/Main/preload/HTTP consumer, with a synthetic wire server.
 * This does not exercise PostgreSQL or assert formal runtime readiness. */
test('SOP explicit synthetic consumer uses graph edges, copies exact messages and removes revoked content', async () => {
  const wire=intakeQueryData(), token='s'.repeat(43), requests:string[]=[];
  let authorized=false, revoked=false, state='ready', apiOrigin='', identityOrigin='';
  const api=createServer(async(req,res)=> {
    const url=new URL(req.url!,'http://synthetic.invalid');requests.push(url.pathname);
    let body='';for await(const chunk of req)body+=String(chunk);
    const input=body?JSON.parse(body):{};
    res.setHeader('content-type','application/json');
    const send=(value:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(url.pathname==='/v1/auth/login-requests')return send({login_id:`login_${'l'.repeat(43)}`,authorize_url:`${identityOrigin}/authorize?state=synthetic`,expires_at:new Date(Date.now()+300000).toISOString()},201);
    if(url.pathname==='/v1/auth/callback'){authorized=true;return send({ok:true});}
    if(url.pathname.endsWith('/exchange'))return send(authorized?{access_token:token,token_type:'Bearer',expires_at:new Date(Date.now()+899000).toISOString()}:{status:'pending',retry_after_seconds:1},authorized?200:202);
    if(!authorized || req.headers.authorization!==`Bearer ${token}`)return send({},401);
    if(url.pathname==='/v1/auth/me')return send({user_id:'usr_synthetic_agent',role:'agent',auth_mode:'mock'});
    if(url.pathname==='/v1/auth/logout'){authorized=false;res.statusCode=204;res.end();return;}
    if(url.pathname==='/v1/notices/current')return send({},410);
    if(url.pathname==='/v1/sop/query') {
      if(revoked)return send({},403);
      if(req.headers['x-intake-contract-set']!==SOP_QUERY_CONTRACT)return send({},409);
      res.setHeader('x-intake-contract-set',SOP_QUERY_CONTRACT);
      const result=sopQueryData(input.request_id);
      if(state==='no_match')return send({...result,status:state,result:{nodes:[],branches:[],messages:[],media_refs:[]}});
      if(state==='blocked'||state==='stale')return send({...result,status:state,release_id:null,lease_expires_at:null,result:null,reasons:[{code:'SCOPE_DENIED'}]});
      return send(result);
    }
    if(url.pathname.startsWith('/v1/intake/')){try{return send(wire.respond(req.url!,input));}catch{return send({},403);}}
    return send({},404);
  });
  const identity=createServer((req,res)=>{if(req.url?.startsWith('/authorize')){res.writeHead(302,{location:`${apiOrigin}/v1/auth/callback?state=synthetic&code=synthetic`});res.end();}else{res.statusCode=404;res.end();}});
  await new Promise<void>(resolve=>api.listen(0,'127.0.0.1',resolve));
  const port=(api.address() as AddressInfo).port;
  await new Promise<void>((resolve,reject)=>{identity.once('error',reject);identity.listen(port+1,'127.0.0.1',resolve);});
  apiOrigin=`http://127.0.0.1:${port}`;identityOrigin=`http://127.0.0.1:${port+1}`;
  const directory=mkdtempSync(path.join(tmpdir(),'sop-query-e2e-'));
  let app:ElectronApplication|undefined;
  try {
    app=await electron.launch({executablePath:process.env.SOP_ELECTRON_EXECUTABLE,cwd:fileURLToPath(new URL('../..',import.meta.url)),args:[`--user-data-dir=${directory}`,...(process.platform==='linux'?['--password-store=gnome-libsecret']:[]),'out/main/index.js','--demo-e2e'],env:{...process.env,DEMO_E2E:'1',CUSTOMER_AGENT_DESKTOP_API_ORIGIN:apiOrigin,CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN:identityOrigin,CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE:'faq-v2',CUSTOMER_AGENT_DESKTOP_SOP_QUERY:'menokin-sop-query-v1'}});
    const storage=await app.evaluate(async({app,safeStorage})=>{await app.whenReady();return {available:safeStorage.isEncryptionAvailable(),backend:process.platform==='linux'?safeStorage.getSelectedStorageBackend():'native'};});
    console.info('SOP_SESSION_STORAGE',storage);
    expect(storage.available,'SOP login requires system encrypted storage').toBe(true);
    expect(storage.backend,'The product rejects plaintext Linux storage').not.toBe('basic_text');
    await expect.poll(()=>app!.windows().some(w=>w.url().includes('role=query'))).toBe(true);
    const query=app.windows().find(w=>w.url().includes('role=query'))!;
    await query.evaluate(()=>window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening','false');
    const loginOpened=app.waitForEvent('window');await query.getByRole('button',{name:'登录',exact:true}).click();
    const login=await loginOpened;await expect.poll(()=>login.url()).toContain('role=login');await login.getByRole('button',{name:'飞书登录'}).click();
    await expect.poll(()=>query.evaluate(async()=>{const v=await window.customerAgent!.product!.sessionStatus();return v.ok&&v.signedIn;})).toBe(true);
    // Check the shipped Query entry, not an injected renderer projection.
    await query.getByRole('button',{name:'打开 SOP 流程'}).click();
    await expect.poll(()=>app!.windows().some(w=>w.url().includes('role=sop'))).toBe(true);
    const sop=app.windows().find(w=>w.url().includes('role=sop'))!;
    await expect(sop.getByRole('combobox',{name:'店铺'}).locator('option')).toHaveCount(3);
    await sop.getByRole('combobox',{name:'店铺'}).selectOption({label:'shop-a'});
    await sop.getByRole('textbox',{name:'问题'}).fill('合成问题');
    await sop.getByRole('button',{name:'查询流程'}).click();
    await expect(sop.getByTestId('sop-query-shell')).toHaveAttribute('data-state','ready');
    await sop.getByRole('button',{name:'已确认',exact:true}).click();
    await expect(sop.getByText('这是合成原文甲。\n保留换行。')).toBeVisible();
    const copies=sop.getByRole('button',{name:'复制话术'});await expect(copies.nth(1)).toBeDisabled();await copies.first().click();
    expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('这是合成原文甲。\n保留换行。');
    expect(await sop.evaluate(()=>({customerAgent:typeof window.customerAgent,require:typeof Reflect.get(window,'require'),apis:Object.keys(window.sopWindow!)}))).toMatchObject({customerAgent:'undefined',require:'undefined'});
    revoked=true;await copies.first().click();await expect(sop.getByTestId('sop-query-shell')).toHaveAttribute('data-state','stale');await expect(sop.getByText('这是合成原文甲。\n保留换行。')).toHaveCount(0);
    revoked=false;
    for(const next of ['blocked','stale','no_match']) {state=next;await sop.getByRole('button',{name:'查询流程'}).click();await expect(sop.getByTestId('sop-query-shell')).toHaveAttribute('data-state',next);}
    expect(requests.filter(p=>p==='/v1/sop/query').length).toBeGreaterThanOrEqual(7);
    expect(requests).not.toContain('/v1/search');
  } finally {
    if(app)await closeOwnedElectron(app);
    await Promise.all([new Promise<void>(resolve=>api.close(()=>resolve())),new Promise<void>(resolve=>identity.close(()=>resolve()))]);
    rmSync(directory,{recursive:true,force:true});
  }
});
