import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, expect, it } from 'vitest';
import { parseSopMaintenance, type MaintenanceDocument } from '../src/maintenance.js';
import { prepareSopTaskGraphDraft, type SopTaskGraphMapping } from '../src/sop-task-graph-draft.js';
import { writeAuthoringWorkbook, type AuthoringRecord, type AuthoringSheet } from './fixtures/sop-authoring-workbook.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sha256 = createHash('sha256').update(png).digest('hex');
const applicability = { productRefs: [{ id: 'synthetic-product', displayVersion: 4 }], scenarioRefs: [] };
const firstEntry = { sourceId: 'synthetic-source', businessEntryId: 'provided-entry-a', scriptVersion: 7 };
const secondEntry = { sourceId: 'synthetic-source', businessEntryId: 'provided-entry-b', scriptVersion: 9 };
const key = { sourceId: 'synthetic-source', flowId: 'provided-flow', flowVersion: 3 };
type PreparedDraft = Extract<ReturnType<typeof prepareSopTaskGraphDraft>, { kind: 'prepared' }>;
const proofDrafts: PreparedDraft[] = [];
const workbookInputs = new WeakMap<MaintenanceDocument, Buffer>();

afterAll(async () => {
  const directory = process.env.SOP_TASK_GRAPH_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'prepared-cases.json'), JSON.stringify(proofDrafts, null, 2));
});

function records(): AuthoringRecord[] {
  const rows: AuthoringRecord[] = [];
  const add = (sheet: AuthoringSheet, fields: Record<string, string>): void => {
    rows.push({ sheet, fields: { 维护状态: '待发布', 业务确认人: '合成声明人', ...fields } });
  };
  add('场景目录', { 场景编号: 'scene', 场景名称: '合成设备咨询', 起始任务编号: 'inspect', 入口词: '合成故障\n合成诊断', 适用范围: '合成范围' });
  for (const [id, kind, next] of [['inspect', '操作', 'choose'], ['choose', '判断', ''], ['finish', '终点', ''], ['help', '终点', '']]) {
    add('执行任务', { 记录类型: '任务', 任务编号: id ?? '', 场景编号: 'scene', 阶段: '合成检查', 任务名称: `合成任务 ${id}`,
      任务类型: kind ?? '', 操作要求: '合成操作要求', 确认项配置: id === 'inspect' ? '有确认项' : '无确认项',
      下一任务编号: next ?? '', 关联知识编号: id === 'inspect' ? 'manual' : '', 关联资源编号: id === 'inspect' ? 'task-image' : '', 可见对象: '坐席可读' });
  }
  for (const ordinal of [2, 1]) add('执行任务', { 记录类型: '确认项', 任务编号: 'inspect', 确认项编号: `check-${ordinal}`,
    确认项文字: `合成确认 ${ordinal}`, 确认项顺序: String(ordinal) });
  add('判断分支', { 分支编号: 'need-help', 任务编号: 'choose', 选项: '无法判断', 判断依据: '合成资料不足',
    目标任务编号: 'help', 是否无法判断: '是', 匹配词: '不设置', 分支顺序: '2' });
  add('判断分支', { 分支编号: 'complete', 任务编号: 'choose', 选项: '完成检查', 判断依据: '合成检查通过',
    目标任务编号: 'finish', 是否无法判断: '否', 匹配词: ' 原文 \n合成完成', 分支顺序: '1' });
  add('客户话术', { 话术编号: 'wording-a', 话术标题: '合成说明 A', 对客正文: '唯一合成正文 A', 关联资源编号: 'customer-image' });
  add('客户话术', { 话术编号: 'wording-b', 话术标题: '合成说明 B', 对客正文: '唯一合成正文 B' });
  for (const [id, task, script, relation] of [['link-a', 'inspect', 'wording-a', '独立'], ['link-b', 'inspect', 'wording-b', '替代'], ['link-c', 'finish', 'wording-a', '配套']]) {
    add('执行任务', { 记录类型: '话术引用', 关联编号: id ?? '', 任务编号: task ?? '', 话术编号: script ?? '',
      适用条件: `合成条件 ${id}`, 话术关系: relation ?? '' });
  }
  add('知识与案例', { 知识编号: 'manual', 标题: '合成知识', 正文: '合成知识正文', 可见对象: '坐席可读', 关联资源编号: 'knowledge-image' });
  for (const id of ['task-image', 'knowledge-image', 'customer-image']) add('资源与图片', {
    资源编号: id, 资源类型: '图片', 资源名称: `合成图片 ${id}`, 可见对象: id === 'customer-image' ? '对客可用' : '坐席可读', 适用范围: '合成范围',
  });
  return rows;
}

