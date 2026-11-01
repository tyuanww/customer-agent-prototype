import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { checkSopMaintenance, createSopMaintenanceTemplate, parseSopMaintenance, SOP_MAINTENANCE_HEADERS, SOP_MAINTENANCE_TEMPLATE_VERSION } from '../src/maintenance.js';
import { INTAKE_POLICY } from '../src/policy.js';

type Name = keyof typeof SOP_MAINTENANCE_HEADERS;
const secret = 'SYNTHETIC_PRIVATE_TEXT_7e4b';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAABMhMSH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAQAAACwAAAAAAQABAAACAkQBADs=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCABRwt/9k=', 'base64');
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function sheet(book: ExcelJS.Workbook, name: Name): ExcelJS.Worksheet {
  const value = book.getWorksheet(name);
  if (!value) throw new Error('Synthetic fixture sheet missing');
  return value;
}
function add(book: ExcelJS.Workbook, name: Name, fields: Record<string, string>): ExcelJS.Row {
  const taskDefaults = name === '执行任务' && (!fields.记录类型 || fields.记录类型 === '任务')
    ? { 记录类型: '任务', 确认项配置: '无确认项' } : {};
  const values: Record<string, string> = { 维护状态: '待发布', 业务确认人: '合成确认人', ...taskDefaults, ...fields };
  return sheet(book, name).addRow(SOP_MAINTENANCE_HEADERS[name].map(header => values[header] ?? ''));
}
function set(book: ExcelJS.Workbook, name: Name, row: number, field: string, value: ExcelJS.CellValue): void {
  const headers: readonly string[] = SOP_MAINTENANCE_HEADERS[name];
  const index = headers.indexOf(field);
  if (index < 0) throw new Error('Synthetic fixture field missing');
  sheet(book, name).getCell(row, index + 1).value = value;
}
function addPicture(book: ExcelJS.Workbook, bytes: Buffer, extension: 'png' | 'gif' | 'jpeg', row: number, column = 6, height = 1): void {
  const id = book.addImage({ extension, base64: bytes.toString('base64') });
  sheet(book, '资源与图片').addImage(id, { tl: { col: column, row: row - 1 }, ext: { width: 1, height } });
}
async function workbook(change?: (book: ExcelJS.Workbook) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, headers] of Object.entries(SOP_MAINTENANCE_HEADERS)) {
    const table = book.addWorksheet(name); table.addRow([SOP_MAINTENANCE_TEMPLATE_VERSION]); table.addRow([...headers]);
  }
  add(book, '场景目录', { 场景编号: 'SC-1', 场景名称: '合成少件', 适用范围: '合成店铺', 起始任务编号: 'TASK-1', 入口词: '合成少件\n包裹缺件' });
  add(book, '执行任务', { 任务编号: 'TASK-1', 场景编号: 'SC-1', 阶段: '核实', 任务名称: '核实材料', 任务类型: '判断', 操作要求: secret,
    确认项配置: '有确认项', 关联知识编号: 'KNOW-1', 可见对象: '坐席可读' });
  add(book, '执行任务', { 任务编号: 'TASK-2', 场景编号: 'SC-1', 阶段: '结束', 任务名称: '记录结论', 任务类型: '终点', 操作要求: '合成结论', 可见对象: '坐席可读' });
  add(book, '执行任务', { 任务编号: 'TASK-3', 场景编号: 'SC-1', 阶段: '协助', 任务名称: '请主管协助', 任务类型: '终点', 操作要求: '合成求助路径', 可见对象: '坐席可读' });
  add(book, '判断分支', { 分支编号: 'BRANCH-1', 任务编号: 'TASK-1', 选项: '材料齐全', 判断依据: '合成条件', 目标任务编号: 'TASK-2', 是否无法判断: '否', 匹配词: '材料齐全\n已有凭证', 分支顺序: '2' });
  add(book, '判断分支', { 分支编号: 'BRANCH-2', 任务编号: 'TASK-1', 选项: '无法判断', 判断依据: '材料缺失', 目标任务编号: 'TASK-3', 是否无法判断: '是', 匹配词: '资料不足', 分支顺序: '1' });
  add(book, '客户话术', { 话术编号: 'SCRIPT-1', 话术标题: '索取合成凭证', 对客正文: 'SYNTHETIC_CUSTOMER_COPY' });
  add(book, '执行任务', { 记录类型: '话术引用', 关联编号: 'LINK-1', 任务编号: 'TASK-1', 话术编号: 'SCRIPT-1', 适用条件: '需凭证时', 话术关系: '独立' });
  add(book, '执行任务', { 记录类型: '确认项', 确认项编号: 'REQ-1', 任务编号: 'TASK-1', 确认项文字: '合成凭证', 确认项顺序: '1' });
  add(book, '知识与案例', { 知识编号: 'KNOW-1', 标题: '合成判断依据', 正文: secret, 可见对象: '坐席可读' });
  change?.(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function previousWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, modern] of Object.entries(SOP_MAINTENANCE_HEADERS)) {
    let headers: readonly string[] = modern.filter(header => !['入口词', '匹配词', '分支顺序'].includes(header));
    if (name === '执行任务') headers = ['任务编号', '场景编号', '阶段', '任务名称', '任务类型', '操作要求', '必须确认的信息', '下一任务编号', '关联知识编号', '关联资源编号', '可见对象', '维护状态', '业务确认人', '待确认事项'];
    if (name === '客户话术') headers = ['话术编号', '任务编号', '话术标题', '对客正文', '适用条件', '话术关系', '关联资源编号', '维护状态', '业务确认人', '待确认事项'];
    const table = book.addWorksheet(name); table.addRow(['sop-manual-authoring-v1']); table.addRow([...headers]);
  }
  const legacyAdd = (name: Name, fields: Record<string, string>): void => {
    const table = sheet(book, name);
    const values: Record<string, string> = { 维护状态: '待发布', 业务确认人: '合成确认人', ...fields };
    const headers: string[] = [];
    table.getRow(2).eachCell(cell => headers.push(String(cell.value)));
    table.addRow(headers.map(header => values[header] ?? ''));
  };
  legacyAdd('场景目录', { 场景编号: 'SC-1', 场景名称: '合成少件', 适用范围: '合成店铺', 起始任务编号: 'TASK-1' });
  legacyAdd('执行任务', { 任务编号: 'TASK-1', 场景编号: 'SC-1', 任务名称: '核实材料', 任务类型: '判断', 操作要求: secret, 必须确认的信息: '合成凭证\n原样保留', 可见对象: '坐席可读' });
  legacyAdd('执行任务', { 任务编号: 'TASK-2', 场景编号: 'SC-1', 任务名称: '记录结论', 任务类型: '终点', 操作要求: '合成结论', 可见对象: '坐席可读' });
  legacyAdd('执行任务', { 任务编号: 'TASK-3', 场景编号: 'SC-1', 任务名称: '请主管协助', 任务类型: '终点', 操作要求: '合成求助路径', 可见对象: '坐席可读' });
  legacyAdd('判断分支', { 分支编号: 'BRANCH-1', 任务编号: 'TASK-1', 选项: '材料齐全', 判断依据: '合成条件', 目标任务编号: 'TASK-2', 是否无法判断: '否' });
  legacyAdd('判断分支', { 分支编号: 'BRANCH-2', 任务编号: 'TASK-1', 选项: '无法判断', 判断依据: '材料缺失', 目标任务编号: 'TASK-3', 是否无法判断: '是' });
  legacyAdd('客户话术', { 话术编号: 'SCRIPT-1', 任务编号: 'TASK-1', 话术标题: '索取合成凭证', 对客正文: 'SYNTHETIC_CUSTOMER_COPY', 适用条件: '需凭证时', 话术关系: '独立' });
  return Buffer.from(await book.xlsx.writeBuffer());
}
const codes = async (change: (book: ExcelJS.Workbook) => void): Promise<string[]> =>
  (await checkSopMaintenance(await workbook(change))).issues.map(issue => issue.code);

it('consumes a real six-sheet workbook, permits tasks without wording, and reports no content', async () => {
  const result = await checkSopMaintenance(await workbook());
  expect(result).toMatchObject({ templateVersion: SOP_MAINTENANCE_TEMPLATE_VERSION, status: 'reviewed', sourceCheck: 'not-checked', publishable: false, entries: 3,
    counts: { 场景目录: 1, 执行任务: 5, 判断分支: 2, 客户话术: 1, 知识与案例: 1, 资源与图片: 0 }, issues: [] });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_CUSTOMER_COPY');
});

