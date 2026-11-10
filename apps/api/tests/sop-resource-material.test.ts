import { describe, expect, it } from 'vitest';
import { SOP_RESOURCE_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import type { components } from '@customer-agent/contracts/sop-resource-disable';
import { syntheticGraphMapping, syntheticResourceDisableWorkbook } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import type { Source } from '../src/content-intake/authority.js';
import type { Job } from '../src/content-intake/candidate.js';
import { withIntakeView } from '../src/content-intake/contract-view.js';
import { canonical, digest } from '../src/content-intake/material.js';
import { makeMaterial, prepareImport, type GraphBase } from '../src/content-intake/sop-graph.js';

type Binding = components['schemas']['IntakeResourceDisableBinding'];
const source: Source = { scopeId: 'scope-a', scope: { tenantId: 'synthetic', appId: 'app', brandId: 'brand', shopId: 'shop',
  domain: 'sop', sourceId: 'source-a' }, version: 2, ...SOP_RESOURCE_FORMAT, structureDigest: SOP_TASK_STRUCTURE_SHA256,
  mode: 'v2-preview', graphMapping: syntheticGraphMapping() };
const job: Job = { job_id: 'synthetic-job', source_id: 'source-a', object_id: 'synthetic-object', actor_id: 'enabler',
  source_version: '2', contributor_ids: ['enabler'], generation: '1', state: 'parsing', base_release_id: 'release-10',
  expected_prior_id: null, expected_prior_version: null, expected_prior_digest: null,
  result_candidate_id: null, result_candidate_version: null, report_object_id: null, started_at: new Date('2026-11-10T00:00:00Z'),
  contract_view: 'resource-disable' };
function image(releaseSeq: number, ordinal: number, ownerId = 'task-a'): Binding {
  return { releaseSeq, releaseId: `release-${releaseSeq}`, flowKey: { sourceId: 'source-a', flowId: 'flow-main', flowVersion: 1 },
    graphDigest: 'a'.repeat(64), owner: { kind: 'task', id: ownerId }, content: { kind: 'image', objectId: `image-${ordinal}`,
      sha256: 'b'.repeat(64), mime: 'image/png', bytes: 1, alt: '合成图', required: true, ordinal } };
}
async function material(bindings: Binding[], resourceIds: string[] = ['resource-a']) {
  const bytes = await syntheticResourceDisableWorkbook(resourceIds);
  const base: GraphBase = { entries: [], graphs: [], versions: {}, recentDisables: 0,
    resourceHistory: { baseReleaseSeq: 10, bindings: bindings.map(binding => ({ resourceId: 'resource-a', binding })) } };
  const prepared = await prepareImport(bytes, source, base);
  return withIntakeView('resource-disable', () => makeMaterial({ prepared, source, base, job, media: [],
    object: { objectId: job.object_id, sourceId: 'source-a', sha256: digest(bytes), bytes: bytes.length,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, now: job.started_at.getTime() }));
}
describe('resource canonical material over trusted retained history', () => {
  it('binds an absent-current resource without inventing a flow difference and uses numeric release/ordinal ordering', async () => {
    const result = await material([image(10, 10), image(2, 10), image(10, 2), image(10, 2, 'task-b')]);
    if (result.canonicalEncodingVersion !== 'candidate-sop-resource-disable-v1') throw new Error('Missing resource format');
    expect(result.sopFlows).toEqual([]); expect(result.sopDifferences).toEqual([]); expect(result.differences).toEqual([]);
    expect(result.resourceDisables[0]!.bindings).toEqual([image(2, 10), image(10, 2), image(10, 10), image(10, 2, 'task-b')]);
    expect(result.resourceDisableCount).toBe(1);
    expect(result.resourceDisableSetDigest).toBe(digest(canonical(result.resourceDisables)));
    expect(result.risk.explicitDisableCount).toBe(1); expect(result.risk.reasons).toContain('SOP_RESOURCE_DISABLE');
    expect(result.baseReleaseSeq).toBe(10);
  });
  it('refuses missing history and duplicated semantic bindings', async () => {
    await expect(material([])).rejects.toThrow();
    await expect(material([image(10, 1), image(10, 1)])).rejects.toThrow('SOP_MAPPING_REQUIRED');
  });
  it('enforces the per-resource binding cap before freeze', async () => {
    await expect(material(Array.from({ length: 501 }, (_, index) => image(10, 1, `task-${index}`)))).rejects.toThrow();
  });
  it('binds the explicit empty resource set when the workbook has no disable intent', async () => {
    const result = await material([], []);
    if (result.canonicalEncodingVersion !== 'candidate-sop-resource-disable-v1') throw new Error('Missing resource format');
    expect(result.resourceDisables).toEqual([]); expect(result.resourceDisableCount).toBe(0);
    expect(result.resourceDisableSetDigest).toBe(digest('[]'));
  });
});
