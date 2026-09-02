import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse, stringify } from 'yaml';
import { withVerifiedContractSetSnapshot } from '../../../scripts/customer-agent-contract-set.mjs';

const CODEGEN_SCHEMA = 'customer-agent-contract-codegen/v1';
const RUNTIME_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const GENERATED_HEADER = 'GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root.';
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const PACKAGE_MANIFEST = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const OUTPUTS = Object.freeze({
  bundle: 'packages/contracts/openapi/bundle.generated.yaml',
  types: 'packages/contracts/src/generated/openapi.generated.ts',
  runtimeSchema: 'packages/contracts/src/generated/runtime-schema.generated.ts',
  provenance: 'packages/contracts/src/generated/provenance.generated.ts',
  manifest: 'packages/contracts/src/generated/codegen-manifest.generated.json',
});
const NON_VALIDATION_SCHEMA_KEYS = new Set([
  'deprecated',
  'description',
  'discriminator',
  'example',
  'examples',
  'externalDocs',
  'readOnly',
  'writeOnly',
  'xml',
]);
const VALIDATION_EXTENSION_SCHEMA_KEYS = new Set(['x-unique-by']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function inspectReferences(value, location = '#', seen = new WeakSet()) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectReferences(entry, `${location}/${index}`, seen));
    return;
  }
  if (!isRecord(value) || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && (typeof child !== 'string' || !child.startsWith('#/'))) {
      throw new Error(`External or invalid OpenAPI reference at ${location}/$ref`);
    }
    inspectReferences(child, `${location}/${key}`, seen);
  }
}

function rewriteComponentReference(reference) {
  const prefix = '#/components/schemas/';
  if (!reference.startsWith(prefix)) {
    throw new Error(`Runtime component schema has a non-schema reference: ${reference}`);
  }
  return `#/$defs/${reference.slice(prefix.length)}`;
}

export function toRuntimeSchema(value) {
  if (Array.isArray(value)) {
    return value.map(toRuntimeSchema);
  }
  if (!isRecord(value)) {
    return value;
  }

  const transformed = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (
      (key.startsWith('x-') && !VALIDATION_EXTENSION_SCHEMA_KEYS.has(key))
      || NON_VALIDATION_SCHEMA_KEYS.has(key)
    ) {
      continue;
    }
    if (key === '$ref') {
      transformed[key] = rewriteComponentReference(requireString(child, '$ref'));
    } else if (VALIDATION_EXTENSION_SCHEMA_KEYS.has(key)) {
      transformed[key] = requireString(child, key);
    } else {
      transformed[key] = toRuntimeSchema(child);
    }
  }

  if (
    transformed.type === undefined
    && (
      Object.hasOwn(transformed, 'properties')
      || Object.hasOwn(transformed, 'required')
      || Object.hasOwn(transformed, 'additionalProperties')
    )
  ) {
    transformed.type = 'object';
  }
  return transformed;
}

function generatedTypeSource(openapiDocument) {
  return openapiTS(openapiDocument).then((ast) => (
    `/* ${GENERATED_HEADER} */\n\n${astToString(ast)}`
  ));
}

function generatedRuntimeSchemaSource(runtimeSchemaId, schemaNames, runtimeDocument) {
  return [
    `/* ${GENERATED_HEADER} */`,
    '',
    `export const OPENAPI_RUNTIME_SCHEMA_ID = ${JSON.stringify(runtimeSchemaId)};`,
    `export const COMPONENT_SCHEMA_NAMES = ${JSON.stringify(schemaNames, null, 2)} as const;`,
    'export type GeneratedComponentSchemaName = (typeof COMPONENT_SCHEMA_NAMES)[number];',
    'export const OPENAPI_RUNTIME_SCHEMA_DOCUMENT: Readonly<Record<string, unknown>> =',
    `  ${JSON.stringify(runtimeDocument, null, 2)};`,
    '',
  ].join('\n');
}

