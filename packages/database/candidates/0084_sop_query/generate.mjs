import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyContractSetDirectory } from '../../../../scripts/customer-agent-contract-set.mjs';
import { renderUpgradeMigration } from '../../scripts/migration-artifact.mjs';
const root = new URL('../../../../', import.meta.url);
const dir = new URL('.', import.meta.url);
const contractId = 'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b';
const verified = verifyContractSetDirectory(fileURLToPath(new URL(`contracts/upstream/customer-agent/${contractId}/`, root)));
const manifest = JSON.parse(readFileSync(new URL('../../migrations/manifest.generated.json', dir)));
const predecessor = manifest.migrations.slice(0, 83);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (![83, 84].includes(manifest.migrations.length)
  || sha256(JSON.stringify(predecessor)) !== '21bbce897e23f9f3e5fcdc8a0d52d1dadd42af7f22433b425f1c7c7eed676fae'
  || (manifest.migrations.length === 84 && manifest.migrations[83].id !== '0084_sop_unified_storage')) {
  throw new Error('Candidate requires immutable 0083 predecessor');
}
for (const migration of predecessor) {
  const bytes = readFileSync(new URL(`../../migrations/${migration.file}`, dir));
  if (sha256(bytes) !== migration.sha256 || bytes.length !== migration.bytes) {
    throw new Error(`Candidate predecessor bytes drift: ${migration.file}`);
  }
}
const source = readFileSync(new URL(`contracts/upstream/customer-agent/${contractId}/storage.v1.sql`, root), 'utf8');
// Pinned Unicode 16.0 default casefold mappings, generated from Python unicodedata 16.0.0.
// NFKC remains PostgreSQL's normalization; folding must not depend on the cluster locale.
const folds = JSON.parse(readFileSync(new URL('casefold-unicode16.json', dir), 'utf8'));
const normalizeSql = `CREATE FUNCTION content_intake.sop_query_normalize(input text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $fn$
SELECT btrim(COALESCE(string_agg(COALESCE($fold$${JSON.stringify(folds)}$fold$::jsonb->>letter,letter),'' ORDER BY ordinal),''))
FROM regexp_split_to_table(normalize(input,NFKC),'') WITH ORDINALITY AS part(letter,ordinal)
$fn$;
ALTER FUNCTION content_intake.sop_query_normalize(text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_normalize(text) FROM PUBLIC;`;
const artifact = renderUpgradeMigration({ position: 84, id: '0084_sop_query_candidate', version: 'test-only graph/read candidate', ranges: [],
  sourceBody: source.replace(/^BEGIN;\s*$/m, '') + '\n' + normalizeSql + '\n' + readFileSync(new URL('read.sql', dir), 'utf8').trimEnd() },
{ contract_set_id: contractId, source_git_sha: verified.manifest.source_git_sha, manifest: verified.manifest });
const outputs = {
  'candidate.generated.sql': artifact.sql,
  'manifest.generated.json': JSON.stringify({ status: 'TEST_ONLY_CANDIDATE', runtimeActivated: false,
    predecessor: predecessor.at(-1), contractSetId: contractId, sha256: artifact.sha256, bytes: artifact.bytes }, null, 2) + '\n',
};
for (const [name, bytes] of Object.entries(outputs)) {
  const file = new URL(name, dir);
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== bytes) throw new Error(`Stale candidate ${name}`);
  } else writeFileSync(file, bytes);
}
import { createHash } from 'node:crypto';
