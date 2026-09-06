import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  cpSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

type IntakeResult = Readonly<{
  status: 'CREATED' | 'REUSED' | 'VERIFIED';
  contract_set_id: string;
  source_git_sha: string;
  path: string;
  lock_path: string;
  intake_status: 'VERIFIED_NOT_ACTIVATED';
  ddev_authorized: false;
  runtime_activated: false;
}>;

type ContractSetModule = Readonly<{
  ingestContractSet: (options: {
    projectRoot: string;
    sourceDirectory: string;
    sourceRepositoryRoot: string;
  }) => IntakeResult;
  verifyContractSetDirectory: (directory: string) => unknown;
  verifyIngestedContractSet: (options: {
    projectRoot: string;
    expectedContractSetId?: string;
  }) => IntakeResult;
  withVerifiedContractSetSnapshot: <Result>(
    options: {
      projectRoot: string;
      expectedContractSetId?: string;
    },
    consumer: (snapshot: IntakeResult & {
      lock: Readonly<Record<string, unknown>>;
      manifest: Readonly<Record<string, unknown>>;
      openapi_source: string;
      database_source: string;
    }) => Result | Promise<Result>,
  ) => Promise<Result>;
  parseCliArguments: (arguments_: string[]) => Readonly<{
    command: 'ingest' | 'verify';
    options: Readonly<Record<string, string>>;
  }>;
}>;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPENAPI_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/openapi.v1.yaml';
const DATABASE_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/33-schema-v1-草案.sql';
const temporaryRoots: string[] = [];
let contractSet: ContractSetModule;

beforeAll(async () => {
  contractSet = await import(
    pathToFileURL(path.join(repositoryRoot, 'scripts/customer-agent-contract-set.mjs')).href
  ) as ContractSetModule;
});

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  temporaryRoots.push(directory);
  return directory;
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function createProductRoot(): string {
  const productRoot = temporaryDirectory('customer-agent-product');
  writeFileSync(
    path.join(productRoot, 'package.json'),
    `${JSON.stringify({ name: 'customer-agent-demo' }, null, 2)}\n`,
  );
  return productRoot;
}