it('reads the previous template as unresolved instead of inferring the new fields', async () => {
  const result = await parseSopMaintenance(await previousWorkbook());
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ templateVersion: 'sop-manual-authoring-v1', status: 'needs-review', publishable: false });
  expect(result.document.templateVersion).toBe('sop-manual-authoring-v1');
  expect(result.document.scenes[0]).toMatchObject({ title: '合成少件', entryTerms: null });
  expect(result.document.tasks.find(task => task.id === 'TASK-1')?.requirements).toEqual({ kind: 'unconfirmed', legacyText: '合成凭证\n原样保留' });
  expect(result.document.tasks.find(task => task.id === 'TASK-2')?.requirements).toEqual({ kind: 'unconfirmed', legacyText: '' });
  expect(result.document.requirements).toEqual([]);
  expect(result.document.scriptLinks).toEqual([expect.objectContaining({ origin: 'legacy', id: null, taskId: 'TASK-1', scriptId: 'SCRIPT-1', condition: '需凭证时', relationship: '独立' })]);
  expect(result.document.branches).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'BRANCH-1', label: '材料齐全', matchTerms: null, ordinal: null }),
    expect.objectContaining({ id: 'BRANCH-2', label: '无法判断', matchTerms: null, ordinal: null }),
  ]));
  expect(result.report.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'ENTRY_TERMS_PENDING', sheet: '场景目录', row: 3, column: '' }),
    expect.objectContaining({ code: 'MATCH_TERMS_PENDING', sheet: '判断分支', row: 3, column: '' }),
    expect.objectContaining({ code: 'BRANCH_ORDINAL_PENDING', sheet: '判断分支', row: 3, column: '' }),
  ]));
});

it('round-trips one script body with separate task links and explicit confirmation order', async () => {
  const bytes = await workbook(book => {
    add(book, '执行任务', { 记录类型: '话术引用', 关联编号: 'LINK-2', 任务编号: 'TASK-2', 话术编号: 'SCRIPT-1', 适用条件: '合成备用条件', 话术关系: '配套' });
    add(book, '执行任务', { 记录类型: '话术引用', 关联编号: 'LINK-3', 任务编号: 'TASK-3', 话术编号: 'SCRIPT-1', 适用条件: '合成替代条件', 话术关系: '替代' });
    set(book, '执行任务', 7, '确认项顺序', '2');
    add(book, '执行任务', { 记录类型: '确认项', 确认项编号: 'REQ-2', 任务编号: 'TASK-1', 确认项文字: '先检查合成材料', 确认项顺序: '1' });
  });
  const parsed = await parseSopMaintenance(bytes);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false, entries: 3,
    counts: { 执行任务: 8, 客户话术: 1 } });
  expect(parsed.document.scripts).toEqual([expect.objectContaining({ id: 'SCRIPT-1', answerText: 'SYNTHETIC_CUSTOMER_COPY' })]);
  expect(JSON.stringify(parsed.document).split('SYNTHETIC_CUSTOMER_COPY')).toHaveLength(2);
  expect(parsed.document.scriptLinks).toEqual([
    expect.objectContaining({ origin: 'explicit', id: 'LINK-1', taskId: 'TASK-1', scriptId: 'SCRIPT-1', condition: '需凭证时', relationship: '独立' }),
    expect.objectContaining({ origin: 'explicit', id: 'LINK-2', taskId: 'TASK-2', scriptId: 'SCRIPT-1', condition: '合成备用条件', relationship: '配套' }),
    expect.objectContaining({ origin: 'explicit', id: 'LINK-3', taskId: 'TASK-3', scriptId: 'SCRIPT-1', condition: '合成替代条件', relationship: '替代' }),
  ]);
  expect(parsed.document.requirements).toEqual([
    expect.objectContaining({ id: 'REQ-1', taskId: 'TASK-1', label: '合成凭证', ordinal: 2 }),
    expect.objectContaining({ id: 'REQ-2', taskId: 'TASK-1', label: '先检查合成材料', ordinal: 1 }),
  ]);
  expect(JSON.stringify(parsed.report)).not.toContain('SYNTHETIC_CUSTOMER_COPY');
  expect(JSON.stringify(parsed.report)).not.toContain('合成备用条件');
});

it('preserves a disabled historical link without counting it as a duplicate active link', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    add(book, '执行任务', { 记录类型: '话术引用', 关联编号: 'LINK-OLD', 任务编号: 'TASK-1', 话术编号: 'SCRIPT-1',
      适用条件: '已停用的合成条件', 话术关系: '替代', 维护状态: '停用' });
  }));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.scriptLinks).toHaveLength(2);
  expect(parsed.document.scriptLinks.find(link => link.id === 'LINK-OLD')).toMatchObject({ review: { state: '停用' } });
});

it('distinguishes explicitly no requirements from an unconfirmed configuration', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => set(book, '执行任务', 3, '确认项配置', '')));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.document.tasks.find(task => task.id === 'TASK-1')?.requirements).toEqual({ kind: 'unconfirmed', legacyText: null });
  expect(parsed.document.tasks.find(task => task.id === 'TASK-2')?.requirements).toEqual({ kind: 'none' });
  expect(parsed.document.requirements).toEqual([expect.objectContaining({ id: 'REQ-1', taskId: 'TASK-1' })]);
  expect(parsed.report.issues.map(issue => issue.code)).toContain('REQUIREMENTS_PENDING');
});

it('keeps a missing confirmation order pending and does not infer it from the row', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => set(book, '执行任务', 7, '确认项顺序', '')));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.document.requirements).toEqual([expect.objectContaining({ id: 'REQ-1', ordinal: null })]);
  expect(parsed.report.issues).toContainEqual(expect.objectContaining({ code: 'REQUIREMENT_ORDINAL_PENDING', sheet: '执行任务', row: 7, column: 'S' }));
});

it('keeps an explicitly configured but empty confirmation set pending', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => set(book, '执行任务', 7, '维护状态', '停用')));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.document.tasks.find(task => task.id === 'TASK-1')?.requirements).toEqual({ kind: 'specified' });
  expect(parsed.document.requirements[0]?.review.state).toBe('停用');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('REQUIREMENTS_EMPTY');
});

it('scopes confirmation identity and order per task and preserves independently disabled rows', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    set(book, '执行任务', 4, '确认项配置', '有确认项');
    add(book, '执行任务', { 记录类型: '确认项', 确认项编号: 'REQ-1', 任务编号: 'TASK-2', 确认项文字: '另一任务的检查', 确认项顺序: '1' });
    add(book, '执行任务', { 记录类型: '确认项', 确认项编号: 'REQ-OLD', 任务编号: 'TASK-2', 确认项文字: '停用检查', 确认项顺序: '1', 维护状态: '停用' });
  }));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.requirements.map(item => [item.id, item.taskId, item.ordinal, item.review.state])).toEqual([
    ['REQ-1', 'TASK-1', 1, '待发布'], ['REQ-1', 'TASK-2', 1, '待发布'], ['REQ-OLD', 'TASK-2', 1, '停用'],
  ]);
});

