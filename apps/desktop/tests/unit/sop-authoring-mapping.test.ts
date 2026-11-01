// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { advanceSopNext, chooseSopEdge, projectSop, validateSopTree, type SopNode, type SopTree } from '../../src/shared/sop-model';
import { isSopProjection, matchSopChoices } from '../../src/shared/sop-window';
import { MISSING_ITEM_SOP_TREE as tree } from '../../src/shared/synthetic-sops';
import { checkSopMaintenance, parseSopMaintenance, type MaintenanceParseResult } from '../../../../packages/content-intake/src/maintenance';
import { readAuthoringWorkbook, writeAuthoringWorkbook, type AuthoringRecord, type AuthoringSheet } from '../../../../packages/content-intake/tests/fixtures/sop-authoring-workbook';

const entryTerms = ['少件', '漏发', '少发', '没收到全部'];
const choiceOrdinals: Readonly<Record<string, number>> = {
  'classify.split': 1, 'classify.missing': 2, 'classify.unknown': 3,
  'recheck.split': 1, 'recheck.review': 2,
};
const requirementOrdinals: Readonly<Record<string, number>> = { ordered: 1, received: 2, submitted: 1, supplemented: 1 };
const associationIds: Readonly<Record<string, string>> = {
  'syn-missing-ask': 'link-missing-ask', 'syn-missing-ack': 'link-missing-ack',
  'syn-missing-transit': 'link-missing-transit', 'syn-missing-escalate': 'link-missing-escalate',
  'syn-missing-supplement': 'link-missing-supplement',
};

function matchTermsCell(terms: readonly string[]): string {
  if (!terms.length) return '不设置';
  return terms.map(term => /^\\*不设置$/u.test(term) ? `\\${term}` : term).join('\n');
}

function recordsForMissingItem(): AuthoringRecord[] {
  const records: AuthoringRecord[] = [];
  const add = (sheet: AuthoringSheet, fields: Record<string, string>) => records.push({ sheet,
    fields: { 维护状态: '待发布', 业务确认人: '合成确认人', ...fields } });
  add('场景目录', { 场景编号: tree.sceneId, 场景名称: tree.sceneTitle, 起始任务编号: tree.startNodeId,
    适用范围: '仅合成少件验证', 入口词: entryTerms.join('\n') });
  for (const node of tree.nodes) {
    add('执行任务', { 记录类型: '任务', 任务编号: node.id, 场景编号: tree.sceneId, 阶段: node.stageLabel, 任务名称: node.title,
      任务类型: node.kind === 'action' ? '操作' : node.kind === 'decision' ? '判断' : '终点', 操作要求: node.instruction,
      确认项配置: node.requirements.length ? '有确认项' : '无确认项',
      下一任务编号: node.kind === 'action' ? node.nextId : '', 关联知识编号: node.knowledge.map(item => item.id).join(','), 可见对象: '坐席可读' });
    for (const item of node.requirements) {
      const ordinal = requirementOrdinals[item.id];
      if (ordinal === undefined) throw new Error('Synthetic confirmation order is missing');
      add('执行任务', { 记录类型: '确认项', 任务编号: node.id, 确认项编号: item.id, 确认项文字: item.label, 确认项顺序: String(ordinal) });
    }
    if (node.kind === 'decision') for (const edge of node.edges) {
      const id = `${node.id}.${edge.id}`;
      const ordinal = choiceOrdinals[id];
      if (ordinal === undefined) throw new Error('Synthetic choice order is missing');
      add('判断分支', { 分支编号: id, 任务编号: node.id, 选项: edge.label, 判断依据: edge.criterion,
        目标任务编号: edge.targetId, 是否无法判断: edge.unableToDetermine ? '是' : '否',
        匹配词: matchTermsCell(edge.matchTerms), 分支顺序: String(ordinal) });
    }
    for (const script of node.scripts) {
      const associationId = associationIds[script.id];
      if (!associationId) throw new Error('Synthetic association ID is missing');
      add('客户话术', { 话术编号: script.id, 话术标题: script.title, 对客正文: script.answerText });
      add('执行任务', { 记录类型: '话术引用', 关联编号: associationId, 任务编号: node.id, 话术编号: script.id,
        适用条件: script.condition, 话术关系: '独立' });
    }
    for (const knowledge of node.knowledge) add('知识与案例', { 知识编号: knowledge.id, 标题: knowledge.title, 正文: knowledge.body, 可见对象: '坐席可读' });
    // A restricted note is retained separately, never made a required seat reference.
    if (node.managerNote) add('知识与案例', { 知识编号: `${node.id}.manager`, 标题: `${node.title}主管说明`, 正文: node.managerNote, 可见对象: '主管可读' });
  }
  return records;
}

