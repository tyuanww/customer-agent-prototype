import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertCiGate,
  assertCiFastGate,
  assertPrGate,
  changedFiles,
  loadDependencyMap,
  matchesWriteBoundary,
  percentile,
  planLaneCommands,
  runPlanLane,
  RULE_DOCUMENTS,
  validateDependencyMap,
  verificationPlan,
} from './verification-policy.mjs';

const map = loadDependencyMap();

function ids(plan, lane) {
  return plan.checks[lane].map((check) => check.id);
}

function successfulNeeds(requiredJobs) {
  const allJobs = ['quick', 'contracts', 'database', 'electron', 'windows', 'linux'];
  const mode = requiredJobs.length === 1 ? 'docs' : requiredJobs.length === allJobs.length ? 'full' : 'focused';
  return {
    changes: {
      result: 'success',
      outputs: {
        mode,
        required_jobs: ['changes', ...requiredJobs].join(','),
        ...Object.fromEntries(allJobs.map((job) => [job, String(requiredJobs.includes(job))])),
      },
    },
    ...Object.fromEntries(allJobs.map((job) => [
      job,
      { result: requiredJobs.includes(job) ? 'success' : 'skipped' },
    ])),
  };
}

function workflowJob(workflow, job) {
  const match = workflow.match(new RegExp(`\\n  ${job}:\\n([\\s\\S]*?)(?=\\n  [A-Za-z0-9_-]+:\\n|$)`, 'u'));
  assert.ok(match, `missing workflow job ${job}`);
  return match[1];
}

test('dependency map is structurally valid and owns every declared route reference', () => {
  const loaded = validateDependencyMap(map);
  assert.equal(loaded.schemaVersion, 1);
  assert.ok(loaded.owners.length >= 9);
  assert.ok(loaded.routes.length >= 13);
  assert.ok(Object.keys(loaded.checks).length >= 21);
  assert.ok(loaded.routes.every((route) => Array.isArray(route.generatedInputs)));
  assert.ok(RULE_DOCUMENTS.has('docs/reference-engineering-workflow.md'));
});

test('docs-only changes skip runtime, database, Electron and packaging lanes', () => {
  const plan = verificationPlan([
    'README.md',
    'docs/reference-engineering-workflow.md',
    'evidence/qa/example/README.md',
  ], map);

  assert.equal(plan.mode, 'docs');
  assert.equal(plan.rules, true);
  assert.deepEqual(plan.owners, ['repository-docs']);
  assert.deepEqual(plan.requiredJobs, ['changes', 'quick']);
  assert.deepEqual(plan.jobs, {
    quick: true,
    contracts: false,
    database: false,
    electron: false,
    windows: false,
    linux: false,
    packaging: false,
  });
  assert.deepEqual(ids(plan, 'precheck'), ['policy-tests', 'documentation']);
  assert.deepEqual(ids(plan, 'quick'), []);
  assert.deepEqual(ids(plan, 'database'), []);
  assert.deepEqual(plan.fullFallbackReasons, []);
});

test('contract changes select drift checks and every known workspace consumer', () => {
  const plan = verificationPlan(['packages/contracts/src/index.ts'], map);

  assert.equal(plan.mode, 'focused');
  assert.deepEqual(plan.owners, ['contracts']);
  assert.equal(plan.jobs.contracts, true);
  assert.deepEqual(plan.requiredJobs, ['changes', 'quick', 'contracts']);
  assert.deepEqual(ids(plan, 'contracts'), [
    'contracts-intake',
    'contracts-drift',
    'contracts-tests',
    'contracts-consumer-api',
    'contracts-consumer-desktop',
  ]);
  assert.ok(plan.liveLanes.includes('contract-generation'));
});

test('SOP query changes require the real PostgreSQL consumer lane', () => {
  for (const path of ['apps/api/src/sop-query-operation.ts', 'apps/api/tests/support/sop-query-synthetic-host.ts', 'scripts/intake-synthetic/sop-query-host.ts']) {
    const plan = verificationPlan([path], map);
    assert.ok(plan.requiredJobs.includes('database'));
    assert.ok(ids(plan, 'database').includes('api-database-integration'));
    assert.ok(plan.liveLanes.includes('sop-query-http'));
    assert.ok(ids(plan, 'electron').includes('sop-query-electron'));
  }
});

test('desktop changes retain the independent SOP window regression', () => {
  for (const path of ['apps/desktop/src/main/sop-query-runtime.ts', 'apps/desktop/src/renderer/SopQueryView.tsx']) {
    const plan = verificationPlan([path], map);
    assert.ok(ids(plan, 'electron').includes('sop-query-electron'));
  }
});

test('SOP regression inputs cannot skip the PostgreSQL lane', () => {
  for (const path of ['apps/api/tests/sop-trusted-stage.integration.test.ts', 'apps/api/src/content-intake/sop-freeze.ts', 'apps/api/experiments/sop-row-deletion/consumer.ts', 'packages/content-intake/src/sop-authoring.ts', 'apps/api/package.json']) {
    const plan = verificationPlan([path], map);
    assert.ok(ids(plan, 'database').includes('api-database-integration'), path);
  }
  const plan = verificationPlan(['scripts/verification-dependencies.json'], map);
  assert.ok(ids(plan, 'electron').includes('sop-query-electron'));
});

