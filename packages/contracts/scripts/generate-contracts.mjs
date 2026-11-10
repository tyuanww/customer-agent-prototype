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
import { verifyIngestedSopResourceDisableContractSet, verifyIngestedCorrectedSopUnifiedContractSet, withVerifiedContractSetSnapshot } from '../../../scripts/customer-agent-contract-set.mjs';

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
const SOP_UNIFIED_OUTPUTS = Object.freeze(Object.fromEntries(
  Object.entries(OUTPUTS).map(([key, file]) => [key, file.replace(
    '/openapi/', '/openapi/sop-unified/',
  ).replace('/src/generated/', '/src/generated/sop-unified/')]),
));
const SOP_RESOURCE_OUTPUTS = Object.freeze(Object.fromEntries(
  Object.entries(OUTPUTS).map(([key, file]) => [key, file.replace(
    '/openapi/', '/openapi/sop-resource-disable/',
  ).replace('/src/generated/', '/src/generated/sop-resource-disable/')]),
));
const SOP_RESOURCE_LOCK = 'contracts/upstream/customer-agent/sop-resource-disable-contract-set.lock.json';
const SOP_CORRECTED_LOCK = 'contracts/upstream/customer-agent/sop-unified-corrected-contract-set.lock.json';
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
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas']);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SUBSCHEMA_KEYS = new Set([
  'items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames',
  'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema',
]);

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
      if (Array.isArray(child)) {
        if (child.length === 0 || new Set(child).size !== child.length) {
          throw new Error(`${key} must contain distinct non-empty property names`);
        }
        transformed[key] = child.map((name) => requireString(name, key));
      } else {
        transformed[key] = requireString(child, key);
      }
    } else if (SCHEMA_MAP_KEYS.has(key)) {
      // Dictionary keys are business field names, even when named "required",
      // "description" or "x-*". Only their values are schema nodes.
      const schemas = Object.create(null);
      for (const [name, schema] of Object.entries(requireRecord(child, key))) {
        schemas[name] = toRuntimeSchema(schema);
      }
      transformed[key] = schemas;
    } else if (SCHEMA_ARRAY_KEYS.has(key)) {
      if (!Array.isArray(child)) throw new Error(`${key} must be a schema array`);
      transformed[key] = child.map(toRuntimeSchema);
    } else if (SUBSCHEMA_KEYS.has(key)) {
      transformed[key] = toRuntimeSchema(child);
    } else {
      // const/enum/default and other literal values are data, not schemas.
      transformed[key] = child;
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

function generatedTypeSource(openapiDocument, preserveConstDiscriminators = false) {
  const typeDocument = structuredClone(openapiDocument);
  if (preserveConstDiscriminators) {
    // openapi-typescript infers component names for an unmapped discriminator,
    // overriding the schema's const status. Let the authoritative const win.
    for (const schema of Object.values(typeDocument.components.schemas)) {
      if (isRecord(schema.discriminator) && !schema.discriminator.mapping) delete schema.discriminator;
    }
  }
  return openapiTS(typeDocument).then((ast) => (
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

async function buildGeneratedArtifactsFromSnapshot(snapshot, {
  outputs = OUTPUTS,
  view,
  provenance = {},
} = {}) {
  const effectiveSnapshot = snapshot.readiness ?? snapshot.repair ?? snapshot;
  const { lock, manifest, openapi_source: source } = effectiveSnapshot;
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
  const runtimeSchemaId = `urn:customer-agent:openapi:${contractVersion}:${view ?? 'components'}`;
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

  const generatedTypes = await generatedTypeSource(root, view !== undefined);
  const generatedRuntimeSchema = generatedRuntimeSchemaSource(
    runtimeSchemaId,
    schemaNames,
    runtimeDocument,
  );
  const initialArtifacts = {
    bundle: artifactDescriptor(outputs.bundle, bundledYaml),
    types: artifactDescriptor(outputs.types, generatedTypes),
    runtime_schema: artifactDescriptor(outputs.runtimeSchema, generatedRuntimeSchema),
  };
  const provenanceValue = {
    schema: CODEGEN_SCHEMA,
    ...provenance,
    contract_set_id: effectiveSnapshot.contract_set_id,
    source_repository: lock.source_repository,
    source_git_sha: effectiveSnapshot.source_git_sha,
    manifest_sha256: lock.manifest_sha256,
    openapi_version: contractVersion,
    openapi_sha256: lock.openapi_sha256,
    database_version: databaseDescriptor.version,
    database_sha256: lock.database_sha256,
    intake_status: effectiveSnapshot.intake_status,
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
    provenance: artifactDescriptor(outputs.provenance, generatedProvenance),
  };
  const codegenManifest = `${JSON.stringify({
    ...provenanceValue,
    artifacts,
  }, null, 2)}\n`;

  return Object.freeze({
    contract_set_id: effectiveSnapshot.contract_set_id,
    runtime_activated: false,
    schema_count: schemaNames.length,
    files: new Map([
      [outputs.bundle, bundledYaml],
      [outputs.types, generatedTypes],
      [outputs.runtimeSchema, generatedRuntimeSchema],
      [outputs.provenance, generatedProvenance],
      [outputs.manifest, codegenManifest],
    ]),
  });
}

function references(value, consume) {
  if (Array.isArray(value)) {
    value.forEach((child) => references(child, consume));
  } else if (isRecord(value)) {
    if (Object.hasOwn(value, '$ref')) consume(requireString(value.$ref, '$ref'));
    Object.values(value).forEach((child) => references(child, consume));
  }
}

// The view selects schema families, then follows actual references. Field shapes
// and validation constraints remain owned by the accepted OpenAPI bytes.
export function sopUnifiedDocument(root) {
  const schemas = requireRecord(root.components?.schemas, 'SOP unified schemas');
  const roots = new Set(Object.keys(schemas).filter((name) => (
    name.startsWith('Intake') || name.startsWith('MenokinSopQuery')
  )));
  const parents = new Map();
  for (const [name, schema] of Object.entries(schemas)) {
    references(schema, (reference) => {
      const prefix = '#/components/schemas/';
      if (!reference.startsWith(prefix)) return;
      const dependency = reference.slice(prefix.length);
      const dependents = parents.get(dependency) ?? new Set();
      dependents.add(name);
      parents.set(dependency, dependents);
    });
  }
  // Material, snapshot and quality envelopes carry the graph too. Include their
  // transitive schema owners before resolving the forward reference closure.
  for (const name of roots) {
    for (const parent of parents.get(name) ?? []) roots.add(parent);
  }
  for (const name of ['IntakeSopFlowDefinition', 'MenokinSopQuerySopQueryRequest', 'MenokinSopQuerySopQueryResponse']) {
    if (!roots.has(name)) throw new Error(`Missing SOP unified root schema: ${name}`);
  }
  const query = requireRecord(root.paths?.['/v1/sop/query'], 'SOP unified query path');
  const components = Object.create(null);
  const visited = new Set();
  function include(reference) {
    if (visited.has(reference)) return;
    const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(reference);
    if (!match) throw new Error(`Unsupported SOP unified reference: ${reference}`);
    const [, group, encodedName] = match;
    const name = encodedName.replaceAll('~1', '/').replaceAll('~0', '~');
    const source = root.components[group];
    if (!isRecord(source) || !Object.hasOwn(source, name)) {
      throw new Error(`Unresolved SOP unified reference: ${reference}`);
    }
    visited.add(reference);
    components[group] ??= Object.create(null);
    components[group][name] = source[name];
    references(source[name], include);
  }
  [...roots].sort().forEach((name) => include(`#/components/schemas/${name}`));
  references(query, include);
  for (const requirement of query.post?.security ?? root.security ?? []) {
    Object.keys(requirement).forEach((name) => include(`#/components/securitySchemes/${name}`));
  }
  return { openapi: root.openapi, info: root.info, paths: { '/v1/sop/query': query }, components };
}

async function buildSnapshotViews(projectRoot, snapshot) {
  const legacy = await buildGeneratedArtifactsFromSnapshot(snapshot);
  if (!existsSync(path.join(projectRoot, SOP_CORRECTED_LOCK))) {
    if (existsSync(path.join(projectRoot, path.dirname(SOP_UNIFIED_OUTPUTS.manifest)))) {
      throw new Error('SOP unified generated view requires its accepted corrected consumption lock');
    }
    return legacy;
  }
  // The caller holds the shared intake lock across verification, reads and writes.
  const verified = verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot });
  const manifestBytes = readFileSync(path.join(verified.path, 'contract-set.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const source = readFileSync(path.join(verified.path, manifest.openapi.file));
  if (source.length !== manifest.openapi.bytes || sha256(source) !== verified.openapi_sha256) {
    throw new Error('SOP unified source byte drift');
  }
  const root = requireRecord(parse(source.toString('utf8'), { maxAliasCount: 0 }), 'SOP unified OpenAPI');
  inspectReferences(root);
  const document = sopUnifiedDocument(root);
  const unified = await buildGeneratedArtifactsFromSnapshot({
    ...verified, lock: verified, manifest, openapi_source: stringify(document, { lineWidth: 0 }),
  }, {
    outputs: SOP_UNIFIED_OUTPUTS,
    view: 'sop-unified',
    provenance: {
      view: 'sopUnified',
      source_manifest: { sha256: sha256(manifestBytes), bytes: manifestBytes.length },
      source_artifacts: { openapi: manifest.openapi, database: manifest.database, ...manifest.sopUnified },
    },
  });
  const resource = existsSync(path.join(projectRoot, SOP_RESOURCE_LOCK))
    ? await buildResourceDisableView(projectRoot) : undefined;
  if (!resource && existsSync(path.join(projectRoot, path.dirname(SOP_RESOURCE_OUTPUTS.manifest)))) {
    throw new Error('SOP resource disable generated view requires its consumption lock');
  }
  return Object.freeze({
    ...legacy,
    views: {
      sopUnified: { contract_set_id: unified.contract_set_id, schema_count: unified.schema_count },
      ...(resource ? { sopResourceDisable: { contract_set_id: resource.contract_set_id, schema_count: resource.schema_count } } : {}),
    },
    files: new Map([...legacy.files, ...unified.files, ...(resource?.files ?? [])]),
  });
}

async function buildResourceDisableView(projectRoot) {
  const verified = verifyIngestedSopResourceDisableContractSet({ projectRoot });
  const manifestBytes = readFileSync(path.join(verified.path, 'contract-set.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const source = readFileSync(path.join(verified.path, manifest.openapi.file));
  if (source.length !== manifest.openapi.bytes || sha256(source) !== verified.openapi_sha256) {
    throw new Error('SOP resource disable source byte drift');
  }
  return buildGeneratedArtifactsFromSnapshot({
    ...verified, lock: verified, manifest, openapi_source: source.toString('utf8'),
  }, {
    outputs: SOP_RESOURCE_OUTPUTS,
    view: 'sop-resource-disable',
    provenance: {
      view: 'sopResourceDisable',
      source_manifest: { sha256: sha256(manifestBytes), bytes: manifestBytes.length },
      source_artifacts: { openapi: manifest.openapi, database: manifest.database,
        ...manifest.resourceDisable, legacyV11: manifest.legacyV11 },
    },
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

  for (const directory of expectedByDirectory.keys()) {
    const parent = path.dirname(directory);
    if (expectedByDirectory.has(parent)) expectedByDirectory.get(parent).push(path.basename(directory));
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

export async function generateContracts({ projectRoot = DEFAULT_PROJECT_ROOT, check = false, profile } = {}) {
  if (profile !== undefined && profile !== 'sopResourceDisable') throw new Error('Unsupported contract codegen profile');
  const resolvedRoot = path.resolve(projectRoot);
  return withVerifiedContractSetSnapshot({ projectRoot: resolvedRoot }, async (snapshot) => {
    const generated = profile === 'sopResourceDisable'
      ? await buildResourceDisableView(resolvedRoot) : await buildSnapshotViews(resolvedRoot, snapshot);
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
      ...(generated.views ? { views: generated.views } : {}),
      files: [...generated.files.keys()],
    });
  });
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => !['--check', '--profile=sopResourceDisable'].includes(argument))) {
    throw new Error(`Unknown contract codegen option: ${arguments_.find((argument) => !['--check', '--profile=sopResourceDisable'].includes(argument))}`);
  }
  const result = await generateContracts({ check: arguments_.includes('--check'),
    profile: arguments_.includes('--profile=sopResourceDisable') ? 'sopResourceDisable' : undefined });
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
