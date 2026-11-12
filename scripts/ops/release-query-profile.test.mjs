import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  loadApiStackConfig, loadContentStackConfig, loadFeishuStackConfig, parseStackProfile,
  stackApiEnvironment, stackPortPairForRoot, PG_PORT,
} from '../synthetic-stack/profile.ts';
import { readReleaseQueryProfile } from './release-query-profile.mjs';

function fixture(t, { legacyParser = false, legacyStack = false } = {}) {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'query-profile-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, 'release');
  const stackRoot = path.join(root, 'stack');
  const dist = path.join(releaseRoot, 'apps/api/dist');
  mkdirSync(path.join(dist, 'runtime-config'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'scripts/synthetic-stack'), { recursive: true });
  mkdirSync(stackRoot);
  const ports = stackPortPairForRoot(stackRoot);
  const profile = {
    version: 1, createdAt: '2026-11-12T00:00:00Z', stackRoot, databaseName: 'synthetic_query',
    apiOrigin: `http://127.0.0.1:${ports.api}`, identityOrigin: `http://127.0.0.1:${ports.identity}`,
    apiPort: ports.api, identityPort: ports.identity, pgPort: PG_PORT,
    pgSocketDirectory: path.join(stackRoot, 'data/pg15-socket'),
    objectStoreDirectory: path.join(stackRoot, 'objects'), clientId: 'synthetic-client',
  };
  const stackModule = pathToFileURL(fileURLToPath(new URL('../synthetic-stack/profile.ts', import.meta.url))).href;
  const stackExports = legacyStack
    ? '{ parseStackProfile, loadContentStackConfig, loadFeishuStackConfig, loadApiStackConfig }'
    : '*';
  writeFileSync(path.join(releaseRoot, 'scripts/synthetic-stack/profile.ts'),
    `export ${stackExports} from ${JSON.stringify(stackModule)};\n`);
  // These are the built API parsers used by stack startup. No database is opened.
  const apiModule = new URL('../../apps/api/dist/runtime-config.js', import.meta.url).href;
  const databaseModule = new URL('../../apps/api/dist/runtime-config/database.js', import.meta.url).href;
  // Only the legacy-candidate case stubs the parser's missing query capability.
  const legacyExport = legacyParser ? `
    import { parseApiPrivateBootstrapConfig as parseCurrent } from ${JSON.stringify(apiModule)};
    export function parseApiPrivateBootstrapConfig(environment) {
      const { query, ...bootstrap } = parseCurrent(environment);
      return bootstrap;
    }
  ` : '';
  writeFileSync(path.join(dist, 'runtime-config.js'), `export * from ${JSON.stringify(apiModule)};\n${legacyExport}`);
  writeFileSync(path.join(dist, 'runtime-config/database.js'), `export * from ${JSON.stringify(databaseModule)};\n`);
  function writeProfile() { writeFileSync(path.join(stackRoot, 'profile.json'), JSON.stringify(profile)); }
  function writeEnvironment(text) { writeFileSync(path.join(stackRoot, 'api.env'), text); }
  function writeContent(text) { writeFileSync(path.join(stackRoot, 'content.env'), text); }
  function writeFeishu(overrides = {}) {
    const values = {
      AUTH_MODE: 'feishu', FEISHU_APP_ID: 'cli_synthetic0001',
      FEISHU_APP_SECRET: 'synthetic-feishu-secret-material-0001',
      FEISHU_REDIRECT_URI: 'https://synthetic.example/v1/auth/callback',
      FEISHU_BINDINGS: 'ou_syntheticowner:owner', ...overrides,
    };
    writeFileSync(path.join(stackRoot, 'feishu.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'));
  }
  writeProfile();
  writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=intake-compat\n');
  return { releaseRoot, stackRoot, profile, writeProfile, writeEnvironment, writeContent, writeFeishu };
}

