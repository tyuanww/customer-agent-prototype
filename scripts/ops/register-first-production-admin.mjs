#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseStackProfile, SYNTHETIC_IDENTITIES } from '../synthetic-stack/profile.ts';
import { isSeatBindingId } from '../synthetic-stack/identity-admission.ts';

const PURPOSE = 'customer-agent:first-production-admin';
const PIN_KEY = 'customer_agent.first_admin_record_sha256';
const APPLICATION_NAME = 'first-production-admin-registration';
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RECORD_KEYS = ['purpose', 'version', 'databaseName', 'tenantId', 'appId', 'bindingId',
  'authorizationVersion', 'departmentId', 'verifiedAt', 'validUntil'];
const MAX_RECORD_BYTES = 16 * 1024;

export class FirstAdminRegistrationError extends Error {
  constructor(code, cause) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'FirstAdminRegistrationError';
    this.code = code;
  }
}

function fail(code) {
  throw new FirstAdminRegistrationError(code);
}

function readBoundedFile(file, maxBytes, code) {
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) fail(code);
    const bytes = Buffer.alloc(maxBytes + 1);
    const length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length !== info.size || length > maxBytes) fail(code);
    return bytes.subarray(0, length);
  } catch (error) {
    if (error instanceof FirstAdminRegistrationError) throw error;
    throw new FirstAdminRegistrationError(code, error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readEnrollmentRecord(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('RECORD_PATH_INVALID');
  return readBoundedFile(file, MAX_RECORD_BYTES, 'RECORD_INVALID');
}

/** The raw bytes, including whitespace, are the externally approved artifact. */
export function parseEnrollmentRecord(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_RECORD_BYTES) {
    fail('RECORD_INVALID');
  }
  let text;
  let record;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    record = JSON.parse(text);
  } catch {
    fail('RECORD_INVALID');
  }
  if (!record || Array.isArray(record) || typeof record !== 'object'
    || Object.keys(record).length !== RECORD_KEYS.length
    || RECORD_KEYS.some(key => !Object.hasOwn(record, key))) fail('RECORD_INVALID');
  // This schema is flat and its values cannot contain quotes. Counting parsed
  // key tokens also rejects duplicate keys that JSON.parse would silently hide.
  const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/gu)].map(match => {
    try { return JSON.parse(`"${match[1]}"`); } catch { return null; }
  });
  if (keys.length !== RECORD_KEYS.length || new Set(keys).size !== RECORD_KEYS.length
    || keys.some(key => !RECORD_KEYS.includes(key))
    || record.purpose !== PURPOSE || record.version !== 1
    || ['databaseName', 'tenantId', 'appId', 'bindingId', 'departmentId']
      .some(key => typeof record[key] !== 'string' || !IDENTIFIER.test(record[key]))
    || typeof record.authorizationVersion !== 'string'
    || !/^[1-9][0-9]{0,18}$/u.test(record.authorizationVersion)
    || BigInt(record.authorizationVersion) > 9223372036854775807n) fail('RECORD_INVALID');
  for (const key of ['verifiedAt', 'validUntil']) {
    if (typeof record[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record[key])
      || !Number.isFinite(Date.parse(record[key]))
      || new Date(record[key]).toISOString() !== record[key]) fail('RECORD_INVALID');
  }
  const lifetime = Date.parse(record.validUntil) - Date.parse(record.verifiedAt);
  if (lifetime <= 0 || lifetime > 24 * 60 * 60 * 1000) fail('RECORD_INVALID');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({ record: Object.freeze(record), digest,
    principalId: `prod_admin_${digest}`, assignedBy: `first-admin:${digest}` });
}

export function parseArguments(argv) {
  const result = { apply: false, record: null, help: false };
  const seen = new Set();
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (seen.has(key)) fail('ARGUMENTS_INVALID');
    seen.add(key);
    if (key === '--apply') result.apply = true;
    else if (key === '--help') result.help = true;
    else if (key === '--record') result.record = args[++index];
    else fail('ARGUMENTS_INVALID');
  }
  if (!result.help && (typeof result.record !== 'string' || !path.isAbsolute(result.record))) {
    fail('ARGUMENTS_INVALID');
  }
  return Object.freeze(result);
}

async function authorizedContext(client, enrollment) {
  const { record, digest } = enrollment;
  const context = (await client.query(`SELECT database.datname,
      current_user = pg_catalog.pg_get_userbyid(database.datdba)
        AND session_user = current_user AS is_owner,
      $1::timestamptz <= pg_catalog.clock_timestamp()
        AND pg_catalog.clock_timestamp() < $2::timestamptz AS fresh,
      ARRAY(SELECT setting FROM pg_catalog.pg_db_role_setting AS pin,
        LATERAL pg_catalog.unnest(pin.setconfig) AS setting
        WHERE pin.setdatabase = database.oid AND pin.setrole = 0
          AND pg_catalog.split_part(setting, '=', 1) = $3) AS pins
    FROM pg_catalog.pg_database AS database WHERE database.datname = current_database()`,
  [record.verifiedAt, record.validUntil, PIN_KEY])).rows[0];
  if (!context?.is_owner) fail('DATABASE_OWNER_REQUIRED');
  if (context.datname !== record.databaseName) fail('DATABASE_MISMATCH');
  if (context.pins.length !== 1 || context.pins[0] !== `${PIN_KEY}=${digest}`) fail('APPROVAL_PIN_MISMATCH');
  if (!context.fresh) fail('APPROVAL_NOT_CURRENT');
  return context;
}

