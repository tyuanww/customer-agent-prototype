import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const relative = 'packages/content-intake/src/sop-graph-release-gate.ts';
const source = readFileSync(path.join(root, relative), 'utf8');
const require = createRequire(path.join(root, 'packages/content-intake/package.json'));
const ts = require('typescript');
assert.equal(process.versions.node.split('.')[0], '24', 'Use project Node.js 24');
assert.equal(ts.version, '5.9.2', 'Recheck verification before changing TypeScript');
execFileSync('pnpm', ['--filter', '@customer-agent/content-intake', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const dist = path.join(root, 'packages/content-intake/dist');
const { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } = await import(pathToFileURL(path.join(dist, 'sop-real-mapping.js')));
const { checkSopGraphTransactionPreconditions: check } = await import(pathToFileURL(path.join(dist, 'sop-graph-release-gate.js')));
const sourceFields = ['mappingVersion', 'sourceSha256', 'structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'];
const successorFields = ['candidateId', 'candidateVersion', 'contract', ...sourceFields];
const businessFields = ['candidateId', 'candidateVersion', 'mappingVersion', 'sourceSha256', 'reviewDigest'];
const axes = ['candidate-contract', 'candidate-status', 'candidate-publishable', 'snapshot-publishable', 'snapshot-status', 'empty-graph', 'source-hash', 'mapping-version', 'successor-not-accepted', 'business-not-reviewed'];
const wrong = value => typeof value === 'number' ? value + 1 : `wrong:${value}`;

function inputFor(mask, successorFault, businessFault) {
  const bad = bit => (mask & (1 << bit)) !== 0;
  const sourceBinding = { mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256,
    structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64) };
  const candidate = { contract: bad(0) ? 'wrong' : 'resume-v3-successor-candidate', status: bad(1) ? 'wrong' : 'review-only', publishable: bad(2),
    source: { ...sourceBinding, sourceSha256: bad(6) ? 'a'.repeat(64) : sourceBinding.sourceSha256,
      mappingVersion: bad(7) ? 'wrong' : sourceBinding.mappingVersion },
    projection: { contract: 'resume-v3-candidate', flows: bad(5) ? [] : [{
      header: { key: { sourceId: 'synthetic', flowId: 'gate-check', flowVersion: 1 }, title: 'Synthetic', anchorEntry: null,
        entryTerms: ['synthetic'], applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'done', operation: 'upsert',
        audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
      nodes: [{ key: { sourceId: 'synthetic', flowId: 'gate-check', flowVersion: 1 }, id: 'done',
        body: { kind: 'terminal', title: 'Done', stageLabel: 'Done', instruction: 'Done', audience: 'agent' } }], edges: [],
    }], scriptBodies: [], media: [] } };
  const successorEvidence = { accepted: !bad(8), candidateId: 'synthetic-candidate', candidateVersion: 1,
    contract: 'resume-v3-successor-candidate', ...candidate.source };
  const businessEvidence = { reviewed: !bad(9), candidateId: 'synthetic-candidate', candidateVersion: 1,
    mappingVersion: candidate.source.mappingVersion, sourceSha256: candidate.source.sourceSha256, reviewDigest: '5'.repeat(64) };
  if (successorFault) successorEvidence[successorFault] = wrong(successorEvidence[successorFault]);
  if (businessFault) businessEvidence[businessFault] = wrong(businessEvidence[businessFault]);
  return { candidateId: 'synthetic-candidate', candidateVersion: 1, candidate,
    snapshot: { status: bad(4) ? 'needs-information' : 'ready-for-snapshot', publishable: bad(3), issues: [] }, successorEvidence, businessEvidence };
}

function exhaustive(fn) {
  let cases = 0;
  for (let mask = 0; mask < 2 ** axes.length; mask += 1) {
    for (const successorFault of [null, ...successorFields]) for (const businessFault of [null, ...businessFields]) {
      const result = fn(inputFor(mask, successorFault, businessFault));
      const ready = mask === 0 && successorFault === null && businessFault === null;
      assert.equal(result.status, ready ? 'ready-for-transaction' : 'blocked', JSON.stringify({ mask, successorFault, businessFault, result }));
      assert.equal(result.publishable, false, 'Preconditions must never grant publication');
      cases += 1;
    }
  }
  return cases;
}

const cases = exhaustive(check);
const changedSource = inputFor(0, null, null);
// Use a deliberately different digest so the source-binding negative case stays
// meaningful after the formal source moves to de81.
const splitSourceHash = 'f'.repeat(64);
changedSource.candidate.source.sourceSha256 = splitSourceHash;
changedSource.successorEvidence.sourceSha256 = splitSourceHash;
changedSource.businessEvidence.sourceSha256 = splitSourceHash;
assert.equal(check(changedSource).status, 'blocked', 'New workbook must not inherit old source approval');
const mutations = [
  ['missing-contract-approval', "if (!input.successorEvidence.accepted) issues.push('successor contract is not accepted');", '', 1 << 8, null, null],
  ['missing-business-review', "if (!input.businessEvidence.reviewed) issues.push('business review is not complete');", '', 1 << 9, null, null],
  ['unbound-successor', "if (!successorMatches) issues.push('successor evidence does not match candidate');", 'void successorMatches;', 0, 'sourceSha256', null],
  ['unbound-business', "if (input.businessEvidence.candidateId !== input.candidateId", 'if (false && input.businessEvidence.candidateId !== input.candidateId', 0, null, 'candidateId'],
  ['trust-claimed-snapshot', 'const actualSnapshot = checkSopGraphSnapshotReadiness(input.candidate);', 'const actualSnapshot = input.snapshot;', 1 << 5, null, null],
  ['premature-publication', "publishable: false, issues };", 'publishable: true, issues };', 0, null, null],
];
const scratch = mkdtempSync(path.join(tmpdir(), 'sop-release-verification-'));
const caught = [];
try {
  for (const [name, before, after, mask, successorFault, businessFault] of mutations) {
    assert.equal(source.split(before).length, 2, `Mutation drift: ${name}`);
    const directory = path.join(scratch, name);
    cpSync(dist, directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    const changed = ts.transpileModule(source.replace(before, after), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    writeFileSync(path.join(directory, 'sop-graph-release-gate.js'), changed);
    const mutant = (await import(pathToFileURL(path.join(directory, 'sop-graph-release-gate.js')))).checkSopGraphTransactionPreconditions;
    const result = mutant(inputFor(mask, successorFault, businessFault));
    const ready = mask === 0 && successorFault === null && businessFault === null;
    assert(result.status !== (ready ? 'ready-for-transaction' : 'blocked') || result.publishable !== false, `Mutation survived: ${name}`);
    caught.push({ mutation: name, faults: axes.filter((_, bit) => mask & (1 << bit)), successorFault, businessFault, observed: result.status, publishable: result.publishable });
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
assert.equal(exhaustive(check), cases, 'Baseline must still pass after scratch mutations');
assert.equal(readFileSync(path.join(root, relative), 'utf8'), source, 'Covered source must remain untouched');
const hashes = Object.fromEntries(['sop-graph-release-gate.ts', 'sop-graph-snapshot.ts', 'sop-real-mapping.ts'].map(name => [name,
  createHash('sha256').update(readFileSync(path.join(root, 'packages/content-intake/src', name))).digest('hex')]));
const report = { status: 'PASS', method: 'bounded exhaustive generated inputs against compiled real TypeScript, not an unbounded formal proof',
  node: process.version, typescript: ts.version, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes: hashes, cases, newWorkbookSourceRejected: true, axes, successorFaults: successorFields, businessFaults: businessFields, mutations: caught,
  exclusions: ['Multiple simultaneous mismatch fields within one evidence object', 'Arbitrary malformed JSON', 'Graph topology beyond one terminal or empty graph', 'Approval authenticity and persistence', 'Real workbook mapping, story semantics, runtime UI, publication transaction'] };
if (process.argv[2]) writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
