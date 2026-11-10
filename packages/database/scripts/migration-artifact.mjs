import { createHash } from 'node:crypto';
export const GENERATED_HEADER = 'GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.';
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const SOP_LIFECYCLE_SOURCE = Object.freeze({ position: 85, id: '0085_sop_unified_lifecycle',
  file: 'packages/database/overlays/0085_sop_unified_lifecycle.sql',
  sha256: 'e76859e42aea66744005295b4baaf7e4872914e6b1ba2f162d46d2b0c1b16924' });

export const SOP_QUERY_SOURCE = Object.freeze({ position: 86, id: '0086_sop_unified_query',
  file: 'packages/database/overlays/0086_sop_unified_query.sql', sha256: '33e3c0aa4b3983062455ccf56283abdc44dd18e01384752a80fa9d5fbdc5cd2b' });

export const SOP_CONTINUATION_SOURCE = Object.freeze({ position: 87, id: '0087_sop_unified_continuation',
  file: 'packages/database/overlays/0087_sop_unified_continuation.sql', sha256: 'aa8808e02893abe258d6f8f834b792444a321938fff5c8659f873b5ab338afc8' });

export const SOP_RESOURCE_SOURCE = Object.freeze({ position: 88, id: '0088_sop_resource_lifecycle',
  file: 'packages/database/overlays/0088_sop_resource_lifecycle.sql', sha256: '88331d988759867a2e414f477922d171edcc1b837f2166a0cd8466aaee2c0ac6' });

export function renderSopResourceMigration({ manifest, storage_source }, source) {
  if (manifest.contract_set_id !== 'cs-ai-c11-openapi-1.30.0-schema-1.34-0405c5651564'
    || manifest.source_git_sha !== '0405c5651564958702ddd5484bbf41a0f193515f'
    || sha256(source) !== SOP_RESOURCE_SOURCE.sha256
    || sha256(storage_source) !== manifest.resourceDisable.storage.sha256
    || !source.includes(storage_source.trimEnd())) throw new Error('SOP resource lifecycle implementation source drifted');
  return renderUpgradeMigration({ position: SOP_RESOURCE_SOURCE.position, id: SOP_RESOURCE_SOURCE.id,
    version: `verified SOP resource lifecycle implementation; overlay_sha256=${SOP_RESOURCE_SOURCE.sha256}`,
    ranges: [], sourceBody: source.trimEnd() }, { contract_set_id: manifest.contract_set_id,
    source_git_sha: manifest.source_git_sha, manifest });
}

export function renderSopContinuationMigration({ manifest }, source) {
  if (manifest.contract_set_id !== 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f'
    || manifest.source_git_sha !== '812a2e80584f08675fab8b7401ce8b4cd3ab5bca'
    || sha256(source) !== SOP_CONTINUATION_SOURCE.sha256) throw new Error('SOP continuation implementation source drifted');
  return renderUpgradeMigration({ position: SOP_CONTINUATION_SOURCE.position, id: SOP_CONTINUATION_SOURCE.id,
    version: `verified SOP continuation implementation; overlay_sha256=${SOP_CONTINUATION_SOURCE.sha256}`,
    ranges: [], sourceBody: source.trimEnd() }, { contract_set_id: manifest.contract_set_id,
    source_git_sha: manifest.source_git_sha, manifest });
}

export function renderSopQueryMigration({ manifest }, source) {
  if (manifest.contract_set_id !== 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f'
    || manifest.source_git_sha !== '812a2e80584f08675fab8b7401ce8b4cd3ab5bca'
    || sha256(source) !== SOP_QUERY_SOURCE.sha256) throw new Error('SOP query implementation source drifted');
  return renderUpgradeMigration({ position: SOP_QUERY_SOURCE.position, id: SOP_QUERY_SOURCE.id,
    version: `verified SOP query implementation; overlay_sha256=${SOP_QUERY_SOURCE.sha256}`,
    ranges: [], sourceBody: source.trimEnd() }, { contract_set_id: manifest.contract_set_id,
    source_git_sha: manifest.source_git_sha, manifest });
}

export function renderSopLifecycleMigration({ manifest }, source) {
  if (manifest.contract_set_id !== 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f'
    || manifest.source_git_sha !== '812a2e80584f08675fab8b7401ce8b4cd3ab5bca'
    || sha256(source) !== SOP_LIFECYCLE_SOURCE.sha256) throw new Error('SOP lifecycle implementation source drifted');
  return renderUpgradeMigration({ position: SOP_LIFECYCLE_SOURCE.position, id: SOP_LIFECYCLE_SOURCE.id,
    version: `verified SOP lifecycle implementation; overlay_sha256=${SOP_LIFECYCLE_SOURCE.sha256}`,
    ranges: [], sourceBody: source.trimEnd() }, { contract_set_id: manifest.contract_set_id,
    source_git_sha: manifest.source_git_sha, manifest });
}

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

/** The approved compact successor retains its own exact upgrade provenance. */
export function renderReadinessMigration(snapshot) {
  const source = snapshot.readiness_sources?.upgrade;
  if (typeof source !== 'string' || sha256(source) !== snapshot.manifest.readiness.upgrade.sha256) {
    throw new Error('Readiness upgrade bytes differ from approved descriptor');
  }
  return renderUpgradeMigration({ position: 41, id: '0041_intake_readiness_v1_29',
    version: 'Approved schema.v1.29 readiness successor', ranges: [], sourceBody: source.trimEnd() }, snapshot);
}

/** The formal storage delta shares one byte recipe with intake verification. */
export function renderSopUnifiedMigration({ manifest, storage_source: source }) {
  if (manifest.schema !== 'customer-agent-contract-set/v11'
    || manifest.openapi.version !== '1.29.1' || manifest.database.version !== 'schema.v1.33'
    || typeof source !== 'string' || sha256(source) !== manifest.sopUnified.storage.sha256
    || /^\s*(BEGIN|COMMIT|ROLLBACK);/m.test(source)) {
    throw new Error('Unified SOP storage bytes or transaction boundary drifted');
  }
  return renderUpgradeMigration({
    position: 84, id: '0084_sop_unified_storage',
    version: `schema.v1.33 unified SOP storage; storage_sha256=${manifest.sopUnified.storage.sha256}`,
    ranges: [], sourceBody: source.trimEnd(),
  }, { contract_set_id: manifest.contract_set_id, source_git_sha: manifest.source_git_sha, manifest });
}
