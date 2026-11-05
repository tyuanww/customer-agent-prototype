import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  exploreOperationOrdering,
  type OperationOrderingMode,
} from '../../../.cursor/skills/verify-unified-operation-ordering/models/operation-ordering.mjs';
import {
  assertEvidenceOnlyChanges,
  verifyGitProvenance,
  verifyReceiptTree,
} from '../../../.cursor/skills/verify-unified-operation-ordering/scripts/check.mjs';
import {
  assertManualIdentityResult,
  resolveBaselineDependency,
} from '../../../.cursor/skills/verify-unified-operation-ordering/scripts/verify-manual-identity-with-basefix.mjs';

const CONTROLS: ReadonlyArray<readonly [OperationOrderingMode, string]> = [
  ['skip-authorization-check', 'accept_without_authorization'],
  ['accept-after-revocation', 'accept_after_revocation'],
  ['duplicate-effect', 'duplicate_committed_effect'],
  ['ignore-epoch', 'sessionEpoch_mismatch_not_rejected'],
  ['ignore-request-hash', 'requestHash_mismatch_not_rejected'],
  ['skip-recovery-lookup', 'recovery_invented_success'],
];

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'for-operation-receipt-'));
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function receiptFixture(root: string, source = 'synthetic-source') {
  const skillRoot = path.join(root, '.cursor/skills/verify-unified-operation-ordering');
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(path.join(root, 'source.txt'), source);
  const sourceHash = sha256(source);
  writeFileSync(path.join(skillRoot, 'receipts.json'), JSON.stringify({
    syncCommit: '1'.repeat(40),
    testedSourceCommit: '1'.repeat(40),
    sourceReceipt: sha256(`unified:source.txt:${sourceHash}`),
    files: { 'source.txt': sourceHash },
  }));
  return skillRoot;
}

function fixtureReceiptOptions(root: string, skillRoot: string) {
  return {
    repositoryRoot: root,
    skillRoot,
    requiredFiles: ['source.txt'],
    requiredNestedReceipts: [],
    requiredNestedFiles: {},
  };
}

function git(root: string, args: readonly string[]) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function gitFixture() {
  const root = temporaryRoot();
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'synthetic@example.invalid']);
  git(root, ['config', 'user.name', 'Synthetic Verifier']);
  writeFileSync(path.join(root, 'source.txt'), 'source-v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'source']);
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', '--orphan', 'unrelated']);
  git(root, ['rm', '-q', '-rf', '.']);
  writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'unrelated']);
  const unrelatedCommit = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', 'main']);
  const evidence = path.join(root, '.cursor/skills/verify-unified-operation-ordering/receipts.json');
  mkdirSync(path.dirname(evidence), { recursive: true });
  writeFileSync(evidence, '{}\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'evidence']);
  return { root, sourceCommit, unrelatedCommit };
}

