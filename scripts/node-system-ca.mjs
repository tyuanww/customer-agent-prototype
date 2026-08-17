import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function exportSystemRootCertificates(certificatePath) {
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
}

export function prepareNodeSystemCaEnvironment(
  baseEnvironment = process.env,
  dependencies = {},
) {
  const environment = { ...baseEnvironment };
  const platform = dependencies.platform ?? process.platform;
  const createTemporaryDirectory = dependencies.createTemporaryDirectory
    ?? (() => mkdtempSync(path.join(os.tmpdir(), 'customer-agent-system-ca-')));
  const exportCertificates = dependencies.exportCertificates
    ?? exportSystemRootCertificates;
  const removeTemporaryDirectory = dependencies.removeTemporaryDirectory
    ?? ((directory) => rmSync(directory, { recursive: true, force: true }));
  let temporaryDirectory = null;

  if (platform === 'darwin' && !environment.NODE_EXTRA_CA_CERTS) {
    temporaryDirectory = createTemporaryDirectory();
    const certificatePath = path.join(temporaryDirectory, 'system-roots.pem');
    try {
      exportCertificates(certificatePath);
    } catch (error) {
      removeTemporaryDirectory(temporaryDirectory);
      temporaryDirectory = null;
      throw error;
    }
    environment.NODE_EXTRA_CA_CERTS = certificatePath;
  }

  return {
    environment,
    cleanup() {
      if (temporaryDirectory) {
        removeTemporaryDirectory(temporaryDirectory);
        temporaryDirectory = null;
      }
    },
  };
}
