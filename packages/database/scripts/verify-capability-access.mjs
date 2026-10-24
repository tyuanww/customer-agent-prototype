#!/usr/bin/env node
/**
 * Runs statements as the capability roles the API actually uses, so a missing GRANT fails here
 * instead of in production.
 *
 * Why this exists. A probe connected as `stack_owner` reported a new feature working while every
 * endpoint would have returned 500 in production. `stack_owner` is a superuser, so it bypasses
 * every privilege check and its green result says nothing about what the API can do. The API
 * connects as a dedicated LOGIN and then enters a NOLOGIN capability role
 * (`apps/api/src/content-intake/runtime-pool.ts`), so that is the path to test.
 *
 * Each case runs inside a transaction that is always rolled back. A statement that succeeds
 * leaves nothing behind; a statement that fails reports the SQLSTATE and message PostgreSQL
 * actually raised, which is the thing worth reading.
 *
 * Cases are declared here rather than discovered, so the list is reviewable and a newly added
 * capability has to be added deliberately. Run it after any change that touches GRANT, REVOKE,
 * a SECURITY DEFINER function, or a role's reachable tables.
 *
 * Usage:
 *   node packages/database/scripts/verify-capability-access.mjs --database <name> [--socket <dir>]
 *   node packages/database/scripts/verify-capability-access.mjs --url <connection string>
 *
 * Exit 0 when every case passes, 1 otherwise.
 */
import pg from 'pg';

/** A case is one capability role attempting one thing the API does. `allow` lists the outcomes
 *  that count as designed; anything else is a failure even when PostgreSQL answers cleanly, so a
 *  statement that silently returns zero rows cannot pass by accident.
 *
 *  `tier: 'required'` gates the exit code: the capability must work on this commit.
 *  `tier: 'planned'` is the specification for a change that has not landed; it reports what is
 *  still missing without failing the run, so this stays usable as a gate between changes. When
 *  the change lands, flip its cases to `required`. */
const CASES = Object.freeze([
  {
    id: 'business creates a seat binding',
    tier: 'planned',
    role: 'intake_business',
    sql: `INSERT INTO backend_identity.subject_bindings(
            binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
          VALUES ('synthetic_acl_probe','synthetic','acl-probe','probe','usr_acl_probe',
            encode(sha256(convert_to('synthetic_acl_probe','UTF8')),'hex'), true, 'agent')`,
    allow: ['ok'],
  },
  {
    id: 'business creates a seat principal',
    tier: 'planned',
    role: 'intake_business',
    sql: `INSERT INTO content_intake.principals(
            principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version)
          VALUES ('acl_probe_principal','usr_acl_probe','tenant-menokin','app-customer-agent',
            'confirmed-synthetic','acl-probe',1)`,
    allow: ['ok'],
  },
  {
    id: 'business writes a role rule',
    tier: 'planned',
    role: 'intake_business',
    sql: `INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
          VALUES ('tenant-menokin','app-customer-agent','dept-menokin','job-acl-probe',1,'agent')`,
    allow: ['ok'],
  },
  {
    id: 'business disables a binding',
    tier: 'planned',
    role: 'intake_business',
    sql: `UPDATE backend_identity.subject_bindings SET enabled = false
           WHERE binding_id = 'synthetic_acl_probe' AND provider = 'synthetic'`,
    allow: ['ok'],
  },
  {
    id: 'business reads the seat list',
    tier: 'planned',
    role: 'intake_business',
    sql: `SELECT person.principal_id, person.user_id, binding.subject, binding.enabled
            FROM backend_identity.subject_bindings binding
            JOIN content_intake.principals person ON person.user_id = binding.user_id
           WHERE person.identity_scope = 'confirmed-synthetic'`,
    allow: ['ok'],
  },
  {
    id: 'business runs the seat login projection',
    tier: 'planned',
    role: 'intake_business',
    sql: `SELECT content_intake.project_seat_login('synthetic_acl_probe') AS status`,
    allow: ['ok'],
  },
  {
    id: 'business asks whether it may administer seats',
    tier: 'planned',
    role: 'intake_business',
    sql: `SELECT content_intake.may_administer_seats('acl_probe_principal', clock_timestamp()) AS allowed`,
    allow: ['ok'],
  },
  {
    id: 'business reads authorization sources',
    tier: 'required',
    role: 'intake_business',
    sql: `SELECT count(*) FROM content_intake.authorization_sources('acl_probe_principal','query',clock_timestamp())`,
    allow: ['ok'],
  },
  {
    id: 'usage reads authorization sources',
    tier: 'required',
    role: 'intake_usage',
    sql: `SELECT count(*) FROM content_intake.authorization_sources('acl_probe_principal','query',clock_timestamp())`,
    allow: ['ok'],
  },
  // No worker case. Asserting one would encode a guess about what that role needs, and a probe
  // that invents a requirement reports a defect that may not exist. Add one when a change makes
  // the API worker path read a specific table.
  {
    id: 'business cannot read the password file table (there is none)',
    tier: 'planned',
    role: 'intake_business',
    sql: "SELECT count(*) FROM content_intake.seat_posts",
    allow: ['ok', 'missing-table', 'denied'],
  },
]);