describe('formal unified operation ordering', () => {
  it('exhausts authorization, revocation, retry, unknown commit, recovery, and terminal ordering', () => {
    const result = exploreOperationOrdering();
    expect(result.violation, result.path?.join(' -> ')).toBeNull();
    expect(result.reachedStates).toEqual([
      'accepted',
      'cancelled',
      'committed',
      'expired',
      'failed',
      'running',
      'unknown',
    ]);
    expect(result.witnesses).toEqual({
      acceptedBeforeRevocation: true,
      admissionDeniedAfterRevocation: true,
      admittedWriteAfterRevocation: true,
      unknownRetained: true,
      recoveryStayedUnknown: true,
      replayReturnedOriginalReceipt: true,
      unknownAfterEffectWithoutDurability: true,
      recoveryStayedUnknownAfterEffect: true,
      duplicateAcceptedWithoutEffect: true,
      duplicateRunningWithoutEffect: true,
      duplicateUnknownWithoutEffect: true,
    });
    const acceptedThenRevoked = result.witnessPaths.acceptedBeforeRevocation ?? [];
    expect(acceptedThenRevoked.indexOf('acceptCommand')).toBeLessThan(
      acceptedThenRevoked.indexOf('revokeAuthorization'),
    );
    const admittedThenWrote = result.witnessPaths.admittedWriteAfterRevocation ?? [];
    expect(admittedThenWrote.indexOf('acceptCommand')).toBeLessThan(
      admittedThenWrote.indexOf('revokeAuthorization'),
    );
    expect(admittedThenWrote.indexOf('revokeAuthorization')).toBeLessThan(
      admittedThenWrote.indexOf('writeEffect'),
    );
    expect(result.states).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThan(result.states);
  });

  it.each(CONTROLS)('detects the deliberately broken %s control', (mode, expected) => {
    const result = exploreOperationOrdering(mode);
    expect(result.violation, result.path?.join(' -> ')).toBe(expected);
    expect(result.path).not.toBeNull();
  });

  it('rejects authorization then revocation before acceptance and records the real order', () => {
    const broken = exploreOperationOrdering('accept-after-revocation');
    expect(broken.path).toEqual([
      'observeRequest',
      'checkAuthorization',
      'revokeAuthorization',
      'acceptCommand',
    ]);
    const acceptedFirst = exploreOperationOrdering().witnessPaths.acceptedBeforeRevocation ?? [];
    expect(acceptedFirst.slice(-2)).toEqual(['acceptCommand', 'revokeAuthorization']);
    expect(acceptedFirst.at(-1)).toBe('revokeAuthorization');
  });

  it('keeps a lost commit after its effect unknown until durable recovery', () => {
    const result = exploreOperationOrdering('skip-recovery-lookup');
    expect(result.violation).toBe('recovery_invented_success');
    expect(result.path).toContain('commitUnknownAfterEffect');
    expect(result.path).toContain('recoverUnknown');
    expect(result.state).toMatchObject({
      operationState: 'unknown',
      effects: 1,
      durable: 'none',
      reported: 'success',
      receiptReturned: 'invented-receipt',
    });
  });

  it('merges duplicate submissions while accepted, running, and unknown without a second effect', () => {
    const result = exploreOperationOrdering('duplicate-effect');
    expect(result.violation).toBe('duplicate_committed_effect');
    expect(result.path).toContain('duplicateSubmit');
    expect(result.path).toContain('duplicateWriteEffect');
    expect(result.state).toMatchObject({ effects: 2 });
  });

  it('fails closed when the receipt or a referenced source is missing', () => {
    const missingReceiptRoot = temporaryRoot();
    mkdirSync(path.join(missingReceiptRoot, '.cursor/skills/verify-unified-operation-ordering'), { recursive: true });
    expect(() => verifyReceiptTree({
      repositoryRoot: missingReceiptRoot,
      skillRoot: path.join(missingReceiptRoot, '.cursor/skills/verify-unified-operation-ordering'),
    })).toThrow('missing required receipt');

    const missingSourceRoot = temporaryRoot();
    const skillRoot = receiptFixture(missingSourceRoot);
    rmSync(path.join(missingSourceRoot, 'source.txt'));
    expect(() => verifyReceiptTree(fixtureReceiptOptions(missingSourceRoot, skillRoot)))
      .toThrow('missing required source file');
  });

  it('fails closed when a source drifts after its receipt was synchronized', () => {
    const root = temporaryRoot();
    const skillRoot = receiptFixture(root);
    writeFileSync(path.join(root, 'source.txt'), 'changed-source');
    expect(() => verifyReceiptTree(fixtureReceiptOptions(root, skillRoot)))
      .toThrow('source.txt changed since unified was synchronized');
  });

  it('fails closed when required source or nested receipt declarations are removed', () => {
    const root = temporaryRoot();
    const skillRoot = receiptFixture(root);
    const receiptPath = path.join(skillRoot, 'receipts.json');
    const base = JSON.parse(readFileSync(receiptPath, 'utf8'));

    writeFileSync(receiptPath, JSON.stringify({
      ...base,
      nestedReceipts: [],
    }));
    expect(() => verifyReceiptTree(fixtureReceiptOptions(root, skillRoot)))
      .not.toThrow();
    const nestedRelative = '.cursor/skills/verify-seat-administration-revocation/receipts.json';
    expect(() => verifyReceiptTree({
      ...fixtureReceiptOptions(root, skillRoot),
      requiredFiles: ['source.txt'],
      requiredNestedReceipts: [nestedRelative],
      requiredNestedFiles: { [nestedRelative]: ['nested-source.txt'] },
    })).toThrow('nested receipt manifest drifted');
    expect(() => verifyReceiptTree({
      ...fixtureReceiptOptions(root, skillRoot),
      requiredFiles: ['source.txt', 'required-but-undeclared.txt'],
    })).toThrow('required-but-undeclared.txt');

    const nestedPath = path.join(root, nestedRelative);
    mkdirSync(path.dirname(nestedPath), { recursive: true });
    writeFileSync(nestedPath, JSON.stringify({
      syncCommit: '1'.repeat(40),
      files: {},
    }));
    const withNested = {
      ...base,
      nestedReceipts: [nestedRelative],
      files: {
        ...base.files,
        [nestedRelative]: sha256(readFileSync(nestedPath)),
      },
    };
    writeFileSync(receiptPath, JSON.stringify(withNested));
    expect(() => verifyReceiptTree({
      ...fixtureReceiptOptions(root, skillRoot),
      requiredFiles: ['source.txt', nestedRelative],
      requiredNestedReceipts: [nestedRelative],
      requiredNestedFiles: { [nestedRelative]: ['nested-source.txt'] },
    })).toThrow('nested source');

    rmSync(nestedPath);
    expect(() => verifyReceiptTree({
      ...fixtureReceiptOptions(root, skillRoot),
      requiredFiles: ['source.txt', nestedRelative],
      requiredNestedReceipts: [nestedRelative],
      requiredNestedFiles: { [nestedRelative]: ['nested-source.txt'] },
    })).toThrow('missing required source file');
  });

  it('requires a readable ancestor and permits only evidence changes after the source commit', () => {
    const fixture = gitFixture();
    expect(() => verifyGitProvenance({
      repositoryRoot: fixture.root,
      receipts: { syncCommit: fixture.sourceCommit },
    })).not.toThrow();
    expect(() => verifyGitProvenance({
      repositoryRoot: fixture.root,
      receipts: { syncCommit: fixture.unrelatedCommit },
    })).toThrow('is not an ancestor');
    expect(() => verifyGitProvenance({
      repositoryRoot: fixture.root,
      receipts: { syncCommit: 'f'.repeat(40) },
    })).toThrow('not a readable commit');
    expect(() => assertEvidenceOnlyChanges([
      '.cursor/skills/verify-unified-operation-ordering/receipts.json',
      'source.txt',
    ])).toThrow('outside evidence files: source.txt');
  });

  it('validates the BASEFIX relationship and the exact 38-test command result', () => {
    const baseline = resolveBaselineDependency();
    expect(baseline.commit).toBe('1de1847bdc139fa1665ea36c51329a110460bd7b');
    expect(baseline.changedPaths).toEqual(['apps/api/tests/seat-lifecycle.integration.test.ts']);
    expect(baseline.relationship).toBe('not-ancestor');
    expect(() => resolveBaselineDependency({ commit: 'f'.repeat(40) }))
      .toThrow('BASEFIX commit is not readable');
    expect(() => assertManualIdentityResult({
      status: 1,
      stdout: '',
      stderr: 'synthetic failure',
    })).toThrow('manual identity command failed');
    expect(assertManualIdentityResult({
      status: 0,
      stdout: 'Test Files  9 passed (9)\nTests  38 passed (38)\n',
      stderr: '',
    })).toEqual({ testFiles: 9, tests: 38 });
  });
});