test('database changes select generated, PG15, backup and consumer database lanes', () => {
  const plan = verificationPlan(['packages/database/src/planner.ts'], map);

  assert.equal(plan.mode, 'focused');
  assert.deepEqual(plan.owners, ['database']);
  assert.equal(plan.jobs.database, true);
  assert.deepEqual(plan.requiredJobs, ['changes', 'quick', 'database']);
  assert.deepEqual(ids(plan, 'database'), [
    'database-migrations',
    'database-unit',
    'database-pg15',
    'database-backup-pg15',
    'api-database-integration',
    'identity-database-integration',
    'api-database-e2e',
  ]);
  assert.deepEqual(plan.databaseLanes, [
    'migration-generation',
    'postgres-15',
    'backup-restore',
    'api-integration',
    'backend-e2e',
  ]);
});

test('workflow, desktop, API, query, SOP and overlay paths select their intended lanes', () => {
  const workflow = verificationPlan(['.github/workflows/ci-pr.yml'], map);
  assert.equal(workflow.mode, 'focused');
  assert.equal(workflow.jobs.quick, true);
  assert.ok(ids(workflow, 'quick').includes('workspace-check'));

  const desktop = verificationPlan(['apps/desktop/src/main/main.ts'], map);
  assert.equal(desktop.jobs.quick, true);
  assert.equal(desktop.jobs.electron, true);
  assert.ok(ids(desktop, 'quick').includes('desktop-tests'));
  assert.deepEqual(ids(desktop, 'electron'), ['overlay-electron', 'sop-query-electron']);

  const api = verificationPlan(['apps/api/src/app.ts'], map);
  assert.deepEqual(api.owners, ['api']);
  assert.ok(ids(api, 'quick').includes('api-tests'));

  const query = verificationPlan(['packages/retrieval-core/src/index.ts'], map);
  assert.equal(query.jobs.quick, true);
  assert.ok(ids(query, 'quick').includes('retrieval-core-tests'));
  assert.ok(ids(query, 'quick').includes('query-api-tests'));
  assert.ok(query.liveLanes.includes('query-content'));

  const sop = verificationPlan(['packages/content-intake/src/sop.ts'], map);
  assert.equal(sop.jobs.quick, true);
  assert.ok(ids(sop, 'quick').includes('sop-content-tests'));
  assert.ok(ids(sop, 'quick').includes('sop-api-tests'));
  assert.ok(ids(sop, 'quick').includes('sop-desktop-tests'));
  assert.ok(sop.liveLanes.includes('sop-path'));

  const overlay = verificationPlan(['apps/desktop/src/main/overlay-controller.ts'], map);
  assert.equal(overlay.jobs.electron, true);
  assert.ok(ids(overlay, 'quick').includes('overlay-unit'));
  assert.deepEqual(ids(overlay, 'electron'), ['overlay-electron', 'sop-query-electron']);
  assert.ok(overlay.liveLanes.includes('overlay-native'));
});

test('job-roster changes select both shared consumers', () => {
  const plan = verificationPlan(['packages/job-roster/src/index.ts'], map);

  assert.equal(plan.mode, 'focused');
  assert.deepEqual(plan.owners, ['job-roster']);
  assert.equal(plan.jobs.quick, true);
  assert.ok(ids(plan, 'quick').includes('api-tests'));
  assert.ok(ids(plan, 'quick').includes('desktop-tests'));
  assert.deepEqual(plan.liveLanes, ['job-roster-consumers']);
});

test('mixed changes union owners, checks, lanes and jobs', () => {
  const plan = verificationPlan([
    'docs/reference-engineering-workflow.md',
    'packages/contracts/src/index.ts',
    'packages/database/src/planner.ts',
    'apps/desktop/src/main/overlay-controller.ts',
  ], map);

  assert.equal(plan.mode, 'focused');
  assert.deepEqual(plan.owners, ['contracts', 'database', 'desktop', 'repository-docs']);
  assert.equal(plan.jobs.contracts, true);
  assert.equal(plan.jobs.database, true);
  assert.equal(plan.jobs.electron, true);
  assert.equal(plan.jobs.packaging, false);
  assert.ok(plan.requiredJobs.includes('contracts'));
  assert.ok(plan.requiredJobs.includes('database'));
  assert.ok(plan.requiredJobs.includes('electron'));
  assert.ok(plan.fullFallbackReasons.length === 0);
});

