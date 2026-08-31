import type { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { RendererRole } from '../shared/overlay-events';

export async function loadRenderer(
  win: BrowserWindow,
  role: RendererRole,
  devServerUrl?: string,
  isCancelled?: () => boolean,
): Promise<'loaded' | 'cancelled'> {
  if (win.isDestroyed() || isCancelled?.()) {
    return 'cancelled';
  }
  try {
    if (devServerUrl) {
      const url = new URL(devServerUrl);
      url.searchParams.set('role', role);
      url.searchParams.set('platform', process.platform);
      await win.loadURL(url.toString());
    } else {
      await win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { role, platform: process.platform },
      });
    }
  } catch (error) {
    if (win.isDestroyed() || isCancelled?.()) {
      return 'cancelled';
    }
    throw error;
  }
  if (win.isDestroyed() || isCancelled?.()) {
    return 'cancelled';
  }
  return 'loaded';
}
