#!/usr/bin/env node
/**
 * Read-only readiness audit for serving a SOP workbook on the v2 intake path.
 *
 * Prints what a SOP go-live WOULD need and what is still missing. It never
 * writes: every statement it prints is for a human to review and run. There is
 * no --apply here on purpose — enabling v2 for the first time also mints
 * business grants, and who may sign those is an organisational decision, not a
 * script default.
 *
 *   node scripts/audit-sop-v2-readiness.mjs
 *   node scripts/audit-sop-v2-readiness.mjs --dsn postgresql://...
 *   node scripts/audit-sop-v2-readiness.mjs --json > readiness.json
 *
 * Why this exists: the SOP publish trigger (0040 project_sop_release_media)
 * decides "is this a SOP candidate?" by (domain='sop' OR template='sop-v1' OR
 * rule='sop-not-imported' OR mapping='sop-not-imported'). The frozen contract
 * still types IntakeMaterial as a two-variant union and IntakeSourceScope as
 * four domains, so a real `sop` scope cannot be built in JS at all. Registering
 * the workbook under an existing `product` scope with mapping='sop-not-imported'
 * satisfies both sides: SQL still recognises SOP, and the contract still sees a
 * FAQ-shaped material. That is a deliberate, documented compromise — the
 * material's selectedSheets then names the FAQ triple rather than the six real
 * sheet names, which only an upstream contract change can fix.
 */
import process from 'node:process';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

/** Sheet names of the Menokin SOP workbook, in registered order. */
const SOP_SHEETS = ['过敏流程SOP', '少错破SOP', '品质售后SOP', '税收相关规则', '品牌对接资源汇总', '长痘痘SOP'];
/** The probe tuple the DB accepts for a SOP mapping; TS recognises `sop-v1` too
 * but cannot build a contract-valid material for it (see the header note). */
const SOP_MAPPING_MARKER = 'sop-not-imported';
/** sha256 over the JCS encoding of SOP_SHEETS, kept literal so the printed plan
 * is reproducible without reading this file's helper; recomputed below so the
 * two can never drift. */
const SOP_SHEETS_SHA256 = '84229cf5de57a0dc76902066c2f214a91bd8c8e44532c902e76f44adc36d6559';
{
  const computed = createHash('sha256').update(Buffer.from(JSON.stringify(SOP_SHEETS), 'utf8')).digest('hex');
  if (computed !== SOP_SHEETS_SHA256) throw new Error(`SOP sheet digest drifted: ${computed}`);
}

