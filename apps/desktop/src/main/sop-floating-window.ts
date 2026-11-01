import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { SopFloatingSurface } from './sop-presentation-owner';
import { lockRendererWindow } from './window-security';
import { loadRenderer } from './overlay-renderer-loader';

export async function createSopFloatingWindow(options: { devServerUrl?: string; onLost(): void }): Promise<SopFloatingSurface> {
  const win = new BrowserWindow({ width: 580, height: 620, show: false, frame: false, transparent: false,
    resizable: false, skipTaskbar: true, alwaysOnTop: true, title: 'SOP 流程',
    webPreferences: { preload: join(__dirname, '../preload/sop.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.setAlwaysOnTop(true, 'floating');
  let destroying = false;
  const lost = () => { if (!destroying) options.onLost(); };
  win.on('close', event => { if (!destroying) { event.preventDefault(); win.hide(); lost(); } });
  win.webContents.on('render-process-gone', () => { destroying = true; win.destroy(); lost(); options.onLost(); });
  win.on('closed', lost);
  lockRendererWindow(win);
  try { await loadRenderer(win, 'sop-floating', options.devServerUrl); }
  catch (error) { destroying = true; win.destroy(); throw error; }
  return {
    contents: () => win.isDestroyed() ? null : win.webContents,
    getBounds: () => win.isDestroyed() ? null : win.getBounds(),
    getWorkArea: () => screen.getDisplayMatching(win.getBounds()).workArea,
    prepare: () => !win.isDestroyed(),
    applyBounds: bounds => { if (win.isDestroyed()) return false; win.setBounds(bounds); return true; },
    show: () => { if (win.isDestroyed()) return false; win.show(); win.focus(); return true; },
    hide: () => { if (win.isDestroyed()) return false; win.hide(); return true; },
    restore: () => !win.isDestroyed(),
    destroy: () => { destroying = true; if (!win.isDestroyed()) win.destroy(); },
  };
}
