import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { developmentProductProfile } from '../../src/main/product-runtime-config';
import { SOP_QUERY_GROUPS, type SopQueryGroup } from '../../src/shared/sop-query';
import { closeOwnedElectron } from './owned-electron';

export type SopSyntheticProbe = { synthetic:boolean; apiOrigin:string; identityOrigin:string; shop:string; group:SopQueryGroup; query:string; branches:string[]; expectedMessage:string };

export async function runSopQueryProbe(probe:SopSyntheticProbe, afterCopy?:(surface:{app:ElectronApplication;sop:Page})=>Promise<void>) {
  expect(probe.synthetic).toBe(true);expect(SOP_QUERY_GROUPS).toContain(probe.group);
  expect(probe.expectedMessage.length).toBeGreaterThan(0);
  const env={...process.env,DEMO_E2E:'1',CUSTOMER_AGENT_DESKTOP_API_ORIGIN:probe.apiOrigin,CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN:probe.identityOrigin,CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE:'faq-v2',CUSTOMER_AGENT_DESKTOP_SOP_QUERY:'menokin-sop-query-v1'};
  expect(developmentProductProfile(env)?.mode).toBe('synthetic-local');
  const directory=mkdtempSync(path.join(tmpdir(),'sop-external-host-'));
  let app:ElectronApplication|undefined;
  try {
    app=await electron.launch({executablePath:process.env.SOP_ELECTRON_EXECUTABLE,cwd:fileURLToPath(new URL('../..',import.meta.url)),args:[`--user-data-dir=${directory}`,'out/main/index.js','--demo-e2e'],env});
    await expect.poll(()=>app!.windows().some(w=>w.url().includes('role=query'))).toBe(true);
    const query=app.windows().find(w=>w.url().includes('role=query'))!;
    await app.evaluate(({app})=>app.focus({steal:true}));await query.evaluate(()=>window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening','false');
    const opened=app.waitForEvent('window');await query.getByRole('button',{name:'登录',exact:true}).click();
    const login=await opened;await expect.poll(()=>login.url()).toContain('role=login');await login.getByRole('button',{name:'飞书登录'}).click();
    await expect.poll(()=>query.evaluate(async()=>{const v=await window.customerAgent!.product!.sessionStatus();return v.ok&&v.signedIn;})).toBe(true);
    await query.getByRole('button',{name:'打开 SOP 流程'}).click();
    await expect.poll(()=>app!.windows().some(w=>w.url().includes('role=sop'))).toBe(true);
    const sop=app.windows().find(w=>w.url().includes('role=sop'))!;
    await expect(sop.getByRole('combobox',{name:'店铺'}).locator('option').filter({hasText:probe.shop})).toHaveCount(1);
    await sop.getByRole('combobox',{name:'店铺'}).selectOption({label:probe.shop});
    await sop.getByRole('combobox',{name:'流程'}).selectOption(probe.group);
    await sop.getByRole('textbox',{name:'问题'}).fill(probe.query);await sop.getByRole('button',{name:'查询流程'}).click();
    await expect(sop.getByTestId('sop-query-shell')).toHaveAttribute('data-state','ready');
    for(const label of probe.branches)await sop.getByRole('button',{name:label,exact:true}).click();
    const card=sop.locator('article').filter({has:sop.getByText(probe.expectedMessage,{exact:true})});
    await expect(card).toHaveCount(1);await card.getByRole('button',{name:'复制话术'}).click();
    await expect.poll(()=>app!.evaluate(({clipboard})=>clipboard.readText())).toBe(probe.expectedMessage);
    await afterCopy?.({app,sop});
    console.info('SOP_HOST_PROBE: HTTP/Main/SOP/exact clipboard PASS; host provenance remains caller-owned');
  } finally {if(app)await closeOwnedElectron(app);rmSync(directory,{recursive:true,force:true});}
}
