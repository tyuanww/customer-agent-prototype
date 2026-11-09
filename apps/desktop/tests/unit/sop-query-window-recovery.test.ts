// @vitest-environment node
import type { ProductSession } from '../../src/main/product-session';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const access = vi.fn(async () => ({ shops: ['shop-a'] }));
  const win = {webContents:{isDestroyed:()=>false,send:vi.fn(),setBackgroundThrottling:vi.fn()},isDestroyed:()=>false,isVisible:()=>false,on:vi.fn(),setBounds:vi.fn(),getBounds:()=>({x:0,y:0,width:400,height:400}),showInactive:vi.fn(),show:vi.fn(),hide:vi.fn(),moveTop:vi.fn(),focus:vi.fn(),destroy:vi.fn()};
  return {access,win};
});
vi.mock('../../src/main/content-intake-access.ts',()=>({loadIntakeAccess:mocks.access}));
vi.mock('electron',()=>({BrowserWindow:vi.fn(),clipboard:{},nativeImage:{}}));
vi.mock('../../src/main/overlay-chrome-window.ts',()=>({createOverlayChromeWindow:()=>mocks.win}));
vi.mock('../../src/main/overlay-renderer-loader.ts',()=>({loadRenderer:async()=> 'loaded'}));
vi.mock('../../src/main/window-security.ts',()=>({lockRendererWindow:()=>{}}));
import { SopQueryRuntime } from '../../src/main/sop-query-runtime.ts';
import { SopWindowController } from '../../src/main/sop-window-controller.ts';
it('reopens the shop chooser after the product session changes',async()=>{
  let epoch=1,signedIn=true; const listeners=new Set<()=>void>();
  const session={view:()=>({signedIn,sessionEpoch:epoch}),request:vi.fn(),subscribe:(f:()=>void)=>{listeners.add(f);return()=>listeners.delete(f);}};
  const runtime=new SopQueryRuntime(session as unknown as ProductSession,()=>{});
  const controller=new SopWindowController({preloadPath:'/tmp/unused-preload',legacyEnabled:false,queryBounds:()=>null,workArea:()=>({x:0,y:0,width:1200,height:900}),sessionRole:()=> 'agent'});
  controller.setQueryRuntime(runtime);
  try {
    await controller.open('sop-query');
    expect(runtime.projection().shops).toHaveLength(1);
    const choices = runtime.projection().shops;
    controller.close();
    await controller.open('sop-query');
    expect(runtime.projection().shops).toEqual(choices);
    expect(mocks.access).toHaveBeenCalledTimes(1);
    signedIn=false;epoch++;for(const f of listeners)f();
    signedIn=true;epoch++;for(const f of listeners)f();
    controller.close();const result=await controller.open('sop-query');
    expect(result).toEqual({ ok: true });
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(runtime.projection().shops).toHaveLength(1);
  } finally {controller.destroy();}
});