function runGit(repositoryRoot: string, arguments_: string[]): string {
  return execFileSync('git', ['-C', repositoryRoot, ...arguments_], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createSourceRepository(openapi: string, database: string, marker: string): Readonly<{
  repositoryRoot: string;
  sourceGitSha: string;
}> {
  const repositoryRoot = temporaryDirectory('customer-agent-record-source');
  mkdirSync(path.dirname(path.join(repositoryRoot, OPENAPI_SOURCE_PATH)), { recursive: true });
  writeFileSync(path.join(repositoryRoot, OPENAPI_SOURCE_PATH), openapi);
  writeFileSync(path.join(repositoryRoot, DATABASE_SOURCE_PATH), database);
  runGit(repositoryRoot, ['init', '--quiet']);
  runGit(repositoryRoot, ['add', '--', OPENAPI_SOURCE_PATH, DATABASE_SOURCE_PATH]);
  runGit(repositoryRoot, [
    '-c', 'user.name=Contract Test',
    '-c', 'user.email=contract-test@example.invalid',
    'commit', '--quiet', '--no-verify', '-m', `contract ${marker}`,
  ]);
  return {
    repositoryRoot,
    sourceGitSha: runGit(repositoryRoot, ['rev-parse', 'HEAD']),
  };
}

function createContractSet({
  marker = 'first',
  declaredSourceGitSha,
}: {
  marker?: string;
  declaredSourceGitSha?: string;
} = {}): Readonly<{
  directory: string;
  contractSetId: string;
  openapi: string;
  database: string;
  repositoryRoot: string;
  sourceGitSha: string;
}> {
  const openapi = `openapi: 3.1.0\ninfo:\n  title: Synthetic contract test ${marker}\n`;
  const database = `CREATE TABLE contract_test_${marker} (id bigint PRIMARY KEY);\n`;
  const sourceRepository = createSourceRepository(openapi, database, marker);
  const sourceGitSha = declaredSourceGitSha ?? sourceRepository.sourceGitSha;
  const directory = temporaryDirectory('customer-agent-contract-source');
  const contractSetId = `cs-ai-c11-openapi-1.11.0-schema-1.12-${sourceGitSha.slice(0, 12)}`;
  const manifest = {
    schema: 'customer-agent-contract-set/v1',
    contract_set_id: contractSetId,
    source_repository: 'ai-赋能立项',
    source_git_sha: sourceGitSha,
    architecture_version: '1.16',
    implementation_version: '1.21',
    openapi: {
      version: '1.11.0',
      source_path: OPENAPI_SOURCE_PATH,
      file: 'openapi.v1.yaml',
      sha256: sha256(openapi),
      bytes: Buffer.byteLength(openapi),
    },
    database: {
      version: 'schema.v1.12',
      source_path: DATABASE_SOURCE_PATH,
      file: 'schema-v1.12.sql',
      sha256: sha256(database),
      bytes: Buffer.byteLength(database),
    },
  };
  writeFileSync(path.join(directory, 'openapi.v1.yaml'), openapi);
  writeFileSync(path.join(directory, 'schema-v1.12.sql'), database);
  writeFileSync(
    path.join(directory, 'contract-set.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return {
    directory,
    contractSetId,
    openapi,
    database,
    repositoryRoot: sourceRepository.repositoryRoot,
    sourceGitSha,
  };
}

describe('customer-agent contract-set intake', () => {
  it('accepts the owner pair and rejects mixed or unreviewed version/source pairs', () => {
    const source = path.join(repositoryRoot, 'contracts/upstream/customer-agent',
      'cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701');
    const directory = temporaryDirectory('owner-pair');
    cpSync(source, directory, { recursive: true });
    expect(() => contractSet.verifyContractSetDirectory(directory)).not.toThrow();
    const manifestPath = path.join(directory, 'contract-set.json');
    chmodSync(manifestPath, 0o600);
    const original = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const field of ['openapi', 'database']) {
      const changed = structuredClone(original);
      changed[field].source_path = field === 'openapi' ? OPENAPI_SOURCE_PATH : DATABASE_SOURCE_PATH;
      writeFileSync(manifestPath, JSON.stringify(changed));
      expect(() => contractSet.verifyContractSetDirectory(directory)).toThrow(/source_path/);
    }
    const mixed = structuredClone(original);
    mixed.openapi.version = '1.11.0';
    mixed.contract_set_id = mixed.contract_set_id.replace('openapi-1.12.0', 'openapi-1.11.0');
    writeFileSync(manifestPath, JSON.stringify(mixed));
    expect(() => contractSet.verifyContractSetDirectory(directory)).toThrow(/version pair/);
  });

  it('accepts the pnpm argument separator before intake options', () => {
    expect(
      contractSet.parseCliArguments([
        'ingest',
        '--',
        '--source=/verified/contract-set',
        '--source-repository-root=/trusted/ai-赋能立项',
      ]),
    ).toEqual({
      command: 'ingest',
      options: {
        source: '/verified/contract-set',
        'source-repository-root': '/trusted/ai-赋能立项',
      },
    });
  });

  it('requires a separately trusted source repository checkout', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();

    expect(() => contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: '',
    })).toThrow(/source-repository-root/);
  });

  it('rejects a self-declared source commit that is absent from the trusted repository', () => {
    const productRoot = createProductRoot();
    const source = createContractSet({ declaredSourceGitSha: 'a'.repeat(40) });

    expect(() => contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    })).toThrow(/Source Git verification failed at cat-file/);
  });

  it('rejects self-consistent package bytes that differ from the declared Git source', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();
    const forgedOpenapi = 'openapi: 3.1.0\ninfo:\n  title: Forged package\n';
    const manifestPath = path.join(source.directory, 'contract-set.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      openapi: { sha256: string; bytes: number };
    };
    writeFileSync(path.join(source.directory, 'openapi.v1.yaml'), forgedOpenapi);
    manifest.openapi.sha256 = sha256(forgedOpenapi);
    manifest.openapi.bytes = Buffer.byteLength(forgedOpenapi);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    })).toThrow(/OpenAPI contract does not match the declared source Git commit/);
  });

  it('copies a verified snapshot once and keeps it explicitly inactive', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();

    const created = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    });

    expect(created).toMatchObject({
      status: 'CREATED',
      contract_set_id: source.contractSetId,
      intake_status: 'VERIFIED_NOT_ACTIVATED',
      ddev_authorized: false,
      runtime_activated: false,
    });
    expect(readFileSync(path.join(created.path, 'openapi.v1.yaml'), 'utf8')).toBe(source.openapi);
    expect(readFileSync(path.join(created.path, 'schema-v1.12.sql'), 'utf8')).toBe(source.database);

    const reused = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    });
    expect(reused.status).toBe('REUSED');
    expect(
      contractSet.verifyIngestedContractSet({
        projectRoot: productRoot,
        expectedContractSetId: source.contractSetId,
      }).status,
    ).toBe('VERIFIED');
  });

  it('appends a new snapshot and moves only the inactive consumption lock', () => {
    const productRoot = createProductRoot();
    const first = createContractSet();
    const second = createContractSet({ marker: 'second' });

    const firstResult = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: first.directory,
      sourceRepositoryRoot: first.repositoryRoot,
    });
    const secondResult = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: second.directory,
      sourceRepositoryRoot: second.repositoryRoot,
    });

    expect(secondResult).toMatchObject({
      status: 'CREATED',
      contract_set_id: second.contractSetId,
      intake_status: 'VERIFIED_NOT_ACTIVATED',
      ddev_authorized: false,
      runtime_activated: false,
    });
    expect(existsSync(firstResult.path)).toBe(true);
    expect(readFileSync(path.join(firstResult.path, 'openapi.v1.yaml'), 'utf8')).toBe(first.openapi);
    expect(
      contractSet.verifyIngestedContractSet({
        projectRoot: productRoot,
        expectedContractSetId: second.contractSetId,
      }).status,
    ).toBe('VERIFIED');
  });

  it('fails closed while another intake owns the rollover lock', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();
    mkdirSync(
      path.join(productRoot, 'contracts/upstream/customer-agent/.contract-intake.lock'),
      { recursive: true },
    );

    expect(() => contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    })).toThrow(/already in progress/);
  });

  it('holds the rollover lock while a verified snapshot consumer is running', async () => {
    const productRoot = createProductRoot();
    const source = createContractSet();
    contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    });

    await contractSet.withVerifiedContractSetSnapshot(
      { projectRoot: productRoot, expectedContractSetId: source.contractSetId },
      async (snapshot) => {
        expect(snapshot.openapi_source).toBe(source.openapi);
        expect(snapshot.database_source).toBe(source.database);
        expect(snapshot.lock).toMatchObject({
          contract_set_id: source.contractSetId,
          runtime_activated: false,
        });
        expect(snapshot.manifest).toMatchObject({ contract_set_id: source.contractSetId });
        expect(() => contractSet.ingestContractSet({
          projectRoot: productRoot,
          sourceDirectory: source.directory,
          sourceRepositoryRoot: source.repositoryRoot,
        })).toThrow(/already in progress/);
        await Promise.resolve();
      },
    );

    expect(contractSet.verifyIngestedContractSet({ projectRoot: productRoot }).status).toBe('VERIFIED');
  });

  it('rejects a source whose bytes no longer match the manifest', () => {
    const source = createContractSet();
    writeFileSync(path.join(source.directory, 'openapi.v1.yaml'), 'tampered\n');

    expect(() => contractSet.verifyContractSetDirectory(source.directory)).toThrow(
      /byte size mismatch|SHA-256 mismatch/,
    );
  });

  it('rejects extra members and symlinked contract members', () => {
    const extra = createContractSet();
    writeFileSync(path.join(extra.directory, 'README.md'), 'unexpected');
    expect(() => contractSet.verifyContractSetDirectory(extra.directory)).toThrow(
      /members mismatch/,
    );

    const linked = createContractSet();
    const openapiPath = path.join(linked.directory, 'openapi.v1.yaml');
    rmSync(openapiPath);
    symlinkSync(path.join(linked.directory, 'schema-v1.12.sql'), openapiPath);
    expect(() => contractSet.verifyContractSetDirectory(linked.directory)).toThrow(
      /regular non-symlink file/,
    );
  });

  it('fails closed after an ingested snapshot is modified', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();
    const created = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    });
    writeFileSync(path.join(created.path, 'schema-v1.12.sql'), 'tampered\n');

    expect(() => contractSet.verifyIngestedContractSet({ projectRoot: productRoot })).toThrow(
      /byte size mismatch|SHA-256 mismatch/,
    );
  });

  it('fails closed after ingested manifest metadata is modified', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();
    const created = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    });
    const manifestPath = path.join(created.path, 'contract-set.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, architecture_version: '1.17' }, null, 2)}\n`,
    );

    expect(() => contractSet.verifyIngestedContractSet({ projectRoot: productRoot })).toThrow(
      /lock mismatch at manifest_sha256/,
    );
  });

  it('rejects a consumption lock that claims activation or drifts from its schema', () => {
    const productRoot = createProductRoot();
    const source = createContractSet();
    const created = contractSet.ingestContractSet({
      projectRoot: productRoot,
      sourceDirectory: source.directory,
      sourceRepositoryRoot: source.repositoryRoot,
    });
    const originalLock = JSON.parse(readFileSync(created.lock_path, 'utf8')) as Record<string, unknown>;
    const invalidLocks = [
      { ...originalLock, ddev_authorized: true },
      { ...originalLock, runtime_activated: true },
      { ...originalLock, intake_status: 'ACTIVATED' },
      { ...originalLock, unexpected_activation_note: 'drift' },
    ];

    for (const invalidLock of invalidLocks) {
      writeFileSync(created.lock_path, `${JSON.stringify(invalidLock, null, 2)}\n`);
      expect(() => contractSet.verifyIngestedContractSet({ projectRoot: productRoot })).toThrow(
        /must remain verified but not activated|unexpected fields/,
      );
    }
  });

  it('verifies the repository snapshot without enabling Ddev or runtime use', () => {
    const verified = contractSet.verifyIngestedContractSet({ projectRoot: repositoryRoot });
    const manifestBytes = readFileSync(path.join(verified.path, 'contract-set.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;

    expect(verified).toMatchObject({
      status: 'VERIFIED',
      contract_set_id: 'cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701',
      source_git_sha: '2c75d8e7670134e6aa95a4780ff09fe0422a65e8',
      intake_status: 'VERIFIED_NOT_ACTIVATED',
      ddev_authorized: false,
      runtime_activated: false,
    });
    expect(manifest).toMatchObject({
      architecture_version: '1.16',
      implementation_version: '1.22',
    });
    expect(sha256(manifestBytes)).toBe(
      'e7c209c210f6b2db6618d8f6d3700327ec234e93a8be1878c39378cd9f8635ee',
    );
    expect(sha256(readFileSync(path.join(verified.path, 'openapi.v1.yaml')))).toBe(
      '361f20128c88143eb87370f136b67c4de8c1ed5fc02c7072f62c16545951315c',
    );
    expect(sha256(readFileSync(path.join(verified.path, 'schema-v1.15.sql')))).toBe(
      '859c4a4757d87e642e797ad8a26cfb334c49ae7f8f263966099eb89e6750b38b',
    );
  });
});
