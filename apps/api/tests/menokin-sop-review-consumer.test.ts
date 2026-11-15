import { describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type components } from '@customer-agent/contracts/sop-unified';
import { prepareMenokinSopReview, SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import { syntheticFlatReviewSource, syntheticReviewRecord, syntheticReviewPlanWorkbook, withSyntheticTaskRowDependency } from '../../../packages/content-intake/tests/support/menokin-sop-review-fixture.js';
import { syntheticGraphMapping } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import type { Source } from '../src/content-intake/authority.js';
import type { Job } from '../src/content-intake/candidate.js';
import { withIntakeView } from '../src/content-intake/contract-view.js';
import { digest } from '../src/content-intake/material.js';
import { prepareImport, makeMaterial, graphFor, validateGraph, type GraphBase } from '../src/content-intake/sop-graph.js';

type C = components['schemas'];
const source: Source = {
  scopeId: 'synthetic-scope', scope: { tenantId: 'synthetic', appId: 'app', brandId: 'brand', shopId: 'shop', domain: 'sop', sourceId: 'source-a' },
  version: 1, ...SOP_TASK_FORMAT, structureDigest: SOP_TASK_STRUCTURE_SHA256, mode: 'v2-preview', graphMapping: syntheticGraphMapping(),
};
const base: GraphBase = { entries: [], graphs: [], versions: {}, recentDisables: 0, resourceHistory: null };
const job: Job = { job_id: 'synthetic-job', source_id: 'source-a', object_id: 'synthetic-object', actor_id: 'synthetic-owner',
  source_version: '1', contributor_ids: ['synthetic-owner'], generation: '1', state: 'parsing', base_release_id: null,
  expected_prior_id: null, expected_prior_version: null, expected_prior_digest: null, result_candidate_id: null,
  result_candidate_version: null, report_object_id: null, started_at: new Date('2026-11-15T00:00:00.000Z'), contract_view: 'graph' };
async function fixture() {
  const original = await syntheticFlatReviewSource(), review = await syntheticReviewRecord(original);
  const preparation = await prepareMenokinSopReview(original, { review });
  if (preparation.kind !== 'authoring-ready') throw new Error('Synthetic reviewed source did not produce a plan');
  return { preparation, workbook: await syntheticReviewPlanWorkbook(preparation.authoringPlan) };
}
function mediaFor(prepared: Awaited<ReturnType<typeof prepareImport>>): C['IntakeSopMedia'][] {
  const media: C['IntakeSopMedia'][] = [];
  const registered = syntheticGraphMapping();
  for (const binding of prepared.mediaOwners) {
    const image = prepared.workbook.images.find(image => image.resourceId === binding.resourceId);
    if (!image) throw new Error('Synthetic image is missing');
    const metadata = Object.entries(registered.images).find(([id]) => id === binding.resourceId)?.[1];
    if (!metadata) throw new Error('Missing synthetic image registration');
    const item = parse('IntakeSopMedia', {
      ...metadata,
      flowKey: binding.flow.header.key, ...binding.owner, resourceId: binding.resourceId,
      objectId: `obj_${digest(image.bytes)}`, sha256: digest(image.bytes), bytes: image.bytes.length, mime: image.mime,
      audience: binding.row['可见对象'] === '对客可用' ? 'customer' : 'agent', applicability: JSON.parse(binding.row['适用范围'] ?? ''),
    });
    if (!media.some(existing => JSON.stringify(existing) === JSON.stringify(item))) media.push(item);
  }
  return media;
}
const materialFor = (prepared: Awaited<ReturnType<typeof prepareImport>>, workbook: Buffer, media = mediaFor(prepared)) =>
  withIntakeView('graph', () => makeMaterial({ prepared, source, base, job, media, now: job.started_at.getTime(), object: {
    objectId: job.object_id, sourceId: source.scope.sourceId, sha256: digest(workbook), bytes: workbook.length,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } }));

describe('reviewed flat SOP actual XLSX native consumer', () => {
  it.each([
    ['确认项', '关联知识编号'], ['确认项', '关联资源编号'],
    ['话术引用', '关联知识编号'], ['话术引用', '关联资源编号'],
  ] as const)('blocks %s %s and consumes the dependency after explicit task ownership correction', async (kind, column) => {
    const original = await syntheticFlatReviewSource(), record = await syntheticReviewRecord(original);
    const { review, owner, dependencyId } = withSyntheticTaskRowDependency(record, kind, column);
    const result = await prepareMenokinSopReview(original, { review });
    if (result.kind === 'invalid-input') throw new Error('Expected review report');
    // Enable only the review markers to reproduce the native record-kind rejection.
    const tables = Object.fromEntries(Object.entries(result.review.tables).map(([sheet, rows]) => [sheet, rows.map(row => ({
      ...row, values: { ...row.values, 维护状态: '启用', 业务确认人: review.reviewer, 待确认事项: '' },
    }))]));
    const rejected = await syntheticReviewPlanWorkbook({ tables: { ...result.review.tables, ...tables }, imageBindings: review.images });
    await expect(prepareImport(rejected, source, base)).rejects.toThrow('SOP_MAPPING_REQUIRED');
    expect(result.kind).toBe('needs-review');
    expect(result.review.issues).toContainEqual({ code: 'FIELD_NOT_APPLICABLE', target: `${owner.entityId}.${column}`, rowIds: owner.rowIds });

    const taskId = owner.fields.find(field => field.column === '任务编号');
    if (taskId?.kind !== 'reviewed') throw new Error('Missing synthetic parent task ID');
    const task = review.entities.find(entity => entity.sheet === '执行任务'
      && entity.fields.some(field => field.column === '记录类型' && field.kind === 'reviewed' && field.value === '任务')
      && entity.fields.some(field => field.column === '任务编号' && field.kind === 'reviewed' && field.value === taskId.value));
    if (!task) throw new Error('Missing synthetic parent task');
    const corrected = { ...review, entities: review.entities.map(entity => ({ ...entity, fields: entity.fields.map(field => {
      if (field.column !== column || field.kind !== 'reviewed') return field;
      if (entity.entityId === owner.entityId) return { ...field, value: '' };
      return entity.entityId === task.entityId ? { ...field, value: JSON.stringify([...JSON.parse(field.value), dependencyId]) } : field;
    }) })) };
    const ready = await prepareMenokinSopReview(original, { review: corrected });
    expect(ready.kind).toBe('authoring-ready');
    if (ready.kind !== 'authoring-ready') throw new Error('Expected corrected task ownership');
    expect(ready.review.issues).toEqual([]);
    const workbook = await syntheticReviewPlanWorkbook(ready.authoringPlan), prepared = await prepareImport(workbook, source, base);
    expect(prepared.flows[0]?.nodes.find(node => node.id === 'task-a')?.body.knowledge.some(item => item.id === dependencyId)).toBe(true);
    const material = materialFor(prepared, workbook);
    validateGraph(graphFor(material, material.sopFlows[0]!));
  });

  it('consumes action/decision/terminal, references, requirements and exact images through the complete native graph', async () => {
    const { preparation, workbook } = await fixture();
    const prepared = await prepareImport(workbook, source, base);
    expect(prepared.flows).toHaveLength(1);
    expect(prepared.flows[0]?.nodes.map(node => node.body.kind).sort()).toEqual(['action', 'decision', 'terminal', 'terminal']);
    expect(prepared.flows[0]?.nodes.find(node => node.id === 'task-a')?.body.requirements).toHaveLength(2);
    const material = materialFor(prepared, workbook);
    const graph = graphFor(material, material.sopFlows[0]!); validateGraph(graph);
    expect(graph.entries).toHaveLength(2); expect(graph.media).toHaveLength(3);
    expect(graph.definition.edges).toHaveLength(3);
    expect(graph.entries[0]?.entry.answerText).toBe('合成对客原文 A\n版本 1');
    for (const binding of preparation.authoringPlan.imageBindings) {
      expect(prepared.workbook.images.some(image => image.resourceId === binding.resourceId && digest(image.bytes) === binding.contentSha256)).toBe(true);
    }
    expect(material.sourceClaim.fileSha256).toBe(digest(workbook));
  });

  it('native import refuses a needs-review report written directly as six-table XLSX', async () => {
    const original = await syntheticFlatReviewSource(), selection = { flowIds: ['flow-main'] };
    const record = await syntheticReviewRecord(original, selection);
    const rowId = record.rows[0]?.rowId ?? '';
    const result = await prepareMenokinSopReview(original, { selection, review: { ...record, holds: [{
      id: 'unconfirmed', kind: 'pending', rowIds: [rowId], reason: '合成未确认事实',
      appliesTo: { kind: 'flows', flowIds: ['flow-main'] },
    }] } });
    expect(result.kind).toBe('needs-review');
    if (result.kind !== 'needs-review') throw new Error('Expected pending review');
    expect(result.review.tables['场景目录'][0]?.values['待确认事项']).toContain('合成未确认事实');
    const workbook = await syntheticReviewPlanWorkbook({ tables: result.review.tables, imageBindings: record.images });
    await expect(prepareImport(workbook, source, base)).rejects.toThrow('SOP_MAPPING_REQUIRED');
  });

  it('native import refuses missing flow, entry, source-claim and risk registration', async () => {
    const { workbook } = await fixture(), mapping = syntheticGraphMapping();
    for (const graphMapping of [
      { ...mapping, flows: {} }, { ...mapping, entries: {} }, { ...mapping, sourceClaim: {} }, { ...mapping, riskLevel: '' },
    ]) await expect(prepareImport(workbook, { ...source, graphMapping }, base)).rejects.toThrow();
  });

  it('native material refuses dangling targets, cycles and invalid media scope after parser acceptance', async () => {
    const { workbook } = await fixture();
    for (const target of ['missing-task', 'task-a']) {
      const prepared = await prepareImport(workbook, source, base);
      const edge = prepared.flows[0]?.edges.find(edge => edge.action.kind === 'next');
      if (!edge) throw new Error('Missing native next edge'); edge.to = target;
      expect(() => materialFor(prepared, workbook)).toThrow('SOP_GRAPH_INVALID');
    }
    const prepared = await prepareImport(workbook, source, base), media = mediaFor(prepared);
    const image = media[0]; if (!image) throw new Error('Missing native image');
    image.applicability = { productRefs: [], scenarioRefs: [] };
    expect(() => materialFor(prepared, workbook, media)).toThrow('SOP_DEPENDENCY_INVALID');
  });
});
