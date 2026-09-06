import { validateContractSchema, type components } from '@customer-agent/contracts';
import { lstat, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { governanceHash, jsonLine, jsonLines, questionHash, sha256, type JsonValue } from './content-identity.js';
import { readG1aEvaluationPackage, readSecureMember } from './input-package.js';

const DERIVED_CONTENT = ['content_hash', 'review_mode', 'primary_reviewer_id_hash', 'primary_reviewer_role',
  'primary_review_evd', 'secondary_reviewer_id_hash', 'secondary_reviewer_role', 'secondary_review_evd',
  'owner_acceptance_record_sha256'];
const DERIVED_MANIFEST = ['schema', 'files', 'content_snapshot_sha256', 'source_binding_hash'];
const DIGEST = /^[0-9a-f]{64}$/;
function invalid(): never { throw new Error('G1A_ASSEMBLY_INVALID'); }
function record(value: JsonValue | undefined): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, JsonValue>;
}
function rows(value: JsonValue | undefined): Record<string, JsonValue>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100_000) invalid();
  return value.map(record);
}
function omitDerived(value: Record<string, JsonValue>, keys: readonly string[]): void {
  if (keys.some((key) => Object.hasOwn(value, key))) invalid();
}
function parseCanonical(bytes: Buffer): Record<string, JsonValue> {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = record(JSON.parse(text) as JsonValue);
    if (jsonLine(value) !== text) invalid();
    return value;
  } catch { invalid(); }
}
async function privateRoot(root: string, repositoryRoot: string): Promise<string> {
  if (process.platform === 'win32' || !path.isAbsolute(root) || !path.isAbsolute(repositoryRoot)
    || root.split(path.sep).includes('..')) invalid();
  const resolved = path.resolve(root);
  const stat = await lstat(resolved);
  const repo = await realpath(repositoryRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!()
    || (stat.mode & 0o777) !== 0o700 || await realpath(resolved) !== resolved
    || resolved === repo || resolved.startsWith(`${repo}${path.sep}`) || repo.startsWith(`${resolved}${path.sep}`)) invalid();
  return resolved;
}

export type AssembleG1aPackageOptions = Readonly<{
  repositoryRoot: string; inputRoot: string; outputParent: string;
  expectedAssemblySha256: string; expectedOwnerAcceptanceSha256: string; expectedOwnerSubjectHash: string;
  now?: Date;
}>;

/**
 * Consumes assembly.json and owner-acceptance.json from a private external directory.
 * The caller supplies independently obtained anchors. No approval or time is invented.
 * Returns only after the unique new directory passes the production-equivalent input reader;
 * on failure removes only that newly created directory, never a historical package.
 */
export async function assembleG1aOwnerPackage(options: AssembleG1aPackageOptions): Promise<Readonly<{
  inputRoot: string; expectedManifestSha256: string;
}>> {
  if (![options.expectedAssemblySha256, options.expectedOwnerAcceptanceSha256, options.expectedOwnerSubjectHash]
    .every((value) => DIGEST.test(value))) invalid();
  const input = await privateRoot(options.inputRoot, options.repositoryRoot);
  const parent = await privateRoot(options.outputParent, options.repositoryRoot);
  if ((await readdir(input)).sort().join('|') !== 'assembly.json|owner-acceptance.json') invalid();
  const assemblyBytes = await readSecureMember(input, 'assembly.json', 35 * 1024 * 1024);
  const ownerBytes = await readSecureMember(input, 'owner-acceptance.json', 2 * 1024 * 1024);
  if (sha256(assemblyBytes) !== options.expectedAssemblySha256
    || sha256(ownerBytes) !== options.expectedOwnerAcceptanceSha256) invalid();
  const assembly = parseCanonical(assemblyBytes);
  if (Object.keys(assembly).sort().join('|') !== 'cases|content|expectations|manifest|schema'
    || assembly.schema !== 'customer-agent/g1a-owner-assembly/v1') invalid();
  const owner = parseCanonical(ownerBytes);
  if (!validateContractSchema('OwnerAcceptanceRecord', owner).ok) invalid();
  const acceptance = owner as unknown as components['schemas']['OwnerAcceptanceRecord'];
  if (acceptance.owner_subject_hash !== options.expectedOwnerSubjectHash) invalid();
  const manifest = record(assembly.manifest);
  omitDerived(manifest, DERIVED_MANIFEST);
  const bindings = rows(manifest.source_bindings);
  const content = rows(assembly.content).map((draft) => {
    omitDerived(draft, DERIVED_CONTENT);
    const binding = bindings.find((candidate) => candidate.domain === draft.domain
      && candidate.source_version_id === draft.source_version_id);
    if (!binding || typeof binding.source_ref !== 'string') invalid();
    const questions = rows(draft.questions).map((question) => {
      omitDerived(question, ['question_hash']);
      return { ...question, question_hash: questionHash(question) };
    });
    const item = { ...draft, questions, review_mode: 'owner_acceptance',
      primary_reviewer_id_hash: acceptance.owner_subject_hash, primary_reviewer_role: 'ROLE-CONTENT-LEAD',
      primary_review_evd: acceptance.approval_evidence_id,
      secondary_reviewer_id_hash: null, secondary_reviewer_role: null, secondary_review_evd: null,
      owner_acceptance_record_sha256: options.expectedOwnerAcceptanceSha256 };
    return { ...item, content_hash: governanceHash(item, binding.source_ref) };
  });
  const cases = rows(assembly.cases); const expectations = rows(assembly.expectations);
  const payload = { 'content.jsonl': jsonLines(content), 'cases.jsonl': jsonLines(cases),
    'expectations.jsonl': jsonLines(expectations), 'owner-acceptance.json': ownerBytes.toString('utf8') };
  const counts = { 'content.jsonl': content.length, 'cases.jsonl': cases.length,
    'expectations.jsonl': expectations.length, 'owner-acceptance.json': 1 };
  const manifestText = jsonLine({ ...manifest, schema: 'customer-agent/g1a-evaluation-manifest/v3',
    content_snapshot_sha256: sha256(payload['content.jsonl']),
    source_binding_hash: sha256(bindings.map((binding) => `${String(binding.domain)}:${String(binding.source_version_id)}`).join('|')),
    files: Object.fromEntries(Object.entries(payload).map(([name, bytes]) => [name, {
      sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), records: counts[name as keyof typeof counts],
    }])),
  });
  const expectedManifestSha256 = sha256(manifestText);
  const output = await mkdtemp(path.join(parent, 'g1a-owner-v3-'));
  try {
    for (const [name, text] of Object.entries({ ...payload, 'manifest.json': manifestText })) {
      await writeFile(path.join(output, name), text, { flag: 'wx', mode: 0o600 });
    }
    await readG1aEvaluationPackage(output, { repositoryRoot: options.repositoryRoot, expectedManifestSha256,
      expectedOwnerAcceptanceSha256: options.expectedOwnerAcceptanceSha256,
      expectedOwnerSubjectHash: options.expectedOwnerSubjectHash, ...(options.now ? { now: options.now } : {}) });
    return Object.freeze({ inputRoot: output, expectedManifestSha256 });
  } catch (error: unknown) {
    try { await rm(output, { recursive: true, force: false }); }
    catch { throw new Error('G1A_ASSEMBLY_CLEANUP_FAILED'); }
    throw error;
  }
}
