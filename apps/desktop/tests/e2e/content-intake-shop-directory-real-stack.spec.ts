import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

test('real Query shows registered duplicate shop names while selection and qualification keep distinct IDs',async()=>{
 test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E!=='1','Explicit PG15/Electron synthetic gate');test.setTimeout(180000);
 const {createIntakeSyntheticHost}=await import('../../../api/tests/support/intake-synthetic-host.ts');
 const host=await createIntakeSyntheticHost({prepareCandidate:false,profile:'purpose-runtime',duplicateShopNames:true});host.selectIdentity('agent');
 const directory=mkdtempSync(path.join(tmpdir(),'intake-shop-names-electron-')),desktopRoot=fileURLToPath(new URL('../..',import.meta.url));
 const evidence=path.resolve(desktopRoot,'../../.gstack/intake-shop-directory',new Date().toISOString().replace(/[:.]/g,'-'));
 let app:ElectronApplication|undefined;
 try{
  app=await launchIntakeElectron({desktopRoot,userDataDirectory:directory,apiOrigin:host.apiOrigin,identityOrigin:host.identityOrigin,evidenceDirectory:evidence});
  await expect.poll(()=>app!.windows().some(w=>w.url().includes('role=query'))).toBe(true);
  const query=app.windows().find(w=>w.url().includes('role=query'))!;await query.waitForFunction(()=>Boolean(window.customerAgent?.intakeQuery));
  await app.evaluate(({app})=>app.focus({steal:true}));await query.evaluate(()=>window.customerAgent!.openSearch());
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked','false');await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening','false');
  await query.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>app!.windows().some(w=>w.url().includes('role=login'))).toBe(true);
  await app.windows().find(w=>w.url().includes('role=login'))!.getByRole('button',{name:'飞书登录'}).click();
  await query.getByRole('button',{name:'筛选',exact:true}).click();
  const shops=query.getByRole('combobox',{name:'当前店铺'});await expect(shops).toBeVisible();
  await expect(shops.getByRole('option',{name:'合成示例店（shop-a）',exact:true})).toHaveAttribute('value','shop-a');
  await expect(shops.getByRole('option',{name:'合成示例店（shop-b）',exact:true})).toHaveAttribute('value','shop-b');
  await shops.selectOption('shop-b');await expect(shops).toHaveValue('shop-b');await expect(query.getByText(/店铺名称暂不可用/)).toHaveCount(0);
  const response=await host.requestAs('agent','/v1/intake/entitlements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shopId:'shop-b',contextGeneration:1,productIds:[],scenarioIds:[],releaseId:null})});
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({shopId:'shop-b'});
  await shops.selectOption('shop-a');await expect(shops).toHaveValue('shop-a');
  console.info('PASS registered synthetic duplicate display names in actual Query; two stable IDs; shop-b fresh qualification through restricted usage');
 }finally{try{if(app)await closeOwnedElectron(app);}finally{try{await host.close();}finally{rmSync(directory,{recursive:true,force:true});}}}
});