test('packaging inputs select unsigned Windows and Linux package checks under the desktop owner', () => {
  const packagingFiles = [
    'apps/desktop/package.json',
    'apps/desktop/build/entitlements.mac.plist',
    'apps/desktop/scripts/package-windows.mjs',
    'apps/desktop/scripts/verify-linux-package.mjs',
    'apps/desktop/scripts/after-pack-macos.mjs',
    'apps/desktop/scripts/finalize-mac-package.mjs',
    'apps/desktop/scripts/assert-main-bundle.mjs',
    'apps/desktop/scripts/generate-app-icons.mjs',
    'apps/desktop/scripts/mac-package-paths.mjs',
    'apps/desktop/scripts/node-system-ca.mjs',
    'apps/desktop/scripts/verify-mac-release-env.mjs',
    'apps/desktop/scripts/write-build-identity.mjs',
  ];

  for (const file of packagingFiles) {
    const plan = verificationPlan([file], map);
    assert.deepEqual(plan.owners, ['desktop'], file);
    assert.equal(plan.jobs.packaging, true, file);
    assert.equal(plan.jobs.windows, true, file);
    assert.equal(plan.jobs.linux, true, file);
    assert.deepEqual(ids(plan, 'windows'), ['windows-package', 'windows-owned-electron'], file);
    assert.deepEqual(ids(plan, 'linux'), ['linux-package'], file);
    assert.ok(plan.requiredJobs.includes('windows'), file);
    assert.ok(plan.requiredJobs.includes('linux'), file);
    assert.deepEqual(plan.packagingLanes, ['windows-local-unsigned', 'linux-local-unsigned'], file);
  }

  assert.equal(map.owners.filter((owner) => owner.id === 'desktop').length, 1);
});

test('Windows process cleanup follows packaging through the map-owned Windows lane', () => {
  const commands = [
    ['pnpm', 'package:win'],
    ['pnpm', '--filter', '@customer-agent/desktop', 'exec', 'playwright', 'test', 'tests/e2e/owned-electron-windows.spec.ts'],
  ];
  for (const file of ['apps/desktop/tests/e2e/owned-electron-windows.spec.ts', 'apps/desktop/tests/support/owned-electron.ts']) {
    const plan = verificationPlan([file], map);
    assert.equal(plan.jobs.windows, true, file);
    assert.ok(plan.requiredJobs.includes('windows'), file);
    assert.deepEqual(planLaneCommands(plan, 'windows'), commands, file);
  }
  assert.deepEqual(planLaneCommands(verificationPlan([], map), 'windows'), commands);
  const mainWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const windows = workflowJob(mainWorkflow, 'windows-feasibility');
  assert.match(windows, /verification-policy\.mjs run --base HEAD --head HEAD --lane windows/u);
  assert.doesNotMatch(windows, /run: pnpm package:win/u);
});

test('every source-code owner selects one deduplicated typecheck quick check', () => {
  const sourceFiles = [
    'packages/contracts/src/index.ts',
    'packages/database/src/planner.ts',
    'apps/api/src/app.ts',
    'packages/retrieval-core/src/index.ts',
    'packages/content-intake/src/sop.ts',
    'apps/desktop/src/main/main.ts',
    'packages/job-roster/src/index.ts',
  ];

  for (const file of sourceFiles) {
    const plan = verificationPlan([file], map);
    assert.deepEqual(ids(plan, 'quick').filter((id) => id === 'typecheck'), ['typecheck'], file);
  }

  const mixed = verificationPlan(sourceFiles, map);
  assert.equal(ids(mixed, 'quick').filter((id) => id === 'typecheck').length, 1);
  assert.equal(planLaneCommands(mixed, 'quick').filter((command) => JSON.stringify(command) === JSON.stringify(['pnpm', 'typecheck'])).length, 1);
});

test('every source-code route restores the architecture boundary check', () => {
  const codeRoutes = map.routes.filter((route) => route.id !== 'repository-documents');
  assert.ok(codeRoutes.length > 0);
  for (const route of codeRoutes) {
    assert.ok(route.checks.quick?.includes('architecture'), `${route.id} must run check:architecture`);
  }
  assert.deepEqual(map.checks.architecture, {
    job: 'quick',
    command: [['pnpm', 'check:architecture']],
  });

  const full = verificationPlan(['tools/unknown.txt'], map);
  assert.ok(ids(full, 'quick').includes('architecture'));
});