it.each([
  ['duplicate association ID', (book: ExcelJS.Workbook) => add(book, '执行任务', { 记录类型: '话术引用', 关联编号: 'LINK-1', 任务编号: 'TASK-2', 话术编号: 'SCRIPT-1', 适用条件: '备用', 话术关系: '替代' }), 'ENTRY_ID'],
  ['missing association ID', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '关联编号', ''), 'ENTRY_ID'],
  ['duplicate active task-script pair', (book: ExcelJS.Workbook) => add(book, '执行任务', { 记录类型: '话术引用', 关联编号: 'LINK-2', 任务编号: 'TASK-1', 话术编号: 'SCRIPT-1', 适用条件: '其他', 话术关系: '替代' }), 'DUPLICATE_SCRIPT_LINK'],
  ['dangling task', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '任务编号', 'MISSING'), 'MISSING_REFERENCE'],
  ['task reference to another row type', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '任务编号', 'REQ-1'), 'MISSING_REFERENCE'],
  ['dangling script', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '话术编号', 'MISSING'), 'MISSING_REFERENCE'],
  ['missing association condition', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '适用条件', ''), 'INVALID_FIELD_TEXT'],
  ['association condition above the candidate limit', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '适用条件', '甲'.repeat(1025)), 'INVALID_FIELD_TEXT'],
  ['missing association relation', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '话术关系', ''), 'SCRIPT_RELATION'],
  ['missing confirmation ID', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '确认项编号', ''), 'ENTRY_ID'],
  ['duplicate confirmation ID', (book: ExcelJS.Workbook) => add(book, '执行任务', { 记录类型: '确认项', 确认项编号: 'REQ-1', 任务编号: 'TASK-1', 确认项文字: '合成检查', 确认项顺序: '2' }), 'ENTRY_ID'],
  ['dangling confirmation task', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '任务编号', 'MISSING'), 'MISSING_REFERENCE'],
  ['missing confirmation text', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '确认项文字', ''), 'INVALID_FIELD_TEXT'],
  ['confirmation text above the candidate limit', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '确认项文字', '甲'.repeat(1025)), 'INVALID_FIELD_TEXT'],
  ['duplicate confirmation order', (book: ExcelJS.Workbook) => add(book, '执行任务', { 记录类型: '确认项', 确认项编号: 'REQ-2', 任务编号: 'TASK-1', 确认项文字: '合成检查', 确认项顺序: '1' }), 'DUPLICATE_REQUIREMENT_ORDINAL'],
  ['confirmation order gap', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '确认项顺序', '2'), 'REQUIREMENT_ORDINAL_GAP'],
  ['invalid confirmation order', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '确认项顺序', '0'), 'INVALID_REQUIREMENT_ORDINAL'],
  ['confirmation order above the limit', (book: ExcelJS.Workbook) => set(book, '执行任务', 7, '确认项顺序', '33'), 'INVALID_REQUIREMENT_ORDINAL'],
  ['confirmation row contradicts no requirements', (book: ExcelJS.Workbook) => set(book, '执行任务', 3, '确认项配置', '无确认项'), 'UNEXPECTED_REQUIREMENT'],
  ['invalid row type', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '记录类型', '推测'), 'INVALID_RECORD_TYPE'],
  ['fields on the wrong row type', (book: ExcelJS.Workbook) => set(book, '执行任务', 6, '确认项文字', secret), 'ROW_FIELD_NOT_ALLOWED'],
])('rejects %s without returning partial content', async (_name, mutate, code) => {
  const parsed = await parseSopMaintenance(await workbook(mutate));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain(code);
  expect(parsed).not.toHaveProperty('document');
  expect(JSON.stringify(parsed.report)).not.toContain(secret);
});

it('rejects more than 32 effective confirmations for a task', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    for (let index = 2; index <= 33; index++) add(book, '执行任务', {
      记录类型: '确认项', 确认项编号: `REQ-${index}`, 任务编号: 'TASK-1', 确认项文字: '合成检查', 确认项顺序: String(index <= 32 ? index : 1),
    });
  }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('REQUIREMENT_LIMIT');
  expect(parsed).not.toHaveProperty('document');
});

it('accepts 32 ordered confirmations and counts text by Unicode characters', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    set(book, '执行任务', 7, '确认项文字', '😀'.repeat(1024));
    for (let index = 2; index <= 32; index++) add(book, '执行任务', {
      记录类型: '确认项', 确认项编号: `REQ-${index}`, 任务编号: 'TASK-1', 确认项文字: '合成检查', 确认项顺序: String(index),
    });
  }));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.requirements).toHaveLength(32);
  expect(parsed.document.requirements[0]?.label).toBe('😀'.repeat(1024));
  expect(parsed.document.requirements[31]?.ordinal).toBe(32);
});

it('rejects the previous local v1.1 headers even with the same version marker', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await previousWorkbook()).buffer);
  const scenes = sheet(book, '场景目录'), branches = sheet(book, '判断分支');
  scenes.spliceColumns(5, 0, []); scenes.getCell(2, 5).value = '入口词'; scenes.getCell(3, 5).value = '合成入口';
  branches.spliceColumns(7, 0, [], []); branches.getCell(2, 7).value = '匹配词'; branches.getCell(2, 8).value = '分支顺序';
  branches.getCell(3, 7).value = '合成词'; branches.getCell(3, 8).value = '1';
  branches.getCell(4, 7).value = '不确定'; branches.getCell(4, 8).value = '2';
  for (const table of book.worksheets) table.getCell('A1').value = SOP_MAINTENANCE_TEMPLATE_VERSION;
  const parsed = await parseSopMaintenance(Buffer.from(await book.xlsx.writeBuffer()));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('HEADER_MISMATCH');
  expect(parsed).not.toHaveProperty('document');
});

it('does not convert a legacy workbook by changing its version marker', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await previousWorkbook()).buffer);
  for (const table of book.worksheets) table.getCell('A1').value = SOP_MAINTENANCE_TEMPLATE_VERSION;
  const parsed = await parseSopMaintenance(Buffer.from(await book.xlsx.writeBuffer()));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('HEADER_MISMATCH');
  expect(parsed).not.toHaveProperty('document');
});

it('rejects a workbook mixing the old and new template versions', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await previousWorkbook()).buffer);
  sheet(book, '执行任务').getCell('A1').value = SOP_MAINTENANCE_TEMPLATE_VERSION;
  const result = await parseSopMaintenance(Buffer.from(await book.xlsx.writeBuffer()));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain('TEMPLATE_VERSION');
  expect(result).not.toHaveProperty('document');
});

it('rejects the previous v1.1-draft marker instead of changing its matching semantics', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    for (const table of book.worksheets) table.getCell('A1').value = 'sop-manual-authoring-v1.1-draft';
  }));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain('TEMPLATE_VERSION');
  expect(result).not.toHaveProperty('document');
});

it('accepts an explicit empty branch match list', async () => {
  const result = await parseSopMaintenance(await workbook(book => set(book, '判断分支', 3, '匹配词', '不设置')));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(result.document.branches.find(branch => branch.id === 'BRANCH-1')?.matchTerms).toEqual([]);
  expect(result.report.issues.map(issue => issue.code)).not.toContain('MATCH_TERMS_PENDING');
});

it('keeps a blank branch match cell pending rather than treating it as an empty list', async () => {
  const result = await parseSopMaintenance(await workbook(book => set(book, '判断分支', 3, '匹配词', '')));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(result.document.branches.find(branch => branch.id === 'BRANCH-1')?.matchTerms).toBeNull();
  expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'MATCH_TERMS_PENDING', sheet: '判断分支', row: 3, column: 'G' }));
});

it.each([
  ['\\不设置', ['不设置']],
  ['\\\\不设置', ['\\不设置']],
  ['不设置\n其他', ['不设置', '其他']],
  ['\\不设置\n其他', ['不设置', '其他']],
  [' 不设置 ', [' 不设置 ']],
])('preserves literal branch terms for %s', async (cell, expected) => {
  const result = await parseSopMaintenance(await workbook(book => set(book, '判断分支', 3, '匹配词', cell)));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report.status).toBe('reviewed');
  expect(result.document.branches.find(branch => branch.id === 'BRANCH-1')?.matchTerms).toEqual(expected);
});

it('does not apply the empty-list marker to scene entry terms', async () => {
  const result = await parseSopMaintenance(await workbook(book => set(book, '场景目录', 3, '入口词', '不设置')));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report.status).toBe('reviewed');
  expect(result.document.scenes[0]?.entryTerms).toEqual(['不设置']);
});

it.each(['草稿', '待核对', '待发布', '启用'])('reports unresolved terms and order for %s without inventing values', async state => {
  const result = await parseSopMaintenance(await workbook(book => {
    set(book, '场景目录', 3, '维护状态', state);
    set(book, '场景目录', 3, '入口词', '');
    set(book, '判断分支', 3, '维护状态', state);
    set(book, '判断分支', 3, '匹配词', '');
    set(book, '判断分支', 3, '分支顺序', '');
  }));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(result.document.scenes[0]).toMatchObject({ entryTerms: null, review: { state } });
  expect(result.document.branches.find(branch => branch.id === 'BRANCH-1')).toMatchObject({ matchTerms: null, ordinal: null, review: { state } });
  expect(result.report.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'ENTRY_TERMS_PENDING', sheet: '场景目录', row: 3, column: 'E' }),
    expect.objectContaining({ code: 'MATCH_TERMS_PENDING', sheet: '判断分支', row: 3, column: 'G' }),
    expect.objectContaining({ code: 'BRANCH_ORDINAL_PENDING', sheet: '判断分支', row: 3, column: 'H' }),
  ]));
});

