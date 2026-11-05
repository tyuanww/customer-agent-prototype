import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exploreOperationOrdering } from '../models/operation-ordering.mjs';
import { runManualIdentityVerification } from './verify-manual-identity-with-basefix.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '../../../..');
const defaultSkillRoot = path.resolve(scriptDirectory, '..');

const expectedControls = Object.freeze({
  'skip-authorization-check': 'accept_without_authorization',
  'accept-after-revocation': 'accept_after_revocation',
  'duplicate-effect': 'duplicate_committed_effect',
  'expire-after-effect-without-resolution': 'unknown_expired_without_lookup',
  'ignore-epoch': 'sessionEpoch_mismatch_not_rejected',
  'ignore-request-hash': 'requestHash_mismatch_not_rejected',
  'skip-recovery-lookup': 'recovery_invented_success',
});

const expectedStates = Object.freeze([
  'accepted',
  'cancelled',
  'committed',
  'expired',
  'failed',
  'running',
  'unknown',
]);

const allowedAfterSourceCommit = Object.freeze([
  '.cursor/skills/verify-seat-administration-revocation/receipts.json',
  '.cursor/skills/verify-unified-operation-ordering/receipts.json',
]);

const nestedSeatReceipt = '.cursor/skills/verify-seat-administration-revocation/receipts.json';
const seatSourceFiles = Object.freeze([
  'apps/api/src/content-intake/authority.ts',
  'apps/api/src/content-intake/organization/facts-writer.ts',
  'apps/api/src/content-intake/seat-password-file.ts',
  'apps/api/src/content-intake/seats-http.ts',
  'apps/api/src/content-intake/seats.ts',
  'packages/database/migrations/0058_grant_steward_no_restore.sql',
  'packages/database/migrations/0068_seat_lifecycle.sql',
]);
const sourceFiles = Object.freeze([
  '.agents/skills/verify-intake-parent-revocation/SKILL.md',
  '.agents/skills/verify-intake-parent-revocation/verify.mjs',
  '.agents/skills/verify-manual-identity-grants/SKILL.md',
  '.cursor/skills/verify-seat-administration-revocation/SKILL.md',
  '.cursor/skills/verify-seat-administration-revocation/models/seat-revocation.mjs',
  '.cursor/skills/verify-seat-administration-revocation/scripts/check.mjs',
  nestedSeatReceipt,
  '.cursor/skills/verify-unified-operation-ordering/SKILL.md',
  '.cursor/skills/verify-unified-operation-ordering/models/operation-ordering.d.mts',
  '.cursor/skills/verify-unified-operation-ordering/models/operation-ordering.mjs',
  '.cursor/skills/verify-unified-operation-ordering/scripts/check.d.mts',
  '.cursor/skills/verify-unified-operation-ordering/scripts/check.mjs',
  '.cursor/skills/verify-unified-operation-ordering/scripts/verify-manual-identity-with-basefix.d.mts',
  '.cursor/skills/verify-unified-operation-ordering/scripts/verify-manual-identity-with-basefix.mjs',
  'apps/api/src/auth-service.ts',
  'apps/api/src/content-intake/authority.ts',
  'apps/api/src/content-intake/role-ceiling.ts',
  'apps/api/src/content-intake/seat-password-file.ts',
  'apps/api/src/content-intake/seats-http.ts',
  'apps/api/src/content-intake/seats.ts',
  'apps/api/src/content-intake/service.ts',
  'apps/api/src/content-intake/transaction.ts',
  'apps/api/src/content-object-store.ts',
  'apps/api/src/feishu-admit.ts',
  'apps/api/src/feishu-job-snapshot.ts',
  'apps/api/src/feishu-login-link.ts',
  'apps/api/src/operator-display-names.ts',
  'apps/api/src/product-auth-service.ts',
  'apps/api/src/project-roster-login.ts',
  'apps/api/src/synthetic-identity-provider.ts',
  'apps/api/tests/a6-permission-e2e.integration.test.ts',
  'apps/api/tests/authorization-reachability.integration.test.ts',
  'apps/api/tests/feishu-login-link.integration.test.ts',
  'apps/api/tests/manual-identity-grants.integration.test.ts',
  'apps/api/tests/manual-identity-property.test.ts',
  'apps/api/tests/p0-live-lanes.integration.test.ts',
  'apps/api/tests/project-roster-login.integration.test.ts',
  'apps/api/tests/roster-authority.integration.test.ts',
  'apps/api/tests/seat-lifecycle.integration.test.ts',
  'apps/api/tests/seat-login-flow.integration.test.ts',
  'apps/api/tests/support/authorization-sources-fixture.ts',
  'apps/api/tests/support/roster-library.ts',
  'apps/api/tests/unified-operation-ordering-formal.test.ts',
  'docs/reference-project-architecture.md',
  'package.json',
  'packages/database/migrations/0076_authorization_decision.sql',
  'packages/database/migrations/0077_manual_identity_grants.sql',
  'packages/database/migrations/0078_seat_manual_grants.sql',
  'packages/database/migrations/0079_directory_identity_activity.sql',
  'packages/database/migrations/0080_bind_import_batch_tenant.sql',
  'packages/database/migrations/0081_require_import_batch_principal.sql',
  'packages/database/migrations/manifest.generated.json',
  'packages/database/overlays/0076_authorization_decision.sql',
  'packages/database/overlays/0077_manual_identity_grants.sql',
  'packages/database/overlays/0078_seat_manual_grants.sql',
  'packages/database/src/verifier.ts',
  'packages/unified-contracts/src/index.ts',
  'packages/unified-contracts/tests/contracts.test.ts',
  'scripts/synthetic-stack/identity-admission.ts',
  'scripts/synthetic-stack/identity-provider.ts',
  'scripts/synthetic-stack/password-identity-server.ts',
]);

