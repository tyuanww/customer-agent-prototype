import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function verifyPackagedMacBrandIcon({
  iconFile,
  resourcesDirectory,
  expectedBrandIcon,
}) {
  const normalizedIconFile = iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`;
  if (normalizedIconFile !== 'icon.icns') {
    throw new Error(`CFBundleIconFile must reference the generated brand icon, received: ${iconFile}`);
  }

  const resourcesIcon = path.join(resourcesDirectory, normalizedIconFile);
  if (!existsSync(resourcesIcon) || statSync(resourcesIcon).size === 0) {
    throw new Error('Packaged macOS resources must include icon.icns');
  }
  if (!existsSync(expectedBrandIcon) || statSync(expectedBrandIcon).size === 0) {
    throw new Error('Generated build/icon.icns is required for package verification');
  }
  if (sha256(resourcesIcon) !== sha256(expectedBrandIcon)) {
    throw new Error('Packaged icon.icns does not match the generated brand icon');
  }

  return resourcesIcon;
}
