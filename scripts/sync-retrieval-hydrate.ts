#!/usr/bin/env node
/**
 * Align the off-repo hydrate snapshot with a current-release snapshot dump.
 *
 * Auto-sync also runs on 合成登录 (announce snapshot paging). This command
 * writes only when --from is given. It does not start the synthetic stack.
 *
 *   pnpm retrieval:hydrate -- --dry-run
 *   pnpm retrieval:hydrate -- --from snapshot.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HYDRATE_PATH,
  loadHydrateCatalog,
  syncHydrateCatalog,
  type HydrateSnapshotItem,
} from '../apps/desktop/src/main/hydrate-catalog.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function asItems(raw: unknown): { releaseId: string; items: HydrateSnapshotItem[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const releaseId = Reflect.get(raw, 'releaseId') ?? Reflect.get(raw, 'release_id');
  const items = Reflect.get(raw, 'items');
  if (typeof releaseId !== 'string' || releaseId.length < 1 || !Array.isArray(items)) return null;
  return { releaseId, items: items as HydrateSnapshotItem[] };
}

const dryRun = process.argv.includes('--dry-run');
const rebuild = process.argv.includes('--rebuild');
const fromPath = argValue('--from');
const outPath = argValue('--out') || process.env.CUSTOMER_AGENT_HYDRATE_INDEX?.trim() || DEFAULT_HYDRATE_PATH;

if (!fromPath) {
  const catalog = existsSync(outPath) ? loadHydrateCatalog(outPath) : null;
  console.log(JSON.stringify({
    path: outPath,
    releaseId: catalog?.releaseId ?? null,
    loaded: catalog !== null,
    wrote: false,
    hint: 'auto-sync runs on 合成登录; pass --from <snapshot.json> to write',
  }));
} else if (!existsSync(fromPath)) {
  console.error('snapshot file is missing');
  process.exitCode = 1;
} else {
  let parsed: { releaseId: string; items: HydrateSnapshotItem[] } | null = null;
  try {
    parsed = asItems(JSON.parse(readFileSync(fromPath, 'utf8')));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    console.error('snapshot file must contain releaseId/release_id and items[]');
    process.exitCode = 1;
  } else {
    const result = syncHydrateCatalog({
      path: outPath,
      repoRoot,
      releaseId: parsed.releaseId,
      items: parsed.items,
      dryRun,
      rebuild,
    });
    console.log(JSON.stringify(result));
  }
}
