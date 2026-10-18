import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatRunningIdentity, type RunningPoint } from '../shared/running-identity';

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
    // No baked stamp. Fall through to the app version.
  }
  try {
    const version = app.getVersion();
    if (typeof version === 'string' && version.length > 0) return { productVersion: version, gitSha: 'dev' };
  } catch {
    // Overlay unit tests stub a partial app that has no getVersion.
  }
  return { productVersion: 'dev', gitSha: 'dev' };
}

export function readRunningLine(point: RunningPoint): string {
  return formatRunningIdentity({ ...readStamp(), point });
}
