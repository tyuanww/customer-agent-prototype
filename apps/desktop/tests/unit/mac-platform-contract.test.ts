import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(root, '../..');
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
) as {
  scripts: Record<string, string>;
  build: {
    directories: { output: string };
    appId: string;
    publish: null;
    afterPack: string;
    dmg: { writeUpdateInfo: boolean };
    extraResources: Array<{ from: string; to: string }>;
    mac: {
      target: Array<{ target: string; arch: string[] }>;
      icon: string;
      minimumSystemVersion: string;
      hardenedRuntime: boolean;
      forceCodeSigning: boolean;
      notarize: boolean;
      entitlements: string;
      entitlementsInherit: string;
    };
  };
};
const controller = readFileSync(
  path.join(root, 'src/main/overlay-controller.ts'),
  'utf8',
);
const releasePreflight = readFileSync(
  path.join(root, 'scripts/verify-mac-release-env.mjs'),
  'utf8',
);
const afterPack = readFileSync(
  path.join(root, 'scripts/after-pack-macos.mjs'),
  'utf8',
);
const packageVerifier = readFileSync(
  path.join(root, 'scripts/verify-mac-package.mjs'),
  'utf8',
);
const packageFinalizer = readFileSync(
  path.join(root, 'scripts/finalize-mac-package.mjs'),
  'utf8',
);
const packageRunner = readFileSync(
  path.join(root, 'scripts/package-macos.mjs'),
  'utf8',
);
const nodeSystemCa = readFileSync(
  path.join(root, 'scripts/node-system-ca.mjs'),
  'utf8',
);

