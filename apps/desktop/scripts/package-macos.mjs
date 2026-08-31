import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareNodeSystemCaEnvironment } from './node-system-ca.mjs';

const mode = process.argv[2];
if (mode !== 'local' && mode !== 'distribution') {
  throw new Error('Usage: node scripts/package-macos.mjs <local|distribution>');
}
if (process.platform !== 'darwin') {
  throw new Error('macOS packages must be built on macOS.');
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const outputDirectory = path.relative(
  desktopRoot,
  path.join(repositoryRoot, 'release', mode === 'local' ? 'local-unsigned' : 'distribution'),
);
const systemCa = prepareNodeSystemCaEnvironment();

try {
  const buildEnvironment = systemCa.environment;

  if (mode === 'local') {
    buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }

  execFileSync('pnpm', ['generate:app-icons'], {
    cwd: desktopRoot,
    env: buildEnvironment,
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['build'], {
    cwd: desktopRoot,
    env: buildEnvironment,
    stdio: 'inherit',
  });

  const builderArguments = [
    '--mac',
    '--publish',
    'never',
    `-c.directories.output=${outputDirectory}`,
  ];
  if (mode === 'local') {
    builderArguments.push(
      '-c.mac.artifactName=${productName}-${version}-mac-${arch}-UNSIGNED.${ext}',
      '-c.mac.identity=null',
      '-c.mac.notarize=false',
      '-c.mac.forceCodeSigning=false',
    );
  }

  execFileSync('electron-builder', builderArguments, {
    cwd: desktopRoot,
    env: buildEnvironment,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['scripts/finalize-mac-package.mjs', mode], {
    cwd: desktopRoot,
    env: buildEnvironment,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['scripts/verify-mac-package.mjs', mode], {
    cwd: desktopRoot,
    env: buildEnvironment,
    stdio: 'inherit',
  });
} finally {
  systemCa.cleanup();
}
