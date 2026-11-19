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
const PILOT_DATABASE = 'customer_agent_intake_test';
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const COMMON_RECORD_KEYS = ['purpose', 'version', 'databaseName', 'tenantId', 'appId',
  'departmentId', 'verifiedAt', 'validUntil'];
const BOUND_RECORD_KEYS = [...COMMON_RECORD_KEYS, 'bindingId', 'authorizationVersion'];
const PILOT_RECORD_KEYS = [...COMMON_RECORD_KEYS, 'ownerSubjectSha256', 'ownerDisplayName'];
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

function pilotOwnerIdentity(record) {
  if (typeof record.ownerSubjectSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(record.ownerSubjectSha256)
    || typeof record.ownerDisplayName !== 'string' || record.ownerDisplayName.trim() !== record.ownerDisplayName
    || [...record.ownerDisplayName].length < 1 || [...record.ownerDisplayName].length > 64
    || /\p{Cc}|\p{Cs}/u.test(record.ownerDisplayName)) fail('RECORD_INVALID');
  const homeSubjectHash = createHash('sha256')
    .update(JSON.stringify([record.tenantId, record.appId, record.ownerSubjectSha256])).digest('hex');
  return Object.freeze({
    bindingId: `pilot-owner-binding-${homeSubjectHash}`,
    userId: `pilot-owner-user-${homeSubjectHash}`,
    subject: `pilot-owner-${homeSubjectHash}`,
    subjectHash: homeSubjectHash,
    displayName: record.ownerDisplayName,
  });
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
    || record.purpose !== PURPOSE || ![1, 2].includes(record.version)) fail('RECORD_INVALID');
  const expectedKeys = record.version === 1 ? BOUND_RECORD_KEYS : PILOT_RECORD_KEYS;
  if (Object.keys(record).length !== expectedKeys.length
    || expectedKeys.some(key => !Object.hasOwn(record, key))) fail('RECORD_INVALID');
  // Consume whole JSON string tokens, including values with escaped quotes.
  // A flat record has exactly one key token per field.
  const keys = [...text.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?/gu)]
    .filter(match => match[2]).map(match => JSON.parse(match[1]));
  if (keys.length !== expectedKeys.length || new Set(keys).size !== expectedKeys.length
    || keys.some(key => !expectedKeys.includes(key))
    || ['databaseName', 'tenantId', 'appId', 'departmentId']
      .some(key => typeof record[key] !== 'string' || !IDENTIFIER.test(record[key]))) fail('RECORD_INVALID');
  const pilotOwner = record.version === 2 ? pilotOwnerIdentity(record) : null;
  if (pilotOwner) {
    record.bindingId = pilotOwner.bindingId;
    record.authorizationVersion = '1';
  } else if (typeof record.bindingId !== 'string' || !IDENTIFIER.test(record.bindingId)
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
  return Object.freeze({ record: Object.freeze(record), digest, pilotOwner,
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

function requirePilotProfile(enrollment, environment, databaseName = enrollment.record.databaseName) {
  if (enrollment.pilotOwner && (environment !== 'wsl-test' || databaseName !== PILOT_DATABASE
    || enrollment.record.databaseName !== PILOT_DATABASE)) fail('PILOT_OWNER_PROFILE_REQUIRED');
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

async function planPilotOwnerBinding(client, record, owner) {
  // The retired issue_roster_query (0064) used an owner binding for its system principal.
  const { occupied } = (await client.query(`WITH signer_home AS (
      SELECT pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to($2::text || ':' || $4::text, 'UTF8')), 'hex') AS digest
    )
    SELECT EXISTS (
      SELECT 1 FROM backend_identity.subject_bindings AS binding
      WHERE binding.user_id=$1 OR (binding.provider='synthetic' AND binding.tenant=$2 AND (
        binding.subject=$3 OR (binding.role='owner' AND NOT EXISTS (
          SELECT 1 FROM content_intake.principals AS signer CROSS JOIN signer_home
          WHERE binding.enabled
            AND binding.binding_id=pg_catalog.left('sys-query-binding-' || signer_home.digest, 128)
            AND binding.user_id=pg_catalog.left('sys-query-user-' || signer_home.digest, 128)
            AND binding.subject=pg_catalog.left('content-intake-query-signer:' || $4, 256)
            AND binding.subject_hash=pg_catalog.encode(pg_catalog.sha256(
              pg_catalog.convert_to(binding.user_id, 'UTF8')), 'hex')
            AND signer.user_id=binding.user_id
            AND signer.tenant_id=binding.tenant AND signer.app_id=$4
            AND signer.principal_id=pg_catalog.left('sys_query_' || signer_home.digest, 72)
            AND signer.identity_scope='content-intake-system' AND signer.person_key='query-signer'
            AND NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id=binding.user_id)
            AND NOT EXISTS (SELECT 1 FROM content_intake.seat_posts WHERE principal_id=signer.principal_id)
        ))
      ))
    ) OR EXISTS (SELECT 1 FROM public.app_users WHERE user_id=$1) AS occupied`,
  [owner.userId, record.tenantId, owner.subject, record.appId])).rows[0];
  if (occupied) fail('PILOT_OWNER_CONFLICT');
  return {
    binding_id: owner.bindingId, user_id: owner.userId, provider: 'synthetic', tenant: record.tenantId,
    subject: owner.subject, subject_hash: owner.subjectHash, role: 'owner', enabled: true,
    authorization_version: record.authorizationVersion, account_role: 'owner', account_active: true,
  };
}

async function inspectRegistration(client, enrollment) {
  const { record, digest, principalId, assignedBy, pilotOwner } = enrollment;
  const existingBinding = (await client.query(`SELECT binding.binding_id, binding.user_id, binding.provider,
      binding.tenant, binding.role, binding.enabled, binding.authorization_version,
      binding.subject, binding.subject_hash,
      account.role AS account_role,
      account.is_active AS account_active
    FROM backend_identity.subject_bindings AS binding
    LEFT JOIN public.app_users AS account ON account.user_id = binding.user_id
    WHERE binding.binding_id = $1`, [record.bindingId])).rows[0];
  const binding = existingBinding ?? (pilotOwner && await planPilotOwnerBinding(client, record, pilotOwner));
  if (!binding || !binding.enabled || binding.provider !== 'synthetic' || binding.role !== 'owner'
    || binding.tenant !== record.tenantId
    || binding.authorization_version !== record.authorizationVersion
    || SYNTHETIC_IDENTITIES.some(item => item.bindingId === binding.binding_id || item.userId === binding.user_id)
    || isSeatBindingId(binding.binding_id)
    || /^sys-query-binding-[0-9a-f]{64}$/u.test(binding.binding_id)
    || /^usr_seat_[0-9a-f]{31}$/u.test(binding.user_id)
    || /^sys-query-user-[0-9a-f]{64}$/u.test(binding.user_id)) fail('BINDING_NOT_ELIGIBLE');
  if (binding.account_role !== 'owner' || binding.account_active !== true) fail('ACCOUNT_NOT_ELIGIBLE');
  if (pilotOwner && (binding.user_id !== pilotOwner.userId || binding.subject !== pilotOwner.subject
    || binding.subject_hash !== pilotOwner.subjectHash)) fail('PILOT_OWNER_CONFLICT');
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
  if (!principals.length && !posts.length) {
    if (pilotOwner && existingBinding) fail('PILOT_OWNER_CONFLICT');
    return { exists: false, binding, createPilotBinding: pilotOwner !== null };
  }
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

/** Owns one idle DB-owner session. V2 can initialize a pilot identity. Neither version writes credentials or grants. */
export async function registerFirstProductionAdmin(client, { recordBytes, apply = false, environment }) {
  if (typeof apply !== 'boolean') fail('ARGUMENTS_INVALID');
  const enrollment = parseEnrollmentRecord(recordBytes);
  const { record, digest, principalId, assignedBy, pilotOwner } = enrollment;
  requirePilotProfile(enrollment, environment);
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
      if (state.createPilotBinding) {
        await client.query(`INSERT INTO backend_identity.subject_bindings
          (binding_id,provider,tenant,subject,user_id,subject_hash,role,enabled)
          VALUES ($1,'synthetic',$2,$3,$4,$5,'owner',true)`,
        [pilotOwner.bindingId, record.tenantId, pilotOwner.subject, pilotOwner.userId, pilotOwner.subjectHash]);
        await client.query(`INSERT INTO public.app_users (user_id,display_name,role)
          VALUES ($1,$2,'owner')`, [pilotOwner.userId, pilotOwner.displayName]);
      }
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
      recordSha256: digest, principalId, created: apply && !state.exists, wouldCreate: !state.exists,
      ...(pilotOwner ? { bindingId: pilotOwner.bindingId } : {}) });
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
  requirePilotProfile(parseEnrollmentRecord(recordBytes), profile.environment, profile.databaseName);
  const client = new pg.Client({ host: profile.pgSocketDirectory, port: profile.pgPort,
    database: profile.databaseName, user: 'stack_owner', application_name: APPLICATION_NAME,
    connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    process.stdout.write(`${JSON.stringify(await registerFirstProductionAdmin(client,
      { recordBytes, apply: options.apply, environment: profile.environment }))}\n`);
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code:
      error instanceof FirstAdminRegistrationError ? error.code : 'REGISTRATION_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