function mapping(): SopTaskGraphMapping {
  return {
    flows: [{ sceneId: 'scene', key, applicability, audience: 'agent', anchorScriptId: null, effectiveFrom: '2026-10-01T00:00:00Z', effectiveTo: null }],
    entries: [{ scriptId: 'wording-a', entry: firstEntry }, { scriptId: 'wording-b', entry: secondEntry }],
    nextEdges: [{ taskId: 'inspect', edgeId: 'provided-next-edge' }],
    resourceScopes: ['task-image', 'knowledge-image', 'customer-image'].map(resourceId => ({ resourceId, applicability })),
    images: [
      { sceneId: 'scene', resourceId: 'task-image', owner: { kind: 'task', id: 'inspect' }, sha256, objectId: 'provided-image-task', ordinal: 3, alt: '合成任务图片', required: true },
      { sceneId: 'scene', resourceId: 'knowledge-image', owner: { kind: 'knowledge', id: 'manual' }, sha256, objectId: 'provided-image-knowledge', ordinal: 2, alt: '合成知识图片', required: false },
      { sceneId: 'scene', resourceId: 'customer-image', owner: { kind: 'script', id: 'wording-a' }, sha256, objectId: 'provided-image-customer', ordinal: 1, alt: '合成对客图片', required: true },
    ],
  };
}

async function fixture(change: (rows: AuthoringRecord[]) => AuthoringRecord[] = rows => rows): Promise<MaintenanceDocument> {
  const bytes = await writeAuthoringWorkbook(change(records()));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  const sheet = book.getWorksheet('资源与图片');
  if (!sheet) throw new Error('Synthetic resource sheet missing');
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3 || row.getCell(2).value !== '图片') return;
    const imageId = book.addImage({ extension: 'png', base64: png.toString('base64') });
    sheet.addImage(imageId, { tl: { col: 6, row: rowNumber - 1 }, ext: { width: 1, height: 1 } });
  });
  const workbookBytes = Buffer.from(await book.xlsx.writeBuffer());
  const parsed = await parseSopMaintenance(workbookBytes);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  workbookInputs.set(parsed.document, workbookBytes);
  return parsed.document;
}

function prepared(document: MaintenanceDocument, input = mapping()): PreparedDraft {
  const result = prepareSopTaskGraphDraft(document, input);
  if (result.kind !== 'prepared') throw new Error(JSON.stringify(result.issues));
  proofDrafts.push(result);
  return result;
}

