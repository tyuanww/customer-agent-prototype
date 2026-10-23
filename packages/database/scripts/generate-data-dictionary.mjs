#!/usr/bin/env node
/**
 * Generates the data dictionary under `docs/database/dictionary/` from a real database.
 *
 * Read-only: it issues SELECTs against the catalog and never writes to the database. The
 * generated Markdown is committed, so the output has to be reproducible byte for byte:
 * every list is ordered by a stable key, and no timestamps, durations, or row counts from
 * mutable tables are emitted. Only catalog structure is read, never business rows.
 *
 * Usage:
 *   node scripts/generate-data-dictionary.mjs            # write files
 *   node scripts/generate-data-dictionary.mjs --check    # fail if the files would change
 *
 * Connection comes from CUSTOMER_AGENT_DICTIONARY_HOST/PORT/USER/DATABASE, defaulting to
 * the Hangzhou stack's Unix socket and database name from `stack/content.env`.
 */
import { Client } from 'pg';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'docs/database/dictionary');
const STACK_ROOT = process.env.CUSTOMER_AGENT_STACK_ROOT ?? '/srv/customer-agent/stack';

// `public` is a real schema here: the frozen contract baseline lands its tables there, and
// production counts it among the user schemas. Excluding it would hide 49 tables.
const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast']);