test('unknown, invalid, ambiguous and stale-generated paths fail closed to the full gate', () => {
  const unknown = verificationPlan(['tools/new-secret-policy.txt'], map);
  assert.equal(unknown.mode, 'full');
  assert.deepEqual(unknown.fullFallbackReasons, [
    { code: 'unknown-path', detail: 'tools/new-secret-policy.txt' },
  ]);
  assert.equal(unknown.jobs.packaging, true);
  assert.deepEqual(unknown.requiredJobs, ['changes', 'quick', 'contracts', 'database', 'electron', 'windows', 'linux']);

  const invalidPath = verificationPlan(['docs/../src/a.ts'], map);
  assert.equal(invalidPath.mode, 'full');
  assert.equal(invalidPath.fullFallbackReasons[0].code, 'invalid-change-path');

  const ambiguousMap = structuredClone(map);
  ambiguousMap.owners.push({
    id: 'competing-api-owner',
    paths: ['apps/api/src/app.ts'],
    description: 'Synthetic ambiguity for the policy test.',
  });
  const ambiguous = verificationPlan(['apps/api/src/app.ts'], ambiguousMap);
  assert.equal(ambiguous.mode, 'full');
  assert.equal(ambiguous.fullFallbackReasons[0].code, 'ambiguous-path');

  const stale = verificationPlan([
    'contracts/upstream/customer-agent/example/openapi.v1.yaml',
  ], map);
  assert.equal(stale.mode, 'full');
  assert.ok(stale.fullFallbackReasons.some((reason) => reason.code === 'stale-contract-generated'));
  assert.ok(stale.fullFallbackReasons.some((reason) => reason.code === 'stale-database-generated'));

  const generatedWithoutInput = verificationPlan([
    'packages/contracts/src/generated/openapi.generated.ts',
  ], map);
  assert.equal(generatedWithoutInput.mode, 'full');
  assert.deepEqual(generatedWithoutInput.fullFallbackReasons, [
    {
      code: 'stale-generated',
      detail: 'packages/contracts/src/generated/openapi.generated.ts',
    },
  ]);

  const generatedWithInput = verificationPlan([
    'contracts/upstream/customer-agent/example/openapi.v1.yaml',
    'packages/contracts/src/generated/openapi.generated.ts',
  ], map);
  assert.equal(generatedWithInput.mode, 'full');
  assert.ok(generatedWithInput.fullFallbackReasons.some((reason) => reason.code === 'stale-contract-generated'));
  assert.ok(!generatedWithInput.fullFallbackReasons.some((reason) => reason.code === 'stale-generated'));
});

test('malformed dependency maps and missing references cannot throw or select a narrow gate', () => {
  const malformed = verificationPlan(['docs/readme.md'], { schemaVersion: 1 });
  assert.equal(malformed.mode, 'full');
  assert.equal(malformed.fullFallbackReasons[0].code, 'dependency-map-invalid');

  const missingReference = structuredClone(map);
  missingReference.routes.push({
    id: 'broken-route',
    paths: ['docs/**'],
    checks: { quick: ['does-not-exist'] },
    liveLanes: [],
    databaseLanes: [],
    packagingLanes: [],
  });
  const missing = verificationPlan(['docs/readme.md'], missingReference);
  assert.equal(missing.mode, 'full');
  assert.equal(missing.fullFallbackReasons[0].code, 'dependency-map-invalid');
  assert.match(missing.fullFallbackReasons[0].detail, /missing check reference/u);

  const missingRoute = structuredClone(map);
  missingRoute.routes = missingRoute.routes.filter((route) => route.id !== 'api-sources');
  const noRoute = verificationPlan(['apps/api/src/app.ts'], missingRoute);
  assert.equal(noRoute.mode, 'full');
  assert.deepEqual(noRoute.fullFallbackReasons, [
    { code: 'missing-route', detail: 'apps/api/src/app.ts' },
  ]);

  const wrongLane = structuredClone(map);
  wrongLane.routes.find((route) => route.id === 'api-sources').checks.quick.push('database-pg15');
  const invalidLane = verificationPlan(['apps/api/src/app.ts'], wrongLane);
  assert.equal(invalidLane.mode, 'full');
  assert.equal(invalidLane.fullFallbackReasons[0].code, 'dependency-map-invalid');
  assert.match(invalidLane.fullFallbackReasons[0].detail, /database-pg15.*quick/u);

  const wrongOwner = structuredClone(map);
  wrongOwner.routes.find((route) => route.id === 'api-sources').owner = 'desktop';
  const invalidOwner = verificationPlan(['apps/api/src/app.ts'], wrongOwner);
  assert.equal(invalidOwner.mode, 'full');
  assert.equal(invalidOwner.fullFallbackReasons[0].code, 'dependency-map-invalid');
  assert.match(invalidOwner.fullFallbackReasons[0].detail, /outside owner desktop/u);
});

test('full fallback materializes every map-owned check', () => {
  const full = verificationPlan(['tools/unknown.txt'], map);

  assert.equal(full.mode, 'full');
  assert.deepEqual(full.requiredJobs, ['changes', 'quick', 'contracts', 'database', 'electron', 'windows', 'linux']);
  assert.ok(full.databaseLanes.includes('postgres-15'));
  assert.ok(full.liveLanes.includes('overlay-native'));
  for (const [id, check] of Object.entries(map.checks)) {
    assert.ok(ids(full, check.job).includes(id), `${id} must be present in ${check.job}`);
  }
});

