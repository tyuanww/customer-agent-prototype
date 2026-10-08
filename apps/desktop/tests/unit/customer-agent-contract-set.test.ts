import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  cpSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
      runtime_sources?: Readonly<Record<string, string>>;
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

function createSourceRepository(openapi: string, database: string, marker: string, openapiPath = OPENAPI_SOURCE_PATH, databasePath = DATABASE_SOURCE_PATH, companions: Record<string, string> = {}): Readonly<{
  repositoryRoot: string;
  sourceGitSha: string;
}> {
  const repositoryRoot = temporaryDirectory('customer-agent-record-source');
  mkdirSync(path.dirname(path.join(repositoryRoot, openapiPath)), { recursive: true });
  writeFileSync(path.join(repositoryRoot, openapiPath), openapi);
  writeFileSync(path.join(repositoryRoot, databasePath), database);
  for (const [relative, content] of Object.entries(companions)) {
    mkdirSync(path.dirname(path.join(repositoryRoot, relative)), { recursive: true });
    writeFileSync(path.join(repositoryRoot, relative), content);
  }
  runGit(repositoryRoot, ['init', '--quiet']);
  runGit(repositoryRoot, ['add', '--', openapiPath, databasePath, ...Object.keys(companions)]);
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

// A complete synthetic v2 bundle, including a separately committed source tree.
// These bytes are never SQL-installed and contain no real governance approval.
function createRuntimeContractSet() {
  const root = 'business-docs/01-客服Agent项目/30-开发-进行中';
  const specs: Record<string, [string, string]> = {
    installation: ['content-intake-runtime-candidate/installation.generated.json','intake-runtime-installation.v1.json'],
    roles: ['content-intake-runtime-candidate/roles.sql','intake-runtime-roles.v1.sql'],
    organization: ['content-intake-runtime-candidate/organization.sql','intake-runtime-organization.v1.sql'],
    session: ['content-intake-runtime-candidate/session-lock.sql','intake-runtime-session.v1.sql'],
    acl: ['content-intake-runtime-candidate/purpose-acl.sql','intake-runtime-acl.v1.sql'],
    directoryAcl: ['content-intake-runtime-candidate/directory-acl.sql','intake-runtime-directory-acl.v1.sql'],
    directory: ['content-intake-shop-directory-candidate/storage.delta.sql','intake-shop-directory.v1.sql'],
    provenance: ['content-intake-runtime-candidate/provenance.json','intake-runtime-provenance.v1.json'],
    protocol: ['content-intake-runtime-candidate/protocol.json','intake-runtime-protocol.v1.json'],
  };
  const overlayNames = ['0021_content_intake_v1_20.sql','0022_intake_legacy_fence.sql','0023_intake_quality.sql',
    '0024_intake_publication.sql','0025_intake_usage_v1_21.sql','0026_intake_discovery_index.sql','0027_intake_rollback.sql',
    '0028_intake_family.sql','0029_intake_capacity.sql','0030_intake_role_ceiling.sql','0031_intake_direct_v1_22.sql','0032_intake_direct_publication.sql'];
  const implementation = { repository:'customer-agent-prototype',commit:'a'.repeat(40),migrationManifest:'b'.repeat(64),
    overlayFiles:Object.fromEntries(overlayNames.map(name=>[name,sha256(name)])),bodiesOwner:'product implementation' };
  const openapi = 'openapi: 3.1.0\ninfo:\n  title: Synthetic runtime package\n';
  const database = '-- Synthetic reference schema; not runtime installed.\n';
  const content: Record<string,string> = Object.fromEntries(Object.keys(specs).map(key=>[key,`-- Synthetic ${key}; test only.\n`]));
  content.provenance = JSON.stringify({implementationDependencies:implementation});
  content.protocol = JSON.stringify({schema:'content-intake-runtime-protocol/v1',status:'DRAFT'});
  content.installation = JSON.stringify({ schema:'content-intake-installation/v1',sqlContract:'schema.v1.23',
    capabilityLogin:false,environmentCredentialsIncluded:false,companionAclRequired:true,
    referenceMode:{runtimeReady:false},productMode:{atomicCandidateInstall:true,skipMissingDependencies:false,implementation,
      order:['product-migrations','roles','organization','session','directory','directoryAcl','acl','environment-login-bindings']},
    requiredBundleArtifacts:['openapi','database',...Object.keys(specs)],
    openapi:{path:`${root}/openapi.v1.21.yaml`,sha256:sha256(openapi)},database:{path:`${root}/schema.v1.23.sql`,sha256:sha256(database)},
    sources:Object.fromEntries(Object.entries(specs).filter(([key])=>key!=='installation').map(([key,[relative]])=>[key,{path:`${root}/${relative}`,sha256:sha256(content[key]!)}])),
  });
  const source = createSourceRepository(openapi,database,'runtime',`${root}/openapi.v1.21.yaml`,`${root}/schema.v1.23.sql`,
    Object.fromEntries(Object.entries(specs).map(([key,[relative]])=>[`${root}/${relative}`,content[key]!])));
  const descriptor = (version:string, source_path:string, file:string, bytes:string) => ({version,source_path,file,sha256:sha256(bytes),bytes:Buffer.byteLength(bytes)});
  const manifest = { schema:'customer-agent-contract-set/v2',contract_set_id:`cs-ai-c11-openapi-1.21.0-schema-1.23-${source.sourceGitSha.slice(0,12)}`,
    source_repository:'ai-赋能立项',source_git_sha:source.sourceGitSha,architecture_version:'1.16',implementation_version:'1.21',
    openapi:descriptor('1.21.0',`${root}/openapi.v1.21.yaml`,'openapi.v1.yaml',openapi),
    database:descriptor('schema.v1.23',`${root}/schema.v1.23.sql`,'schema-v1.23.sql',database),
    runtime:Object.fromEntries(Object.entries(specs).map(([key,[relative,file]])=>[key,descriptor('1',`${root}/${relative}`,file,content[key]!)])),
  };
  const directory = temporaryDirectory('runtime-contract-bundle');
  writeFileSync(path.join(directory,manifest.openapi.file),openapi);
  writeFileSync(path.join(directory,manifest.database.file),database);
  for (const [key,entry] of Object.entries(manifest.runtime)) writeFileSync(path.join(directory,entry.file),content[key]!);
  const save = () => writeFileSync(path.join(directory,'contract-set.json'),JSON.stringify(manifest));
  save();
  const replace = (key:string,value:string) => {
    content[key]=value;const entry=manifest.runtime[key]!;
    entry.sha256=sha256(value);entry.bytes=Buffer.byteLength(value);
    writeFileSync(path.join(directory,entry.file),value);save();
  };
  return {directory,manifest,source,content,replace,save};
}

describe('versioned runtime bundle intake', () => {
  it('copies every companion and exposes immutable bytes to the actual locked consumer without activation', async () => {
    const source=createRuntimeContractSet(),productRoot=createProductRoot();
    const result=contractSet.ingestContractSet({projectRoot:productRoot,sourceDirectory:source.directory,sourceRepositoryRoot:source.source.repositoryRoot});
    expect(result).toMatchObject({status:'CREATED',intake_status:'VERIFIED_NOT_ACTIVATED',runtime_activated:false,ddev_authorized:false});
    expect(readdirSync(result.path)).toHaveLength(12);
    await contractSet.withVerifiedContractSetSnapshot({projectRoot:productRoot},snapshot=>{
      expect(snapshot.runtime_sources).toEqual(source.content);
      expect(Object.isFrozen(snapshot.runtime_sources)).toBe(true);
      expect(Object.isFrozen(snapshot.manifest.runtime)).toBe(true);
    });
    writeFileSync(path.join(result.path,source.manifest.runtime.acl!.file),'-- tampered installed companion\n');
    expect(()=>contractSet.verifyIngestedContractSet({projectRoot:productRoot})).toThrow(/size mismatch|SHA-256/);
  });

  it.each(['missing','extra','symlink','tampered'])('rejects %s companion input before creating the product lock',kind=>{
    const source=createRuntimeContractSet(),productRoot=createProductRoot(),acl=path.join(source.directory,source.manifest.runtime.acl!.file);
    if(kind==='missing')rmSync(acl);
    else if(kind==='extra')writeFileSync(path.join(source.directory,'unlisted.sql'),'SELECT 1;');
    else if(kind==='symlink'){rmSync(acl);symlinkSync(path.join(source.directory,source.manifest.runtime.roles!.file),acl);}
    else writeFileSync(acl,'-- invalid SQL input\n');
    expect(()=>contractSet.ingestContractSet({projectRoot:productRoot,sourceDirectory:source.directory,sourceRepositoryRoot:source.source.repositoryRoot})).toThrow();
    expect(existsSync(path.join(productRoot,'contracts/upstream/customer-agent/contract-set.lock.json'))).toBe(false);
  });

  it('rejects a rehashed companion that disagrees with the inner installation references',()=>{
    const source=createRuntimeContractSet();source.replace('acl','-- newly hashed but unbound companion\n');
    expect(()=>contractSet.verifyContractSetDirectory(source.directory)).toThrow(/acl reference mismatch/);
  });

  it('rejects inconsistent overlay prerequisites even when the outer installation hash is updated',()=>{
    const source=createRuntimeContractSet(),installation=JSON.parse(source.content.installation!);
    installation.productMode.implementation.overlayFiles['0032_intake_direct_publication.sql']='e'.repeat(64);
    source.replace('installation',JSON.stringify(installation));
    expect(()=>contractSet.verifyContractSetDirectory(source.directory)).toThrow(/implementation dependencies mismatch/);
  });

  it('checks every companion against the declared source Git commit, not only the original pair',()=>{
    const source=createRuntimeContractSet(),installation=JSON.parse(source.content.installation!);
    source.replace('acl','-- consistent package but absent from declared Git source\n');
    installation.sources.acl.sha256=source.manifest.runtime.acl!.sha256;
    source.replace('installation',JSON.stringify(installation));
    expect(()=>contractSet.verifyContractSetDirectory(source.directory)).not.toThrow();
    expect(()=>contractSet.ingestContractSet({projectRoot:createProductRoot(),sourceDirectory:source.directory,sourceRepositoryRoot:source.source.repositoryRoot})).toThrow(/declared source Git commit/);
  });

  it.each([false, true])('rejects source replacement during copying and preserves the previous lock (%s)', hasPriorLock => {
    const source = createRuntimeContractSet(), productRoot = createProductRoot();
    const upstream = path.join(productRoot, 'contracts/upstream/customer-agent');
    const lockPath = path.join(upstream, 'contract-set.lock.json');
    if (hasPriorLock) {
      const prior = createContractSet();
      contractSet.ingestContractSet({ projectRoot: productRoot, sourceDirectory: prior.directory,
        sourceRepositoryRoot: prior.repositoryRoot });
    }
    const previousLock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;
    // Intercept only this child process's first copy, after source Git validation.
    // A child avoids changing Node's shared fs bindings in the Vitest worker.
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import path from 'node:path';
      import { createHash } from 'node:crypto';
      import { syncBuiltinESMExports } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const [script, sourceDirectory, projectRoot, sourceRepositoryRoot] = process.argv.slice(1);
      process.argv[1] = 'synthetic-contract-race-harness';
      const intake = await import(pathToFileURL(script).href);
      const manifestPath = path.join(sourceDirectory, 'contract-set.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const installation = JSON.parse(fs.readFileSync(path.join(sourceDirectory, manifest.runtime.installation.file), 'utf8'));
      const replace = (key, content) => {
        const descriptor = manifest.runtime[key];
        descriptor.sha256 = createHash('sha256').update(content).digest('hex');
        descriptor.bytes = Buffer.byteLength(content);
        fs.writeFileSync(path.join(sourceDirectory, descriptor.file), content);
      };
      const original = fs.copyFileSync; let replaced = false;
      fs.copyFileSync = (from, to, ...options) => {
        if (!replaced && String(from).startsWith(sourceDirectory + path.sep)) {
          replaced = true;
          replace('acl', '-- replacement absent from the declared Git commit\\n');
          installation.sources.acl.sha256 = manifest.runtime.acl.sha256;
          replace('installation', JSON.stringify(installation));
          fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        }
        return original(from, to, ...options);
      };
      syncBuiltinESMExports();
      let error = null;
      try { intake.ingestContractSet({ projectRoot, sourceDirectory, sourceRepositoryRoot }); }
      catch (failure) { error = String(failure); }
      finally { fs.copyFileSync = original; syncBuiltinESMExports(); }
      console.log(JSON.stringify({ replaced, error }));
    `, path.join(repositoryRoot, 'scripts/customer-agent-contract-set.mjs'), source.directory, productRoot, source.source.repositoryRoot], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })) as { replaced: boolean; error: string | null };
    expect(result.replaced).toBe(true);
    expect(result.error).toContain('Staged contract-set manifest differs from the verified source');
    expect(existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null).toBe(previousLock);
    expect(existsSync(path.join(upstream, source.manifest.contract_set_id))).toBe(false);
    expect(readdirSync(upstream).some(name => name.startsWith('.contract-intake'))).toBe(false);
  });

  it('rejects a companion-bearing v1 manifest and v2 paired with old contract generations',()=>{
    const source=createRuntimeContractSet();
    source.manifest.schema='customer-agent-contract-set/v1';source.save();
    expect(()=>contractSet.verifyContractSetDirectory(source.directory)).toThrow(/unexpected fields/);
    source.manifest.schema='customer-agent-contract-set/v2';source.manifest.openapi.version='1.20.0';
    source.manifest.database.version='schema.v1.22';source.manifest.database.file='schema-v1.22.sql';
    source.manifest.contract_set_id=source.manifest.contract_set_id.replace('openapi-1.21.0-schema-1.23','openapi-1.20.0-schema-1.22');source.save();
    expect(()=>contractSet.verifyContractSetDirectory(source.directory)).toThrow(/version pair/);
  });
});

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
      contract_set_id: 'cs-ai-c11-openapi-1.21.0-schema-1.23-e35c0c01b551',
      source_git_sha: 'e35c0c01b5510ffcff75f2b19ba441ad53a9b504',
      intake_status: 'VERIFIED_NOT_ACTIVATED',
      ddev_authorized: false,
      runtime_activated: false,
    });
    expect(manifest).toMatchObject({
      architecture_version: '1.16',
      implementation_version: '1.22',
    });
    expect(sha256(manifestBytes)).toBe(
      'a15e0193a8e577e9f1c4a1c52b5b7cba7a11674e3cd157c1eb135fa5e4f2aa1a',
    );
    expect(sha256(readFileSync(path.join(verified.path, 'openapi.v1.yaml')))).toBe(
      'bde5124df711333e6860c0cea1734f47fe5c45c95b56c0d5cde3d2e9466246d7',
    );
    expect(sha256(readFileSync(path.join(verified.path, 'schema-v1.23.sql')))).toBe(
      '4c2969459265262fabfe38ae425ab8c1275c46274d03ae09ec39b75ae9cc978e',
    );
  });
});
