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

function createSourceRepository(openapi: string, database: string, marker: string, openapiPath = OPENAPI_SOURCE_PATH, databasePath = DATABASE_SOURCE_PATH): Readonly<{
  repositoryRoot: string;
  sourceGitSha: string;
}> {
  const repositoryRoot = temporaryDirectory('customer-agent-record-source');
  mkdirSync(path.dirname(path.join(repositoryRoot, openapiPath)), { recursive: true });
  writeFileSync(path.join(repositoryRoot, openapiPath), openapi);
  writeFileSync(path.join(repositoryRoot, databasePath), database);
  runGit(repositoryRoot, ['init', '--quiet']);
  runGit(repositoryRoot, ['add', '--', openapiPath, databasePath]);
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
  intake = false,
  usage = false,
  quality = false,
  management = false,
  direct = false,
}: {
  marker?: string;
  declaredSourceGitSha?: string;
  intake?: boolean;
  usage?: boolean;
  quality?: boolean;
  management?: boolean;
  direct?: boolean;
} = {}): Readonly<{
  directory: string;
  contractSetId: string;
  openapi: string;
  database: string;
  repositoryRoot: string;
  sourceGitSha: string;
}> {
  const apiVersion = direct ? '1.20.0' : management ? '1.19.0' : quality ? '1.18.0' : usage ? '1.17.0' : intake ? '1.16.0' : '1.11.0';
  const schemaVersion = direct ? '1.22' : management || quality || usage ? '1.21' : intake ? '1.20' : '1.12';
  const developmentRoot = 'business-docs/01-客服Agent项目/30-开发-进行中';
  const openapiPath = intake || usage || quality || management || direct ? `${developmentRoot}/openapi.v${apiVersion.slice(0,-2)}.yaml` : OPENAPI_SOURCE_PATH;
  const databasePath = intake || usage || quality || management || direct ? `${developmentRoot}/schema.v${schemaVersion}.sql` : DATABASE_SOURCE_PATH;
  const openapi = `openapi: 3.1.0\ninfo:\n  title: Synthetic contract test ${marker}\n`;
  const database = `CREATE TABLE contract_test_${marker} (id bigint PRIMARY KEY);\n`;
  const sourceRepository = createSourceRepository(openapi, database, marker, openapiPath, databasePath);
  const sourceGitSha = declaredSourceGitSha ?? sourceRepository.sourceGitSha;
  const directory = temporaryDirectory('customer-agent-contract-source');
  const contractSetId = `cs-ai-c11-openapi-${apiVersion}-schema-${schemaVersion}-${sourceGitSha.slice(0, 12)}`;
  const manifest = {
    schema: 'customer-agent-contract-set/v1',
    contract_set_id: contractSetId,
    source_repository: 'ai-赋能立项',
    source_git_sha: sourceGitSha,
    architecture_version: '1.16',
    implementation_version: '1.21',
    openapi: {
      version: apiVersion,
      source_path: openapiPath,
      file: 'openapi.v1.yaml',
      sha256: sha256(openapi),
      bytes: Buffer.byteLength(openapi),
    },
    database: {
      version: `schema.v${schemaVersion}`,
      source_path: databasePath,
      file: `schema-v${schemaVersion}.sql`,
      sha256: sha256(database),
      bytes: Buffer.byteLength(database),
    },
  };
  writeFileSync(path.join(directory, 'openapi.v1.yaml'), openapi);
  writeFileSync(path.join(directory, `schema-v${schemaVersion}.sql`), database);
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
  it.each([
    'cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701',
    'cs-ai-c11-openapi-1.13.0-schema-1.16-6f7d18e59f2e',
    'cs-ai-c11-openapi-1.13.0-schema-1.17-0904a0aa11f2',
    'cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534',
  ])('accepts %s and rejects mixed or unreviewed version/source pairs', (id) => {
    const source = path.join(repositoryRoot, 'contracts/upstream/customer-agent', id);
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
    mixed.contract_set_id = mixed.contract_set_id.replace(/openapi-1\.(12|13|14)\.0/, 'openapi-1.11.0');
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

  it.each([false, true])('rejects self-consistent package bytes that differ from the declared Git source; management=%s', management => {
    const productRoot = createProductRoot();
    const source = createContractSet({ management });
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

  it.each(['intake', 'usage', 'quality', 'management', 'direct'])('accepts the reviewed P2 pair (%s) from the exact commit and rejects mixed versions or paths', pair => {
    const source = createContractSet({ intake: true, usage: pair === 'usage', quality: pair === 'quality', management: pair === 'management', direct: pair === 'direct' });
    const result = contractSet.ingestContractSet({ projectRoot: createProductRoot(), sourceDirectory: source.directory, sourceRepositoryRoot: source.repositoryRoot });
    expect(result).toMatchObject({ status: 'CREATED', runtime_activated: false, ddev_authorized: false });
    const manifestPath = path.join(source.directory, 'contract-set.json');
    const original = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      contract_set_id: string; database: { version: string; file: string; source_path: string }; openapi: { source_path: string };
    };
    for (const version of ['1.19', '1.20', '1.21', '1.22']) {
      if (original.database.version === `schema.v${version}`) continue;
      const mixed = structuredClone(original);
      mixed.database.version = `schema.v${version}`;
      mixed.database.file = `schema-v${version}.sql`;
      mixed.contract_set_id = mixed.contract_set_id.replace(/schema-1\.(?:20|21|22)-/, `schema-${version}-`);
      writeFileSync(manifestPath, JSON.stringify(mixed));
      expect(() => contractSet.verifyContractSetDirectory(source.directory)).toThrow(/version pair/);
    }
    for (const field of ['openapi', 'database'] as const) {
      const wrongPath = structuredClone(original);
      wrongPath[field].source_path = field === 'openapi' ? OPENAPI_SOURCE_PATH : DATABASE_SOURCE_PATH;
      writeFileSync(manifestPath, JSON.stringify(wrongPath));
      expect(() => contractSet.verifyContractSetDirectory(source.directory)).toThrow(/source_path/);
    }
  });

  it('verifies the repository snapshot without enabling Ddev or runtime use', () => {
    const verified = contractSet.verifyIngestedContractSet({ projectRoot: repositoryRoot });
    const manifestBytes = readFileSync(path.join(verified.path, 'contract-set.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;

    expect(verified).toMatchObject({
      status: 'VERIFIED',
      contract_set_id: 'cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929',
      source_git_sha: '6f318d448929d1a87c5dc9e725ea4f90c48a4b97',
      intake_status: 'VERIFIED_NOT_ACTIVATED',
      ddev_authorized: false,
      runtime_activated: false,
    });
    expect(manifest).toMatchObject({
      architecture_version: '1.16',
      implementation_version: '1.22',
    });
    expect(sha256(manifestBytes)).toBe(
      '1db23189fe6f088f312e5753f5a517dbf4fc4d386da0febeaa0ec3958265608c',
    );
    expect(sha256(readFileSync(path.join(verified.path, 'openapi.v1.yaml')))).toBe(
      '1513fe499773c83f4a2b9f0ca8e3a5f7369638f72dc1d18a291235093cfc034d',
    );
    expect(sha256(readFileSync(path.join(verified.path, 'schema-v1.22.sql')))).toBe(
      'c5e4896e8ed1ff587e23a70723bd9d81c056ba65561cd9d94963aa6b5f1ae3ce',
    );
  });
});
