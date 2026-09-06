import { createHash } from 'node:crypto';
import { chmod, link, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  g1aComparisonManifestSha256,
  G1aInputError,
  readG1aEvaluationPackage,
} from './support/g1a-e0/input-package.js';
import { createSyntheticG1aE0Package } from './support/g1a-e0/synthetic-package.js';

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type MutableRecord = Record<string, unknown>;

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function jcs(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  const record = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${jcs(record[key]!)}`).join(',')}}`;
}

async function fixture() {
  const created = await createSyntheticG1aE0Package();
  cleanups.push(created.cleanup);
  return created;
}

async function rewriteManifest(
  inputRoot: string,
  mutate: (manifest: MutableRecord) => void,
): Promise<string> {
  const manifestPath = path.join(inputRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as MutableRecord;
  mutate(manifest);
  const text = `${jcs(manifest as JsonValue)}\n`;
  await writeFile(manifestPath, text, { encoding: 'utf8', mode: 0o600 });
  await chmod(manifestPath, 0o600);
  return sha256(text);
}

async function rewritePayload(
  inputRoot: string,
  name: 'content.jsonl' | 'cases.jsonl' | 'expectations.jsonl',
  mutate: (rows: MutableRecord[]) => void,
): Promise<string> {
  const payloadPath = path.join(inputRoot, name);
  const rows = (await readFile(payloadPath, 'utf8')).trimEnd().split('\n')
    .map((line) => JSON.parse(line) as MutableRecord);
  mutate(rows);
  const text = `${rows.map((row) => jcs(row as JsonValue)).join('\n')}\n`;
  await writeFile(payloadPath, text, { encoding: 'utf8', mode: 0o600 });
  await chmod(payloadPath, 0o600);
  return rewriteManifest(inputRoot, (manifest) => {
    const files = manifest.files as MutableRecord;
    files[name] = { sha256: sha256(text), bytes: Buffer.byteLength(text), records: rows.length };
    if (name === 'content.jsonl') manifest.content_snapshot_sha256 = sha256(text);
  });
}

async function rewriteRawPayload(
  inputRoot: string,
  name: 'content.jsonl' | 'cases.jsonl' | 'expectations.jsonl',
  bytes: string | Buffer,
): Promise<string> {
  const payloadPath = path.join(inputRoot, name);
  await writeFile(payloadPath, bytes, { mode: 0o600 });
  await chmod(payloadPath, 0o600);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return rewriteManifest(inputRoot, (manifest) => {
    const files = manifest.files as MutableRecord;
    const descriptor = files[name] as MutableRecord;
    descriptor.sha256 = sha256(buffer);
    descriptor.bytes = buffer.byteLength;
    if (name === 'content.jsonl') manifest.content_snapshot_sha256 = sha256(buffer);
  });
}

function refreshComparisonManifestHash(comparison: MutableRecord): void {
  comparison.manifest_sha256 = g1aComparisonManifestSha256(
    comparison.set as 'dev_synthetic' | 'train' | 'g1b',
    comparison.status as 'PRESENT' | 'NOT_PRESENT',
    comparison.sample_ids as string[],
    comparison.source_ids as string[],
    comparison.semantic_cluster_ids as string[],
  );
}

async function expectInputError(
  action: () => Promise<unknown>,
  code: G1aInputError['code'],
): Promise<G1aInputError> {
  try {
    await action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(G1aInputError);
    expect(error).toMatchObject({ code, message: code });
    return error as G1aInputError;
  }
  throw new Error('EXPECTED_G1A_INPUT_ERROR');
}

describe('G1A-E0 input package boundary', () => {
  it.each([
    { label: 'low with risk category', risk_level: 'low', risk_categories: ['campaign_rules'] },
    { label: 'medium with risk category', risk_level: 'medium', risk_categories: ['campaign_rules'] },
    { label: 'high without risk category', risk_level: 'high', risk_categories: [] },
    { label: 'high with single review', risk_level: 'high', risk_categories: ['campaign_rules'], review_mode: 'single' },
    { label: 'same-subject dual review', secondary_reviewer_id_hash: 'a'.repeat(64) },
  ])('rejects $label before database loading', async ({ label: _label, ...changes }) => {
    const created = await fixture();
    const anchor = await rewritePayload(created.inputRoot, 'content.jsonl', (rows) => {
      Object.assign(rows[0]!, {
        risk_level: 'high', risk_categories: ['campaign_rules'], has_conflict: false,
        review_mode: 'dual', primary_reviewer_id_hash: 'a'.repeat(64),
        secondary_reviewer_id_hash: 'b'.repeat(64), secondary_reviewer_role: 'ROLE-CS-MANAGER',
        secondary_review_evd: 'EVD-SYNTHETIC-SECOND-REVIEW',
      }, changes);
      if (changes.risk_level === 'low' || changes.risk_level === 'medium') {
        Object.assign(rows[0]!, { review_mode: 'single', secondary_reviewer_id_hash: null,
          secondary_reviewer_role: null, secondary_review_evd: null });
      }
    });
    await expectInputError(() => readG1aEvaluationPackage(created.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT, expectedManifestSha256: anchor,
    }), 'G1A_INPUT_CONTENT_INVALID');
  });

  it.each(['low', 'medium', 'high'] as const)('accepts schema-valid %s risk/review shape', async (level) => {
    const created = await fixture();
    const anchor = await rewritePayload(created.inputRoot, 'content.jsonl', (rows) => {
      Object.assign(rows[0]!, { risk_level: level, risk_categories: level === 'high' ? ['campaign_rules'] : [] });
      if (level === 'high') Object.assign(rows[0]!, { review_mode: 'dual',
        primary_reviewer_id_hash: 'a'.repeat(64), secondary_reviewer_id_hash: 'b'.repeat(64),
        secondary_reviewer_role: 'ROLE-CS-MANAGER', secondary_review_evd: 'EVD-SYNTHETIC-SECOND-REVIEW' });
    });
    // Input shape only: this does not certify governance hashes or reviewer identity.
    const parsed = await readG1aEvaluationPackage(created.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT, expectedManifestSha256: anchor,
    });
    expect(parsed.content[0]?.risk_level).toBe(level);
  });

  it('rejects a campaign without an end date before database loading', async () => {
    const created = await fixture();
    const anchor = await rewritePayload(created.inputRoot, 'content.jsonl', (rows) => {
      const campaign = rows.find((row) => row.domain === 'campaign');
      expect(campaign).toBeDefined();
      campaign!.effective_to = null;
    });
    await expectInputError(() => readG1aEvaluationPackage(created.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT, expectedManifestSha256: anchor,
    }), 'G1A_INPUT_CONTENT_INVALID');
  });

  it('accepts the exact off-repo synthetic substitute with an external manifest anchor', async () => {
    const packageFixture = await fixture();
    const verified = await readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: packageFixture.expectedManifestSha256,
    });

    expect(verified).toMatchObject({
      manifest_sha256: packageFixture.expectedManifestSha256,
      manifest: {
        schema: 'customer-agent/g1a-evaluation-manifest/v2',
        classification: 'synthetic',
        purpose: 'g1a_search_eval_only',
        comparison_sets: [
          { set: 'dev_synthetic', status: 'PRESENT' },
          { set: 'train', status: 'NOT_PRESENT', sample_ids: [], source_ids: [], semantic_cluster_ids: [] },
          { set: 'g1b', status: 'NOT_PRESENT', sample_ids: [], source_ids: [], semantic_cluster_ids: [] },
        ],
      },
    });
    expect(verified.cases).toHaveLength(50);
    expect(verified.expectations).toHaveLength(50);
    expect(verified.content.some((item) => item.questions.length > 1)).toBe(true);
  });

  it('binds comparison status into the v2 canonical empty-set hash', () => {
    expect(g1aComparisonManifestSha256('train', 'NOT_PRESENT', [], [], []))
      .not.toBe(g1aComparisonManifestSha256('train', 'PRESENT', [], [], []));
  });

  it('rejects the legacy outer manifest schema instead of reinterpreting v1', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      manifest.schema = 'customer-agent/g1a-evaluation-manifest/v1';
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_MANIFEST_INVALID');
  });

  it('rejects a wrong external manifest hash before touching an insecure payload', async () => {
    const packageFixture = await fixture();
    await chmod(path.join(packageFixture.inputRoot, 'content.jsonl'), 0o000);

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: 'f'.repeat(64),
    }), 'G1A_INPUT_HASH_MISMATCH');
  });

  it('proves blind-review independence using subject hashes', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      manifest.blind_reviewer_subject_hash = manifest.implementer_subject_hash;
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('computes actual dataset overlap instead of trusting a zero assertion', async () => {
    const packageFixture = await fixture();
    const firstCase = JSON.parse((await readFile(path.join(packageFixture.inputRoot, 'cases.jsonl'), 'utf8')).split('\n')[0]!) as MutableRecord;
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const comparisons = manifest.comparison_sets as MutableRecord[];
      comparisons[0]!.sample_ids = [firstCase.case_id];
      refreshComparisonManifestHash(comparisons[0]!);
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('computes source overlap from frozen case provenance', async () => {
    const packageFixture = await fixture();
    const firstCase = JSON.parse((await readFile(path.join(packageFixture.inputRoot, 'cases.jsonl'), 'utf8')).split('\n')[0]!) as MutableRecord;
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const comparisons = manifest.comparison_sets as MutableRecord[];
      comparisons[0]!.source_ids = [...(firstCase.source_asset_ids as string[])];
      refreshComparisonManifestHash(comparisons[0]!);
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('rejects overlapping acceptable and forbidden result sets', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewritePayload(packageFixture.inputRoot, 'expectations.jsonl', (rows) => {
      rows[0]!.forbidden_script_ids = [...(rows[0]!.acceptable_script_ids as string[])];
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_EXPECTATION_INVALID');
  });

  it('enforces the 500 Unicode-code-point query contract', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewritePayload(packageFixture.inputRoot, 'cases.jsonl', (rows) => {
      rows[0]!.query_text = '问'.repeat(501);
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_CASE_INVALID');
  });

  it('binds every comparison list to its frozen manifest hash', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const comparisons = manifest.comparison_sets as MutableRecord[];
      comparisons[1]!.status = 'PRESENT';
      comparisons[1]!.sample_ids = ['comparison_train_sample'];
      comparisons[1]!.source_ids = ['comparison_train_source'];
      comparisons[1]!.semantic_cluster_ids = ['comparison_train_cluster'];
      refreshComparisonManifestHash(comparisons[1]!);
      comparisons[1]!.sample_ids = ['comparison_train_replaced'];
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('computes semantic-cluster overlap from the frozen comparison lists', async () => {
    const packageFixture = await fixture();
    const firstCase = JSON.parse((await readFile(path.join(packageFixture.inputRoot, 'cases.jsonl'), 'utf8')).split('\n')[0]!) as MutableRecord;
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const comparisons = manifest.comparison_sets as MutableRecord[];
      comparisons[2]!.status = 'PRESENT';
      comparisons[2]!.sample_ids = ['comparison_g1b_sample'];
      comparisons[2]!.source_ids = ['comparison_g1b_source'];
      comparisons[2]!.semantic_cluster_ids = [firstCase.semantic_cluster_id];
      refreshComparisonManifestHash(comparisons[2]!);
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('accepts PRESENT train only when all three identifier axes are populated and hash-bound', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const train = (manifest.comparison_sets as MutableRecord[])[1]!;
      train.status = 'PRESENT';
      train.sample_ids = ['comparison_train_sample'];
      train.source_ids = ['comparison_train_source'];
      train.semantic_cluster_ids = ['comparison_train_cluster'];
      refreshComparisonManifestHash(train);
    });

    const verified = await readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    });
    expect(verified.manifest.comparison_sets[1]).toMatchObject({
      set: 'train',
      status: 'PRESENT',
      sample_ids: ['comparison_train_sample'],
      source_ids: ['comparison_train_source'],
      semantic_cluster_ids: ['comparison_train_cluster'],
    });
  });

  it('rejects NOT_PRESENT comparisons carrying identifiers even with a refreshed hash', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const train = (manifest.comparison_sets as MutableRecord[])[1]!;
      train.sample_ids = ['comparison_train_fabricated'];
      refreshComparisonManifestHash(train);
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('rejects PRESENT comparisons with an empty axis even with a refreshed hash', async () => {
    const packageFixture = await fixture();
    const expectedManifestSha256 = await rewriteManifest(packageFixture.inputRoot, (manifest) => {
      const train = (manifest.comparison_sets as MutableRecord[])[1]!;
      train.status = 'PRESENT';
      train.sample_ids = ['comparison_train_sample'];
      train.source_ids = ['comparison_train_source'];
      train.semantic_cluster_ids = [];
      refreshComparisonManifestHash(train);
    });

    await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('rejects NOT_PRESENT dev_synthetic and missing or unknown comparison statuses', async () => {
    const absentDevFixture = await fixture();
    const absentDevAnchor = await rewriteManifest(absentDevFixture.inputRoot, (manifest) => {
      const devSynthetic = (manifest.comparison_sets as MutableRecord[])[0]!;
      devSynthetic.status = 'NOT_PRESENT';
      devSynthetic.sample_ids = [];
      devSynthetic.source_ids = [];
      devSynthetic.semantic_cluster_ids = [];
      refreshComparisonManifestHash(devSynthetic);
    });
    await expectInputError(() => readG1aEvaluationPackage(absentDevFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: absentDevAnchor,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');

    const missingStatusFixture = await fixture();
    const missingStatusAnchor = await rewriteManifest(missingStatusFixture.inputRoot, (manifest) => {
      delete (manifest.comparison_sets as MutableRecord[])[1]!.status;
    });
    await expectInputError(() => readG1aEvaluationPackage(missingStatusFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: missingStatusAnchor,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');

    const unknownStatusFixture = await fixture();
    const unknownStatusAnchor = await rewriteManifest(unknownStatusFixture.inputRoot, (manifest) => {
      (manifest.comparison_sets as MutableRecord[])[2]!.status = 'UNKNOWN';
    });
    await expectInputError(() => readG1aEvaluationPackage(unknownStatusFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: unknownStatusAnchor,
    }), 'G1A_INPUT_INDEPENDENCE_INVALID');
  });

  it('rejects unknown package members and unknown row fields', async () => {
    const memberFixture = await fixture();
    await writeFile(path.join(memberFixture.inputRoot, 'unexpected.txt'), 'synthetic\n', { mode: 0o600 });
    await expectInputError(() => readG1aEvaluationPackage(memberFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: memberFixture.expectedManifestSha256,
    }), 'G1A_INPUT_MEMBER_SET_INVALID');

    const shapeFixture = await fixture();
    const expectedManifestSha256 = await rewritePayload(shapeFixture.inputRoot, 'cases.jsonl', (rows) => {
      rows[0]!.unexpected = true;
    });
    await expectInputError(() => readG1aEvaluationPackage(shapeFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_CASE_INVALID');
  });

  it('rejects BOM and CRLF payloads even when their descriptors are refreshed', async () => {
    const bomFixture = await fixture();
    const cases = await readFile(path.join(bomFixture.inputRoot, 'cases.jsonl'));
    const bomAnchor = await rewriteRawPayload(
      bomFixture.inputRoot,
      'cases.jsonl',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), cases]),
    );
    await expectInputError(() => readG1aEvaluationPackage(bomFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: bomAnchor,
    }), 'G1A_INPUT_FORMAT_INVALID');

    const crlfFixture = await fixture();
    const expectations = await readFile(path.join(crlfFixture.inputRoot, 'expectations.jsonl'), 'utf8');
    const crlfAnchor = await rewriteRawPayload(
      crlfFixture.inputRoot,
      'expectations.jsonl',
      expectations.replaceAll('\n', '\r\n'),
    );
    await expectInputError(() => readG1aEvaluationPackage(crlfFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: crlfAnchor,
    }), 'G1A_INPUT_FORMAT_INVALID');
  });

  it('rejects oversized members and payload bytes that drift from the descriptor', async () => {
    const sizeFixture = await fixture();
    const oversized = Buffer.alloc((64 * 1024) + 1, 0x61);
    await writeFile(path.join(sizeFixture.inputRoot, 'manifest.json'), oversized, { mode: 0o600 });
    await chmod(path.join(sizeFixture.inputRoot, 'manifest.json'), 0o600);
    await expectInputError(() => readG1aEvaluationPackage(sizeFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: sha256(oversized),
    }), 'G1A_INPUT_SIZE_INVALID');

    const hashFixture = await fixture();
    const contentPath = path.join(hashFixture.inputRoot, 'content.jsonl');
    const content = await readFile(contentPath, 'utf8');
    await writeFile(contentPath, content.replace('纯合成回答', '仿合成回答'), { mode: 0o600 });
    await chmod(contentPath, 0o600);
    await expectInputError(() => readG1aEvaluationPackage(hashFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: hashFixture.expectedManifestSha256,
    }), 'G1A_INPUT_HASH_MISMATCH');
  });

  it('rejects expired packages, missing EVDs, and a changed 20+12+18 denominator', async () => {
    const expiredFixture = await fixture();
    const expiredAnchor = await rewriteManifest(expiredFixture.inputRoot, (manifest) => {
      manifest.expires_at = new Date(Date.now() - 1_000).toISOString();
    });
    await expectInputError(() => readG1aEvaluationPackage(expiredFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: expiredAnchor,
    }), 'G1A_INPUT_MANIFEST_INVALID');

    const evdFixture = await fixture();
    const evdAnchor = await rewriteManifest(evdFixture.inputRoot, (manifest) => {
      manifest.dlp_evidence_id = '';
    });
    await expectInputError(() => readG1aEvaluationPackage(evdFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: evdAnchor,
    }), 'G1A_INPUT_MANIFEST_INVALID');

    const denominatorFixture = await fixture();
    await rewritePayload(denominatorFixture.inputRoot, 'cases.jsonl', (rows) => { rows.pop(); });
    const denominatorAnchor = await rewritePayload(
      denominatorFixture.inputRoot,
      'expectations.jsonl',
      (rows) => { rows.pop(); },
    );
    await expectInputError(() => readG1aEvaluationPackage(denominatorFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: denominatorAnchor,
    }), 'G1A_INPUT_DENOMINATOR_INVALID');
  });

  it('rejects duplicate case IDs and PII-shaped opaque IDs', async () => {
    const duplicateFixture = await fixture();
    await rewritePayload(duplicateFixture.inputRoot, 'cases.jsonl', (rows) => {
      rows[1]!.case_id = rows[0]!.case_id;
    });
    const duplicateAnchor = await rewritePayload(duplicateFixture.inputRoot, 'expectations.jsonl', (rows) => {
      rows[1]!.case_id = rows[0]!.case_id;
    });
    await expectInputError(() => readG1aEvaluationPackage(duplicateFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: duplicateAnchor,
    }), 'G1A_INPUT_EXPECTATION_INVALID');

    const piiFixture = await fixture();
    const piiShapedId = `script_${['138', '0013', '8000'].join('-')}`;
    const piiAnchor = await rewritePayload(piiFixture.inputRoot, 'content.jsonl', (rows) => {
      rows[0]!.script_id = piiShapedId;
    });
    await expectInputError(() => readG1aEvaluationPackage(piiFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: piiAnchor,
    }), 'G1A_INPUT_LEAK_CANARY');
  });

  it('rejects payload symlinks, hard links, and loose permissions', async () => {
    const symlinkFixture = await fixture();
    const contentPath = path.join(symlinkFixture.inputRoot, 'content.jsonl');
    const movedPath = path.join(os.tmpdir(), `g1a-e0-symlink-${process.pid}-${Date.now()}`);
    await rename(contentPath, movedPath);
    cleanups.push(() => unlink(movedPath).catch(() => undefined));
    await symlink(movedPath, contentPath);
    await expectInputError(() => readG1aEvaluationPackage(symlinkFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: symlinkFixture.expectedManifestSha256,
    }), 'G1A_INPUT_MEMBER_INSECURE');

    const hardLinkFixture = await fixture();
    const casesPath = path.join(hardLinkFixture.inputRoot, 'cases.jsonl');
    const external = path.join(os.tmpdir(), `g1a-e0-hardlink-${process.pid}-${Date.now()}`);
    await rename(casesPath, external);
    cleanups.push(() => unlink(external).catch(() => undefined));
    await link(external, casesPath);
    await expectInputError(() => readG1aEvaluationPackage(hardLinkFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: hardLinkFixture.expectedManifestSha256,
    }), 'G1A_INPUT_MEMBER_INSECURE');

    const modeFixture = await fixture();
    await chmod(path.join(modeFixture.inputRoot, 'expectations.jsonl'), 0o644);
    await expectInputError(() => readG1aEvaluationPackage(modeFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256: modeFixture.expectedManifestSha256,
    }), 'G1A_INPUT_MEMBER_INSECURE');
  });

  it('returns only a stable error code when a leak canary is detected', async () => {
    const packageFixture = await fixture();
    const canary = `客户手机号 +86 ${['138', '0000', '1234'].join('-')}`;
    const expectedManifestSha256 = await rewritePayload(packageFixture.inputRoot, 'content.jsonl', (rows) => {
      rows[0]!.title = canary;
    });

    const error = await expectInputError(() => readG1aEvaluationPackage(packageFixture.inputRoot, {
      repositoryRoot: REPOSITORY_ROOT,
      expectedManifestSha256,
    }), 'G1A_INPUT_LEAK_CANARY');
    expect(String(error)).not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
  });
});