test('plan commands are lane-scoped and deduplicated', () => {
  const docs = verificationPlan(['docs/reference-engineering-workflow.md'], map);
  assert.deepEqual(planLaneCommands(docs, 'quick'), []);

  const mixed = verificationPlan([
    'apps/desktop/src/main/main.ts',
    'packages/job-roster/src/index.ts',
    'packages/contracts/src/index.ts',
    'packages/database/src/planner.ts',
  ], map);
  const quick = planLaneCommands(mixed, 'quick');
  assert.equal(quick.filter((command) => JSON.stringify(command) === JSON.stringify(['pnpm', '--filter', '@customer-agent/desktop', 'test'])).length, 1);
  assert.ok(quick.some((command) => JSON.stringify(command) === JSON.stringify(['pnpm', 'lint'])));
  assert.deepEqual(planLaneCommands(mixed, 'electron'), [
    ['pnpm', 'test:e2e:float'],
    ['pnpm', '--filter', '@customer-agent/desktop', 'build'],
    ['pnpm', '--filter', '@customer-agent/desktop', 'exec', 'playwright', 'test', 'tests/e2e/sop-query.spec.ts'],
  ]);
  assert.throws(() => planLaneCommands(mixed, 'unknown'), /PLAN_LANE_INVALID/u);
});