function toolVersions() {
  const dependencyVersion = (group, name) => {
    const version = PACKAGE_MANIFEST[group]?.[name];
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`packages/contracts/package.json must pin ${name} to an exact version`);
    }
    return version;
  };
  return Object.freeze({
    openapi_typescript: dependencyVersion('devDependencies', 'openapi-typescript'),
    yaml: dependencyVersion('devDependencies', 'yaml'),
    ajv: dependencyVersion('dependencies', 'ajv'),
    ajv_formats: dependencyVersion('dependencies', 'ajv-formats'),
  });
}

function artifactDescriptor(relativePath, content) {
  return Object.freeze({
    path: relativePath,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
  });
}

async function buildGeneratedArtifactsFromSnapshot(snapshot) {
  const { lock, manifest, openapi_source: source } = snapshot;
  const openapiDescriptor = requireRecord(manifest.openapi, 'OpenAPI descriptor');
  const databaseDescriptor = requireRecord(manifest.database, 'Database descriptor');
  const openapiDocument = parse(source, { maxAliasCount: 0 });
  const root = requireRecord(openapiDocument, 'OpenAPI document');
  const info = requireRecord(root.info, 'OpenAPI info');
  const components = requireRecord(root.components, 'OpenAPI components');
  const componentSchemas = requireRecord(components.schemas, 'OpenAPI component schemas');
  const openapiVersion = requireString(root.openapi, 'OpenAPI dialect');
  const contractVersion = requireString(info.version, 'OpenAPI info.version');

  if (!openapiVersion.startsWith('3.1.')) {
    throw new Error(`Only OpenAPI 3.1 is supported, found ${openapiVersion}`);
  }
  if (contractVersion !== openapiDescriptor.version) {
    throw new Error('OpenAPI info.version does not match the verified contract-set manifest');
  }
  inspectReferences(root);

  const schemaNames = Object.keys(componentSchemas).sort();
  if (schemaNames.length === 0) {
    throw new Error('OpenAPI components.schemas must not be empty');
  }
  const runtimeSchemaId = `urn:customer-agent:openapi:${contractVersion}:components`;
  const runtimeDocument = {
    $schema: RUNTIME_SCHEMA_DIALECT,
    $id: runtimeSchemaId,
    $defs: Object.fromEntries(
      schemaNames.map((name) => [name, toRuntimeSchema(componentSchemas[name])]),
    ),
  };

  const bundledYaml = `# ${GENERATED_HEADER}\n${stringify(root, { lineWidth: 0, sortMapEntries: false })}`;
  const reparsedBundle = parse(bundledYaml, { maxAliasCount: 0 });
  if (JSON.stringify(reparsedBundle) !== JSON.stringify(root)) {
    throw new Error('Generated OpenAPI bundle does not round-trip to the verified source document');
  }

  const generatedTypes = await generatedTypeSource(root);
  const generatedRuntimeSchema = generatedRuntimeSchemaSource(
    runtimeSchemaId,
    schemaNames,
    runtimeDocument,
  );
  const initialArtifacts = {
    bundle: artifactDescriptor(OUTPUTS.bundle, bundledYaml),
    types: artifactDescriptor(OUTPUTS.types, generatedTypes),
    runtime_schema: artifactDescriptor(OUTPUTS.runtimeSchema, generatedRuntimeSchema),
  };
  const provenanceValue = {
    schema: CODEGEN_SCHEMA,
    contract_set_id: snapshot.contract_set_id,
    source_repository: lock.source_repository,
    source_git_sha: snapshot.source_git_sha,
    manifest_sha256: lock.manifest_sha256,
    openapi_version: contractVersion,
    openapi_sha256: lock.openapi_sha256,
    database_version: databaseDescriptor.version,
    database_sha256: lock.database_sha256,
    intake_status: snapshot.intake_status,
    runtime_activated: false,
    runtime_schema_dialect: RUNTIME_SCHEMA_DIALECT,
    component_schema_count: schemaNames.length,
    tools: toolVersions(),
    artifacts: initialArtifacts,
  };
  const generatedProvenance = [
    `/* ${GENERATED_HEADER} */`,
    '',
    `export const CONTRACT_PROVENANCE = Object.freeze(${JSON.stringify(provenanceValue, null, 2)});`,
    '',
  ].join('\n');
  const artifacts = {
    ...initialArtifacts,
    provenance: artifactDescriptor(OUTPUTS.provenance, generatedProvenance),
  };
  const codegenManifest = `${JSON.stringify({
    ...provenanceValue,
    artifacts,
  }, null, 2)}\n`;

  return Object.freeze({
    contract_set_id: snapshot.contract_set_id,
    runtime_activated: false,
    schema_count: schemaNames.length,
    files: new Map([
      [OUTPUTS.bundle, bundledYaml],
      [OUTPUTS.types, generatedTypes],
      [OUTPUTS.runtimeSchema, generatedRuntimeSchema],
      [OUTPUTS.provenance, generatedProvenance],
      [OUTPUTS.manifest, codegenManifest],
    ]),
  });
}

