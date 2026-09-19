import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareNodeSystemCaEnvironment } from './node-system-ca.mjs';
import { assertMainBundleHasNoWorkspaceBareImports } from './assert-main-bundle.mjs';

const require = createRequire(import.meta.url);
const typescriptCompiler = require.resolve('typescript/bin/tsc');

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
export const LINUX_LOCAL_UNSIGNED_OUTPUT = 'release/local-unsigned/linux';

export function resetLinuxPackageOutput(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const releaseDirectory = path.join(resolvedRoot, 'release');
  const localUnsignedDirectory = path.join(releaseDirectory, 'local-unsigned');
  const expectedOutputDirectory = path.join(localUnsignedDirectory, 'linux');
  const resolvedOutputDirectory = path.resolve(
    resolvedRoot,
    LINUX_LOCAL_UNSIGNED_OUTPUT,
  );
  const forbiddenCleanupTargets = new Set([
    resolvedRoot,
    releaseDirectory,
    localUnsignedDirectory,
  ]);
  if (
    resolvedOutputDirectory !== expectedOutputDirectory
    || forbiddenCleanupTargets.has(resolvedOutputDirectory)
  ) {
    throw new Error(
      `Refusing to clean unexpected Linux package output: ${resolvedOutputDirectory}`,
    );
  }
  rmSync(resolvedOutputDirectory, { recursive: true, force: true });
  return resolvedOutputDirectory;
}

export function packageLinux(
  mode = process.argv[2] ?? 'local',
  dependencies = {},
) {
  if (mode !== 'local') {
    throw new Error(
      'Linux packaging in this Demo is local-unsigned only. There is no signed distribution path.',
    );
  }
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'linux') {
    throw new Error('Linux packages must be built on Linux.');
  }

  const prepareSystemCa = dependencies.prepareSystemCa
    ?? prepareNodeSystemCaEnvironment;
  const runCommand = dependencies.runCommand ?? execFileSync;
  const resetOutput = dependencies.resetOutput ?? resetLinuxPackageOutput;
  const assertMainBundle = dependencies.assertMainBundle
    ?? assertMainBundleHasNoWorkspaceBareImports;
  const systemCa = prepareSystemCa();
  const buildEnvironment = systemCa.environment;
  buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

  try {
    runCommand(process.execPath, ['node_modules/electron/install.js'], {
      cwd: desktopRoot,
      env: buildEnvironment,
      stdio: 'inherit',
    });
    runCommand(process.execPath, ['scripts/generate-app-icons.mjs'], {
      cwd: desktopRoot,
      env: buildEnvironment,
      stdio: 'inherit',
    });
    runCommand(
      process.execPath,
      [typescriptCompiler, '-p', 'tsconfig.build.json'],
      {
        cwd: path.join(repositoryRoot, 'packages/contracts'),
        env: buildEnvironment,
        stdio: 'inherit',
      },
    );
    runCommand(
      process.execPath,
      ['node_modules/electron-vite/bin/electron-vite.js', 'build'],
      {
        cwd: desktopRoot,
        env: buildEnvironment,
        stdio: 'inherit',
      },
    );
    assertMainBundle(desktopRoot);
    resetOutput(repositoryRoot);

    const builderOutput = path.relative(
      desktopRoot,
      path.join(repositoryRoot, LINUX_LOCAL_UNSIGNED_OUTPUT),
    );
    runCommand(
      process.execPath,
      [
        'node_modules/electron-builder/out/cli/cli.js',
        '--linux',
        '--publish',
        'never',
        `-c.directories.output=${builderOutput}`,
        '-c.linux.artifactName=${productName}-${version}-linux-${arch}-UNSIGNED.${ext}',
      ],
      {
        cwd: desktopRoot,
        env: buildEnvironment,
        stdio: 'inherit',
      },
    );
    runCommand(process.execPath, ['scripts/verify-linux-package.mjs'], {
      cwd: desktopRoot,
      env: buildEnvironment,
      stdio: 'inherit',
    });
  } finally {
    systemCa.cleanup();
  }
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  packageLinux();
}