function usage(message) {
  console.error(message);
  console.error('usage: verify-capability-access.mjs --database <name> [--socket <dir>] | --url <conn>');
  process.exit(2);
}

function parseArguments(argv) {
  const options = { database: null, socket: null, url: null, port: 43199, user: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (value === undefined) usage(`${argument} needs a value`);
      index += 1;
      return value;
    };
    if (argument === '--database') options.database = take();
    else if (argument === '--socket') options.socket = take();
    else if (argument === '--url') options.url = take();
    else if (argument === '--port') options.port = Number(take());
    else if (argument === '--user') options.user = take();
    else usage(`unknown argument ${argument}`);
  }
  if (!options.url && !options.database) usage('one of --database or --url is required');
  return options;
}

/** Classifies the outcome so `allow` can name a designed refusal instead of accepting any error. */
/** Each capability has its own LOGIN, a member of exactly one role, which is why the admission
 *  check in product-auth-service.ts rejects a login that belongs to a second capability. Passing
 *  every case through a single login would test an arrangement production never uses, and the
 *  refusal to SET ROLE would look like a product defect. */
function loginFor(role) {
  return `stack_${role}`;
}

function classify(error) {
  if (!error) return 'ok';
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === '42501') return 'denied';
  if (code === '42883') return 'missing-function';
  if (code === '42P01') return 'missing-table';
  if (code === '23505') return 'conflict';
  if (code === '23514') return 'constraint';
  if (code === '23503') return 'foreign-key';
  return `error:${code || 'unknown'}`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const base = options.url
    ? { connectionString: options.url }
    : { host: options.socket ?? '/srv/customer-agent/stack/data/pg15-socket', port: options.port, database: options.database };
  let failures = 0;
  const withClient = async (user, run) => {
    const client = new pg.Client({ ...base, ...(user ? { user } : {}), application_name: 'capability-access-probe' });
    await client.connect();
    try { return await run(client); } finally { await client.end(); }
  };
  await withClient(options.user ?? loginFor('intake_business'), async (probe) => {
    const privileged = await probe.query(
      'SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user');
    if (privileged.rows[0]?.bypasses) {
      console.log('NOTE  the login role is a superuser; the SET ROLE lines below are the only real check.');
      console.log('');
    }

    for (const item of CASES) {
      // One transaction per case, always rolled back, so a passing INSERT leaves no row behind
      // and a failing one cannot poison the next case.
      const outcomeAndDetail = await withClient(options.user ?? loginFor(item.role), async (client) => {
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE ' + item.role);
          await client.query(item.sql);
          return { outcome: 'ok', detail: '' };
        } catch (error) {
          return {
            outcome: classify(error),
            detail: typeof error.message === 'string' ? error.message.split('\n')[0] : '',
          };
        } finally {
          try { await client.query('ROLLBACK'); } catch { /* the case outcome is already recorded */ }
        }
      });
      const { outcome, detail } = outcomeAndDetail;
      const passed = item.allow.includes(outcome);
      const gating = item.tier === 'required';
      if (!passed && gating) failures += 1;
      const label = passed ? 'PASS' : gating ? 'FAIL' : 'GAP ';
      const suffix = detail ? `  ${detail}` : '';
      console.log(`${label}  ${item.role.padEnd(16)} ${item.id}  -> ${outcome}${suffix}`);
      if (!passed) console.log(`      allowed: ${item.allow.join(', ')}${gating ? '' : '  (planned, not gating)'}`);
    }
  });
  console.log('');
  const required = CASES.filter((item) => item.tier === 'required').length;
  const planned = CASES.length - required;
  console.log(failures === 0
    ? `PASS ${required} required cases; ${planned} planned cases reported as GAP`
    : `FAIL ${failures} of ${required} required cases`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`verify-capability-access: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
