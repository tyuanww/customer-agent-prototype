import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ReleaseProofError, assertReleasePrefix, verifyReleaseDatabase, probeRollbackRuntime,
  createReleaseProof, readServiceStartup,
} from './release-proof.mjs';

export const BACKUP_SET_SCHEMA = 'customer-agent-backup-set/v1';
export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_DIGEST_FILE = 'manifest.sha256';
export const DATABASE_DUMP_FILE = 'database.dump';
export const ROLES_FILE = 'roles.sql';
export const OBJECTS_ARCHIVE_FILE = 'objects.tar';

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIRECTORY, '../..');
const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const BACKUP_ID_PATTERN = /^([a-z_][a-z0-9_]*)-(\d{8}T\d{6}Z)-(\d{3})$/u;
const OBJECT_ID = /^obj_[0-9a-f]{64}$/u;
const BATCH_ID = /^imp_[A-Za-z0-9_-]{16,128}$/u;
// Historical SQL batch IDs are opaque TEXT, never archive paths. Receipts keep the stricter format.
const DATABASE_BATCH_ID = /^[^\0]*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MIGRATION_ID = /^[0-9]{4}_[a-z0-9_]+$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const TAR_BLOCK = 512;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const BACKUP_SETS_DIRECTORY = 'backup-sets';

export class BackupSetError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'BackupSetError';
    this.code = code;
  }
}

function fail(code, message, options = undefined) {
  throw new BackupSetError(code, message, options);
}

function utcNow() {
  return new Date().toISOString();
}

function log(message) {
  process.stdout.write(`${utcNow()} ${message}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readBoundedText(file, maximumBytes, code) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) fail(code, 'Expected a regular file');
  if (info.size < 1 || info.size > maximumBytes) fail(code, 'File size is outside the accepted range');
  return readFileSync(file, 'utf8');
}

function resolveExecutable(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o111) === 0) {
    fail('PG_BINARY_INVALID', `Invalid PostgreSQL executable: ${path.basename(file)}`);
  }
}

function discoverPg15Bin() {
  let directory = process.env.CUSTOMER_AGENT_PG15_BIN;
  if (directory) {
    directory = path.resolve(directory);
  } else {
    const located = spawnSync('pg_config', ['--bindir'], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (located.status !== 0 || !located.stdout.trim()) fail('PG15_NOT_FOUND', 'Cannot discover PostgreSQL binaries');
    directory = path.resolve(located.stdout.trim());
  }
  for (const binary of ['postgres', 'initdb', 'pg_ctl', 'createdb', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore']) {
    resolveExecutable(path.join(directory, binary));
  }
  const version = spawnSync(path.join(directory, 'postgres'), ['--version'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const major = Number(version.stdout.match(/PostgreSQL\)\s+(\d+)/u)?.[1]);
  if (version.status !== 0 || major !== 15) fail('PG15_REQUIRED', 'PostgreSQL 15 binaries are required');
  return directory;
}

function redactDiagnostic(value) {
  let detail = `${value ?? ''}`;
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 4 && /(?:PASSWORD|SECRET|TOKEN|KEY)$/u.test(key)) {
      detail = detail.split(secret).join('[REDACTED]');
    }
  }
  return detail.trim().slice(0, 1_000);
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, [...arguments_], {
    encoding: 'utf8',
    env: options.environment ?? process.env,
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) fail(options.code ?? 'COMMAND_FAILED', `${path.basename(command)} failed to start`);
  if (result.status !== 0) {
    let detail = '';
    if (process.env.CUSTOMER_AGENT_BACKUP_DIAGNOSTICS === '1') {
      detail = redactDiagnostic(result.stderr);
    }
    fail(
      options.code ?? 'COMMAND_FAILED',
      `${path.basename(command)} exited with status ${result.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return result.stdout;
}

function atomicWrite(file, contents, mode = 0o600) {
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, contents, { encoding: 'utf8', mode, flag: 'wx' });
  const descriptor = openSync(temporary, 'r+');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function safeRealDirectory(directory, code) {
  let info;
  try {
    info = lstatSync(directory);
  } catch {
    fail(code, 'Directory does not exist');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail(code, 'Expected a non-symlink directory');
  return realpathSync(directory);
}

function pathsOverlap(first, second) {
  const relativeFirst = path.relative(first, second);
  const relativeSecond = path.relative(second, first);
  return relativeFirst === ''
    || (!relativeFirst.startsWith(`..${path.sep}`) && relativeFirst !== '..' && !path.isAbsolute(relativeFirst))
    || (!relativeSecond.startsWith(`..${path.sep}`) && relativeSecond !== '..' && !path.isAbsolute(relativeSecond));
}

function assertPathInside(root, candidate, code) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return;
  }
  fail(code, 'Path escapes its allowed root');
}

function readJson(file, code, maximumBytes = MAX_MANIFEST_BYTES) {
  let value;
  try {
    value = JSON.parse(readBoundedText(file, maximumBytes, code));
  } catch (error) {
    if (error instanceof BackupSetError) throw error;
    fail(code, 'Invalid JSON');
  }
  return value;
}

function requiredString(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code, 'Invalid string field');
  return value;
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code, 'Invalid byte count');
  return value;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code, 'Invalid positive integer');
  return value;
}

export function loadStackProfile(options = {}) {
  const stackRoot = path.resolve(
    options.stackRoot
      ?? process.env.CUSTOMER_AGENT_STACK_ROOT
      ?? '/srv/customer-agent/stack',
  );
  const profileFile = path.join(stackRoot, 'profile.json');
  const profile = readJson(profileFile, 'PROFILE_INVALID', 256 * 1024);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('PROFILE_INVALID', 'Profile must be an object');
  if (profile.version !== 1) fail('PROFILE_INVALID', 'Unsupported profile version');
  if (profile.stackRoot !== stackRoot) fail('PROFILE_INVALID', 'Profile stackRoot does not match the selected stack');
  const databaseName = requiredString(profile.databaseName, SQL_IDENTIFIER, 'PROFILE_INVALID');
  const pgPort = positiveInteger(profile.pgPort, 'PROFILE_INVALID');
  if (pgPort > 65_535) fail('PROFILE_INVALID', 'Invalid PostgreSQL port');
  if (typeof profile.pgSocketDirectory !== 'string' || !path.isAbsolute(profile.pgSocketDirectory)) {
    fail('PROFILE_INVALID', 'Profile PostgreSQL socket directory must be absolute');
  }
  if (typeof profile.objectStoreDirectory !== 'string' || !path.isAbsolute(profile.objectStoreDirectory)) {
    fail('PROFILE_INVALID', 'Profile object store directory must be absolute');
  }
  const pgSocketDirectory = safeRealDirectory(profile.pgSocketDirectory, 'PROFILE_INVALID');
  const objectStoreDirectory = safeRealDirectory(profile.objectStoreDirectory, 'PROFILE_INVALID');
  if (objectStoreDirectory === stackRoot) fail('PROFILE_INVALID', 'Object store cannot be the stack root');
  return Object.freeze({
    stackRoot,
    profileFile,
    databaseName,
    pgPort,
    pgSocketDirectory,
    objectStoreDirectory,
  });
}

export async function acquireBackupLock(backupRoot, profile) {
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const { Client } = await import('pg');
  const client = new Client({
    host: profile.pgSocketDirectory,
    port: profile.pgPort,
    user: resolvePostgresRole(profile),
    database: profile.databaseName,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
      [`customer-agent-backup:${safeRealDirectory(backupRoot, 'BACKUP_LOCK_FAILED')}`]);
    if (!result.rows[0]?.acquired) fail('BACKUP_LOCKED', 'Another backup is already running');
  } catch (error) {
    await client.end();
    if (error instanceof BackupSetError) throw error;
    fail('BACKUP_LOCK_FAILED', 'Cannot acquire the backup lock');
  }
  return () => client.end();
}

function resolvePostgresRole(profile) {
  const role = profile.pgUser ?? process.env.CUSTOMER_AGENT_BACKUP_USER ?? 'stack_owner';
  return requiredString(role, SQL_IDENTIFIER, 'BACKUP_USER_INVALID');
}

function connectionArguments(profile) {
  return [
    '--host', profile.pgSocketDirectory,
    '--port', String(profile.pgPort),
    '--username', resolvePostgresRole(profile),
  ];
}

function psqlJson(pgBin, profile, sql, database = profile.databaseName, options = {}) {
  let command = sql;
  if (options.snapshotId !== undefined) {
    requiredString(options.snapshotId, /^[A-Za-z0-9:-]+$/u, 'DATABASE_SNAPSHOT_INVALID');
    command = [
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
      `SET TRANSACTION SNAPSHOT '${options.snapshotId}';`,
      sql,
      'COMMIT;',
    ].join('\n');
  }
  const output = run(path.join(pgBin, 'psql'), [
    '-X', '--no-psqlrc', '--no-align', '--tuples-only', '--quiet',
    '--set', 'ON_ERROR_STOP=1',
    ...connectionArguments(profile),
    '--dbname', database,
    '--command', command,
  ], { code: 'DATABASE_QUERY_FAILED', timeout: 60_000 });
  try {
    return JSON.parse(output.trim() || 'null');
  } catch {
    fail('DATABASE_QUERY_FAILED', 'PostgreSQL returned invalid metadata JSON');
  }
}

function readDatabaseMetadata(pgBin, profile, options = {}) {
  const result = psqlJson(pgBin, profile, `
    WITH
      db_owner AS (
        SELECT role.rolname AS owner
        FROM pg_catalog.pg_database db
        JOIN pg_catalog.pg_roles role ON role.oid = db.datdba
        WHERE db.datname = current_database()
      ),
      user_namespaces AS (
        SELECT namespace.oid, namespace.nspname, namespace.nspowner, namespace.nspacl
        FROM pg_catalog.pg_namespace namespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_(toast|temp)(_|$)'
      ),
      migrations AS (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'position', position,
          'migrationId', migration_id,
          'sha256', migration_sha256,
          'contractSetId', contract_set_id,
          'sourceGitSha', source_git_sha,
          'sourceSchemaSha256', source_schema_sha256,
          'appliedAt', applied_at,
          'executionMs', execution_ms
        ) ORDER BY position), '[]'::jsonb) AS value
        FROM customer_agent_meta.schema_migrations
      ),
      objects AS (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'objectId', object_id,
          'objectKey', object_key,
          'sha256', sha256,
          'bytes', bytes
        ) ORDER BY object_id), '[]'::jsonb) AS value
        FROM content_intake.objects
      ),
      batches AS (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'importBatchId', import_batch_id,
          'sourceType', source_type,
          'sourceRef', source_ref,
          'sourceSha256', source_sha256,
          'sourceSizeBytes', source_size_bytes,
          'sourceBindingHash', source_binding_hash,
          'status', status
        ) ORDER BY import_batch_id), '[]'::jsonb) AS value
        FROM public.import_batches
      ),
      roles AS (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name', role.rolname,
          'login', role.rolcanlogin,
          'superuser', role.rolsuper,
          'createdb', role.rolcreatedb,
          'createrole', role.rolcreaterole,
          'inherit', role.rolinherit,
          'replication', role.rolreplication,
          'bypassrls', role.rolbypassrls,
          'memberships', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'granted', granted.rolname,
              'admin', membership.admin_option
            ) ORDER BY granted.rolname)
            FROM pg_catalog.pg_auth_members membership
            JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
            WHERE membership.member = role.oid
          ), '[]'::jsonb)
        ) ORDER BY role.rolname), '[]'::jsonb) AS value
        FROM pg_catalog.pg_roles role
        WHERE role.rolname !~ '^pg_'
      ),
      owners AS (
        SELECT jsonb_agg(entry ORDER BY entry) AS value
        FROM (
          SELECT format('namespace|%s|%s', namespace.nspname, owner.rolname) AS entry
          FROM user_namespaces namespace
          JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
          UNION ALL
          SELECT format('relation|%s|%s|%s|%s', namespace.nspname, relation.relname,
            relation.relkind, owner.rolname)
          FROM pg_catalog.pg_class relation
          JOIN user_namespaces namespace ON namespace.oid = relation.relnamespace
          JOIN pg_catalog.pg_roles owner ON owner.oid = relation.relowner
          UNION ALL
          SELECT format('function|%s|%s|%s', namespace.nspname, procedure.proname,
            owner.rolname)
          FROM pg_catalog.pg_proc procedure
          JOIN user_namespaces namespace ON namespace.oid = procedure.pronamespace
          JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
        ) owned
      ),
      acls AS (
        SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '') AS value
        FROM (
          SELECT format(
            'database|%s|%s|%s|%s',
            '<current-database>',
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          ) AS entry
          FROM pg_catalog.pg_database database
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(database.datacl, pg_catalog.acldefault('d', database.datdba))
          ) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
          WHERE database.datname = current_database()
            AND acl.grantee <> database.datdba

          UNION ALL

          SELECT format(
            'schema|%s|%s|%s|%s',
            namespace.nspname,
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          )
          FROM user_namespaces namespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
          ) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
          WHERE acl.grantee <> namespace.nspowner

          UNION ALL

          SELECT format(
            'relation|%s.%s|%s|%s|%s|%s',
            namespace.nspname,
            relation.relname,
            relation.relkind,
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          )
          FROM pg_catalog.pg_class relation
          JOIN user_namespaces namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(
            relation.relacl,
            pg_catalog.acldefault(
              CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
              relation.relowner
            )
          )) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
          WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
            AND acl.grantee <> relation.relowner

          UNION ALL

          SELECT format(
            'column|%s.%s.%s|%s|%s|%s',
            namespace.nspname,
            relation.relname,
            attribute.attname,
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          )
          FROM pg_catalog.pg_attribute attribute
          JOIN pg_catalog.pg_class relation ON relation.oid = attribute.attrelid
          JOIN user_namespaces namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
          WHERE attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> relation.relowner

          UNION ALL

          SELECT format(
            'function|%s.%s(%s)|%s|%s|%s',
            namespace.nspname,
            procedure.proname,
            pg_catalog.pg_get_function_identity_arguments(procedure.oid),
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          )
          FROM pg_catalog.pg_proc procedure
          JOIN user_namespaces namespace ON namespace.oid = procedure.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
          ) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
          WHERE acl.grantee <> procedure.proowner

          UNION ALL

          SELECT format(
            'domain|%s.%s|%s|%s|%s',
            namespace.nspname,
            type_object.typname,
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          )
          FROM pg_catalog.pg_type type_object
          JOIN user_namespaces namespace ON namespace.oid = type_object.typnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(type_object.typacl, pg_catalog.acldefault('T', type_object.typowner))
          ) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
          WHERE type_object.typtype = 'd'
            AND acl.grantee <> type_object.typowner

          UNION ALL

          SELECT format(
            'default|owner=%s|schema=%s|type=%s|grantee=%s|%s|%s',
            owner.rolname,
            coalesce(namespace.nspname, '<global>'),
            default_acl.defaclobjtype,
            coalesce(grantee.rolname, 'PUBLIC'),
            acl.privilege_type,
            acl.is_grantable
          )
          FROM pg_catalog.pg_default_acl default_acl
          JOIN pg_catalog.pg_roles owner ON owner.oid = default_acl.defaclrole
          LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) acl
          LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
        ) entries
      )
    SELECT jsonb_build_object(
      'databaseOwner', (SELECT owner FROM db_owner),
      'migrations', (SELECT value FROM migrations),
      'objects', (SELECT value FROM objects),
      'importBatches', (SELECT value FROM batches),
      'roles', (SELECT value FROM roles),
      'owners', (SELECT value FROM owners),
      'aclManifest', (SELECT value FROM acls)
    )::text
  `, profile.databaseName, options);
  if (!result || typeof result !== 'object') fail('DATABASE_METADATA_INVALID', 'Missing database metadata');
  if (!SQL_IDENTIFIER.test(result.databaseOwner ?? '')) fail('DATABASE_METADATA_INVALID', 'Invalid database owner');
  if (!Array.isArray(result.migrations) || result.migrations.length < 1) fail('DATABASE_METADATA_INVALID', 'Migration ledger is empty');
  if (!Array.isArray(result.objects) || !Array.isArray(result.importBatches)
    || !Array.isArray(result.roles) || !Array.isArray(result.owners)
    || typeof result.aclManifest !== 'string') {
    fail('DATABASE_METADATA_INVALID', 'Incomplete database metadata');
  }
  const migrations = result.migrations.map((migration) => {
    if (!migration || typeof migration !== 'object') fail('DATABASE_METADATA_INVALID', 'Invalid migration row');
    return Object.freeze({
      position: positiveInteger(migration.position, 'DATABASE_METADATA_INVALID'),
      migrationId: requiredString(migration.migrationId, MIGRATION_ID, 'DATABASE_METADATA_INVALID'),
      sha256: requiredString(migration.sha256, SHA256, 'DATABASE_METADATA_INVALID'),
      contractSetId: requiredString(migration.contractSetId, /^.{1,256}$/u, 'DATABASE_METADATA_INVALID'),
      sourceGitSha: requiredString(migration.sourceGitSha, GIT_SHA, 'DATABASE_METADATA_INVALID'),
      sourceSchemaSha256: requiredString(migration.sourceSchemaSha256, SHA256, 'DATABASE_METADATA_INVALID'),
      appliedAt: requiredString(migration.appliedAt, /^.{1,64}$/u, 'DATABASE_METADATA_INVALID'),
      executionMs: nonNegativeInteger(migration.executionMs, 'DATABASE_METADATA_INVALID'),
    });
  });
  const objects = result.objects.map((object) => {
    if (!object || typeof object !== 'object') fail('DATABASE_METADATA_INVALID', 'Invalid object row');
    return Object.freeze({
      objectId: requiredString(object.objectId, OBJECT_ID, 'DATABASE_METADATA_INVALID'),
      objectKey: requiredString(object.objectKey, /^intake\/obj_[0-9a-f]{64}$/u, 'DATABASE_METADATA_INVALID'),
      sha256: requiredString(object.sha256, SHA256, 'DATABASE_METADATA_INVALID'),
      bytes: positiveInteger(Number(object.bytes), 'DATABASE_METADATA_INVALID'),
    });
  });
  const batches = result.importBatches.map((batch) => {
    if (!batch || typeof batch !== 'object') fail('DATABASE_METADATA_INVALID', 'Invalid import batch row');
    return Object.freeze({
      importBatchId: requiredString(batch.importBatchId, DATABASE_BATCH_ID, 'DATABASE_METADATA_INVALID'),
      sourceType: requiredString(batch.sourceType, /^[a-z_]+$/u, 'DATABASE_METADATA_INVALID'),
      sourceRef: typeof batch.sourceRef === 'string' ? batch.sourceRef : null,
      sourceSha256: typeof batch.sourceSha256 === 'string' ? requiredString(batch.sourceSha256, SHA256, 'DATABASE_METADATA_INVALID') : null,
      sourceSizeBytes: batch.sourceSizeBytes === null ? null : nonNegativeInteger(Number(batch.sourceSizeBytes), 'DATABASE_METADATA_INVALID'),
      sourceBindingHash: requiredString(batch.sourceBindingHash, SHA256, 'DATABASE_METADATA_INVALID'),
      status: requiredString(batch.status, /^[a-z_]+$/u, 'DATABASE_METADATA_INVALID'),
    });
  });
  const roles = result.roles.map((role) => {
    if (!role || typeof role !== 'object'
      || !SQL_IDENTIFIER.test(role.name ?? '')
      || typeof role.login !== 'boolean'
      || typeof role.superuser !== 'boolean'
      || typeof role.createdb !== 'boolean'
      || typeof role.createrole !== 'boolean'
      || typeof role.inherit !== 'boolean'
      || typeof role.replication !== 'boolean'
      || typeof role.bypassrls !== 'boolean'
      || !Array.isArray(role.memberships)) {
      fail('DATABASE_METADATA_INVALID', 'Invalid role metadata');
    }
    const memberships = role.memberships.map((membership) => {
      if (!membership || !SQL_IDENTIFIER.test(membership.granted ?? '')
        || typeof membership.admin !== 'boolean') {
        fail('DATABASE_METADATA_INVALID', 'Invalid role membership metadata');
      }
      return Object.freeze({ granted: membership.granted, admin: membership.admin });
    });
    return Object.freeze({
      name: role.name,
      login: role.login,
      superuser: role.superuser,
      createdb: role.createdb,
      createrole: role.createrole,
      inherit: role.inherit,
      replication: role.replication,
      bypassrls: role.bypassrls,
      memberships: Object.freeze(memberships),
    });
  });
  const migrationDigest = sha256(canonicalJson(migrations.map((migration) => ({
    position: migration.position,
    migrationId: migration.migrationId,
    sha256: migration.sha256,
    contractSetId: migration.contractSetId,
    sourceGitSha: migration.sourceGitSha,
    sourceSchemaSha256: migration.sourceSchemaSha256,
  }))));
  const metadata = Object.freeze({
    databaseOwner: result.databaseOwner,
    migrations: Object.freeze(migrations),
    migrationDigest,
    objects: Object.freeze(objects),
    importBatches: Object.freeze(batches),
    roles: Object.freeze(roles),
    rolesFingerprint: sha256(canonicalJson(roles)),
    roleCount: roles.length,
    ownershipFingerprint: sha256(canonicalJson(result.owners)),
    aclFingerprint: sha256(result.aclManifest),
  });
  return {
    database: metadata,
    comparable: canonicalJson(metadata),
  };
}

