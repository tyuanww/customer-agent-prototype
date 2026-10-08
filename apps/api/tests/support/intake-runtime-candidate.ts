import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';

/** Explicit test-only snapshot. No runtime checkout reads another repository.
 * The installer owns one atomic install after the pinned product overlays. */
export async function installIntakeRuntimeCandidate(admin: Pick<Client, 'query'>): Promise<void> {
  const directory = new URL('../../experiments/intake-runtime/acceptance-candidate/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')) as {
    status: string; installation: Record<string, string>; overlayInputs: Record<string, string>;
  };
  if (manifest.status !== 'DRAFT_SYNTHETIC_ACCEPTANCE_ONLY') throw new Error('CANDIDATE_NOT_SYNTHETIC');
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  for (const [relative, hash] of Object.entries(manifest.overlayInputs)) {
    if (!/^packages\/database\/migrations\/[A-Za-z0-9_-]+\.sql$/.test(relative)) throw new Error('CANDIDATE_OVERLAY_PATH');
    if (digest(await readFile(new URL(`../../../../${relative}`, import.meta.url), 'utf8')) !== hash) throw new Error('CANDIDATE_OVERLAY_DRIFT');
  }
  const installed = await admin.query<{ migration_id: string; migration_sha256: string }>(
    'SELECT migration_id,migration_sha256 FROM customer_agent_meta.schema_migrations ORDER BY position');
  const expected = Object.entries(manifest.overlayInputs).map(([relative, hash]) => ({
    migration_id: relative.split('/').at(-1)!.replace(/\.sql$/, ''), migration_sha256: hash,
  }));
  if (JSON.stringify(installed.rows) !== JSON.stringify(expected)) throw new Error('CANDIDATE_INSTALLED_OVERLAY_DRIFT');
  const sql: string[] = [];
  for (const [name, hash] of Object.entries(manifest.installation)) {
    if (!/^[a-z.-]+\.sql$/.test(name)) throw new Error('CANDIDATE_SQL_PATH');
    const source = await readFile(new URL(name, directory), 'utf8');
    if (digest(source) !== hash) throw new Error('CANDIDATE_SQL_DRIFT');
    sql.push(source);
  }
  await admin.query('BEGIN');
  try {
    for (const source of sql) await admin.query(source);
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK'); throw error; }
}
