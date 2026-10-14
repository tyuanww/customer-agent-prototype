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
    // Design preview is dev-server only. Packaged installs load the React
    // workbench and do not turn on sample data. The standalone HTML mock is
    // not kept in the repo; it blew the source-input budget.
    const design = role === 'dashboard' && devServerUrl ? process.env.CUSTOMER_AGENT_DESKTOP_DESIGN : undefined;
    const useV9ReactPreview = design === 'v9';
    if (devServerUrl) {
      const url = new URL(devServerUrl);
      if (useV9ReactPreview) url.searchParams.set('preview', 'intake');
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
