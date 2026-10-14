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
    // Design preview switches are dev-server only. Packaged/customer installs
    // always load the real React renderer without sample data.
    //   CUSTOMER_AGENT_DESKTOP_DESIGN=v9      -> React dashboard with local sample data
    //   CUSTOMER_AGENT_DESKTOP_DESIGN=v9-html -> raw standalone v9 HTML (static design)
    const design = role === 'dashboard' && devServerUrl ? process.env.CUSTOMER_AGENT_DESKTOP_DESIGN : undefined;
    const useV9HtmlPreview = design === 'v9-html';
    const useV9ReactPreview = design === 'v9';
    if (devServerUrl) {
      const url = new URL(devServerUrl);
      if (useV9HtmlPreview) url.pathname = '/features/dashboard/workbench-design-v9.html';
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
