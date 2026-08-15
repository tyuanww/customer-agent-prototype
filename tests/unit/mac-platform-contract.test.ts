import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
) as {
  scripts: Record<string, string>;
  build: {
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

describe('macOS distribution contract', () => {
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
    expect(packageRunner).toContain("buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false'");
    expect(packageRunner).toContain("'-c.mac.identity=null'");
    expect(packageRunner).toContain("'-c.mac.notarize=false'");
    expect(packageRunner).toContain("'release/local-unsigned'");
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
    expect(packageRunner).toContain('SystemRootCertificates.keychain');
    expect(packageRunner).toContain('NODE_EXTRA_CA_CERTS');
    expect(packageRunner).toContain('rmSync(temporaryCaDirectory');
    expect(packageRunner).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
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

describe('macOS runtime contract', () => {
  it('keeps the focusable query visible across Spaces and reconciles display topology', () => {
    expect(controller).toContain(
      'setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })',
    );
    for (const eventName of [
      'display-added',
      'display-removed',
      'display-metrics-changed',
    ]) {
      expect(controller).toContain(`screen.on('${eventName}'`);
      expect(controller).toContain(`screen.removeListener('${eventName}'`);
    }
    expect(controller).toContain('DISPLAY_RECONCILE_DELAY_MS = 100');
    expect(controller).toContain('if (this.chromeHandoffMode !== null)');
  });
});
