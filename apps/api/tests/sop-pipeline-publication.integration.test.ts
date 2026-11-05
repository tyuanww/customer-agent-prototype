import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import {
  materializeSopReleaseFacts,
  type SopAuthoringDocument,
  type SopReleaseFacts,
} from '@customer-agent/content-intake';
import { publishSopReleaseFacts } from '../src/content-intake/publication.js';
import { readSopReleaseProjection } from '../src/content-intake/sop-source.js';
import { SopPipeline } from '../src/query/sop-pipeline.js';

const enabled = process.env.CUSTOMER_AGENT_API_SOP_PG15_INTEGRATION === '1';
const migrationPath = fileURLToPath(new URL(
  '../../../packages/database/migrations/0083_sop_pipeline_projection.sql',
  import.meta.url,
));

const document: SopAuthoringDocument = {
  definitions: [{
    sopId: 'synthetic-allergy',
    sceneId: 'synthetic-allergy-scene',
    groupId: 'allergy',
    title: '合成过敏流程',
    entryStepId: 'step1',
    steps: [
      {
        stepId: 'step1',
        kind: 'ordered',
        sequence: 1,
        parentStepId: null,
        nextStepId: 'step2',
        targetStepId: null,
        title: '步骤一',
        description: '',
      },
      {
        stepId: 'step2',
        kind: 'ordered',
        sequence: 2,
        parentStepId: null,
        nextStepId: 'step3',
        targetStepId: null,
        title: '步骤二',
        description: '',
      },
      {
        stepId: 'step3',
        kind: 'ordered',
        sequence: 3,
        parentStepId: null,
        nextStepId: null,
        targetStepId: null,
        title: '步骤三',
        description: '',
      },
    ],
    branches: [],
    messages: [
      { messageId: 'm1', stepId: 'step1', text: '第一步合成话术', riskLevel: 'low' },
      { messageId: 'm2', stepId: 'step2', text: '第二步合成话术', riskLevel: 'medium' },
      { messageId: 'm3', stepId: 'step3', text: '第三步合成话术', riskLevel: 'high' },
    ],
    resources: [{
      resourceId: 'resource-step1',
      stepId: 'step1',
      mediaId: `med_${'d'.repeat(64)}`,
      ordinal: 1,
      description: '合成图片',
    }],
    searchEntries: [
      { entryId: 'route-allergy', stepId: 'step1', purpose: 'classify', text: '过敏流程' },
    ],
  }],
};

function facts(releaseId: string): SopReleaseFacts {
  return materializeSopReleaseFacts(document, releaseId, null);
}