async function openDatabaseSnapshot(profile) {
  const { Client } = await import('pg');
  const client = new Client({
    host: profile.pgSocketDirectory,
    port: profile.pgPort,
    user: resolvePostgresRole(profile),
    database: profile.databaseName,
  });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query(`
      SELECT
        pg_catalog.pg_export_snapshot() AS snapshot_id,
        pg_catalog.clock_timestamp()::text AS snapshot_at
    `);
    const snapshotId = result.rows[0]?.snapshot_id;
    const snapshotAt = result.rows[0]?.snapshot_at;
    requiredString(snapshotId, /^[A-Za-z0-9:-]+$/u, 'DATABASE_SNAPSHOT_INVALID');
    requiredString(snapshotAt, /^.{1,64}$/u, 'DATABASE_SNAPSHOT_INVALID');
    let closed = false;
    return Object.freeze({
      id: snapshotId,
      at: snapshotAt,
      async close() {
        if (closed) return;
        closed = true;
        await client.query('COMMIT').catch(() => undefined);
        await client.end().catch(() => undefined);
      },
    });
  } catch (error) {
    await client.end().catch(() => undefined);
    if (error instanceof BackupSetError) throw error;
    fail('DATABASE_SNAPSHOT_FAILED', 'Cannot open a PostgreSQL backup snapshot');
  }
}

function appIdentity() {
  const versionFile = path.join(REPOSITORY_ROOT, 'VERSION');
  const configuredVersion = process.env.CUSTOMER_AGENT_BACKUP_PRODUCT_VERSION;
  const productVersion = configuredVersion ?? readBoundedText(versionFile, 256, 'PRODUCT_VERSION_INVALID').trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(productVersion)) {
    fail('PRODUCT_VERSION_INVALID', 'VERSION is not a product version');
  }
  const productVersionSource = configuredVersion === undefined ? 'release-version-file' : 'environment';
  const environmentSha = process.env.CUSTOMER_AGENT_BACKUP_GIT_SHA;
  if (environmentSha !== undefined) {
    requiredString(environmentSha, GIT_SHA, 'APPLICATION_GIT_SHA_INVALID');
    return Object.freeze({ productVersion, productVersionSource, gitSha: environmentSha, gitShaSource: 'environment' });
  }
  const builtIdentity = path.join(REPOSITORY_ROOT, 'apps/desktop/build/build-identity.json');
  if (existsSync(builtIdentity)) {
    const identity = readJson(builtIdentity, 'APPLICATION_GIT_SHA_INVALID', 16 * 1024);
    if (identity.productVersion === productVersion && typeof identity.gitSha === 'string' && GIT_SHA.test(identity.gitSha)) {
      return Object.freeze({ productVersion, productVersionSource, gitSha: identity.gitSha, gitShaSource: 'desktop-build-identity' });
    }
  }
  return Object.freeze({ productVersion, productVersionSource, gitSha: null, gitShaSource: 'not-provided' });
}

async function toolingIdentity() {
  return Object.freeze({
    implementation: 'scripts/ops/backup-set.mjs',
    sha256: await fileSha256(fileURLToPath(import.meta.url)),
  });
}

export async function inspectObjectStore(profile, database) {
  const objectStore = profile.objectStoreDirectory;
  const objectRoot = path.join(objectStore, 'objects');
  const receiptRoot = path.join(objectStore, 'batches');
  for (const directory of [objectRoot, receiptRoot]) {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('OBJECT_STORE_INVALID', 'Object store partition is invalid');
  }

  const objectFiles = new Map();
  for (const name of readdirSync(objectRoot).sort()) {
    const file = path.join(objectRoot, name);
    const info = lstatSync(file);
    if (!OBJECT_ID.test(name) || !info.isFile() || info.isSymbolicLink()) {
      fail('OBJECT_STORE_INVALID', 'Object partition contains an invalid entry');
    }
    objectFiles.set(name, Object.freeze({
      objectId: name,
      path: `objects/${name}`,
      bytes: info.size,
      sha256: await fileSha256(file),
    }));
  }

  const batchById = new Map(database.importBatches.map((batch) => [batch.importBatchId, batch]));
  for (const object of database.objects) {
    if (object.objectKey !== `intake/${object.objectId}`) fail('OBJECT_DATABASE_MISMATCH', 'Object key does not match object id');
    const file = objectFiles.get(object.objectId);
    if (!file || file.bytes !== object.bytes || file.sha256 !== object.sha256) {
      fail('OBJECT_DATABASE_MISMATCH', 'Database object is missing or does not match its file');
    }
  }

  const receipts = [];
  const receiptObjectIds = new Set();
  for (const name of readdirSync(receiptRoot).sort()) {
    if (!name.endsWith('.json')) fail('OBJECT_STORE_INVALID', 'Receipt partition contains an unexpected entry');
    const importBatchId = name.slice(0, -5);
    requiredString(importBatchId, BATCH_ID, 'OBJECT_STORE_INVALID');
    const file = path.join(receiptRoot, name);
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) fail('OBJECT_STORE_INVALID', 'Receipt is not a regular file');
    const receipt = readJson(file, 'OBJECT_RECEIPT_INVALID', 256 * 1024);
    if (!receipt || typeof receipt !== 'object') fail('OBJECT_RECEIPT_INVALID', 'Receipt must be an object');
    if (receipt.importBatchId !== importBatchId) fail('OBJECT_RECEIPT_INVALID', 'Receipt filename and batch id differ');
    const objectId = requiredString(receipt.objectId, OBJECT_ID, 'OBJECT_RECEIPT_INVALID');
    const sourceType = requiredString(receipt.sourceType, /^(?:csv|excel)$/u, 'OBJECT_RECEIPT_INVALID');
    const receiptSha = requiredString(receipt.sha256, SHA256, 'OBJECT_RECEIPT_INVALID');
    const receiptBytes = positiveInteger(receipt.sizeBytes, 'OBJECT_RECEIPT_INVALID');
    const sourceBindingHash = requiredString(receipt.sourceBindingHash, SHA256, 'OBJECT_RECEIPT_INVALID');
    if (!Array.isArray(receipt.sourceBindings)
      || receipt.sourceBindings.some((binding) => !binding || typeof binding !== 'object'
        || typeof binding.domain !== 'string' || binding.domain.length < 1
        || typeof binding.source_version_id !== 'string' || binding.source_version_id.length < 1)) {
      fail('OBJECT_RECEIPT_INVALID', 'Receipt source bindings are invalid');
    }
    const objectFile = objectFiles.get(objectId);
    if (!objectFile || objectFile.sha256 !== receiptSha || objectFile.bytes !== receiptBytes) {
      fail('OBJECT_RECEIPT_MISMATCH', 'Receipt does not match its object file');
    }
    const databaseBatch = batchById.get(importBatchId);
    if (databaseBatch) {
      if (databaseBatch.sourceRef !== objectId
        || databaseBatch.sourceType !== sourceType
        || databaseBatch.sourceSha256 !== receiptSha
        || databaseBatch.sourceSizeBytes !== receiptBytes
        || databaseBatch.sourceBindingHash !== sourceBindingHash) {
        fail('OBJECT_RECEIPT_MISMATCH', 'Receipt does not match the durable import batch');
      }
    }
    receiptObjectIds.add(objectId);
    receipts.push(Object.freeze({
      importBatchId,
      objectId,
      sha256: receiptSha,
      sizeBytes: receiptBytes,
      sourceBindingHash,
      receiptPath: `batches/${name}`,
      receiptBytes: info.size,
      receiptSha256: await fileSha256(file),
      durableDatabaseBatch: databaseBatch !== undefined,
    }));
  }

  const receiptsByBatch = new Map(receipts.map((receipt) => [receipt.importBatchId, receipt]));
  for (const batch of database.importBatches) {
    if (['csv', 'excel'].includes(batch.sourceType) && OBJECT_ID.test(batch.sourceRef ?? '')
      && !receiptsByBatch.has(batch.importBatchId)) {
      fail('OBJECT_RECEIPT_MISSING', 'Durable import batch is missing its local receipt');
    }
  }

  const databaseIds = new Set(database.objects.map((object) => object.objectId));
  const files = [...objectFiles.values()].map((file) => Object.freeze({
    ...file,
    databaseReferenced: databaseIds.has(file.objectId),
    receiptReferenced: receiptObjectIds.has(file.objectId),
  }));
  return Object.freeze({
    files: Object.freeze(files),
    receipts: Object.freeze(receipts),
    unreferencedObjectIds: Object.freeze(files
      .filter((file) => !file.databaseReferenced && !file.receiptReferenced)
      .map((file) => file.objectId)),
  });
}

function parseTarNumber(buffer, code) {
  const raw = buffer.toString('ascii').replace(/\0.*$/u, '').trim();
  if (raw === '') return 0;
  if (!/^[0-7]+$/u.test(raw)) fail(code, 'Tar header contains a non-octal number');
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(code, 'Tar header number is invalid');
  return value;
}

function parseTarString(buffer) {
  const zero = buffer.indexOf(0);
  return buffer.subarray(0, zero === -1 ? buffer.length : zero).toString('utf8');
}

function validTarEntryName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return false;
  const normalized = path.posix.normalize(name);
  if (normalized !== name || normalized === '..' || normalized.startsWith('../')) return false;
  return name === 'objects' || name === 'batches'
    || /^objects\/obj_[0-9a-f]{64}$/u.test(name)
    || /^batches\/imp_[A-Za-z0-9_-]{16,128}\.json$/u.test(name);
}

