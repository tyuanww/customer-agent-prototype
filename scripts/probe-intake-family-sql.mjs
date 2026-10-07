// Run after the database build with Node 24. This probe creates and destroys its
// own PostgreSQL cluster; it never accepts a DSN or reads an application profile.
// It measures the actual snapshot selection SQL, not the complete HTTP/approval
// path. The fixture bypasses FK/immutability triggers only while seeding.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pg15Harness } from '../packages/database/dist/testkit/index.js';
import { applyDatabaseMigrations } from '../packages/database/dist/index.js';
import { familyCatalog } from '../packages/database/tests/support/family-catalog.ts';

assert.equal(process.versions.node.split('.')[0], '24', 'Use the repository Node 24 runtime');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--output'),
  'Usage: node scripts/probe-intake-family-sql.mjs [--output result.json]');
const output = args[1] ? resolve(args[1]) : null;
const repo = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourcePath = 'apps/api/src/content-intake/usage.ts';
const source = readFileSync(resolve(repo, sourcePath), 'utf8');

// Fail closed if the production query moves or its shape changes. This avoids a
// test-only SQL implementation drifting away from the query actually shipped.
function extractOne(pattern, label) {
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label} extraction must be unique`);
  return matches[0][1];
}
const entries = extractOne(/const entries = `([\s\S]*?)`;/g, 'entries');
const applies = extractOne(/const applies = `([\s\S]*?)`;/g, 'applies');
const template = extractOne(
  /const result=await client\.query<\{ source_id: string; business_entry_id: string; e: C\['IntakeEntry'\] \}>\(`([\s\S]*?)`,/g,
  'snapshot query',
);
const sql = template.replaceAll('${entries}', entries).replaceAll('${applies}', applies);
assert.ok(!sql.includes('${'), 'Unresolved SQL interpolation');

const now = new Date('2026-10-08T00:00:00Z');
const products = Array.from({ length: 100 }, (_, i) => `p${i}`);
const scenarios = Array.from({ length: 100 }, (_, i) => `s${i}`);
const root = (id, extra = {}) => ({ source: 'brand-source', id, ...extra });
const child = (id, parent, extra = {}) => ({
  source: 'shop-source', shop: 'shop-one', id,
  familySourceId: 'brand-source', familyBusinessEntryId: parent, ...extra,
});
const key = entry => `${entry.source}/${entry.id}`;
const matches = (refs, id) => !refs?.length || (id !== null && refs.includes(id));

// Independent Cartesian oracle deliberately uses no slots, multiranges or SQL
// grouping. A root remains whenever one applicable selected pair is uncovered.
function expectedEntries(rows, selectedProducts, selectedScenarios) {
  const eligible = rows.filter(entry =>
    (entry.operation ?? 'upsert') === 'upsert'
    && new Date(entry.from ?? '2026-01-01T00:00:00Z') <= now
    && (!entry.to || new Date(entry.to) > now)
    && (!entry.products?.length || entry.products.some(id => selectedProducts.includes(id)))
    && (!entry.scenarios?.length || entry.scenarios.some(id => selectedScenarios.includes(id))));
  return eligible.filter(entry => {
    const children = eligible.filter(candidate => candidate.familySourceId === entry.source
      && candidate.familyBusinessEntryId === entry.id);
    if (!children.length) return true;
    for (const product of selectedProducts.length ? selectedProducts : [null]) {
      for (const scenario of selectedScenarios.length ? selectedScenarios : [null]) {
        if (matches(entry.products, product) && matches(entry.scenarios, scenario)
          && !children.some(candidate => matches(candidate.products, product)
            && matches(candidate.scenarios, scenario))) return true;
      }
    }
    return false;
  }).map(key).sort();
}

const report = {
  createdAt: new Date().toISOString(), nodeVersion: process.version,
  source: sourcePath, sourceSha256: sha256(source), sqlSha256: sha256(sql),
  fixtureSha256: sha256(readFileSync(resolve(repo, 'packages/database/tests/support/family-catalog.ts'))),
  migrationManifestSha256: sha256(readFileSync(resolve(repo, 'packages/database/migrations/manifest.generated.json'))),
  boundary: 'Snapshot selection SQL only; synthetic fixture bypasses FK/immutability during seeding. '
    + 'Excludes entitlement, approval, vocabulary projection and complete HTTP/history performance. '
    + 'The dense guard case separately measures assert_family_catalog. Random query-oracle catalogs '
    + 'may contain overlapping children and are not evidence that the publication guard accepts them.',
  statementTimeoutMs: 5000, randomSeed: '0x6012809', cases: [], oracleCases: 0,
};
const harness = new Pg15Harness();
let client;

async function run(name, rows, selectedProducts, selectedScenarios, { capacity = false, guard = false } = {}) {
  const inputSha256 = sha256(JSON.stringify({ rows, selectedProducts, selectedScenarios, now }));
  await client.query('BEGIN');
  let start;
  try {
    await familyCatalog(client, rows);
    await client.query("SET LOCAL statement_timeout='5s'");
    start = performance.now();
    const result = await client.query(guard
      ? 'SELECT content_intake.assert_family_catalog($1::text)' : sql, guard
      ? ['family-release']
      : ['family-release', ['brand-source', 'shop-source'], now,
        selectedProducts, selectedScenarios, '', '', capacity ? 101 : 10000]);
    const elapsedMs = +(performance.now() - start).toFixed(1);
    if (!guard) {
      const actual = result.rows.map(row => `${row.source_id}/${row.business_entry_id}`);
      const expected = expectedEntries(rows, selectedProducts, selectedScenarios);
      assert.deepEqual(actual, capacity ? expected.slice(0, 101) : expected, name);
    }
    report.cases.push({ name, inputSha256, entries: rows.length, products: selectedProducts.length,
      scenarios: selectedScenarios.length, elapsedMs, returned: result.rowCount, status: 'PASS' });
  } catch (error) {
    report.cases.push({ name, inputSha256, status: 'FAIL', code: error.code ?? null,
      elapsedMs: start === undefined ? null : +(performance.now() - start).toFixed(1), message: error.message });
  } finally {
    await client.query('ROLLBACK');
  }
  if (capacity || guard) process.stderr.write(`${JSON.stringify(report.cases.at(-1))}\n`);
}

try {
  harness.start();
  const database = harness.createDatabase('family_sql_probe');
  client = await harness.connect(database.config);
  await applyDatabaseMigrations(client);
  await run('guard-5000-unassociated-shop-entries', Array.from({ length: 5000 }, (_, i) => ({
    source: 'shop-source', shop: 'shop-one', id: `plain-${i}`,
  })), [], [], { guard: true });
  await run('guard-1-root-4999-disjoint-product-children', [root('root'),
    ...Array.from({ length: 4999 }, (_, i) => child(`c${i}`, 'root', { products: [`p${i}`] }))], [], [], { guard: true });
  await run('usage-2500-wildcard-families', Array.from({ length: 2500 }, (_, i) =>
    [root(`r${i}`), child(`c${i}`, `r${i}`)]).flat(), products, scenarios, { capacity: true });
  await run('usage-1666-product-partition-families', Array.from({ length: 1666 }, (_, i) =>
    [root(`r${i}`), child(`a${i}`, `r${i}`, { products: products.slice(0, 50) }),
      child(`b${i}`, `r${i}`, { products: products.slice(50) })]).flat(), products, scenarios, { capacity: true });
  await run('usage-1666-scenario-partition-families', Array.from({ length: 1666 }, (_, i) =>
    [root(`r${i}`), child(`a${i}`, `r${i}`, { scenarios: scenarios.slice(0, 50) }),
      child(`b${i}`, `r${i}`, { scenarios: scenarios.slice(50) })]).flat(), products, scenarios, { capacity: true });

  const semanticCases = [
    ['partial-root', [root('r'), child('c', 'r', { products: ['p0'] })], ['p0', 'p1'], ['s0']],
    ['union-complete', [root('r'), child('a', 'r', { products: ['p0'] }),
      child('b', 'r', { products: ['p1'] })], ['p0', 'p1'], ['s0', 's1']],
    ['empty-both', [root('r'), child('a', 'r', { products: ['p0'] }),
      child('b', 'r', { scenarios: ['s0'] })], [], []],
    ['empty-wildcard', [root('r'), child('a', 'r')], [], []],
    ['noncontiguous-gap', [root('r'), child('a', 'r', { scenarios: ['s0', 's2'] })], ['p0'], ['s0', 's1', 's2']],
    ['noncontiguous-root', [root('r', { scenarios: ['s0', 's2'] }),
      child('a', 'r', { scenarios: ['s0', 's2'] })], ['p0'], ['s0', 's1', 's2']],
    ['cross-gap', [root('r'), child('a', 'r', { products: ['p0'], scenarios: ['s0'] }),
      child('b', 'r', { products: ['p1'], scenarios: ['s1'] })], ['p0', 'p1'], ['s0', 's1']],
    ['protected-disjoint', [root('r', { products: ['p0'], brandNonOverridable: true }),
      child('a', 'r', { products: ['p1'] })], ['p0', 'p1'], ['s0']],
    ['inactive-children', [root('r'), child('a', 'r', { operation: 'disable' }),
      child('b', 'r', { from: '2026-10-09T00:00:00Z' }), child('c', 'r', { to: now.toISOString() })], ['p0'], ['s0']],
  ];
  for (const testCase of semanticCases) await run(...testCase);
  let seed = 0x6012809;
  const random = count => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % count;
  };
  const choose = values => values.filter(() => random(2));
  for (let i = 0; i < 100; i++) {
    const selectedProducts = choose(['p0', 'p1', 'p2', 'p3']);
    const selectedScenarios = choose(['s0', 's1', 's2', 's3']);
    const rows = [root('r', { products: choose(['p0', 'p1', 'p2', 'p3']), scenarios: choose(['s0', 's1', 's2', 's3']) })];
    // Keep this generator identical to the independent review reproduction.
    for (let j = 0; j < 1 + random(6); j++) rows.push(child(`c${j}`, 'r', {
      products: choose(['p0', 'p1', 'p2', 'p3']), scenarios: choose(['s0', 's1', 's2', 's3']),
    }));
    await run(`oracle-${i}`, rows, selectedProducts, selectedScenarios);
    report.oracleCases++;
  }
  assert.equal(report.cases.length, 114);
  assert.equal(report.oracleCases, 100);
} catch (error) {
  report.fatalError = error.message;
} finally {
  try { if (client) await client.end(); }
  finally { harness.stop(); }
}
report.status = report.fatalError || report.cases.some(testCase => testCase.status === 'FAIL') ? 'FAIL' : 'PASS';
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, json);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), report, 'Persisted result must be readable');
  process.stderr.write(`${report.status}: ${report.cases.length} cases; result ${output}\n`);
} else process.stdout.write(json);
if (report.status === 'FAIL') process.exitCode = 1;
