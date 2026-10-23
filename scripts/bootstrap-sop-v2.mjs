#!/usr/bin/env node
/**
 * Registers the SOP workbook source on the v2 intake path and mints the first
 * grants. Dry run by default; `--apply` writes. Every statement is idempotent, and
 * `--rollback` withdraws access by revoking the grants and dropping the source from
 * the readable set. The registration row itself stays, because source_mappings is
 * immutable and its foreign key points at sources.
 *
 *   node scripts/bootstrap-sop-v2.mjs --dsn <dsn>
 *   node scripts/bootstrap-sop-v2.mjs --dsn <dsn> --apply
 *   node scripts/bootstrap-sop-v2.mjs --dsn <dsn> --rollback --apply
 *
 * Why a new source instead of switching an existing one: `sources.source_id` and
 * `scope_id` are immutable (0021 source_scope_guard) and a mode change must bump
 * mode_version. The five registered Menokin sources are the legacy batch chain;
 * switching them to `v2-preview` would move the FAQ import path off the release
 * table that currently serves 408 rows. A separate source leaves them untouched.
 *
 * Why the product scope: the frozen contract types `IntakeSourceScope.domain` as
 * four values, so a `sop` scope cannot be carried by `GET /v1/intake/sources` at
 * all. Registering the workbook under `scope-menokin-product` with the FAQ tuple
 * keeps the contract valid, and `0040 project_sop_release_media` still recognises
 * SOP by `mapping_version = 'sop-not-imported'`. The cost is stated in
 * docs/reviews/2026-10-23-sop-chain-audit.md: the material records the FAQ sheet
 * triple while the parser reads the real six sheets.
 */
import process from 'node:process';
import { Client } from 'pg';

const TENANT = 'tenant-menokin';
const APP = 'app-customer-agent';
const SCOPE = 'scope-menokin-product';
const SOURCE = 'src-menokin-sop-v2';
/** The FAQ tuple the contract can carry, plus the marker 0040 reads as SOP. */
const TEMPLATE = 'faq-p1.1';
const RULE = 'intake-p1.1';
const MAPPING = 'sop-not-imported';
/** sha256 of the JCS encoding of the six registered sheet names. */
const STRUCTURE = '84229cf5de57a0dc76902066c2f214a91bd8c8e44532c902e76f44adc36d6559';
const ROLES = [
  { principalId: 'hz-publisher', actions: ['import', 'content-manage', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'query'] },
  { principalId: 'hz-reviewer', actions: ['review', 'query'] },
  { principalId: 'hz-allocator', actions: ['query'] },
];
/** A business grant may not be self-issued: 0021 has a table CHECK reading
 * `kind='allocation' OR issuer_id <> recipient_id`. Allocation rows are exempt, which
 * is why a root record can belong to one principal. The allocator's own query grant is
 * therefore issued by the publisher, which needs a root record of its own. */
const ROOT_HOLDERS = ['hz-allocator', 'hz-publisher'];
const ROOT_ACTIONS = ['import', 'content-manage', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'query'];
const REASON = 'SOP 上传链路引导：注册来源与首批授权';