// A test-only projection exercises navigation from the parsed workbook; it is not a publication adapter.
function syntheticNavigation(result: MaintenanceParseResult): SopTree {
  if (result.kind !== 'parsed' || result.report.status !== 'reviewed') throw new Error('Synthetic authoring requires completed local checks');
  const { document } = result;
  const activeScenes = document.scenes.filter(item => item.review.state !== '停用');
  const scene = activeScenes[0];
  if (!scene || activeScenes.length !== 1) throw new Error('Expected one synthetic scene');
  const nodes: SopNode[] = document.tasks.filter(task => task.review.state !== '停用').map(task => {
    if (task.sceneId !== scene.id || task.requirements.kind === 'unconfirmed') throw new Error('Synthetic task is unresolved');
    const requirements = document.requirements.filter(item => item.taskId === task.id && item.review.state !== '停用')
      .map(item => {
        if (item.ordinal === null) throw new Error('Synthetic confirmation order is unresolved');
        return { id: item.id, label: item.label, ordinal: item.ordinal };
      }).sort((a, b) => a.ordinal - b.ordinal).map(({ id, label }) => ({ id, label }));
    const scripts = document.scriptLinks.filter(link => link.taskId === task.id && link.review.state !== '停用').map(link => {
      const script = document.scripts.find(item => item.id === link.scriptId && item.review.state !== '停用');
      if (!script || link.origin !== 'explicit') throw new Error('Synthetic script link is unresolved');
      return { id: script.id, title: script.title, answerText: script.answerText, condition: link.condition };
    });
    const knowledge = task.knowledgeIds.map(id => {
      const item = document.knowledge.find(entry => entry.id === id && entry.review.state !== '停用');
      if (!item) throw new Error('Synthetic knowledge is missing');
      return { id: item.id, title: item.title, body: item.body };
    });
    const base = { id: task.id, title: task.title, instruction: task.instruction, stageLabel: task.stage, requirements, scripts, knowledge };
    if (task.kind === 'action') return { ...base, kind: 'action', nextId: task.nextTaskId };
    if (task.kind === 'terminal') return { ...base, kind: 'terminal' };
    const edges = document.branches.filter(branch => branch.taskId === task.id && branch.review.state !== '停用').map(branch => {
      if (branch.ordinal === null || branch.matchTerms === null) throw new Error('Synthetic branch is unresolved');
      return { id: branch.id, label: branch.label, criterion: branch.criterion, targetId: branch.targetTaskId,
        unableToDetermine: branch.unableToDetermine, matchTerms: branch.matchTerms, ordinal: branch.ordinal };
    }).sort((a, b) => a.ordinal - b.ordinal);
    return { ...base, kind: 'decision', edges };
  });
  const projected: SopTree = { sceneId: scene.id, sceneTitle: scene.title, stageLabel: '合成导航测试',
    version: document.templateVersion, startNodeId: scene.startTaskId, nodes };
  validateSopTree(projected);
  return projected;
}

