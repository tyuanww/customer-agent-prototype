import { execFileSync } from 'node:child_process';
import { verifyPackagedMacBrandIcon } from './mac-brand-icon-verifier.mjs';

export function verifyMacPackageBrandGate({
  infoPlist,
  resourcesDirectory,
  expectedBrandIcon,
  execFile = execFileSync,
}) {
  const iconFile = String(execFile(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleIconFile', 'raw', infoPlist],
    { encoding: 'utf8' },
  )).trim();

  return verifyPackagedMacBrandIcon({ iconFile, resourcesDirectory, expectedBrandIcon });
}
