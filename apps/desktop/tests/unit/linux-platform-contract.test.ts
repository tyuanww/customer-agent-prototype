import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(root, '../..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  build: {
    extraResources: Array<{ from: string; to: string }>;
    linux: {
      executableName: string;
      icon: string;
      target: Array<{ target: string; arch: string[] }>;
      artifactName: string;
    };
  };
};
const rootPackageJson = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
) as { scripts: Record<string, string> };
const packageLinuxSource = readFileSync(path.join(root, 'scripts/package-linux.mjs'), 'utf8');
const howTo = readFileSync(
  path.join(repositoryRoot, 'docs/how-to-linux-packaged-product-remote.md'),
  'utf8',
);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Linux local-unsigned packaging contract', () => {
  it('keeps package:linux as local-unsigned only and isolated from Windows/mac output', () => {
    expect(packageJson.scripts['package:linux']).toBe('node scripts/package-linux.mjs local');
    expect(packageJson.scripts['package:linux:distribution']).toBeUndefined();
    expect(rootPackageJson.scripts['package:linux']).toBe(
      'pnpm --filter @customer-agent/desktop package:linux',
    );
    expect(packageJson.build.linux.executableName).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(packageJson.build.linux.executableName).not.toContain('@');
    expect(packageJson.build.linux.icon).toBe('build/icon.png');
    expect(packageJson.build.linux.target).toEqual([{ target: 'AppImage', arch: ['x64'] }]);
    expect(packageJson.build.linux.artifactName).toContain('UNSIGNED');
    expect(JSON.stringify(packageJson.build)).not.toMatch(/postgres|postgresql|pg15|apps\/api/i);
  });

  it('builds only on Linux, never as a signed distribution', async () => {
    const moduleUrl = pathToFileURL(path.join(root, 'scripts/package-linux.mjs')).href;
    const { packageLinux } = await import(moduleUrl);
    expect(() => packageLinux('distribution')).toThrow(/local-unsigned only/);
    expect(() => packageLinux('local', { platform: 'darwin' })).toThrow(/must be built on Linux/);
    expect(packageLinuxSource).toContain("LINUX_LOCAL_UNSIGNED_OUTPUT = 'release/local-unsigned/linux'");
    expect(packageLinuxSource).toContain("CSC_IDENTITY_AUTO_DISCOVERY = 'false'");
    expect(packageLinuxSource).toContain('--linux');
    expect(packageLinuxSource).toContain('scripts/verify-linux-package.mjs');
    expect(packageLinuxSource).not.toContain('release/distribution');
    expect(howTo).toContain('package:linux');
    expect(howTo).toContain('必须在 **Linux** 上');
    const verifyDesktop = readFileSync(
      path.join(repositoryRoot, 'docs/how-to-verify-desktop.md'),
      'utf8',
    );
    expect(verifyDesktop).toContain('### 3.4 `pnpm package:linux`');
    expect(verifyDesktop).toContain('须在 **Linux** 上跑');
    expect(verifyDesktop).toContain('### 3.5 W6 正式服务候选产物');
    const ci = readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('linux-feasibility:');
    expect(ci).toContain('pnpm package:linux');
    expect(ci).toContain('linux-feasibility]');
    expect(ci).toContain('xvfb-run');
    expect(ci).toContain('playwright install-deps');
    expect(ci).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(ci).toContain('linux-local-unsigned');
    expect(ci).toContain('*UNSIGNED*.AppImage');
    expect(ci).toContain('if-no-files-found: error');
    expect(ci).toContain('Smoke electron-vite out/ from packaging (not the AppImage)');
    expect(ci).toContain('overlay smoke launches packaging build out/main, not the AppImage');
    expect(ci).not.toMatch(/softprops\/action-gh-release|release:|github\.rest\.repos\.createRelease/);
    expect(ci).toContain('@linux-feasibility');
    const smoke = readFileSync(path.join(root, 'tests/e2e/smoke.spec.ts'), 'utf8');
    expect(smoke).toContain('@linux-feasibility');
    expect(smoke).toContain('out/main/index.js');
    expect(smoke).not.toMatch(/AppImage/);
    expect(verifyDesktop).toContain('非空 UNSIGNED AppImage');
    expect(verifyDesktop).toContain('不是** AppImage');
  });

  it('fail-closes unless a non-empty UNSIGNED AppImage is present', async () => {
    const { verifyLinuxPackage } = await import(
      pathToFileURL(path.join(root, 'scripts/verify-linux-package.mjs')).href
    ) as { verifyLinuxPackage: (options?: { repositoryRoot?: string }) => void };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'linux-package-verify-'));
    directories.push(fixtureRoot);
    const outputDirectory = path.join(fixtureRoot, 'release', 'local-unsigned', 'linux');
    mkdirSync(outputDirectory, { recursive: true });
    const artifact = path.join(
      outputDirectory,
      'Customer-Agent-0.3.4-linux-x64-UNSIGNED.AppImage',
    );

    expect(() => verifyLinuxPackage({ repositoryRoot: fixtureRoot })).toThrow(/UNSIGNED AppImage/);

    writeFileSync(path.join(outputDirectory, 'notes-UNSIGNED.txt'), 'not-an-image');
    expect(() => verifyLinuxPackage({ repositoryRoot: fixtureRoot })).toThrow(/UNSIGNED AppImage/);
    rmSync(path.join(outputDirectory, 'notes-UNSIGNED.txt'));

    writeFileSync(artifact, '');
    expect(() => verifyLinuxPackage({ repositoryRoot: fixtureRoot })).toThrow(/missing or empty/i);
    writeFileSync(artifact, 'appimage');

    writeFileSync(path.join(outputDirectory, 'latest-linux.yml'), 'update');
    expect(() => verifyLinuxPackage({ repositoryRoot: fixtureRoot })).toThrow(/update metadata/i);
    rmSync(path.join(outputDirectory, 'latest-linux.yml'));

    writeFileSync(path.join(outputDirectory, 'foo.blockmap'), 'block');
    expect(() => verifyLinuxPackage({ repositoryRoot: fixtureRoot })).toThrow(/update metadata/i);
    rmSync(path.join(outputDirectory, 'foo.blockmap'));

    expect(() => verifyLinuxPackage({ repositoryRoot: fixtureRoot })).not.toThrow();
  });

  it('cleans only release/local-unsigned/linux and keeps sibling artifacts', async () => {
    const { resetLinuxPackageOutput } = await import(
      pathToFileURL(path.join(root, 'scripts/package-linux.mjs')).href
    ) as { resetLinuxPackageOutput: (projectRoot: string) => string };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'linux-package-root-'));
    directories.push(fixtureRoot);
    const linuxOutput = path.join(fixtureRoot, 'release', 'local-unsigned', 'linux');
    const siblingOutput = path.join(fixtureRoot, 'release', 'local-unsigned', 'windows');
    mkdirSync(linuxOutput, { recursive: true });
    mkdirSync(siblingOutput, { recursive: true });
    writeFileSync(path.join(linuxOutput, 'stale.AppImage'), 'stale');
    writeFileSync(path.join(siblingOutput, 'preserve.txt'), 'preserve');
    expect(resetLinuxPackageOutput(fixtureRoot)).toBe(linuxOutput);
    expect(existsSync(linuxOutput)).toBe(false);
    expect(readFileSync(path.join(siblingOutput, 'preserve.txt'), 'utf8')).toBe('preserve');
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
    const { packageLinux } = await import(
      pathToFileURL(path.join(root, 'scripts/package-linux.mjs')).href
    );
    const failure = new Error(`command ${failAtCommand} failed`);
    const cleanup = vi.fn();
    const resetOutput = vi.fn(() => '/tmp/linux-output');
    const runCommand = vi.fn(() => {
      if (runCommand.mock.calls.length === failAtCommand) {
        throw failure;
      }
    });
    expect(() => packageLinux('local', {
      platform: 'linux',
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
  });

  it('cleans the temporary CA state when output reset fails before electron-builder', async () => {
    const { packageLinux } = await import(
      pathToFileURL(path.join(root, 'scripts/package-linux.mjs')).href
    );
    const failure = new Error('output reset failed');
    const cleanup = vi.fn();
    const runCommand = vi.fn();
    expect(() => packageLinux('local', {
      platform: 'linux',
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
    const { packageLinux } = await import(
      pathToFileURL(path.join(root, 'scripts/package-linux.mjs')).href
    );
    const cleanup = vi.fn();
    const resetOutput = vi.fn();
    const runCommand = vi.fn();
    expect(() => packageLinux('local', {
      platform: 'linux',
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
});