test('real git diffs include both sides of renames and deletions', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-routing-'));
  const git = (...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  try {
    mkdirSync(path.join(cwd, 'docs'));
    mkdirSync(path.join(cwd, 'apps', 'desktop', 'src'), { recursive: true });
    writeFileSync(path.join(cwd, 'docs', 'old.md'), '# old\n');
    writeFileSync(path.join(cwd, 'docs', 'deleted.md'), '# delete\n');
    git('init');
    git('add', '.');
    git(
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'core.hooksPath=/dev/null',
      'commit', '-m', 'synthetic fixture',
    );
    const base = git('rev-parse', 'HEAD');

    git('mv', 'docs/old.md', 'docs/moved.md');
    rmSync(path.join(cwd, 'docs', 'deleted.md'));
    writeFileSync(path.join(cwd, 'apps', 'desktop', 'src', 'new.ts'), 'export const value = 1;\n');
    const files = changedFiles(base, undefined, cwd);

    assert.ok(files.includes('docs/moved.md'));
    assert.ok(files.includes('docs/deleted.md'));
    assert.ok(files.includes('apps/desktop/src/new.ts'));
    assert.equal(verificationPlan(files, map).mode, 'focused');
    assert.equal(
      verificationPlan(['docs/deleted.md', 'docs/moved.md'], map).mode,
      'docs',
    );
    assert.throws(() => changedFiles('--unsafe', undefined, cwd), /REF_INVALID/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('review diffs use the merge base instead of unrelated base-branch movement', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-review-range-'));
  const git = (...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  try {
    mkdirSync(path.join(cwd, 'docs'));
    mkdirSync(path.join(cwd, 'apps', 'api'), { recursive: true });
    writeFileSync(path.join(cwd, 'docs', 'base.md'), '# base\n');
    git('init', '-b', 'main');
    git('add', '.');
    git(
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'core.hooksPath=/dev/null',
      'commit', '-m', 'synthetic fixture',
    );

    git('switch', '-c', 'feature');
    writeFileSync(path.join(cwd, 'docs', 'feature.md'), '# feature\n');
    git('add', '.');
    git(
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'core.hooksPath=/dev/null',
      'commit', '-m', 'feature change',
    );
    const feature = git('rev-parse', 'HEAD');

    git('switch', 'main');
    writeFileSync(path.join(cwd, 'apps', 'api', 'main.ts'), 'export const main = true;\n');
    git('add', '.');
    git(
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'core.hooksPath=/dev/null',
      'commit', '-m', 'advance main',
    );

    assert.deepEqual(changedFiles(git('rev-parse', 'main'), feature, cwd), ['docs/feature.md']);
    assert.deepEqual(changedFiles('main', 'feature', cwd), ['docs/feature.md']);
    assert.throws(() => changedFiles('--unsafe', undefined, cwd), /REF_INVALID/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('local worktree diffs use the merge base and keep every changed side', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-local-range-'));
  const git = (...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  try {
    mkdirSync(path.join(cwd, 'docs'));
    mkdirSync(path.join(cwd, 'apps', 'desktop', 'src'), { recursive: true });
    writeFileSync(path.join(cwd, 'docs', 'old.md'), '# old\n');
    writeFileSync(path.join(cwd, 'docs', 'deleted.md'), '# delete\n');
    writeFileSync(path.join(cwd, 'docs', 'tracked.md'), '# tracked\n');
    git('init', '-b', 'main');
    git('add', '.');
    git(
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'core.hooksPath=/dev/null',
      'commit', '-m', 'synthetic fixture',
    );

    git('switch', '-c', 'feature');
    git('switch', 'main');
    writeFileSync(path.join(cwd, 'apps', 'desktop', 'src', 'main.ts'), 'export const main = true;\n');
    git('add', '.');
    git(
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'core.hooksPath=/dev/null',
      'commit', '-m', 'unrelated main movement',
    );
    const main = git('rev-parse', 'main');

    git('switch', 'feature');
    git('mv', 'docs/old.md', 'docs/moved.md');
    rmSync(path.join(cwd, 'docs', 'deleted.md'));
    writeFileSync(path.join(cwd, 'docs', 'tracked.md'), '# tracked local change\n');
    mkdirSync(path.join(cwd, 'apps', 'desktop', 'src'), { recursive: true });
    writeFileSync(path.join(cwd, 'apps', 'desktop', 'src', 'local.ts'), 'export const local = true;\n');
    const files = changedFiles(main, undefined, cwd);

    assert.deepEqual(files, [
      'apps/desktop/src/local.ts',
      'docs/deleted.md',
      'docs/moved.md',
      'docs/old.md',
      'docs/tracked.md',
    ]);
    assert.ok(!files.includes('apps/desktop/src/main.ts'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('PR and main aggregate gates reject missing, skipped, cancelled or failed required jobs', () => {
  const docsNeeds = successfulNeeds(['quick']);
  docsNeeds.changes.outputs.mode = 'docs';
  assert.doesNotThrow(() => assertPrGate(docsNeeds));
  assert.doesNotThrow(() => assertCiFastGate(docsNeeds));

  const contractNeeds = successfulNeeds(['quick', 'contracts']);
  assert.doesNotThrow(() => assertPrGate(contractNeeds));
  assert.throws(() => assertCiFastGate(contractNeeds), /CI_FAST_PLAN_REQUIRED_JOB_LIST_MISMATCH/u);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(
      () => assertPrGate({
        ...contractNeeds,
        contracts: { result },
      }),
      /PR_REQUIRED_JOB_NOT_SUCCESS: contracts/u,
    );
  }
  assert.throws(
    () => assertPrGate({
      ...contractNeeds,
      changes: { result: 'success', outputs: { ...contractNeeds.changes.outputs, required_jobs: '' } },
    }),
    /PR_REQUIRED_JOB_LIST_MISSING/u,
  );

  const fullNeeds = successfulNeeds(['quick', 'contracts', 'database', 'electron', 'windows', 'linux']);
  assert.doesNotThrow(() => assertPrGate(fullNeeds));
  assert.throws(() => assertCiFastGate(fullNeeds), /CI_FAST_PLAN_REQUIRED_JOB_LIST_MISMATCH/u);
  assert.throws(
    () => assertPrGate({ ...fullNeeds, database: { result: 'skipped' } }),
    /PR_REQUIRED_JOB_NOT_SUCCESS: database/u,
  );
  assert.throws(
    () => assertPrGate({
      ...fullNeeds,
      changes: {
        result: 'success',
        outputs: { ...fullNeeds.changes.outputs, required_jobs: 'changes,quick' },
      },
    }),
    /PR_REQUIRED_JOB_LIST_MISMATCH/u,
  );

  const mainOk = {
    changes: { result: 'success', outputs: { mode: 'full' } },
    quality: { result: 'success' },
    'postgres-15': { result: 'success' },
    'windows-feasibility': { result: 'success' },
    'linux-feasibility': { result: 'success' },
  };
  assert.doesNotThrow(() => assertCiGate(mainOk));
  for (const key of Object.keys(mainOk).filter((key) => key !== 'changes')) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      assert.throws(() => assertCiGate({ ...mainOk, [key]: { result } }), /NOT_SUCCESS/u);
    }
  }
  assert.throws(
    () => assertCiGate({ ...mainOk, changes: { result: 'success', outputs: { mode: 'focused' } } }),
    /CI_FULL_PLAN_MISSING/u,
  );
});

test('PR gate treats required_jobs as an exact assertion of the plan outputs', () => {
  const focused = successfulNeeds(['quick', 'contracts']);
  focused.changes.outputs.mode = 'focused';
  focused.changes.outputs.required_jobs = 'changes,quick,contracts';
  focused.changes.outputs.quick = 'true';
  focused.changes.outputs.contracts = 'true';
  focused.changes.outputs.database = 'false';
  focused.changes.outputs.electron = 'false';
  focused.changes.outputs.windows = 'false';
  focused.changes.outputs.linux = 'false';
  assert.doesNotThrow(() => assertPrGate(focused));

  for (const requiredJobs of [
    'changes,quick,evil',
    'quick,contracts',
    'changes,quick',
    'changes,quick,database',
    'changes,quick,contracts,quick',
    'changes,,quick,contracts',
    'changes,contracts,quick',
  ]) {
    assert.throws(
      () => assertPrGate({ ...focused, changes: { ...focused.changes, outputs: { ...focused.changes.outputs, required_jobs: requiredJobs } } }),
      /PR_REQUIRED_JOB_LIST_(?:UNKNOWN|MISMATCH|MALFORMED|DUPLICATE)/u,
      requiredJobs,
    );
  }

  const docs = successfulNeeds(['quick']);
  docs.changes.outputs.mode = 'docs';
  docs.changes.outputs.required_jobs = 'changes,quick,contracts';
  docs.changes.outputs.quick = 'true';
  docs.changes.outputs.contracts = 'false';
  docs.changes.outputs.database = 'false';
  docs.changes.outputs.electron = 'false';
  docs.changes.outputs.windows = 'false';
  docs.changes.outputs.linux = 'false';
  assert.throws(() => assertPrGate(docs), /PR_REQUIRED_JOB_LIST_MISMATCH/u);

  const full = successfulNeeds(['quick', 'contracts', 'database', 'electron', 'windows', 'linux']);
  full.changes.outputs.mode = 'full';
  for (const job of ['quick', 'contracts', 'database', 'electron', 'windows', 'linux']) full.changes.outputs[job] = 'true';
  for (const job of ['quick', 'contracts', 'database', 'electron', 'windows', 'linux']) {
    const missing = structuredClone(full);
    missing.changes.outputs.required_jobs = ['changes', ...['quick', 'contracts', 'database', 'electron', 'windows', 'linux'].filter((candidate) => candidate !== job)].join(',');
    assert.throws(() => assertPrGate(missing), /PR_REQUIRED_JOB_LIST_MISMATCH/u, job);
  }

  for (const job of ['quick', 'contracts', 'database', 'electron', 'windows', 'linux']) {
    const malformed = structuredClone(focused);
    malformed.changes.outputs[job] = 'maybe';
    assert.throws(() => assertPrGate(malformed), /PR_PLAN_JOB_OUTPUT_INVALID/u, job);
    delete malformed.changes.outputs[job];
    assert.throws(() => assertPrGate(malformed), /PR_PLAN_JOB_OUTPUT_INVALID/u, job);
  }
});

test('dependency map commands are structured argv and reject shell-only or unsupported entries', () => {
  assert.ok(Object.values(map.checks).every((check) => Array.isArray(check.command)));
  assert.throws(
    () => validateDependencyMap({ ...map, checks: { ...map.checks, bad: { job: 'quick', command: 'node --test' } } }),
    /command must be structured argv/u,
  );
  assert.throws(
    () => validateDependencyMap({ ...map, checks: { ...map.checks, bad: { job: 'quick', command: ['sh', '-c', 'echo unsafe'] } } }),
    /unsupported executable/u,
  );
  assert.throws(
    () => validateDependencyMap({ ...map, checks: { ...map.checks, bad: { job: 'quick', command: ['node', ''] } } }),
    /argv argument/u,
  );
  for (const command of [
    [],
    [[], []],
    [['node'], '--test'],
  ]) {
    assert.throws(
      () => validateDependencyMap({ ...map, checks: { ...map.checks, bad: { job: 'quick', command } } }),
      /structured argv/u,
    );
  }
});

test('argv runner passes shell metacharacters literally and cannot create a second command', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-argv-'));
  const script = path.join(cwd, 'write-argv.mjs');
  const output = path.join(cwd, 'argv.json');
  const marker = path.join(cwd, 'marker');
  writeFileSync(script, "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n");
  try {
    for (const argument of ['semi; touch ' + marker, '$(touch ' + marker + ')', 'line\n touch ' + marker, '> ' + marker]) {
      rmSync(output, { force: true });
      runPlanLane({ mode: 'focused', checks: { quick: [{ id: 'synthetic', command: ['node', script, output, argument] }] } }, 'quick', false);
      assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), [argument]);
      assert.equal(existsSync(marker), false);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Windows pnpm resolution never assumes a .cmd shim is spawnable', async () => {
  const { resolvePlanCommand } = await import('./verification-policy.mjs');
  assert.equal(typeof resolvePlanCommand, 'function');

  const pnpmHome = 'C:\\setup\\node_modules\\.bin';
  const pnpmExe = 'C:\\setup\\node_modules\\.bin\\pnpm.exe';
  const pnpmScript = 'C:\\setup\\node_modules\\pnpm\\bin\\pnpm.mjs';
  const nodeExecutable = 'C:\\node\\node.exe';

  assert.deepEqual(resolvePlanCommand(['pnpm', 'lint'], {
    platform: 'win32',
    env: { PNPM_HOME: pnpmHome, PATH: '' },
    fileExists: (candidate) => candidate === pnpmExe,
    nodeExecutable,
  }), [pnpmExe, 'lint']);

  assert.deepEqual(resolvePlanCommand(['pnpm', '--filter', '@customer-agent/desktop', 'test'], {
    platform: 'win32',
    env: { PNPM_HOME: pnpmHome, PATH: '' },
    fileExists: (candidate) => candidate === pnpmScript,
    nodeExecutable,
  }), [nodeExecutable, pnpmScript, '--filter', '@customer-agent/desktop', 'test']);

  assert.throws(
    () => resolvePlanCommand(['pnpm', 'lint'], {
      platform: 'win32',
      env: { PNPM_HOME: pnpmHome, PATH: pnpmHome },
      fileExists: (candidate) => candidate === 'C:\\setup\\node_modules\\.bin\\pnpm.cmd',
      nodeExecutable,
    }),
    /PNPM_WINDOWS_EXECUTABLE_NOT_FOUND/u,
  );

  assert.deepEqual(resolvePlanCommand(['pnpm', 'lint'], { platform: 'linux' }), ['pnpm', 'lint']);
});

test('write-boundary matching rejects files outside the owner declaration', () => {
  assert.equal(matchesWriteBoundary(
    ['scripts/verification-policy.mjs', 'scripts/verification-dependencies.json', 'package.json'],
    ['scripts/**', 'package.json'],
  ), true);
  assert.equal(matchesWriteBoundary(
    ['scripts/verification-policy.mjs', 'apps/api/src/app.ts'],
    ['scripts/**', 'package.json'],
  ), false);
  assert.throws(
    () => matchesWriteBoundary(['docs/../src/a.ts'], ['docs/**']),
    /WRITE_PATH_INVALID/u,
  );
});

test('percentile helper is deterministic for benchmark evidence', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);
});

test('workflow and package gates consume the dependency-map runner', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['verify:fast', 'verify:changed', 'verify:full', 'verify:release']) {
    assert.equal(typeof packageJson.scripts[name], 'string', `${name} must exist`);
  }
  assert.match(packageJson.scripts['verify:changed'], /verification-policy\.mjs run/u);
  assert.deepEqual(map.checks['workflow-tests'].command, [
    ['pnpm', '--filter', '@customer-agent/database', 'build'],
    ['pnpm', 'test:workflow'],
  ]);

  const prWorkflow = readFileSync(new URL('../.github/workflows/ci-pr.yml', import.meta.url), 'utf8');
  for (const lane of ['quick', 'contracts', 'database', 'electron', 'windows', 'linux']) {
    assert.match(prWorkflow, new RegExp(`verification-policy\\.mjs run[^\\n]*--lane ${lane}`, 'u'));
  }
  assert.doesNotMatch(prWorkflow, /run: pnpm test:api/u);
  assert.doesNotMatch(prWorkflow, /run: pnpm test:e2e:float/u);
  assert.doesNotMatch(prWorkflow, /run: pnpm (?:package:win|package:linux)/u);
});

test('PR lanes fetch full history and precheck runs through the shared map runner', () => {
  const prWorkflow = readFileSync(new URL('../.github/workflows/ci-pr.yml', import.meta.url), 'utf8');
  for (const lane of ['changes', 'quick', 'contracts', 'database', 'electron', 'windows', 'linux']) {
    assert.match(workflowJob(prWorkflow, lane), /fetch-depth:\s*0/u, `${lane} must fetch full history`);
  }

  const changes = workflowJob(prWorkflow, 'changes');
  assert.match(
    changes,
    /verification-policy\.mjs run[^\n]*--lane precheck/u,
    'PR precheck must execute the dependency-map precheck lane',
  );
  assert.doesNotMatch(changes, /run: node --test scripts\/verification-policy\.test\.mjs/u);
  assert.doesNotMatch(changes, /run: node scripts\/check-documentation\.mjs/u);
});

test('main CI continues to hardcode the authoritative full mode', () => {
  const mainWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const changes = workflowJob(mainWorkflow, 'changes');
  assert.match(changes, /echo "mode=full"/u);
  assert.doesNotMatch(changes, /verification-policy\.mjs plan/u);
});

test('unified safety checks reach root tests, PR plans and main CI through registered scripts', () => {
  const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const scripts = rootPackage.scripts;
  assert.equal(scripts['test:sop-unified'], 'node scripts/customer-agent-contract-set.mjs verify --profile=sopUnified && node scripts/customer-agent-contract-set.mjs verify --profile=sopUnifiedCorrected && node --test scripts/sop-unified-contract-intake.test.mjs scripts/sop-unified-corrected-contract.test.mjs');
  assert.ok(scripts.test.includes('pnpm test:built'));
  assert.ok(scripts['test:built'].includes('pnpm test:workflow'));
  assert.ok(scripts['test:workflow'].includes('pnpm test:sop-unified'));
  assert.ok(scripts['test:sop-unified'].includes('scripts/sop-unified-corrected-contract.test.mjs'));
  assert.ok(scripts['test:workflow'].includes('scripts/readiness-contract-intake.test.mjs'));
  assert.ok(scripts.check.includes('pnpm test:sop-unified'));
  assert.ok(scripts['test:db:integration'].includes('pnpm test:sop-unified:pg15'));
  assert.ok(scripts['test:sop-unified:pg15'].includes('node --test scripts/sop-unified-storage.pg15.test.mjs'));
  for (const changed of ['package.json', 'scripts/sop-unified-contract.mjs', 'scripts/sop-unified-contract-intake.test.mjs']) {
    const plan = verificationPlan([changed], map);
    assert.ok(planLaneCommands(plan, 'quick').some(argv => argv.join(' ') === 'pnpm test:workflow'));
  }
  const full = verificationPlan(['scripts/sop-unified-storage.pg15.test.mjs'], map);
  assert.ok(planLaneCommands(full, 'database').some(argv => argv.join(' ') === 'pnpm test:db:integration'));
  const mainWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(mainWorkflow, /run: pnpm check\n/);
  assert.match(mainWorkflow, /run: pnpm test:db:integration\n/);
  const prWorkflow = readFileSync(new URL('../.github/workflows/ci-pr.yml', import.meta.url), 'utf8');
  assert.match(workflowJob(prWorkflow, 'quick'), /verification-policy\.mjs run[^\n]*--lane quick/);
  assert.match(workflowJob(prWorkflow, 'database'), /verification-policy\.mjs run[^\n]*--lane database/);
});
