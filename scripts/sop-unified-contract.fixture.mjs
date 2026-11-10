import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOP_UNIFIED_INPUT, SOP_UNIFIED_LOCK, SOP_UNIFIED_SOURCE, SOP_UNIFIED_SOURCE_FILES, SOP_UNIFIED_MEMBERS } from './sop-unified-contract.mjs';
import { fixtureInputs } from './sop-unified-inputs.fixture.mjs';
import { SOP_CORRECTED_LOCK } from './sop-unified-corrected-contract.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const upstream = 'contracts/upstream/customer-agent';
export const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
export const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function candidate(model, inputs) {
  const query = JSON.parse(inputs.get(`${SOP_UNIFIED_INPUT}/query.source.json`));
  const api = JSON.parse(model['openapi.v1.yaml']);
  const rename = value => {
    let text = JSON.stringify(value);
    for (const group of ['schemas', 'responses']) {
      for (const name of Object.keys(query.components[group])) {
        text = text.replaceAll(`#/components/${group}/${name}`, `#/components/${group}/MenokinSopQuery${name}`);
      }
    }
    return JSON.parse(text);
  };
  for (const group of ['schemas', 'responses']) {
    for (const [name, value] of Object.entries(query.components[group])) api.components[group][`MenokinSopQuery${name}`] = rename(value);
  }
  for (const [name, value] of Object.entries(query.components.securitySchemes)) {
    if (!api.components.securitySchemes[name]) api.components.securitySchemes[name] = value;
  }
  api.paths['/v1/sop/query'] = rename(query.paths['/v1/sop/query']);
  api.info.description += '\nIndependent Menokin SOP positive query transport is included in this contract set; /v1/search remains SOP fail-closed.';
  api.info['x-business-contract-set-id'] = 'menokin-sop-query-v1';
  api.info.version = '1.29.0';
  api.info.description += '\nUnified task graph implementation contract with full original-query compatibility. Runtime activation and business mapping remain separately evidenced.';
  api['x-sop-query-views'] = JSON.parse(fixtureInputs['output/compatibility.v1.json']).query;
  api['x-contract-set-negotiation'].status = 'IMPLEMENTATION_APPROVED_CANDIDATE';
  api['x-sop-graph-contract'].publication.originalPublicationRequired = true;
  const lease = fixtureInputs.leaseStorage.replace(/^BEGIN;[ \t]*\r?\n/m, '').replace(/\s*COMMIT;\s*$/, '').replaceAll("'15 minutes'", "'5 minutes'");
  const patch = inputs.get(`${SOP_UNIFIED_INPUT}/storage.patch.sql`);
  return new Map([
    ['openapi.v1.yaml', json(api)],
    ['schema-v1.33.sql', Buffer.concat([Buffer.from('-- schema.v1.33 unified SOP reference. Cumulative, not a runnable product migration.\n'), model['schema-v1.32.sql'], Buffer.from(lease), patch])],
    ['storage.v1.sql', Buffer.concat([model['storage.v4.sql'], Buffer.from(lease), patch])],
    ...['installation.v1.json', 'compatibility.v1.json', 'operation-coverage.v1.json'].map(name => [name, Buffer.from(fixtureInputs[`output/${name}`])]),
    ['predecessor-lock.v1.json', inputs.get(`${SOP_UNIFIED_INPUT}/source.json`)],
    ['legacy-openapi.v7.yaml', model['legacy-openapi.v7.yaml']], ['legacy-query.openapi.v1.json', Buffer.from(fixtureInputs.fragment)],
    ['query-transport.v1.json', inputs.get(`${SOP_UNIFIED_INPUT}/query.source.json`)],
    ['authorization.v1.json', inputs.get(`${SOP_UNIFIED_INPUT}/authorization.source.json`)],
  ]);
}