export function inspectObjectArchive(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) fail('OBJECT_ARCHIVE_INVALID', 'Object archive is not a regular file');
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  const entries = [];
  const names = new Set();
  let offset = 0;
  let sawEnd = false;
  try {
    while (offset + TAR_BLOCK <= info.size) {
      const header = Buffer.alloc(TAR_BLOCK);
      if (readSync(descriptor, header, 0, TAR_BLOCK, offset) !== TAR_BLOCK) fail('OBJECT_ARCHIVE_INVALID', 'Truncated tar header');
      offset += TAR_BLOCK;
      if (header.every((byte) => byte === 0)) {
        sawEnd = true;
        break;
      }
      const storedChecksum = parseTarNumber(header.subarray(148, 156), 'OBJECT_ARCHIVE_INVALID');
      const checksumHeader = Buffer.from(header);
      checksumHeader.fill(0x20, 148, 156);
      const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
      if (storedChecksum !== actualChecksum) fail('OBJECT_ARCHIVE_INVALID', 'Tar header checksum mismatch');
      const name = parseTarString(header.subarray(0, 100));
      const prefix = parseTarString(header.subarray(345, 500));
      let fullName = prefix ? `${prefix}/${name}` : name;
      const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
      if (type === '5' && fullName.endsWith('/')) fullName = fullName.slice(0, -1);
      if (!validTarEntryName(fullName) || names.has(fullName)) fail('OBJECT_ARCHIVE_INVALID', 'Unsafe or duplicate tar entry');
      if (type !== '0' && type !== '5') fail('OBJECT_ARCHIVE_INVALID', 'Only regular files and directories are accepted');
      if (type === '5' && !['objects', 'batches'].includes(fullName)) fail('OBJECT_ARCHIVE_INVALID', 'Unexpected tar directory');
      const size = parseTarNumber(header.subarray(124, 136), 'OBJECT_ARCHIVE_INVALID');
      if (type === '5' && size !== 0) fail('OBJECT_ARCHIVE_INVALID', 'Tar directory has content');
      if (offset + size > info.size) fail('OBJECT_ARCHIVE_INVALID', 'Tar entry is truncated');
      let digest = null;
      if (type === '0') {
        const hash = createHash('sha256');
        let remaining = size;
        let dataOffset = offset;
        while (remaining > 0) {
          const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
          const read = readSync(descriptor, chunk, 0, chunk.length, dataOffset);
          if (read < 1) fail('OBJECT_ARCHIVE_INVALID', 'Object archive ended during validation');
          hash.update(chunk.subarray(0, read));
          remaining -= read;
          dataOffset += read;
        }
        digest = hash.digest('hex');
      }
      entries.push(Object.freeze({ name: fullName, type, size, dataOffset: offset, sha256: digest }));
      names.add(fullName);
      offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    }
    if (!sawEnd) fail('OBJECT_ARCHIVE_INVALID', 'Tar end marker is missing');
    if (entries.length === 0) fail('OBJECT_ARCHIVE_INVALID', 'Tar archive is empty');
    return Object.freeze(entries);
  } finally {
    closeSync(descriptor);
  }
}

function ensureDirectoryAt(root, relative, code) {
  let current = root;
  for (const segment of relative.split('/')) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) fail(code, 'Archive directory conflicts with a non-directory');
      continue;
    } catch (error) {
      if (error instanceof BackupSetError) throw error;
      mkdirSync(current, { mode: 0o700 });
    }
  }
}

export async function extractObjectArchive(archive, destination, manifestObjects) {
  const root = path.resolve(destination);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('OBJECT_RESTORE_INVALID', 'Restore object root is invalid');
  const entries = inspectObjectArchive(archive);
  const expected = new Map([
    ...manifestObjects.files.map((file) => [file.path, file]),
    ...manifestObjects.receipts.map((receipt) => [receipt.receiptPath, {
      path: receipt.receiptPath,
      bytes: receipt.receiptBytes,
      sha256: receipt.receiptSha256,
    }]),
  ]);
  const archivedFiles = new Set(entries.filter((entry) => entry.type === '0').map((entry) => entry.name));
  if (archivedFiles.size !== expected.size) fail('OBJECT_ARCHIVE_MISMATCH', 'Object archive file count differs from manifest');
  for (const name of expected.keys()) {
    if (!archivedFiles.has(name)) fail('OBJECT_ARCHIVE_MISMATCH', 'Object archive is missing a manifest file');
  }

  const descriptor = openSync(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    for (const entry of entries) {
      if (entry.type === '5') {
        ensureDirectoryAt(root, entry.name, 'OBJECT_RESTORE_INVALID');
        continue;
      }
      const manifestFile = expected.get(entry.name);
      if (!manifestFile || entry.size !== manifestFile.bytes) fail('OBJECT_ARCHIVE_MISMATCH', 'Object archive size differs from manifest');
      if (entry.sha256 !== manifestFile.sha256) {
        fail('OBJECT_ARCHIVE_MISMATCH', 'Object archive content differs from manifest');
      }
      ensureDirectoryAt(root, path.posix.dirname(entry.name), 'OBJECT_RESTORE_INVALID');
      const target = path.join(root, ...entry.name.split('/'));
      assertPathInside(root, target, 'OBJECT_ARCHIVE_INVALID');
      const output = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const hash = createHash('sha256');
      let remaining = entry.size;
      let offset = entry.dataOffset;
      try {
        while (remaining > 0) {
          const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
          const read = readSync(descriptor, chunk, 0, chunk.length, offset);
          if (read < 1) fail('OBJECT_ARCHIVE_INVALID', 'Object archive ended during extraction');
          hash.update(chunk.subarray(0, read));
          writeSync(output, chunk, 0, read);
          remaining -= read;
          offset += read;
        }
        fsyncSync(output);
      } finally {
        closeSync(output);
      }
      if (hash.digest('hex') !== manifestFile.sha256 || await fileSha256(target) !== manifestFile.sha256) {
        fail('OBJECT_ARCHIVE_MISMATCH', 'Extracted object does not match its manifest digest');
      }
      fsyncDirectory(path.dirname(target));
    }
  } finally {
    closeSync(descriptor);
  }
  return root;
}

function parseManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('MANIFEST_INVALID', 'Manifest must be an object');
  if (raw.schema !== BACKUP_SET_SCHEMA || raw.schemaVersion !== 1) fail('MANIFEST_INVALID', 'Unsupported manifest schema');
  const backupId = requiredString(raw.backupId, BACKUP_ID_PATTERN, 'MANIFEST_INVALID');
  const databaseName = requiredString(raw.databaseName, SQL_IDENTIFIER, 'MANIFEST_INVALID');
  if (!backupId.startsWith(`${databaseName}-`)) fail('MANIFEST_INVALID', 'Backup id does not match the database');
  if (!raw.startedAt || !raw.snapshotAt || !raw.dumpStartedAt || !raw.dumpCompletedAt || !raw.completedAt
    || Number.isNaN(Date.parse(raw.startedAt))
    || Number.isNaN(Date.parse(raw.snapshotAt))
    || Number.isNaN(Date.parse(raw.dumpStartedAt))
    || Number.isNaN(Date.parse(raw.dumpCompletedAt))
    || Number.isNaN(Date.parse(raw.completedAt))) {
    fail('MANIFEST_INVALID', 'Manifest timestamps are invalid');
  }
  if (Date.parse(raw.completedAt) < Date.parse(raw.startedAt)) fail('MANIFEST_INVALID', 'Completion precedes start');
  if (!raw.application || typeof raw.application.productVersion !== 'string'
    || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(raw.application.productVersion)
    || !['environment', 'release-version-file'].includes(raw.application.productVersionSource)) {
    fail('MANIFEST_INVALID', 'Product version is invalid');
  }
  const validGitIdentity = raw.application.gitSha === null
    ? raw.application.gitShaSource === 'not-provided'
    : typeof raw.application.gitSha === 'string'
      && GIT_SHA.test(raw.application.gitSha)
      && ['environment', 'desktop-build-identity'].includes(raw.application.gitShaSource);
  if (!validGitIdentity) {
    fail('MANIFEST_INVALID', 'Application git SHA is invalid');
  }
  if (!raw.tooling || raw.tooling.implementation !== 'scripts/ops/backup-set.mjs'
    || !SHA256.test(raw.tooling.sha256 ?? '')) {
    fail('MANIFEST_INVALID', 'Backup tool identity is invalid');
  }
  if (!raw.artifacts || typeof raw.artifacts !== 'object') fail('MANIFEST_INVALID', 'Artifact summaries are missing');
  for (const [name, expectedFile] of [
    ['databaseDump', DATABASE_DUMP_FILE],
    ['roles', ROLES_FILE],
    ['objectsArchive', OBJECTS_ARCHIVE_FILE],
  ]) {
    const artifact = raw.artifacts[name];
    if (!artifact || artifact.file !== expectedFile) fail('MANIFEST_INVALID', 'Artifact filename is invalid');
    nonNegativeInteger(artifact.bytes, 'MANIFEST_INVALID');
    requiredString(artifact.sha256, SHA256, 'MANIFEST_INVALID');
  }
  if (!raw.database || !SQL_IDENTIFIER.test(raw.database.databaseOwner ?? '')
    || !Array.isArray(raw.database.migrations) || raw.database.migrations.length < 1
    || !Array.isArray(raw.database.objects) || !Array.isArray(raw.database.importBatches)
    || !Array.isArray(raw.database.roles) || raw.database.roles.length !== raw.database.roleCount
    || !SHA256.test(raw.database.migrationDigest ?? '')
    || !SHA256.test(raw.database.rolesFingerprint ?? '')
    || !positiveInteger(raw.database.roleCount, 'MANIFEST_INVALID')
    || !SHA256.test(raw.database.ownershipFingerprint ?? '')
    || !SHA256.test(raw.database.aclFingerprint ?? '')) {
    fail('MANIFEST_INVALID', 'Database metadata is incomplete');
  }
  for (const migration of raw.database.migrations) {
    if (!migration || !positiveInteger(migration.position, 'MANIFEST_INVALID')
      || !MIGRATION_ID.test(migration.migrationId ?? '')
      || !SHA256.test(migration.sha256 ?? '')
      || !GIT_SHA.test(migration.sourceGitSha ?? '')
      || !SHA256.test(migration.sourceSchemaSha256 ?? '')
      || typeof migration.contractSetId !== 'string'
      || typeof migration.appliedAt !== 'string'
      || !Number.isSafeInteger(migration.executionMs) || migration.executionMs < 0) {
      fail('MANIFEST_INVALID', 'Migration metadata is invalid');
    }
  }
  const migrationDigest = sha256(canonicalJson(raw.database.migrations.map((migration) => ({
    position: migration.position,
    migrationId: migration.migrationId,
    sha256: migration.sha256,
    contractSetId: migration.contractSetId,
    sourceGitSha: migration.sourceGitSha,
    sourceSchemaSha256: migration.sourceSchemaSha256,
  }))));
  if (migrationDigest !== raw.database.migrationDigest) {
    fail('MANIFEST_INVALID', 'Migration digest does not match migration metadata');
  }
  for (const role of raw.database.roles) {
    if (!role || typeof role.name !== 'string' || !SQL_IDENTIFIER.test(role.name)
      || typeof role.login !== 'boolean' || typeof role.superuser !== 'boolean'
      || typeof role.createdb !== 'boolean' || typeof role.createrole !== 'boolean'
      || typeof role.inherit !== 'boolean' || typeof role.replication !== 'boolean'
      || typeof role.bypassrls !== 'boolean' || !Array.isArray(role.memberships)) {
      fail('MANIFEST_INVALID', 'Role metadata is invalid');
    }
    for (const membership of role.memberships) {
      if (!membership || typeof membership.granted !== 'string'
        || !SQL_IDENTIFIER.test(membership.granted) || typeof membership.admin !== 'boolean') {
        fail('MANIFEST_INVALID', 'Role membership metadata is invalid');
      }
    }
  }
  if (sha256(canonicalJson(raw.database.roles)) !== raw.database.rolesFingerprint) {
    fail('MANIFEST_INVALID', 'Role fingerprint does not match role metadata');
  }
  if (!raw.objects || !Array.isArray(raw.objects.files) || !Array.isArray(raw.objects.receipts)
    || !Array.isArray(raw.objects.unreferencedObjectIds)) {
    fail('MANIFEST_INVALID', 'Object metadata is incomplete');
  }
  const seenFiles = new Set();
  for (const file of raw.objects.files) {
    if (!file || !OBJECT_ID.test(file.objectId ?? '') || file.path !== `objects/${file.objectId}`
      || !positiveInteger(file.bytes, 'MANIFEST_INVALID') || !SHA256.test(file.sha256 ?? '')
      || typeof file.databaseReferenced !== 'boolean' || typeof file.receiptReferenced !== 'boolean'
      || seenFiles.has(file.path)) {
      fail('MANIFEST_INVALID', 'Object file metadata is invalid');
    }
    seenFiles.add(file.path);
  }
  const seenReceipts = new Set();
  for (const receipt of raw.objects.receipts) {
    const expectedPath = `batches/${receipt?.importBatchId}.json`;
    if (!receipt || !BATCH_ID.test(receipt.importBatchId ?? '')
      || !OBJECT_ID.test(receipt.objectId ?? '')
      || !SHA256.test(receipt.sha256 ?? '')
      || !positiveInteger(receipt.sizeBytes, 'MANIFEST_INVALID')
      || !SHA256.test(receipt.sourceBindingHash ?? '')
      || receipt.receiptPath !== expectedPath
      || !nonNegativeInteger(receipt.receiptBytes, 'MANIFEST_INVALID')
      || !SHA256.test(receipt.receiptSha256 ?? '')
      || typeof receipt.durableDatabaseBatch !== 'boolean'
      || seenReceipts.has(receipt.receiptPath)) {
      fail('MANIFEST_INVALID', 'Receipt metadata is invalid');
    }
    seenReceipts.add(receipt.receiptPath);
  }
  const filesById = new Map(raw.objects.files.map((file) => [file.objectId, file]));
  const receiptsById = new Map(raw.objects.receipts.map((receipt) => [receipt.importBatchId, receipt]));
  const databaseObjectIds = new Set();
  for (const object of raw.database.objects) {
    if (!object || !OBJECT_ID.test(object.objectId ?? '')
      || object.objectKey !== `intake/${object.objectId}`
      || !SHA256.test(object.sha256 ?? '') || !positiveInteger(object.bytes, 'MANIFEST_INVALID')
      || databaseObjectIds.has(object.objectId)) {
      fail('MANIFEST_INVALID', 'Database object metadata is invalid');
    }
    const file = filesById.get(object.objectId);
    if (!file || !file.databaseReferenced || file.sha256 !== object.sha256 || file.bytes !== object.bytes) {
      fail('MANIFEST_INVALID', 'Database object has no matching archived file');
    }
    databaseObjectIds.add(object.objectId);
  }
  const batchIds = new Set();
  for (const batch of raw.database.importBatches) {
    if (!batch || (typeof batch.importBatchId !== 'string' || !DATABASE_BATCH_ID.test(batch.importBatchId)) || batchIds.has(batch.importBatchId)
      || !SHA256.test(batch.sourceBindingHash ?? '')) {
      fail('MANIFEST_INVALID', 'Import batch metadata is invalid');
    }
    batchIds.add(batch.importBatchId);
    if (['csv', 'excel'].includes(batch.sourceType) && OBJECT_ID.test(batch.sourceRef ?? '')) {
      const receipt = receiptsById.get(batch.importBatchId);
      if (!receipt || !receipt.durableDatabaseBatch
        || receipt.objectId !== batch.sourceRef
        || receipt.sha256 !== batch.sourceSha256
        || receipt.sizeBytes !== batch.sourceSizeBytes
        || receipt.sourceBindingHash !== batch.sourceBindingHash) {
        fail('MANIFEST_INVALID', 'Durable import batch has no matching receipt');
      }
    }
  }
  for (const receipt of raw.objects.receipts) {
    const file = filesById.get(receipt.objectId);
    if (!file || file.sha256 !== receipt.sha256 || file.bytes !== receipt.sizeBytes) {
      fail('MANIFEST_INVALID', 'Receipt has no matching archived object');
    }
    if (receipt.durableDatabaseBatch && !batchIds.has(receipt.importBatchId)) {
      fail('MANIFEST_INVALID', 'Receipt claims a missing durable import batch');
    }
  }
  const receiptObjectIds = new Set(raw.objects.receipts.map((receipt) => receipt.objectId));
  for (const file of raw.objects.files) {
    if (file.databaseReferenced !== databaseObjectIds.has(file.objectId)
      || file.receiptReferenced !== receiptObjectIds.has(file.objectId)) {
      fail('MANIFEST_INVALID', 'Object reference flags do not match metadata');
    }
  }
  const expectedUnreferenced = raw.objects.files
    .filter((file) => !file.databaseReferenced && !file.receiptReferenced)
    .map((file) => file.objectId)
    .sort();
  const declaredUnreferenced = [...raw.objects.unreferencedObjectIds].sort();
  if (canonicalJson(expectedUnreferenced) !== canonicalJson(declaredUnreferenced)) {
    fail('MANIFEST_INVALID', 'Unreferenced object list does not match archived files');
  }
  if (!raw.replication || !['none', 'same-host-copy', 'offsite-declared'].includes(raw.replication.mode)
    || raw.replication.durability !== 'not-assessed') {
    fail('MANIFEST_INVALID', 'Replication metadata is invalid');
  }
  return Object.freeze(raw);
}