it('preserves the synthetic missing-item terms and navigation through a six-sheet XLSX', async () => {
  const records = recordsForMissingItem();
  const bytes = await writeAuthoringWorkbook(records);
  const parsed = await parseSopMaintenance(bytes);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  const { report, document } = parsed;
  const projected = syntheticNavigation(parsed);
  expect(report).toMatchObject({ status: 'reviewed', publishable: false, entries: tree.nodes.length, issues: [],
    counts: { 场景目录: 1, 执行任务: 16, 判断分支: 5, 客户话术: 5, 知识与案例: 3, 资源与图片: 0 } });
  const scene = document.scenes.find(item => item.id === tree.sceneId);
  expect(scene).toMatchObject({ startTaskId: tree.startNodeId, entryTerms });
  expect(document.publishable).toBe(false);
  const reopened = await readAuthoringWorkbook(bytes);
  for (const record of records) expect(reopened).toContainEqual({ sheet: record.sheet, fields: expect.objectContaining(record.fields) });
  expect(reopened).toHaveLength(records.length);
  for (const node of tree.nodes) {
    const task = reopened.find(record => record.sheet === '执行任务' && record.fields.记录类型 === '任务' && record.fields.任务编号 === node.id);
    const parsedTask = document.tasks.find(item => item.id === node.id);
    expect(parsedTask).toMatchObject({ id: node.id, sceneId: tree.sceneId, kind: node.kind, instruction: node.instruction });
    expect(parsedTask?.requirements.kind).toBe(node.requirements.length ? 'specified' : 'none');
    expect(document.requirements.filter(item => item.taskId === node.id).map(item => ({ id: item.id, label: item.label, ordinal: item.ordinal })))
      .toEqual(node.requirements.map(item => ({ ...item, ordinal: requirementOrdinals[item.id] })));
    for (const script of node.scripts) {
      expect(document.scripts.find(item => item.id === script.id)).toMatchObject({ title: script.title, answerText: script.answerText });
      expect(document.scriptLinks.find(item => item.id === associationIds[script.id])).toMatchObject({ origin: 'explicit', taskId: node.id,
        scriptId: script.id, condition: script.condition, relationship: '独立' });
    }
    const progress = { sceneId: tree.sceneId, nodeId: node.id, stepIndex: 1 };
    if (node.kind === 'action') {
      expect(parsedTask).toMatchObject({ nextTaskId: node.nextId });
      expect(advanceSopNext(projected, progress)?.nodeId).toBe(node.nextId);
    }
    if (node.kind === 'decision') for (const edge of node.edges) {
      const id = `${node.id}.${edge.id}`;
      const branch = document.branches.find(item => item.id === id);
      expect(branch).toMatchObject({ taskId: node.id, label: edge.label, criterion: edge.criterion, targetTaskId: edge.targetId,
        unableToDetermine: edge.unableToDetermine, matchTerms: edge.matchTerms, ordinal: choiceOrdinals[id] });
      expect(chooseSopEdge(projected, progress, id)?.nodeId).toBe(branch?.targetTaskId);
    }
    if (node.managerNote) {
      expect(task?.fields.关联知识编号).not.toContain(`${node.id}.manager`);
      expect(reopened.find(record => record.fields.知识编号 === `${node.id}.manager`)?.fields).toMatchObject({ 正文: node.managerNote, 可见对象: '主管可读' });
    }
  }
  const next = (id: string): string => {
    const task = document.tasks.find(item => item.id === id);
    if (!task || task.kind !== 'action') throw new Error('Synthetic action missing');
    return task.nextTaskId;
  };
  const choose = (taskId: string, id: string): string => {
    const branch = document.branches.find(item => item.taskId === taskId && item.id === id);
    if (!branch) throw new Error('Synthetic branch missing');
    return branch.targetTaskId;
  };
  expect(scene?.startTaskId).toBe('collect');
  expect(next('collect')).toBe('classify');
  expect(choose('classify', 'classify.unknown')).toBe('supplement');
  expect(next('supplement')).toBe('recheck');
  expect(choose('recheck', 'recheck.review')).toBe('escalate');
  expect(next('escalate')).toBe('done');
  const directory = process.env.SOP_AUTHORING_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'synthetic-missing-item.xlsx'), bytes, { mode: 0o600 });
    await writeFile(resolve(directory, 'synthetic-missing-item-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
});

