import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertCiGate, changedFiles, verificationPlan } from './verification-policy.mjs';

test('only known documentation paths skip runtime lanes; rules retain semantic checks', () => {
  assert.deepEqual(verificationPlan(['README.md','docs/plans/example.md']), { mode: 'docs', rules: false });
  assert.deepEqual(verificationPlan(['AGENTS.md','docs/how-to-verify-desktop.md']), { mode: 'docs', rules: true });
  for (const file of ['apps/desktop/src/main/main.ts','apps/api/README.md','packages/contracts/src/index.ts','pnpm-lock.yaml','.github/workflows/ci.yml','scripts/check-documentation.mjs','unknown.md','docs/tool.mjs','docs/../src/a.md']) {
    assert.equal(verificationPlan([file]).mode, 'full', file);
  }
  assert.equal(verificationPlan([]).mode, 'full');
});

test('gate refuses failure, cancellation, skip and missing classifier output', () => {
  const ok = Object.fromEntries(['changes','quality','postgres-15','windows-feasibility'].map((key) => [key, { result: 'success' }]));
  ok.changes.outputs = { mode: 'docs' };
  assertCiGate(ok);
  for (const key of Object.keys(ok)) {
    for (const result of ['failure','cancelled','skipped',undefined]) assert.throws(() => assertCiGate({ ...ok, [key]: { result } }), /NOT_SUCCESS/u);
  }
  assert.throws(() => assertCiGate({ ...ok, changes: { result: 'success' } }), /PLAN_MISSING/u);
});

test('real git diff includes old code path of rename, deletion and new local files', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-routing-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  try {
    git('init'); mkdirSync(path.join(cwd,'src')); mkdirSync(path.join(cwd,'docs'));
    writeFileSync(path.join(cwd,'src/code.ts'),'export const x = 1;\n');
    git('add','src/code.ts'); git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','-c','core.hooksPath=/dev/null','commit','-m','synthetic fixture');
    const base = git('rev-parse','HEAD');
    git('mv','src/code.ts','docs/moved.md');
    assert.equal(verificationPlan(changedFiles(base, undefined, cwd)).mode,'full');
    git('reset','--hard',base); rmSync(path.join(cwd,'src/code.ts'));
    assert.ok(changedFiles(base, undefined, cwd).includes('src/code.ts'));
    writeFileSync(path.join(cwd,'new-script.mjs'),'');
    assert.ok(changedFiles(base, undefined, cwd).includes('new-script.mjs'));
    assert.throws(() => changedFiles('--unsafe',undefined,cwd),/REF_INVALID/u);
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});