it('round-trips literal line-separated terms and explicit branch ordinals without using row order', async () => {
  const bytes = await workbook(book => {
    set(book, '场景目录', 3, '入口词', ' Ａ \nA\n😀');
    set(book, '判断分支', 3, '匹配词', '共同词\n原文 ');
    set(book, '判断分支', 4, '匹配词', '共同词');
    const table = sheet(book, '判断分支');
    const first = table.getRow(3).values;
    table.getRow(3).values = table.getRow(4).values;
    table.getRow(4).values = first;
  });
  const result = await parseSopMaintenance(bytes);
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(result.document.scenes[0]?.entryTerms).toEqual([' Ａ ', 'A', '😀']);
  expect(result.document.branches).toEqual([
    expect.objectContaining({ id: 'BRANCH-2', ordinal: 1, matchTerms: ['共同词'] }),
    expect.objectContaining({ id: 'BRANCH-1', ordinal: 2, matchTerms: ['共同词', '原文 '] }),
  ]);
});

it('fills the generated XLSX template and reads its explicit terms and ordinals back', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await createSopMaintenanceTemplate()).buffer);
  add(book, '场景目录', { 场景编号: 'SC-1', 场景名称: '合成场景', 适用范围: '合成范围', 起始任务编号: 'TASK-1', 入口词: '入口甲\n入口乙' });
  add(book, '执行任务', { 任务编号: 'TASK-1', 场景编号: 'SC-1', 阶段: '判断', 任务名称: '合成判断', 任务类型: '判断', 操作要求: '人工选择', 可见对象: '坐席可读' });
  add(book, '执行任务', { 任务编号: 'TASK-2', 场景编号: 'SC-1', 阶段: '结束', 任务名称: '合成终点', 任务类型: '终点', 操作要求: '合成说明', 可见对象: '坐席可读' });
  add(book, '判断分支', { 分支编号: 'BRANCH-1', 任务编号: 'TASK-1', 选项: '已确认', 判断依据: '合成依据', 目标任务编号: 'TASK-2', 是否无法判断: '否', 匹配词: '词甲\n词乙', 分支顺序: '2' });
  add(book, '判断分支', { 分支编号: 'BRANCH-2', 任务编号: 'TASK-1', 选项: '无法判断', 判断依据: '需协助', 目标任务编号: 'TASK-2', 是否无法判断: '是', 匹配词: '不确定', 分支顺序: '1' });
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const result = await parseSopMaintenance(bytes);
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ status: 'reviewed', publishable: false, templateVersion: SOP_MAINTENANCE_TEMPLATE_VERSION });
  expect(result.document.scenes[0]?.entryTerms).toEqual(['入口甲', '入口乙']);
  expect(result.document.branches.map(branch => ({ matchTerms: branch.matchTerms, ordinal: branch.ordinal }))).toEqual([
    { matchTerms: ['词甲', '词乙'], ordinal: 2 }, { matchTerms: ['不确定'], ordinal: 1 },
  ]);
});

it('accepts the candidate term limits, counting Unicode code points', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    set(book, '场景目录', 3, '入口词', Array.from({ length: 32 }, (_, index) => `入口-${index}`).join('\n'));
    set(book, '判断分支', 3, '匹配词', '😀'.repeat(128));
  }));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report.status).toBe('reviewed');
  expect(result.document.scenes[0]?.entryTerms).toHaveLength(32);
  expect(result.document.branches[0]?.matchTerms).toEqual(['😀'.repeat(128)]);
});

it('validates ordinals within each decision rather than across the workbook', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    set(book, '执行任务', 4, '任务类型', '判断');
    add(book, '执行任务', { 任务编号: 'TASK-4', 场景编号: 'SC-1', 阶段: '结束', 任务名称: '合成结束', 任务类型: '终点', 操作要求: '合成说明', 可见对象: '坐席可读' });
    add(book, '判断分支', { 分支编号: 'BRANCH-3', 任务编号: 'TASK-2', 选项: '条件成立', 判断依据: '合成条件', 目标任务编号: 'TASK-4', 是否无法判断: '否', 匹配词: '共同词', 分支顺序: '1' });
    add(book, '判断分支', { 分支编号: 'BRANCH-4', 任务编号: 'TASK-2', 选项: '无法判断', 判断依据: '资料不足', 目标任务编号: 'TASK-3', 是否无法判断: '是', 匹配词: '共同词', 分支顺序: '2' });
  }));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report.status).toBe('reviewed');
  expect(result.document.branches.filter(branch => branch.taskId === 'TASK-2').map(branch => branch.ordinal)).toEqual([1, 2]);
});

it('accepts four explicit consecutive choices including the unknown option', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '判断分支', { 分支编号: 'BRANCH-3', 任务编号: 'TASK-1', 选项: '第三种', 判断依据: '合成条件', 目标任务编号: 'TASK-2', 是否无法判断: '否', 匹配词: '条件三', 分支顺序: '3' });
    add(book, '判断分支', { 分支编号: 'BRANCH-4', 任务编号: 'TASK-1', 选项: '第四种', 判断依据: '合成条件', 目标任务编号: 'TASK-2', 是否无法判断: '否', 匹配词: '条件四', 分支顺序: '4' });
  }));
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report.status).toBe('reviewed');
  expect(result.document.branches.map(branch => branch.ordinal).sort()).toEqual([1, 2, 3, 4]);
  expect(result.document.branches.filter(branch => branch.unableToDetermine)).toHaveLength(1);
});