describe('macOS distribution contract', () => {
  it('executes the packaged brand icon gate against real fixture files', async () => {
    const verifier = await import(
      pathToFileURL(path.join(root, 'scripts/mac-package-brand-gate.mjs')).href
    ) as {
      verifyMacPackageBrandGate: (input: {
        infoPlist: string;
        resourcesDirectory: string;
        expectedBrandIcon: string;
        execFile: ReturnType<typeof vi.fn>;
      }) => string;
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-mac-icon-'));
    const resourcesDirectory = path.join(fixtureRoot, 'Resources');
    const expectedBrandIcon = path.join(fixtureRoot, 'build', 'icon.icns');
    const packagedIcon = path.join(resourcesDirectory, 'icon.icns');
    mkdirSync(resourcesDirectory, { recursive: true });
    mkdirSync(path.dirname(expectedBrandIcon), { recursive: true });
    writeFileSync(expectedBrandIcon, 'approved-brand-icon');
    const infoPlist = path.join(fixtureRoot, 'Info.plist');
    const verify = (iconFile: string): string => verifier.verifyMacPackageBrandGate({
      infoPlist,
      resourcesDirectory,
      expectedBrandIcon,
      execFile: vi.fn(() => iconFile),
    });

    try {
      expect(() => verify('electron.icns')).toThrow(/must reference the generated brand icon/);

      expect(() => verify('icon.icns')).toThrow(/must include icon\.icns/);

      writeFileSync(packagedIcon, '');
      expect(() => verify('icon.icns')).toThrow(/must include icon\.icns/);

      writeFileSync(packagedIcon, 'wrong-brand-icon');
      expect(() => verify('icon.icns')).toThrow(/does not match/);

      writeFileSync(packagedIcon, 'approved-brand-icon');
      expect(verify('icon')).toBe(packagedIcon);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('builds explicit unsigned local proof packages and fail-closed release packages', () => {
    expect(packageJson.scripts['package:mac:local']).toContain(
      'node scripts/package-macos.mjs local',
    );
    expect(packageJson.scripts['package:mac']).toMatch(
      /^node scripts\/verify-mac-release-env\.mjs /,
    );
    expect(packageJson.scripts['package:mac']).toContain(
      'node scripts/package-macos.mjs distribution',
    );
    expect(packageRunner).toContain("['build:services']");
    expect(packageRunner).toContain("buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false'");
    expect(packageRunner).toContain("'-c.mac.identity=null'");
    expect(packageRunner).toContain("'-c.mac.notarize=false'");
    expect(packageRunner).toContain("mode === 'local' ? 'local-unsigned' : 'distribution'");
    expect(packageJson.build.directories.output).toBe('../../release');
    expect(packageRunner).toContain('-UNSIGNED.${ext}');
    expect(packageRunner).toContain("'scripts/finalize-mac-package.mjs', mode");
    expect(packageRunner).toContain("'scripts/verify-mac-package.mjs', mode");
    expect(packageJson.build.publish).toBeNull();
    expect(packageJson.build.afterPack).toBe('./scripts/after-pack-macos.mjs');
    expect(packageJson.build.dmg.writeUpdateInfo).toBe(false);

    expect(packageJson.build.mac.target).toEqual([
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ]);
    expect(packageJson.build.mac).toMatchObject({
      icon: 'build/icon.icns',
      minimumSystemVersion: '12.0',
      hardenedRuntime: true,
      forceCodeSigning: true,
      notarize: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    });
  });

  it('bridges the macOS system trust store without disabling TLS verification', () => {
    expect(packageRunner).toContain("prepareNodeSystemCaEnvironment()");
    expect(packageRunner).toContain('systemCa.cleanup()');
    expect(nodeSystemCa).toContain('SystemRootCertificates.keychain');
    expect(nodeSystemCa).toContain('NODE_EXTRA_CA_CERTS');
    expect(nodeSystemCa).toContain('removeTemporaryDirectory(temporaryDirectory)');
    expect(nodeSystemCa).toContain('catch (error)');
    expect(nodeSystemCa).toContain("customer-agent-system-ca-");
    expect(packageRunner).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(nodeSystemCa).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  });

  it('keeps hardened-runtime entitlements minimal and production-safe', () => {
    for (const filename of [
      'build/entitlements.mac.plist',
      'build/entitlements.mac.inherit.plist',
    ]) {
      const plist = readFileSync(path.join(root, filename), 'utf8');
      expect(plist).toContain('com.apple.security.cs.allow-jit');
      expect(plist).toContain(
        'com.apple.security.cs.allow-unsigned-executable-memory',
      );
      expect(plist).not.toContain(
        'com.apple.security.cs.allow-dyld-environment-variables',
      );
      expect(plist).not.toContain(
        'com.apple.security.cs.disable-library-validation',
      );
      expect(plist).not.toContain('com.apple.security.app-sandbox');
    }
  });

  it('checks identity, stable app id, full Xcode, and notarization auth without logging secrets', () => {
    expect(packageJson.build.appId).toBe('local.demo.customer-agent');
    expect(releasePreflight).toContain("execFileSync('xcodebuild', ['-version']");
    expect(releasePreflight).toContain("'find-identity', '-v', '-p', 'codesigning'");
    expect(releasePreflight).toContain('Developer ID Application:');
    expect(releasePreflight).toContain('APPLE_API_KEY');
    expect(releasePreflight).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(releasePreflight).toContain('APPLE_KEYCHAIN_PROFILE');
    expect(releasePreflight).not.toMatch(
      /console\.(?:log|error)\([^\n]*process\.env/,
    );
  });

  it('removes unused macOS permissions, update metadata, and private repository coordinates', () => {
    expect(afterPack).toContain("'NSAppTransportSecurity'");
    expect(afterPack).toContain("'NSCameraUsageDescription'");
    expect(afterPack).toContain("'NSMicrophoneUsageDescription'");
    expect(afterPack).toContain("'NSBluetoothAlwaysUsageDescription'");
    expect(packageVerifier).toContain("path.basename(name)");
    expect(packageVerifier).toContain("basename === 'app-update.yml'");
    expect(packageVerifier).toContain('/^latest.*\\.ya?ml$/');
    expect(packageVerifier).toContain("basename.endsWith('.blockmap')");
    expect(packageFinalizer).toContain("path.basename(relativePath).endsWith('.blockmap')");
    expect(packageFinalizer).toContain("absolutePath.startsWith(`${outputDir}${path.sep}`)");
    expect(packageVerifier).toContain(
      'verifyMacPackageBrandGate({ infoPlist, resourcesDirectory: resources, expectedBrandIcon })',
    );
    expect(packageVerifier).toContain('LSUIElement');
    expect(packageVerifier).toContain('LSBackgroundOnly');
    expect(packageVerifier).toContain("execFileSync('codesign'");
    expect(packageVerifier).toContain("execFileSync('spctl'");
    expect(packageVerifier).toContain("execFileSync('xcrun', ['stapler', 'validate'");
    expect(packageJson.build.extraResources).toEqual(
      expect.arrayContaining([
        {
          from: 'THIRD_PARTY_NOTICES.md',
          to: 'THIRD_PARTY_NOTICES.md',
        },
        {
          from: 'node_modules/electron/dist/LICENSE',
          to: 'licenses/Electron-LICENSE.txt',
        },
        {
          from: 'node_modules/electron/dist/LICENSES.chromium.html',
          to: 'licenses/Chromium-LICENSES.html',
        },
      ]),
    );
  });
});

describe('macOS Dock identity contract', () => {
  it('keeps a regular Dock presence and only sets a dev icon on darwin', () => {
    const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
    const identity = readFileSync(path.join(root, 'src/main/app-identity.ts'), 'utf8');
    expect(identity).toContain("app.setActivationPolicy?.('regular')");
    expect(identity).toContain('if (dock && !dock.isVisible())');
    expect(identity).toContain('await dock.show()');
    expect(identity).not.toContain('app.dock.hide');
    expect(identity).toContain("process.platform !== 'darwin'");
    expect(identity).toContain('app.dock?.setIcon');
    expect(identity).toContain('!location.isPackaged');
    const iconPaths = readFileSync(path.join(root, 'src/main/app-icon-paths.ts'), 'utf8');
    const appIcon = readFileSync(path.join(root, 'src/shared/app-icon.ts'), 'utf8');
    expect(iconPaths).toContain('APP_ICON_MASTER_RELATIVE_PATH');
    expect(appIcon).toContain('assets/app-icon.png');
    expect(identity).not.toContain('return trayIconCandidates');
    expect(main).toContain('await applyApplicationIdentity(shuttingDown)');
    expect(packageJson.build.mac.icon).toBe('build/icon.icns');
    expect(packageJson.scripts['generate:app-icons']).toContain('scripts/generate-app-icons.mjs');
    expect(packageRunner).toContain("['generate:app-icons']");
    const gitignore = readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('build/icon.icns');
    expect(gitignore).toContain('build/icon.png');
    expect(gitignore).toContain('build/icon.ico');
  });
});

describe('macOS runtime contract', () => {
  it('keeps a regular Dock and only reconciles Query on the current Space', () => {
    expect(controller).not.toContain('skipTransformProcessType: true');
    expect(controller).not.toContain('setVisibleOnAllWorkspaces(');
    expect(controller).toContain('dispose(): void');
    for (const eventName of [
      'display-added',
      'display-removed',
      'display-metrics-changed',
    ]) {
      expect(controller).toContain(`screen.on('${eventName}'`);
      expect(controller).toContain(`screen.removeListener('${eventName}'`);
    }
    expect(controller).toContain('DISPLAY_RECONCILE_DELAY_MS = 100');
    expect(controller).toContain('dismiss(restorePreviousApp = false)');
    expect(controller).toContain('app.hide()');
    expect(controller).toContain('restorePreviousAppOnIdle');
    expect(controller).toContain('if (this.chromeHandoffMode !== null)');
  });

  it('adopts WindowServer fox bounds without moving the native window on hover', () => {
    const peekMethod = controller.match(
      /setFoxPeek\(intent: FoxPeekIntent, epoch: number\): void \{([\s\S]*?)\n {2}\}\n\n {2}beginNativeContextMenu/,
    )?.[1] ?? '';
    expect(peekMethod).toContain('this.syncFoxOriginFromNativeBounds(fox)');
    expect(peekMethod).toContain('this.foxPeekIntent = intent');
    expect(peekMethod).not.toContain('setBounds(');
    expect(controller).toContain("fox.on('move', sync)");
    expect(controller).toContain("fox.on('moved', sync)");
    expect(controller).toMatch(
      /openSearch[\s\S]*if \(this\.isWindowVisible\(idleFox\)\) \{\s*this\.syncFoxOriginFromNativeBounds\(idleFox\)/,
    );
    expect(controller).toContain(
      'foxVisualCenterForNativeRect(fullFoxRect, this.foxDockEdge, peekOffset)',
    );
    const closingMethod = controller.match(
      /private finishClosingHandoff\(handoffId: number\): void \{([\s\S]*?)\n {2}\}\n\n {2}private focusQueryWindow/,
    )?.[1] ?? '';
    expect(closingMethod).toContain('fox.setBounds(foxRect)');
    expect(closingMethod).not.toContain('dockFoxNativeRect');
    expect(closingMethod).toContain('this.syncFoxOriginFromNativeBounds(fox)');
  });
});
