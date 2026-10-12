import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, _electron as electron } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';

function isRunning(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

for (const launcherExits of [false, true]) {
test(`Windows forced teardown removes Electron when launcher exits=${launcherExits}`, async () => {
  test.skip(process.platform !== 'win32', 'Windows launcher process-tree regression');
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-owned-electron-'));
  const entry = path.join(directory, 'main.cjs');
  writeFileSync(entry, `const { app, BrowserWindow } = require('electron');
    app.on('before-quit', event => {
      event.preventDefault();
      if (${launcherExits}) process.kill(process.ppid);
    });
    app.whenReady().then(() => {
      const window = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false
      } });
      window.loadURL('data:text/html,<title>Synthetic teardown fixture</title>');
    });`);
  let mainPid: number | undefined;
  try {
    const app = await electron.launch({ args: [`--user-data-dir=${directory}`, entry] });
    const page = await app.firstWindow();
    await page.waitForLoadState();
    mainPid = await app.evaluate(() => process.pid);
    const rendererPid = await (await app.browserWindow(page)).evaluate(win => win.webContents.getOSProcessId());
    expect(mainPid).not.toBe(app.process().pid);
    expect(isRunning(mainPid)).toBe(true);
    expect(isRunning(rendererPid)).toBe(true);
    await closeOwnedElectron(app);
    // A closed cmd.exe is insufficient: both owned native processes must exit.
    await expect.poll(() => [mainPid!, rendererPid].every(pid => !isRunning(pid))).toBe(true);
  } finally {
    // Preserve a failed assertion while removing only this fixture's process tree.
    if (mainPid !== undefined && isRunning(mainPid)) {
      execFileSync('taskkill.exe', ['/PID', String(mainPid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 });
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
}