it.each([
  ['duplicate entry terms', (book: ExcelJS.Workbook) => set(book, '场景目录', 3, '入口词', `${secret}\n${secret}`), 'DUPLICATE_TERM'],
  ['duplicate match terms', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '匹配词', '重复\n重复'), 'DUPLICATE_TERM'],
  ['duplicate match terms after escape', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '匹配词', '不设置\n\\不设置'), 'DUPLICATE_TERM'],
  ['empty line within terms', (book: ExcelJS.Workbook) => set(book, '场景目录', 3, '入口词', '第一项\n\n第二项'), 'INVALID_TERM'],
  ['more than 32 terms', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '匹配词', Array.from({ length: 33 }, (_, index) => `词-${index}`).join('\n')), 'TERMS_LIMIT'],
  ['more than 128 Unicode characters', (book: ExcelJS.Workbook) => set(book, '场景目录', 3, '入口词', '😀'.repeat(129)), 'INVALID_TERM'],
  ['duplicate ordinals', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '分支顺序', '1'), 'DUPLICATE_BRANCH_ORDINAL'],
  ['non-contiguous ordinals', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '分支顺序', '3'), 'BRANCH_ORDINAL_GAP'],
  ['ordinal zero', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '分支顺序', '0'), 'INVALID_BRANCH_ORDINAL'],
  ['ordinal above four', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '分支顺序', '5'), 'INVALID_BRANCH_ORDINAL'],
  ['non-integer ordinal', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '分支顺序', '1.0'), 'INVALID_BRANCH_ORDINAL'],
])('rejects %s without exposing input or a partial document', async (_name, mutate, code) => {
  const result = await parseSopMaintenance(await workbook(mutate));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain(code);
  expect(result).not.toHaveProperty('document');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('returns the six-table draft with explicit branches, resource references and all anchored image bytes', async () => {
  const bytes = await workbook(book => {
    set(book, '场景目录', 3, '适用范围', '待确认');
    set(book, '场景目录', 3, '待确认事项', secret);
    set(book, '执行任务', 3, '维护状态', '草稿');
    set(book, '执行任务', 3, '关联资源编号', 'IMG-TASK');
    set(book, '知识与案例', 3, '关联资源编号', 'IMG-KNOW');
    set(book, '客户话术', 3, '关联资源编号', 'IMG-SCRIPT');
    add(book, '执行任务', { 任务编号: 'TASK-4', 场景编号: 'SC-1', 阶段: '处理', 任务名称: '操作', 任务类型: '操作', 操作要求: '先核实', 下一任务编号: 'TASK-2', 可见对象: '坐席可读' });
    set(book, '判断分支', 3, '目标任务编号', 'TASK-4');
    add(book, '资源与图片', { 资源编号: 'IMG-TASK', 资源类型: '图片', 资源名称: '合成任务图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    add(book, '资源与图片', { 资源编号: 'IMG-KNOW', 资源类型: '图片', 资源名称: '合成知识图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    add(book, '资源与图片', { 资源编号: 'IMG-SCRIPT', 资源类型: '图片', 资源名称: '合成话术图片', 可见对象: '对客可用', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3); addPicture(book, jpeg, 'jpeg', 3); addPicture(book, png, 'png', 3);
    addPicture(book, jpeg, 'jpeg', 4); addPicture(book, png, 'png', 5);
  });
  const result = await parseSopMaintenance(bytes);
  if (result.kind !== 'parsed') throw new Error(JSON.stringify(result.report));
  expect(result.report).toMatchObject({ status: 'needs-review', publishable: false, entries: 4, images: 5 });
  expect(result.document).toMatchObject({ templateVersion: SOP_MAINTENANCE_TEMPLATE_VERSION, publishable: false });
  expect(result.document).not.toHaveProperty('sourceId');
  expect(result.document.scenes[0]).toMatchObject({ id: 'SC-1', startTaskId: 'TASK-1', scopeText: '待确认', entryTerms: ['合成少件', '包裹缺件'],
    review: { state: '待发布', confirmerText: '合成确认人', pendingText: secret } });
  expect(result.document.tasks.find(task => task.id === 'TASK-1')).toMatchObject({ kind: 'decision', instruction: secret,
    requirements: { kind: 'specified' }, knowledgeIds: ['KNOW-1'], resourceIds: ['IMG-TASK'], review: { state: '草稿' } });
  expect(result.document.requirements).toEqual([expect.objectContaining({ id: 'REQ-1', taskId: 'TASK-1', label: '合成凭证', ordinal: 1 })]);
  expect(result.document.tasks.find(task => task.id === 'TASK-4')).toMatchObject({ kind: 'action', nextTaskId: 'TASK-2' });
  expect(result.document.branches).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'BRANCH-1', taskId: 'TASK-1', targetTaskId: 'TASK-4', unableToDetermine: false, matchTerms: ['材料齐全', '已有凭证'], ordinal: 2 }),
    expect.objectContaining({ id: 'BRANCH-2', taskId: 'TASK-1', targetTaskId: 'TASK-3', unableToDetermine: true, matchTerms: ['资料不足'], ordinal: 1 }),
  ]));
  expect(result.document.scripts[0]).toMatchObject({ id: 'SCRIPT-1', answerText: 'SYNTHETIC_CUSTOMER_COPY', resourceIds: ['IMG-SCRIPT'] });
  expect(result.document.scriptLinks[0]).toMatchObject({ origin: 'explicit', id: 'LINK-1', taskId: 'TASK-1', scriptId: 'SCRIPT-1', relationship: '独立' });
  expect(result.document.knowledge[0]).toMatchObject({ id: 'KNOW-1', body: secret, resourceIds: ['IMG-KNOW'] });
  const resources = new Map(result.document.resources.map(resource => [resource.id, resource]));
  const taskResource = resources.get('IMG-TASK'), knowledgeResource = resources.get('IMG-KNOW'), scriptResource = resources.get('IMG-SCRIPT');
  expect(taskResource?.kind).toBe('image'); expect(knowledgeResource?.kind).toBe('image'); expect(scriptResource?.kind).toBe('image');
  if (taskResource?.kind !== 'image' || knowledgeResource?.kind !== 'image' || scriptResource?.kind !== 'image') throw new Error('Synthetic images missing');
  expect(taskResource.images).toEqual(expect.arrayContaining([
    { bytes: png, mime: 'image/png', sha256: digest(png) }, { bytes: jpeg, mime: 'image/jpeg', sha256: digest(jpeg) },
  ]));
  expect(taskResource.images).toHaveLength(3);
  expect(taskResource.images.filter(image => image.sha256 === digest(png))).toHaveLength(2);
  expect(knowledgeResource.images).toEqual([{ bytes: jpeg, mime: 'image/jpeg', sha256: digest(jpeg) }]);
  expect(scriptResource.images).toEqual([{ bytes: png, mime: 'image/png', sha256: digest(png) }]);
  expect(JSON.stringify(result.report)).not.toContain(secret);
  expect(JSON.stringify(result.report)).not.toContain('SYNTHETIC_CUSTOMER_COPY');
  expect(JSON.stringify(result.report)).not.toContain('合成确认人');
  expect(await checkSopMaintenance(bytes)).toEqual(result.report);
});

it('rejects the superseded three-sheet format instead of guessing a mapping', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('SOP内容'); book.addWorksheet('资源与图片'); book.addWorksheet('变更记录');
  const result = await checkSopMaintenance(Buffer.from(await book.xlsx.writeBuffer()));
  expect(result.status).toBe('invalid');
  expect(result.issues.some(issue => issue.code === 'MISSING_SHEET')).toBe(true);
});

it('requires a fixed template version on each sheet, not on every record', async () => {
  expect(await codes(book => { sheet(book, '执行任务').getCell('A1').value = 'unsupported'; })).toContain('TEMPLATE_VERSION');
});

it('does not expose arbitrary sheet names or cell text in error reports', async () => {
  const result = await checkSopMaintenance(await workbook(book => { book.addWorksheet(secret); }));
  expect(result.status).toBe('invalid');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('rejects duplicate identities across content kinds and formulas', async () => {
  expect(await codes(book => set(book, '客户话术', 3, '话术编号', 'TASK-1'))).toContain('ENTRY_ID');
  expect(await codes(book => set(book, '客户话术', 3, '对客正文', { formula: '1+1', result: 2 }))).toContain('NON_TEXT_CELL');
});

it('requires business review and explicit scopes without exposing pending questions', async () => {
  const result = await checkSopMaintenance(await workbook(book => {
    set(book, '场景目录', 3, '适用范围', '待确认');
    set(book, '场景目录', 3, '待确认事项', secret);
    set(book, '知识与案例', 3, '维护状态', '草稿');
  }));
  expect(result.status).toBe('needs-review');
  expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['SCOPE_PENDING', 'OPEN_QUESTION', 'REVIEW_PENDING']));
  expect(JSON.stringify(result)).not.toContain(secret);
});

it.each(['待确认', ' 待确认 ', '\t待确认\n'])('preserves unresolved scope %j and marks it for review', async scope => {
  const parsed = await parseSopMaintenance(await workbook(book => set(book, '场景目录', 3, '适用范围', scope)));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.report.issues).toContainEqual(expect.objectContaining({ code: 'SCOPE_PENDING', sheet: '场景目录', row: 3, column: 'C' }));
  expect(parsed.document.scenes[0]?.scopeText).toBe(scope);
});

it('also treats a padded resource scope marker as unresolved', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => add(book, '资源与图片', {
    资源编号: 'DOC-1', 资源类型: '资料', 资源名称: '合成资料', 可见对象: '坐席可读', 适用范围: ' 待确认 ', 资源内容: secret,
  })));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.document.resources[0]?.scopeText).toBe(' 待确认 ');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('SCOPE_PENDING');
  expect(JSON.stringify(parsed.report)).not.toContain(secret);
});

it.each(['待发布', '启用', '停用'])('does not accept a pending confirmer marker for %s', async state => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    set(book, '知识与案例', 3, '维护状态', state);
    set(book, '知识与案例', 3, '业务确认人', ' 待确认 ');
  }));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.document.knowledge[0]?.review).toMatchObject({ state, confirmerText: ' 待确认 ' });
  expect(parsed.report.issues).toContainEqual(expect.objectContaining({ code: 'OWNER_REQUIRED', sheet: '知识与案例', row: 3, column: 'G' }));
});

it.each(['', '   '])('keeps an empty task stage %j unresolved', async stage => {
  const parsed = await parseSopMaintenance(await workbook(book => set(book, '执行任务', 3, '阶段', stage)));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false });
  expect(parsed.document.tasks.find(task => task.id === 'TASK-1')?.stage).toBe(stage);
  expect(parsed.report.issues).toContainEqual(expect.objectContaining({ code: 'STAGE_PENDING', sheet: '执行任务', row: 3, column: 'D' }));
});

it('requires a reviewer for stop intentions, and detects references into stopped content', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    set(book, '知识与案例', 3, '维护状态', '停用');
    set(book, '知识与案例', 3, '业务确认人', '');
  }));
  expect(result.kind).toBe('parsed');
  if (result.kind !== 'parsed') throw new Error('Stop intention should remain a reviewable draft');
  expect(result.report.status).toBe('needs-review');
  expect(result.report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['OWNER_REQUIRED', 'STOPPED_REFERENCE']));
  expect(result.document.knowledge[0]?.review).toEqual({ state: '停用', confirmerText: '', pendingText: '' });
});