test('query profile uses stack-derived pools and returns only non-secret evidence', async t => {
  const value = fixture(t);
  const result = await readReleaseQueryProfile(value.releaseRoot, value.stackRoot);
  assert.equal(result.mode, 'intake-compat');
  assert.match(result.configurationSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(result.intakeLogins, {
    business: 'stack_intake_business', usage: 'stack_intake_usage', worker: 'stack_intake_worker',
  });
  assert.deepEqual(Object.keys(result).sort(), ['configurationSha256', 'intakeLogins', 'mode']);
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=intake-compat\nLOG_HASH_KEY=rotated-private-material-000000000001\n');
  assert.equal((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).configurationSha256, result.configurationSha256);
});

test('mode, database and pool changes invalidate the resolved configuration fingerprint', async t => {
  const value = fixture(t);
  const initial = await readReleaseQueryProfile(value.releaseRoot, value.stackRoot);
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=unified\n');
  assert.notEqual((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).configurationSha256, initial.configurationSha256);
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=intake-compat\nDB_POOL_MAX=11\n');
  assert.notEqual((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).configurationSha256, initial.configurationSha256);
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=intake-compat\n');
  value.profile.databaseName = 'synthetic_changed';
  value.writeProfile();
  assert.notEqual((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).configurationSha256, initial.configurationSha256);
});

test('unsupported modes and old parsers cannot silently approve intake compatibility', async t => {
  const value = fixture(t);
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=automatic\n');
  await assert.rejects(() => readReleaseQueryProfile(value.releaseRoot, value.stackRoot), { code: 'CONFIG_INVALID' });
  const legacy = fixture(t, { legacyParser: true });
  await assert.rejects(() => readReleaseQueryProfile(legacy.releaseRoot, legacy.stackRoot), /QUERY_PROFILE_MODE_INVALID/u);
  legacy.writeEnvironment('');
  assert.equal((await readReleaseQueryProfile(legacy.releaseRoot, legacy.stackRoot)).mode, 'unified');
});

test('preflight rejects a legal api.env content key that startup refuses even without content.env', async t => {
  const value = fixture(t);
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=intake-compat\nCONTENT_INTENT_ID=synthetic_override\n');
  const overrides = loadApiStackConfig(path.join(value.stackRoot, 'api.env'));
  assert.equal(overrides.CONTENT_INTENT_ID, 'synthetic_override');
  const profile = parseStackProfile(value.profile, value.stackRoot);
  assert.throws(
    () => stackApiEnvironment({ profile, content: undefined, feishu: undefined, apiConfig: overrides }),
    /api\.env and content\.env both set CONTENT_INTENT_ID/u,
  );
  await assert.rejects(
    () => readReleaseQueryProfile(value.releaseRoot, value.stackRoot),
    /api\.env and content\.env both set CONTENT_INTENT_ID/u,
  );
  value.writeContent(`DATABASE_NAME=${value.profile.databaseName}\nCONTENT_INTENT_ID=synthetic_override\n`);
  await assert.rejects(
    () => readReleaseQueryProfile(value.releaseRoot, value.stackRoot),
    /api\.env and content\.env both set CONTENT_INTENT_ID/u,
  );
});

test('preflight applies content database consistency and preserves optional local content fields', async t => {
  const value = fixture(t);
  const initial = await readReleaseQueryProfile(value.releaseRoot, value.stackRoot);
  value.writeContent('CONTENT_INTENT_ID=intent_synthetic_custom\n');
  assert.deepEqual(await readReleaseQueryProfile(value.releaseRoot, value.stackRoot), initial);
  value.writeContent(`DATABASE_NAME=${value.profile.databaseName}\n`);
  assert.deepEqual(await readReleaseQueryProfile(value.releaseRoot, value.stackRoot), initial);
  value.writeContent('DATABASE_NAME=synthetic_other\n');
  await assert.rejects(
    () => readReleaseQueryProfile(value.releaseRoot, value.stackRoot),
    /Recorded profile database synthetic_query does not match content\.env synthetic_other/u,
  );
  value.writeContent('DATABASE_NAME=\n');
  await assert.rejects(
    () => readReleaseQueryProfile(value.releaseRoot, value.stackRoot),
    /content\.env: DATABASE_NAME must not be empty/u,
  );
});

test('normal Feishu and content configuration uses the same parsed environment as stack startup', async t => {
  const value = fixture(t);
  value.writeFeishu();
  value.writeContent([
    `DATABASE_NAME=${value.profile.databaseName}`,
    'CONTENT_INTENT_ID=intent_synthetic_custom',
    'CONTENT_REVIEW_LEAD_SUBJECT=ou_syntheticlead',
  ].join('\n'));
  value.writeEnvironment('DB_POOL_MAX=11\n');
  const environment = stackApiEnvironment({
    profile: parseStackProfile(value.profile, value.stackRoot),
    content: loadContentStackConfig(path.join(value.stackRoot, 'content.env')),
    feishu: loadFeishuStackConfig(path.join(value.stackRoot, 'feishu.env')),
    apiConfig: loadApiStackConfig(path.join(value.stackRoot, 'api.env')),
  });
  const api = await import('../../apps/api/dist/runtime-config.js');
  const bootstrap = api.parseApiPrivateBootstrapConfig(environment);
  assert.equal(environment.CONTENT_INTENT_ID, 'intent_synthetic_custom');
  assert.equal(environment.CONTENT_REVIEW_LEAD_SUBJECT, 'ou_syntheticlead');
  assert.equal(environment.CONTENT_REVIEW_MANAGER_SUBJECT, 'ou_syntheticowner');
  assert.equal(api.parseApiRuntimeConfig(environment).authMode, 'feishu');
  assert.equal(bootstrap.productIdentity.feishu.clientId, 'cli_synthetic0001');
  assert.equal(bootstrap.productIdentity.providerOrigin, value.profile.identityOrigin);
  assert.equal(bootstrap.runtimeDatabase.poolMax, 11);
  const result = await readReleaseQueryProfile(value.releaseRoot, value.stackRoot);
  assert.equal(result.mode, bootstrap.query.mode);
  assert.equal(result.mode, 'unified');
});

test('Feishu non-secret identity fields invalidate the fingerprint while secret rotations preserve it', async t => {
  const value = fixture(t);
  value.writeFeishu();
  const initial = await readReleaseQueryProfile(value.releaseRoot, value.stackRoot);
  value.writeFeishu({ FEISHU_APP_SECRET: 'rotated-feishu-secret-material-0002' });
  value.writeEnvironment([
    'CUSTOMER_AGENT_QUERY_MODE=intake-compat',
    'LOG_HASH_KEY=rotated-private-material-000000000001',
    'IDEMPOTENCY_HMAC_KEYS={"hmac-idempotency-v1":"rotated-idempotency-material-00000001"}',
  ].join('\n'));
  assert.deepEqual(await readReleaseQueryProfile(value.releaseRoot, value.stackRoot), initial);
  value.writeFeishu({ FEISHU_APP_ID: 'cli_synthetic0002' });
  assert.notEqual((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).configurationSha256, initial.configurationSha256);
  value.writeFeishu({ FEISHU_REDIRECT_URI: 'https://synthetic-redirect.example/v1/auth/callback' });
  assert.notEqual((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).configurationSha256, initial.configurationSha256);
  for (const secret of ['synthetic-feishu-secret-material-0001', 'rotated-feishu-secret-material-0002', 'rotated-private-material-000000000001']) {
    assert.equal(JSON.stringify(initial).includes(secret), false);
  }
});

test('a legacy candidate retains its unified v1 configuration path', async t => {
  const value = fixture(t, { legacyParser: true, legacyStack: true });
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=unified\n');
  assert.equal((await readReleaseQueryProfile(value.releaseRoot, value.stackRoot)).mode, 'unified');
  value.writeEnvironment('CUSTOMER_AGENT_QUERY_MODE=intake-compat\n');
  await assert.rejects(() => readReleaseQueryProfile(value.releaseRoot, value.stackRoot), /QUERY_PROFILE_MODE_INVALID/u);
});
