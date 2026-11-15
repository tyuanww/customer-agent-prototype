import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import { parseMenokinFlatSopWorkbook, parseSopTaskWorkbook, prepareMenokinSopReview,
  type MenokinSopReviewRecord } from '@customer-agent/content-intake';
import { syntheticFlatReviewSource, syntheticReviewRecord, syntheticReviewPlanWorkbook, withSyntheticIndependentFlow, withSyntheticTaskRowDependency } from './support/menokin-sop-review-fixture.js';

const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
const change = (record: MenokinSopReviewRecord, column: string, oldValue: string, value: string): MenokinSopReviewRecord => ({
  ...record, entities: record.entities.map(entity => ({ ...entity, fields: entity.fields.map(field => field.column === column
    && field.kind === 'reviewed' && field.value === oldValue ? { ...field, value } : field) })),
});

describe('explicit Menokin flat SOP review preparation', () => {
  it('keeps physical rows, all headers, original display text and image facts without D1 inference', async () => {
    const bytes = await syntheticFlatReviewSource();
    const parsed = await parseMenokinFlatSopWorkbook(bytes);
    expect(parsed.ok).toBe(true); expect(parsed.flatFacts).toHaveLength(3);
    expect(parsed.flatFacts.every(row => row.sheetName === '特殊流程 SOP' && row.cells.length === 18)).toBe(true);
    expect(new Set(parsed.flatFacts.map(row => row.rowId)).size).toBe(3);
    expect(parsed.flatFacts[0]?.cells.find(cell => cell.column === '操作说明')).toEqual({
      column: '操作说明', originalDisplayText: '  核实材料\n原句必须保留  ', normalizedText: '核实材料\n原句必须保留',
    });
    expect(parsed.flatFacts[0]?.cells.find(cell => cell.column === '字段')).toEqual({ column: '字段', originalDisplayText: '无', normalizedText: '' });
    expect(parsed.flatFacts[0]?.images[0]).not.toHaveProperty('targetNodeKey');
    const fresh = await prepareMenokinSopReview(bytes);
    expect(fresh.kind).toBe('needs-review');
    if (fresh.kind !== 'needs-review') throw new Error('Missing review');
    expect(fresh.review.tables['执行任务']).toEqual([]);
    expect(fresh.review.coverage.every(row => row.decision.kind === 'pending')).toBe(true);
    expect((await parseMenokinFlatSopWorkbook(Buffer.from('not xlsx'))).flatFacts).toEqual([]);
  });

  it('writes and rereads the real six-table XLSX with exact extracted script, confirmations and images', async () => {
    const bytes = await syntheticFlatReviewSource(), review = await syntheticReviewRecord(bytes);
    const prepared = await prepareMenokinSopReview(bytes, { review });
    expect(prepared.kind).toBe('authoring-ready');
    if (prepared.kind !== 'authoring-ready') throw new Error(JSON.stringify(prepared));
    const workbook = await parseSopTaskWorkbook(await syntheticReviewPlanWorkbook(prepared.authoringPlan));
    expect(workbook.sheets['客户话术'][0]?.values['对客正文']).toBe('合成对客原文 A\n版本 1');
    expect(workbook.sheets['执行任务'].filter(row => row.values['记录类型'] === '确认项')).toHaveLength(2);
    expect(workbook.sheets['执行任务'].filter(row => row.values['记录类型'] === '话术引用')).toHaveLength(3);
    expect(workbook.images).toHaveLength(3);
    expect(prepared.review.coverage.every(row => row.decision.kind === 'mapped' && row.outputs.length > 0)).toBe(true);
    expect(prepared.authoringPlan.registrationRequirements).toMatchObject({ flowIds: ['flow-main'], entryIds: ['script-a', 'script-b'] });
    expect(Object.values(prepared.review.tables).flat().every(row => row.values['维护状态'] === '待确认'
      && row.values['待确认事项'] !== '')).toBe(true);
    expect(Object.values(prepared.authoringPlan.tables).flat().every(row => row.values['维护状态'] === '启用'
      && row.values['业务确认人'] === review.reviewer && row.values['待确认事项'] === '')).toBe(true);
  });

  it('rejects stale binding, unknown fields, duplicate decisions, forged fragments and unknown media', async () => {
    const bytes = await syntheticFlatReviewSource(), review = await syntheticReviewRecord(bytes);
    for (const candidate of [
      { ...review, targetDigest: '0'.repeat(64) }, { ...review, sourceSha256: '0'.repeat(64) },
      { ...review, extra: true }, { ...review, rows: [...review.rows, review.rows[0]] },
      { ...review, entities: [...review.entities, review.entities[0]] },
      { ...review, images: review.images.map(image => ({ ...image, contentSha256: '0'.repeat(64) })) },
      { ...review, entities: review.entities.map(entity => ({ ...entity, fields: entity.fields.map(field => field.kind === 'source'
        ? { ...field, excerpts: field.excerpts.map(excerpt => ({ ...excerpt, text: '静默改写' })) } : field) })) },
    ]) expect((await prepareMenokinSopReview(bytes, { review: candidate })).kind).toBe('invalid-input');
  });

  it.each([
    ['确认项', '关联知识编号'], ['确认项', '关联资源编号'],
    ['话术引用', '关联知识编号'], ['话术引用', '关联资源编号'],
  ] as const)('reports unsupported %s %s without discarding reviewed values', async (kind, column) => {
    const bytes = await syntheticFlatReviewSource(true), record = await syntheticReviewRecord(bytes);
    const { review, owner, dependencyId, dependency } = withSyntheticTaskRowDependency(record, kind, column);
    const dependencyRowId = record.rows.at(-1)?.rowId ?? '';
    const result = await prepareMenokinSopReview(bytes, { review: {
      ...review, entities: review.entities.map(entity => entity.entityId === dependency.entityId ? { ...entity, rowIds: [dependencyRowId] } : entity),
      rows: review.rows.map(row => row.rowId === dependencyRowId ? { rowId: dependencyRowId, kind: 'mapped', entityIds: [dependency.entityId] }
        : row.kind === 'mapped' ? { ...row, entityIds: row.entityIds.filter(id => id !== dependency.entityId) } : row),
      holds: [{ id: 'unsupported-dependency-flow', kind: 'resolved', rowIds: [dependencyRowId], reason: '合成关联归属核对',
        resolution: '合成已审说明', appliesTo: { kind: 'flows', flowIds: ['flow-main'] } }],
    } });
    expect(result.kind).toBe('needs-review');
    if (result.kind !== 'needs-review') throw new Error('Expected unsupported task row field');
    expect(result.review.issues).toContainEqual({ code: 'FIELD_NOT_APPLICABLE', target: `${owner.entityId}.${column}`, rowIds: owner.rowIds });
    expect(result.review.issues).toContainEqual({ code: 'HOLD_SCOPE_PENDING', target: 'unsupported-dependency-flow', rowIds: [dependencyRowId] });
    expect(result.review.tables['执行任务'].find(row => row.entityId === owner.entityId)?.values[column]).toBe(JSON.stringify([dependencyId]));
    expect(result.review.tables[dependency.sheet].some(row => row.entityId === dependency.entityId)).toBe(true);
  });

  it('keeps pending business holds and broken graph/dependency decisions from producing a plan', async () => {
    const bytes = await syntheticFlatReviewSource(), review = await syntheticReviewRecord(bytes), rowId = review.rows[0]?.rowId ?? '';
    const candidates = [
      { ...review, holds: [{ id: 'compensation', kind: 'pending', appliesTo: { kind: 'rows' }, rowIds: [rowId], reason: '合成补偿待确认' }] },
      { ...review, rows: review.rows.filter(row => row.rowId !== rowId) },
      { ...review, images: [] },
      change(review, '下一任务编号', 'task-b', 'missing-target'),
      change(review, '下一任务编号', 'task-b', 'task-a'),
      change(review, '是否无法判断', '是', '否'),
      change(review, '确认项配置', '有确认项', ''),
      change(review, '阶段', '合成阶段', ''),
      change(review, '关联知识编号', '["knowledge-a"]', '["missing-knowledge"]'),
      change(review, '适用范围', JSON.stringify({ productRefs: [{ id: 'product-graph', displayVersion: 1 }], scenarioRefs: [{ id: 'scenario-graph', displayVersion: 1 }] }), ''),
    ];
    for (const candidate of candidates) expect((await prepareMenokinSopReview(bytes, { review: candidate })).kind).not.toBe('authoring-ready');
  });

  it('blocks selected unassigned pending rows until their ownership or exclusion is explicit', async () => {
    const bytes = await syntheticFlatReviewSource(true), selection = { flowIds: ['flow-main'] };
    const review = await syntheticReviewRecord(bytes, selection), extra = review.rows.at(-1)?.rowId ?? '';
    const held: MenokinSopReviewRecord = { ...review, holds: [{ id: 'shop-name', kind: 'pending', appliesTo: { kind: 'rows' }, rowIds: [extra], reason: '合成店铺全称待确认' }] };
    expect((await prepareMenokinSopReview(bytes, { selection, review: held })).kind).toBe('needs-review');
    const excluded = { ...held, rows: held.rows.map(row => row.rowId === extra
      ? { rowId: extra, kind: 'excluded', reason: '负责人明确排除本次范围外原行' } : row) };
    const prepared = await prepareMenokinSopReview(bytes, { selection, review: excluded });
    expect(prepared.kind).toBe('authoring-ready');
    if (prepared.kind !== 'authoring-ready') throw new Error('Expected explicitly excluded source row');
    expect(prepared.review.issues).toContainEqual({ code: 'BUSINESS_PENDING', target: 'shop-name', rowIds: [extra] });
    expect(prepared.review.coverage.at(-1)?.decision.kind).toBe('excluded');
    expect(prepared.review.sourceRows).toHaveLength(4);
    const owned = withSyntheticIndependentFlow(held, extra);
    const scoped = await prepareMenokinSopReview(bytes, { selection, review: owned });
    expect(scoped.kind).toBe('authoring-ready');
    if (scoped.kind !== 'authoring-ready') throw new Error('Expected explicitly owned source row');
    expect(scoped.authoringPlan.excludedFlowIds).toEqual(['flow-other']);
    expect(scoped.review.coverage.at(-1)?.decision.kind).toBe('mapped');
    expect(scoped.review.holds).toEqual(held.holds);
  });

  it('records every unselected physical row as explicitly excluded and binds row selection', async () => {
    const bytes = await syntheticFlatReviewSource(true), all = await prepareMenokinSopReview(bytes);
    if (all.kind !== 'needs-review') throw new Error('Missing initial source facts');
    const rowId = all.review.sourceRows.at(-1)?.rowId ?? '';
    const selected = await prepareMenokinSopReview(bytes, { selection: { rowIds: [rowId] } });
    expect(selected.kind).toBe('needs-review');
    if (selected.kind !== 'needs-review') throw new Error('Missing selected report');
    expect(selected.review.coverage.filter(row => row.decision.kind === 'excluded')).toHaveLength(3);
    expect(selected.review.targetDigest).not.toBe(all.review.targetDigest);
  });

  it('retains a mixed-row hold for another explicitly reviewed flow and blocks it when applied to the selected flow', async () => {
    const bytes = await syntheticFlatReviewSource(), selection = { flowIds: ['flow-main'] };
    const original = await syntheticReviewRecord(bytes, selection), rowId = original.rows[0]?.rowId ?? '';
    const review = withSyntheticIndependentFlow(original, rowId, 'flow-awaiting-business');
    const hold = { id: 'mixed-row-business', kind: 'pending', appliesTo: { kind: 'flows', flowIds: ['flow-awaiting-business'] },
      rowIds: [rowId], reason: '本行其他原句属于未确认流程，所选原句及完整流程已明确审核' };
    const prepared = await prepareMenokinSopReview(bytes, { selection, review: { ...review, holds: [hold] } });
    expect(prepared.kind).toBe('authoring-ready');
    const blocked = await prepareMenokinSopReview(bytes, { selection, review: { ...review, holds: [{
      ...hold, appliesTo: { kind: 'flows', flowIds: ['flow-main'] },
    }] } });
    expect(blocked.kind).toBe('needs-review');
    const resolved = await prepareMenokinSopReview(bytes, { selection, review: { ...review, holds: [{
      ...hold, kind: 'resolved', resolution: '合成负责人确认所选原句与范围', appliesTo: { kind: 'flows', flowIds: ['flow-main'] },
    }] } });
    expect(resolved.kind).toBe('authoring-ready');
  });

  it('rejects unknown hold flows and hold flows unrelated to their declared source rows', async () => {
    const bytes = await syntheticFlatReviewSource(), selection = { flowIds: ['flow-main'] };
    const original = await syntheticReviewRecord(bytes, selection);
    const first = original.rows[0]?.rowId ?? '', last = original.rows.at(-1)?.rowId ?? '';
    const review = withSyntheticIndependentFlow(original, first);
    for (const flowId of ['typo-nonexistent', 'flow-other']) {
      const result = await prepareMenokinSopReview(bytes, { selection, review: { ...review, holds: [{
        id: 'invalid-scope', kind: 'pending', rowIds: [last], reason: '合成范围归属待确认',
        appliesTo: { kind: 'flows', flowIds: [flowId] },
      }] } });
      expect(result.kind).toBe('needs-review');
      if (result.kind !== 'needs-review') throw new Error('Expected invalid hold scope');
      expect(result.review.issues.some(issue => issue.code === 'HOLD_SCOPE_PENDING')).toBe(true);
    }
  });

  it('validates the whole reviewed graph before explicit flow pruning', async () => {
    const bytes = await syntheticFlatReviewSource(), selection = { flowIds: ['flow-main'] };
    const record = await syntheticReviewRecord(bytes, selection), rowId = record.rows[0]?.rowId ?? '';
    const flow = record.entities.find(entity => entity.sheet === '场景目录');
    const task = record.entities.find(entity => entity.sheet === '执行任务'
      && entity.fields.some(field => field.column === '任务编号' && field.kind === 'reviewed' && field.value === 'task-known'));
    const branch = record.entities.find(entity => entity.sheet === '判断分支');
    if (!flow || !task || !branch) throw new Error('Missing synthetic graph templates');
    const duplicate = { ...flow, entityId: 'duplicate-flow' };
    const orphan = { ...task, entityId: 'orphan-task', fields: task.fields.map(field => field.kind === 'reviewed'
      && ['场景编号', '任务编号'].includes(field.column) ? { ...field, value: field.column === '场景编号' ? 'missing-flow' : 'orphan-task' } : field) };
    const orphanBranch = { ...branch, entityId: 'orphan-branch', fields: branch.fields.map(field => field.kind === 'reviewed'
      && ['任务编号', '分支编号'].includes(field.column) ? { ...field, value: `missing-${field.column}` } : field) };
    for (const entity of [duplicate, orphan, orphanBranch]) {
      const review = { ...record, entities: [...record.entities, entity], rows: record.rows.map(row => row.rowId === rowId && row.kind === 'mapped'
        ? { ...row, entityIds: [...row.entityIds, entity.entityId] } : row) };
      const result = await prepareMenokinSopReview(bytes, { selection, review });
      expect(result.kind).toBe('needs-review');
      if (result.kind !== 'needs-review') throw new Error('Expected complete graph validation');
      expect(result.review.issues.length).toBeGreaterThan(0);
      expect(Object.values(result.review.tables).flat().some(row => row.entityId === entity.entityId)).toBe(true);
    }
    const independent = withSyntheticIndependentFlow(record, rowId);
    const selected = await prepareMenokinSopReview(bytes, { selection, review: independent });
    expect(selected.kind).toBe('authoring-ready');
    if (selected.kind !== 'authoring-ready') throw new Error('Expected independent complete flow');
    expect(selected.authoringPlan.excludedFlowIds).toEqual(['flow-other']);
    expect(selected.review.tables['场景目录']).toHaveLength(2);
    expect(selected.authoringPlan.tables['场景目录']).toHaveLength(1);
    const brokenIndependent = change(independent, '起始任务编号', 'flow-other-end', 'missing-start');
    const broken = await prepareMenokinSopReview(bytes, { selection, review: brokenIndependent });
    expect(broken.kind).toBe('needs-review');
    if (broken.kind !== 'needs-review') throw new Error('Expected validation before flow pruning');
    expect(broken.review.issues.some(issue => issue.code === 'GRAPH_UNREACHABLE')).toBe(true);
  });

  it('rejects duplicate native business IDs across every sheet and task record type before pruning', async () => {
    const bytes = await syntheticFlatReviewSource(), selection = { flowIds: ['flow-main'] };
    const record = await syntheticReviewRecord(bytes, selection);
    const representatives = record.entities.filter((entity, index, entities) => {
      const recordType = entity.fields.find(field => field.column === '记录类型');
      return entities.findIndex(other => other.sheet === entity.sheet && (entity.sheet !== '执行任务'
        || JSON.stringify(other.fields.find(field => field.column === '记录类型')) === JSON.stringify(recordType))) === index;
    });
    expect(representatives).toHaveLength(8);
    for (const entity of representatives) {
      const duplicate = { ...entity, entityId: `duplicate-${entity.entityId}` };
      const review = { ...record, entities: [...record.entities, duplicate], rows: record.rows.map(row => row.kind === 'mapped'
        && entity.rowIds.includes(row.rowId) ? { ...row, entityIds: [...row.entityIds, duplicate.entityId] } : row) };
      const result = await prepareMenokinSopReview(bytes, { selection, review });
      expect(result.kind).toBe('needs-review');
      if (result.kind !== 'needs-review') throw new Error('Expected duplicate native key rejection');
      expect(result.review.issues).toContainEqual({ code: 'DUPLICATE_OR_INVALID_ID', target: duplicate.entityId, rowIds: entity.rowIds });
    }
  });

  it('blocks locally incompatible resource scopes including image version mismatches', async () => {
    const bytes = await syntheticFlatReviewSource(), record = await syntheticReviewRecord(bytes);
    for (const resourceType of ['资料', '图片']) {
      for (const scope of [
        { productRefs: [{ id: 'wrong-product', displayVersion: 1 }], scenarioRefs: [] },
        { productRefs: [{ id: 'product-graph', displayVersion: 2 }], scenarioRefs: [{ id: 'scenario-graph', displayVersion: 1 }] },
        { productRefs: [], scenarioRefs: [] },
      ]) {
        const review = { ...record, entities: record.entities.map(entity => entity.sheet === '资源与图片'
          && entity.fields.some(field => field.column === '资源类型' && field.kind === 'reviewed' && field.value === resourceType)
          ? { ...entity, fields: entity.fields.map(field => field.column === '适用范围' ? { column: field.column, kind: 'reviewed', value: JSON.stringify(scope) } : field) } : entity) };
        expect((await prepareMenokinSopReview(bytes, { review })).kind).toBe('needs-review');
      }
    }
  });

  it('preserves cached image formula display and explicitly records an opaque formula without cache', async () => {
    const original = await syntheticFlatReviewSource();
    const source = await parseMenokinFlatSopWorkbook(original);
    const embeddedHashes = source.flatFacts[0]?.images.filter(image => image.referenceKind === 'embedded').map(image => image.contentSha256);
    for (const cached of ['合成显示文字', 42, 0, false, true, '无', undefined]) {
      const book = new ExcelJS.Workbook(); await book.xlsx.load(original as unknown as ExcelJS.Buffer);
      book.worksheets[0]!.getCell('R2').value = { formula: 'SYNTHETIC_IMAGE()', ...(cached === undefined ? {} : { result: cached }) };
      const bytes = Buffer.from(await book.xlsx.writeBuffer());
      const parsed = await parseMenokinFlatSopWorkbook(bytes);
      expect(parsed.ok).toBe(true);
      const cell = parsed.flatFacts[0]?.cells.at(-1);
      expect(cell?.originalDisplayText).toBe(cached === undefined ? null : String(cached));
      expect(cell).toHaveProperty('formulaSource');
      expect(cell?.normalizedText).toMatch(/^external-sha256:/u);
      expect(parsed.flatFacts[0]?.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(parsed.flatFacts[0]?.images.filter(image => image.referenceKind === 'embedded').map(image => image.contentSha256)).toEqual(embeddedHashes);
    }
  });

  it('runs the public local CLI without review, protects outputs and never prints source text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synthetic-sop-review-')); directories.push(directory);
    const source = join(directory, 'source.xlsx'), output = join(directory, 'review');
    await writeFile(source, await syntheticFlatReviewSource());
    const script = resolve('scripts/menokin-sop-review.mjs');
    const run = (args: string[]) => spawnSync(process.execPath, [script, '--source', source, '--output-dir', output, ...args], { encoding: 'utf8' });
    const first = run([]);
    expect(first.status).toBe(0); expect(first.stdout).toBe('{"kind":"needs-review"}\n'); expect(first.stderr).toBe('');
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    expect(report.kind).toBe('needs-review'); expect(report.review.coverage).toHaveLength(3);
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(output, 'report.json'))).mode & 0o777).toBe(0o600);
    expect(run([]).status).toBe(2);
    expect(spawnSync(process.execPath, [script, '--source', source, '--output-dir', resolve('.forbidden-output')], { encoding: 'utf8' }).status).toBe(2);
    const reviewFile = join(directory, 'decisions.json');
    await writeFile(reviewFile, JSON.stringify(await syntheticReviewRecord(await readFile(source))));
    const approved = spawnSync(process.execPath, [script, '--source', source, '--review', reviewFile,
      '--output-dir', join(directory, 'authoring')], { encoding: 'utf8' });
    expect(approved.status).toBe(0); expect(approved.stdout).toBe('{"kind":"authoring-ready"}\n');
    const plan = JSON.parse(await readFile(join(directory, 'authoring', 'authoring-plan.json'), 'utf8'));
    expect((await parseSopTaskWorkbook(await syntheticReviewPlanWorkbook(plan))).images).toHaveLength(3);
    const invalidSelection = join(directory, 'null-selection.json'); await writeFile(invalidSelection, 'null');
    const refused = spawnSync(process.execPath, [script, '--source', source, '--selection', invalidSelection,
      '--output-dir', join(directory, 'invalid-selection-output')], { encoding: 'utf8' });
    expect(refused.status).toBe(2); expect(refused.stdout).toBe('');
  }, 20_000);
});
