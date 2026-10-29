#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ALL_ACTIONS = Object.freeze([
  'query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DEFAULT_REASON = '运营主账号的根授权：由受控 bootstrap 写入，用于逐个授权他人。';

export function parseArguments(argv) {
  const options = { dryRun: false, actions: ALL_ACTIONS, scopes: null, sources: null,
    expiresDays: 30, reason: DEFAULT_REASON, principal: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (seen.has(argument)) throw new Error(`duplicate option ${argument}`);
    seen.add(argument);
    if (argument === '--dry-run') { options.dryRun = true; continue; }
    if (!['--principal', '--actions', '--scopes', '--sources', '--expires-days', '--reason'].includes(argument)) {
      throw new Error(`unknown argument ${argument}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value`);
    if (argument === '--principal') options.principal = value;
    else if (argument === '--expires-days') options.expiresDays = Number(value);
    else if (argument === '--reason') options.reason = value.trim();
    else {
      const list = value.split(',').map(item => item.trim());
      if (list.some(item => !IDENTIFIER.test(item))) throw new Error(`invalid list ${argument}`);
      options[argument.slice(2)] = [...new Set(list)].sort();
    }
  }
  if (!options.principal || !IDENTIFIER.test(options.principal)) throw new Error('--principal must be a principal id');
  if (!Number.isInteger(options.expiresDays) || options.expiresDays < 1 || options.expiresDays > 365) {
    throw new Error('--expires-days must be an integer from 1 to 365');
  }
  if (options.actions.some(action => !ALL_ACTIONS.includes(action))) throw new Error('unknown action');
  if ([...options.reason].length < 1 || [...options.reason].length > 512) throw new Error('reason must contain 1 to 512 characters');
  if (options.sources && (!seen.has('--actions') || !seen.has('--scopes'))) {
    throw new Error('--sources requires explicit --actions and --scopes');
  }
  return options;
}

async function qualifiedAdmin(client, id) {
  const { rows } = await client.query(`
    SELECT p.*, f.department_ids, f.job_id, f.valid_until,
      (f.enabled AND f.checked_at<=clock_timestamp() AND clock_timestamp()<f.valid_until) AS fresh,
      post.department_id AS post_department, post.job_id AS post_job,
      content_intake.password_login_allowed(b.binding_id) AS login_allowed,
      ARRAY(SELECT DISTINCT r.role FROM content_intake.role_rules r
        WHERE r.tenant_id=p.tenant_id AND r.app_id=p.app_id
          AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id) AS roles
    FROM content_intake.principals p
    JOIN content_intake.principal_facts f
      ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
    JOIN backend_identity.subject_bindings b ON b.user_id=p.user_id
    JOIN public.app_users account ON account.user_id=p.user_id AND account.role='owner' AND account.is_active
    JOIN content_intake.seat_posts post
      ON post.principal_id=p.principal_id AND post.tenant_id=p.tenant_id AND post.app_id=p.app_id
    WHERE p.principal_id=$1 AND p.identity_scope='production-admin'
      AND b.enabled AND b.provider='synthetic' AND b.role='owner'`, [id]);
  const admin = rows[0];
  if (rows.length !== 1 || !admin.login_allowed) throw new Error('unique enabled production-admin and controlled post required');
  if (!admin.fresh) throw new Error('production-admin facts expired or disabled');
  if (admin.roles.length !== 1 || admin.roles[0] !== 'director'
    || admin.post_job !== 'job-master-account' || admin.job_id !== admin.post_job
    || admin.department_ids.length !== 1 || admin.department_ids[0] !== admin.post_department) {
    throw new Error('facts must match the controlled master post');
  }
  return admin;
}

async function planGrant(client, admin, item, at, effective) {
  const { rows } = await client.query(`SELECT *,
      (revoked_at IS NULL AND starts_at<=$5 AND expires_at>$5 AND steward_id IS NOT NULL) AS live
    FROM content_intake.grants
    WHERE recipient_id=$1 AND kind=$2 AND scope_id=$3 AND action=$4
      AND (source_id IS NOT DISTINCT FROM $6 OR ($6::text IS NOT NULL AND source_id IS NULL))
    ORDER BY grant_id`, [admin.principal_id, item.kind, item.scopeId, item.action, at, item.sourceId]);
  const root = rows.find(row => row.parent_grant_id === null && row.live
    && (item.kind !== 'business' || (item.action !== 'query'
      || (row.source_id === item.sourceId && row.policy_version === effective?.policy_version
        && row.store_set_version === effective?.store_set_version))));
  if (root && (item.kind !== 'business' || effective)) {
    return { ...item, decision: 'keep', existingGrantId: root.grant_id,
      existingStartsAt: root.starts_at, existingExpiresAt: root.expires_at };
  }
  // An inherited grant is not a stable root. Replacing it here would bypass its
  // parent's revocation, and renewing a dead root could revive dependent grants.
  if (rows.length) throw new Error(`existing authority requires review: ${item.kind}/${item.scopeId}/${item.sourceId ?? '*'}/${item.action}`);
  if (effective) throw new Error('effective source without a provable root requires review');
  return { ...item, decision: 'create', existingGrantId: null };
}

/** Owns the complete transaction. Call on an idle database-owner connection. */
export async function bootstrapIssuerAuthority(client, argv) {
  const options = parseArguments(argv);
  await client.query(`BEGIN ISOLATION LEVEL READ COMMITTED${options.dryRun ? ' READ ONLY' : ''}`);
  try {
    const owner = await client.query(`SELECT current_user=pg_get_userbyid(datdba) AS allowed
      FROM pg_database WHERE datname=current_database()`);
    if (!owner.rows[0]?.allowed) throw new Error('database owner required');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('SELECT backend_review.lock_content()');
    // Identity configuration does not always take lock_content. SHARE prevents a
    // concurrent identity/policy rewrite while this owner checks and inserts grants.
    if (!options.dryRun) await client.query(`LOCK TABLE backend_identity.subject_bindings, public.app_users,
      content_intake.principals, content_intake.principal_facts, content_intake.seat_posts,
      content_intake.role_rules, content_intake.policy_versions, content_intake.scopes,
      content_intake.sources, content_intake.source_mappings, content_intake.store_set_current,
      content_intake.store_set_members IN SHARE MODE`);
    const admin = await qualifiedAdmin(client, options.principal);
    const home = [admin.tenant_id, admin.app_id];
    const stamp = (await client.query(`SELECT pol.version AS policy_version, cur.version AS store_set_version,
      clock_timestamp() AS at, clock_timestamp()+make_interval(days=>$3) AS expires_at
      FROM content_intake.policy_versions pol
      LEFT JOIN content_intake.store_set_current cur USING(tenant_id,app_id)
      WHERE pol.tenant_id=$1 AND pol.app_id=$2`, [...home, options.expiresDays])).rows[0];
    if (!stamp) throw new Error('current policy required');
    const ceiling = await client.query(`SELECT action FROM unnest($1::text[]) action
      WHERE NOT content_intake.role_allows($2,action) OR NOT content_intake.role_may_allocate($2)`,
    [options.actions, admin.roles[0]]);
    if (ceiling.rows.length) throw new Error('requested actions exceed role ceiling');
    const scopes = (await client.query(`SELECT scope_id FROM content_intake.scopes
      WHERE tenant_id=$1 AND app_id=$2 AND ($3::text[] IS NULL OR scope_id=ANY($3)) ORDER BY scope_id`,
    [...home, options.scopes])).rows.map(row => row.scope_id);
    if (!scopes.length || options.scopes?.some(scope => !scopes.includes(scope))) throw new Error('scope outside principal home');
    const sources = options.sources ? (await client.query(`SELECT src.source_id,src.scope_id
      FROM content_intake.sources src JOIN content_intake.source_mappings m
        ON m.source_id=src.source_id AND m.version=src.current_mapping_version
      WHERE src.source_id=ANY($1::text[]) AND src.scope_id=ANY($2::text[]) ORDER BY src.source_id`,
    [options.sources, scopes])).rows : [];
    if (options.sources && (sources.length !== options.sources.length
      || scopes.some(scope => !sources.some(source => source.scope_id === scope)))) {
      throw new Error('every source must belong to a selected scope and every scope must be used');
    }
    let signer = null;
    if (options.sources) {
      const signers = (await client.query(`SELECT p.principal_id FROM content_intake.principals p
        JOIN backend_identity.subject_bindings b ON b.user_id=p.user_id
        WHERE p.tenant_id=$1 AND p.app_id=$2 AND p.identity_scope='content-intake-system'
          AND p.person_key='query-signer'
          AND p.principal_id=left('sys_query_'||encode(sha256(convert_to($1||':'||$2,'UTF8')),'hex'),72)
          AND b.enabled AND b.provider='synthetic' AND b.role='owner'`, home)).rows;
      if (signers.length !== 1) throw new Error('existing system signer required; bootstrap does not create identities');
      signer = signers[0].principal_id;
      if (options.actions.includes('query')) {
        const members = (await client.query(`SELECT source_id FROM content_intake.store_set_members
          WHERE tenant_id=$1 AND app_id=$2 AND version=$3 AND source_id=ANY($4::text[])
            AND content_valid_until>clock_timestamp()`, [...home, stamp.store_set_version, options.sources])).rows;
        if (!stamp.store_set_version || members.length !== options.sources.length) throw new Error('current nonexpired store membership required');
      }
    }
    const plan = [];
    for (const action of options.actions) {
      const effective = (await client.query(`SELECT * FROM content_intake.authorization_sources($1,$2,$3)`,
        [admin.principal_id, action, stamp.at])).rows;
      const targets = options.sources ? sources : scopes.map(scope_id => ({ scope_id, source_id: null }));
      for (const target of targets) {
        const item = { action, scopeId: target.scope_id, sourceId: target.source_id };
        plan.push(await planGrant(client, admin, { ...item, kind: 'allocation' }, stamp.at));
        if (options.sources) plan.push(await planGrant(client, admin, { ...item, kind: 'business' }, stamp.at,
          effective.find(row => row.scope_id === item.scopeId && row.source_id === item.sourceId)));
      }
    }
    const creates = plan.filter(item => item.decision === 'create');
    if (!options.dryRun) {
      for (const item of creates) {
        await client.query(`INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$4,NULL,$13,$14)`,
        [`grant_${randomUUID()}`, item.kind, item.kind === 'business' ? signer : admin.principal_id,
          admin.principal_id, ...home, item.scopeId, item.sourceId, item.action, stamp.at, stamp.expires_at,
          options.reason, item.kind === 'business' && item.action === 'query' ? stamp.policy_version : null,
          item.kind === 'business' && item.action === 'query' ? stamp.store_set_version : null]);
      }
      if (creates.length) await client.query(`UPDATE content_intake.principals
        SET revocation_generation=revocation_generation+1 WHERE principal_id=$1`, [admin.principal_id]);
      await qualifiedAdmin(client, admin.principal_id);
      for (const action of options.actions) {
        if (!options.sources) continue;
        const allowed = (await client.query(`SELECT a.source_id
          FROM content_intake.authorization_sources($1,$2,clock_timestamp()) a
          WHERE $2<>'query' OR EXISTS (SELECT 1 FROM content_intake.store_set_members m
            WHERE m.tenant_id=$3 AND m.app_id=$4 AND m.version=a.store_set_version
              AND m.scope_id=a.scope_id AND m.source_id=a.source_id AND m.content_valid_until>clock_timestamp())`,
          [admin.principal_id, action, ...home])).rows.map(row => row.source_id);
        if (options.sources.some(id => !allowed.includes(id))) throw new Error('postcondition: selected sources are not authorized');
      }
    }
    await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
    return { status: options.dryRun ? 'DRY_RUN' : 'DONE', principal: admin.principal_id,
      factsValidUntil: admin.valid_until, expiresAt: stamp.expires_at, policyVersion: stamp.policy_version,
      storeSetVersion: stamp.store_set_version, created: options.dryRun ? 0 : creates.length,
      wouldCreate: creates.length, kept: plan.length - creates.length, plan };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  parseArguments(argv);
  const root = process.env.CUSTOMER_AGENT_STACK_ROOT ?? '/srv/customer-agent/stack';
  const profile = JSON.parse(readFileSync(path.join(root, 'profile.json'), 'utf8'));
  if (typeof profile.databaseName !== 'string' || !IDENTIFIER.test(profile.databaseName)
    || typeof profile.pgSocketDirectory !== 'string' || !path.isAbsolute(profile.pgSocketDirectory)
    || !Number.isInteger(profile.pgPort) || profile.pgPort < 1 || profile.pgPort > 65535) {
    throw new Error('profile requires databaseName, absolute pgSocketDirectory and numeric pgPort');
  }
  const client = new pg.Client({ host: profile.pgSocketDirectory, port: profile.pgPort,
    database: profile.databaseName, user: 'stack_owner', application_name: 'issuer-authority-bootstrap' });
  await client.connect();
  try { console.info(JSON.stringify(await bootstrapIssuerAuthority(client, argv), null, 2)); }
  finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`FATAL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