function readRequired(file, label) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`missing required ${label}: ${file}`);
    }
    throw error;
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(readRequired(file, label).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`invalid ${label}: ${file}: ${error.message}`);
    throw error;
  }
}

function assertRelativePath(relative) {
  if (typeof relative !== 'string' || relative.length === 0 || path.isAbsolute(relative)
    || relative.split(path.sep).includes('..')) {
    throw new Error(`receipt contains an unsafe source path: ${String(relative)}`);
  }
}

function verifyFiles(repositoryRoot, receipt, prefix) {
  if (!receipt.files || typeof receipt.files !== 'object'
    || Array.isArray(receipt.files) || Object.keys(receipt.files).length === 0) {
    throw new Error(`${prefix} does not declare any source files`);
  }
  return Object.entries(receipt.files).map(([relative, expected]) => {
    assertRelativePath(relative);
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      throw new Error(`${prefix} has an invalid SHA-256 for ${relative}`);
    }
    const actual = createHash('sha256')
      .update(readRequired(path.join(repositoryRoot, relative), 'source file'))
      .digest('hex');
    if (actual !== expected) {
      throw new Error(`${relative} changed since ${prefix} was synchronized`);
    }
    return { id: `${prefix}:${relative}`, relative, actual };
  });
}

function assertExactManifest(declared, required, label) {
  const actual = [...new Set(declared)].sort();
  const expected = [...new Set(required)].sort();
  const missing = expected.filter(relative => !actual.includes(relative));
  const unexpected = actual.filter(relative => !expected.includes(relative));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${label} manifest drifted: missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`);
  }
}

export function combineSourceEntries(entries) {
  return createHash('sha256')
    .update([...entries].sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, actual }) => `${id}:${actual}`)
      .join('\n'))
    .digest('hex');
}

export function verifyReceiptTree({
  repositoryRoot = defaultRepositoryRoot,
  skillRoot = defaultSkillRoot,
  requiredFiles = sourceFiles,
  requiredNestedReceipts = [nestedSeatReceipt],
  requiredNestedFiles = { [nestedSeatReceipt]: seatSourceFiles },
} = {}) {
  const receiptPath = path.join(skillRoot, 'receipts.json');
  const receipts = readJson(receiptPath, 'receipt');
  if (!/^[0-9a-f]{40}$/.test(receipts.syncCommit ?? '')) {
    throw new Error('receipt syncCommit must be a full 40-character Git commit SHA');
  }
  if (receipts.testedSourceCommit !== receipts.syncCommit) {
    throw new Error('receipt testedSourceCommit must equal syncCommit');
  }

  assertExactManifest(Object.keys(receipts.files), requiredFiles, 'unified source');
  const entries = verifyFiles(repositoryRoot, receipts, 'unified');
  if (!Array.isArray(receipts.nestedReceipts)) {
    throw new Error('receipt nestedReceipts must be an explicit array');
  }
  assertExactManifest(receipts.nestedReceipts, requiredNestedReceipts, 'nested receipt');
  for (const nestedRelative of requiredNestedReceipts) {
    assertRelativePath(nestedRelative);
    if (!Object.hasOwn(receipts.files, nestedRelative)) {
      throw new Error(`nested receipt is not bound by the parent source receipt: ${nestedRelative}`);
    }
    const nested = readJson(path.join(repositoryRoot, nestedRelative), 'nested receipt');
    if (nested.syncCommit !== receipts.syncCommit) {
      throw new Error(`nested receipt ${nestedRelative} has a different syncCommit`);
    }
    const nestedRequiredFiles = requiredNestedFiles[nestedRelative];
    if (!Array.isArray(nestedRequiredFiles)) {
      throw new Error(`no required source manifest is declared for nested receipt ${nestedRelative}`);
    }
    assertExactManifest(Object.keys(nested.files), nestedRequiredFiles, `nested source (${nestedRelative})`);
    entries.push(...verifyFiles(repositoryRoot, nested, `nested:${nestedRelative}`));
  }

  const combined = combineSourceEntries(entries);
  if (receipts.sourceReceipt !== combined) {
    throw new Error(`combined source receipt drifted: expected ${receipts.sourceReceipt}, actual ${combined}`);
  }
  return Object.freeze({ receipts, entries: Object.freeze(entries), combined });
}

function fileHash(file) {
  return createHash('sha256').update(readRequired(file, 'receipt source')).digest('hex');
}

export function syncReceipts({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const workingTree = git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const unexpectedChanges = workingTree === '' ? [] : workingTree.split('\n')
    .map(line => line.slice(3))
    .filter(relative => !allowedAfterSourceCommit.includes(relative));
  if (unexpectedChanges.length > 0) {
    throw new Error(`receipt synchronization found source changes: ${unexpectedChanges.join(', ')}`);
  }
  const syncCommit = git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const primary = exploreOperationOrdering('correct');
  if (primary.violation !== null) throw new Error(`primary model failed before receipt sync: ${primary.violation}`);

  const seatReceiptPath = path.join(repositoryRoot, nestedSeatReceipt);
  const seatReceipt = readJson(seatReceiptPath, 'seat receipt');
  const seatFiles = Object.fromEntries(Object.keys(seatReceipt.files).sort()
    .map(relative => [relative, fileHash(path.join(repositoryRoot, relative))]));
  const nextSeatReceipt = {
    ...seatReceipt,
    syncCommit,
    workingTree: 'covered sources clean at syncCommit',
    capturedAt: new Date().toISOString(),
    files: seatFiles,
  };
  writeFileSync(seatReceiptPath, `${JSON.stringify(nextSeatReceipt, null, 2)}\n`);

  const files = Object.fromEntries(sourceFiles.slice().sort()
    .map(relative => [relative, fileHash(path.join(repositoryRoot, relative))]));
  const mainEntries = sourceFiles.map(relative => ({
    id: `unified:${relative}`,
    actual: files[relative],
  }));
  const nestedEntries = Object.keys(seatFiles).map(relative => ({
    id: `nested:${nestedSeatReceipt}:${relative}`,
    actual: seatFiles[relative],
  }));
  const sourceReceipt = combineSourceEntries([...mainEntries, ...nestedEntries]);
  const currentPath = path.join(defaultSkillRoot, 'receipts.json');
  const current = readJson(currentPath, 'receipt');
  const next = {
    ...current,
    syncCommit,
    testedSourceCommit: syncCommit,
    candidateState: 'verified FOR-01 source commit on the certified ARC-01 base',
    capturedAt: new Date().toISOString(),
    sourceReceipt,
    modelStates: primary.states,
    modelEdges: primary.edges,
    environment: {
      node: process.version.slice(1),
      pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
      postgresql: execFileSync(path.join(
        process.env.CUSTOMER_AGENT_PG15_BIN ?? '/Users/hutou/homebrew/opt/postgresql@15/bin',
        'postgres',
      ), ['--version'], { encoding: 'utf8' }).trim().replace(/^postgres \(PostgreSQL\) /u, ''),
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
    },
    commands: [
      'pnpm test:unified-operation-ordering',
      'CUSTOMER_AGENT_API_PG15_INTEGRATION=1 CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin pnpm --filter @customer-agent/api exec vitest run tests/authorization-reachability.integration.test.ts',
      'PATH=/Users/hutou/homebrew/opt/node@24/bin:$PATH CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin node .agents/skills/verify-intake-parent-revocation/verify.mjs /tmp/customer-agent-parent-revocation.json',
      'PATH=/Users/hutou/homebrew/opt/node@24/bin:$PATH CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run <manual-identity-command>',
      'CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin pnpm test:seat-administration-revocation',
      'CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin pnpm --filter @customer-agent/api test:integration',
      'CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin pnpm --filter @customer-agent/database test:integration',
      'pnpm lint',
      'pnpm typecheck',
      'git diff --check',
    ],
    nestedReceipts: [nestedSeatReceipt],
    files,
    verification: [],
    limitations: [
      'The exhaustive model covers contract state and event order, not PostgreSQL MVCC or process death during COMMIT.',
      'ARC-01 has no product operation store; no runtime envelope persistence is claimed.',
      'PostgreSQL replays cover existing authorization, seat administration, receipts, and identity grant lifecycle code.',
    ],
  };
  writeFileSync(currentPath, `${JSON.stringify(next, null, 2)}\n`);
  return Object.freeze({ syncCommit, sourceReceipt, modelStates: primary.states, modelEdges: primary.edges });
}

function git(repositoryRoot, args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function assertEvidenceOnlyChanges(changedPaths) {
  const unexpected = [...changedPaths].filter(relative => !allowedAfterSourceCommit.includes(relative));
  if (unexpected.length > 0) {
    throw new Error(`source changed after syncCommit outside evidence files: ${unexpected.join(', ')}`);
  }
}

export function verifyGitProvenance({
  repositoryRoot = defaultRepositoryRoot,
  receipts,
} = {}) {
  const testedHead = git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const syncCommit = receipts.syncCommit;
  try {
    git(repositoryRoot, ['cat-file', '-e', `${syncCommit}^{commit}`]);
  } catch {
    throw new Error(`syncCommit is not a readable commit: ${syncCommit}`);
  }
  try {
    git(repositoryRoot, ['merge-base', '--is-ancestor', syncCommit, testedHead]);
  } catch {
    throw new Error(`syncCommit ${syncCommit} is not an ancestor of tested head ${testedHead}`);
  }
  const workingTree = git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (workingTree !== '') {
    throw new Error(`receipt verification requires a clean working tree: ${workingTree}`);
  }
  const output = git(repositoryRoot, ['diff', '--name-only', syncCommit, testedHead]);
  const changedAfterSync = output === '' ? [] : output.split('\n');
  assertEvidenceOnlyChanges(changedAfterSync);
  return Object.freeze({ testedHead, syncCommit, changedAfterSync: Object.freeze(changedAfterSync) });
}

function assertRequiredWitnesses(result) {
  for (const [witness, present] of Object.entries(result.witnesses)) {
    if (!present) throw new Error(`model did not observe required witness: ${witness}`);
  }
  const acceptedFirst = result.witnessPaths.acceptedBeforeRevocation ?? [];
  const acceptedAt = acceptedFirst.indexOf('acceptCommand');
  const revokedAt = acceptedFirst.indexOf('revokeAuthorization');
  if (acceptedAt < 0 || revokedAt < 0 || acceptedAt >= revokedAt) {
    throw new Error('accepted-before-revocation witness does not prove event order');
  }
  const writeAfterRevocation = result.witnessPaths.admittedWriteAfterRevocation ?? [];
  const writeAcceptedAt = writeAfterRevocation.indexOf('acceptCommand');
  const writeRevokedAt = writeAfterRevocation.indexOf('revokeAuthorization');
  const writeAt = writeAfterRevocation.indexOf('writeEffect');
  if (writeAcceptedAt < 0 || writeRevokedAt <= writeAcceptedAt || writeAt <= writeRevokedAt) {
    throw new Error('admitted-write-after-revocation witness does not prove event order');
  }
}

export function runOperationVerifier({
  repositoryRoot = defaultRepositoryRoot,
  skillRoot = defaultSkillRoot,
} = {}) {
  const receiptEvidence = verifyReceiptTree({ repositoryRoot, skillRoot });
  const provenance = verifyGitProvenance({ repositoryRoot, receipts: receiptEvidence.receipts });
  const primary = exploreOperationOrdering('correct');
  if (primary.violation !== null) {
    throw new Error(`primary model failed: ${primary.path.join(' -> ')}: ${primary.violation}`);
  }
  const requiredStates = new Set(expectedStates);
  for (const state of primary.reachedStates) requiredStates.delete(state);
  if (requiredStates.size > 0) {
    throw new Error(`model did not reach states: ${[...requiredStates].join(', ')}`);
  }
  assertRequiredWitnesses(primary);
  if (receiptEvidence.receipts.modelStates !== primary.states) {
    throw new Error(`model state count drifted: receipt ${receiptEvidence.receipts.modelStates}, actual ${primary.states}`);
  }
  if (receiptEvidence.receipts.modelEdges !== primary.edges) {
    throw new Error(`model edge count drifted: receipt ${receiptEvidence.receipts.modelEdges}, actual ${primary.edges}`);
  }

  const mutations = [];
  for (const [mode, expected] of Object.entries(expectedControls)) {
    const finding = exploreOperationOrdering(mode);
    if (finding.violation !== expected) {
      throw new Error(`${mode} produced ${String(finding.violation)}, expected ${expected}`);
    }
    if (mode === 'accept-after-revocation'
      && finding.path.join('|') !== 'observeRequest|checkAuthorization|revokeAuthorization|acceptCommand') {
      throw new Error(`accept-after-revocation did not cover the required ordering: ${finding.path.join(' -> ')}`);
    }
    if (mode === 'duplicate-effect'
      && (!finding.path.includes('duplicateSubmit') || !finding.path.includes('duplicateWriteEffect'))) {
      throw new Error(`duplicate-effect did not cover a second write attempt: ${finding.path.join(' -> ')}`);
    }
    if (mode === 'expire-after-effect-without-resolution'
      && (!finding.path.includes('commitUnknownAfterEffect') || finding.path.at(-1) !== 'expireUnknown')) {
      throw new Error(`expire-after-effect-without-resolution did not cover the post-effect expiry path: ${finding.path.join(' -> ')}`);
    }
    if (mode === 'skip-recovery-lookup'
      && (!finding.path.includes('commitUnknownAfterEffect') || !finding.path.includes('recoverUnknown'))) {
      throw new Error(`skip-recovery-lookup did not cover the uncertain post-effect path: ${finding.path.join(' -> ')}`);
    }
    mutations.push(Object.freeze({
      mode,
      expected,
      actual: finding.violation,
      path: Object.freeze(finding.path),
    }));
  }
  const basefixVerification = runManualIdentityVerification({ repositoryRoot });

  return Object.freeze({
    schemaVersion: 'for-operation-ordering-verifier-report/v1',
    testedHead: provenance.testedHead,
    syncCommit: provenance.syncCommit,
    changedAfterSync: provenance.changedAfterSync,
    sourceReceipt: receiptEvidence.combined,
    environment: receiptEvidence.receipts.environment,
    model: Object.freeze({
      states: primary.states,
      edges: primary.edges,
      reachedStates: primary.reachedStates,
      witnesses: primary.witnesses,
      witnessPaths: primary.witnessPaths,
    }),
    negativeControls: Object.freeze(mutations),
    basefixVerification,
    verification: receiptEvidence.receipts.verification,
    sourceFiles: receiptEvidence.entries,
    errorCount: 0,
    passed: true,
  });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

function main() {
  if (process.argv.includes('--sync-receipts')) {
    const receipt = syncReceipts();
    console.log(`RECEIPT_SYNCED ${receipt.syncCommit} ${receipt.sourceReceipt}`);
    return;
  }
  const report = runOperationVerifier();
  console.log(`MODEL_PASS unified-operation-ordering ${report.model.states} states, ${report.model.edges} transitions`);
  console.log(`MODEL_COVERAGE ${report.model.reachedStates.join(',')}`);
  console.log(`MODEL_WITNESSES ${JSON.stringify(report.model.witnesses)}`);
  for (const control of report.negativeControls) {
    console.log(`MUTATION_DETECTED ${control.mode} ${control.actual} ${control.path.join(' -> ')}`);
  }
  console.log(`RECEIPT_PASS ${report.sourceReceipt}`);
  console.log(`PROVENANCE_PASS ${report.syncCommit} -> ${report.testedHead}`);
  const reportPath = argumentValue('--report');
  if (reportPath !== null) {
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`REPORT_WRITTEN ${reportPath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`MODEL_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