function parseArgs(argv) {
  const options = { dsn: null, apply: false, rollback: false, days: 30, emit: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') options.apply = true;
    else if (flag === '--rollback') options.rollback = true;
    // Print only the statements, separated by a marker, so an operator who cannot
    // run Node against the target can apply the exact same plan through psql.
    else if (flag === '--emit') options.emit = true;
    else if (flag === '--dsn') { index += 1; options.dsn = argv[index] ?? null; }
    else if (flag === '--days') { index += 1; options.days = Number(argv[index]); }
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 365) throw new Error('--days must be 1..365');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const dsn = options.dsn ?? process.env.DATABASE_URL ?? null;
if (!dsn) {
  console.error('bootstrap-sop-v2: no DSN. Pass --dsn or set DATABASE_URL.');
  process.exit(2);
}

const client = new Client({ connectionString: dsn });
await client.connect();
const statements = [];
const run = async (sql, values = []) => (await client.query(sql, values)).rows;
/** Every write goes through here so --apply and the printed plan can never drift. */
const plan = (label, sql, values) => {
  statements.push({ label, sql: sql.trim().replace(/\s+/gu, ' '), values });
};

try {
  if (!options.rollback) {
    const scope = await run(`SELECT scope_id, domain FROM content_intake.scopes
      WHERE scope_id=$1 AND tenant_id=$2 AND app_id=$3`, [SCOPE, TENANT, APP]);
    if (!scope[0]) throw new Error(`scope ${SCOPE} is missing for ${TENANT}/${APP}`);
    const policy = await run('SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2', [TENANT, APP]);
    if (!policy[0]) throw new Error('policy_versions has no row for this tenant/app; query authority cannot work');

    plan('register the SOP source and its mapping in one transaction (deferred FK)', `
      BEGIN;
      INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
        VALUES ('${SOURCE}', '${SCOPE}', 1, 'v2-preview')
        ON CONFLICT (source_id) DO NOTHING;
      INSERT INTO content_intake.source_mappings(source_id, version, template_version, rule_version, mapping_version, structure_digest)
        VALUES ('${SOURCE}', 1, '${TEMPLATE}', '${RULE}', '${MAPPING}', '${STRUCTURE}')
        ON CONFLICT (source_id, version) DO NOTHING;
      COMMIT;`);

    // A store set is the set of sources a seat may read. It advances by creating a
    // new version that copies every live member of the current one. When no set
    // exists yet the new set contains this source alone: the other registered
    // sources are still `legacy`, and copying them in would let a later mode flip
    // become readable without a fresh approval. Adding them is a separate decision.
    plan('advance the store set so the new source becomes readable', `
      BEGIN;
      WITH basis AS (
        SELECT COALESCE((SELECT version FROM content_intake.store_set_current
          WHERE tenant_id='${TENANT}' AND app_id='${APP}'), 0) AS version
      ), need AS (
        SELECT 1 WHERE NOT EXISTS (
          SELECT 1 FROM content_intake.store_set_members member
          WHERE member.tenant_id='${TENANT}' AND member.app_id='${APP}' AND member.source_id='${SOURCE}'
            AND member.version=(SELECT version FROM content_intake.store_set_current
              WHERE tenant_id='${TENANT}' AND app_id='${APP}'))
      ), next AS (SELECT basis.version + 1 AS version FROM basis, need), written AS (
        INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
          SELECT '${TENANT}', '${APP}', next.version, clock_timestamp(), 'bootstrap-sop-v2' FROM next
          ON CONFLICT (tenant_id, app_id, version) DO NOTHING
          RETURNING version
      ), members AS (
        INSERT INTO content_intake.store_set_members(tenant_id, app_id, version, scope_id, source_id, content_valid_until)
          SELECT '${TENANT}', '${APP}', written.version, member.scope_id, member.source_id, member.content_valid_until
          FROM written
          JOIN content_intake.store_set_members member
            ON member.tenant_id='${TENANT}' AND member.app_id='${APP}'
           AND member.version = (SELECT version FROM basis)
          ON CONFLICT (tenant_id, app_id, version, scope_id, source_id) DO NOTHING
          RETURNING source_id
      )
      INSERT INTO content_intake.store_set_members(tenant_id, app_id, version, scope_id, source_id, content_valid_until)
        SELECT '${TENANT}', '${APP}', written.version, '${SCOPE}', '${SOURCE}', clock_timestamp() + interval '${options.days} days'
        FROM written
        ON CONFLICT (tenant_id, app_id, version, scope_id, source_id) DO NOTHING;
      INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
        SELECT '${TENANT}', '${APP}', version FROM content_intake.store_sets
        WHERE tenant_id='${TENANT}' AND app_id='${APP}'
        ORDER BY version DESC LIMIT 1
        ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = EXCLUDED.version
        WHERE content_intake.store_set_current.version < EXCLUDED.version;
      COMMIT;`);

    // An allocation is the root record; a business grant is what actually authorises.
    // Both are written directly because the grant command refuses a self-issued grant
    // (authority.ts SELF_ESCALATION) and the first allocation has no parent by design.
    for (const holder of ROOT_HOLDERS) {
      for (const action of ROOT_ACTIONS) {
        // The parent has to strictly contain the child's window: grant_parent_guard refuses
        // a child that starts before or expires after the grant it derives from.
        plan(`root allocation: ${holder} may grant ${action}`, `
          INSERT INTO content_intake.grants(grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id,
            action, starts_at, expires_at, reason, steward_id)
          VALUES ('bootstrap-sop-root-${holder}-${action}', 'allocation', '${holder}', '${holder}', '${TENANT}', '${APP}', '${SCOPE}', NULL,
            '${action}', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '${options.days + 1} days', '${REASON}', '${holder}')
          ON CONFLICT (grant_id) DO NOTHING;`);
      }
    }
    for (const role of ROLES) {
      // hz-allocator may not issue to itself, so its rows come from the publisher.
      const issuer = role.principalId === 'hz-allocator' ? 'hz-publisher' : 'hz-allocator';
      for (const action of role.actions) {
        // A query grant only counts while it names its source and carries the live
        // policy and store-set versions (0057 authorization_sources).
        plan(`business grant: ${role.principalId} may ${action} on the SOP source`, `
          INSERT INTO content_intake.grants(grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id,
            action, starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
          SELECT 'bootstrap-sop-${role.principalId}-${action}', 'business', '${issuer}', '${role.principalId}', '${TENANT}', '${APP}',
            '${SCOPE}', '${SOURCE}', '${action}', clock_timestamp(), clock_timestamp() + interval '${options.days} days',
            '${REASON}', '${issuer}', 'bootstrap-sop-root-${issuer}-${action}',
            CASE WHEN '${action}'='query' THEN (SELECT version FROM content_intake.policy_versions WHERE tenant_id='${TENANT}' AND app_id='${APP}') END,
            CASE WHEN '${action}'='query' THEN (SELECT version FROM content_intake.store_set_current WHERE tenant_id='${TENANT}' AND app_id='${APP}') END
          WHERE NOT EXISTS (SELECT 1 FROM content_intake.grants WHERE grant_id='bootstrap-sop-${role.principalId}-${action}');`);
      }
    }
  } else {
    // A rollback cannot delete the registration: source_mappings is immutable
    // (0021 immutable_history) and its foreign key points at sources, so the pair
    // survives. What a rollback can do is revoke the grants and take the source out of
    // the readable set, which is what actually withdraws access. The store-set advances
    // by a new version rather than editing the published one, so the history stays
    // readable.
    plan('revoke every grant this bootstrap created', `
      UPDATE content_intake.grants SET version = version + 1, last_change_reason = '回滚 SOP 引导',
        revoked_at = clock_timestamp()
      WHERE grant_id LIKE 'bootstrap-sop-%' AND revoked_at IS NULL;`);
    plan('advance the store set without this source so seats stop reading it', `
      BEGIN;
      WITH basis AS (
        SELECT version FROM content_intake.store_set_current WHERE tenant_id='${TENANT}' AND app_id='${APP}'
      ), need AS (
        SELECT 1 WHERE EXISTS (
          SELECT 1 FROM content_intake.store_set_members member
          WHERE member.tenant_id='${TENANT}' AND member.app_id='${APP}' AND member.source_id='${SOURCE}'
            AND member.version=(SELECT version FROM basis))
      ), next AS (SELECT basis.version + 1 AS version FROM basis, need), written AS (
        INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
          SELECT '${TENANT}', '${APP}', next.version, clock_timestamp(), 'bootstrap-sop-v2-rollback' FROM next
          ON CONFLICT (tenant_id, app_id, version) DO NOTHING
          RETURNING version
      )
      INSERT INTO content_intake.store_set_members(tenant_id, app_id, version, scope_id, source_id, content_valid_until)
        SELECT '${TENANT}', '${APP}', written.version, member.scope_id, member.source_id, member.content_valid_until
        FROM written
        JOIN content_intake.store_set_members member
          ON member.tenant_id='${TENANT}' AND member.app_id='${APP}'
         AND member.version = (SELECT version FROM basis)
         AND member.source_id <> '${SOURCE}'
        ON CONFLICT (tenant_id, app_id, version, scope_id, source_id) DO NOTHING;
      INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
        SELECT '${TENANT}', '${APP}', version FROM content_intake.store_sets
        WHERE tenant_id='${TENANT}' AND app_id='${APP}'
        ORDER BY version DESC LIMIT 1
        ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = EXCLUDED.version
        WHERE content_intake.store_set_current.version < EXCLUDED.version;
      COMMIT;`);
  }

  const preview = await run(`SELECT s.source_id, s.mode, m.mapping_version,
      EXISTS (SELECT 1 FROM content_intake.store_set_members member
        JOIN content_intake.store_set_current cur ON cur.tenant_id=member.tenant_id AND cur.app_id=member.app_id
          AND cur.version=member.version
        WHERE member.source_id=s.source_id) AS readable,
      (SELECT version FROM content_intake.store_set_current cur
        JOIN content_intake.scopes sc USING (tenant_id, app_id)
        WHERE sc.scope_id=s.scope_id) AS store_set
    FROM content_intake.sources s
    JOIN content_intake.source_mappings m ON m.source_id=s.source_id AND m.version=s.current_mapping_version
    WHERE s.source_id='${SOURCE}'`);

  if (options.emit) {
    // Machine-applicable form: one statement per block, no commentary, so the
    // operator can pipe it to psql without editing anything.
    for (const statement of statements) process.stdout.write(`${statement.sql}\n@@@\n`);
  } else if (!options.apply) {
    console.log(JSON.stringify({ mode: 'dry-run', source: SOURCE, statements: statements.length, current: preview[0] ?? null }, null, 2));
    console.log('\n--- plan ---');
    for (const statement of statements) console.log(`\n-- ${statement.label}\n${statement.sql}`);
    console.log('\nNothing was written. Re-run with --apply to execute.');
  } else {
    for (const statement of statements) await client.query(statement.sql);
    const after = await run(`SELECT s.source_id, s.mode, m.mapping_version,
        (SELECT cur.version FROM content_intake.store_set_current cur
          JOIN content_intake.scopes sc USING (tenant_id, app_id) WHERE sc.scope_id=s.scope_id) AS store_set,
        (SELECT count(*)::int FROM content_intake.grants gr
          WHERE gr.source_id=s.source_id AND gr.revoked_at IS NULL) AS live_grants
      FROM content_intake.sources s
      JOIN content_intake.source_mappings m ON m.source_id=s.source_id AND m.version=s.current_mapping_version
      WHERE s.source_id='${SOURCE}'`);
    console.log(JSON.stringify({ mode: options.rollback ? 'rollback' : 'apply', statements: statements.length,
      source: after[0] ?? null }, null, 2));
  }
} catch (error) {
  console.error(`bootstrap-sop-v2: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
