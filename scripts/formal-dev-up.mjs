/**
 * Start the local formal-dev API and content worker if they are not already up.
 * Reads ~/.customer-agent-formal/api.env. Does not print secrets, open a tunnel,
 * or flip runtime_activated.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const formalRoot = path.join(homedir(), '.customer-agent-formal');
const envFile = path.join(formalRoot, 'api.env');
const logDirectory = path.join(formalRoot, 'logs');

function loadEnv() {
  const env = {};
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  env.PATH = process.env.PATH ?? '';
  env.CONTENT_INTENT_TAXONOMY_VERSION = env.CONTENT_INTENT_TAXONOMY_VERSION ?? 'itax_synthetic_stack_v1';
  env.CONTENT_INTENT_ID = env.CONTENT_INTENT_ID ?? 'intent_synthetic_stack_shipping';
  const owner = (env.FEISHU_BINDINGS ?? '').split(',').map((part) => part.split(':')).find((pair) => pair[1] === 'owner');
  const subject = owner?.[0];
  if (subject) {
    env.CONTENT_REVIEW_LEAD_SUBJECT = subject;
    if (env.CONTENT_REVIEW_MANAGER_SUBJECT === subject) delete env.CONTENT_REVIEW_MANAGER_SUBJECT;
  }
  env.CONTENT_REVIEW_EVIDENCE_ID = env.CONTENT_REVIEW_EVIDENCE_ID ?? 'EVD-FORMAL-REVIEW-001';
  delete env.CUSTOMER_AGENT_REVIEW_LOGIN_PORT;
  return env;
}

function listening(port) {
  try {
    execFileSync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim();
    return stat.length > 0 && !stat.includes('Z');
  } catch {
    return false;
  }
}

function formalWorkerPid() {
  let lines = '';
  try {
    lines = execFileSync('pgrep', ['-fl', 'content-worker-main.js'], { encoding: 'utf8' });
  } catch {
    return null;
  }
  const matches = [];
  for (const line of lines.split('\n')) {
    if (!line || line.includes('wt-dashboard')) continue;
    const pid = Number(line.trim().split(/\s+/, 1)[0]);
    if (!Number.isInteger(pid) || !processAlive(pid)) continue;
    try {
      const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
      if (cwd.includes(repositoryRoot) && !cwd.includes('wt-dashboard')) matches.push(pid);
    } catch {
      // The process exited between pgrep and lsof.
    }
  }
  if (matches.length === 0) return null;
  sleep(1000);
  return matches.find((pid) => processAlive(pid)) ?? null;
}

function spawnDetached(script, logName) {
  mkdirSync(logDirectory, { recursive: true });
  const log = openSync(path.join(logDirectory, logName), 'a');
  const child = spawn(process.execPath, [script], {
    cwd: repositoryRoot,
    env: loadEnv(),
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  return child.pid;
}

const env = loadEnv();
const apiPort = Number(env.CUSTOMER_AGENT_API_PORT ?? '43110');
if (listening(apiPort)) {
  console.log(`api already listening on ${String(apiPort)}`);
} else {
  const pid = spawnDetached('apps/api/dist/main.js', 'api.log');
  console.log(`api started pid ${String(pid)}`);
}

const workerPid = formalWorkerPid();
if (workerPid !== null) {
  console.log(`worker already running pid ${String(workerPid)}`);
} else {
  const pid = spawnDetached('apps/api/dist/content-worker-main.js', 'worker.log');
  console.log(`worker started pid ${String(pid)}`);
}