function parseArgs(argv) {
  const options = { dsn: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') options.json = true;
    else if (flag === '--dsn') { index += 1; options.dsn = argv[index] ?? null; }
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const dsn = options.dsn ?? process.env.DATABASE_URL ?? process.env.CONTENT_ADMIN_DATABASE_URL ?? null;
if (!dsn) {
  console.error('audit-sop-v2-readiness: no DSN. Pass --dsn or set DATABASE_URL.');
  console.error('Refusing to guess a connection: this report names grants and scopes.');
  process.exit(2);
}

const client = new Client({ connectionString: dsn });
await client.connect();
try {
  // Read-only transaction: a mistyped statement here cannot become a write.
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  const one = async (sql, values = []) => (await client.query(sql, values)).rows;
  const report = {};

  report.sources = await one(`SELECT s.source_id, s.mode, s.mode_version, s.current_mapping_version,
      s.scope_id, sc.domain, m.template_version, m.rule_version, m.mapping_version,
      (sc.domain = 'sop' OR m.template_version = 'sop-v1' OR m.rule_version = 'sop-not-imported'
        OR m.mapping_version = $1) AS served_as_sop
    FROM content_intake.sources s
    JOIN content_intake.scopes sc USING (scope_id)
    JOIN content_intake.source_mappings m ON m.source_id = s.source_id AND m.version = s.current_mapping_version
    ORDER BY s.source_id`, [SOP_MAPPING_MARKER]);

  report.scopes = await one(`SELECT scope_id, tenant_id, app_id, brand_id, shop_id, domain
    FROM content_intake.scopes ORDER BY scope_id`);
  report.policyVersions = await one(`SELECT tenant_id, app_id, version FROM content_intake.policy_versions ORDER BY tenant_id, app_id`);
  report.storeSets = await one(`SELECT tenant_id, app_id, version FROM content_intake.store_set_current ORDER BY tenant_id, app_id`);
  report.storeSetMembers = await one(`SELECT tenant_id, app_id, version, count(*)::int AS members
    FROM content_intake.store_set_members GROUP BY 1,2,3 ORDER BY version DESC`);
  report.grants = await one(`SELECT kind, action, count(*)::int AS live
    FROM content_intake.grants WHERE revoked_at IS NULL GROUP BY 1,2 ORDER BY 1,2`);
  report.principals = await one(`SELECT principal_id, tenant_id, app_id FROM content_intake.principals ORDER BY principal_id`);
  report.currentRelease = await one(`SELECT current_release_id FROM public.content_current WHERE id = 1`);

  const currentMembers = report.storeSets.length
    ? await one(`SELECT source_id FROM content_intake.store_set_members
        WHERE (tenant_id, app_id, version) IN (SELECT tenant_id, app_id, version FROM content_intake.store_set_current)`)
    : [];
  const memberSources = new Set(currentMembers.map(row => row.source_id));

  // Each gap is a separate thing a human decides or does, so they stay separate
  // rather than collapsing into one "not ready" verdict.
  const sopSources = report.sources.filter(row => row.served_as_sop);
  const v2SopSources = sopSources.filter(row => row.mode === 'v2-preview');
  report.gaps = [
    { key: 'sop-source', ok: sopSources.length > 0,
      detail: sopSources.length ? `${sopSources.length} source(s) would be parsed as SOP` : 'no source is recognised as SOP' },
    { key: 'v2-preview-mode', ok: v2SopSources.length > 0,
      detail: v2SopSources.length ? `${v2SopSources.length} SOP source(s) in v2-preview` : 'upload refuses a legacy source with MODE_CONFLICT (files.ts:44)' },
    { key: 'policy-version', ok: report.policyVersions.length > 0,
      detail: report.policyVersions.length ? `policy ${report.policyVersions[0].version}` : 'query authority joins policy_versions (0050); empty means no seat can read' },
    { key: 'store-set', ok: report.storeSets.length > 0,
      detail: report.storeSets.length ? `store set v${report.storeSets[0].version}` : 'authorization_sources requires current store_set membership (0050); empty means zero reachable sources' },
    { key: 'store-set-member', ok: v2SopSources.some(row => memberSources.has(row.source_id)),
      detail: 'a source outside the current store set is invisible to every seat even with a live grant' },
    { key: 'query-grant', ok: report.grants.some(row => row.action === 'query'),
      detail: 'agent query needs a live business grant; signatures are an organisational decision' },
    { key: 'import-grant', ok: report.grants.some(row => row.action === 'import'),
      detail: 'upload needs import authority on the exact source' },
  ];

  const tenant = report.policyVersions[0]?.tenant_id ?? null;
  const app = report.policyVersions[0]?.app_id ?? null;
  const productScope = report.scopes.find(row => row.domain === 'product'
    && row.tenant_id === tenant && row.app_id === app);
  report.plan = {
    shortcut: productScope ? {
      why: 'Keeps the frozen contract valid: material stays FAQ-shaped while SQL still sees a SOP mapping.',
      caveat: 'material.selectedSheets will read the FAQ triple, not the six real sheet names. Only an upstream contract variant fixes that.',
      sql: [
        'BEGIN; -- required: sources.current_mapping_version is FKs to source_mappings',
        '       -- DEFERRABLE INITIALLY DEFERRED, so both rows must commit together.',
        '-- 1. register a NEW source; source_id/scope_id are immutable on an existing row (0021 source_scope_guard)',
        'INSERT INTO content_intake.sources (source_id, scope_id, current_mapping_version, mode)',
        `VALUES ('src-menokin-sop-v2', '${productScope.scope_id}', 1, 'v2-preview');`,
        '-- 2. FAQ tuple carries the mapping marker: the DB matches the FAQ branch of',
        '--    input_format_matches, while 0040 recognises SOP by mapping_version alone.',
        'INSERT INTO content_intake.source_mappings',
        '  (source_id, version, template_version, rule_version, mapping_version, structure_digest)',
        `VALUES ('src-menokin-sop-v2', 1, 'faq-p1.1', 'intake-p1.1', '${SOP_MAPPING_MARKER}', '${SOP_SHEETS_SHA256}');`,
        `--    (${SOP_SHEETS_SHA256} is sha256 of the JCS sheet-name array, not of a file.)`,
        'COMMIT;',
        '-- 3. store set: new version copying every live member plus this source (0049 shape;',
        '--    never mutate a published set), then move store_set_current to it.',
        '-- 4. grants: signed through the 权限 page or the director API, never by SQL here.',
      ],
    } : null,
    correct: {
      why: 'Register with the real sop-v1 tuple and a sop scope.',
      blockedBy: [
        'packages/contracts: IntakeMaterial is a two-variant union (faq-p1.1 / faq-csv-v1); no sop-v1 variant.',
        'packages/contracts: IntakeSourceScope.domain omits sop, so IntakeSourceList cannot carry the source.',
        '0034 candidate_format_guard pins selectedSheets for every non-CSV object to the FAQ triple.',
        'public.release_source_bindings and authoritative_source_versions CHECK omit sop.',
      ],
      sql: null,
    },
  };

  await client.query('ROLLBACK');
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else print(report);
} finally {
  await client.end();
}

function table(rows) {
  if (!rows.length) return '  (empty)';
  const columns = Object.keys(rows[0]);
  const widths = columns.map(column => Math.max(column.length, ...rows.map(row => String(row[column] ?? '').length)));
  const line = cells => cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ');
  return [`  ${line(columns)}`, `  ${widths.map(width => '-'.repeat(width)).join('  ')}`,
    ...rows.map(row => `  ${line(columns.map(column => row[column]))}`)].join('\n');
}

function print(report) {
  const out = [];
  out.push('== sources ==', table(report.sources));
  out.push('', '== scopes ==', table(report.scopes));
  out.push('', '== current release ==', table(report.currentRelease));
  out.push('', '== policy / store set ==', table(report.policyVersions), table(report.storeSets), table(report.storeSetMembers));
  out.push('', '== live grants ==', table(report.grants));
  out.push('', '== principals ==', table(report.principals));
  out.push('', '== readiness ==');
  for (const gap of report.gaps) out.push(`  [${gap.ok ? 'ok  ' : 'GAP '}] ${gap.key.padEnd(18)} ${gap.detail}`);
  const missing = report.gaps.filter(gap => !gap.ok);
  out.push('', missing.length ? `${missing.length} gap(s) block a SOP go-live.` : 'No gaps: the v2 SOP path is ready.');
  if (report.plan.shortcut) {
    out.push('', '== plan: shortcut (contract-compatible) ==', `  ${report.plan.shortcut.why}`,
      `  caveat: ${report.plan.shortcut.caveat}`);
    for (const line of report.plan.shortcut.sql) out.push(`  ${line}`);
  } else {
    out.push('', '== plan: shortcut ==', '  none — no product scope exists on the policy tenant/app');
  }
  out.push('', '== plan: correct (blocked upstream) ==', `  ${report.plan.correct.why}`);
  for (const blocker of report.plan.correct.blockedBy) out.push(`  - ${blocker}`);
  out.push('', 'Nothing above was executed: this run was read-only.');
  process.stdout.write(`${out.join('\n')}\n`);
}
