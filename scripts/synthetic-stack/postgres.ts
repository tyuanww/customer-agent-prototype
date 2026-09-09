/**
 * Isolated PostgreSQL 15 cluster for the synthetic stack.
 *
 * This owns exactly one private cluster under the stack root: Unix socket
 * only (`listen_addresses = ''`), no TCP listener, no shared service. It never
 * connects to, migrates or stops the user's existing PostgreSQL installation.
 *
 * The cluster is created once and reused across restarts so seeded content and
 * sessions survive a stop/start cycle. `destroy` removes only this directory
 * after verifying it is inside the stack root.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  DATABASE_NAME, DATABASE_ROLES, PG_DATA_DIRECTORY, PG_PORT, PG_SOCKET_DIRECTORY,
  STACK_ROOT, ensureStackDirectories, pgEnvironment,
} from './profile.ts';

const TEMPORARY_OWNER = 'stack_owner';

function run(file: string, arguments_: readonly string[], timeout = 120_000): string {
  return execFileSync(file, [...arguments_], {
    encoding: 'utf8',
    env: pgEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
}

/**
 * Resolve a PostgreSQL 15 bin directory. Prefers the explicit override, then
 * `pg_config`, then the Homebrew keg, so a machine with 15 installed but not
 * first on PATH still works. Refuses any other major version: the migrations
 * and the readiness probe are frozen to 15.
 */
export function discoverPg15Bin(): string {
  const candidates: string[] = [];
  if (process.env.CUSTOMER_AGENT_PG15_BIN) candidates.push(path.resolve(process.env.CUSTOMER_AGENT_PG15_BIN));
  try { candidates.push(run('pg_config', ['--bindir'], 20_000)); } catch { /* pg_config absent */ }
  candidates.push(
    '/Users/hutou/homebrew/opt/postgresql@15/bin',
    '/opt/homebrew/opt/postgresql@15/bin',
    '/usr/local/opt/postgresql@15/bin',
    '/usr/lib/postgresql/15/bin',
  );
  const reasons: string[] = [];
  for (const candidate of candidates) {
    const binary = path.join(candidate, 'postgres');
    if (!existsSync(binary)) continue;
    let version: string;
    try { version = run(binary, ['--version'], 20_000); } catch (error) {
      reasons.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const major = Number(version.match(/PostgreSQL\)\s+(\d+)/)?.[1]);
    if (major !== 15) { reasons.push(`${candidate}: ${version}`); continue; }
    const missing = ['initdb', 'pg_ctl', 'createdb', 'psql', 'pg_isready']
      .filter((required) => !existsSync(path.join(candidate, required)));
    if (missing.length > 0) { reasons.push(`${candidate}: missing ${missing.join(', ')}`); continue; }
    return candidate;
  }
  throw new Error(
    `PostgreSQL 15 binaries not found. Install with "brew install postgresql@15" or set CUSTOMER_AGENT_PG15_BIN.`
    + (reasons.length > 0 ? ` Tried: ${reasons.join('; ')}` : ''),
  );
}

export type ClusterState = 'absent' | 'stopped' | 'running';

export class SyntheticCluster {
  readonly bin = discoverPg15Bin();
  readonly data = PG_DATA_DIRECTORY;
  readonly socket = PG_SOCKET_DIRECTORY;
  readonly log = path.join(STACK_ROOT, 'logs', 'postgres.log');

  state(): ClusterState {
    if (!existsSync(path.join(this.data, 'PG_VERSION'))) return 'absent';
    return this.isRunning() ? 'running' : 'stopped';
  }

  /**
   * `pg_ctl status` exits 0 when the server is running and non-zero otherwise,
   * but its message is localised, so the exit code is the signal we rely on.
   */
  private isRunning(): boolean {
    try {
      run(path.join(this.bin, 'pg_ctl'), ['-D', this.data, 'status'], 20_000);
      return true;
    } catch {
      return false;
    }
  }

  /** Create the cluster and start it if needed. Idempotent. */
  ensureRunning(): void {
    ensureStackDirectories();
    mkdirSync(this.socket, { recursive: true, mode: 0o700 });
    if (this.state() === 'absent') this.init();
    if (!this.isRunning()) this.start();
    const version = Number(run(path.join(this.bin, 'psql'), [
      '-X', '--no-psqlrc', '--host', this.socket, '--port', String(PG_PORT),
      '--username', TEMPORARY_OWNER, '--dbname', 'postgres', '--tuples-only', '--no-align',
      '--command', 'SHOW server_version_num;',
    ], 30_000));
    if (Math.trunc(version / 10_000) !== 15) throw new Error(`Synthetic cluster is not PostgreSQL 15: ${version}`);
  }