it('prepares parsed tasks, choices, explicit ordering, independent scripts and three media owners without publishing', async () => {
  const document = await fixture();
  const before = JSON.stringify([document, mapping()]);
  const result = prepared(document);
  expect(JSON.stringify([document, mapping()])).toBe(before);
  expect(result).toMatchObject({ kind: 'prepared', publishable: false, review: 'not-verified' });
  expect(result.flows[0]?.header).toEqual({ key, title: '合成设备咨询', anchorEntry: null, entryTerms: ['合成故障', '合成诊断'],
    applicability, startNodeId: 'inspect', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-10-01T00:00:00Z', effectiveTo: null });
  const flow = result.flows[0];
  expect(flow?.nodes.map(node => node.body.kind)).toEqual(['action', 'decision', 'terminal', 'terminal']);
  expect(flow?.edges).toContainEqual({ key, id: 'provided-next-edge', from: 'inspect', to: 'choose', action: { kind: 'next' } });
  expect(flow?.edges.find(edge => edge.id === 'complete')?.action).toEqual({ kind: 'choice', label: '完成检查', ordinal: 1,
    matchTerms: [' 原文 ', '合成完成'], criterion: '合成检查通过', unableToDetermine: false });
  expect(flow?.edges.find(edge => edge.id === 'need-help')?.action).toMatchObject({ ordinal: 2, matchTerms: [], unableToDetermine: true });
  expect(flow?.edges.filter(edge => edge.action.kind === 'choice').map(edge => edge.id)).toEqual(['complete', 'need-help']);
  expect(flow?.nodes[0]?.body.requirements.map(item => item.id)).toEqual(['check-1', 'check-2']);
  expect(flow?.nodes[0]?.body.scripts).toEqual([
    { entry: firstEntry, relation: 'independent', condition: '合成条件 link-a' },
    { entry: secondEntry, relation: 'alternative', condition: '合成条件 link-b' },
  ]);
  expect(flow?.nodes.find(node => node.id === 'finish')?.body.scripts).toEqual([{ entry: firstEntry, relation: 'complementary', condition: '合成条件 link-c' }]);
  expect(flow?.nodes.filter(node => node.body.kind === 'terminal').every(node => !flow.edges.some(edge => edge.from === node.id))).toBe(true);
  expect(result.scriptBodies).toEqual([{ entry: firstEntry, title: '合成说明 A', answerText: '唯一合成正文 A' }, { entry: secondEntry, title: '合成说明 B', answerText: '唯一合成正文 B' }]);
  expect(JSON.stringify(flow)).not.toContain('唯一合成正文');
  expect(result.media).toHaveLength(3);
  expect(result.media).toEqual(expect.arrayContaining([
    expect.objectContaining({ graphTarget: { kind: 'task', id: 'inspect' }, audience: 'agent', required: true, bytes: png.length, sha256 }),
    expect.objectContaining({ graphTarget: { kind: 'knowledge', id: 'manual' }, audience: 'agent', required: false }),
    expect.objectContaining({ entry: firstEntry, audience: 'customer' }),
  ]));
  const directory = process.env.SOP_TASK_GRAPH_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    const workbookBytes = workbookInputs.get(document);
    if (!workbookBytes) throw new Error('Synthetic workbook bytes missing');
    await writeFile(join(directory, 'synthetic-workbook.xlsx'), workbookBytes);
    await writeFile(join(directory, 'parsed-document.json'), JSON.stringify(document, null, 2));
    await writeFile(join(directory, 'prepared-draft.json'), JSON.stringify(result, null, 2));
    await writeFile(join(directory, 'explicit-mapping.json'), JSON.stringify(mapping(), null, 2));
  }
});

it('supports a graph with only knowledge and tasks, no FAQ body or anchor', async () => {
  const document = await fixture(rows => rows.filter(row => row.sheet !== '客户话术' && row.fields.记录类型 !== '话术引用' && row.fields.资源编号 !== 'customer-image'));
  const input = mapping();
  const result = prepared(document, { ...input, entries: [], images: input.images.filter(item => item.owner.kind !== 'script'),
    resourceScopes: input.resourceScopes.filter(item => item.resourceId !== 'customer-image') });
  expect(result.scriptBodies).toEqual([]);
  expect(result.flows[0]?.header.anchorEntry).toBeNull();
  expect(result.flows[0]?.nodes.every(node => node.body.scripts.length === 0)).toBe(true);
  expect(result.flows[0]?.nodes[0]?.body.knowledge).toHaveLength(1);
});

it('keeps a caller-selected anchor and maps text resources through the existing Knowledge binding', async () => {
  const document = await fixture(rows => rows.map(row => row.fields.任务编号 === 'inspect' && row.fields.记录类型 === '任务'
    ? { ...row, fields: { ...row.fields, 关联资源编号: 'task-image,text-guide' } } : row).concat([
    { sheet: '资源与图片', fields: { 资源编号: 'text-guide', 资源类型: '资料', 资源名称: '合成资料', 资源内容: '合成资源正文',
      适用范围: '合成范围', 可见对象: '坐席可读', 维护状态: '待发布', 业务确认人: '合成声明人' } },
  ]));
  const input = mapping();
  const result = prepared(document, { ...input, flows: input.flows.map(flow => ({ ...flow, anchorScriptId: 'wording-a' })),
    resourceScopes: [...input.resourceScopes, { resourceId: 'text-guide', applicability }] });
  expect(result.flows[0]?.header.anchorEntry).toEqual(firstEntry);
  expect(result.flows[0]?.nodes[0]?.body.knowledge).toContainEqual({ id: 'text-guide', title: '合成资料', body: '合成资源正文',
    audience: 'agent', resourceBinding: { resourceId: 'text-guide', ownerKind: 'task', ownerId: 'inspect' } });
});

it('preserves customer media owned only by an explicitly selected anchor', async () => {
  const document = await fixture(rows => rows.filter(row => row.fields.关联编号 !== 'link-a' && row.fields.关联编号 !== 'link-c'));
  const input = mapping();
  const result = prepared(document, { ...input, flows: input.flows.map(flow => ({ ...flow, anchorScriptId: 'wording-a' })) });
  expect(result.media.filter(item => 'entry' in item)).toHaveLength(1);
  expect(result.flows[0]?.nodes.flatMap(node => node.body.scripts)).toHaveLength(1);
});

it('ignores stopped historical rows without treating missing rows as disable operations', async () => {
  const document = await fixture();
  const task = document.tasks[0];
  if (!task) throw new Error('Synthetic task missing');
  const stopped = { state: '停用', confirmerText: '', pendingText: '' } as const;
  const result = prepared({ ...document, tasks: [...document.tasks, { ...task, id: 'old-task', review: stopped }],
    requirements: [...document.requirements, { id: 'old-check', taskId: 'inspect', label: '旧确认', ordinal: null, review: stopped }],
    branches: [...document.branches, { id: 'old-choice', taskId: 'choose', label: '旧选项', targetTaskId: 'old-task', criterion: '',
      unableToDetermine: false, ordinal: null, matchTerms: null, review: stopped }],
    scriptLinks: [...document.scriptLinks, { origin: 'explicit', id: 'old-link', taskId: 'inspect', scriptId: 'old-script',
      condition: '', relationship: '独立', review: stopped }] });
  expect(result.flows[0]?.nodes).toHaveLength(4);
  expect(result.flows.every(flow => flow.header.operation === 'upsert')).toBe(true);
});

it.each([
  ['source', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, flows: m.flows.map(flow => ({ ...flow, key: { ...flow.key, sourceId: '' } })) })],
  ['flow version', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, flows: m.flows.map(flow => ({ ...flow, key: { ...flow.key, flowVersion: 0 } })) })],
  ['flow scope', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, flows: [] })],
  ['entry', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, entries: [] })],
  ['cross-source entry', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, entries: m.entries.map(item => ({ ...item, entry: { ...item.entry, sourceId: 'other-source' } })) })],
  ['next edge', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, nextEdges: [] })],
  ['image', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, images: [] })],
  ['resource scope', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, resourceScopes: [] })],
  ['image hash', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, images: m.images.map(item => ({ ...item, sha256: '0'.repeat(64) })) })],
  ['image owner', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, images: m.images.map(item => ({ ...item, owner: { kind: 'task', id: 'unknown' } })) })],
  ['conflicting entry', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, entries: m.entries.map(item => ({ ...item, entry: firstEntry })) })],
  ['edge collision', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, nextEdges: [{ taskId: 'inspect', edgeId: 'complete' }] })],
  ['invalid dates', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, flows: m.flows.map(flow => ({ ...flow, effectiveFrom: '2026-02-30T00:00:00Z' })) })],
  ['unresolved term version', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, flows: m.flows.map(flow => ({ ...flow,
    applicability: { productRefs: [{ id: 'term', displayVersion: 0 }], scenarioRefs: [] } })) })],
  ['duplicate media mapping', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, images: [...m.images, ...m.images] })],
  ['broadened image scope', (m: SopTaskGraphMapping): SopTaskGraphMapping => ({ ...m, resourceScopes: m.resourceScopes.map(item => ({
    ...item, applicability: { productRefs: [], scenarioRefs: [] },
  })) })],
])('requires explicit valid %s mapping without partial output', async (_name, change) => {
  const result = prepareSopTaskGraphDraft(await fixture(), change(mapping()));
  expect(result.kind).toBe('needs-information');
  expect(result).not.toHaveProperty('flows');
  expect(result).not.toHaveProperty('scriptBodies');
  expect(result.publishable).toBe(false);
});

