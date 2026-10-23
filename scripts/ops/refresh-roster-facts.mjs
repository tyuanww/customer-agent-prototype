#!/usr/bin/env node
/**
 * Keeps roster facts fresh between logins.
 *
 * Login writes a five-minute facts window (principal_facts_check caps every row at
 * `checked_at + 5 minutes`) and nothing refreshes it, so an operator who uploads a workbook
 * and then works through parsing, human review and publication loses authority mid-flight.
 * This script re-reads the same Feishu data login reads and re-projects it, which extends the
 * window without weakening the cap: an organisational change still takes effect within one
 * interval.
 *
 * It refreshes facts only. It does not call issue_roster_query, so a timer tick can never
 * advance the store set or restamp grants; that stays a login-time decision.
 *
 * Emits counts and statuses only. Job titles and department lists are personal data and must
 * not reach a log, a terminal transcript, or this repository.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { matchJobRoster } from '../../packages/job-roster/dist/index.js';

const STACK_ROOT = process.env.CUSTOMER_AGENT_STACK_ROOT ?? '/srv/customer-agent/stack';
const TENANT = process.env.ROSTER_TENANT_ID ?? 'tenant-menokin';
const APP = process.env.ROSTER_APP_ID ?? 'app-customer-agent';
const IDENTITY_SCOPE = 'feishu-job-roster';
const ROSTER_DEPARTMENT_TYPE = 'open_department_id';
const FEISHU_ORIGIN = 'https://open.feishu.cn';
const REQUEST_TIMEOUT_MS = 8_000;
/** Above this the run is reported as degraded rather than silently partial. */
const MAX_FAILURES_BEFORE_UNHEALTHY = 1;

function log(message) {
  console.info(`${new Date().toISOString()} ${message}`);
}

function fail(message) {
  console.error(`${new Date().toISOString()} FATAL ${message}`);
  process.exit(1);
}

function readEnvFile(file) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    fail(`cannot read ${file}: ${error.code ?? 'error'}`);
  }
  const values = new Map();
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    values.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
  }
  return values;
}

async function tenantToken(appId, appSecret) {
  const response = await fetch(`${FEISHU_ORIGIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.tenant_access_token !== 'string') {
    throw new Error(`tenant token request failed with HTTP ${String(response.status)}`);
  }
  return body.tenant_access_token;
}

/** Returns the person's current directory facts, or null when Feishu cannot answer for them. */
async function directoryFacts(token, openId) {
  const url = new URL(`${FEISHU_ORIGIN}/open-apis/contact/v3/users/${encodeURIComponent(openId)}`);
  url.searchParams.set('user_id_type', 'open_id');
  url.searchParams.set('department_id_type', ROSTER_DEPARTMENT_TYPE);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const user = body?.data?.user;
  if (!user || typeof user !== 'object') return null;
  const departments = user.department_ids;
  if (!Array.isArray(departments) || departments.length === 0) return null;
  if (user.status?.is_resigned === true || user.status?.is_activated === false) {
    return { departments: null, title: null };
  }
  const title = typeof user.job_title === 'string' ? user.job_title : '';
  return { departments: departments.filter((id) => typeof id === 'string' && id.length > 0), title };
}

async function main() {
  const feishu = readEnvFile(path.join(STACK_ROOT, 'feishu.env'));
  const appId = feishu.get('FEISHU_APP_ID');
  const appSecret = feishu.get('FEISHU_APP_SECRET');
  if (!appId || !appSecret) fail('feishu.env has no FEISHU_APP_ID / FEISHU_APP_SECRET');

  const profile = JSON.parse(readFileSync(path.join(STACK_ROOT, 'profile.json'), 'utf8'));
  const client = new pg.Client({
    host: profile.pgSocketDirectory,
    port: Number(profile.pgPort),
    database: profile.databaseName,
    user: 'stack_intake_business',
    application_name: 'roster-facts-refresh',
  });
  await client.connect();
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;
  try {
    await client.query('SET ROLE intake_business');
    const { rows } = await client.query(`
      SELECT principal_id, user_id, person_key
      FROM content_intake.principals
      WHERE tenant_id = $1 AND app_id = $2 AND identity_scope = $3
      ORDER BY principal_id`, [TENANT, APP, IDENTITY_SCOPE]);
    if (rows.length === 0) {
      log('no roster principals; nothing to refresh');
      return;
    }
    const token = await tenantToken(appId, appSecret);
    for (const row of rows) {
      try {
        const facts = await directoryFacts(token, row.person_key);
        if (facts === null) {
          skipped += 1;
          log(`skip ${row.principal_id}: directory read unavailable`);
          continue;
        }
        if (facts.departments === null) {
          skipped += 1;
          log(`skip ${row.principal_id}: not an active employee`);
          continue;
        }
        const match = matchJobRoster(facts.title ?? '');
        if (match.status !== 'matched') {
          skipped += 1;
          log(`skip ${row.principal_id}: job title does not match the roster (${match.status})`);
          continue;
        }
        const projected = await client.query(
          'SELECT content_intake.project_feishu_roster($1,$2,$3,$4,$5,$6,$7,$8,$9,ARRAY[$10]) AS status',
          [row.principal_id, row.user_id, TENANT, APP, IDENTITY_SCOPE, row.person_key,
            facts.departments, match.row.jobId, match.row.role, 'query']);
        const status = projected.rows[0]?.status;
        if (status === 'registered' || status === 'projected') {
          refreshed += 1;
          log(`refresh ${row.principal_id}: ${String(status)}`);
        } else {
          skipped += 1;
          log(`skip ${row.principal_id}: projection returned ${String(status)}`);
        }
      } catch (error) {
        failed += 1;
        log(`fail ${row.principal_id}: ${error.message ?? 'error'}`);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  log(`done: refreshed=${String(refreshed)} skipped=${String(skipped)} failed=${String(failed)}`);
  if (failed > MAX_FAILURES_BEFORE_UNHEALTHY) process.exitCode = 1;
}

await main().catch((error) => fail(error.message ?? 'unexpected error'));