function databaseFromContentEnv() {
  const contents = path.join(STACK_ROOT, 'content.env');
  if (!existsSync(contents)) return undefined;
  for (const line of readFileSync(contents, 'utf8').split('\n')) {
    const match = /^\s*DATABASE_NAME\s*=\s*(.+)$/.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

function connectionConfig() {
  const database = process.env.CUSTOMER_AGENT_DICTIONARY_DATABASE ?? databaseFromContentEnv();
  if (!database) {
    throw new Error('no database: set CUSTOMER_AGENT_DICTIONARY_DATABASE or DATABASE_NAME in stack/content.env');
  }
  const host = process.env.CUSTOMER_AGENT_DICTIONARY_HOST ?? path.join(STACK_ROOT, 'data/pg15-socket');
  return {
    host,
    port: Number(process.env.CUSTOMER_AGENT_DICTIONARY_PORT ?? 43199),
    user: process.env.CUSTOMER_AGENT_DICTIONARY_USER ?? 'stack_owner',
    database,
  };
}

/** Pipes and backticks would break a Markdown table cell or an inline code span. */
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n\s*/g, ' ');
const code = (value) => `\`${String(value ?? '').replace(/`/g, "'")}\``;
const sortBy = (...keys) => (a, b) => {
  for (const key of keys) {
    const left = String(a[key] ?? '');
    const right = String(b[key] ?? '');
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
};

const QUERIES = {
  schemas: `SELECT n.nspname AS schema
    FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname`,
  // information_schema is the acceptance source, so the counts in the index come from here
  // rather than from a pg_class query that might classify partitioned tables differently.
  relations: `SELECT table_schema AS schema, table_name AS name, table_type AS kind
    FROM information_schema.tables
    WHERE table_schema NOT LIKE 'pg\\_%' AND table_schema <> 'information_schema'
    ORDER BY table_schema, table_name`,
  columns: `SELECT n.nspname AS schema,
      c.relname AS relation,
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS not_null,
      pg_get_expr(d.adbin, d.adrelid) AS default_value,
      a.attidentity AS identity,
      a.attgenerated AS generated,
      col_description(c.oid, a.attnum) AS comment
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r','p','v','m','f')
      AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname, c.relname, a.attnum`,
  constraints: `SELECT n.nspname AS schema,
      c.relname AS relation,
      con.conname AS name,
      CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUDE'
        ELSE con.contype END AS kind,
      pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname, c.relname, con.conname`,
  indexes: `SELECT schemaname AS schema, tablename AS relation, indexname AS name, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname NOT LIKE 'pg\\_%' AND schemaname <> 'information_schema'
    ORDER BY schemaname, tablename, indexname`,
  functions: `SELECT n.nspname AS schema,
      p.proname AS name,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_function_result(p.oid) AS returns,
      l.lanname AS language,
      p.prosecdef AS security_definer,
      (SELECT string_agg(option, ', ' ORDER BY option) FROM unnest(p.proconfig) AS option) AS configuration,
      (SELECT e.extname FROM pg_depend dep
         JOIN pg_extension e ON e.oid = dep.refobjid
        WHERE dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid AND dep.deptype = 'e'
        LIMIT 1) AS extension
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname, p.proname, arguments`,
  triggers: `SELECT n.nspname AS schema,
      c.relname AS relation,
      t.tgname AS name,
      pg_get_triggerdef(t.oid) AS definition,
      t.tgenabled AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname, c.relname, t.tgname`,
};

const TRIGGER_STATE = { O: '启用', D: '停用', R: 'REPLICA', A: 'ALWAYS' };

function renderTable(catalog, schema, table) {
  const scoped = (rows) => rows.filter(row => row.schema === schema && row.relation === table.name);
  const lines = [`### ${table.name}`, ''];
  if (table.comment) lines.push(table.comment, '');
  if (table.kind !== 'BASE TABLE') lines.push(`类型：${table.kind}`, '');
  const columns = scoped(catalog.columns);
  if (columns.length === 0) {
    lines.push('没有列。', '');
  } else {
    lines.push('| 列 | 类型 | 可空 | 默认 | 备注 |', '| --- | --- | --- | --- | --- |');
    for (const column of columns) {
      const extra = [
        column.identity === 'a' ? 'GENERATED ALWAYS AS IDENTITY' : '',
        column.identity === 'd' ? 'GENERATED BY DEFAULT AS IDENTITY' : '',
        column.generated === 's' ? 'STORED GENERATED' : '',
      ].filter(Boolean).join('；');
      const note = [extra, column.comment].filter(Boolean).join('；');
      lines.push(`| ${code(column.name)} | ${code(column.type)} | ${column.not_null ? '否' : '是'} | ${column.default_value ? code(column.default_value) : ''} | ${cell(note)} |`);
    }
    lines.push('');
  }
  const constraints = scoped(catalog.constraints);
  if (constraints.length > 0) {
    lines.push('约束：', '', '| 名称 | 类型 | 定义 |', '| --- | --- | --- |');
    for (const constraint of constraints) {
      lines.push(`| ${code(constraint.name)} | ${constraint.kind} | ${cell(constraint.definition)} |`);
    }
    lines.push('');
  }
  const indexes = scoped(catalog.indexes);
  if (indexes.length > 0) {
    lines.push('索引：', '', '| 名称 | 定义 |', '| --- | --- |');
    for (const index of indexes) lines.push(`| ${code(index.name)} | ${cell(index.definition)} |`);
    lines.push('');
  }
  return lines;
}

function renderSchema(schema, catalog) {
  const relations = catalog.relations.filter(row => row.schema === schema).sort(sortBy('name'));
  const functions = catalog.functions.filter(row => row.schema === schema).sort(sortBy('name', 'arguments'));
  const triggers = catalog.triggers.filter(row => row.schema === schema).sort(sortBy('relation', 'name'));
  const lines = [
    `# schema ${code(schema)}`,
    '',
    '本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。',
    '',
    `## 关系（${String(relations.length)}）`,
    '',
  ];
  if (relations.length === 0) lines.push('没有表或视图。', '');
  for (const relation of relations) lines.push(...renderTable(catalog, schema, relation));

  lines.push(`## 函数（${String(functions.length)}）`, '');
  if (functions.length === 0) {
    lines.push('没有函数。', '');
  } else {
    lines.push('| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const fn of functions) {
      lines.push(`| ${code(fn.name)} | ${code(fn.arguments)} | ${cell(fn.returns)} | ${fn.language} | ${fn.security_definer ? '是' : '否'} | ${fn.configuration ? code(fn.configuration) : ''} | ${fn.extension ? `扩展 ${code(fn.extension)}` : '本仓'} |`);
    }
    lines.push('');
  }

  lines.push(`## 触发器（${String(triggers.length)}）`, '');
  if (triggers.length === 0) {
    lines.push('没有触发器。', '');
  } else {
    lines.push('| 触发器 | 表 | 定义 | 状态 |', '| --- | --- | --- | --- |');
    for (const trigger of triggers) {
      lines.push(`| ${code(trigger.name)} | ${code(trigger.relation)} | ${cell(trigger.definition)} | ${TRIGGER_STATE[trigger.enabled] ?? trigger.enabled} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderIndex(schemas, catalog) {
  const rows = schemas.map((schema) => {
    const relations = catalog.relations.filter(row => row.schema === schema);
    return {
      schema,
      tables: relations.filter(row => row.kind === 'BASE TABLE').length,
      views: relations.filter(row => row.kind !== 'BASE TABLE').length,
      functions: catalog.functions.filter(row => row.schema === schema).length,
      triggers: catalog.triggers.filter(row => row.schema === schema).length,
      columns: catalog.columns.filter(row => row.schema === schema).length,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.tables, 0);
  const lines = [
    '# 数据库字典',
    '',
    '本目录由 `packages/database/scripts/generate-data-dictionary.mjs` 从真实库生成，只读 catalog，不读业务行。不要手改：下一次生成会覆盖，`--check` 会因此失败。',
    '',
    `共 ${String(rows.length)} 个 schema、${String(total)} 张表。`,
    '',
    '| schema | 表 | 视图 | 列 | 函数 | 触发器 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(`| [${code(row.schema)}](${row.schema}.md) | ${String(row.tables)} | ${String(row.views)} | ${String(row.columns)} | ${String(row.functions)} | ${String(row.triggers)} |`);
  }
  lines.push('');
  return { content: `${lines.join('\n').trimEnd()}\n`, totals: { schemas: rows.length, tables: total } };
}

async function readCatalog(client) {
  const rows = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    const result = await client.query(sql);
    rows[name] = result.rows;
  }
  return {
    schemas: rows.schemas.map(row => row.schema).filter(schema => !SYSTEM_SCHEMAS.has(schema)).sort(),
    relations: [...rows.relations].sort(sortBy('schema', 'name')),
    // Columns keep the SQL order (schema, relation, attnum): a table reads top to bottom the
    // way it is declared. The query's ORDER BY is the only ordering input, so this is still
    // deterministic.
    columns: [...rows.columns],
    constraints: [...rows.constraints].sort(sortBy('schema', 'relation', 'name')),
    indexes: [...rows.indexes].sort(sortBy('schema', 'relation', 'name')),
    functions: [...rows.functions].sort(sortBy('schema', 'name', 'arguments')),
    triggers: [...rows.triggers].sort(sortBy('schema', 'relation', 'name')),
  };
}

function renderAll(catalog) {
  const files = new Map();
  for (const schema of catalog.schemas) files.set(`${schema}.md`, renderSchema(schema, catalog));
  const index = renderIndex(catalog.schemas, catalog);
  files.set('index.md', index.content);
  return { files, totals: index.totals };
}

async function generate({ check }) {
  const config = connectionConfig();
  const client = new Client({ ...config, application_name: 'customer-agent-data-dictionary', statement_timeout: 30_000 });
  await client.connect();
  let catalog;
  try {
    // The dictionary describes committed structure only; a concurrent DDL transaction must
    // not produce a half-updated file set that a later --check would then report as drift.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    catalog = await readCatalog(client);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
  if (catalog.schemas.length === 0) throw new Error('the database has no user schemas; refusing to write an empty dictionary');

  const { files, totals } = renderAll(catalog);
  const existing = existsSync(OUTPUT_DIR) ? readdirSync(OUTPUT_DIR).filter(name => name.endsWith('.md')) : [];
  const stale = existing.filter(name => !files.has(name));
  const changed = [...files].filter(([name, content]) => {
    const target = path.join(OUTPUT_DIR, name);
    return !existsSync(target) || readFileSync(target, 'utf8') !== content;
  }).map(([name]) => name).sort();

  if (check) {
    if (changed.length > 0 || stale.length > 0) {
      throw new Error(`data dictionary is stale: ${[...changed, ...stale.sort()].join(', ')}`);
    }
    return { check: 'pass', ...totals, files: files.size };
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const name of stale) rmSync(path.join(OUTPUT_DIR, name));
  for (const [name, content] of files) writeFileSync(path.join(OUTPUT_DIR, name), content);
  return { check: 'written', ...totals, files: files.size, written: changed.length, removed: stale.length };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  generate({ check: process.argv.slice(2).includes('--check') })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`data dictionary: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}

export { generate };