function statArtifact(setDirectory, artifact, code) {
  const file = path.join(setDirectory, artifact.file);
  let info;
  try {
    info = lstatSync(file);
  } catch {
    fail(code, `Missing ${artifact.file}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) fail(code, `${artifact.file} is not a regular file`);
  if (info.size !== artifact.bytes) fail('BACKUP_ARTIFACT_SIZE_MISMATCH', `${artifact.file} byte count differs from manifest`);
}

export async function verifyBackupSet(setDirectory, options = {}) {
  const setRoot = safeRealDirectory(setDirectory, 'BACKUP_SET_INVALID');
  const manifestPath = path.join(setRoot, MANIFEST_FILE);
  const manifestDigest = readBoundedText(path.join(setRoot, MANIFEST_DIGEST_FILE), 256, 'MANIFEST_DIGEST_INVALID').trim();
  const match = /^([0-9a-f]{64})[ ]{2}manifest\.json$/u.exec(manifestDigest);
  if (!match) fail('MANIFEST_DIGEST_INVALID', 'manifest.sha256 has an invalid format');
  const rawManifest = readFileSync(manifestPath);
  if (sha256(rawManifest) !== match[1]) fail('MANIFEST_DIGEST_INVALID', 'Manifest digest does not match');
  let parsed;
  try {
    parsed = JSON.parse(rawManifest.toString('utf8'));
  } catch {
    fail('MANIFEST_INVALID', 'Manifest JSON is invalid');
  }
  const manifest = parseManifest(parsed);
  const directoryName = path.basename(setRoot);
  if (options.expectedBackupId
    ? manifest.backupId !== options.expectedBackupId || !directoryName.includes(options.expectedBackupId)
    : directoryName !== manifest.backupId) {
    fail('BACKUP_SET_INVALID', 'Directory name and backup id differ');
  }
  for (const artifact of Object.values(manifest.artifacts)) {
    statArtifact(setRoot, artifact, 'BACKUP_ARTIFACT_MISSING');
    if (await fileSha256(path.join(setRoot, artifact.file)) !== artifact.sha256) {
      fail('BACKUP_ARTIFACT_DIGEST_MISMATCH', `${artifact.file} digest differs from manifest`);
    }
  }
  const archiveEntries = inspectObjectArchive(path.join(setRoot, OBJECTS_ARCHIVE_FILE));
  const archiveFiles = new Set(archiveEntries.filter((entry) => entry.type === '0').map((entry) => entry.name));
  const expectedArchiveFiles = new Set([
    ...manifest.objects.files.map((file) => file.path),
    ...manifest.objects.receipts.map((receipt) => receipt.receiptPath),
  ]);
  const expectedArchiveFileByPath = new Map([
    ...manifest.objects.files.map((file) => [file.path, file]),
    ...manifest.objects.receipts.map((receipt) => [receipt.receiptPath, {
      bytes: receipt.receiptBytes,
      sha256: receipt.receiptSha256,
    }]),
  ]);
  if (archiveFiles.size !== expectedArchiveFiles.size) {
    fail('OBJECT_ARCHIVE_MISMATCH', 'Object archive contains an unlisted file');
  }
  for (const entry of archiveEntries) {
    if (entry.type !== '0') continue;
    const expected = expectedArchiveFileByPath.get(entry.name);
    if (!expected || entry.size !== expected.bytes || entry.sha256 !== expected.sha256) {
      fail('OBJECT_ARCHIVE_MISMATCH', 'Object archive content differs from manifest');
    }
  }
  if (options.pgBin) {
    run(path.join(options.pgBin, 'pg_restore'), ['--list', path.join(setRoot, DATABASE_DUMP_FILE)], {
      code: 'DATABASE_DUMP_INVALID',
      timeout: 60_000,
    });
  }
  return Object.freeze({
    directory: setRoot,
    manifest,
    manifestSha256: match[1],
  });
}

function uniqueBackupId(databaseName, when, occupied) {
  const stamp = when.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  for (let sequence = 1; sequence <= 999; sequence += 1) {
    const candidate = `${databaseName}-${stamp}-${String(sequence).padStart(3, '0')}`;
    if (!occupied.has(candidate)) return candidate;
  }
  fail('BACKUP_ID_EXHAUSTED', 'Too many backup sets for one second');
}

export function replicationConfiguration(copyRoot) {
  if (!copyRoot) return Object.freeze({ mode: 'none', durability: 'not-assessed', destinationIdSha256: null });
  const scope = process.env.CUSTOMER_AGENT_BACKUP_COPY_SCOPE ?? 'same-host';
  const mode = scope === 'offsite' ? 'offsite-declared' : scope === 'same-host' ? 'same-host-copy' : null;
  if (mode === null) fail('COPY_SCOPE_INVALID', 'CUSTOMER_AGENT_BACKUP_COPY_SCOPE must be same-host or offsite');
  return Object.freeze({
    mode,
    durability: 'not-assessed',
    destinationIdSha256: sha256(path.resolve(copyRoot)),
  });
}

function createTar(archive, objectStore) {
  run('tar', [
    '--format=ustar',
    '--create',
    '--file', archive,
    '--directory', objectStore,
    'objects',
    'batches',
  ], { code: 'OBJECT_ARCHIVE_CREATE_FAILED' });
  inspectObjectArchive(archive);
}

async function artifactSummary(setDirectory, file) {
  const info = lstatSync(path.join(setDirectory, file));
  return Object.freeze({
    file,
    bytes: info.size,
    sha256: await fileSha256(path.join(setDirectory, file)),
  });
}

function writeManifest(setDirectory, manifest) {
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  atomicWrite(path.join(setDirectory, MANIFEST_FILE), raw);
  atomicWrite(path.join(setDirectory, MANIFEST_DIGEST_FILE), `${sha256(raw)}  ${MANIFEST_FILE}\n`);
}

function copySet(source, destinationRoot, backupIdValue) {
  mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  const root = safeRealDirectory(destinationRoot, 'COPY_DESTINATION_INVALID');
  const final = path.join(root, backupIdValue);
  if (existsSync(final)) fail('COPY_DESTINATION_CONFLICT', 'Copy destination already contains this backup id');
  const temporary = path.join(root, `.${backupIdValue}.${randomBytes(6).toString('hex')}.partial`);
  try {
    cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    return { root, final, temporary };
  } catch {
    rmSync(temporary, { recursive: true, force: true });
    fail('COPY_FAILED', 'Cannot copy the staged backup set');
  }
}

function removeVerifiedBackupSet(directory) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('RETENTION_TARGET_INVALID', 'Retention target is not a directory');
  rmSync(directory, { recursive: true, force: false });
  fsyncDirectory(path.dirname(directory));
}

export async function pruneVerifiedBackupSets(options) {
  const keep = positiveInteger(options.keep, 'RETENTION_INVALID');
  const databaseName = requiredString(options.databaseName, SQL_IDENTIFIER, 'RETENTION_INVALID');
  const root = safeRealDirectory(options.root, 'RETENTION_INVALID');
  const currentBackupId = options.currentBackupId;
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => BACKUP_ID_PATTERN.exec(name)?.[1] === databaseName)
    .sort()
    .reverse();
  let removed = 0;
  let preserved = 0;
  let verifiedCount = 0;
  for (const name of candidates) {
    const directory = path.join(root, name);
    try {
      const verified = await verifyBackupSet(directory, { pgBin: options.pgBin });
      if (verified.manifest.databaseName !== databaseName) {
        preserved += 1;
        continue;
      }
      verifiedCount += 1;
      if (verifiedCount <= keep || name === currentBackupId) continue;
      removeVerifiedBackupSet(directory);
      removed += 1;
    } catch {
      preserved += 1;
    }
  }
  return Object.freeze({ removed, preserved, candidates: candidates.length });
}

export async function createBackupSet(options = {}) {
  const preserveExisting = options.preserveExisting === undefined ? false : options.preserveExisting;
  if (typeof preserveExisting !== 'boolean') fail('BACKUP_ARGUMENT_INVALID', 'Invalid backup preservation option');
  const startedAt = utcNow();
  const stack = options.stack ?? loadStackProfile();
  const pgBin = options.pgBin ?? discoverPg15Bin();
  const backupRoot = path.resolve(
    options.backupRoot
      ?? process.env.CUSTOMER_AGENT_BACKUP_ROOT
      ?? '/srv/customer-agent/catalog-backups',
  );
  const copyRootValue = options.copyRoot ?? process.env.CUSTOMER_AGENT_BACKUP_COPY_TO ?? '';
  const copyRoot = copyRootValue ? path.resolve(copyRootValue) : null;
  const keepValue = process.env.CUSTOMER_AGENT_BACKUP_KEEP ?? '14';
  if (!/^[1-9][0-9]*$/u.test(keepValue)) fail('RETENTION_INVALID', 'Backup retention must be a positive integer');
  const keep = Number.parseInt(keepValue, 10);
  if (!Number.isSafeInteger(keep)) fail('RETENTION_INVALID', 'Backup retention is too large');
  if (copyRoot && pathsOverlap(copyRoot, stack.objectStoreDirectory)) {
    fail('COPY_DESTINATION_INVALID', 'Copy destination overlaps the object store');
  }
  const releaseLock = await acquireBackupLock(backupRoot, stack);
  let staging = null;
  let copyStaging = null;
  let snapshot = null;
  let operationError;
  let result;
  try {
    const setsRoot = path.join(backupRoot, BACKUP_SETS_DIRECTORY);
    mkdirSync(setsRoot, { recursive: true, mode: 0o700 });
    const now = utcNow();
    const occupied = new Set(readdirSync(setsRoot));
    const id = uniqueBackupId(stack.databaseName, now, occupied);
    staging = path.join(setsRoot, `.${id}.${randomBytes(6).toString('hex')}.partial`);
    mkdirSync(staging, { mode: 0o700 });

    snapshot = await openDatabaseSnapshot(stack);
    const snapshotAt = snapshot.at;
    const snapshotMetadata = readDatabaseMetadata(pgBin, stack, { snapshotId: snapshot.id });
    const beforeDump = readDatabaseMetadata(pgBin, stack).database;
    if (beforeDump.databaseOwner !== snapshotMetadata.database.databaseOwner
      || beforeDump.rolesFingerprint !== snapshotMetadata.database.rolesFingerprint
      || beforeDump.roleCount !== snapshotMetadata.database.roleCount) {
      fail('DATABASE_ROLES_CHANGED_DURING_BACKUP', 'Database owner or role catalog changed during the snapshot');
    }
    const dumpStartedAt = utcNow();
    log(`backup start database=${stack.databaseName} backup_id=${id}`);
    run(path.join(pgBin, 'pg_dump'), [
      '--format=custom',
      '--compress=6',
      '--snapshot', snapshot.id,
      ...connectionArguments(stack),
      '--dbname', stack.databaseName,
      '--file', path.join(staging, DATABASE_DUMP_FILE),
    ], { code: 'DATABASE_DUMP_FAILED', timeout: 30 * 60_000 });
    run(path.join(pgBin, 'pg_dumpall'), [
      '--roles-only',
      '--no-role-passwords',
      ...connectionArguments(stack),
      '--database', 'postgres',
      '--file', path.join(staging, ROLES_FILE),
    ], { code: 'ROLE_DUMP_FAILED', timeout: 5 * 60_000 });
    const dumpCompletedAt = utcNow();
    await snapshot.close();
    snapshot = null;
    const current = readDatabaseMetadata(pgBin, stack).database;
    if (current.databaseOwner !== snapshotMetadata.database.databaseOwner
      || current.rolesFingerprint !== snapshotMetadata.database.rolesFingerprint
      || current.roleCount !== snapshotMetadata.database.roleCount) {
      fail('DATABASE_ROLES_CHANGED_DURING_BACKUP', 'Database owner or role catalog changed during the dump');
    }
    const objectMetadata = await inspectObjectStore(stack, snapshotMetadata.database);
    createTar(path.join(staging, OBJECTS_ARCHIVE_FILE), stack.objectStoreDirectory);
    const artifacts = Object.freeze({
      databaseDump: await artifactSummary(staging, DATABASE_DUMP_FILE),
      roles: await artifactSummary(staging, ROLES_FILE),
      objectsArchive: await artifactSummary(staging, OBJECTS_ARCHIVE_FILE),
    });
    const completedAt = utcNow();
    const replication = replicationConfiguration(copyRoot);
    const manifest = Object.freeze({
      schema: BACKUP_SET_SCHEMA,
      schemaVersion: 1,
      backupId: id,
      databaseName: stack.databaseName,
      startedAt,
      snapshotAt,
      dumpStartedAt,
      dumpCompletedAt,
      completedAt,
      application: appIdentity(),
      tooling: await toolingIdentity(),
      artifacts,
      database: snapshotMetadata.database,
      objects: objectMetadata,
      replication,
    });
    writeManifest(staging, manifest);
    const staged = await verifyBackupSet(staging, { pgBin, expectedBackupId: id });

    if (copyRoot) {
      const prepared = copySet(staged.directory, path.join(copyRoot, BACKUP_SETS_DIRECTORY), id);
      copyStaging = prepared.temporary;
      const verifiedCopy = await verifyBackupSet(copyStaging, { pgBin, expectedBackupId: id });
      if (verifiedCopy.manifestSha256 !== staged.manifestSha256) {
        fail('BACKUP_COPY_MISMATCH', 'Backup copy differs from the staged backup');
      }
      const finalLocal = path.join(backupRoot, BACKUP_SETS_DIRECTORY, id);
      if (existsSync(finalLocal)) fail('BACKUP_ID_CONFLICT', 'Backup destination appeared while preparing publication');
      renameSync(copyStaging, prepared.final);
      copyStaging = null;
      fsyncDirectory(prepared.root);
      try {
        renameSync(staging, finalLocal);
        staging = null;
        fsyncDirectory(path.dirname(finalLocal));
      } catch (error) {
        rmSync(prepared.final, { recursive: true, force: true });
        fsyncDirectory(prepared.root);
        throw error;
      }
      const published = await verifyBackupSet(finalLocal, { pgBin });
      const publishedCopy = await verifyBackupSet(prepared.final, { pgBin });
      if (published.manifestSha256 !== staged.manifestSha256 || publishedCopy.manifestSha256 !== staged.manifestSha256) {
        fail('BACKUP_COPY_MISMATCH', 'Published backup or copy differs from the staged backup');
      }
      let retentionMessage = 'retention preserved existing backup sets';
      if (!preserveExisting) {
        const localRetention = await pruneVerifiedBackupSets({
          root: path.dirname(finalLocal),
          databaseName: stack.databaseName,
          keep,
          currentBackupId: id,
          pgBin,
        });
        const copyRetention = await pruneVerifiedBackupSets({
          root: prepared.root,
          databaseName: stack.databaseName,
          keep,
          currentBackupId: id,
          pgBin,
        });
        retentionMessage = `retention local_removed=${localRetention.removed} local_preserved=${localRetention.preserved} copy_removed=${copyRetention.removed} copy_preserved=${copyRetention.preserved}`;
      }
      log(`backup published backup_id=${id} replication=${replication.mode} durability=${replication.durability}`);
      log(retentionMessage);
      result = Object.freeze({
        status: 'PASS',
        degraded: replication.mode !== 'offsite-declared',
        path: published.directory,
        copyPath: prepared.final,
        manifest: published.manifest,
        verifiedCopySha256: verifiedCopy.manifestSha256,
      });
    } else {
      const finalLocal = path.join(backupRoot, BACKUP_SETS_DIRECTORY, id);
      renameSync(staging, finalLocal);
      staging = null;
      fsyncDirectory(path.dirname(finalLocal));
      const published = await verifyBackupSet(finalLocal, { pgBin });
      log(`backup published backup_id=${id} replication=none durability=not-assessed`);
      log('retention skipped because no verified copy exists');
      result = Object.freeze({
        status: 'PASS',
        degraded: true,
        path: published.directory,
        copyPath: null,
        manifest: published.manifest,
        verifiedCopySha256: null,
      });
    }
  } catch (error) {
    operationError = error;
  } finally {
    const cleanupErrors = [];
    if (snapshot) {
      await snapshot.close().catch((error) => cleanupErrors.push(error));
    }
    for (const temporary of [copyStaging, staging]) {
      if (!temporary) continue;
      try {
        rmSync(temporary, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await releaseLock();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      const cleanupError = cleanupErrors.length === 1
        ? cleanupErrors[0]
        : new AggregateError(cleanupErrors, 'Backup cleanup failed');
      operationError = operationError
        ? new AggregateError([operationError, cleanupError], 'Backup and cleanup both failed')
        : cleanupError;
    }
  }
  if (operationError) throw operationError;
  if (!result) fail('BACKUP_FAILED', 'Backup completed without a result');
  return result;
}

function safeScratchRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-backup-restore-'));
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('customer-agent-backup-restore-')) {
    fail('SCRATCH_INVALID', 'Unsafe scratch directory');
  }
  return root;
}

function removeScratch(root) {
  if (!root) return;
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('customer-agent-backup-restore-')) {
    fail('SCRATCH_INVALID', 'Refusing unsafe scratch cleanup');
  }
  rmSync(root, { recursive: true, force: false });
}

function createScratchCluster(pgBin, root) {
  const data = path.join(root, 'pgdata');
  const socket = path.join(root, 'socket');
  const logFile = path.join(root, 'postgres.log');
  const owner = 'customer_agent_restore_owner';
  const port = randomInt(49_152, 65_535);
  mkdirSync(socket, { recursive: true, mode: 0o700 });
  run(path.join(pgBin, 'initdb'), [
    '--pgdata', data,
    `--username=${owner}`,
    '--auth-local=trust',
    '--auth-host=reject',
    '--encoding=UTF8',
    '--locale=C',
    '--no-sync',
  ], { code: 'RESTORE_CLUSTER_INIT_FAILED', timeout: 120_000 });
  if (socket.includes("'")) fail('SCRATCH_INVALID', 'Unsafe PostgreSQL socket path');
  writeFileSync(path.join(data, 'postgresql.conf'), [
    '',
    "listen_addresses = ''",
    `unix_socket_directories = '${socket}'`,
    'unix_socket_permissions = 0700',
    `port = ${port}`,
    "timezone = 'Asia/Shanghai'",
    'logging_collector = off',
    '',
  ].join('\n'), { mode: 0o600 });
  run(path.join(pgBin, 'pg_ctl'), ['--pgdata', data, '--log', logFile, '--wait', 'start'], {
    code: 'RESTORE_CLUSTER_START_FAILED',
    timeout: 120_000,
  });
  return {
    data,
    socket,
    port,
    owner,
    started: true,
  };
}

function stopScratchCluster(pgBin, cluster) {
  if (!cluster?.started) return;
  run(path.join(pgBin, 'pg_ctl'), ['--pgdata', cluster.data, '--mode', 'immediate', '--wait', 'stop'], {
    code: 'RESTORE_CLUSTER_STOP_FAILED',
    timeout: 60_000,
  });
  cluster.started = false;
}

function restoreClusterArguments(cluster) {
  return [
    '--host', cluster.socket,
    '--port', String(cluster.port),
    '--username', cluster.owner,
  ];
}

function regularFileDigests(root, code = 'CANDIDATE_RELEASE_INVALID') {
  const digests = new Map();
  let rootInfo;
  try {
    rootInfo = lstatSync(root);
  } catch {
    fail(code, 'Candidate build input is missing');
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail(code, 'Candidate build input is not a regular directory');
  }
  const visit = (directory, relativeDirectory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(code, `Candidate build input contains a symbolic link: ${relative}`);
      }
      if (entry.isDirectory()) {
        visit(absolute, relative);
      } else if (entry.isFile()) {
        digests.set(relative, sha256(readFileSync(absolute)));
      } else {
        fail(code, `Candidate build output has an unsupported entry: ${relative}`);
      }
    }
  };
  visit(root, '');
  return digests;
}

function candidateGitEnvironment(releaseRoot) {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: releaseRoot,
    GIT_OPTIONAL_LOCKS: '0',
  };
}

const RUNTIME_BUILD_PACKAGES = [
  'packages/contracts',
  'packages/retrieval-core',
  'packages/job-roster',
  'packages/unified-contracts',
  'packages/content-intake',
  'packages/database',
  'apps/api',
];

function runtimeBuildPackages(sourceRoot) {
  const code = 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH';
  const packages = RUNTIME_BUILD_PACKAGES.filter(directory => existsSync(path.join(sourceRoot, directory)));
  for (const required of ['packages/database', 'apps/api']) {
    if (!packages.includes(required)) fail(code, `Required runtime package is missing: ${required}`);
  }
  const directories = new Map(packages.map(directory => [`@customer-agent/${path.basename(directory)}`, directory]));
  for (const directory of packages) {
    const metadata = readJson(path.join(sourceRoot, directory, 'package.json'), code);
    if (!metadata || metadata.name !== `@customer-agent/${path.basename(directory)}`) {
      fail(code, `Invalid runtime package identity: ${directory}`);
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = metadata[field];
      if (dependencies !== undefined && (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies))) {
        fail(code, `Invalid runtime dependencies: ${directory} ${field}`);
      }
      for (const [name, specifier] of Object.entries(dependencies ?? {})) {
        if (typeof specifier !== 'string' || !specifier) fail(code, `Invalid dependency specifier: ${directory} ${name}`);
        if (!name.startsWith('@customer-agent/')) continue;
        const target = directories.get(name);
        if (!target || specifier !== 'workspace:*' || packages.indexOf(target) >= packages.indexOf(directory)) {
          fail(code, `Unsupported or missing workspace dependency: ${directory} ${name}`);
        }
      }
    }
  }
  return packages;
}

function assertRuntimeBuildLock(sourceRoot, packages) {
  const code = 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH';
  const trustedLockPath = path.join(REPOSITORY_ROOT, 'pnpm-lock.yaml');
  const installedLockPath = path.join(REPOSITORY_ROOT, 'node_modules/.pnpm/lock.yaml');
  if (!existsSync(trustedLockPath) || !existsSync(installedLockPath)
    || sha256(readFileSync(trustedLockPath)) !== sha256(readFileSync(installedLockPath))) {
    fail(code, 'Installed tooling differs from its trusted lockfile');
  }
  const { parse } = createRequire(path.join(REPOSITORY_ROOT, 'packages/contracts/package.json'))('yaml');
  let candidate;
  let trusted;
  try {
    candidate = parse(readBoundedText(path.join(sourceRoot, 'pnpm-lock.yaml'), MAX_MANIFEST_BYTES, code));
    trusted = parse(readBoundedText(trustedLockPath, MAX_MANIFEST_BYTES, code));
  } catch {
    fail(code, 'Runtime build lockfile is unreadable');
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || !candidate.importers || typeof candidate.importers !== 'object' || Array.isArray(candidate.importers)) {
    fail(code, 'Runtime build lockfile is invalid');
  }
  const { importers: candidateImporters, ...candidateResolution } = candidate;
  const { importers: trustedImporters, ...trustedResolution } = trusted;
  // Only workspace links may differ across supported releases. The external
  // graph, registry integrity records and installed lock bytes stay bound.
  if (canonicalJson(candidateResolution) !== canonicalJson(trustedResolution)
    || canonicalJson(candidateImporters['.']) !== canonicalJson(trustedImporters['.'])) {
    fail(code, 'Candidate external lock graph differs from installed trusted tooling');
  }
  for (const directory of packages) {
    const metadata = readJson(path.join(sourceRoot, directory, 'package.json'), code);
    const trustedMetadata = readJson(path.join(REPOSITORY_ROOT, directory, 'package.json'), code);
    const importer = candidateImporters[directory];
    if (!importer || typeof importer !== 'object' || Array.isArray(importer)) {
      fail(code, `Candidate lock importer is missing: ${directory}`);
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const declarations = metadata[field] ?? {};
      const external = Object.fromEntries(Object.entries(declarations).filter(([name]) => !name.startsWith('@customer-agent/')));
      const trustedExternal = Object.fromEntries(Object.entries(trustedMetadata[field] ?? {})
        .filter(([name]) => !name.startsWith('@customer-agent/')));
      if (canonicalJson(external) !== canonicalJson(trustedExternal)) {
        fail(code, `Unsupported candidate external dependencies: ${directory} ${field}`);
      }
      // pnpm does not record peer declarations in importer dependency maps.
      if (field === 'peerDependencies') continue;
      const locked = Object.hasOwn(importer, field) ? importer[field] : {};
      if (!locked || typeof locked !== 'object' || Array.isArray(locked)) {
        fail(code, `Invalid candidate lock dependency map: ${directory} ${field}`);
      }
      if (canonicalJson(Object.keys(locked).sort()) !== canonicalJson(Object.keys(declarations).sort())) {
        fail(code, `Candidate lock declarations differ from package metadata: ${directory} ${field}`);
      }
      for (const [name, specifier] of Object.entries(declarations)) {
        const expected = name.startsWith('@customer-agent/')
          ? { specifier, version: `link:${path.posix.relative(directory, `packages/${name.slice('@customer-agent/'.length)}`)}` }
          : trustedImporters[directory]?.[field]?.[name];
        if (locked[name]?.specifier !== specifier || canonicalJson(locked[name]) !== canonicalJson(expected)) {
          fail(code, `Candidate locked dependency is unsupported: ${directory} ${name}`);
        }
      }
    }
  }
}

function trackedReleaseFiles(releaseRoot, gitSha, roots = []) {
  const listing = spawnSync(
    'git',
    ['-C', releaseRoot, 'ls-tree', '-r', '-z', gitSha, '--', ...roots],
    { encoding: 'utf8', env: candidateGitEnvironment(releaseRoot), maxBuffer: 16 * 1024 * 1024 },
  );
  if (listing.error || listing.status !== 0) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate tracked source list is unreadable');
  }
  return listing.stdout.split('\0').filter(Boolean).map(entry => {
    const [metadata, relative] = entry.split('\t');
    const [mode, type, objectId] = metadata.split(' ');
    if (!relative || roots.length > 0 && !roots.some((root) => relative === root || relative.startsWith(`${root}/`))
      || relative.split('/').some((part) => ['..', 'dist', 'node_modules'].includes(part))
      || type !== 'blob' || !['100644', '100755'].includes(mode)) {
      fail('CANDIDATE_RELEASE_INVALID', 'Candidate tracked source is not a regular build input');
    }
    return { relative, objectId };
  });
}

function materializeTrackedBuildSources(releaseRoot, gitSha, destination, verifyRuntime = false) {
  // Stack startup executes source outside the runtime packages, including transitive imports.
  const roots = verifyRuntime ? [] : ['packages/database'];
  for (const { relative, objectId } of trackedReleaseFiles(releaseRoot, gitSha, roots)) {
    const source = path.join(releaseRoot, relative);
    let info;
    try {
      info = lstatSync(source);
    } catch {
      fail('CANDIDATE_RELEASE_INVALID', `Candidate tracked file is missing: ${relative}`);
    }
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(source) !== source) {
      fail('CANDIDATE_RELEASE_INVALID', `Candidate tracked file is not regular: ${relative}`);
    }
    const target = path.join(destination, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    const content = readFileSync(target);
    // Also bind bytes to Git when status hides a file through assume-unchanged or skip-worktree.
    const blobId = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    if (blobId !== objectId) {
      fail('CANDIDATE_RELEASE_INVALID', `Candidate tracked file differs from Git: ${relative}`);
    }
  }
  if (!verifyRuntime) {
    symlinkSync(path.join(REPOSITORY_ROOT, 'node_modules'), path.join(destination, 'node_modules'), 'dir');
    symlinkSync(path.join(REPOSITORY_ROOT, 'packages/database/node_modules'),
      path.join(destination, 'packages/database/node_modules'), 'dir');
    return ['packages/database'];
  }
  const packages = runtimeBuildPackages(destination);
  const lockPath = path.join(destination, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    fail('CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH', 'Candidate tracked lockfile is missing');
  }
  assertRuntimeBuildLock(destination, packages);
  linkRuntimeBuildDependencies(destination, '', packages);
  for (const directory of packages) {
    // This verifier supports the trusted build configuration and dependency contract only.
    // Config changes require matching tooling, rather than resolving paths into candidate dist.
    for (const file of ['tsconfig.json', 'tsconfig.build.json']) {
      const relative = path.join(directory, file);
      if (canonicalJson(readJson(path.join(destination, relative), 'CANDIDATE_RUNTIME_BUILD_CONFIG_MISMATCH'))
        !== canonicalJson(readJson(path.join(REPOSITORY_ROOT, relative), 'CANDIDATE_RUNTIME_BUILD_CONFIG_MISMATCH'))) {
        fail('CANDIDATE_RUNTIME_BUILD_CONFIG_MISMATCH', `Unsupported candidate build configuration: ${relative}`);
      }
    }
    const relative = path.join(directory, 'package.json');
    const candidate = readJson(path.join(destination, relative), 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH');
    const trusted = readJson(path.join(REPOSITORY_ROOT, relative), 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH');
    for (const field of ['type', 'imports', 'main', 'types']) {
      if (canonicalJson(candidate[field]) !== canonicalJson(trusted[field])) {
        fail('CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH', `Unsupported candidate package contract: ${relative} ${field}`);
      }
    }
    // Historical releases can expose a subset of the supported exports. Each
    // target retains the trusted in-package path and condition mapping.
    if (!candidate.exports || typeof candidate.exports !== 'object' || Array.isArray(candidate.exports)
      || !Object.hasOwn(candidate.exports, '.')
      || Object.entries(candidate.exports).some(([name, target]) =>
        canonicalJson(target) !== canonicalJson(trusted.exports?.[name]))) {
      fail('CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH', `Unsupported candidate exports: ${relative}`);
    }
    linkRuntimeBuildDependencies(destination, directory, packages);
  }
  return packages;
}

/** Keeps controller source and owned output independent of candidate artifact damage. */
export function assertControllerArtifactIsolation(controller, candidate) {
  const code = 'CONTROLLER_ARTIFACT_SHARED';
  if (realpathSync(controller.root) === realpathSync(candidate.root)) {
    fail(code, 'Controller and candidate must have independent artifact roots');
  }
  const ownedFiles = release => {
    const files = trackedReleaseFiles(release.root, release.gitSha)
      .filter(({ relative }) => /\.(?:[cm]?[jt]sx?|json|ya?ml|sql|sh)$/u.test(relative) || relative === 'VERSION')
      .map(({ relative }) => path.join(release.root, relative));
    for (const directory of runtimeBuildPackages(release.root)) {
      const dist = path.join(release.root, directory, 'dist');
      files.push(...Array.from(regularFileDigests(dist).keys(), relative => path.join(dist, relative)));
    }
    return files;
  };
  const candidatePaths = new Set();
  const candidateInodes = new Set();
  for (const file of ownedFiles(candidate)) {
    const info = lstatSync(file);
    candidatePaths.add(realpathSync(file));
    candidateInodes.add(`${info.dev}:${info.ino}`);
  }
  for (const file of ownedFiles(controller)) {
    const info = lstatSync(file);
    if (candidatePaths.has(realpathSync(file)) || candidateInodes.has(`${info.dev}:${info.ino}`)) {
      fail(code, 'Controller source or owned output shares a candidate artifact file');
    }
  }
}

function linkRuntimeBuildDependencies(destination, directory, packages) {
  const modules = path.join(destination, directory, 'node_modules');
  mkdirSync(modules, { recursive: true });
  for (const entry of readdirSync(path.join(REPOSITORY_ROOT, directory, 'node_modules'))) {
    if (entry.startsWith('.') || entry === '@customer-agent') continue;
    symlinkSync(realpathSync(path.join(REPOSITORY_ROOT, directory, 'node_modules', entry)),
      path.join(modules, entry), 'dir');
  }
  const scope = path.join(modules, '@customer-agent');
  mkdirSync(scope);
  for (const dependency of packages) {
    symlinkSync(path.join(destination, dependency), path.join(scope, path.basename(dependency)), 'dir');
  }
}

// Stable digest of the complete relative file set and bytes. Runtime verification
// uses one mismatch code; the default preserves the database input-error code.
export function assertCandidateBuildDigests(expectedRoot, actualRoot, code = 'CANDIDATE_RELEASE_BUILD_MISMATCH') {
  const inputCode = code === 'CANDIDATE_RELEASE_BUILD_MISMATCH' ? 'CANDIDATE_RELEASE_INVALID' : code;
  const expected = canonicalJson(Object.fromEntries(regularFileDigests(expectedRoot, inputCode)));
  const actual = canonicalJson(Object.fromEntries(regularFileDigests(actualRoot, inputCode)));
  if (expected !== actual) {
    fail(code, 'Candidate build file set or content differs from its tracked sources');
  }
  return sha256(expected);
}

function assertCandidateBuild(releaseRoot, gitSha, verifyRuntime = false) {
  const buildRoot = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-candidate-database-build-'));
  const sourceRoot = path.join(buildRoot, 'source');
  const buildCode = verifyRuntime ? 'CANDIDATE_RUNTIME_BUILD_FAILED' : 'CANDIDATE_RELEASE_BUILD_FAILED';
  const mismatchCode = verifyRuntime ? 'CANDIDATE_RUNTIME_BUILD_MISMATCH' : 'CANDIDATE_RELEASE_BUILD_MISMATCH';
  mkdirSync(sourceRoot);
  try {
    const packages = materializeTrackedBuildSources(releaseRoot, gitSha, sourceRoot, verifyRuntime);
    const tsc = path.join(REPOSITORY_ROOT, 'packages/database/node_modules/typescript/bin/tsc');
    const digests = [];
    for (const directory of packages) {
      const buildDirectory = path.join(sourceRoot, directory, 'dist');
      const build = spawnSync(process.execPath, [tsc,
        '-p', `${directory}/tsconfig.build.json`, '--outDir', buildDirectory,
      ], {
        cwd: sourceRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: os.devNull,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_OPTIONAL_LOCKS: '0',
        },
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 120_000,
      });
      if (build.error || build.status !== 0) {
        fail(buildCode, `Candidate tracked sources did not build: ${directory}`);
      }
      const digest = assertCandidateBuildDigests(buildDirectory, path.join(releaseRoot, directory, 'dist'), mismatchCode);
      digests.push([directory, digest]);
    }
    if (verifyRuntime) assertRuntimeWorkspaceResolution(releaseRoot, sourceRoot, packages);
    return sha256(canonicalJson(digests));
  } finally {
    rmSync(buildRoot, { recursive: true, force: true });
  }
}

function assertRuntimeWorkspaceResolution(releaseRoot, rebuiltRoot, packages) {
  const directories = new Map(packages.map((directory) => [
    readJson(path.join(rebuiltRoot, directory, 'package.json')).name, directory,
  ]));
  for (const directory of packages) {
    const metadata = readJson(path.join(rebuiltRoot, directory, 'package.json'));
    const requireFromRuntime = createRequire(path.join(releaseRoot, directory, 'dist/index.js'));
    const dependencies = {
      ...metadata.dependencies,
      ...metadata.devDependencies,
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies,
    };
    for (const dependency of Object.keys(dependencies)) {
      if (!dependency.startsWith('@customer-agent/')) continue;
      const searchRoot = requireFromRuntime.resolve.paths(dependency)?.find((entry) =>
        existsSync(path.join(entry, dependency)));
      const target = directories.get(dependency);
      // Bind the package root as well as its dist. A foreign package can link its
      // bare export to verified bytes while sending a subpath elsewhere.
      if (!searchRoot || !target || realpathSync(path.join(searchRoot, dependency))
        !== realpathSync(path.join(releaseRoot, target))) {
        fail('CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH',
          'Candidate workspace resolution differs from the verified package root');
      }
    }
  }
}

// verifyRuntime adds runtimeBuildSha256 only after every selected dist tree matches.
// CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH rejects lock/package-contract drift.
// CANDIDATE_RUNTIME_BUILD_CONFIG_MISMATCH rejects compiler-configuration drift.
// CANDIDATE_RUNTIME_BUILD_FAILED reports tsc failure or timeout.
// CANDIDATE_RUNTIME_BUILD_MISMATCH rejects missing/extra/changed/nonregular output.
// Existing identity and tracked-source failures use CANDIDATE_RELEASE_INVALID.
export function readCandidateRelease(candidateRelease, { verifyRuntime = false } = {}) {
  let releaseRoot;
  try {
    releaseRoot = realpathSync(candidateRelease);
    if (!lstatSync(releaseRoot).isDirectory()) fail('CANDIDATE_RELEASE_INVALID', 'Candidate release is not a directory');
  } catch (error) {
    if (error instanceof BackupSetError) throw error;
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate release does not exist');
  }
  if (!GIT_SHA.test(path.basename(releaseRoot))) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate release directory must be named by its full Git SHA');
  }
  const gitEnvironment = candidateGitEnvironment(releaseRoot);
  const headResult = spawnSync(
    'git',
    ['-C', releaseRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
    { encoding: 'utf8', env: gitEnvironment },
  );
  if (headResult.status !== 0 || !GIT_SHA.test(headResult.stdout.trim())) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate release Git HEAD is unreadable');
  }
  const gitSha = headResult.stdout.trim();
  if (gitSha !== path.basename(releaseRoot)) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate release directory does not match Git HEAD');
  }
  const statusResult = spawnSync(
    'git',
    ['-C', releaseRoot, 'status', '--porcelain=v1', '--untracked-files=no'],
    { encoding: 'utf8', env: gitEnvironment },
  );
  if (statusResult.status !== 0) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate release Git status is unreadable');
  }
  if (statusResult.stdout.length > 0) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate release has tracked working-tree changes');
  }
  const manifestPath = path.join(releaseRoot, 'packages/database/migrations/manifest.generated.json');
  const versionPath = path.join(releaseRoot, 'VERSION');
  const packagePath = path.join(releaseRoot, 'apps/desktop/package.json');
  const databaseModulePath = path.join(releaseRoot, 'packages/database/dist/index.js');
  const verifierModulePath = path.join(releaseRoot, 'packages/database/dist/verifier.js');
  const generatedModulePath = path.join(releaseRoot, 'packages/database/dist/generated/migrations.generated.js');
  for (const file of [manifestPath, versionPath, packagePath, databaseModulePath, verifierModulePath, generatedModulePath]) {
    let info;
    try {
      info = lstatSync(file);
    } catch {
      fail('CANDIDATE_RELEASE_INVALID', `Candidate release file is missing: ${path.relative(releaseRoot, file)}`);
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('CANDIDATE_RELEASE_INVALID', `Candidate release file is not regular: ${path.relative(releaseRoot, file)}`);
    }
  }
  const runtimeBuildSha256 = assertCandidateBuild(releaseRoot, gitSha, verifyRuntime);
  const manifest = readJson(manifestPath, 'CANDIDATE_RELEASE_INVALID');
  if (!manifest || !Array.isArray(manifest.migrations) || manifest.migrations.length < 1) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate migration manifest is empty');
  }
  const version = readBoundedText(versionPath, 128, 'CANDIDATE_RELEASE_INVALID').trim();
  const desktop = readJson(packagePath, 'CANDIDATE_RELEASE_INVALID', 1024 * 1024);
  if (!/^\d+\.\d+\.\d+$/u.test(version) || desktop?.version !== version) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate version identity is inconsistent');
  }
  return Object.freeze({
    root: releaseRoot,
    gitSha,
    version,
    manifest,
    databaseModulePath,
    verifierModulePath,
    generatedModulePath,
    ...(verifyRuntime ? { runtimeBuildSha256 } : {}),
  });
}

/** Recheck a previously rebuilt artifact without compiling it again during one deployment. */
export function assertCandidateRuntimeUnchanged(release) {
  const { root, gitSha, runtimeBuildSha256 } = release;
  if (!GIT_SHA.test(gitSha ?? '') || !SHA256.test(runtimeBuildSha256 ?? '')
    || realpathSync(root) !== root || path.basename(root) !== gitSha) {
    fail('CANDIDATE_RELEASE_INVALID', 'Verified release identity changed');
  }
  const head = spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}'], {
    encoding: 'utf8', env: candidateGitEnvironment(root),
  });
  const status = spawnSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no'], {
    encoding: 'utf8', env: candidateGitEnvironment(root),
  });
  if (head.status !== 0 || head.stdout.trim() !== gitSha || status.status !== 0 || status.stdout.length > 0) {
    fail('CANDIDATE_RELEASE_INVALID', 'Verified release Git identity changed');
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-release-recheck-'));
  try {
    const packages = materializeTrackedBuildSources(root, gitSha, scratch, true);
    assertRuntimeWorkspaceResolution(root, scratch, packages);
    const digests = packages.map(directory => [directory,
      sha256(canonicalJson(Object.fromEntries(regularFileDigests(path.join(root, directory, 'dist'),
        'CANDIDATE_RUNTIME_BUILD_MISMATCH'))))]);
    if (sha256(canonicalJson(digests)) !== runtimeBuildSha256) {
      fail('CANDIDATE_RUNTIME_BUILD_MISMATCH', 'Verified runtime build bytes changed');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function probeRollbackDatabase(config, rollback, migrationCount, requireApplied = false) {
  const requireFromRollback = createRequire(path.join(rollback.root, 'packages/database/package.json'));
  const { Client } = requireFromRollback('pg');
  const client = new Client(config);
  try {
    await client.connect();
    const database = await import(pathToFileURL(rollback.databaseModulePath).href);
    if (requireApplied) {
      if (typeof database.verifyAppliedDatabaseMigrations !== 'function') {
        fail('CONTROLLER_READER_REQUIRED', 'Controller must prove applied physical prefixes');
      }
      return await verifyReleaseDatabase(database, client, migrationCount);
    }
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const state = await database.inspectDatabaseMigrations(client);
    if (state.state !== 'COMPLETE' || state.applied.length !== migrationCount) {
      return { migrationCount, status: 'FAIL', code: 'ROLLBACK_MIGRATION_INCOMPATIBLE' };
    }
    const report = await database.verifyDatabaseMigrations(client);
    return { migrationCount, status: report.status, code: report.status === 'PASS' ? null : 'ROLLBACK_VERIFIER_FAILED' };
  } catch (error) {
    return Object.freeze({ migrationCount, status: 'FAIL',
      code: typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(error.code)
        ? error.code : 'ROLLBACK_DATABASE_CHECK_FAILED' });
  } finally {
    await client.end();
  }
}

export async function readRuntimeContentFingerprint(client) {
  const result = await client.query(`
    WITH timezone AS MATERIALIZED (SELECT set_config('TimeZone', 'UTC', true))
    SELECT encode(public.digest(convert_to(jsonb_build_object(
      'current', (SELECT to_jsonb(current) FROM public.content_current current WHERE id=1),
      'sources', (SELECT jsonb_agg(to_jsonb(source) ORDER BY source_id COLLATE "C") FROM content_intake.sources source),
      'scopes', (SELECT jsonb_agg(to_jsonb(scope) ORDER BY scope_id COLLATE "C") FROM content_intake.scopes scope),
      'sourceGate', (SELECT to_jsonb(gate) FROM public.v_release_source_gate gate
        JOIN public.content_current current ON current.current_release_id=gate.release_id WHERE current.id=1)
    )::text, 'UTF8'), 'sha256'), 'hex') AS fingerprint FROM timezone
  `);
  const fingerprint = result.rows[0]?.fingerprint;
  if (typeof fingerprint !== 'string' || !SHA256.test(fingerprint)) {
    fail('RUNTIME_FINGERPRINT_INVALID', 'Current content identity could not be verified');
  }
  return fingerprint;
}

export async function applyCandidateRelease(cluster, databaseName, manifest, candidate, rollback, queryProfile,
  proofOptions = {}, suppliedDependencies = {}) {
  if (Object.hasOwn(proofOptions, 'action')) fail('INVALID_ARGUMENTS', 'Unsupported release option');
  const modern = Boolean(proofOptions.controller) || queryProfile?.apiEnvSha256 !== undefined;
  if (modern && (!proofOptions.controllerArtifact || !proofOptions.controller || !rollback || !queryProfile
    || !proofOptions.rollbackEnvironment || !proofOptions.rollbackQueryProfile || !proofOptions.candidateApiEnvSha256)) {
    fail('RELEASE_PREFLIGHT_REQUIRED', 'V3 requires a controller, rollback and query profile');
  }
  const sourceMigrations = manifest.database.migrations;
  const nextMigrations = candidate.manifest.migrations;
  if (rollback && modern) {
    assertReleasePrefix(rollback.manifest.migrations.slice(0, Math.min(sourceMigrations.length, rollback.manifest.migrations.length)),
      nextMigrations);
  }
  if (rollback && !modern && (rollback.manifest.migrations.length !== sourceMigrations.length
    || rollback.manifest.migrations.some((migration, index) => {
      const restored = sourceMigrations[index];
      return migration.position !== restored.position || migration.id !== restored.migrationId
        || migration.sha256 !== restored.sha256 || migration.contract_set_id !== restored.contractSetId
        || migration.source_git_sha !== restored.sourceGitSha || migration.source_schema_sha256 !== restored.sourceSchemaSha256;
    }))) {
    fail('ROLLBACK_RELEASE_PREFIX_MISMATCH', 'Rollback release does not match the restored migration catalogue');
  }
  if (nextMigrations.length < sourceMigrations.length) {
    fail('CANDIDATE_RELEASE_NOT_FORWARD', 'Candidate release is behind the restored migration prefix');
  }
  for (const [index, restored] of sourceMigrations.entries()) {
    const next = nextMigrations[index];
    if (!next
      || restored.position !== next.position
      || restored.migrationId !== next.id
      || restored.sha256 !== next.sha256
      || restored.contractSetId !== next.contract_set_id
      || restored.sourceGitSha !== next.source_git_sha
      || restored.sourceSchemaSha256 !== next.source_schema_sha256) {
      fail('CANDIDATE_RELEASE_PREFIX_MISMATCH', 'Restored backup is not an exact prefix of the candidate migration catalogue');
    }
  }
  const [databaseModule, verifierModule, generatedModule] = suppliedDependencies.modules ?? await Promise.all([
    import(pathToFileURL(candidate.databaseModulePath).href),
    import(pathToFileURL(candidate.verifierModulePath).href),
    import(pathToFileURL(candidate.generatedModulePath).href),
  ]);
  const catalogue = generatedModule.generatedMigrationCatalogue;
  const expectedCatalogue = nextMigrations.map((migration) => ({
    position: migration.position,
    id: migration.id,
    sha256: migration.sha256,
    contractSetId: migration.contract_set_id,
    sourceGitSha: migration.source_git_sha,
    sourceSchemaSha256: migration.source_schema_sha256,
  }));
  const actualCatalogue = catalogue?.migrations?.map((migration) => ({
    position: migration.position,
    id: migration.id,
    sha256: migration.sha256,
    contractSetId: migration.contractSetId,
    sourceGitSha: migration.sourceGitSha,
    sourceSchemaSha256: migration.sourceSchemaSha256,
  }));
  if (!actualCatalogue || canonicalJson(actualCatalogue) !== canonicalJson(expectedCatalogue)) {
    fail('CANDIDATE_RELEASE_INVALID', 'Candidate compiled catalogue does not match its manifest');
  }
  const config = {
    host: cluster.socket,
    port: cluster.port,
    user: manifest.database.databaseOwner,
    database: databaseName,
  };
  const client = suppliedDependencies.client
    ?? new (createRequire(path.join(candidate.root, 'packages/database/package.json'))('pg').Client)(config);
  const targetCount = nextMigrations.length;
  const rollbackProbe = suppliedDependencies.probeRollback ?? probeRollbackDatabase;
  if (modern) assertReleasePrefix(nextMigrations, proofOptions.controllerArtifact.manifest.migrations);
  const checkRollback = async migrationCount => {
    if (!modern) return rollbackProbe(config, rollback, migrationCount);
    const physical = await rollbackProbe(config, proofOptions.controllerArtifact, migrationCount, true);
    const database = { ...physical, readerGitSha: proofOptions.controllerArtifact.gitSha };
    const runtime = await (suppliedDependencies.probeRollbackRuntime ?? probeRollbackRuntime)({
      release: rollback, database: { host: cluster.socket, port: cluster.port, database: databaseName },
      environment: proofOptions.rollbackEnvironment, queryProfile: proofOptions.rollbackQueryProfile, migrationCount,
    });
    return { migrationCount, database, runtime,
      status: database.status === 'PASS' && runtime.status === 'PASS' ? 'PASS' : 'FAIL',
      code: database.code ?? runtime.code };
  };
  try {
    await client.connect();
    const contentFingerprint = rollback ? await readRuntimeContentFingerprint(client) : null;
    let applied;
    const rollbackChecks = [];
    try {
      if (rollback) {
        rollbackChecks.push(await checkRollback(sourceMigrations.length));
        const migrations = [];
        for (let count = sourceMigrations.length + 1; count <= targetCount; count += 1) {
          const step = await databaseModule.applyMigrationPrefix(client, count);
          migrations.push(...step.applied);
          rollbackChecks.push(await checkRollback(count));
        }
        applied = { applied: migrations };
      } else {
        applied = await databaseModule.applyDatabaseMigrations(client);
      }
    } catch (cause) {
      throw new BackupSetError('CANDIDATE_MIGRATION_APPLY_FAILED', 'Candidate migrations failed on the restored backup', { cause });
    }
    const expectedIds = nextMigrations.slice(sourceMigrations.length, targetCount).map((migration) => migration.id);
    const actualIds = applied.applied.map((migration) => migration.id);
    if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) {
      fail('CANDIDATE_MIGRATION_APPLY_FAILED', 'Candidate migration application did not match the expected delta');
    }
    let verification;
    try {
      verification = modern
        ? await verifyReleaseDatabase(databaseModule, client, targetCount)
        : await verifierModule.verifyDatabaseMigrations(client);
    } catch (cause) {
      throw new BackupSetError('CANDIDATE_VERIFIER_FAILED', 'Candidate verifier rejected the migrated backup', { cause });
    }
    if (verification.status !== 'PASS' || verification.migrationCount !== targetCount) {
      fail('CANDIDATE_VERIFIER_FAILED', 'Candidate verifier did not pass at the expected migration count');
    }
    let deploymentChecks = null;
    if (rollback) {
      const { probeCandidateRuntime } = await import('./release-runtime-probe.mjs');
      const runtime = await (suppliedDependencies.probeRuntime ?? probeCandidateRuntime)({ releaseRoot: candidate.root,
        database: { host: cluster.socket, port: cluster.port, database: databaseName },
        ...(queryProfile === undefined ? {} : { queryProfile }) });
      deploymentChecks = modern ? createReleaseProof({
        sourceMigrationCount: sourceMigrations.length, targetMigrationCount: targetCount,
        candidate, rollback, queryProfile, controller: proofOptions.controller, contentFingerprint,
        rollbackQueryProfile: proofOptions.rollbackQueryProfile, candidateApiEnvSha256: proofOptions.candidateApiEnvSha256,
        runtime, rollbackChecks, candidateDatabase: verification,
      }) : Object.freeze({
        schema: queryProfile === undefined ? 'customer-agent-release-preflight/v1' : 'customer-agent-release-preflight/v2',
        status: runtime.status === 'PASS' && rollbackChecks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
        candidateGitSha: candidate.gitSha,
        rollbackGitSha: rollback.gitSha,
        runtimeBuildSha256: candidate.runtimeBuildSha256,
        contentFingerprint,
        runtime,
        rollback: Object.freeze(rollbackChecks),
      });
    }
    return Object.freeze({
      candidateRelease: candidate.root,
      candidateGitSha: candidate.gitSha,
      candidateVersion: candidate.version,
      sourceMigrationCount: sourceMigrations.length,
      migrationCount: targetCount,
      lastMigrationId: nextMigrations[targetCount - 1]?.id ?? null,
      appliedMigrationIds: Object.freeze(actualIds),
      verifierStatus: verification.status,
      verifierMode: 'candidate-complete',
      deploymentChecks,
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyRestoredDatabase(pgBin, cluster, databaseName, manifest, objectStore, preferApplied = false) {
  const databaseModule = path.join(REPOSITORY_ROOT, 'packages/database/dist/index.js');
  const verifierModule = path.join(REPOSITORY_ROOT, 'packages/database/dist/verifier.js');
  const generatedModule = path.join(REPOSITORY_ROOT, 'packages/database/dist/generated/migrations.generated.js');
  if (!existsSync(databaseModule)) fail('DATABASE_VERIFIER_MISSING', 'The built database verifier is unavailable');
  if (!existsSync(verifierModule) || !existsSync(generatedModule)) {
    fail('DATABASE_VERIFIER_MISSING', 'The built migration prefix verifier is unavailable');
  }
  const [{ Client }, publicDatabaseModule, internalVerifier, generated] = await Promise.all([
    import('pg'),
    import(pathToFileURL(databaseModule).href),
    import(pathToFileURL(verifierModule).href),
    import(pathToFileURL(generatedModule).href),
  ]);
  const catalogue = generated.generatedMigrationCatalogue;
  const migrationCount = manifest.database.migrations.length;
  if (migrationCount < 1 || migrationCount > catalogue.migrations.length) {
    fail('RESTORE_MIGRATION_VERSION_UNSUPPORTED', 'Backup migration count is not in the current compiled catalogue');
  }
  for (const [index, migration] of manifest.database.migrations.entries()) {
    const expected = catalogue.migrations[index];
    if (!expected
      || migration.position !== expected.position
      || migration.migrationId !== expected.id
      || migration.sha256 !== expected.sha256
      || migration.contractSetId !== expected.contractSetId
      || migration.sourceGitSha !== expected.sourceGitSha
      || migration.sourceSchemaSha256 !== expected.sourceSchemaSha256) {
      fail('RESTORE_MIGRATION_PREFIX_MISMATCH', 'Backup ledger is not an exact prefix of the current migration catalogue');
    }
  }
  let verifierMode;
  if (preferApplied && typeof publicDatabaseModule.verifyAppliedDatabaseMigrations === 'function') {
    verifierMode = 'applied-prefix';
  } else if (migrationCount === catalogue.migrations.length) {
    verifierMode = 'complete';
  } else if (catalogue.compatibility.readinessSuccessor && migrationCount >= 41) {
    verifierMode = `readiness-prefix:${migrationCount}`;
  } else {
    fail('RESTORE_MIGRATION_VERSION_UNSUPPORTED', 'No exact verifier exists for this migration prefix');
  }
  const client = new Client({
    host: cluster.socket,
    port: cluster.port,
    user: manifest.database.databaseOwner,
    database: databaseName,
  });
  try {
    await client.connect();
    const profile = Object.freeze({
      pgSocketDirectory: cluster.socket,
      pgPort: cluster.port,
      pgUser: manifest.database.databaseOwner,
      databaseName,
    });
    const restored = readDatabaseMetadata(pgBin, profile).database;
    if (restored.databaseOwner !== manifest.database.databaseOwner) fail('RESTORE_OWNER_MISMATCH', 'Database owner changed');
    if (canonicalJson(restored.migrations) !== canonicalJson(manifest.database.migrations)
      || restored.migrationDigest !== manifest.database.migrationDigest) {
      fail('RESTORE_MIGRATION_METADATA_MISMATCH', 'Migration ledger changed');
    }
    if (canonicalJson(restored.objects) !== canonicalJson(manifest.database.objects)) {
      fail('RESTORE_OBJECT_METADATA_MISMATCH', 'Database object metadata changed');
    }
    if (canonicalJson(restored.importBatches) !== canonicalJson(manifest.database.importBatches)) {
      fail('RESTORE_BATCH_METADATA_MISMATCH', 'Import batch metadata changed');
    }
    const restoredRoles = restored.roles.filter((role) => role.name !== cluster.owner);
    if (canonicalJson(restoredRoles) !== canonicalJson(manifest.database.roles)
      || sha256(canonicalJson(restoredRoles)) !== manifest.database.rolesFingerprint
      || restoredRoles.length !== manifest.database.roleCount) {
      fail('RESTORE_ROLE_MISMATCH', 'Role catalog changed');
    }
    if (restored.ownershipFingerprint !== manifest.database.ownershipFingerprint) {
      fail('RESTORE_OWNERSHIP_MISMATCH', 'Object ownership changed');
    }
    if (restored.aclFingerprint !== manifest.database.aclFingerprint) {
      fail('RESTORE_ACL_MISMATCH', 'Database object ACLs changed');
    }
    const restoredObjectStore = await inspectObjectStore({
      objectStoreDirectory: objectStore,
      databaseName,
    }, {
      objects: restored.objects,
      importBatches: restored.importBatches,
    });
    if (canonicalJson(restoredObjectStore) !== canonicalJson(manifest.objects)) {
      fail('RESTORE_OBJECT_STORE_MISMATCH', 'Restored object store differs from the manifest');
    }
    let report;
    try {
      if (verifierMode === 'applied-prefix') {
        report = await publicDatabaseModule.verifyAppliedDatabaseMigrations(client);
      } else if (verifierMode === 'complete') {
        report = await publicDatabaseModule.verifyDatabaseMigrations(client);
      } else {
        report = await internalVerifier.verifyReadinessSuccessor(client, {
          ...catalogue,
          migrations: catalogue.migrations.slice(0, migrationCount),
        });
      }
    } catch (cause) {
      const error = new BackupSetError('MIGRATION_VERIFY_FAILED', 'Full migration verifier rejected the faithful dump', { cause });
      error.restoreFidelityPassed = true;
      error.verifierMode = verifierMode;
      throw error;
    }
    if (report.status !== 'PASS') fail('MIGRATION_VERIFY_FAILED', 'Full migration verifier did not pass');
    if (report.migrationCount !== migrationCount) fail('MIGRATION_VERIFY_FAILED', 'Verifier migration count differs');
    return Object.freeze({
      verifier: report,
      verifierMode,
      objectCount: restored.objects.length,
      receiptCount: restoredObjectStore.receipts.length,
      unreferencedObjectCount: restoredObjectStore.unreferencedObjectIds.length,
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

function evidenceDestination(backupId) {
  const configured = process.env.CUSTOMER_AGENT_RESTORE_EVIDENCE_FILE;
  if (configured) return path.resolve(configured);
  const backupRoot = path.resolve(process.env.CUSTOMER_AGENT_BACKUP_ROOT ?? '/srv/customer-agent/catalog-backups');
  const stamp = utcNow().replace(/[:.]/gu, '-');
  return path.join(backupRoot, 'restore-drills', `restore-${backupId}-${stamp}.json`);
}

function writeEvidence(evidence) {
  const destination = evidenceDestination(evidence.backupId);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  atomicWrite(destination, `${JSON.stringify(evidence, null, 2)}\n`);
  return destination;
}

export async function restoreDrill(options = {}) {
  const pgBin = options.pgBin ?? discoverPg15Bin();
  const commandArguments = process.argv.slice(3);
  let commandBackupSet;
  let commandCandidateRelease;
  let commandRollbackRelease;
  let commandCandidateStackRoot;
  const commandProofOptions = {};
  for (let index = 0; index < commandArguments.length; index += 1) {
    const value = commandArguments[index];
    if (value === '--candidate-release') {
      const next = commandArguments[++index];
      if (!next || commandCandidateRelease) fail('INVALID_ARGUMENTS', 'Pass one candidate release');
      commandCandidateRelease = next;
    } else if (value === '--rollback-release') {
      const next = commandArguments[++index];
      if (!next || commandRollbackRelease) fail('INVALID_ARGUMENTS', 'Pass one rollback release');
      commandRollbackRelease = next;
    } else if (value === '--candidate-stack-root') {
      const next = commandArguments[++index];
      if (!next || commandCandidateStackRoot) fail('INVALID_ARGUMENTS', 'Pass one candidate stack root');
      commandCandidateStackRoot = next;
    } else if (['--candidate-api-env', '--controller-release', '--unit'].includes(value)) {
      const next = commandArguments[++index];
      if (!next || commandProofOptions[value]) fail('INVALID_ARGUMENTS', 'Pass each proof option once');
      commandProofOptions[value] = next;
    } else if (value.startsWith('--')) {
      fail('INVALID_ARGUMENTS', `Unknown restore option: ${value}`);
    } else if (commandBackupSet) {
      fail('INVALID_ARGUMENTS', 'Pass one backup set directory');
    } else {
      commandBackupSet = value;
    }
  }
  const requested = options.backupSet ?? commandBackupSet;
  if (!requested) fail('BACKUP_SET_REQUIRED', 'Pass a backup set directory');
  const candidateRelease = options.candidateRelease ?? commandCandidateRelease;
  const rollbackRelease = options.rollbackRelease ?? commandRollbackRelease;
  const candidateStackRoot = options.candidateStackRoot ?? commandCandidateStackRoot;
  if (rollbackRelease && !candidateRelease) fail('INVALID_ARGUMENTS', 'Rollback verification requires a candidate release');
  if (candidateStackRoot && !rollbackRelease) fail('INVALID_ARGUMENTS', 'Query profile verification requires candidate and rollback releases');
  if (Object.hasOwn(options, 'action')) fail('INVALID_ARGUMENTS', 'Unsupported release option');
  const candidateApiEnv = options.candidateApiEnv ?? commandProofOptions['--candidate-api-env'];
  const controllerRelease = options.controllerRelease ?? commandProofOptions['--controller-release'];
  const unit = options.unit ?? commandProofOptions['--unit'] ?? 'customer-agent-stack.service';
  const modern = Boolean(controllerRelease) || Boolean(candidateApiEnv);
  if (modern && (!controllerRelease || !candidateStackRoot || !rollbackRelease)) {
    fail('INVALID_ARGUMENTS', 'V3 requires controller-release, candidate-stack-root and rollback-release');
  }
  const requestedCandidateRelease = candidateRelease ? path.resolve(candidateRelease) : null;
  const verified = await verifyBackupSet(path.resolve(requested), { pgBin });
  const started = Date.now();
  const startedAt = utcNow();
  let scratch = null;
  let cluster = null;
  let restoredDatabase = null;
  let candidate = null;
  let rollback = null;
  let queryProfile;
  let controller;
  let controllerArtifact;
  let rollbackEnvironment;
  let rollbackQueryProfile;
  let candidateApiEnvSha256;
  let sourceVerification = null;
  let evidence;
  let operationError;
  const keepForReview = process.env.CUSTOMER_AGENT_BACKUP_KEEP_SCRATCH_FOR_REVIEW === '1';
  try {
    candidate = requestedCandidateRelease
      ? readCandidateRelease(requestedCandidateRelease, { verifyRuntime: Boolean(rollbackRelease) }) : null;
    if (candidateStackRoot && !modern) {
      try {
        const { readReleaseQueryProfile } = await import('./release-query-profile.mjs');
        queryProfile = await readReleaseQueryProfile(candidate.root, path.resolve(candidateStackRoot), candidateApiEnv);
      } catch (cause) {
        throw new BackupSetError('CANDIDATE_QUERY_PROFILE_INVALID', 'Candidate query configuration could not be resolved', { cause });
      }
    }
    if (rollbackRelease) {
      const rollbackRoot = path.resolve(rollbackRelease);
      rollback = candidate?.root === rollbackRoot ? candidate : readCandidateRelease(rollbackRoot, { verifyRuntime: modern });
    }
    if (modern) {
      if (!path.isAbsolute(controllerRelease) || realpathSync(controllerRelease) !== controllerRelease) {
        fail('SERVICE_STARTUP_INVALID', 'Controller must be a canonical immutable release root');
      }
      const control = controllerRelease === candidate.root ? candidate
        : controllerRelease === rollback.root ? rollback : readCandidateRelease(controllerRelease, { verifyRuntime: true });
      assertControllerArtifactIsolation(control, candidate);
      controllerArtifact = control;
      const { readReleaseStartupConfiguration } = await import('./release-query-profile.mjs');
      const originalApiEnv = path.join(path.resolve(candidateStackRoot), 'api.env');
      let candidateStartup;
      try {
        candidateStartup = await readReleaseStartupConfiguration(candidate.root,
          path.resolve(candidateStackRoot), candidateApiEnv ?? originalApiEnv);
      } catch (cause) {
        throw new BackupSetError('CANDIDATE_QUERY_PROFILE_INVALID', 'Candidate query configuration could not be resolved', { cause });
      }
      const { apiEnvSha256, ...publicProfile } = candidateStartup.queryProfile;
      candidateApiEnvSha256 = apiEnvSha256;
      queryProfile = candidateApiEnv ? candidateStartup.queryProfile : Object.freeze(publicProfile);
      if (candidateApiEnv && candidateStartup.environment.CUSTOMER_AGENT_BUILD_VERSION !== candidate.version) {
        fail('CANDIDATE_API_ENV_INVALID', 'Candidate environment build version differs');
      }
      const rollbackStartup = await readReleaseStartupConfiguration(rollback.root,
        path.resolve(candidateStackRoot), originalApiEnv);
      rollbackQueryProfile = rollbackStartup.queryProfile;
      rollbackEnvironment = rollbackStartup.environment;
      controller = await (options.readServiceStartup ?? readServiceStartup)({
        controllerRoot: control.root, controllerGitSha: control.gitSha,
        controllerBuildSha256: control.runtimeBuildSha256, unit,
        runtimeRelease: path.join(path.dirname(path.dirname(candidate.root)), 'current'),
        stackRoot: path.resolve(candidateStackRoot),
      });
    }
    scratch = safeScratchRoot();
    const extractedStore = path.join(scratch, 'object-store');
    await extractObjectArchive(
      path.join(verified.directory, OBJECTS_ARCHIVE_FILE),
      extractedStore,
      verified.manifest.objects,
    );
    cluster = createScratchCluster(pgBin, scratch);
    run(path.join(pgBin, 'psql'), [
      '-X', '--no-psqlrc', '--quiet',
      '--set', 'ON_ERROR_STOP=1',
      ...restoreClusterArguments(cluster),
      '--dbname', 'postgres',
      '--file', path.join(verified.directory, ROLES_FILE),
    ], { code: 'ROLE_RESTORE_FAILED', timeout: 5 * 60_000 });
    restoredDatabase = `customer_agent_restore_${randomBytes(6).toString('hex')}`;
    run(path.join(pgBin, 'createdb'), [
      ...restoreClusterArguments(cluster),
      '--owner', verified.manifest.database.databaseOwner,
      '--encoding', 'UTF8',
      '--template', 'template0',
      restoredDatabase,
    ], { code: 'DATABASE_CREATE_FAILED', timeout: 60_000 });
    run(path.join(pgBin, 'pg_restore'), [
      '--exit-on-error',
      '--host', cluster.socket,
      '--port', String(cluster.port),
      '--username', verified.manifest.database.databaseOwner,
      '--dbname', restoredDatabase,
      path.join(verified.directory, DATABASE_DUMP_FILE),
    ], { code: 'DATABASE_RESTORE_FAILED', timeout: 30 * 60_000 });
    sourceVerification = await verifyRestoredDatabase(
      pgBin,
      cluster,
      restoredDatabase,
      verified.manifest,
      extractedStore,
      modern,
    );
    const candidateVerification = candidateRelease
      ? await applyCandidateRelease(
        cluster,
        restoredDatabase,
        verified.manifest,
        candidate,
        rollback,
        queryProfile,
        { controller, controllerArtifact, rollbackEnvironment, rollbackQueryProfile, candidateApiEnvSha256 },
      )
      : null;
    const completedAt = utcNow();
    const durationMs = Date.now() - started;
    evidence = Object.freeze({
      status: 'PASS',
      backupId: verified.manifest.backupId,
      backupCompletedAt: verified.manifest.completedAt,
      backupSnapshotAt: verified.manifest.snapshotAt,
      restoreStartedAt: startedAt,
      restoreCompletedAt: completedAt,
      rpoSeconds: Math.max(0, Math.floor((started - Date.parse(verified.manifest.snapshotAt)) / 1000)),
      rtoMs: durationMs,
      manifestSha256: verified.manifestSha256,
      productVersion: verified.manifest.application.productVersion,
      applicationGitSha: verified.manifest.application.gitSha,
      toolingSha256: verified.manifest.tooling.sha256,
      aclFingerprint: verified.manifest.database.aclFingerprint,
      restoredMigrationCount: verified.manifest.database.migrations.length,
      restoredLastMigrationId: verified.manifest.database.migrations.at(-1)?.migrationId,
      migrationCount: candidateVerification?.migrationCount ?? verified.manifest.database.migrations.length,
      lastMigrationId: candidateVerification?.lastMigrationId
        ?? verified.manifest.database.migrations.at(-1)?.migrationId,
      candidateRelease: candidateVerification?.candidateRelease ?? null,
      candidateGitSha: candidateVerification?.candidateGitSha ?? null,
      candidateVersion: candidateVerification?.candidateVersion ?? null,
      appliedMigrationIds: candidateVerification?.appliedMigrationIds ?? Object.freeze([]),
      objectCount: sourceVerification.objectCount,
      receiptCount: sourceVerification.receiptCount,
      unreferencedObjectCount: sourceVerification.unreferencedObjectCount,
      sourceVerifierStatus: sourceVerification.verifier.status,
      sourceVerifierMode: sourceVerification.verifierMode,
      verifierStatus: candidateVerification?.verifierStatus ?? sourceVerification.verifier.status,
      verifierMode: candidateVerification?.verifierMode ?? sourceVerification.verifierMode,
      metadataAndObjectFidelity: 'PASS',
      deploymentChecks: candidateVerification?.deploymentChecks ?? null,
      scratchCleaned: false,
      dataClassification: 'metadata-only',
    });
    if (evidence.deploymentChecks?.status === 'FAIL') {
      evidence = Object.freeze({ ...evidence, status: 'FAIL', errorCode: 'RELEASE_PREFLIGHT_FAILED' });
      operationError = new BackupSetError('RELEASE_PREFLIGHT_FAILED', 'Candidate runtime or rollback compatibility check failed');
    }
  } catch (error) {
    operationError = error;
    evidence = Object.freeze({
      status: 'FAIL',
      backupId: verified.manifest.backupId,
      backupSnapshotAt: verified.manifest.snapshotAt,
      restoreStartedAt: startedAt,
      restoreCompletedAt: utcNow(),
      rpoSeconds: Math.max(0, Math.floor((started - Date.parse(verified.manifest.snapshotAt)) / 1000)),
      rtoMs: Date.now() - started,
      manifestSha256: verified.manifestSha256,
      productVersion: verified.manifest.application.productVersion,
      applicationGitSha: verified.manifest.application.gitSha,
      toolingSha256: verified.manifest.tooling.sha256,
      aclFingerprint: verified.manifest.database.aclFingerprint,
      restoredMigrationCount: verified.manifest.database.migrations.length,
      restoredLastMigrationId: verified.manifest.database.migrations.at(-1)?.migrationId,
      migrationCount: verified.manifest.database.migrations.length,
      lastMigrationId: verified.manifest.database.migrations.at(-1)?.migrationId,
      candidateRelease: candidate?.root ?? requestedCandidateRelease,
      candidateGitSha: candidate?.gitSha ?? null,
      candidateVersion: candidate?.version ?? null,
      appliedMigrationIds: [],
      objectCount: sourceVerification?.objectCount ?? null,
      receiptCount: sourceVerification?.receiptCount ?? null,
      unreferencedObjectCount: sourceVerification?.unreferencedObjectCount ?? null,
      sourceVerifierStatus: sourceVerification?.verifier.status ?? null,
      sourceVerifierMode: sourceVerification?.verifierMode ?? null,
      errorCode: error instanceof BackupSetError || error instanceof ReleaseProofError ? error.code : 'RESTORE_FAILED',
      metadataAndObjectFidelity: sourceVerification || error?.restoreFidelityPassed === true
        ? 'PASS'
        : 'UNCONFIRMED',
      verifierMode: error?.verifierMode ?? sourceVerification?.verifierMode ?? null,
      verifierDetail: error?.cause instanceof Error ? redactDiagnostic(error.cause.message) : null,
      scratchCleaned: false,
      dataClassification: 'metadata-only',
    });
  } finally {
    let cleanupError;
    const retainForReview = keepForReview && scratch && cluster?.started && restoredDatabase;
    if (retainForReview) {
      if (evidence) {
        evidence = Object.freeze({
          ...evidence,
          scratchCleaned: false,
          reviewDiagnostics: Object.freeze({
            scratchRoot: scratch,
            socketDirectory: cluster.socket,
            port: cluster.port,
            clusterOwner: cluster.owner,
            databaseOwner: verified.manifest.database.databaseOwner,
            restoredDatabase,
          }),
        });
      }
    } else {
      try {
        if (cluster) stopScratchCluster(pgBin, cluster);
      } catch (error) {
        cleanupError = error;
      }
      try {
        removeScratch(scratch);
        scratch = null;
        if (evidence) evidence = Object.freeze({ ...evidence, scratchCleaned: true });
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (evidence) {
      try {
        evidence = Object.freeze({ ...evidence, evidenceFile: writeEvidence(evidence) });
      } catch (writeError) {
        cleanupError ??= writeError;
      }
    }
    if (cleanupError) {
      operationError = operationError
        ? new AggregateError([operationError, cleanupError], 'Restore failed and cleanup or evidence writing also failed')
        : cleanupError;
    }
  }
  if (operationError) throw operationError;
  if (!evidence || evidence.status !== 'PASS') {
    fail('RESTORE_FAILED', 'Restore drill did not produce passing evidence');
  }
  return evidence;
}

function printSafeError(error) {
  const knownError = error instanceof BackupSetError || error instanceof ReleaseProofError;
  const code = knownError ? error.code : 'BACKUP_SET_FAILED';
  const message = knownError
    ? error.message
    : process.env.CUSTOMER_AGENT_BACKUP_DIAGNOSTICS === '1'
      ? redactDiagnostic(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error)
      : 'Operation failed';
  process.stderr.write(`${utcNow()} FATAL ${code} ${message}\n`);
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === 'backup') {
      const args = process.argv.slice(3);
      if (args.length > 1 || (args.length === 1 && args[0] !== '--preserve-existing')) {
        fail('BACKUP_ARGUMENT_INVALID', 'Expected no options or --preserve-existing');
      }
      const result = await createBackupSet({ preserveExisting: args.length === 1 });
      process.exitCode = result.degraded ? 3 : 0;
      return;
    }
    if (command === 'restore-drill') {
      const result = await restoreDrill();
      log(`restore drill passed backup_id=${result.backupId} rto_ms=${result.rtoMs} verifier=${result.verifierStatus}`);
      process.exitCode = 0;
      return;
    }
    if (command === 'verify') {
      const requested = process.argv[3];
      if (!requested) fail('BACKUP_SET_REQUIRED', 'Pass a backup set directory');
      const verified = await verifyBackupSet(path.resolve(requested), { pgBin: discoverPg15Bin() });
      log(`backup set verified backup_id=${verified.manifest.backupId} manifest_sha256=${verified.manifestSha256}`);
      return;
    }
    fail('COMMAND_INVALID', 'Expected backup, restore-drill, or verify');
  } catch (error) {
    printSafeError(error);
    process.exitCode = error instanceof BackupSetError && error.code === 'BACKUP_ARGUMENT_INVALID' ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
