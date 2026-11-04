#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseStackProfile } from '../synthetic-stack/profile.ts';

export const REPORT_SCHEMA = 'customer-agent-production-intake-tenancy/v1';
export const READ_ONLY_SNAPSHOT_SQL = 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const DEFAULT_STACK_ROOT = '/srv/customer-agent/stack';
const MAX_PROFILE_BYTES = 256 * 1024;
const EXPECTED_SOURCE_DOMAIN_COUNT = 4;
const ACTIVE_STATUSES = Object.freeze(['validating', 'staged', 'publishing']);

function invalid(code) {
  return Object.freeze({ ok: false, error: code });
}

export function parseOptions(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      allowPositionals: false,
      options: {
        'stack-root': { type: 'string', default: DEFAULT_STACK_ROOT },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
    });
  } catch {
    return invalid('INVALID_ARGUMENTS');
  }
  if (parsed.values.help) return Object.freeze({ ok: true, help: true });
  const stackRoot = parsed.values['stack-root'];
  if (typeof stackRoot !== 'string' || !path.isAbsolute(stackRoot)) return invalid('INVALID_ARGUMENTS');
  return Object.freeze({ ok: true, help: false, stackRoot: path.resolve(stackRoot) });
}

export function readStackProfile(stackRoot) {
  if (typeof stackRoot !== 'string' || !path.isAbsolute(stackRoot)) {
    throw new Error('PROFILE_INVALID');
  }
  const profilePath = path.join(stackRoot, 'profile.json');
  let stat;
  try {
    stat = lstatSync(profilePath);
  } catch {
    throw new Error('PROFILE_MISSING');
  }
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PROFILE_BYTES) {
    throw new Error('PROFILE_INVALID');
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    throw new Error('PROFILE_INVALID');
  }
  let profile;
  try {
    profile = parseStackProfile(raw, stackRoot, profilePath);
  } catch {
    throw new Error('PROFILE_INVALID');
  }
  return Object.freeze({
    stackRoot: profile.stackRoot,
    databaseName: profile.databaseName,
    pgSocketDirectory: profile.pgSocketDirectory,
    pgPort: profile.pgPort,
  });
}

function count(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('SNAPSHOT_INVALID');
  return number;
}

export function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || !Array.isArray(raw.batches) || typeof raw.historical !== 'object'
    || !raw.currentRelease || typeof raw.currentRelease !== 'object') {
    throw new Error('SNAPSHOT_INVALID');
  }
  const batches = raw.batches.map((row) => {
    if (!row || typeof row !== 'object'
      || !ACTIVE_STATUSES.includes(row.status)
      || !['default', 'explicit'].includes(row.tenant_kind)
      || !['missing', 'mismatch', 'bound'].includes(row.actor_state)) {
      throw new Error('SNAPSHOT_INVALID');
    }
    return Object.freeze({
      status: row.status,
      tenantKind: row.tenant_kind,
      actorState: row.actor_state,
      rowCount: count(row.row_count),
      sourceCount: count(row.source_count),
      sourceMismatchCount: count(row.source_mismatch_count),
    });
  });
  const current = raw.currentRelease;
  if (typeof current.present !== 'boolean' || typeof current.tenant_default !== 'boolean') {
    throw new Error('SNAPSHOT_INVALID');
  }
  return Object.freeze({
    batches: Object.freeze(batches),
    historicalDefaultCount: count(raw.historical.default_count),
    currentRelease: Object.freeze({
      present: current.present,
      tenantDefault: current.tenant_default,
      sourceCount: count(current.source_count),
      sourceMismatchCount: count(current.source_mismatch_count),
    }),
  });
}

export function evaluateSnapshot(input) {
  const snapshot = normalizeSnapshot(input);
  const blockers = new Set();
  for (const row of snapshot.batches) {
    if (row.tenantKind === 'default') blockers.add('ACTIVE_IMPORT_BATCH_DEFAULT_TENANT');
    if (row.actorState === 'missing') blockers.add('ACTIVE_IMPORT_BATCH_PRINCIPAL_MISSING');
    if (row.actorState === 'mismatch') blockers.add('ACTIVE_IMPORT_BATCH_TENANT_MISMATCH');
    if (row.sourceCount < 1) blockers.add('ACTIVE_IMPORT_BATCH_SOURCE_MISSING');
    if (row.sourceCount > 0 && row.sourceCount !== EXPECTED_SOURCE_DOMAIN_COUNT) {
      blockers.add('ACTIVE_IMPORT_BATCH_SOURCE_SET_INVALID');
    }
    if (row.sourceMismatchCount > 0) blockers.add('ACTIVE_IMPORT_BATCH_SOURCE_TENANT_MISMATCH');
  }
  if (!snapshot.currentRelease.present) blockers.add('CURRENT_RELEASE_MISSING');
  if (snapshot.currentRelease.tenantDefault) blockers.add('CURRENT_RELEASE_DEFAULT_TENANT');
  if (snapshot.currentRelease.present
    && snapshot.currentRelease.sourceCount !== EXPECTED_SOURCE_DOMAIN_COUNT) {
    blockers.add('CURRENT_RELEASE_SOURCE_SET_INVALID');
  }
  if (snapshot.currentRelease.sourceMismatchCount > 0) {
    blockers.add('CURRENT_RELEASE_SOURCE_TENANT_MISMATCH');
  }
  const active = snapshot.batches.reduce((total, row) => total + row.rowCount, 0);
  return Object.freeze({
    schema: REPORT_SCHEMA,
    ok: blockers.size === 0,
    status: blockers.size === 0 ? 'ready' : 'blocked',
    activeBatchCount: active,
    historicalDefaultBatchCount: snapshot.historicalDefaultCount,
    blockers: Object.freeze([...blockers].sort()),
  });
}