it.each(['停用', '草稿'] as const)('blocks an active reference to a %s script', async state => {
  const document = await fixture();
  const result = prepareSopTaskGraphDraft({ ...document, scripts: document.scripts.map(script => script.id === 'wording-a'
    ? { ...script, review: { ...script.review, state } } : script) }, mapping());
  expect(result.kind).toBe('needs-information');
});

it('blocks missing task/knowledge/resource references and unconfirmed branch or confirmation fields', async () => {
  const document = await fixture();
  const cases: MaintenanceDocument[] = [
    { ...document, tasks: document.tasks.filter(task => task.id !== 'help') },
    { ...document, knowledge: [] },
    { ...document, scripts: [] },
    { ...document, resources: document.resources.filter(item => item.id !== 'task-image') },
    { ...document, branches: document.branches.map(item => ({ ...item, matchTerms: null })) },
    { ...document, requirements: document.requirements.map(item => ({ ...item, ordinal: null })) },
    { ...document, tasks: document.tasks.map(item => ({ ...item, requirements: { kind: 'unconfirmed', legacyText: null } })) },
  ];
  for (const input of cases) expect(prepareSopTaskGraphDraft(input, mapping()).kind).toBe('needs-information');
});

it('retains explicit open questions and rejects titles beyond the candidate bound without truncation', async () => {
  const document = await fixture();
  const first = document.tasks[0];
  if (!first) throw new Error('Synthetic task missing');
  for (const task of [{ ...first, title: '合'.repeat(513) }, { ...first, review: { ...first.review, pendingText: '合成待确认' } }]) {
    const result = prepareSopTaskGraphDraft({ ...document, tasks: [task, ...document.tasks.slice(1)] }, mapping());
    expect(result.kind).toBe('needs-information');
  }
});

