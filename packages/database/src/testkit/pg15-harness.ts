import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { Client, type ClientConfig } from 'pg';

function cleanPgEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, PGCONNECT_TIMEOUT: '5' };
  for (const key of [
    'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
  ]) delete environment[key];
  return environment;
}

function run(file: string, arguments_: readonly string[], environment: NodeJS.ProcessEnv, timeout = 60_000): string {
  return execFileSync(file, [...arguments_], {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
}

function discoverPg15Bin(environment: NodeJS.ProcessEnv): string {
  const configured = process.env.CUSTOMER_AGENT_PG15_BIN;
  const candidate = configured
    ? path.resolve(configured)
    : run('pg_config', ['--bindir'], environment);
  const version = run(path.join(candidate, 'postgres'), ['--version'], environment);
  const major = Number(version.match(/PostgreSQL\)\s+(\d+)/)?.[1]);
  if (major !== 15) throw new Error(`DEV-M0 integration tests require PostgreSQL 15, found: ${version}`);
  for (const binary of ['postgres', 'initdb', 'pg_ctl', 'createdb']) {
    if (!existsSync(path.join(candidate, binary))) throw new Error(`PostgreSQL 15 binary is missing: ${binary}`);
  }
  return candidate;
}

function removeTemporaryCluster(root: string): void {
  const prefix = path.join(os.tmpdir(), 'customer-agent-pg15-');
  if (!root.startsWith(prefix)) throw new Error(`Refusing unsafe PG15 test cleanup: ${root}`);
  rmSync(root, { recursive: true, force: true });
  if (existsSync(root)) throw new Error('Temporary PG15 cluster cleanup was incomplete');
}

export class Pg15Harness {
  readonly owner = 'gate_owner';
  readonly port = randomInt(49_152, 65_535);
  readonly environment = cleanPgEnvironment();
  readonly bin = discoverPg15Bin(this.environment);
  readonly root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-pg15-'));
  readonly data = path.join(this.root, 'data');
  readonly socket = path.join(this.root, 'socket');
  readonly log = path.join(this.root, 'postgres.log');
  private started = false;
  private startAttempted = false;

  start(): void {
    try {
      if (process.platform === 'win32') throw new Error('Use WSL/Linux for the Unix-socket PG15 integration gate');
      mkdirSync(this.socket, { recursive: true, mode: 0o700 });
      run(path.join(this.bin, 'initdb'), [
        '-D', this.data,
        `--username=${this.owner}`,
        '--auth-local=trust',
        '--auth-host=reject',
        '--encoding=UTF8',
        '--locale=C',
        '--no-sync',
      ], this.environment);
      if (this.socket.includes("'")) throw new Error('Unsafe temporary PostgreSQL socket path');
      appendFileSync(path.join(this.data, 'postgresql.conf'), [
        '',
        "listen_addresses = ''",
        `unix_socket_directories = '${this.socket}'`,
        'unix_socket_permissions = 0700',
        `port = ${this.port}`,
        "timezone = 'Asia/Shanghai'",
        'logging_collector = off',
        '',
      ].join('\n'));
      this.startAttempted = true;
      run(path.join(this.bin, 'pg_ctl'), ['-D', this.data, '-l', this.log, '-w', 'start'], this.environment);
      this.started = true;
      const version = Number(run(path.join(this.bin, 'psql'), [
        '-X', '--no-psqlrc', '--host', this.socket, '--port', String(this.port),
        '--username', this.owner, '--dbname', 'postgres', '--tuples-only', '--no-align',
        '--command', 'SHOW server_version_num;',
      ], this.environment));
      if (Math.trunc(version / 10_000) !== 15) throw new Error(`Temporary server is not PostgreSQL 15: ${version}`);
    } catch (startError) {
      try {
        this.stop();
      } catch (cleanupError) {
        throw new AggregateError([startError, cleanupError], 'Temporary PostgreSQL start and cleanup both failed');
      }
      throw startError;
    }
  }

  createDatabase(label: string): Readonly<{ name: string; config: ClientConfig }> {
    if (!this.started) throw new Error('Temporary PostgreSQL cluster is not started');
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
    const name = `dev_m0_${safeLabel}_${randomBytes(4).toString('hex')}`;
    run(path.join(this.bin, 'createdb'), [
      '--host', this.socket,
      '--port', String(this.port),
      '--username', this.owner,
      '--owner', this.owner,
      name,
    ], this.environment);
    return Object.freeze({
      name,
      config: Object.freeze({ host: this.socket, port: this.port, user: this.owner, database: name }),
    });
  }

  async connect(config: ClientConfig): Promise<Client> {
    const client = new Client(config);
    await client.connect();
    return client;
  }

  stop(): void {
    let stopError: unknown;
    let cleanupError: unknown;
    try {
      if (this.startAttempted) {
        run(path.join(this.bin, 'pg_ctl'), ['-D', this.data, '-m', 'immediate', '-w', 'stop'], this.environment, 30_000);
      }
    } catch (error) {
      stopError = error;
    } finally {
      this.started = false;
      this.startAttempted = false;
      try {
        removeTemporaryCluster(this.root);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (stopError && cleanupError) {
      throw new AggregateError([stopError, cleanupError], 'Temporary PostgreSQL stop and cleanup both failed');
    }
    if (stopError) throw stopError;
    if (cleanupError) throw cleanupError;
  }
}
