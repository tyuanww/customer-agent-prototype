import { expect, type ElectronApplication, type Page } from '@playwright/test';

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

export async function returnToQueryWindow(app: ElectronApplication, query: Page): Promise<void> {
  await app.evaluate(({ app: native }) => native.focus({ steal: true }));
  const shell = query.getByTestId('query-shell');
  if (await shell.getAttribute('data-parked') === 'true') {
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!fox) throw new Error('Fox window missing');
    await fox.getByTestId('fox-button').click();
  } else {
    await query.evaluate(() => window.customerAgent!.openSearch());
  }
  await expect(shell).toHaveAttribute('data-parked', 'false');
  await expect(shell).toHaveAttribute('data-opening', 'false');
  await waitForFocusedWindow(app, 'query');
  await expect(query.getByTestId('question-input')).toBeFocused();
}
