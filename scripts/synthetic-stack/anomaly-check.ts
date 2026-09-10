#!/usr/bin/env node
/**
 * Business-anomaly verification against a running synthetic stack.
 *
 *   node scripts/synthetic-stack/anomaly-check.ts
 *
 * Covers the four failure paths the macOS goal asks for, each against the real
 * chain (real API, real isolated PostgreSQL), and prints one PASS/FAIL line per
 * check. It is automated evidence, not human acceptance: it cannot observe the
 * client's Dock, focus, IME or Stage Manager behaviour.
 *
 * Checks:
 *   1. session expiry      revoke every session -> /auth/me and /search must be 401; re-login restores
 *   2. service outage      stop the API -> the client cannot reach it; start restores readiness
 *   3. source suspension   suspend a source -> search must fail closed
 *   4. rollback staleness  roll back -> desktop adapter copy of the superseded release must be STALE
 *
 * Check 4 must go through ProductSearch.copy. POST /v1/events/adoption does not
 * enforce release identity; EventRepository.recordAdoption only checks that the
 * query actually impressed the candidate.
 *
 * Check 3 rebuilds the isolated cluster afterwards because suspension is
 * permanent by design in the frozen schema; the script says so and does it.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anomalyStatus, revokeSessions, suspendSource } from './anomaly.ts';
import { SYNTHETIC_SOURCES } from './content.ts';
import { requireHeaderByteString } from './header-bytes.ts';
import { readProfile } from './profile.ts';
import { stopProcess } from './process.ts';
import { loginAs } from './seed.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const results: { name: string; pass: boolean; detail: string }[] = [];

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.info(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

function stack(...args: string[]): string {
  return execFileSync(process.execPath, [path.join(scriptDirectory, 'stack.ts'), ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000,
  }).trim();
}

export type SearchCall = Readonly<{
  apiOrigin: string;
  token: string;
  queryText: string;
}>;

async function search(call: SearchCall): Promise<{ status: number; body: Record<string, unknown> }> {
  requireHeaderByteString('authorization token', call.token);
  const response = await fetch(`${call.apiOrigin}/v1/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${call.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query_id: crypto.randomUUID(), parent_query_id: null, interaction_reason: 'original',
      query_text: call.queryText, collection_mode: 'synthetic', detected_platform: 'qianniu',
      platform: 'qianniu', platform_source: 'manual', product_context_type: null,
      product_context_ref: null, top_k: 3,
    }),
  });
  const body: Record<string, unknown> = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function checkSessionExpiry(apiOrigin: string): Promise<void> {
  const token = await loginAs(apiOrigin, 'synthetic_agent');
  const before = await fetch(`${apiOrigin}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  await revokeSessions();
  const me = await fetch(`${apiOrigin}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  const afterSearch = await search({ apiOrigin, token, queryText: '什么时候发货' });
  const relogin = await loginAs(apiOrigin, 'synthetic_agent');
  const restored = await fetch(`${apiOrigin}/v1/auth/me`, { headers: { authorization: `Bearer ${relogin}` } });
  record('session expiry', before.status === 200 && me.status === 401 && afterSearch.status === 401 && restored.status === 200,
    `me ${String(before.status)} -> revoked ${String(me.status)} / search ${String(afterSearch.status)} -> re-login ${String(restored.status)}`);
}

async function checkServiceOutage(apiOrigin: string): Promise<void> {
  const token = await loginAs(apiOrigin, 'synthetic_agent');
  const up = await fetch(`${apiOrigin}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  await stopProcess('api');
  let unreachable = false;
  try {
    await fetch(`${apiOrigin}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3_000) });
  } catch {
    unreachable = true;
  }
  stack('start');
  const ready = await fetch(`${apiOrigin}/ready`);
  record('service outage', up.status === 200 && unreachable && ready.status === 200,
    `up ${String(up.status)} -> stopped unreachable=${String(unreachable)} -> restarted /ready ${String(ready.status)}`);
}

async function checkSourceSuspension(apiOrigin: string): Promise<void> {
  const token = await loginAs(apiOrigin, 'synthetic_agent');
  const before = await search({ apiOrigin, token, queryText: '什么时候发货' });
  await suspendSource(SYNTHETIC_SOURCES[0].source_version_id);
  const after = await search({ apiOrigin, token, queryText: '什么时候发货' });
  const gateClosed = after.status === 503;
  stack('destroy');
  stack('start');
  const restoredToken = await loginAs(apiOrigin, 'synthetic_agent');
  const restored = await search({ apiOrigin, token: restoredToken, queryText: '什么时候发货' });
  record('source suspension', before.status === 200 && gateClosed && restored.status === 200,
    `before ${String(before.status)} -> suspended ${String(after.status)} (fail-closed) -> rebuilt ${String(restored.status)}`);
}

function checkRollbackStaleness(): void {
  const repositoryRoot = path.resolve(scriptDirectory, '../..');
  const vitest = path.join(repositoryRoot, 'apps/desktop/node_modules/.bin/vitest');
  try {
    const output = execFileSync(vitest, ['run', 'tests/unit/stack-anomaly-rollback.test.ts'], {
      cwd: path.join(repositoryRoot, 'apps/desktop'),
      encoding: 'utf8',
      env: { ...process.env, CUSTOMER_AGENT_STACK_ANOMALY: '1' },
      timeout: 180_000,
    });
    const passed = /\b1 passed\b/.test(output);
    record('rollback staleness', passed, passed
      ? 'desktop ProductSearch.copy returned STALE after announce.refresh observed the new release'
      : `vitest ran but did not report the adapter case\n${output.slice(-800)}`);
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error
      ? `${error.message}\n${String((error as { stderr?: string }).stderr ?? '')}\n${String((error as { stdout?: string }).stdout ?? '')}`
      : error instanceof Error ? error.message : String(error);
    record('rollback staleness', false, detail.slice(-1500));
  }
}

async function main(): Promise<void> {
  const profile = readProfile();
  if (!profile) throw new Error('no running stack; run `node scripts/synthetic-stack/stack.ts start` first');
  console.info(`[anomaly] api ${profile.apiOrigin}`);
  const initial = await anomalyStatus();
  for (const line of initial) console.info(`[anomaly] ${line}`);
  if (initial.some((line) => line.startsWith('suspended sources: ') && !line.endsWith('none'))) {
    console.info('[anomaly] suspended source found from a previous run; rebuilding the stack first');
    stack('destroy');
    stack('start');
    for (const line of await anomalyStatus()) console.info(`[anomaly] ${line}`);
  }
  await checkSessionExpiry(profile.apiOrigin);
  await checkServiceOutage(profile.apiOrigin);
  checkRollbackStaleness();
  await checkSourceSuspension(profile.apiOrigin);
  const failed = results.filter((result) => !result.pass);
  console.info('');
  console.info(`[anomaly] ${String(results.length - failed.length)}/${String(results.length)} checks passed`);
  if (failed.length > 0) {
    for (const result of failed) console.error(`[anomaly] FAILED ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(`[anomaly] FAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  });
}
