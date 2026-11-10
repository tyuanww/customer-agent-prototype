import ExcelJS from 'exceljs';
import { SOP_TASK_HEADERS, SOP_TASK_SHEETS, type SopTaskSheet } from '../../src/sop-task-workbook.js';

export const graphApplicability = (solo = false, shopWide = false) => shopWide ? { productRefs: [], scenarioRefs: [] } : ({ productRefs: [{ id: solo ? 'product-solo' : 'product-graph', displayVersion: 1 }],
  scenarioRefs: [{ id: solo ? 'scenario-solo' : 'scenario-graph', displayVersion: 1 }] });
export function syntheticGraphMapping(solo = false, shopWide = false, queryBudgetProbe = false, qualityCount = 0) {
  const metadata = { questions: [], ...graphApplicability(solo, shopWide), effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: '2099-01-01T00:00:00.000Z', applicabilityNote: '合成明确范围', familySourceId: null, familyBusinessEntryId: null,
    brandNonOverridable: false, category: '合成分类', internalNote: '合成内部说明', riskNote: '', attachmentNote: '' };
  return { flows: solo ? { 'flow-solo': { anchorEntry: null, audience: 'agent' } } : { 'flow-main': { anchorEntry: 'script-a', audience: 'agent' } },
    sourceClaim: { versionKind: 'unknown', versionValue: null, acquisition: 'controlled-synthetic-export' },
    riskLevel: 'routine',
    entries: solo ? {} : { 'script-a': metadata, 'script-b': metadata,
      ...Object.fromEntries(Array.from({ length: qualityCount }, (_, index) => [`quality-script-${index}`, metadata])),
      ...Object.fromEntries((queryBudgetProbe ? Array.from({ length: 12 }, (_, index) => `budget-script-${index}`) : []).map(id => [id, metadata])) },
    images: solo ? {} : Object.fromEntries(['image-entry', 'image-task', 'image-knowledge'].map(id => [id, { required: true, alt: `合成 ${id}`, ordinal: 1 }])) };
}
export const graphImageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');
export const graphImageFixtures = new Map<string, { bytes: Buffer; extension: 'png' | 'gif' }>([
  ['image-entry', { bytes: graphImageBytes, extension: 'png' }],
  ['image-task', { bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), extension: 'gif' }],
  ['image-knowledge', { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), extension: 'png' }],
]);

export async function readSyntheticQualityReport(bytes: Buffer): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = book.getWorksheet('质量证据');
  if (!sheet) throw new Error('Missing complete quality evidence worksheet');
  const rows: string[][] = [];
  sheet.eachRow((row, index) => { if (index > 1) rows.push([1, 2, 3].map(column => row.getCell(column).text)); });
  return rows;
}