  private init(): void {
    run(path.join(this.bin, 'initdb'), [
      '-D', this.data,
      `--username=${TEMPORARY_OWNER}`,
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--locale=C',
      '--no-sync',
    ]);
    if (this.socket.includes("'")) throw new Error('Unsafe synthetic socket path');
    appendFileSync(path.join(this.data, 'postgresql.conf'), [
      '',
      '# Managed by scripts/synthetic-stack. Local synthetic use only.',
      "listen_addresses = ''",
      `unix_socket_directories = '${this.socket}'`,
      'unix_socket_permissions = 0700',
      `port = ${PG_PORT}`,
      "timezone = 'Asia/Shanghai'",
      'logging_collector = off',
      '',
    ].join('\n'));
  }

  private start(): void {
    run(path.join(this.bin, 'pg_ctl'), ['-D', this.data, '-l', this.log, '-w', 'start']);
  }

  /** Stop the cluster without removing data. Safe to call when already stopped. */
  stop(): string {
    if (this.state() === 'absent') return 'postgres: no cluster';
    if (!this.isRunning()) return 'postgres: already stopped';
    run(path.join(this.bin, 'pg_ctl'), ['-D', this.data, '-m', 'fast', '-w', 'stop'], 60_000);
    return 'postgres: stopped (data retained)';
  }

  /** Remove the cluster directory. Only ever targets the stack root subtree. */
  destroy(): string {
    this.stop();
    const resolved = path.resolve(this.data);
    if (!resolved.startsWith(`${path.resolve(STACK_ROOT)}${path.sep}`)) {
      throw new Error(`Refusing to remove a cluster outside the stack root: ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true });
    if (existsSync(resolved)) throw new Error('Synthetic cluster removal was incomplete');
    return 'postgres: cluster removed';
  }

  connect(database = DATABASE_NAME, user = TEMPORARY_OWNER): Client {
    return new Client({
      host: this.socket, port: PG_PORT, user, database,
    });
  }
}

/**
 * Create the synthetic database when missing. Called before migrations, which
 * create the NOLOGIN capability roles.
 */
export async function ensureDatabase(cluster: SyntheticCluster): Promise<string> {
  const admin = cluster.connect('postgres');
  await admin.connect();
  try {
    const database = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE_NAME]);
    if (database.rowCount === 0) await admin.query(`CREATE DATABASE ${DATABASE_NAME}`);
    return `database: ${DATABASE_NAME} present`;
  } finally {
    await admin.end();
  }
}

/**
 * Create the LOGIN roles and grant each the single capability role that its
 * pool is allowed to assume. Must run after migrations so the capability roles
 * exist. Roles are plain LOGIN members; the stack never grants table privileges
 * directly and never reuses one login for two capabilities.
 */
export async function ensureLoginRoles(cluster: SyntheticCluster): Promise<string> {
  const admin = cluster.connect();
  await admin.connect();
  try {
    const roleSpecs: readonly (readonly [string, string])[] = [
      [DATABASE_ROLES.runtime, 'app_runtime'],
      [DATABASE_ROLES.admin, 'app_content_admin'],
      [DATABASE_ROLES.auth, 'app_backend_auth'],
      [DATABASE_ROLES.review, 'app_backend_review'],
      [DATABASE_ROLES.worker, 'app_backend_worker'],
    ];
    for (const [login, capability] of roleSpecs) {
      const capabilityRole = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [capability]);
      if (capabilityRole.rowCount === 0) throw new Error(`Capability role ${capability} is missing; apply migrations first`);
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [login]);
      if (exists.rowCount === 0) {
        // The auth/review/worker probes require a single direct, non-inherited
        // membership; runtime/admin keep default inheritance for their own pools.
        const noInherit = login === DATABASE_ROLES.runtime || login === DATABASE_ROLES.admin ? '' : ' NOINHERIT';
        await admin.query(`CREATE ROLE ${login} LOGIN${noInherit}`);
      }
      const member = await admin.query(
        `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles g ON g.oid = m.member
         WHERE r.rolname = $1 AND g.rolname = $2`, [capability, login],
      );
      if (member.rowCount === 0) await admin.query(`GRANT ${capability} TO ${login}`);
    }
    return `roles: ${String(roleSpecs.length)} login roles ensured`;
  } finally {
    await admin.end();
  }
}

export function writeClusterMarker(): void {
  const marker = path.join(PG_DATA_DIRECTORY, 'SYNTHETIC-STACK-MARKER');
  if (!existsSync(marker)) {
    writeFileSync(marker, [
      'This PostgreSQL 15 cluster belongs to scripts/synthetic-stack.',
      'It uses a Unix socket only and contains synthetic data only.',
      'Remove it with: node scripts/synthetic-stack/stack.ts destroy',
      '',
    ].join('\n'), { mode: 0o600 });
  }
}

export function clusterVersionText(): string {
  try {
    return readFileSync(path.join(PG_DATA_DIRECTORY, 'PG_VERSION'), 'utf8').trim();
  } catch {
    return 'absent';
  }
}
