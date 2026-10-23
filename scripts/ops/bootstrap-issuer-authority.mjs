#!/usr/bin/env node
/**
 * One-time bootstrap of root allocation authority for a principal that already has a
 * renewable facts source.
 *
 * Why this exists. `createGrants` requires the issuer to hold a live allocation with a
 * steward (`content_intake.grant_parent_guard`, `apps/api/src/content-intake/authority.ts`
 * `parentAuthority`) and a facts window that has not closed. The only principals holding
 * allocations in production are two synthetic ghosts: `hz-allocator`, bound to a password
 * account nothing refreshes, and `principal-menokin-admin`, with no login path at all. The
 * one real person's principal has facts renewed every four minutes from Feishu, but no
 * allocation, so that person cannot issue anything.
 *
 * Refreshing the ghosts would be the wrong fix. A facts row carries the department and job
 * the role rules read, so renewing a synthetic identity forever is a permanent grant with
 * extra steps. This script instead gives the allocation to the principal whose facts come
 * from the authoritative source: from then on the Feishu timer is what keeps the issuer
 * qualified, and an organisational change takes effect within one timer interval.
 *
 * What it writes. One allocation row per (action, scope) with issuer = recipient = steward,
 * parent_grant_id NULL. That is the same shape `bootstrapRootAllocation` writes, and the
 * parent guard deliberately allows it: a root has no parent to contradict. Nothing else is
 * touched. No business grant, no facts row, no policy row.
 *
 * What it cannot do on its own. `authorization_sources` reads business grants only, so an
 * allocation decides whether the principal may delegate while the principal's own business
 * grants decide which sources it may delegate. A principal with allocations but no business
 * grant on a source is refused with SCOPE_DENIED, not GRANT_AUTHORITY_DENIED. The run ends by
 * printing the source set the principal can actually hand out, per action, so an empty set is
 * visible here instead of during the first authorization attempt.
 *
 * Idempotent: an action/scope pair that already has a live allocation for the recipient is
 * skipped, so a second run writes nothing. `--dry-run` prints the plan and writes nothing.
 *
 * Emits principal ids, scope ids, action names and counts. No personal data, so it is safe
 * in a terminal transcript and safe to paste into a report.
 *
 * Usage:
 *   node scripts/ops/bootstrap-issuer-authority.mjs --principal <id> [--actions a,b] \
 *        [--scopes id,id] [--expires-days 30] [--reason text] [--dry-run]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const STACK_ROOT = process.env.CUSTOMER_AGENT_STACK_ROOT ?? '/srv/customer-agent/stack';
const ALL_ACTIONS = Object.freeze([
  'query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback',
]);
const DEFAULT_REASON = '运营主账号的根授权：由受控 bootstrap 写入，用于逐个授权他人。';
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function log(message) {
  console.info(`${new Date().toISOString()} ${message}`);
}

function fail(message) {
  console.error(`${new Date().toISOString()} FATAL ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = { dryRun: false, actions: ALL_ACTIONS, scopes: null, expiresDays: 30, reason: DEFAULT_REASON, principal: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) fail(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--principal') options.principal = value();
    else if (argument === '--actions') options.actions = value().split(',').map((item) => item.trim()).filter(Boolean);
    else if (argument === '--scopes') options.scopes = value().split(',').map((item) => item.trim()).filter(Boolean);
    else if (argument === '--expires-days') options.expiresDays = Number(value());
    else if (argument === '--reason') options.reason = value();
    else fail(`unknown argument ${argument}`);
  }
  if (!options.principal || !IDENTIFIER.test(options.principal)) fail('--principal must be a principal id');
  if (!Number.isInteger(options.expiresDays) || options.expiresDays < 1 || options.expiresDays > 365) {
    fail('--expires-days must be an integer from 1 to 365');
  }
  for (const action of options.actions) {
    if (!ALL_ACTIONS.includes(action)) fail(`unknown action ${action}`);
  }
  if (options.actions.length === 0) fail('no actions selected');
  if (!options.reason.trim()) fail('reason must not be empty');
  return options;
}

function connectionProfile() {
  const profile = JSON.parse(readFileSync(path.join(STACK_ROOT, 'profile.json'), 'utf8'));
  if (typeof profile.databaseName !== 'string' || !IDENTIFIER.test(profile.databaseName)) {
    fail('profile.json has no usable databaseName');
  }
  if (typeof profile.pgSocketDirectory !== 'string' || !path.isAbsolute(profile.pgSocketDirectory)) {
    fail('profile.json has no absolute pgSocketDirectory');
  }
  const port = Number(profile.pgPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail('profile.json has no usable pgPort');
  return { host: profile.pgSocketDirectory, port, database: profile.databaseName };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const connection = connectionProfile();
  // stack_owner is the cluster owner, not a capability role. Running as a capability role
  // would be refused below, which is the same rule bootstrapRootAllocation applies.
  const client = new pg.Client({ ...connection, user: 'stack_owner', application_name: 'issuer-authority-bootstrap' });
  await client.connect();
  try {
    const session = await client.query('SELECT current_user AS role_name');
    if (session.rows[0]?.role_name === 'intake_business') fail('refusing to bootstrap as a capability role');

    const person = await client.query(
      `SELECT p.principal_id, p.tenant_id, p.app_id, p.identity_scope,
              f.department_ids, f.job_id, f.enabled,
              (f.checked_at <= clock_timestamp() AND clock_timestamp() < f.valid_until) AS fresh,
              f.valid_until
         FROM content_intake.principals p
         JOIN content_intake.principal_facts f
           ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
        WHERE p.principal_id = $1`,
      [options.principal],
    );
    const row = person.rows[0];
    if (!row) fail(`no principal with current facts for ${options.principal}`);
    // A recipient whose facts are already stale cannot issue even after this runs, so writing
    // the allocations would look like success and behave like failure.
    if (!row.enabled || !row.fresh) {
      fail(`${options.principal} facts are not fresh or not enabled, so it could not issue anyway`);
    }

    const roles = await client.query(
      `SELECT DISTINCT r.role
         FROM content_intake.role_rules r
        WHERE r.tenant_id = $1 AND r.app_id = $2
          AND r.department_id = ANY($3::text[]) AND r.job_id = $4`,
      [row.tenant_id, row.app_id, row.department_ids, row.job_id],
    );
    if (roles.rows.length !== 1) fail(`expected exactly one role for ${options.principal}, found ${String(roles.rows.length)}`);
    const role = roles.rows[0].role;
    log(`principal=${options.principal} role=${role} facts_valid_until=${row.valid_until.toISOString()}`);

    const allowed = await client.query(
      `SELECT action FROM unnest($1::text[]) AS action
        WHERE content_intake.role_allows($2, action)`,
      [options.actions, role],
    );
    const permitted = allowed.rows.map((item) => item.action);
    for (const action of options.actions) {
      if (!permitted.includes(action)) log(`skip action=${action} reason=role_ceiling`);
    }
    if (permitted.length === 0) fail(`role ${role} allows none of the requested actions`);

    const scopes = await client.query(
      `SELECT scope_id, tenant_id, app_id, brand_id, shop_id, domain
         FROM content_intake.scopes
        WHERE tenant_id = $1 AND app_id = $2
          AND ($3::text[] IS NULL OR scope_id = ANY($3::text[]))
        ORDER BY scope_id`,
      [row.tenant_id, row.app_id, options.scopes],
    );
    if (scopes.rows.length === 0) fail('no scopes matched');
    if (options.scopes) {
      for (const wanted of options.scopes) {
        if (!scopes.rows.some((scope) => scope.scope_id === wanted)) fail(`scope ${wanted} not found for this tenant`);
      }
    }

    let created = 0;
    let skipped = 0;
    for (const scope of scopes.rows) {
      for (const action of permitted) {
        const existing = await client.query(
          `SELECT grant_id FROM content_intake.grants
            WHERE recipient_id = $1 AND scope_id = $2 AND action = $3 AND kind = 'allocation'
              AND source_id IS NULL AND revoked_at IS NULL AND steward_id IS NOT NULL
              AND starts_at <= clock_timestamp() AND expires_at > clock_timestamp()
            LIMIT 1`,
          [options.principal, scope.scope_id, action],
        );
        if (existing.rows[0]) {
          skipped += 1;
          continue;
        }
        if (options.dryRun) {
          log(`would create scope=${scope.scope_id} action=${action}`);
          created += 1;
          continue;
        }
        const grantId = `grant_${randomUUID()}`;
        await client.query(
          `INSERT INTO content_intake.grants(
             grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
             starts_at, expires_at, reason, steward_id)
           VALUES ($1, 'allocation', $2, $2, $3, $4, $5, NULL, $6,
             clock_timestamp(), clock_timestamp() + make_interval(days => $7), $8, $2)`,
          [grantId, options.principal, row.tenant_id, row.app_id, scope.scope_id, action, options.expiresDays, options.reason.trim()],
        );
        created += 1;
      }
    }

    if (!options.dryRun && created > 0) {
      await client.query(
        'UPDATE content_intake.principals SET revocation_generation = revocation_generation + 1 WHERE principal_id = $1',
        [options.principal],
      );
    }
    log(`${options.dryRun ? 'DRY_RUN' : 'DONE'} created=${String(created)} skipped_live=${String(skipped)} scopes=${String(scopes.rows.length)} actions=${String(permitted.length)}`);

    // Reporting only, and only against what exists now. A dry run reads the current state, so
    // its numbers describe the situation before the writes it just described.
    for (const action of permitted) {
      const delegable = await client.query(
        'SELECT DISTINCT source_id FROM content_intake.authorization_sources($1, $2, clock_timestamp()) ORDER BY source_id',
        [options.principal, action],
      );
      const sources = delegable.rows.map((item) => item.source_id);
      log(`delegable action=${action} sources=${String(sources.length)}${sources.length === 0 ? ' (allocation alone cannot delegate: no business grant on any source)' : ` [${sources.join(',')}]`}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
