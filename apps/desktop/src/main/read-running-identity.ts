import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatRunningIdentity, runningPointFromProfile } from '../shared/running-identity';

type Stamp = { productVersion: string; gitSha: string };

function readStamp(): Stamp {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(process.resourcesPath, 'build-identity.json'), 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && 'productVersion' in parsed && 'gitSha' in parsed) {
      const version = parsed.productVersion;
      const sha = parsed.gitSha;
      if (typeof version === 'string' && typeof sha === 'string' && version.length > 0 && sha.length > 0) {
        return { productVersion: version, gitSha: sha };
      }
    }
  } catch {
    // Unpackaged development has no baked stamp.
  }
  return { productVersion: app.getVersion(), gitSha: 'dev' };
}

function readPoint(): ReturnType<typeof runningPointFromProfile> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'synthetic-stack.json'), 'utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      const mode = 'mode' in parsed && typeof parsed.mode === 'string' ? parsed.mode : undefined;
      const apiOrigin = 'apiOrigin' in parsed && typeof parsed.apiOrigin === 'string' ? parsed.apiOrigin : undefined;
      return runningPointFromProfile(mode, apiOrigin);
    }
  } catch {
    // A missing profile is already a packaged startup error elsewhere.
  }
  return 'unknown';
}

export function readRunningLine(): string {
  const stamp = readStamp();
  return formatRunningIdentity({ ...stamp, point: readPoint() });
}
