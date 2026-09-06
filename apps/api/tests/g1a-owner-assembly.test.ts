import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleG1aOwnerPackage } from './support/g1a-e0/assemble-package.js';
import { jsonLine, sha256, type JsonValue } from './support/g1a-e0/content-identity.js';
import { readG1aEvaluationPackage } from './support/g1a-e0/input-package.js';
import { createSyntheticG1aE0Package } from './support/g1a-e0/synthetic-package.js';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function fixture() {
  const now = new Date();
  const original = await createSyntheticG1aE0Package(now, true, true); cleanup.push(original.cleanup);
  const parsed = await readG1aEvaluationPackage(original.inputRoot, { repositoryRoot, ...original, now });
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'g1a-assembly-test-')));
  await chmod(parent, 0o700); cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const manifest = { ...parsed.manifest } as Record<string, JsonValue>;
  for (const key of ['schema', 'files', 'content_snapshot_sha256', 'source_binding_hash']) delete manifest[key];
  const content = parsed.content.map((source) => {
    const item = { ...source } as Record<string, JsonValue>;
    for (const key of ['content_hash', 'review_mode', 'primary_reviewer_id_hash', 'primary_reviewer_role',
      'primary_review_evd', 'secondary_reviewer_id_hash', 'secondary_reviewer_role', 'secondary_review_evd',
      'owner_acceptance_record_sha256']) delete item[key];
    item.questions = source.questions.map((q) => {
      const question = { ...q } as Record<string, JsonValue>; delete question.question_hash; return question;
    });
    return item;
  });
  const assembly = { schema: 'customer-agent/g1a-owner-assembly/v1', manifest, content,
    cases: parsed.cases, expectations: parsed.expectations };
  const input = await realpath(await mkdtemp(path.join(parent, 'draft-')));
  await writeFile(path.join(input, 'owner-acceptance.json'), parsed.owner_acceptance!.raw_record, { mode: 0o600 });
  async function options() {
    const bytes = jsonLine(assembly);
    await writeFile(path.join(input, 'assembly.json'), bytes, { mode: 0o600 });
    return { repositoryRoot, inputRoot: input, outputParent: parent, now,
      expectedAssemblySha256: sha256(bytes), expectedOwnerAcceptanceSha256: original.expectedOwnerAcceptanceSha256!,
      expectedOwnerSubjectHash: original.expectedOwnerSubjectHash! };
  }
  return { parent, input, original, parsed, assembly, options };
}

describe.skipIf(process.platform === 'win32')('versioned owner package assembler', () => {
  it('round-trips actual normalized content to the identical approved five files in unique directories', async () => {
    const f = await fixture(); const opts = await f.options();
    const first = await assembleG1aOwnerPackage(opts); const second = await assembleG1aOwnerPackage(opts);
    expect(first.inputRoot).not.toBe(second.inputRoot);
    expect(first.expectedManifestSha256).toBe(f.original.expectedManifestSha256);
    for (const name of await readdir(f.original.inputRoot)) {
      expect(await readFile(path.join(first.inputRoot, name))).toEqual(await readFile(path.join(f.original.inputRoot, name)));
    }
    const actual = await readG1aEvaluationPackage(first.inputRoot, { ...opts, ...first });
    expect(actual.content).toEqual(f.parsed.content);
    expect(actual.cases).toHaveLength(50);
  });
  it('runs the operator entry with synthetic external files and emits only a receipt', async () => {
    const f = await fixture(); const opts = await f.options();
    const { stdout } = await promisify(execFile)(process.execPath,
      [path.resolve(import.meta.dirname, '../node_modules/vitest/vitest.mjs'), 'run', 'tests/g1a-owner-assembly.runner.test.ts'],
      { cwd: path.resolve(import.meta.dirname, '..'), timeout: 15_000, env: { ...process.env,
        CUSTOMER_AGENT_G1A_ASSEMBLE: '1', CUSTOMER_AGENT_G1A_ASSEMBLY_INPUT: opts.inputRoot,
        CUSTOMER_AGENT_G1A_ASSEMBLY_OUTPUT_PARENT: opts.outputParent,
        CUSTOMER_AGENT_G1A_ASSEMBLY_SHA256: opts.expectedAssemblySha256,
        CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256: opts.expectedOwnerAcceptanceSha256,
        CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH: opts.expectedOwnerSubjectHash } });
    expect(stdout).toContain('ASSEMBLED_NOT_EVALUATED');
    expect(stdout).not.toContain(String(f.assembly.content[0]!.answer_text));
    expect((await readdir(f.parent)).filter((name) => name.startsWith('g1a-owner-v3-'))).toHaveLength(1);
  }, 20_000);
  it.each(['parent_permissions', 'input_alias', 'extra_file'])('rejects %s before publication', async (scenario) => {
    const f = await fixture(); const opts = await f.options();
    if (scenario === 'parent_permissions') await chmod(f.parent, 0o755);
    if (scenario === 'input_alias') {
      const alias = path.join(f.parent, 'alias'); await symlink(f.input, alias); opts.inputRoot = alias;
    }
    if (scenario === 'extra_file') await writeFile(path.join(f.input, 'extra.json'), '{}', { mode: 0o600 });
    await expect(assembleG1aOwnerPackage(opts)).rejects.toThrow('G1A_ASSEMBLY_INVALID');
    expect((await readdir(f.parent)).filter((name) => name.startsWith('g1a-owner-v3-'))).toHaveLength(0);
  });
  it.each(['draft_anchor', 'owner_anchor', 'owner_subject', 'body', 'conflict', 'expiry', 'metadata',
    'derived_content', 'derived_question', 'derived_manifest', 'extra_item', 'missing_item', 'permissions'])(
    'rejects %s and leaves the original and parent unchanged', async (scenario) => {
      const f = await fixture();
      if (scenario === 'body') f.assembly.content[0]!.answer_text = '纯合成但未批准的改写';
      if (scenario === 'conflict') f.assembly.content[0]!.has_conflict = true;
      if (scenario === 'expiry') f.assembly.manifest.expires_at = '2020-01-01T00:00:00.000Z';
      if (scenario === 'metadata') f.assembly.manifest.unexpected = true;
      if (scenario === 'derived_content') f.assembly.content[0]!.content_hash = '0'.repeat(64);
      if (scenario === 'derived_question') (f.assembly.content[0]!.questions as Record<string, JsonValue>[])[0]!.question_hash = '0'.repeat(64);
      if (scenario === 'derived_manifest') f.assembly.manifest.files = {};
      if (scenario === 'extra_item') f.assembly.content.push({ ...f.assembly.content[0]! });
      if (scenario === 'missing_item') f.assembly.content.pop();
      const opts = await f.options();
      if (scenario === 'draft_anchor') opts.expectedAssemblySha256 = '0'.repeat(64);
      if (scenario === 'owner_anchor') opts.expectedOwnerAcceptanceSha256 = '0'.repeat(64);
      if (scenario === 'owner_subject') opts.expectedOwnerSubjectHash = '0'.repeat(64);
      if (scenario === 'permissions') await chmod(path.join(f.input, 'assembly.json'), 0o644);
      const before = await readdir(f.parent);
      await expect(assembleG1aOwnerPackage(opts)).rejects.toThrow();
      expect(await readdir(f.parent)).toEqual(before);
      expect(sha256(await readFile(path.join(f.original.inputRoot, 'manifest.json')))).toBe(f.original.expectedManifestSha256);
    },
  );
});
