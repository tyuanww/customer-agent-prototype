import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const PACKAGED_OFFLINE_PROFILE_NAME = 'synthetic-offline.json';

export function assertPackagedOfflineProfile(resourcesDirectory) {
  const filename = path.join(resourcesDirectory, PACKAGED_OFFLINE_PROFILE_NAME);
  if (!existsSync(filename) || !statSync(filename).isFile() || statSync(filename).size === 0) {
    throw new Error(`Missing packaged offline profile: ${PACKAGED_OFFLINE_PROFILE_NAME}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filename, 'utf8'));
  } catch {
    throw new Error(`Packaged offline profile is not JSON: ${PACKAGED_OFFLINE_PROFILE_NAME}`);
  }
  if (
    parsed === null
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1
    || parsed.mode !== 'synthetic-offline'
  ) {
    throw new Error(
      `Packaged offline profile is not an exact synthetic-offline document: ${PACKAGED_OFFLINE_PROFILE_NAME}`,
    );
  }
}
