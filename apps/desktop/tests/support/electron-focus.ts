import { expect, type ElectronApplication } from '@playwright/test';

export async function waitForFocusedWindow(
  app: ElectronApplication,
  role: 'dashboard' | 'query',
): Promise<void> {
  await expect.poll(() => app.evaluate(({ BrowserWindow }, expectedRole) => {
    const target = BrowserWindow.getAllWindows().find((window) => (
      !window.isDestroyed()
      && window.webContents.getURL().includes(`role=${expectedRole}`)
    ));
    return {
      focused: target?.isFocused() ?? false,
      webContentsFocused: target?.webContents.isFocused() ?? false,
    };
  }, role)).toEqual({ focused: true, webContentsFocused: true });
}