it('rejects a nonexistent branch destination and a branch missing its unknown route', async () => {
  expect(await codes(book => set(book, '判断分支', 3, '目标任务编号', secret))).toContain('MISSING_REFERENCE');
  expect(await codes(book => set(book, '判断分支', 4, '是否无法判断', '否'))).toContain('UNKNOWN_BRANCH_REQUIRED');
});

it('rejects a decision with more choices than the desktop can execute', async () => {
  expect(await codes(book => {
    for (let index = 3; index <= 5; index++) add(book, '判断分支', {
      分支编号: `BRANCH-${index}`, 任务编号: 'TASK-1', 选项: `选项${index}`, 判断依据: '合成条件', 目标任务编号: 'TASK-2', 是否无法判断: '否',
    });
  })).toContain('BRANCH_LIMIT');
});

it('rejects graph cycles and unreachable active tasks', async () => {
  expect(await codes(book => set(book, '判断分支', 3, '目标任务编号', 'TASK-1'))).toContain('CYCLE');
  expect(await codes(book => set(book, '判断分支', 3, '目标任务编号', 'TASK-3'))).toContain('UNREACHABLE_TASK');
});

it('rejects a default transition on decisions and branches on ordinary tasks', async () => {
  expect(await codes(book => set(book, '执行任务', 3, '下一任务编号', 'TASK-2'))).toContain('INVALID_NEXT');
  expect(await codes(book => {
    set(book, '执行任务', 3, '任务类型', '操作'); set(book, '执行任务', 3, '下一任务编号', 'TASK-2');
  })).toContain('UNEXPECTED_BRANCH');
});

it('rejects cross-scene transitions and starts owned by another scene', async () => {
  expect(await codes(book => {
    add(book, '场景目录', { 场景编号: 'SC-2', 场景名称: '另一合成场景', 适用范围: '合成店铺', 起始任务编号: 'TASK-1' });
    set(book, '执行任务', 4, '场景编号', 'SC-2');
  })).toEqual(expect.arrayContaining(['CROSS_SCENE_EDGE', 'WRONG_START']));
});

it('checks real calendar dates and validity ordering', async () => {
  expect(await codes(book => set(book, '场景目录', 3, '生效时间', '2026-02-30T10:00:00+08:00'))).toContain('INVALID_TIME');
  expect(await codes(book => {
    set(book, '场景目录', 3, '生效时间', '2026-11-02T10:00:00+08:00');
    set(book, '场景目录', 3, '失效时间', '2026-11-01T10:00:00+08:00');
  })).toContain('INVALID_WINDOW');
});

it('blocks dependencies on supervisor knowledge and internal customer attachments', async () => {
  expect(await codes(book => set(book, '知识与案例', 3, '可见对象', '主管可读'))).toContain('VISIBILITY_MISMATCH');
  expect(await codes(book => {
    add(book, '资源与图片', { 资源编号: 'RES-1', 资源类型: '资料', 资源名称: '内部资料', 可见对象: '坐席可读', 适用范围: '合成店铺', 资源内容: secret });
    set(book, '客户话术', 3, '关联资源编号', 'RES-1');
  })).toContain('INTERNAL_RESOURCE');
});

it('requires resources and embedded image bytes rather than a label alone', async () => {
  expect(await codes(book => set(book, '执行任务', 3, '关联资源编号', 'MISSING-1'))).toContain('MISSING_REFERENCE');
  expect(await codes(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
  })).toContain('MISSING_IMAGE');
});

it('accepts an actual embedded PNG bound to a resource row and rejects orphan images', async () => {
  const withImage = (book: ExcelJS.Workbook, resource: boolean): void => {
    if (resource) add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    const id = book.addImage({ extension: 'png', base64: png.toString('base64') });
    sheet(book, '资源与图片').addImage(id, { tl: { col: 6, row: 2 }, ext: { width: 1, height: 1 } });
  };
  expect(await checkSopMaintenance(await workbook(book => withImage(book, true)))).toMatchObject({ status: 'reviewed', images: 1 });
  expect(await codes(book => withImage(book, false))).toContain('ORPHAN_IMAGE');
});

it('detects an absolute OOXML image anchor alongside a valid picture instead of silently dropping it', async () => {
  const original = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3); addPicture(book, jpeg, 'jpeg', 3);
  });
  const accepted = await parseSopMaintenance(original);
  if (accepted.kind !== 'parsed') throw new Error(JSON.stringify(accepted.report));
  const resource = accepted.document.resources[0];
  expect(resource?.kind).toBe('image');
  if (resource?.kind !== 'image') throw new Error('Synthetic pictures missing');
  expect(resource.images.map(image => image.sha256)).toEqual([digest(png), digest(jpeg)]);
  const zip = await JSZip.loadAsync(original);
  const drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('Synthetic drawing missing');
  let count = 0;
  const xml = (await drawing.async('string')).replace(/<xdr:oneCellAnchor\b[^>]*>[\s\S]*?<\/xdr:oneCellAnchor>/gu, anchor => {
    if (++count !== 2) return anchor;
    return anchor.replace(/<xdr:oneCellAnchor\b[^>]*>/u, '<xdr:absoluteAnchor>')
      .replace(/<xdr:from>[\s\S]*?<\/xdr:from>/u, '<xdr:pos x="4000000" y="400000"/>')
      .replace('</xdr:oneCellAnchor>', '</xdr:absoluteAnchor>');
  });
  expect(count).toBe(2);
  zip.file('xl/drawings/drawing1.xml', xml);
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNSUPPORTED_IMAGE_ANCHOR');
  expect(parsed).not.toHaveProperty('document');
  expect(JSON.stringify(parsed.report)).not.toContain(secret);
});

it('rejects picture anchors that the workbook model cannot reconcile', async () => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('Synthetic drawing missing');
  const xml = (await drawing.async('string'))
    .replace('<xdr:pic>', '<other:pic xmlns:other="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">')
    .replace('</xdr:pic>', '</other:pic>');
  zip.file('xl/drawings/drawing1.xml', xml);
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNRESOLVED_IMAGE_ANCHOR');
  expect(parsed).not.toHaveProperty('document');
});

it('rejects multiple picture objects in one anchor', async () => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/drawings/drawing1.xml', drawing = zip.file(path);
  if (!drawing) throw new Error('Synthetic drawing missing');
  const original = await drawing.async('string');
  const picture = /<xdr:pic>[\s\S]*?<\/xdr:pic>/u.exec(original)?.[0];
  if (!picture) throw new Error('Synthetic picture missing');
  zip.file(path, original.replace(picture, `${picture}${picture}`));
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNSUPPORTED_IMAGE_ANCHOR');
  expect(parsed).not.toHaveProperty('document');
});

it('rejects a picture drawing claimed by two worksheets', async () => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const sheetPath = 'xl/worksheets/sheet1.xml', sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error('Synthetic worksheet missing');
  zip.file(sheetPath, (await sheetFile.async('string')).replace('</worksheet>', '<drawing r:id="rIdExtra"/></worksheet>'));
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdExtra" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNRESOLVED_IMAGE_RELATION');
  expect(parsed).not.toHaveProperty('document');
});

it.each(['missing', 'missing-target', 'wrong-type', 'unreferenced'])('rejects %s OOXML image relationships', async mode => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/drawings/_rels/drawing1.xml.rels', rels = zip.file(path);
  if (!rels) throw new Error('Synthetic relationship part missing');
  const original = await rels.async('string');
  let xml: string;
  if (mode === 'missing') xml = original.replace(/<Relationship\s[^>]*\/>/u, '');
  else if (mode === 'missing-target') xml = original.replace('../media/image1.png', '../media/missing.png');
  else if (mode === 'wrong-type') xml = original.replace('/relationships/image', '/relationships/chart');
  else xml = original.replace('</Relationships>', '<Relationship Id="rIdExtra" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  expect(xml).not.toBe(original);
  zip.file(path, xml);
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNRESOLVED_IMAGE_RELATION');
  expect(parsed).not.toHaveProperty('document');
  expect(JSON.stringify(parsed.report)).not.toContain(secret);
});

it('rejects an image embedded in a shape whose owner cannot be resolved', async () => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/drawings/drawing1.xml', drawing = zip.file(path);
  if (!drawing) throw new Error('Synthetic drawing missing');
  const original = await drawing.async('string');
  const shape = '<xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="99" name="Synthetic image fill"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></xdr:spPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>';
  zip.file(path, original.replace('</xdr:wsDr>', `${shape}</xdr:wsDr>`));
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNSUPPORTED_IMAGE_ANCHOR');
  expect(parsed).not.toHaveProperty('document');
});

