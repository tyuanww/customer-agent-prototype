import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyMapPath = path.join(root, 'scripts', 'verification-dependencies.json');
export const RULE_DOCUMENTS = new Set(['AGENTS.md', 'CONTRIBUTING.md', 'docs/reference-engineering-workflow.md', 'docs/reference-document-lifecycle.md', 'docs/how-to-verify-desktop.md']);
export const JOB_ORDER = ['quick', 'contracts', 'database', 'electron', 'windows', 'linux'];
export const CHECK_LANES = ['precheck', ...JOB_ORDER, 'packaging'];
const RUN_LANES = ['precheck', ...JOB_ORDER];
const SUPPORTED_EXECUTABLES = new Set(['node', 'pnpm']);

function reason(code, detail) { return { code, detail }; }

function isPathSafe(value, errorCode = 'INVALID_CHANGE_PATH') {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) throw new Error(`${errorCode}: ${String(value)}`);
  const parts = value.split('/');
  if (parts.includes('..') || parts.includes('.')) throw new Error(`${errorCode}: ${value}`);
  return value;
}

function globToRegExp(pattern) {
  const segments = pattern.split('/');
  let source = '^';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === '**') {
      if (index > 0 && segments[index - 1] !== '**') source += '/';
      source += index < segments.length - 1 ? '(?:[^/]+/)*' : '.*';
      continue;
    }
    if (index > 0 && segments[index - 1] !== '**') source += '/';
    for (const character of segment) {
      if (character === '*') source += '[^/]*';
      else if (character === '?') source += '[^/]';
      else source += /[|\\{}()[\]^$+?.]/u.test(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`${source}$`, 'u');
}

const matcherCache = new Map();
function matchesPattern(file, pattern) {
  if (!matcherCache.has(pattern)) matcherCache.set(pattern, globToRegExp(pattern));
  return matcherCache.get(pattern).test(file);
}

export function loadDependencyMap() { return JSON.parse(readFileSync(dependencyMapPath, 'utf8')); }

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) throw new Error(`${label} must be a string array`);
}

function normalizeCommandSequence(command, label) {
  if (!Array.isArray(command) || command.length === 0) throw new Error(`${label} command must be structured argv`);
  if (command.every((argument) => typeof argument === 'string')) return [command];
  if (!command.every((argv) => Array.isArray(argv) && argv.length > 0)) throw new Error(`${label} command must be structured argv`);
  return command;
}

function assertCommandSequence(command, label) {
  const sequence = normalizeCommandSequence(command, label);
  for (const argv of sequence) {
    if (argv.some((argument) => typeof argument !== 'string' || argument.length === 0)) throw new Error(`${label} argv argument must be a non-empty string`);
    if (!SUPPORTED_EXECUTABLES.has(argv[0])) throw new Error(`${label} unsupported executable: ${argv[0]}`);
  }
  return sequence;
}

function windowsPath(env) {
  return [env.PATH, env.Path, env.path].find((value) => typeof value === 'string' && value.length > 0) ?? '';
}

export function resolvePlanCommand(argv, {
  platform = process.platform,
  env = process.env,
  fileExists = existsSync,
  nodeExecutable = process.execPath,
} = {}) {
  const [executable, ...args] = argv;
  if (platform !== 'win32' || executable !== 'pnpm') return argv;

  // Windows cannot spawn the .cmd shim with shell:false. Use a real pnpm.exe or
  // invoke pnpm's JavaScript entrypoint through the current Node executable.
  const candidates = [];
  if (typeof env.PNPM_HOME === 'string' && path.win32.isAbsolute(env.PNPM_HOME)) {
    candidates.push(path.win32.join(env.PNPM_HOME, 'pnpm.exe'));
    candidates.push(path.win32.resolve(env.PNPM_HOME, '..', 'pnpm', 'bin', 'pnpm.mjs'));
  }
  for (const directory of windowsPath(env).split(path.win32.delimiter)) {
    if (path.win32.isAbsolute(directory)) candidates.push(path.win32.join(directory, 'pnpm.exe'));
  }

  const resolved = [...new Set(candidates)].find((candidate) => fileExists(candidate));
  if (!resolved) {
    throw new Error('PNPM_WINDOWS_EXECUTABLE_NOT_FOUND: expose pnpm.exe or the pnpm script through PNPM_HOME/PATH');
  }
  return resolved.endsWith('.mjs') ? [nodeExecutable, resolved, ...args] : [resolved, ...args];
}

