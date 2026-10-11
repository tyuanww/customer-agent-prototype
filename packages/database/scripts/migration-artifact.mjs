import { createHash } from 'node:crypto';
export const GENERATED_HEADER = 'GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.';
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function renderUpgradeMigration(descriptor, snapshot) {
  const { position, id, version, ranges, sourceBody } = descriptor;
  const sql = [
    `-- ${GENERATED_HEADER}`,
    `-- ${id}; source ${version}${ranges.length ? ` lines ${ranges.map((r) => `${r.start_line}-${r.end_line}`).join(', ')}` : ''}`,
    `-- contract_set_id=${snapshot.contract_set_id}`,
    `-- source_git_sha=${snapshot.source_git_sha}`,
    `-- source_schema_sha256=${snapshot.manifest.database.sha256}`,
    'SET LOCAL search_path = public, pg_catalog, pg_temp;', '', sourceBody, '',
  ].join('\n');
  return Object.freeze({ position, id, file: `${id}.sql`, source_ranges: ranges,
    sha256: sha256(sql), bytes: Buffer.byteLength(sql),
    contract_set_id: snapshot.contract_set_id, source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256, sql });
}

/** One byte recipe is shared by generation and intake verification. */
export function renderRepairMigration(snapshot) {
  const source = snapshot.repair_sources?.upgrade;
  if (typeof source !== 'string' || sha256(source) !== snapshot.manifest.repair.upgrade.sha256) {
    throw new Error('Repair upgrade bytes differ from approved descriptor');
  }
  return renderUpgradeMigration({ position: 40, id: '0040_intake_repair_successor_v1_28',
    version: 'Approved schema.v1.28 repair successor', ranges: [], sourceBody: source.trimEnd() }, snapshot);
}