it('rejects an image drawing whose worksheet relation has no target', async () => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/worksheets/_rels/sheet6.xml.rels', relations = zip.file(path);
  if (!relations) throw new Error('Synthetic worksheet relationship missing');
  const original = await relations.async('string');
  const xml = original.replace('../drawings/drawing1.xml', '../drawings/missing.xml');
  expect(xml).not.toBe(original);
  zip.file(path, xml);
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('UNRESOLVED_IMAGE_RELATION');
  expect(parsed).not.toHaveProperty('document');
});

it('does not count a normal OOXML shape beside a picture as another image', async () => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
  });
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/drawings/drawing1.xml', drawing = zip.file(path);
  if (!drawing) throw new Error('Synthetic drawing missing');
  const original = await drawing.async('string');
  const anchor = /<xdr:oneCellAnchor\b[^>]*>[\s\S]*?<\/xdr:oneCellAnchor>/u.exec(original)?.[0];
  if (!anchor) throw new Error('Synthetic anchor missing');
  const shape = anchor.replace(/<xdr:pic>[\s\S]*?<\/xdr:pic>/u, '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="99" name="Synthetic shape"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:sp>');
  expect(shape).not.toBe(anchor);
  zip.file(path, original.replace('</xdr:wsDr>', `${shape}</xdr:wsDr>`));
  const parsed = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', images: 1, publishable: false });
  expect(parsed.document.resources[0]).toMatchObject({ kind: 'image', images: [{ sha256: digest(png) }] });
});

it('does not count an ordinary Excel table as an image', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    const table = sheet(book, '场景目录');
    const headers = SOP_MAINTENANCE_HEADERS.场景目录;
    const values = headers.map((_header, index) => table.getCell(3, index + 1).value ?? '');
    table.addTable({ name: 'SyntheticTable', ref: 'A2', headerRow: true,
      columns: headers.map(name => ({ name })), rows: [values] });
  }));
  expect(parsed).toMatchObject({ kind: 'parsed', report: { status: 'reviewed', images: 0, publishable: false } });
});

it('rejects a column offset that ExcelJS would clamp beyond the declared image column', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
    const image = sheet(book, '资源与图片').getImages()[0];
    if (!image) throw new Error('Synthetic picture missing');
    image.range.tl.nativeColOff = 1000000;
  }));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain('IMAGE_COLUMN');
  expect(result).not.toHaveProperty('document');
});

it('accepts a supported nonzero image-column offset', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
    const image = sheet(book, '资源与图片').getImages()[0];
    if (!image) throw new Error('Synthetic picture missing');
    image.range.tl.nativeColOff = 10000;
  }));
  expect(result).toMatchObject({ kind: 'parsed', report: { status: 'reviewed', images: 1, publishable: false } });
});

it.each([
  ['wrong column', (book: ExcelJS.Workbook) => addPicture(book, png, 'png', 3, 5), 'IMAGE_COLUMN'],
  ['one-cell anchor crossing a row', (book: ExcelJS.Workbook) => addPicture(book, png, 'png', 3, 6, 30), 'IMAGE_SPANS_ROWS'],
  ['two-cell anchor crossing a row', (book: ExcelJS.Workbook) => {
    const id = book.addImage({ extension: 'png', base64: png.toString('base64') });
    sheet(book, '资源与图片').addImage(id, 'G3:G4');
  }, 'IMAGE_SPANS_ROWS'],
  ['no corresponding resource row', (book: ExcelJS.Workbook) => addPicture(book, png, 'png', 4), 'ORPHAN_IMAGE'],
  ['image on another sheet', (book: ExcelJS.Workbook) => {
    const id = book.addImage({ extension: 'png', base64: png.toString('base64') });
    sheet(book, '执行任务').addImage(id, { tl: { col: 6, row: 2 }, ext: { width: 1, height: 1 } });
  }, 'MISPLACED_IMAGE'],
  ['unanchored background', (book: ExcelJS.Workbook) => {
    const id = book.addImage({ extension: 'png', base64: png.toString('base64') });
    sheet(book, '资源与图片').addBackgroundImage(id);
  }, 'UNANCHORED_IMAGE'],
])('rejects %s without returning any partial document', async (_name, addInvalidImage, code) => {
  const bytes = await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3);
    addInvalidImage(book);
  });
  const result = await parseSopMaintenance(bytes);
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain(code);
  expect(result).not.toHaveProperty('document');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('accepts a two-cell image ending exactly at the resource row boundary', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    const id = book.addImage({ extension: 'png', base64: png.toString('base64') });
    sheet(book, '资源与图片').addImage(id, 'G3:G3');
  }));
  expect(result.kind).toBe('parsed');
  if (result.kind !== 'parsed') throw new Error('Boundary anchor should parse');
  expect(result.document.resources).toMatchObject([{ id: 'IMAGE-1', kind: 'image', images: [{ sha256: digest(png) }] }]);
});

it('rejects an image anchored on a non-image resource', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'DOC-1', 资源类型: '资料', 资源名称: '合成资料', 可见对象: '坐席可读', 适用范围: '合成店铺', 资源内容: secret });
    addPicture(book, png, 'png', 3);
  }));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain('ORPHAN_IMAGE');
  expect(result).not.toHaveProperty('document');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it.each([
  ['missing resource reference', (book: ExcelJS.Workbook) => set(book, '执行任务', 3, '关联资源编号', 'MISSING-1'), 'MISSING_REFERENCE'],
  ['missing branch target', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '目标任务编号', 'MISSING-2'), 'MISSING_REFERENCE'],
  ['cycle', (book: ExcelJS.Workbook) => set(book, '判断分支', 3, '目标任务编号', 'TASK-1'), 'CYCLE'],
  ['unsafe customer resource', (book: ExcelJS.Workbook) => {
    add(book, '资源与图片', { 资源编号: 'DOC-1', 资源类型: '资料', 资源名称: '合成资料', 可见对象: '主管可读', 适用范围: '合成店铺', 资源内容: secret });
    set(book, '客户话术', 3, '关联资源编号', 'DOC-1');
  }, 'INTERNAL_RESOURCE'],
])('does not return a partial document for %s', async (_name, mutate, code) => {
  const result = await parseSopMaintenance(await workbook(mutate));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain(code);
  expect(result).not.toHaveProperty('document');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('rejects damaged images even if their signatures are valid', async () => {
  const corrupted = Buffer.from(png);
  corrupted.writeUInt8(corrupted.readUInt8(45) ^ 1, 45);
  const damaged = [
    { bytes: corrupted, extension: 'png' }, { bytes: png.subarray(0, png.length - 1), extension: 'png' },
    { bytes: Buffer.concat([png.subarray(0, 33), png.subarray(png.length - 12)]), extension: 'png' },
    { bytes: jpeg.subarray(0, jpeg.length - 1), extension: 'jpeg' },
    { bytes: Buffer.from('ffd8ffd9', 'hex'), extension: 'jpeg' },
  ] satisfies readonly { bytes: Buffer; extension: 'png' | 'jpeg' | 'gif' }[];
  for (const broken of damaged) {
    const result = await parseSopMaintenance(await workbook(book => {
      add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
      addPicture(book, png, 'png', 3); addPicture(book, broken.bytes, broken.extension, 3);
    }));
    expect(result.kind).toBe('invalid');
    expect(result.report.issues.map(issue => issue.code)).toContain('INVALID_IMAGE_BYTES');
    expect(result).not.toHaveProperty('document');
  }
});

it('bounds repeated image placements even when they reference one workbook media object', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    const id = book.addImage({ extension: 'png', base64: png.toString('base64') });
    for (let index = 0; index <= INTAKE_POLICY.mediaCount; index++) {
      sheet(book, '资源与图片').addImage(id, { tl: { col: 6, row: 2 }, ext: { width: 1, height: 1 } });
    }
  }));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain('MEDIA_LIMIT');
  expect(result).not.toHaveProperty('document');
});

