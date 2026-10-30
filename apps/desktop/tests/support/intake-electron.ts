import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from './owned-electron';

/** Launch against one synthetic host in a freshly created, caller-owned userData
 * directory. After success the caller owns teardown; failed initialization closes
 * its own Electron before rejecting. No packaged request falls back to development. */
export async function launchIntakeElectron(options: {
  desktopRoot: string;
  userDataDirectory: string;
  apiOrigin: string;
  identityOrigin: string;
  evidenceDirectory: string;
}): Promise<ElectronApplication> {
  const { desktopRoot, userDataDirectory, apiOrigin, identityOrigin, evidenceDirectory } = options;
  const packagedExecutable = process.env.CUSTOMER_AGENT_INTAKE_PACKAGED_EXECUTABLE;
  const packaged = packagedExecutable !== undefined;
  if (packaged) {
    if (!path.isAbsolute(packagedExecutable) || !existsSync(packagedExecutable) || !statSync(packagedExecutable).isFile()) {
      throw new Error('CUSTOMER_AGENT_INTAKE_PACKAGED_EXECUTABLE must name an existing absolute executable file; refusing development fallback.');
    }
    // Installed apps ignore development origins. Never overwrite an existing
    // operator profile; every scenario supplies its own new temporary directory.
    writeFileSync(path.join(userDataDirectory, 'synthetic-stack.json'), JSON.stringify({
      mode: 'synthetic-local', apiOrigin, identityOrigin, contentIntake: 'faq-v2',
    }), { mode: 0o600, flag: 'wx' });
  }
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: desktopRoot, executablePath: packagedExecutable,
      args: [`--user-data-dir=${userDataDirectory}`, ...(packaged ? [] : ['out/main/index.js']), '--demo-e2e'], env: {
        ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: packaged ? 'http://127.0.0.1:1' : apiOrigin,
        CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: packaged ? 'http://127.0.0.1:2' : identityOrigin,
        CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2',
      } });
    if (packaged) {
      const identity = await app.evaluate(({ app, screen }) => ({ packaged: app.isPackaged, version: app.getVersion(),
        executable: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData'),
        displays: screen.getAllDisplays().map(display => ({ bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor })) }));
      expect(identity).toMatchObject({ packaged: true,
        version: JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version });
      expect(realpathSync(identity.executable)).toBe(realpathSync(packagedExecutable));
      expect(realpathSync(identity.userData)).toBe(realpathSync(userDataDirectory));
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(path.join(evidenceDirectory, 'packaged-identity.json'), JSON.stringify(identity, null, 2));
    }
    return app;
  } catch (error) {
    if (app) {
      try { await closeOwnedElectron(app); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Intake Electron initialization and owned cleanup both failed.'); }
    }
    throw error;
  }
}
