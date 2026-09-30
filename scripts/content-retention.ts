#!/usr/bin/env node
/**
 * Content-retention report and reaper for the intermediate-state tables.
 *
 * Prints what a sweep WOULD delete. Deletes nothing unless both `--apply` and
 * `--confirm <count>` are passed, where <count> must equal the number of rows the
 * dry run reported this invocation. There is no way to delete without first
 * seeing the count, so a typo cannot turn into a silent mass delete.
 *
 *   node scripts/content-retention.ts                        # dry run, all groups
 *   node scripts/content-retention.ts --group failed-imports
 *   node scripts/content-retention.ts --apply --confirm 12   # after reviewing a dry run
 *
 * Connection: DATABASE_URL, or CONTENT_ADMIN_DATABASE_URL, or --dsn. Refuses to
 * run without one rather than defaulting to a guess.
 *
 * Why each group exists (from the 2026-09-30 eng review, section "8 条扣分项"):
 *   published-imports  never swept — deleting them makes an import irreproducible.
 *   failed-imports     safe after N days; the operator already saw the error and re-sent.
 *   stuck-staged       needs judgement, not a timer; reported, never auto-deleted.
 *   orphan-mutations   a state that can never resolve itself; reported with ids.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'pg';

/** Defaults are deliberately conservative: only the group with a clear rationale sweeps. */
const DEFAULTS = Object.freeze({
  failedImportDays: 30,
  stuckStagedDays: 14,
});

const GROUPS = Object.freeze(['published-imports', 'failed-imports', 'stuck-staged', 'orphan-mutations']);

function parseArgs(argv) {
  const options = {
    apply: false,
    confirm: null,
    dsn: null,
    groups: [],
    failedImportDays: DEFAULTS.failedImportDays,
    stuckStagedDays: DEFAULTS.stuckStagedDays,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm') options.confirm = Number(argv[++index]);
    else if (arg === '--dsn') options.dsn = argv[++index] ?? null;
    else if (arg === '--group') options.groups.push(argv[++index]);
    else if (arg === '--failed-import-days') options.failedImportDays = Number(argv[++index]);
    else if (arg === '--stuck-staged-days') options.stuckStagedDays = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'usage: node scripts/content-retention.ts [--group <g>]... [--apply --confirm <n>]',
    `  --group            one of: ${GROUPS.join(', ')} (repeatable; default all)`,
    `  --failed-import-days  default ${DEFAULTS.failedImportDays}`,
    `  --stuck-staged-days   default ${DEFAULTS.stuckStagedDays}`,
    '  --apply            actually delete (requires --confirm)',
    '  --confirm <n>      must equal the dry-run total; guards against blind deletes',
    '  --dsn <url>        override DATABASE_URL / CONTENT_ADMIN_DATABASE_URL',
  ].join('\n');
}

