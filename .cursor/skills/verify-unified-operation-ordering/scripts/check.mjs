import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exploreOperationOrdering } from '../models/operation-ordering.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../../..');
const skillRoot = path.resolve(scriptDirectory, '..');

const expectedControls = Object.freeze({
  'skip-authorization-check': 'accept_without_authorization',
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

function verifyReceipts() {
  const receipts = JSON.parse(readFileSync(path.join(skillRoot, 'receipts.json'), 'utf8'));
  const hashes = [];
  for (const [relative, expected] of Object.entries(receipts.files)) {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(repositoryRoot, relative)))
      .digest('hex');
    if (actual !== expected) {
      throw new Error(`${relative} changed since unified operation verification was synchronized`);
    }
    hashes.push({ relative, actual });
  }
  const combined = createHash('sha256')
    .update(hashes.sort((left, right) => left.relative.localeCompare(right.relative))
      .map(({ relative, actual }) => `${relative}:${actual}`)
      .join('\n'))
    .digest('hex');
  if (receipts.sourceReceipt !== combined) {
    throw new Error(`combined source receipt drifted: expected ${receipts.sourceReceipt}, actual ${combined}`);
  }
  return receipts;
}

try {
  let receipts;
  try {
    receipts = verifyReceipts();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      receipts = null;
    } else {
      throw error;
    }
  }

  const primary = exploreOperationOrdering('correct');
  if (primary.violation !== null) {
    throw new Error(`primary model failed: ${primary.path.join(' -> ')}: ${primary.violation}`);
  }
  const requiredStates = new Set(expectedStates);
  for (const state of primary.reachedStates) requiredStates.delete(state);
  if (requiredStates.size > 0) {
    throw new Error(`model did not reach states: ${[...requiredStates].join(', ')}`);
  }
  for (const [witness, present] of Object.entries(primary.witnesses)) {
    if (!present) throw new Error(`model did not observe required witness: ${witness}`);
  }
  if (receipts?.modelStates !== undefined && receipts.modelStates !== primary.states) {
    throw new Error(`model state count drifted: receipt ${receipts.modelStates}, actual ${primary.states}`);
  }
  if (receipts?.modelEdges !== undefined && receipts.modelEdges !== primary.edges) {
    throw new Error(`model edge count drifted: receipt ${receipts.modelEdges}, actual ${primary.edges}`);
  }
  console.log(`MODEL_PASS unified-operation-ordering ${primary.states} states, ${primary.edges} transitions`);
  console.log(`MODEL_COVERAGE ${primary.reachedStates.join(',')}`);
  console.log(`MODEL_WITNESSES ${JSON.stringify(primary.witnesses)}`);

  for (const [mode, expected] of Object.entries(expectedControls)) {
    const finding = exploreOperationOrdering(mode);
    if (finding.violation !== expected) {
      throw new Error(`${mode} produced ${String(finding.violation)}, expected ${expected}`);
    }
    console.log(`MUTATION_DETECTED ${mode} ${finding.violation} ${finding.path.join(' -> ')}`);
  }

  if (receipts !== null) {
    console.log(JSON.stringify({
      sourceReceipt: receipts.sourceReceipt,
      commands: receipts.commands,
      environment: receipts.environment,
      modelStates: primary.states,
      files: receipts.files,
    }, null, 2));
  }
} catch (error) {
  console.error(`MODEL_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
