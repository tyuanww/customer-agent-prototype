import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'local' && mode !== 'distribution') {
  throw new Error('Usage: node scripts/package-macos.mjs <local|distribution>');
}
if (process.platform !== 'darwin') {
  throw new Error('macOS packages must be built on macOS.');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory =
  mode === 'local' ? 'release/local-unsigned' : 'release/distribution';
let temporaryCaDirectory;

try {
  const buildEnvironment = { ...process.env };
  if (!buildEnvironment.NODE_EXTRA_CA_CERTS) {
    temporaryCaDirectory = mkdtempSync(
      path.join(os.tmpdir(), 'customer-agent-mac-ca-'),
    );
    const certificatePath = path.join(temporaryCaDirectory, 'system-roots.pem');
    execFileSync(
      '/usr/bin/security',
      [
        'export',
        '-t',
        'certs',
        '-k',
        '/System/Library/Keychains/SystemRootCertificates.keychain',
        '-f',
        'pemseq',
        '-o',
        certificatePath,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    buildEnvironment.NODE_EXTRA_CA_CERTS = certificatePath;
  }

  if (mode === 'local') {
    buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }

  execFileSync('pnpm', ['generate:mac-icon'], {
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['build'], {
    cwd: root,
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
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['scripts/finalize-mac-package.mjs', mode], {
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['scripts/verify-mac-package.mjs', mode], {
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  });
} finally {
  if (temporaryCaDirectory) {
    rmSync(temporaryCaDirectory, { recursive: true, force: true });
  }
}