async function insertRelease(client: Client, releaseId: string, sequence: number): Promise<void> {
  const domains = ['aftersale', 'campaign', 'presale', 'product'];
  const hash = createHash('sha256')
    .update(domains.map((domain) => `${domain}:srcv_sop_${domain}`).join('|'))
    .digest('hex');
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.publishing','on',true)");
    await client.query(
      `INSERT INTO public.content_releases(
         release_id, release_seq, title, status, source_binding_hash, tenant_id
       ) VALUES ($1, $2, 'synthetic SOP release', 'published', $3, 'tenant-a')`,
      [releaseId, sequence, hash],
    );
    for (const domain of domains) {
      await client.query(
        `INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
         VALUES ($1, $2, $3)`,
        [releaseId, domain, `srcv_sop_${domain}`],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe.runIf(enabled).sequential('SOP release projection PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let client: Client;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    const database = harness.createDatabase('sop_pipeline_projection');
    client = await harness.connect(database.config);
    await applyDatabaseMigrations(client);
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(migrationPath, 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    for (const domain of ['aftersale', 'campaign', 'presale', 'product']) {
      await client.query(
        `INSERT INTO public.authoritative_source_versions(
           source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
           use_class, owner_role, approval_evd, approved_by, approved_at,
           review_due_at, tenant_id
         ) VALUES (
           $1, $2, $3, 'synthetic-sop-v1', $4, 'canonical', 'ROLE-CONTENT-LEAD',
           'EVD-SYNTHETIC-SOP', 'synthetic-owner', '2020-01-01T00:00:00Z',
           '2099-01-01T00:00:00Z', 'tenant-a'
         )`,
        [
          `srcv_sop_${domain}`,
          `SRC-SYNTHETIC-SOP-${domain.toUpperCase()}`,
          domain,
          'c'.repeat(64),
        ],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    harness?.stop();
  }, 60_000);

  it('writes entity facts and the immutable projection in one transaction, then replays identically', async () => {
    const releaseId = 'rel_sop_pipeline_1';
    await insertRelease(client, releaseId, 900_001);
    const releaseFacts = facts(releaseId);
    await client.query('BEGIN');
    try {
      await expect(publishSopReleaseFacts(
        client as unknown as Parameters<typeof publishSopReleaseFacts>[0],
        releaseFacts,
      )).resolves.toEqual({
        releaseId,
        factsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        indexHash: releaseFacts.projection.indexHash,
        itemCount: releaseFacts.projection.itemCount,
        state: 'inserted',
      });
      await expect(publishSopReleaseFacts(
        client as unknown as Parameters<typeof publishSopReleaseFacts>[0],
        releaseFacts,
      )).resolves.toEqual({
        releaseId,
        factsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        indexHash: releaseFacts.projection.indexHash,
        itemCount: releaseFacts.projection.itemCount,
        state: 'replayed',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const counts = await client.query<{
      scenes: number;
      steps: number;
      messages: number;
      resources: number;
      search_entries: number;
      projections: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM content_intake.sop_release_scenes WHERE release_id=$1) AS scenes,
        (SELECT count(*)::int FROM content_intake.sop_release_steps WHERE release_id=$1) AS steps,
        (SELECT count(*)::int FROM content_intake.sop_release_messages WHERE release_id=$1) AS messages,
        (SELECT count(*)::int FROM content_intake.sop_release_resources WHERE release_id=$1) AS resources,
        (SELECT count(*)::int FROM content_intake.sop_release_search_entries WHERE release_id=$1) AS search_entries,
        (SELECT count(*)::int FROM content_intake.sop_release_projections WHERE release_id=$1) AS projections
    `, [releaseId]);
    expect(counts.rows[0]).toEqual({
      scenes: 1,
      steps: 3,
      messages: 3,
      resources: 1,
      search_entries: 1,
      projections: 1,
    });

    const projection = await readSopReleaseProjection(
      client as unknown as Parameters<typeof readSopReleaseProjection>[0],
      releaseId,
    );
    expect(projection).toEqual(releaseFacts.projection);
    const outcome = new SopPipeline(projection!).query({
      queryId: 'query-sop-1',
      text: '过敏流程',
      lease: {
        releaseId,
        sessionEpoch: 1,
        revoked: false,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(outcome).toMatchObject({
      kind: 'failure',
      failureCode: 'SOP_SEVERITY_ORDER_REQUIRED',
    });
  }, 60_000);

  it('rolls back entity rows and projection together when a graph reference is invalid', async () => {
    const releaseId = 'rel_sop_pipeline_atomic';
    await insertRelease(client, releaseId, 900_002);
    const releaseFacts = facts(releaseId);
    const invalid: SopReleaseFacts = {
      ...releaseFacts,
      definitions: [{
        ...releaseFacts.definitions[0]!,
        branches: [{
          branchId: 'branch-invalid',
          sourceStepId: 'step3',
          label: '悬空',
          targetStepId: 'missing-step',
        }],
      }],
      projection: {
        ...releaseFacts.projection,
        indexHash: 'e'.repeat(64),
        itemCount: releaseFacts.projection.itemCount + 1,
      },
    };
    await client.query('BEGIN');
    try {
      await publishSopReleaseFacts(
        client as unknown as Parameters<typeof publishSopReleaseFacts>[0],
        invalid,
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const counts = await client.query<{ scenes: number; projections: number }>(`
      SELECT
        (SELECT count(*)::int FROM content_intake.sop_release_scenes WHERE release_id=$1) AS scenes,
        (SELECT count(*)::int FROM content_intake.sop_release_projections WHERE release_id=$1) AS projections
    `, [releaseId]);
    expect(counts.rows[0]).toEqual({ scenes: 0, projections: 0 });
  }, 60_000);

  it('rejects mutation and conflicting rewrites of a released projection', async () => {
    const releaseId = 'rel_sop_pipeline_immutable';
    await insertRelease(client, releaseId, 900_003);
    const releaseFacts = facts(releaseId);
    await client.query('BEGIN');
    await publishSopReleaseFacts(
      client as unknown as Parameters<typeof publishSopReleaseFacts>[0],
      releaseFacts,
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    try {
      await expect(client.query(
        'UPDATE content_intake.sop_release_projections SET item_count=item_count+1 WHERE release_id=$1',
        [releaseId],
      )).rejects.toMatchObject({ code: 'ZA003' });
    } finally {
      await client.query('ROLLBACK');
    }

    const conflicting: SopReleaseFacts = {
      ...releaseFacts,
      projection: {
        ...releaseFacts.projection,
        indexHash: 'b'.repeat(64),
      },
    };
    const changedFacts: SopReleaseFacts = {
      ...releaseFacts,
      definitions: [{
        ...releaseFacts.definitions[0]!,
        resources: releaseFacts.definitions[0]!.resources.map((resource) => ({
          ...resource,
          description: 'changed synthetic description',
        })),
      }],
    };
    await client.query('BEGIN');
    try {
      await expect(publishSopReleaseFacts(
        client as unknown as Parameters<typeof publishSopReleaseFacts>[0],
        changedFacts,
      )).rejects.toMatchObject({ code: 'ZA003', message: 'SOP_RELEASE_CONFLICT' });
    } finally {
      await client.query('ROLLBACK');
    }
    await client.query('BEGIN');
    try {
      await expect(publishSopReleaseFacts(
        client as unknown as Parameters<typeof publishSopReleaseFacts>[0],
        conflicting,
      )).rejects.toMatchObject({ code: 'ZA003', message: 'SOP_RELEASE_CONFLICT' });
    } finally {
      await client.query('ROLLBACK');
    }
  }, 60_000);
});