async function inspectRegistration(client, enrollment) {
  const { record, digest, principalId, assignedBy } = enrollment;
  const binding = (await client.query(`SELECT binding.binding_id, binding.user_id, binding.provider,
      binding.tenant, binding.role, binding.enabled, binding.authorization_version,
      account.role AS account_role,
      account.is_active AS account_active
    FROM backend_identity.subject_bindings AS binding
    LEFT JOIN public.app_users AS account ON account.user_id = binding.user_id
    WHERE binding.binding_id = $1`, [record.bindingId])).rows[0];
  if (!binding || !binding.enabled || binding.provider !== 'synthetic' || binding.role !== 'owner'
    || binding.tenant !== record.tenantId
    || binding.authorization_version !== record.authorizationVersion
    || SYNTHETIC_IDENTITIES.some(item => item.bindingId === binding.binding_id || item.userId === binding.user_id)
    || isSeatBindingId(binding.binding_id)
    || /^sys-query-binding-[0-9a-f]{64}$/u.test(binding.binding_id)
    || /^usr_seat_[0-9a-f]{31}$/u.test(binding.user_id)
    || /^sys-query-user-[0-9a-f]{64}$/u.test(binding.user_id)) fail('BINDING_NOT_ELIGIBLE');
  if (binding.account_role !== 'owner' || binding.account_active !== true) fail('ACCOUNT_NOT_ELIGIBLE');
  const policy = (await client.query(`SELECT version FROM content_intake.policy_versions
    WHERE tenant_id=$1 AND app_id=$2`, [record.tenantId, record.appId])).rows[0];
  if (!policy) fail('POLICY_REQUIRED');
  // The director rule belongs to the home/department/job tuple, not to a seat.
  // Even a disabled or stale sibling could later reuse it, so do not publish
  // this rule while another principal's current facts still reference it.
  const overlappingFacts = (await client.query(`SELECT EXISTS (
      SELECT 1 FROM content_intake.principals AS person
      JOIN content_intake.principal_facts AS facts
        ON facts.principal_id=person.principal_id
       AND facts.facts_version=person.current_facts_version
      WHERE person.tenant_id=$1 AND person.app_id=$2 AND person.principal_id<>$4
        AND facts.job_id='job-master-account' AND $3=ANY(facts.department_ids)
    ) AS occupied`,
  [record.tenantId, record.appId, record.departmentId, principalId])).rows[0];
  if (overlappingFacts.occupied) fail('MASTER_POST_CONFLICT');
  const rules = (await client.query(`SELECT role FROM content_intake.role_rules
    WHERE tenant_id=$1 AND app_id=$2 AND department_id=$3 AND job_id='job-master-account'`,
  [record.tenantId, record.appId, record.departmentId])).rows;
  if (rules.some(rule => rule.role !== 'director')) fail('MASTER_POST_CONFLICT');
  const principals = (await client.query(`SELECT * FROM content_intake.principals
    WHERE identity_scope='production-admin' OR user_id=$1 OR principal_id=$2`,
  [binding.user_id, principalId])).rows;
  const posts = (await client.query(`SELECT * FROM content_intake.seat_posts
    WHERE job_id='job-master-account' OR principal_id=$1`, [principalId])).rows;
  if (!principals.length && !posts.length) return { exists: false, binding };
  const principal = principals[0];
  const post = posts[0];
  if (principals.length !== 1 || principal.principal_id !== principalId
    || principal.user_id !== binding.user_id || principal.tenant_id !== record.tenantId
    || principal.app_id !== record.appId || principal.identity_scope !== 'production-admin'
    || principal.person_key !== assignedBy
    || posts.length !== 1 || post.principal_id !== principalId || post.tenant_id !== record.tenantId
    || post.app_id !== record.appId || post.department_id !== record.departmentId
    || post.job_id !== 'job-master-account' || post.assigned_by !== assignedBy) fail('REGISTRATION_CONFLICT');
  const facts = (await client.query(`SELECT facts.*,
      facts.checked_at=$2::timestamptz AND facts.valid_until=$3::timestamptz AS original_times,
      facts.checked_at <= pg_catalog.clock_timestamp()
        AND pg_catalog.clock_timestamp() < facts.valid_until AS fresh
    FROM content_intake.principal_facts AS facts WHERE facts.principal_id=$1
      AND (facts.facts_version=1 OR facts.facts_version=$4)`,
  [principalId, record.verifiedAt, record.validUntil, principal.current_facts_version])).rows;
  const first = facts.find(fact => fact.facts_version === '1');
  const current = facts.find(fact => fact.facts_version === principal.current_facts_version);
  if (!first?.original_times || first.facts_digest !== digest || !current?.fresh
    || facts.some(fact => !fact.enabled || fact.job_id !== 'job-master-account'
      || fact.department_ids.length !== 1 || fact.department_ids[0] !== record.departmentId)
    || rules.length !== 1) fail('REGISTRATION_CONFLICT');
  return { exists: true, binding };
}

