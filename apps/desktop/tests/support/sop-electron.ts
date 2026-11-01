import fs from 'node:fs';
import path from 'node:path';
import { expect, _electron as electron, type ElectronApplication } from '@playwright/test';

export async function launchSopElectron(options: {
  desktopRoot: string;
  userDataDirectory: string;
  archive?: string;
}): Promise<ElectronApplication> {
  const { desktopRoot, userDataDirectory, archive } = options;
  const executable = process.env.CUSTOMER_AGENT_SOP_PACKAGED_EXECUTABLE;
  const entry = archive ?? process.env.CUSTOMER_AGENT_SOP_E2E_ENTRY;
  if (entry !== undefined && (!path.isAbsolute(entry) || !fs.existsSync(entry) || !fs.statSync(entry).isFile())) {
    throw new Error('CUSTOMER_AGENT_SOP_E2E_ENTRY must name an absolute built entry file.');
  }
  if (executable !== undefined) {
    if (entry !== undefined || !path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
      throw new Error('CUSTOMER_AGENT_SOP_PACKAGED_EXECUTABLE must name a packaged executable without an ASAR override.');
    }
    fs.writeFileSync(path.join(userDataDirectory, 'synthetic-stack.json'), '{"mode":"synthetic-offline"}', { mode: 0o600, flag: 'wx' });
  }
  const app = await electron.launch({ cwd: desktopRoot, executablePath: executable,
    args: [`--user-data-dir=${userDataDirectory}`, ...(executable ? [] : [entry ?? path.join(desktopRoot, 'out/main/index.js')]), '--demo-e2e'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CUSTOMER_AGENT_'))), DEMO_E2E: '1', DEMO_E2E_ACCELERATOR: 'CommandOrControl+Alt+Shift+Z', CUSTOMER_AGENT_PRODUCT_PROFILE: '' } });
  try {
    if (executable) {
      const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath, userData: app.getPath('userData') }));
      expect(identity.packaged).toBe(true);
      expect(fs.realpathSync(identity.executable)).toBe(fs.realpathSync(executable));
      expect(fs.realpathSync(identity.userData)).toBe(fs.realpathSync(userDataDirectory));
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