describe('owner acceptance external anchors', () => {
  async function ownerFixture() {
    const created = await createSyntheticG1aE0Package(new Date(), true, true);
    cleanups.push(created.cleanup);
    return created;
  }
  it('accepts the exact externally anchored owner scope including high risk', async () => {
    const f = await ownerFixture();
    const input = await readG1aEvaluationPackage(f.inputRoot, { ...f, repositoryRoot: REPOSITORY_ROOT });
    expect(input.manifest.schema).toBe('customer-agent/g1a-evaluation-manifest/v3');
    expect(input.content[0]?.risk_level).toBe('high');
    expect(input.owner_acceptance?.record_sha256).toBe(f.expectedOwnerAcceptanceSha256);
  });
  it('rejects absent and mismatched independent approval anchors', async () => {
    const f = await ownerFixture();
    for (const anchors of [{}, { expectedOwnerAcceptanceSha256: '0'.repeat(64), expectedOwnerSubjectHash: f.expectedOwnerSubjectHash! },
      { expectedOwnerAcceptanceSha256: f.expectedOwnerAcceptanceSha256!, expectedOwnerSubjectHash: '0'.repeat(64) }]) {
      await expect(readG1aEvaluationPackage(f.inputRoot, { repositoryRoot: REPOSITORY_ROOT,
        expectedManifestSha256: f.expectedManifestSha256, ...anchors })).rejects.toMatchObject({ code: 'G1A_INPUT_OWNER_ACCEPTANCE_INVALID' });
    }
  });
  it.each(['body', 'version', 'risk', 'owner', 'evidence', 'conflict', 'omit', 'extra'])('rejects %s changes even when payload and manifest hashes are refreshed', async (change) => {
    const f = await ownerFixture();
    const manifestSha = await rewritePayload(f.inputRoot, 'content.jsonl', (rows) => {
      const item = rows[0]!;
      if (change === 'body') item.answer_text = '篡改后的纯合成回答';
      if (change === 'version') item.script_version = 2;
      if (change === 'risk') item.risk_categories = ['legal_commitment'];
      if (change === 'owner') item.primary_reviewer_id_hash = '0'.repeat(64);
      if (change === 'evidence') item.primary_review_evd = 'EVD-SYNTHETIC-OTHER-OWNER';
      if (change === 'conflict') item.has_conflict = true;
      if (change === 'omit') rows.pop();
      if (change === 'extra') rows.push({ ...item, script_id: 'script_synthetic_extra' });
    });
    await expect(readG1aEvaluationPackage(f.inputRoot, { ...f, expectedManifestSha256: manifestSha,
      repositoryRoot: REPOSITORY_ROOT })).rejects.toBeInstanceOf(G1aInputError);
  });
  it.each(['future', 'expired'])('rejects an externally anchored but %s acceptance period', async (change) => {
    const f = await ownerFixture();
    const member = path.join(f.inputRoot, 'owner-acceptance.json');
    const record = JSON.parse(await readFile(member, 'utf8'));
    if (change === 'future') record.accepted_at = '2099-01-01T00:00:00.000Z';
    else record.expires_at = '2020-01-01T00:00:00.000Z';
    const bytes = jcs(record) + '\n';
    await writeFile(member, bytes);
    const expectedOwnerAcceptanceSha256 = sha256(bytes);
    const expectedManifestSha256 = await rewriteManifest(f.inputRoot, (m) => {
      (m.files as MutableRecord)['owner-acceptance.json'] = { sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), records: 1 };
    });
    await expect(readG1aEvaluationPackage(f.inputRoot, { ...f, expectedOwnerAcceptanceSha256,
      expectedManifestSha256, repositoryRoot: REPOSITORY_ROOT })).rejects.toMatchObject({ code: 'G1A_INPUT_OWNER_ACCEPTANCE_INVALID' });
  });
  it('rejects record edits under an unchanged external record anchor', async () => {
    const f = await ownerFixture();
    const member = path.join(f.inputRoot, 'owner-acceptance.json');
    const record = JSON.parse(await readFile(member, 'utf8'));
    record.approval_evidence_id = 'EVD-SYNTHETIC-FORGED-OWNER';
    const bytes = jcs(record) + '\n';
    await writeFile(member, bytes);
    const expectedManifestSha256 = await rewriteManifest(f.inputRoot, (m) => {
      (m.files as MutableRecord)['owner-acceptance.json'] = { sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), records: 1 };
    });
    await expect(readG1aEvaluationPackage(f.inputRoot, { ...f, expectedManifestSha256,
      repositoryRoot: REPOSITORY_ROOT })).rejects.toMatchObject({ code: 'G1A_INPUT_OWNER_ACCEPTANCE_INVALID' });
  });
});
