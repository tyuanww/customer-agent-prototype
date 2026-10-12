import { execFileSync } from 'node:child_process';
import { expect, type ElectronApplication } from '@playwright/test';

function isRunning(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

/** Dispose only the Electron instance launched by this test. During teardown,
 * accept unsaved-work dialogs and bound quit so a failed assertion remains
 * visible instead of waiting on a native modal until the worker times out. */
export async function closeOwnedElectron(app: ElectronApplication) {
  const child = app.process();
  let mainPid: number | undefined;
  let forceError: unknown;
  const force = setTimeout(() => {
    try {
      // Playwright launches Windows Electron through cmd.exe. Killing just
      // that shell leaves Electron alive, sometimes holding its stdio open.
      // Supervise the native PID even when the launcher has already exited.
      if (process.platform === 'win32') {
        const pid = mainPid ?? child.pid;
        if (pid !== undefined && isRunning(pid)) {
          execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'pipe', timeout: 10_000,
          });
        }
      } else if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch (error) { forceError = error; }
  }, 5000);
  try {
    try {
      mainPid = await app.evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
        return process.pid;
      });
      await app.close();
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
    if (process.platform === 'win32' && mainPid !== undefined) {
      await expect.poll(() => {
        if (forceError) throw forceError;
        return isRunning(mainPid!);
      }, { timeout: 15_000, message: 'Owned Electron main process must exit, not just its launcher' }).toBe(false);
    }
  } finally { clearTimeout(force); }
  if (forceError) throw forceError;
}