export async function buildGeneratedArtifacts({ projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  return withVerifiedContractSetSnapshot(
    { projectRoot: resolvedRoot },
    buildGeneratedArtifactsFromSnapshot,
  );
}

function assertSafeOutputPath(projectRoot, relativePath) {
  const absolutePath = path.resolve(projectRoot, relativePath);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing generated path outside project root: ${relativePath}`);
  }
  let cursor = projectRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Refusing symlink in generated path: ${relativePath}`);
    }
  }
  return absolutePath;
}

function writeAtomically(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function assertExactGeneratedMemberSet(projectRoot, expectedPaths) {
  const expectedByDirectory = new Map();
  for (const relativePath of expectedPaths) {
    const directory = path.dirname(relativePath);
    const names = expectedByDirectory.get(directory) ?? [];
    names.push(path.basename(relativePath));
    expectedByDirectory.set(directory, names);
  }

  for (const [relativeDirectory, expectedNames] of expectedByDirectory) {
    const absoluteDirectory = assertSafeOutputPath(projectRoot, relativeDirectory);
    const actualNames = readdirSync(absoluteDirectory).sort();
    const expected = [...expectedNames].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expected)) {
      throw new Error(
        `Generated contract member drift in ${relativeDirectory}: expected ${expected.join(', ')}, found ${actualNames.join(', ')}`,
      );
    }
  }
}

export async function generateContracts({ projectRoot = DEFAULT_PROJECT_ROOT, check = false } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  return withVerifiedContractSetSnapshot({ projectRoot: resolvedRoot }, async (snapshot) => {
    const generated = await buildGeneratedArtifactsFromSnapshot(snapshot);
    const drift = [];

    for (const [relativePath, expectedContent] of generated.files) {
      const absolutePath = assertSafeOutputPath(resolvedRoot, relativePath);
      if (check) {
        if (!existsSync(absolutePath) || readFileSync(absolutePath, 'utf8') !== expectedContent) {
          drift.push(relativePath);
        }
        continue;
      }
      if (!existsSync(absolutePath) || readFileSync(absolutePath, 'utf8') !== expectedContent) {
        writeAtomically(absolutePath, expectedContent);
      }
    }

    if (drift.length > 0) {
      throw new Error(`Generated contract drift: ${drift.join(', ')}`);
    }
    assertExactGeneratedMemberSet(resolvedRoot, generated.files.keys());
    return Object.freeze({
      status: check ? 'GENERATED_MATCH' : 'GENERATED',
      contract_set_id: generated.contract_set_id,
      runtime_activated: false,
      schema_count: generated.schema_count,
      files: [...generated.files.keys()],
    });
  });
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== '--check')) {
    throw new Error(`Unknown contract codegen option: ${arguments_.find((argument) => argument !== '--check')}`);
  }
  const result = await generateContracts({ check: arguments_.includes('--check') });
  console.log(JSON.stringify(result, null, 2));
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  runCli().catch((error) => {
    console.error(`CONTRACT_CODEGEN_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