it('bounds the total returned bytes for repeated placements of one large image', async () => {
  const payload = Buffer.alloc(4 * 1024 * 1024);
  payload.write('note\0');
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); chunk.write('tEXt', 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  const paddedPng = Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    const id = book.addImage({ extension: 'png', base64: paddedPng.toString('base64') });
    for (let index = 0; index <= Math.floor(INTAKE_POLICY.mediaBytes / paddedPng.length); index++) {
      sheet(book, '资源与图片').addImage(id, { tl: { col: 6, row: 2 }, ext: { width: 1, height: 1 } });
    }
  }));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues.map(issue => issue.code)).toContain('MEDIA_LIMIT');
  expect(result).not.toHaveProperty('document');
});

it('writes a consumable private CLI report containing only the parser report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sop-authoring-'));
  try {
    const input = join(directory, 'synthetic.xlsx'), output = join(directory, 'report.json');
    await writeFile(input, await workbook());
    const cli = new URL('../../../scripts/check-sop-maintenance.mjs', import.meta.url);
    const { stdout } = await promisify(execFile)(process.execPath, [cli.pathname, input, output]);
    const expected = await checkSopMaintenance(await readFile(input));
    const rendered = await readFile(output, 'utf8');
    expect(rendered).toBe(JSON.stringify(expected, null, 2));
    expect(JSON.parse(stdout)).toMatchObject({ templateVersion: SOP_MAINTENANCE_TEMPLATE_VERSION, status: 'reviewed',
      sourceCheck: 'not-checked', publishable: false });
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain('SYNTHETIC_CUSTOMER_COPY');
    await expect(promisify(execFile)(process.execPath, [cli.pathname, input, output])).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe(rendered);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects arbitrary bytes declared as an image', async () => {
  expect(await codes(book => {
    add(book, '资源与图片', { 资源编号: 'IMAGE-1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    const id = book.addImage({ extension: 'png', base64: Buffer.from('not an image').toString('base64') });
    sheet(book, '资源与图片').addImage(id, { tl: { col: 6, row: 2 }, ext: { width: 1, height: 1 } });
  })).toContain('INVALID_IMAGE_BYTES');
});

it('preserves references when rows are reordered without changing stable IDs', async () => {
  const reordered = await checkSopMaintenance(await workbook(book => {
    const table = sheet(book, '执行任务');
    const before = table.getRow(4).values;
    table.getRow(4).values = table.getRow(5).values;
    table.getRow(5).values = before;
  }));
  expect(reordered).toMatchObject({ status: 'reviewed', publishable: false, entries: 3 });
});

it('generates the versioned six-sheet template through the CLI without claiming it is reviewed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sop-template-'));
  try {
    const output = join(directory, 'template.xlsx');
    const cli = new URL('../../../scripts/check-sop-maintenance.mjs', import.meta.url);
    const { stdout } = await promisify(execFile)(process.execPath, [cli.pathname, '--template', output]);
    expect(JSON.parse(stdout)).toEqual({ status: 'template-created', publishable: false });
    const bytes = await readFile(output);
    const result = await checkSopMaintenance(bytes);
    expect(result.status).toBe('invalid');
    expect(result.issues.map(issue => issue.code)).toEqual(['EMPTY_DATA']);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(new Uint8Array(bytes).buffer);
    expect(reopened.worksheets.map(table => table.name)).toEqual(Object.keys(SOP_MAINTENANCE_HEADERS));
    for (const table of reopened.worksheets) expect(table.getCell('A1').value).toBe(SOP_MAINTENANCE_TEMPLATE_VERSION);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects duplicate visible branch labels even when identifiers differ', async () => {
  expect(await codes(book => set(book, '判断分支', 4, '选项', '材料齐全'))).toContain('DUPLICATE_CHOICE');
});

it.each([
  ['合成  选项', '合成 选项'], ['合成选项', ' 合成选项 '], ['合成\t选项', '合成\n选项'],
  ['合成\u00a0选项', '合成 选项'],
])('rejects choices whose rendered whitespace makes %j and %j indistinguishable', async (first, second) => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    set(book, '判断分支', 3, '选项', first);
    set(book, '判断分支', 4, '选项', second);
  }));
  expect(parsed.kind).toBe('invalid');
  expect(parsed.report.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_CHOICE', sheet: '判断分支', row: 4, column: 'C' }));
  expect(parsed).not.toHaveProperty('document');
});

it('preserves the original spelling of distinct visible choices', async () => {
  const parsed = await parseSopMaintenance(await workbook(book => {
    set(book, '判断分支', 3, '选项', '合成  甲');
    set(book, '判断分支', 4, '选项', '合成乙');
  }));
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report).toMatchObject({ status: 'reviewed', publishable: false });
  expect(parsed.document.branches.map(branch => branch.label)).toEqual(['合成  甲', '合成乙']);
});

it.each([
  ['complete GIF', gif, 'gif'],
  ['truncated GIF', gif.subarray(0, -1), 'gif'],
  ['GIF declared as PNG', gif, 'png'],
  ['GIF declared as JPEG', gif, 'jpeg'],
  ['unreadable declared GIF', Buffer.from('not an image'), 'gif'],
] as const)('rejects %s at its resource row without returning a partial draft', async (_name, bytes, extension) => {
  const result = await parseSopMaintenance(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMG-GIF', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, png, 'png', 3); addPicture(book, bytes, extension, 3);
  }));
  expect(result.kind).toBe('invalid');
  expect(result).not.toHaveProperty('document');
  expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'MEDIA_FORMAT_UNSUPPORTED', sheet: '资源与图片', row: 3, column: 'G', fix: expect.stringContaining('GIF') }));
});

it('identifies GIF even when its picture is placed outside the resource table', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    const id = book.addImage({ extension: 'gif', base64: gif.toString('base64') });
    sheet(book, '执行任务').addImage(id, 'B3:B3');
  }));
  expect(result.kind).toBe('invalid');
  expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'MEDIA_FORMAT_UNSUPPORTED', sheet: '执行任务', row: 3, column: 'B', fix: expect.stringContaining('GIF') }));
  expect(result.report.issues.map(issue => issue.code)).toContain('MISPLACED_IMAGE');
});

it('identifies a GIF background by sheet and resource without returning a draft', async () => {
  const result = await parseSopMaintenance(await workbook(book => {
    const id = book.addImage({ extension: 'gif', base64: gif.toString('base64') });
    sheet(book, '资源与图片').addBackgroundImage(id);
  }));
  expect(result.kind).toBe('invalid');
  expect(result).not.toHaveProperty('document');
  expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'MEDIA_FORMAT_UNSUPPORTED', sheet: '资源与图片', row: 1, fix: expect.stringContaining('GIF') }));
});

it.each([
  ['gif', gif, 'MEDIA_FORMAT_UNSUPPORTED'],
  ['png', png, 'UNANCHORED_IMAGE'],
] as const)('reports an unreferenced %s resource rather than ignoring it', async (extension, bytes, code) => {
  const zip = await JSZip.loadAsync(await workbook());
  zip.file(`xl/media/unreferenced.${extension}`, bytes);
  const file = zip.file('[Content_Types].xml');
  if (!file) throw new Error('SYNTHETIC_CONTENT_TYPES_MISSING');
  zip.file('[Content_Types].xml', (await file.async('string')).replace('</Types>', `<Default Extension="${extension}" ContentType="image/${extension}"/></Types>`));
  const result = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(result.kind).toBe('invalid');
  expect(result).not.toHaveProperty('document');
  expect(result.report.issues).toContainEqual(expect.objectContaining({ code, fix: expect.stringContaining('未关联图片资源') }));
});


it.each(['jpg', 'JPG'])("accepts JPEG resources named with .%s", async extension => {
  const zip = await JSZip.loadAsync(await workbook(book => {
    add(book, '资源与图片', { 资源编号: 'IMG-JPEG', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成店铺' });
    addPicture(book, jpeg, 'jpeg', 3);
  }));
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.endsWith('.jpeg')) {
      zip.file(name.replace(/\.jpeg$/u, `.${extension}`), await file.async('nodebuffer'));
      zip.remove(name);
    } else if (name.endsWith('.xml') || name.endsWith('.rels')) {
      zip.file(name, (await file.async('string')).replace(/\.jpeg/gu, `.${extension}`).replace(/Extension="jpeg"/gu, `Extension="${extension}"`));
    }
  }
  const result = await parseSopMaintenance(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(result.kind, JSON.stringify(result.report)).toBe('parsed');
  if (result.kind !== 'parsed') throw new Error('SYNTHETIC_JPEG_RESOURCE_MISSING');
  expect(result.document.resources).toContainEqual(expect.objectContaining({ images: [expect.objectContaining({ bytes: jpeg, mime: 'image/jpeg' })] }));
});