/** api.env is line-oriented KEY=VALUE; reuse the repo's parser rather than re-inventing it. */
function parseEnvFile(contents) {
  const out = new Map();
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

function resolveDsn(options) {
  if (options.dsn) return options.dsn;
  const fromEnv = process.env.DATABASE_URL ?? process.env.CONTENT_ADMIN_DATABASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  // homedir() rather than `process.env.HOME ?? ''`: an unset HOME made the join
  // produce the RELATIVE path `.customer-agent-formal/api.env`, which then
  // resolved against the current working directory. Running this from any
  // directory that happened to contain that file would read the wrong
  // credentials with no error. homedir() falls back to the passwd entry instead.
  const envFile = path.join(homedir(), '.customer-agent-formal', 'api.env');
  try {
    const parsed = parseEnvFile(readFileSync(envFile, 'utf8'));
    const dsn = parsed.get('DATABASE_URL') ?? parsed.get('CONTENT_ADMIN_DATABASE_URL');
    if (dsn && dsn.trim().length > 0) return dsn.trim();
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error('no database url: set DATABASE_URL, or pass --dsn, or provide ~/.customer-agent-formal/api.env');
}

/**
 * Every query is a SELECT. The sweep reads ids first and deletes exactly those
 * ids, so the reported count and the deleted set cannot drift between statements.
 */
const QUERIES = Object.freeze({
  'published-imports': `
    SELECT b.import_batch_id, b.status, b.created_at, b.finished_at,
           (SELECT count(*) FROM public.staging_scripts s WHERE s.import_batch_id = b.import_batch_id) AS rows
    FROM public.import_batches b
    WHERE b.status = 'published'
    ORDER BY b.created_at
  `,
  'failed-imports': `
    SELECT b.import_batch_id, b.status, b.created_at, b.finished_at,
           (SELECT count(*) FROM public.staging_scripts s WHERE s.import_batch_id = b.import_batch_id) AS rows
    FROM public.import_batches b
    WHERE b.status = 'failed'
      AND COALESCE(b.finished_at, b.created_at) < now() - ($1::int * interval '1 day')
    ORDER BY b.created_at
  `,
  'stuck-staged': `
    SELECT b.import_batch_id, b.status, b.created_at, b.finished_at,
           (SELECT count(*) FROM public.staging_scripts s WHERE s.import_batch_id = b.import_batch_id) AS rows
    FROM public.import_batches b
    WHERE b.status = 'staged'
      AND b.created_at < now() - ($1::int * interval '1 day')
    ORDER BY b.created_at
  `,
  'orphan-mutations': `
    SELECT m.mutation_id, m.script_id, m.action, m.created_at
    FROM ops_loop.script_mutations m
    JOIN public.scripts s ON s.script_id = m.script_id
    WHERE s.status = 'archived'
    ORDER BY m.created_at
  `,
});

/**
 * Only failed-imports is sweepable automatically. published-imports must survive
 * (removing them makes a release irreproducible), and the other two require a
 * human decision, so they are reported with ids and never deleted here.
 */
const SWEEPABLE = Object.freeze(new Set(['failed-imports']));

async function collect(client, group, options) {
  if (group === 'failed-imports') {
    const { rows } = await client.query(QUERIES[group], [options.failedImportDays]);
    return rows;
  }
  if (group === 'stuck-staged') {
    const { rows } = await client.query(QUERIES[group], [options.stuckStagedDays]);
    return rows;
  }
  const { rows } = await client.query(QUERIES[group]);
  return rows;
}

/** Reap one batch and its staging rows in a single transaction. */
async function sweepBatch(client, importBatchId) {
  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM public.staging_scripts WHERE import_batch_id = $1', [importBatchId]);
    await client.query('DELETE FROM public.import_batches WHERE import_batch_id = $1', [importBatchId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function formatRows(group, rows) {
  if (rows.length === 0) return [`  (none)`];
  return rows.map((row) => {
    if (row.import_batch_id !== undefined) {
      const stamp = (row.finished_at ?? row.created_at)?.toISOString?.() ?? String(row.created_at);
      return `  ${row.import_batch_id}  ${row.status.padEnd(9)}  ${String(row.rows).padStart(5)} 行  ${stamp}`;
    }
    const stamp = row.created_at?.toISOString?.() ?? String(row.created_at);
    return `  ${row.mutation_id}  脚本 ${row.script_id}  ${row.action}  ${stamp}`;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.apply && !Number.isSafeInteger(options.confirm)) {
    process.stderr.write('--apply requires --confirm <n> with the count from a dry run\n');
    return 2;
  }
  const groups = options.groups.length > 0 ? options.groups : [...GROUPS];
  for (const group of groups) {
    if (!GROUPS.includes(group)) {
      process.stderr.write(`unknown group: ${group}\n${usage()}\n`);
      return 2;
    }
  }

  const client = new Client({ connectionString: resolveDsn(options) });
  await client.connect();
  let total = 0;
  const sweepPlan = [];
  try {
    for (const group of groups) {
      const rows = await collect(client, group, options);
      total += rows.length;
      process.stdout.write(`\n[${group}] ${rows.length} 行\n`);
      process.stdout.write(`${formatRows(group, rows).join('\n')}\n`);
      if (SWEEPABLE.has(group)) {
        for (const row of rows) sweepPlan.push(row.import_batch_id);
      } else {
        process.stdout.write(`  → 本组不自动删除${group === 'published-imports' ? '（删除会让导入不可复现）' : '（需人工决定，此处只列出 id）'}\n`);
      }
    }

    process.stdout.write(`\n合计 ${total} 行；可自动清理 ${sweepPlan.length} 个批次。\n`);
    if (!options.apply) {
      process.stdout.write(`干跑结束，未删除任何行。确认后执行：\n  node scripts/content-retention.ts --group failed-imports --apply --confirm ${sweepPlan.length}\n`);
      return 0;
    }
    if (options.confirm !== sweepPlan.length) {
      process.stderr.write(`--confirm ${options.confirm} 与本次干跑统计 ${sweepPlan.length} 不一致，已中止（防止误删）。\n`);
      return 2;
    }
    for (const importBatchId of sweepPlan) {
      await sweepBatch(client, importBatchId);
      process.stdout.write(`已删除批次 ${importBatchId}\n`);
    }
    process.stdout.write(`\n已删除 ${sweepPlan.length} 个批次。\n`);
    return 0;
  } finally {
    await client.end();
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