it('projects a shared synthetic script from one workbook body into two tasks with their own conditions', async () => {
  const records = recordsForMissingItem();
  records.push({ sheet: '执行任务', fields: { 记录类型: '话术引用', 关联编号: 'link-shared-done', 任务编号: 'done',
    话术编号: 'syn-missing-ack', 适用条件: '合成完成条件', 话术关系: '配套', 维护状态: '待发布', 业务确认人: '合成确认人' } });
  const parsed = await parseSopMaintenance(await writeAuthoringWorkbook(records));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.scripts.filter(item => item.id === 'syn-missing-ack')).toHaveLength(1);
  expect(parsed.document.scriptLinks.filter(item => item.scriptId === 'syn-missing-ack')).toEqual([
    expect.objectContaining({ id: 'link-missing-ack', taskId: 'collect', condition: '客户已提供所需信息', relationship: '独立' }),
    expect.objectContaining({ id: 'link-shared-done', taskId: 'done', condition: '合成完成条件', relationship: '配套', review: expect.objectContaining({ state: '待发布' }) }),
  ]);
  const projected = syntheticNavigation(parsed);
  const first = projected.nodes.find(node => node.id === 'collect')?.scripts.find(script => script.id === 'syn-missing-ack');
  const second = projected.nodes.find(node => node.id === 'done')?.scripts.find(script => script.id === 'syn-missing-ack');
  expect(first?.answerText).toBe(parsed.document.scripts.find(script => script.id === 'syn-missing-ack')?.answerText);
  expect(second).toMatchObject({ answerText: first?.answerText, condition: '合成完成条件' });
  expect(first?.condition).toBe('客户已提供所需信息');
});

it('omits stopped historical tasks, links, confirmations and branches from the synthetic projection', async () => {
  const records = recordsForMissingItem();
  const stopped = { 维护状态: '停用', 业务确认人: '合成确认人' };
  records.push(
    { sheet: '执行任务', fields: { ...stopped, 记录类型: '任务', 任务编号: 'old-task', 场景编号: tree.sceneId,
      阶段: '历史阶段', 任务名称: '已停用任务', 任务类型: '终点', 操作要求: '保留合成历史', 确认项配置: '无确认项', 可见对象: '坐席可读' } },
    { sheet: '执行任务', fields: { ...stopped, 记录类型: '话术引用', 关联编号: 'old-link', 任务编号: 'collect',
      话术编号: 'syn-missing-ack', 适用条件: '旧的合成条件', 话术关系: '替代' } },
    { sheet: '执行任务', fields: { ...stopped, 记录类型: '确认项', 确认项编号: 'old-requirement', 任务编号: 'collect',
      确认项文字: '旧的合成检查', 确认项顺序: '1' } },
    { sheet: '判断分支', fields: { ...stopped, 分支编号: 'classify.old', 任务编号: 'classify', 选项: '旧的合成选项', 判断依据: '合成依据',
      目标任务编号: 'in-transit', 是否无法判断: '否', 匹配词: '旧词', 分支顺序: '1' } },
  );
  const parsed = await parseSopMaintenance(await writeAuthoringWorkbook(records));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.tasks.find(task => task.id === 'old-task')?.review.state).toBe('停用');
  expect(parsed.document.scriptLinks.find(link => link.id === 'old-link')?.review.state).toBe('停用');
  expect(parsed.document.requirements.find(item => item.id === 'old-requirement')?.review.state).toBe('停用');
  expect(parsed.document.branches.find(branch => branch.id === 'classify.old')?.review.state).toBe('停用');
  const projected = syntheticNavigation(parsed);
  expect(projected.nodes.some(node => node.id === 'old-task')).toBe(false);
  const collect = projected.nodes.find(node => node.id === 'collect');
  expect(collect?.scripts.filter(script => script.id === 'syn-missing-ack')).toHaveLength(1);
  expect(collect?.requirements.some(item => item.id === 'old-requirement')).toBe(false);
  const classify = projected.nodes.find(node => node.id === 'classify');
  expect(classify?.kind).toBe('decision');
  if (classify?.kind !== 'decision') throw new Error('Synthetic decision missing');
  expect(classify.edges.some(edge => edge.id === 'classify.old')).toBe(false);
});

