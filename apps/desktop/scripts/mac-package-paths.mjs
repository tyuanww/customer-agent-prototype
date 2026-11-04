import path from 'node:path';

export const MAC_LOCAL_UNSIGNED_OUTPUT = 'release/local-unsigned/mac';
export const MAC_DISTRIBUTION_OUTPUT = 'release/distribution';

export function macPackageOutputDirectory(projectRoot, mode) {
  if (mode !== 'local' && mode !== 'distribution') {
    throw new Error(`Unknown macOS package mode: ${String(mode)}`);
  }
  return path.resolve(
    projectRoot,
    mode === 'local' ? MAC_LOCAL_UNSIGNED_OUTPUT : MAC_DISTRIBUTION_OUTPUT,
  );
}