it('does not convert coach content or a customer-facing text resource into agent knowledge', async () => {
  const document = await fixture();
  const cases: MaintenanceDocument[] = [
    { ...document, knowledge: document.knowledge.map(item => ({ ...item, visibility: '主管可读' })) },
    { ...document, resources: document.resources.map(item => item.id === 'customer-image'
      ? { id: item.id, kind: 'document', title: item.title, content: '合成对客附件', visibility: item.visibility,
        scopeText: item.scopeText, imageCellText: '', review: item.review } : item) },
  ];
  for (const input of cases) expect(prepareSopTaskGraphDraft(input, mapping()).kind).toBe('needs-information');
});

it('keeps one authored knowledge record and emits the candidate-required inline projections', async () => {
  const document = await fixture();
  const result = prepared({ ...document, tasks: document.tasks.map(task => task.id === 'finish' ? { ...task, knowledgeIds: ['manual'] } : task) });
  expect(document.knowledge).toHaveLength(1);
  const copies = result.flows[0]?.nodes.flatMap(node => node.body.knowledge.filter(item => item.id === 'manual'));
  expect(copies).toHaveLength(2);
  expect(copies?.every(item => item.body === document.knowledge[0]?.body)).toBe(true);
  expect(result.scriptBodies).toHaveLength(2);
  expect(result.media).toHaveLength(3);
});

it('accepts explicitly narrower image scope without widening the flow', async () => {
  const document = await fixture();
  const input = mapping();
  const wider = { productRefs: [...applicability.productRefs, { id: 'another-synthetic-product', displayVersion: 1 }], scenarioRefs: [] };
  const result = prepared(document, { ...input, flows: input.flows.map(flow => ({ ...flow, applicability: wider })) });
  expect(result.flows[0]?.header.applicability).toEqual(wider);
  expect(result.media.every(item => item.applicability.productRefs.length === 1)).toBe(true);
});

it('reports standalone knowledge as unrepresentable instead of inventing a task or schema field', async () => {
  const document = await fixture();
  const result = prepareSopTaskGraphDraft({ ...document, tasks: [], branches: [], requirements: [], scriptLinks: [], scripts: [], resources: [] },
    { ...mapping(), entries: [], images: [], nextEdges: [], resourceScopes: [] });
  expect(result.kind).toBe('needs-information');
  if (result.kind !== 'needs-information') throw new Error('Expected missing information');
  expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'unrepresentable', field: 'nodes' }));
  expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'unrepresentable', recordId: 'manual', field: 'knowledge' }));
});