it.each([
  ['draft association', (record: AuthoringRecord) => record.sheet === '执行任务' && record.fields.关联编号 === 'link-missing-ack'
    ? { ...record, fields: { ...record.fields, 维护状态: '草稿' } } : record],
  ['pending scope', (record: AuthoringRecord) => record.sheet === '场景目录'
    ? { ...record, fields: { ...record.fields, 适用范围: ' 待确认 ' } } : record],
  ['missing task stage', (record: AuthoringRecord) => record.sheet === '执行任务' && record.fields.记录类型 === '任务' && record.fields.任务编号 === 'collect'
    ? { ...record, fields: { ...record.fields, 阶段: '' } } : record],
])('rejects %s from the synthetic execution projection', async (_name, mutate) => {
  const parsed = await parseSopMaintenance(await writeAuthoringWorkbook(recordsForMissingItem().map(mutate)));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(() => syntheticNavigation(parsed)).toThrow('Synthetic authoring requires completed local checks');
});

it.each([' 原文 ', '😀'.repeat(128)])('preserves a valid authored term through the synthetic projection', async term => {
  const records = recordsForMissingItem().map(record => record.sheet === '判断分支' && record.fields.分支编号 === 'classify.split'
    ? { ...record, fields: { ...record.fields, 匹配词: term } } : record);
  const parsed = await parseSopMaintenance(await writeAuthoringWorkbook(records));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.branches.find(branch => branch.id === 'classify.split')?.matchTerms).toEqual([term]);
  const projected = syntheticNavigation(parsed);
  const view = projectSop({ tree: projected, progress: { sceneId: tree.sceneId, nodeId: 'classify', stepIndex: 1 }, role: 'agent', taskId: 'mapping', revision: 1 });
  expect(isSopProjection(view)).toBe(true);
  expect(view.edges.find(edge => edge.id === 'classify.split')?.matchTerms).toEqual([term]);
  expect(matchSopChoices(term.trim(), view.edges).get('classify.split')).toEqual([term]);
});

it('rejects an authored term beyond 128 Unicode code points before projection', async () => {
  const records = recordsForMissingItem().map(record => record.sheet === '判断分支' && record.fields.分支编号 === 'classify.split'
    ? { ...record, fields: { ...record.fields, 匹配词: '😀'.repeat(129) } } : record);
  const parsed = await parseSopMaintenance(await writeAuthoringWorkbook(records));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('INVALID_TERM');
  expect(() => syntheticNavigation(parsed)).toThrow('Synthetic authoring requires completed local checks');
});

it('rejects losing the unknown branch or exposing the restricted note as required seat knowledge', async () => {
  const records = recordsForMissingItem();
  const noUnknown = records.map(record => record.sheet === '判断分支' ? { ...record, fields: { ...record.fields, 是否无法判断: '否' } } : record);
  expect((await checkSopMaintenance(await writeAuthoringWorkbook(noUnknown))).issues.map(issue => issue.code)).toContain('UNKNOWN_BRANCH_REQUIRED');
  const exposed = records.map(record => record.sheet === '执行任务' && record.fields.记录类型 === '任务' && record.fields.任务编号 === 'escalate'
    ? { ...record, fields: { ...record.fields, 关联知识编号: 'escalate.manager' } } : record);
  expect((await checkSopMaintenance(await writeAuthoringWorkbook(exposed))).issues.map(issue => issue.code)).toContain('VISIBILITY_MISMATCH');
});