/** Owns one idle DB-owner session. No account, binding, credential or grant write. */
export async function registerFirstProductionAdmin(client, { recordBytes, apply = false }) {
  if (typeof apply !== 'boolean') fail('ARGUMENTS_INVALID');
  const enrollment = parseEnrollmentRecord(recordBytes);
  const { record, digest, principalId, assignedBy } = enrollment;
  await client.query(apply ? 'BEGIN ISOLATION LEVEL READ COMMITTED'
    : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    const owner = (await client.query(`SELECT current_user=pg_catalog.pg_get_userbyid(datdba)
      AND session_user=current_user AS allowed FROM pg_catalog.pg_database
      WHERE datname=current_database()`)).rows[0];
    if (!owner?.allowed) fail('DATABASE_OWNER_REQUIRED');
    // Serialize first enrollment globally, including historical/disabled identities.
    // Table locks also stabilize the binding, account and policy against runtime writes.
    // No pg_catalog lock is needed: the final pin read is the authorization
    // linearization point; a later independent owner revocation cannot undo admission.
    if (apply) await client.query(`LOCK TABLE backend_identity.subject_bindings,
      public.app_users, content_intake.principals,
      content_intake.principal_facts, content_intake.seat_posts,
      content_intake.role_rules, content_intake.policy_versions
      IN SHARE ROW EXCLUSIVE MODE`);
    await authorizedContext(client, enrollment);
    const state = await inspectRegistration(client, enrollment);
    if (apply && !state.exists) {
      await client.query(`INSERT INTO content_intake.principals
        (principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
        VALUES ($1,$2,$3,$4,'production-admin',$5,1)`,
      [principalId, state.binding.user_id, record.tenantId, record.appId, assignedBy]);
      await client.query(`INSERT INTO content_intake.principal_facts
        (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        VALUES ($1,1,ARRAY[$2]::text[],'job-master-account',true,$3,$4,$5)`,
      [principalId, record.departmentId, record.verifiedAt, record.validUntil, digest]);
      const configured = (await client.query(`SELECT backend_identity.configure_production_admin_post($1,$2,$3) AS result`,
      [principalId, record.departmentId, assignedBy])).rows[0]?.result;
      if (configured !== 'configured') fail('MASTER_POST_CONFIGURATION_FAILED');
      if (!(await inspectRegistration(client, enrollment)).exists) fail('POSTCONDITION_FAILED');
    }
    // Recheck after potentially expensive verification. Never renew an approval
    // which expired while waiting for locks or while preparing the transaction.
    await authorizedContext(client, enrollment);
    if (apply) {
      try { await client.query('COMMIT'); }
      catch (error) { throw new FirstAdminRegistrationError('COMMIT_UNCONFIRMED', error); }
    } else await client.query('ROLLBACK');
    return Object.freeze({ status: state.exists ? 'already-registered' : apply ? 'registered' : 'preview',
      recordSha256: digest, principalId, created: apply && !state.exists, wouldCreate: !state.exists });
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) {
      throw new FirstAdminRegistrationError('ROLLBACK_UNCONFIRMED', new AggregateError([error, rollbackError]));
    }
    if (error instanceof FirstAdminRegistrationError) throw error;
    throw new FirstAdminRegistrationError('REGISTRATION_FAILED', error);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/ops/register-first-production-admin.mjs --record /absolute/approved.json [--apply]\n'
      + 'Preview is the default. Target: CUSTOMER_AGENT_STACK_ROOT/profile.json. Approval and its database pin must already exist.\n');
    return;
  }
  const recordBytes = readEnrollmentRecord(options.record);
  let profile;
  try {
    const configuredRoot = process.env.CUSTOMER_AGENT_STACK_ROOT ?? '/srv/customer-agent/stack';
    if (!path.isAbsolute(configuredRoot)) fail('PROFILE_INVALID');
    const root = realpathSync(configuredRoot);
    const profileFile = path.join(root, 'profile.json');
    profile = parseStackProfile(JSON.parse(readBoundedFile(profileFile, 256 * 1024, 'PROFILE_INVALID').toString('utf8')),
      root, profileFile);
  } catch (error) { throw new FirstAdminRegistrationError('PROFILE_INVALID', error); }
  const client = new pg.Client({ host: profile.pgSocketDirectory, port: profile.pgPort,
    database: profile.databaseName, user: 'stack_owner', application_name: APPLICATION_NAME,
    connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    process.stdout.write(`${JSON.stringify(await registerFirstProductionAdmin(client,
      { recordBytes, apply: options.apply }))}\n`);
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code:
      error instanceof FirstAdminRegistrationError ? error.code : 'REGISTRATION_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