export async function syntheticTaskGraphWorkbook(options: { qualityCount?: number; withoutTaskImages?: boolean; narrowKnowledgeImage?: boolean; sharedTaskImage?: boolean; effectiveTo?: string; queryBudgetProbe?: boolean; shopWide?: boolean; revision?: number; solo?: boolean; disable?: boolean;
  missingUnknown?: boolean; unresolvedConfirmation?: boolean; wrongHeader?: boolean; longTaskId?: boolean } = {}) {
  const { revision = 1, solo = false } = options;
  const book = new ExcelJS.Workbook();
  for (const name of SOP_TASK_SHEETS) book.addWorksheet(name).addRow([...SOP_TASK_HEADERS[name]]);
  const row = (sheet: SopTaskSheet, values: Record<string, string>) => book.getWorksheet(sheet)!.addRow(SOP_TASK_HEADERS[sheet]
    .map(header => ({ 维护状态: '启用', 业务确认人: '合成来源维护人', 待确认事项: '', ...values })[header] ?? ''));
  const flowId = solo ? 'flow-solo' : 'flow-main', scope = JSON.stringify(graphApplicability(solo, options.shopWide));
  row('场景目录', { 场景编号: flowId, 场景名称: `合成流程 ${revision}`, 适用范围: scope, 起始任务编号: 'task-a',
    入口词: JSON.stringify(['合成入口', '明确流程']), 生效时间: '2020-01-01T00:00:00.000Z', 失效时间: options.effectiveTo ?? '2099-01-01T00:00:00.000Z',
    维护状态: options.disable ? '停用' : '启用' });
  const task = (id: string, kind: string, fields: Record<string, string> = {}) => row('执行任务', { 记录类型: '任务', 任务编号: id, 场景编号: flowId,
    阶段: '合成阶段', 任务名称: `合成任务 ${id}`, 任务类型: kind, 操作要求: `合成操作原文 ${id} ${revision}`,
    确认项配置: '无确认项', 关联知识编号: '[]', 关联资源编号: '[]', 可见对象: '坐席可读', ...fields });
  if (solo) task('task-a', '结束');
  else {
    task('task-a', '操作', { 下一任务编号: 'task-b', 确认项配置: options.unresolvedConfirmation ? '' : '有确认项',
      关联知识编号: '["knowledge-a"]', 关联资源编号: options.withoutTaskImages ? '["document-a"]' : '["document-a","image-task"]' });
    task('task-b', '判断', options.sharedTaskImage && !options.withoutTaskImages ? { 关联资源编号: '["image-task"]' } : {}); task('task-known', '结束'); task('task-unknown', '结束');
    for (const [id, ordinal] of [['confirm-a', '1'], ['confirm-b', '2']]) row('执行任务', { 记录类型: '确认项', 任务编号: 'task-a', 场景编号: flowId,
      确认项编号: id!, 确认项文字: `合成确认 ${id}`, 确认项顺序: ordinal! });
    for (const [id, taskId, scriptId, relation] of [
      ['association-a', 'task-a', 'script-a', '独立'], ['association-b', 'task-a', 'script-b', '替代'],
      ['association-c', 'task-b', 'script-a', '配套'],
    ]) row('执行任务', { 记录类型: '话术引用', 任务编号: taskId!, 场景编号: flowId, 关联编号: id!, 话术编号: scriptId!, 适用条件: '合成显式条件', 话术关系: relation! });
    for (const [id, title, target, unknown, ordinal] of [
      ['branch-known', '已确认', 'task-known', '否', '1'], ['branch-unknown', '无法判断', 'task-unknown', options.missingUnknown ? '否' : '是', '2'],
    ]) row('判断分支', { 分支编号: id!, 任务编号: 'task-b', 选项: title!, 判断依据: `合成依据 ${id}`, 目标任务编号: target!,
      是否无法判断: unknown!, 匹配词: JSON.stringify([`合成匹配 ${id}`]), 分支顺序: ordinal! });
    row('客户话术', { 话术编号: 'script-a', 话术标题: '合成对客 A', 对客正文: `合成对客原文 A\n版本 ${revision}`, 关联资源编号: '["image-entry"]' });
    row('客户话术', { 话术编号: 'script-b', 话术标题: '合成对客 B', 对客正文: '合成对客原文 B', 关联资源编号: '[]' });
    for (let index = 0; index < (options.qualityCount ?? 0); index++) row('客户话术', { 话术编号: `quality-script-${index}`,
      话术标题: `合成质量话术 ${index}`, 对客正文: `合成质量正文 ${index}`, 关联资源编号: '[]' });
    if (options.queryBudgetProbe) for (let index = 0; index < 12; index++) {
      const id = `budget-script-${index}`;
      row('客户话术', { 话术编号: id, 话术标题: `合成大正文 ${index}`, 对客正文: '合'.repeat(32700), 关联资源编号: '[]' });
      row('执行任务', { 记录类型: '话术引用', 任务编号: 'task-a', 场景编号: flowId, 关联编号: `budget-association-${index}`,
        话术编号: id, 适用条件: '合成响应字节上限验证', 话术关系: '独立' });
    }
    row('知识与案例', { 知识编号: 'knowledge-a', 标题: '合成知识', 正文: '合成知识原文', 可见对象: '坐席可读', 关联资源编号: '["image-knowledge"]' });
    row('资源与图片', { 资源编号: 'document-a', 资源类型: '资料', 资源名称: '合成资料', 可见对象: '坐席可读', 适用范围: scope, 资源内容: '合成资料原文' });
    for (const id of ['image-entry', 'image-task', 'image-knowledge'].filter(id => !options.withoutTaskImages || id !== 'image-task')) {
      const data = row('资源与图片', { 资源编号: id, 资源类型: '图片', 资源名称: `合成 ${id}`, 可见对象: id === 'image-entry' ? '对客可用' : '坐席可读', 适用范围: options.narrowKnowledgeImage && id === 'image-knowledge'
        ? JSON.stringify({ productRefs: [{ id: 'product-query-image', displayVersion: 1 }], scenarioRefs: [] }) : scope });
      const fixture = graphImageFixtures.get(id)!;
      const image = book.addImage({ base64: fixture.bytes.toString('base64'), extension: fixture.extension });
      book.getWorksheet('资源与图片')!.addImage(image, { tl: { col: 6, row: data.number - 1 }, ext: { width: 1, height: 1 } });
    }
  }
  if (options.wrongHeader) book.getWorksheet('执行任务')!.getCell('A1').value = '旧头';
  if (options.longTaskId) for (const sheet of book.worksheets) sheet.eachRow(row => row.eachCell(cell => {
    if (cell.value === 'task-a') cell.value = 't'.repeat(128);
  }));
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Explicit reviewed resource rows. No flow difference or media bytes are inferred. */
export async function syntheticResourceDisableWorkbook(resourceIds: readonly string[]) {
  const book = new ExcelJS.Workbook();
  for (const name of SOP_TASK_SHEETS) book.addWorksheet(name).addRow([...SOP_TASK_HEADERS[name]]);
  for (const id of resourceIds) {
    const values: Record<string, string> = { 资源编号: id, 资源类型: '图片', 资源名称: `合成停用 ${id}`,
      维护状态: '停用', 业务确认人: '合成来源维护人', 待确认事项: '' };
    book.getWorksheet('资源与图片')!.addRow(SOP_TASK_HEADERS['资源与图片'].map(header => values[header] ?? ''));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
