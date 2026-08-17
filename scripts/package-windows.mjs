import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareNodeSystemCaEnvironment } from './node-system-ca.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const systemCa = prepareSystemCa();
  const buildEnvironment = systemCa.environment;
  buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

  try {
    runCommand(process.execPath, ['scripts/generate-app-icons.mjs'], {
      cwd: root,
      env: buildEnvironment,
      stdio: 'inherit',
    });

    runCommand(
      process.execPath,
      ['node_modules/electron-vite/bin/electron-vite.js', 'build'],
      {
        cwd: root,
        env: buildEnvironment,
        stdio: 'inherit',
      },
    );

    resetOutput(root);

    runCommand(
      process.execPath,
      [
        'node_modules/electron-builder/out/cli/cli.js',
        '--win',
        '--publish',
        'never',
        `-c.directories.output=${WINDOWS_LOCAL_UNSIGNED_OUTPUT}`,
        '-c.win.signExecutable=false',
        '-c.win.artifactName=${productName}-${version}-win-${arch}-UNSIGNED.${ext}',
      ],
      {
        cwd: root,
        env: buildEnvironment,
        stdio: 'inherit',
      },
    );

    runCommand(process.execPath, ['scripts/verify-windows-package.mjs'], {
      cwd: root,
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
