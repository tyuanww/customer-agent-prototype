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
export const WINDOWS_LOCAL_UNSIGNED_OUTPUT = 'release/local-unsigned/windows';

export function resetWindowsPackageOutput(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const releaseDirectory = path.join(resolvedRoot, 'release');
  const localUnsignedDirectory = path.join(releaseDirectory, 'local-unsigned');
  const expectedOutputDirectory = path.join(localUnsignedDirectory, 'windows');
  const resolvedOutputDirectory = path.resolve(
    resolvedRoot,
    WINDOWS_LOCAL_UNSIGNED_OUTPUT,
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
      `Refusing to clean unexpected Windows package output: ${resolvedOutputDirectory}`,
    );
  }
  rmSync(resolvedOutputDirectory, { recursive: true, force: true });
  return resolvedOutputDirectory;
}

export function packageWindows(
  mode = process.argv[2] ?? 'local',
  dependencies = {},
) {
  if (mode !== 'local') {
    throw new Error(
      'Windows packaging in this Demo is local-unsigned only. There is no signed distribution path.',
    );
  }

  const prepareSystemCa = dependencies.prepareSystemCa
    ?? prepareNodeSystemCaEnvironment;
  const runCommand = dependencies.runCommand ?? execFileSync;
  const resetOutput = dependencies.resetOutput ?? resetWindowsPackageOutput;
  const assertMainBundle = dependencies.assertMainBundle
    ?? assertMainBundleHasNoWorkspaceBareImports;
  const systemCa = prepareSystemCa();
  const buildEnvironment = systemCa.environment;
  buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

  try {
    // Electron 43 installs lazily; packaging owns its license inputs and must
    // work before any smoke test or application launch has prepared the dist.
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

    // Clean Windows checkouts have no packages/contracts/dist; Vite cannot
    // bundle the workspace export until the runtime build exists.
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
      path.join(repositoryRoot, WINDOWS_LOCAL_UNSIGNED_OUTPUT),
    );

    runCommand(
      process.execPath,
      [
        'node_modules/electron-builder/out/cli/cli.js',
        '--win',
        '--publish',
        'never',
        `-c.directories.output=${builderOutput}`,
        '-c.win.signExecutable=false',
        '-c.win.artifactName=${productName}-${version}-win-${arch}-UNSIGNED.${ext}',
      ],
      {
        cwd: desktopRoot,
        env: buildEnvironment,
        stdio: 'inherit',
      },
    );

    runCommand(process.execPath, ['scripts/verify-windows-package.mjs'], {
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
  packageWindows();
}
