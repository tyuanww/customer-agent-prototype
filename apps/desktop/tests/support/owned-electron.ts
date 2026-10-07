import type { ElectronApplication } from '@playwright/test';

/** Dispose only the Electron instance launched by this test. During teardown,
 * accept unsaved-work dialogs and bound quit so a failed assertion remains
 * visible instead of waiting on a native modal until the worker times out. */
export async function closeOwnedElectron(app: ElectronApplication) {
  const process = app.process();
  const force = setTimeout(() => { process.kill('SIGKILL'); }, 5000);
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    await app.close();
  } catch (error) {
    if (process.exitCode === null && process.signalCode === null) throw error;
  } finally { clearTimeout(force); }
}