function assertPathPatterns(value, label) {
  assertStringArray(value, label);
  for (const pattern of value) isPathSafe(pattern, `${label.toUpperCase()}_INVALID`);
}

function patternCovers(ownerPattern, routePattern) {
  if (ownerPattern === routePattern) return true;
  return ownerPattern.endsWith('/**') && routePattern.startsWith(`${ownerPattern.slice(0, -3)}/`);
}

export function validateDependencyMap(map) {
  if (!map || map.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  assertPathPatterns(map.writeBoundary, 'writeBoundary');
  if (!Array.isArray(map.owners) || map.owners.length === 0) throw new Error('owners must be non-empty');
  if (!Array.isArray(map.routes) || map.routes.length === 0) throw new Error('routes must be non-empty');
  if (!map.checks || typeof map.checks !== 'object' || Array.isArray(map.checks)) throw new Error('checks must be an object');
  const ownerIds = new Set();
  for (const owner of map.owners) {
    if (!owner || typeof owner.id !== 'string' || owner.id.length === 0 || ownerIds.has(owner.id)) throw new Error('owner id must be unique and non-empty');
    ownerIds.add(owner.id);
    assertPathPatterns(owner.paths, `owner ${owner.id}.paths`);
  }
  const checkIds = new Set();
  for (const [id, check] of Object.entries(map.checks)) {
    if (id.length === 0 || checkIds.has(id)) throw new Error('check id must be unique and non-empty');
    checkIds.add(id);
    if (!check || typeof check.job !== 'string' || (!JOB_ORDER.includes(check.job) && check.job !== 'precheck')) throw new Error(`check ${id} has invalid job`);
    assertCommandSequence(check.command, `check ${id}`);
  }
  const routeIds = new Set();
  for (const route of map.routes) {
    if (!route || typeof route.id !== 'string' || route.id.length === 0 || routeIds.has(route.id)) throw new Error('route id must be unique and non-empty');
    routeIds.add(route.id);
    assertPathPatterns(route.paths, `route ${route.id}.paths`);
    if (!route.checks || typeof route.checks !== 'object' || Array.isArray(route.checks) || Object.keys(route.checks).length === 0) throw new Error(`route ${route.id} has no checks`);
    for (const [lane, ids] of Object.entries(route.checks)) {
      if (!CHECK_LANES.includes(lane)) throw new Error(`route ${route.id} has invalid lane ${lane}`);
      assertStringArray(ids, `route ${route.id}.${lane}`);
      if (new Set(ids).size !== ids.length) throw new Error(`route ${route.id}.${lane} has duplicate checks`);
      for (const id of ids) {
        if (!checkIds.has(id)) throw new Error(`route ${route.id} has missing check reference ${id}`);
        if (map.checks[id].job !== lane) throw new Error(`route ${route.id} places check ${id} in ${lane}, but its declared job is ${map.checks[id].job}`);
      }
    }
    const routeOwner = map.owners.find((owner) => owner.id === route.owner);
    if (!routeOwner) throw new Error(`route ${route.id} references missing owner`);
    if (!route.paths.every((routePath) => routeOwner.paths.some((ownerPath) => patternCovers(ownerPath, routePath)))) {
      throw new Error(`route ${route.id} has paths outside owner ${route.owner}`);
    }
    for (const key of ['liveLanes', 'databaseLanes', 'packagingLanes', 'generatedInputs']) {
      if (route[key] === undefined) throw new Error(`route ${route.id} has no ${key}`);
      assertStringArray(route[key], `route ${route.id}.${key}`);
    }
    assertPathPatterns(route.generatedInputs, `route ${route.id}.generatedInputs`);
    if (route.fullFallbackReasons !== undefined && (!Array.isArray(route.fullFallbackReasons) || route.fullFallbackReasons.some((item) => !item || typeof item.code !== 'string' || item.code.length === 0 || typeof item.detail !== 'string' || item.detail.length === 0))) throw new Error(`route ${route.id} has invalid fallback reasons`);
  }
  return map;
}

function emptyPlan(mode = 'focused') {
  return {
    mode,
    rules: false,
    owners: [],
    jobs: {
      quick: false,
      contracts: false,
      database: false,
      electron: false,
      windows: false,
      linux: false,
      packaging: false,
    },
    requiredJobs: [],
    checks: Object.fromEntries(CHECK_LANES.map((lane) => [lane, []])),
    liveLanes: [],
    databaseLanes: [],
    packagingLanes: [],
    generatedInputs: [],
    fullFallbackReasons: [],
  };
}

function fullPlan(reasons, map) {
  const plan = emptyPlan('full');
  plan.rules = true;
  plan.jobs = {
    quick: true,
    contracts: true,
    database: true,
    electron: true,
    windows: true,
    linux: true,
    packaging: true,
  };
  plan.requiredJobs = ['changes', ...JOB_ORDER];
  plan.fullFallbackReasons = reasons;
  if (map) {
    for (const [id, check] of Object.entries(map.checks)) {
      plan.checks[check.job].push(checkDescriptor(map, id));
    }
    for (const route of map.routes) {
      plan.liveLanes.push(...route.liveLanes);
      plan.databaseLanes.push(...route.databaseLanes);
      plan.packagingLanes.push(...route.packagingLanes);
      plan.generatedInputs.push(...route.generatedInputs);
    }
    plan.liveLanes = [...new Set(plan.liveLanes)];
    plan.databaseLanes = [...new Set(plan.databaseLanes)];
    plan.packagingLanes = [...new Set(plan.packagingLanes)];
    plan.generatedInputs = [...new Set(plan.generatedInputs)];
  }
  return plan;
}

function checkDescriptor(map, id) { return { id, command: map.checks[id].command }; }

export function verificationPlan(files, map = loadDependencyMap()) {
  let validated;
  try { validated = validateDependencyMap(map); } catch (error) { return fullPlan([reason('dependency-map-invalid', error instanceof Error ? error.message : String(error))]); }
  if (!Array.isArray(files) || files.length === 0) return fullPlan([reason('empty-change-set', 'no changed paths were provided')], validated);
  const plan = emptyPlan();
  const owners = new Set();
  const routes = new Set();
  const reasons = [];
  for (const file of files) {
    try { isPathSafe(file, 'INVALID_CHANGE_PATH'); } catch { reasons.push(reason('invalid-change-path', String(file))); continue; }
    const matchingOwners = validated.owners.filter((owner) => owner.paths.some((pattern) => matchesPattern(file, pattern)));
    if (matchingOwners.length === 0) { reasons.push(reason('unknown-path', file)); continue; }
    if (matchingOwners.length > 1) { reasons.push(reason('ambiguous-path', file)); continue; }
    owners.add(matchingOwners[0].id);
    const matchingRoutes = validated.routes.filter((route) => route.paths.some((pattern) => matchesPattern(file, pattern)));
    if (matchingRoutes.length === 0) { reasons.push(reason('missing-route', file)); continue; }
    for (const route of matchingRoutes) {
      routes.add(route.id);
      if (route.rules === true) plan.rules = true;
      for (const [lane, ids] of Object.entries(route.checks)) for (const id of ids) plan.checks[lane].push(checkDescriptor(validated, id));
      plan.liveLanes.push(...route.liveLanes);
      plan.databaseLanes.push(...route.databaseLanes);
      plan.packagingLanes.push(...route.packagingLanes);
      plan.generatedInputs.push(...route.generatedInputs);
      if (route.generatedInputs.length > 0 && !files.some((candidate) => route.generatedInputs.some((pattern) => matchesPattern(candidate, pattern)))) {
        reasons.push(reason('stale-generated', file));
      }
      if (route.fullFallbackReasons) reasons.push(...route.fullFallbackReasons);
    }
  }
  if (reasons.length > 0) {
    const full = fullPlan([...new Map(reasons.map((item) => [`${item.code}:${item.detail}`, item])).values()], validated);
    full.owners = [...owners].sort();
    return full;
  }
  plan.owners = [...owners].sort();
  plan.liveLanes = [...new Set(plan.liveLanes)];
  plan.databaseLanes = [...new Set(plan.databaseLanes)];
  plan.packagingLanes = [...new Set(plan.packagingLanes)];
  plan.generatedInputs = [...new Set(plan.generatedInputs)];
  for (const lane of CHECK_LANES) {
    const seen = new Set();
    plan.checks[lane] = plan.checks[lane].filter((check) => !seen.has(check.id) && seen.add(check.id));
  }
  for (const job of JOB_ORDER) plan.jobs[job] = plan.checks[job].length > 0;
  plan.jobs.quick = true;
  plan.jobs.packaging = plan.packagingLanes.length > 0;
  if (routes.size === 0) return fullPlan([reason('unknown-route', 'no dependency route matched')], validated);
  if (plan.owners.length === 1 && plan.owners[0] === 'repository-docs' && !plan.jobs.contracts && !plan.jobs.database && !plan.jobs.electron && !plan.jobs.packaging) plan.mode = 'docs';
  if (plan.mode === 'docs') plan.requiredJobs = ['changes', 'quick'];
  else { plan.mode = 'focused'; plan.requiredJobs = ['changes', ...JOB_ORDER.filter((job) => plan.jobs[job])]; }
  return plan;
}

function resolveRevision(revision, cwd) {
  if (typeof revision !== 'string' || !/^(?!-)(?!.*(?:\.\.|@\{))[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(revision)) throw new Error('REF_INVALID');
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('REF_INVALID');
  }
}

export function changedFiles(base, head, cwd = root) {
  const baseCommit = resolveRevision(base, cwd);
  const headCommit = resolveRevision(head ?? 'HEAD', cwd);
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  let revision;
  if (head === undefined) {
    try {
      revision = execFileSync('git', ['merge-base', baseCommit, headCommit], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      throw new Error('MERGE_BASE_UNAVAILABLE');
    }
  } else {
    revision = `${baseCommit}...${headCommit}`;
  }
  const files = git(['diff', '--no-renames', '--name-only', '-z', revision, '--']);
  if (head === undefined) files.push(...git(['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set(files)].sort();
}

function requiredJobNames(needs, prefix) {
  const list = needs?.changes?.outputs?.required_jobs;
  if (typeof list !== 'string' || list.length === 0) throw new Error(`${prefix}_REQUIRED_JOB_LIST_MISSING`);
  const names = list.split(',');
  if (names.some((name) => name.length === 0)) throw new Error(`${prefix}_REQUIRED_JOB_LIST_MALFORMED`);
  const allowed = new Set(['changes', ...JOB_ORDER]);
  if (names.some((name) => !allowed.has(name))) throw new Error(`${prefix}_REQUIRED_JOB_LIST_UNKNOWN`);
  if (new Set(names).size !== names.length) throw new Error(`${prefix}_REQUIRED_JOB_LIST_DUPLICATE`);
  return names;
}

function expectedPrJobs(needs) {
  const outputs = needs?.changes?.outputs;
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) throw new Error('PR_PLAN_MISSING');
  const mode = outputs.mode;
  if (!['docs', 'focused', 'full'].includes(mode)) throw new Error('PR_PLAN_MISSING');
  const selected = Object.fromEntries(JOB_ORDER.map((job) => {
    if (outputs[job] !== 'true' && outputs[job] !== 'false') throw new Error(`PR_PLAN_JOB_OUTPUT_INVALID: ${job}`);
    return [job, outputs[job] === 'true'];
  }));
  if (!selected.quick) throw new Error('PR_PLAN_JOB_OUTPUT_MISMATCH: quick');
  let expected;
  if (mode === 'docs') {
    if (JOB_ORDER.some((job) => job !== 'quick' && selected[job])) throw new Error('PR_PLAN_JOB_OUTPUT_MISMATCH: docs');
    expected = ['changes', 'quick'];
  } else if (mode === 'full') {
    if (JOB_ORDER.some((job) => !selected[job])) throw new Error('PR_PLAN_JOB_OUTPUT_MISMATCH: full');
    expected = ['changes', ...JOB_ORDER];
  } else {
    expected = ['changes', 'quick', ...JOB_ORDER.slice(1).filter((job) => selected[job])];
  }
  return expected;
}

export function assertPrGate(needs) {
  if (needs?.changes?.result !== 'success') throw new Error('PR_REQUIRED_JOB_NOT_SUCCESS: changes');
  const requiredJobs = requiredJobNames(needs, 'PR');
  const expectedJobs = expectedPrJobs(needs);
  if (requiredJobs.length !== expectedJobs.length || requiredJobs.some((job, index) => job !== expectedJobs[index])) throw new Error('PR_REQUIRED_JOB_LIST_MISMATCH');
  for (const job of requiredJobs) if (needs?.[job]?.result !== 'success') throw new Error(`PR_REQUIRED_JOB_NOT_SUCCESS: ${job}`);
}

export function assertCiGate(needs) {
  for (const key of ['changes', 'quality', 'postgres-15', 'windows-feasibility', 'linux-feasibility']) if (needs?.[key]?.result !== 'success') throw new Error(`CI_REQUIRED_JOB_NOT_SUCCESS: ${key}`);
  if (needs?.changes?.outputs?.mode !== 'full') throw new Error('CI_FULL_PLAN_MISSING');
}

export function assertCiFastGate(needs) {
  if (needs?.changes?.result !== 'success' || needs?.quick?.result !== 'success') throw new Error('CI_FAST_REQUIRED_JOB_NOT_SUCCESS');
  const requiredJobs = requiredJobNames(needs, 'CI_FAST');
  const expectedJobs = expectedPrJobs(needs);
  if (
    expectedJobs.length !== 2
    || expectedJobs[0] !== 'changes'
    || expectedJobs[1] !== 'quick'
    || requiredJobs.length !== 2
    || requiredJobs[0] !== 'changes'
    || requiredJobs[1] !== 'quick'
  ) throw new Error('CI_FAST_PLAN_REQUIRED_JOB_LIST_MISMATCH');
}

export function matchesWriteBoundary(files, boundary) {
  for (const file of files) isPathSafe(file, 'WRITE_PATH_INVALID');
  return files.every((file) => boundary.some((pattern) => matchesPattern(file, pattern)));
}

export function percentile(values, percentileRank) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(percentileRank) || percentileRank < 0 || percentileRank > 100) throw new Error('PERCENTILE_INVALID');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentileRank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function planLaneCommands(plan, lane) {
  if (!CHECK_LANES.includes(lane)) throw new Error(`PLAN_LANE_INVALID: ${lane}`);
  const checks = plan?.checks?.[lane];
  if (!Array.isArray(checks)) throw new Error(`PLAN_LANE_MISSING: ${lane}`);
  const commands = [];
  const seen = new Set();
  for (const check of checks) {
    if (!check || typeof check.id !== 'string') throw new Error(`PLAN_CHECK_INVALID: ${lane}`);
    for (const argv of assertCommandSequence(check.command, `PLAN_CHECK_INVALID: ${lane}`)) {
      const key = JSON.stringify(argv);
      if (!seen.has(key)) {
        seen.add(key);
        commands.push(argv);
      }
    }
  }
  return commands;
}

export function runPlanLane(plan, lane, dryRun) {
  const commands = planLaneCommands(plan, lane);
  if (plan.mode === 'full' && commands.length === 0) throw new Error(`PLAN_LANE_EMPTY: ${lane}`);
  if (commands.length === 0) {
    console.log(`${lane}: no checks selected`);
    return;
  }
  for (const argv of commands) {
    const resolved = resolvePlanCommand(argv);
    const [executable, ...args] = resolved;
    console.log(`${dryRun ? 'would run' : 'running'} [${lane}]: ${JSON.stringify(resolved)}`);
    if (dryRun) continue;
    const result = spawnSync(executable, args, {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`PLAN_CHECK_FAILED: ${lane}: ${JSON.stringify(resolved)}`);
  }
}

function parsePlanArguments(args, { allowLane = false, allowDryRun = false } = {}) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--base' && !options.base) options.base = args[++index];
    else if (argument === '--head' && !options.head) options.head = args[++index];
    else if (allowLane && argument === '--lane' && !options.lane) options.lane = args[++index];
    else if (allowDryRun && argument === '--dry-run' && !options.dryRun) options.dryRun = true;
    else throw new Error('VERIFICATION_ARGUMENT_INVALID');
  }
  if (!options.base) throw new Error('VERIFICATION_BASE_REQUIRED');
  return options;
}

function writeOutputs(plan) {
  if (!process.env.GITHUB_OUTPUT) return;
  const outputs = {
    mode: plan.mode,
    rules: String(plan.rules),
    required_jobs: plan.requiredJobs.join(','),
    quick: String(plan.jobs.quick),
    contracts: String(plan.jobs.contracts),
    database: String(plan.jobs.database),
    electron: String(plan.jobs.electron),
    windows: String(plan.jobs.windows),
    linux: String(plan.jobs.linux),
  };
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'gate' && args.length === 0) {
    assertCiGate(JSON.parse(process.env.CI_NEEDS ?? 'null'));
    console.log('CI gate PASS: every required job completed successfully.');
  } else if (command === 'gate-fast' && args.length === 0) {
    assertCiFastGate(JSON.parse(process.env.CI_NEEDS ?? 'null'));
    console.log('PR fast gate PASS: precheck and quick checks completed successfully.');
  } else if (command === 'gate-pr' && args.length === 0) {
    assertPrGate(JSON.parse(process.env.CI_NEEDS ?? 'null'));
    console.log('PR gate PASS: every planned required job completed successfully.');
  } else if (command === 'plan') {
    const options = parsePlanArguments(args);
    const files = changedFiles(options.base, options.head);
    const plan = verificationPlan(files);
    writeOutputs(plan);
    console.log(JSON.stringify({ ...plan, files }, null, 2));
  } else if (command === 'run') {
    const options = parsePlanArguments(args, { allowLane: true, allowDryRun: true });
    if (options.lane && !CHECK_LANES.includes(options.lane)) throw new Error(`PLAN_LANE_INVALID: ${options.lane}`);
    const files = changedFiles(options.base, options.head);
    const plan = verificationPlan(files);
    console.log(JSON.stringify({ mode: plan.mode, owners: plan.owners, requiredJobs: plan.requiredJobs, files }));
    for (const lane of options.lane ? [options.lane] : RUN_LANES) runPlanLane(plan, lane, options.dryRun);
  } else throw new Error('VERIFICATION_COMMAND_INVALID');
}
