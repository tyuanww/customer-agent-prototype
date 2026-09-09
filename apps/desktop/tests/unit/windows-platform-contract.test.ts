import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    win: {
      icon: string;
      extraResources: Array<{ from: string; to: string }>;
      signExecutable: boolean;
      signAndEditExecutable?: boolean;
      artifactName: string;
      certificateFile?: string;
      certificateSha1?: string;
    };
    nsis: {
      differentialPackage: boolean;
    };
  };
};
const packageWindows = readFileSync(path.join(root, 'scripts/package-windows.mjs'), 'utf8');
const electronViteConfig = readFileSync(path.join(root, 'electron.vite.config.ts'), 'utf8');
const verifyWindowsPackage = readFileSync(
  path.join(root, 'scripts/verify-windows-package.mjs'),
  'utf8',
);
const readme = readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
const developmentBrief = readFileSync(path.join(repositoryRoot, 'DEVELOPMENT_BRIEF.md'), 'utf8');

describe('Windows local-unsigned packaging contract', () => {
  it('keeps package:win as an explicit UNSIGNED local proof, isolated from distribution', () => {
    expect(packageJson.scripts['package:win']).toBe('node scripts/package-windows.mjs local');
    expect(packageJson.scripts['package:win:distribution']).toBeUndefined();
    expect(packageJson.build.directories.output).toBe('../../release');
    expect(packageJson.build.win.icon).toBe('build/icon.ico');
    expect(packageJson.build.win.signExecutable).toBe(false);
    expect(packageJson.build.win.signAndEditExecutable).toBeUndefined();
    expect(packageJson.build.win.extraResources).toContainEqual({
      from: 'build/icon.ico',
      to: 'icon.ico',
    });
    expect(packageJson.build.win.certificateFile).toBeUndefined();
    expect(packageJson.build.win.certificateSha1).toBeUndefined();
    expect(packageJson.build.win.artifactName).toContain('-UNSIGNED.');
    expect(packageJson.build.nsis.differentialPackage).toBe(false);

    expect(packageWindows).toContain('scripts/generate-app-icons.mjs');
    expect(packageWindows).toContain("node_modules/electron-vite/bin/electron-vite.js");
    expect(packageWindows).toContain("typescript/bin/tsc");
    expect(packageWindows).toContain('tsconfig.build.json');
    expect(packageWindows).toContain("packages/contracts");
    expect(packageWindows).toContain('assertMainBundle(desktopRoot)');
    expect(packageWindows).toContain('assertMainBundleHasNoWorkspaceBareImports');
    expect(packageWindows).toContain("node_modules/electron-builder/out/cli/cli.js");
    expect(electronViteConfig).toContain("externalizeDepsPlugin({ exclude: ['@customer-agent/contracts'] })");
    expect(packageWindows).not.toMatch(/execFileSync\(['"](?:pnpm|electron-builder)['"]/);
    expect(packageWindows).toContain("WINDOWS_LOCAL_UNSIGNED_OUTPUT = 'release/local-unsigned/windows'");
    expect(packageWindows).toContain("buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false'");
    expect(packageWindows).toContain('?? prepareNodeSystemCaEnvironment');
    expect(packageWindows).toContain('const systemCa = prepareSystemCa()');
    expect(packageWindows).toContain('systemCa.cleanup()');
    expect(packageWindows).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(packageWindows).toContain('-UNSIGNED.${ext}');
    expect(packageWindows).toContain('-c.win.signExecutable=false');
    expect(packageWindows).not.toContain('signAndEditExecutable');
    expect(packageWindows).toContain('local-unsigned only');
    expect(packageWindows).not.toContain('release/distribution');
    expect(packageWindows).not.toMatch(/signtool|osslsigncode|Authenticode|EV certificate/i);
    expect(packageWindows).toContain('resolvedOutputDirectory !== expectedOutputDirectory');
    expect(packageWindows).toContain('forbiddenCleanupTargets.has(resolvedOutputDirectory)');
    expect(packageWindows).toContain(
      'rmSync(resolvedOutputDirectory, { recursive: true, force: true })',
    );
    expect(packageWindows.indexOf('resetOutput(repositoryRoot)')).toBeLessThan(
      packageWindows.indexOf('node_modules/electron-builder/out/cli/cli.js'),
    );
    expect(packageWindows).toContain("['scripts/verify-windows-package.mjs']");
    expect(packageWindows.indexOf('node_modules/electron-builder/out/cli/cli.js')).toBeLessThan(
      packageWindows.indexOf('scripts/verify-windows-package.mjs'),
    );
    expect(verifyWindowsPackage).toContain("'win-unpacked'");
    expect(verifyWindowsPackage).toContain("'resources'");
    expect(verifyWindowsPackage).toContain("'icon.ico'");
    expect(verifyWindowsPackage).toContain('app-update\\.ya?ml');
    expect(verifyWindowsPackage).toContain('latest.*\\.ya?ml');
    expect(verifyWindowsPackage).toContain("endsWith('.blockmap')");
    expect(verifyWindowsPackage).toContain('Electron-LICENSE.txt');
    expect(verifyWindowsPackage).toContain('Chromium-LICENSES.html');
    expect(verifyWindowsPackage).toContain('does not inspect the PE executable icon resource');
  });

  it('documents the unsigned fact and forbids presenting the local artifact as a signed release', () => {
    expect(readme).toContain('pnpm package:win');
    expect(readme).toContain('release/local-unsigned/windows/');
    expect(readme).toContain('UNSIGNED');
    expect(readme).toContain('**不是**正式外发包');
    expect(readme).toContain('release/distribution/');
    expect(readme).toContain('禁止把未签名产物写成已签名');
    expect(readme).not.toMatch(/Windows 正式签名|已签名的 Windows|Windows 安装包已签名/);
    expect(readme).toContain('不验证 PE 可执行文件内部的图标资源');
    expect(developmentBrief).toContain('release/local-unsigned/windows/');
    expect(developmentBrief).toContain('不把该后验写成 PE 图标资源');
  });

  it('cleans only the exact isolated Windows output and preserves sibling artifacts', async () => {
    const packageRunner = await import(
      pathToFileURL(path.join(root, 'scripts/package-windows.mjs')).href
    ) as {
      resetWindowsPackageOutput: (projectRoot: string) => string;
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-windows-output-'));
    const windowsOutput = path.join(
      fixtureRoot,
      'release',
      'local-unsigned',
      'windows',
    );
    const siblingOutput = path.join(
      fixtureRoot,
      'release',
      'local-unsigned',
      'mac-universal',
    );
    mkdirSync(windowsOutput, { recursive: true });
    mkdirSync(siblingOutput, { recursive: true });
    writeFileSync(path.join(windowsOutput, 'stale.blockmap'), 'stale');
    writeFileSync(path.join(siblingOutput, 'preserve.txt'), 'preserve');

    try {
      expect(packageRunner.resetWindowsPackageOutput(fixtureRoot)).toBe(windowsOutput);
      expect(existsSync(windowsOutput)).toBe(false);
      expect(readFileSync(path.join(siblingOutput, 'preserve.txt'), 'utf8')).toBe('preserve');
      expect(existsSync(path.join(fixtureRoot, 'release', 'local-unsigned'))).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('prepares Electron license inputs before packaging a fresh checkout without a prior launch', async () => {
    const packageRunner = await import(
      pathToFileURL(path.join(root, 'scripts/package-windows.mjs')).href
    );
    let distributionReady = false;
    let packaged = false;
    const cleanup = vi.fn();
    const environment = { SYNTHETIC_CA: 'prepared' };
    packageRunner.packageWindows('local', {
      prepareSystemCa: () => ({ environment, cleanup }),
      runCommand: (_executable: string, args: string[], options: { env: object }) => {
        if (args[0] === 'node_modules/electron/install.js') {
          expect(options.env).toBe(environment);
          distributionReady = true;
        }
        if (args[0] === 'node_modules/electron-builder/out/cli/cli.js') {
          if (!distributionReady) throw new Error('Missing Electron license inputs');
          packaged = true;
        }
      },
      resetOutput: vi.fn(),
      assertMainBundle: vi.fn(),
    });
    expect(packaged).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    { stage: 'Electron distribution preparation', failAtCommand: 1 },
    { stage: 'icon generation', failAtCommand: 2 },
    { stage: 'contracts runtime build', failAtCommand: 3 },
    { stage: 'renderer build', failAtCommand: 4 },
    { stage: 'electron-builder', failAtCommand: 5 },
    { stage: 'package verifier', failAtCommand: 6 },
  ])('cleans the temporary CA state when $stage fails and stops later commands', async ({
    failAtCommand,
  }) => {
    const packageRunner = await import(
      pathToFileURL(path.join(root, 'scripts/package-windows.mjs')).href
    ) as {
      packageWindows: (
        mode: string,
        dependencies: {
          prepareSystemCa: () => {
            environment: Record<string, string>;
            cleanup: () => void;
          };
          runCommand: (
            executable: string,
            args: string[],
            options: Record<string, unknown>,
          ) => void;
          resetOutput: (projectRoot: string) => string;
          assertMainBundle?: (desktopRoot: string) => void;
        },
      ) => void;
    };
    const failure = new Error(`command ${failAtCommand} failed`);
    const cleanup = vi.fn();
    const resetOutput = vi.fn(() => '/tmp/windows-output');
    const runCommand = vi.fn((
      _executable: string,
      _args: string[],
      _options: Record<string, unknown>,
    ) => {
      if (runCommand.mock.calls.length === failAtCommand) {
        throw failure;
      }
    });

    expect(() => packageRunner.packageWindows('local', {
      prepareSystemCa: () => ({ environment: {}, cleanup }),
      runCommand,
      resetOutput,
      assertMainBundle: vi.fn(),
    })).toThrow(failure);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledTimes(failAtCommand);
    if (failAtCommand < 5) {
      expect(resetOutput).not.toHaveBeenCalled();
    } else {
      expect(resetOutput).toHaveBeenCalledOnce();
    }
    if (failAtCommand < 6) {
      expect(runCommand.mock.calls.some(([, args]) =>
        args.includes('scripts/verify-windows-package.mjs'))).toBe(false);
    }
  });

  it('cleans the temporary CA state when output reset fails before electron-builder', async () => {
    const packageRunner = await import(
      pathToFileURL(path.join(root, 'scripts/package-windows.mjs')).href
    ) as {
      packageWindows: (
        mode: string,
        dependencies: {
          prepareSystemCa: () => {
            environment: Record<string, string>;
            cleanup: () => void;
          };
          runCommand: (
            executable: string,
            args: string[],
            options: Record<string, unknown>,
          ) => void;
          resetOutput: (projectRoot: string) => string;
          assertMainBundle?: (desktopRoot: string) => void;
        },
      ) => void;
    };
    const failure = new Error('output reset failed');
    const cleanup = vi.fn();
    const runCommand = vi.fn();

    expect(() => packageRunner.packageWindows('local', {
      prepareSystemCa: () => ({ environment: {}, cleanup }),
      runCommand,
      assertMainBundle: vi.fn(),
      resetOutput: () => {
        throw failure;
      },
    })).toThrow(failure);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledTimes(4);
  });

  it('stops packaging when the main bundle still imports workspace packages', async () => {
    const packageRunner = await import(
      pathToFileURL(path.join(root, 'scripts/package-windows.mjs')).href
    );
    const { mainBundleHasWorkspaceBareImport } = await import(
      pathToFileURL(path.join(root, 'scripts/assert-main-bundle.mjs')).href
    ) as { mainBundleHasWorkspaceBareImport: (source: string) => boolean };
    expect(mainBundleHasWorkspaceBareImport('import { parseContractSchema } from "@customer-agent/contracts";')).toBe(true);
    expect(mainBundleHasWorkspaceBareImport('const x = 1;')).toBe(false);
    const cleanup = vi.fn();
    const resetOutput = vi.fn();
    const runCommand = vi.fn();
    expect(() => packageRunner.packageWindows('local', {
      prepareSystemCa: () => ({ environment: {}, cleanup }),
      runCommand,
      resetOutput,
      assertMainBundle: () => {
        throw new Error('workspace import');
      },
    })).toThrow('workspace import');
    expect(resetOutput).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledTimes(4);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('fail-closes against incomplete or update-enabled Windows package fixtures', async () => {
    const verifier = await import(
      pathToFileURL(path.join(root, 'scripts/verify-windows-package.mjs')).href
    ) as {
      verifyWindowsPackage: (options: {
        root: string;
        outputDirectory: string;
      }) => { installers: string[]; iconSha256: string };
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-windows-package-'));
    const outputDirectory = path.join(
      fixtureRoot,
      'release',
      'local-unsigned',
      'windows',
    );
    const resourcesDirectory = path.join(outputDirectory, 'win-unpacked', 'resources');
    const expectedIcon = path.join(fixtureRoot, 'build', 'icon.ico');
    const installer = path.join(outputDirectory, 'Customer-Agent-0.1.0-win-x64-UNSIGNED.exe');
    const requiredLicenses = [
      'THIRD_PARTY_NOTICES.md',
      path.join('licenses', 'Electron-LICENSE.txt'),
      path.join('licenses', 'Chromium-LICENSES.html'),
    ];
    mkdirSync(resourcesDirectory, { recursive: true });
    mkdirSync(path.dirname(expectedIcon), { recursive: true });
    writeFileSync(expectedIcon, 'approved-windows-brand-icon');
    writeFileSync(path.join(resourcesDirectory, 'icon.ico'), 'approved-windows-brand-icon');
    for (const relativePath of requiredLicenses) {
      const license = path.join(resourcesDirectory, relativePath);
      mkdirSync(path.dirname(license), { recursive: true });
      writeFileSync(license, `fixture-${path.basename(relativePath)}`);
    }

    const verify = () => verifier.verifyWindowsPackage({
      root: fixtureRoot,
      outputDirectory,
    });

    try {
      expect(() => verify()).toThrow(/No Windows installer/);

      writeFileSync(path.join(outputDirectory, 'Customer-Agent-win-x64.exe'), 'installer');
      expect(() => verify()).toThrow(/must be marked UNSIGNED/);
      rmSync(path.join(outputDirectory, 'Customer-Agent-win-x64.exe'));

      writeFileSync(installer, '');
      expect(() => verify()).toThrow(/Missing or empty Windows local-unsigned installer/);
      writeFileSync(installer, 'installer');

      for (const relativePath of [
        'latest.yml',
        'app-update.yml',
        path.join('win-unpacked', 'package.exe.blockmap'),
      ]) {
        const metadata = path.join(outputDirectory, relativePath);
        mkdirSync(path.dirname(metadata), { recursive: true });
        writeFileSync(metadata, 'update metadata');
        expect(() => verify()).toThrow(/Update metadata must not be generated/);
        rmSync(metadata);
      }

      writeFileSync(path.join(resourcesDirectory, 'icon.ico'), 'wrong-icon');
      expect(() => verify()).toThrow(/does not match build\/icon\.ico/);
      writeFileSync(path.join(resourcesDirectory, 'icon.ico'), 'approved-windows-brand-icon');

      const chromiumLicense = path.join(
        resourcesDirectory,
        'licenses',
        'Chromium-LICENSES.html',
      );
      rmSync(chromiumLicense);
      expect(() => verify()).toThrow(/Missing or empty packaged license notice/);
      writeFileSync(chromiumLicense, 'fixture-Chromium-LICENSES.html');

      expect(verify()).toMatchObject({
        installers: [path.basename(installer)],
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