export async function collectSnapshot(client) {
  const batches = await client.query(`
    WITH active AS (
      SELECT
        b.import_batch_id,
        b.status,
        b.tenant_id,
        principal.principal_id,
        principal.tenant_id AS actor_tenant
      FROM public.import_batches AS b
      LEFT JOIN content_intake.principals AS principal
        ON principal.user_id = b.actor_user_id
      WHERE b.status = ANY($1::text[])
    )
    SELECT
      active.status,
      CASE WHEN active.tenant_id = 'default' THEN 'default' ELSE 'explicit' END AS tenant_kind,
      CASE
        WHEN active.principal_id IS NULL THEN 'missing'
        WHEN active.actor_tenant IS DISTINCT FROM active.tenant_id THEN 'mismatch'
        ELSE 'bound'
      END AS actor_state,
      count(DISTINCT active.import_batch_id)::int AS row_count,
      count(source.source_version_id)::int AS source_count,
      count(source.source_version_id) FILTER (
        WHERE source.tenant_id IS DISTINCT FROM active.tenant_id
      )::int AS source_mismatch_count
    FROM active
    LEFT JOIN public.import_batch_source_bindings AS binding
      ON binding.import_batch_id = active.import_batch_id
    LEFT JOIN public.authoritative_source_versions AS source
      ON source.source_version_id = binding.source_version_id
    GROUP BY active.status, active.tenant_id, active.principal_id, active.actor_tenant
    ORDER BY active.status, tenant_kind, actor_state
  `, [ACTIVE_STATUSES]);
  const historical = await client.query(`
    SELECT count(*)::int AS default_count
    FROM public.import_batches
    WHERE status <> ALL($1::text[]) AND tenant_id = 'default'
  `, [ACTIVE_STATUSES]);
  const current = await client.query(`
    SELECT
      current.id IS NOT NULL AS present,
      release.tenant_id = 'default' AS tenant_default,
      count(source.source_version_id)::int AS source_count,
      count(source.source_version_id) FILTER (
        WHERE source.tenant_id IS DISTINCT FROM release.tenant_id
      )::int AS source_mismatch_count
    FROM public.content_current AS current
    LEFT JOIN public.content_releases AS release
      ON release.release_id = current.current_release_id
    LEFT JOIN public.release_source_bindings AS binding
      ON binding.release_id = release.release_id
    LEFT JOIN public.authoritative_source_versions AS source
      ON source.source_version_id = binding.source_version_id
    WHERE current.id = 1
    GROUP BY current.id, release.tenant_id
  `);
  return {
    batches: batches.rows,
    historical: historical.rows[0] ?? { default_count: 0 },
    currentRelease: current.rows[0] ?? {
      present: false,
      tenant_default: false,
      source_count: 0,
      source_mismatch_count: 0,
    },
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options.ok) {
    process.stdout.write(`${JSON.stringify(options)}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write([
      'Usage: node scripts/ops/production-intake-tenancy.mjs [--stack-root PATH]',
      '',
      'Runs read-only tenant checks against an existing stack profile.',
      '',
    ].join('\n'));
    return 0;
  }
  let profile;
  try {
    profile = readStackProfile(options.stackRoot);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(invalid(error instanceof Error ? error.message : 'PROFILE_INVALID'))}\n`);
    return 2;
  }
  const client = new pg.Client({
    host: profile.pgSocketDirectory,
    port: profile.pgPort,
    database: profile.databaseName,
    user: 'stack_owner',
    application_name: 'customer-agent-production-intake-tenancy',
  });
  try {
    await client.connect();
    await client.query(READ_ONLY_SNAPSHOT_SQL);
    const snapshot = await collectSnapshot(client);
    await client.query('ROLLBACK');
    const report = evaluateSnapshot(snapshot);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* Connection failure may already abort the transaction. */ }
    process.stdout.write(`${JSON.stringify(invalid('CHECK_FAILED'))}\n`);
    return 1;
  } finally {
    try { await client.end(); } catch { /* Preserve the check result. */ }
  }
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify(invalid('CHECK_FAILED'))}\n`);
    process.exitCode = 1;
  });
}