export function fixture(t, mutate = () => {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sop-unified-intake-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const bundle = path.join(root, 'bundle');
  const product = path.join(root, 'product');
  for (const directory of [source, bundle, product]) mkdirSync(directory);
  git(source, ['init', '--quiet']);
  git(source, ['config', 'user.name', 'Synthetic unified source']);
  git(source, ['config', 'user.email', 'unified@example.invalid']);
  const data = JSON.parse(fixtureInputs['input/source.json']);
  const old = Object.fromEntries(Object.keys(data.legacyQuery.members).map(file => [file,
    readFileSync(path.join(repositoryRoot, upstream, 'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b', file))]));
  const model = Object.fromEntries(Object.keys(data.model.members).filter(name => !['schema-v1.32.sql', 'legacy-openapi.v7.yaml'].includes(name))
    .map(name => [name, Buffer.from(fixtureInputs[`model/${name}`])]));
  model['legacy-openapi.v7.yaml'] = readFileSync(path.join(repositoryRoot, upstream, 'cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed', 'openapi.v1.yaml'));
  model['schema-v1.32.sql'] = Buffer.concat([Buffer.from(fixtureInputs.schemaPrefix),
    readFileSync(path.join(repositoryRoot, upstream, 'cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed', 'schema-v1.28.sql')), Buffer.from(fixtureInputs.schemaSuffix)]);
  for (const group of ['model', 'legacyQuery']) {
    const bytes = group === 'model' ? model : old;
    for (const [name, digest] of Object.entries(data[group].members)) assert.equal(hash(bytes[name]), digest, `fixture ${group}/${name}`);
  }
  const inputs = new Map(SOP_UNIFIED_SOURCE_FILES.map(relative => [relative, relative.endsWith('.mjs')
    ? Buffer.from("throw new Error('Synthetic producer must never execute');\n")
    : Buffer.from(fixtureInputs[`input/${path.basename(relative)}`])]));
  const files = candidate(model, inputs);
  const predecessorInputs = new Map([
    ...Object.entries(model).map(([name, bytes]) => [`${data.model.directory}/${name}`, bytes]),
    ...Object.entries(old).map(([name, bytes]) => [`${data.legacyQuery.directory}/${name}`, bytes]),
    [data.legacyQuery.fragment, Buffer.from(fixtureInputs.fragment)],
    [data.legacyQuery.leaseStorage, Buffer.from(fixtureInputs.leaseStorage)],
  ]);
  mutate({ files, inputs, model, old, predecessorInputs });
  // Reflect mutations to predecessor maps as well as the raw fragment inputs.
  for (const [group, values] of [['model', model], ['legacyQuery', old]]) {
    for (const [name, bytes] of Object.entries(values)) predecessorInputs.set(`${data[group].directory}/${name}`, bytes);
  }
  const provenance = {
    schema: 'customer-agent-sop-unified-candidate/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE',
    versions: data.versions, formalVersionAssigned: true, sourceGitSha: null,
    authorizationEvidenceId: JSON.parse(files.get('authorization.v1.json')).evidenceId,
    sources: Object.fromEntries([...inputs].map(([file, bytes]) => [file, hash(bytes)])),
    artifacts: Object.fromEntries([...files].map(([file, bytes]) => [file, { sha256: hash(bytes), bytes: bytes.length }])),
    runtimeActivated: false, businessMappingApproved: false,
  };
  files.set('provenance.v1.json', json(provenance));
  for (const [file, bytes] of [...inputs, ...predecessorInputs]) {
    const target = path.join(source, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  for (const [file, bytes] of files) {
    mkdirSync(path.join(source, SOP_UNIFIED_SOURCE), { recursive: true });
    writeFileSync(path.join(source, SOP_UNIFIED_SOURCE, file), bytes);
    writeFileSync(path.join(bundle, file), bytes);
  }
  git(source, ['add', '.']);
  git(source, ['commit', '--quiet', '-m', 'Synthetic unified source']);
  const sha = git(source, ['rev-parse', 'HEAD']);
  const descriptor = (file, version) => ({ version, source_path: `${SOP_UNIFIED_SOURCE}/${file}`, file, sha256: hash(files.get(file)), bytes: files.get(file).length });
  const { openapi, database, ...sopUnified } = Object.fromEntries(Object.entries(SOP_UNIFIED_MEMBERS).map(([key, [file, version]]) => [key, descriptor(file, version)]));
  const manifest = {
    schema: 'customer-agent-contract-set/v10', contract_set_id: `cs-ai-c11-openapi-1.29.0-schema-1.33-${sha.slice(0, 12)}`,
    source_repository: 'ai-赋能立项', source_git_sha: sha, architecture_version: '1.16', implementation_version: '1.22',
    openapi, database, sopUnified,
  };
  writeFileSync(path.join(bundle, 'contract-set.json'), json(manifest));
  writeFileSync(path.join(product, 'package.json'), json({ name: 'customer-agent-demo' }));
  mkdirSync(path.join(product, 'contracts/upstream'), { recursive: true });
  cpSync(path.join(repositoryRoot, upstream), path.join(product, upstream), {
    recursive: true,
    filter: file => {
      const name = path.basename(file);
      // Each fixture starts before unified intake, including after the real bundle is installed.
      return name !== SOP_UNIFIED_LOCK && name !== SOP_CORRECTED_LOCK
        && !name.startsWith('cs-ai-c11-openapi-1.29.0-schema-1.33-')
        && !name.startsWith('cs-ai-c11-openapi-1.29.1-schema-1.33-')
        && name !== '.contract-intake.lock' && !name.startsWith('.contract-intake-') && !name.startsWith('.lock-write-');
    },
  });
  mkdirSync(path.join(product, 'packages/database'), { recursive: true });
  cpSync(path.join(repositoryRoot, 'packages/database/migrations'), path.join(product, 'packages/database/migrations'), { recursive: true });
  return { root, source, bundle, product, manifest, files, inputs };
}
