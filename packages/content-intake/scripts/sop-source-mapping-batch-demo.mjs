import ExcelJS from 'exceljs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseSopMaintenance } from '../dist/maintenance.js';
import { SYNTHETIC_SOURCE_CREATOR, inspectSyntheticSopSource } from '../dist/sop-source-inventory.js';
import { createSyntheticMappingWorkbook } from '../dist/sop-source-mapping.js';
import { runSyntheticMappingCli } from '../dist/sop-source-mapping-cli.js';

const output = process.argv[2];
if (!output || !isAbsolute(output) || process.argv.length !== 3) throw new Error('请提供不存在的绝对目录');
await mkdir(output, { mode: 0o700 });
const write = async (name, value) => writeFile(join(output, name), value, { flag: 'wx', mode: 0o600 });
const sourceBook = new ExcelJS.Workbook();
sourceBook.creator = SYNTHETIC_SOURCE_CREATOR;
for (let group = 1; group <= 6; group++) {
  const sheet = sourceBook.addWorksheet(`合成场景${group}`);
  for (let row = 1; row <= 200; row++) sheet.getCell(`A${row}`).value = `合成场景${group}的文字${row}`;
  if (group === 1) {
    const image = sourceBook.addImage({ buffer: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')).buffer, extension: 'png' });
    sheet.addImage(image, 'F1:G2');
  }
}
const source = Buffer.from(await sourceBook.xlsx.writeBuffer());
await write('1201合成原表.xlsx', source);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(new Uint8Array(await createSyntheticMappingWorkbook(source)).buffer);
const totals = { batchFields: 0, targetFields: 0, pictureFields: 0, sourceObjects: 0, textObjects: 0, imageObjects: 0 };
const nonempty = values => values.filter(value => typeof value === 'string' && value.length > 0).length;
const target = (name, key, fields, note = '') => {
  const sheet = workbook.getWorksheet(name), headers = sheet.getRow(2).values;
  const values = [key, note, ...headers.slice(3).map(header => fields[header] ?? '')];
  sheet.addRow(values);
  totals.targetFields += nonempty(values);
};
const batch = workbook.getWorksheet('批量整理');
for (let group = 1; group <= 6; group++) {
  target('知识与案例', `KN${group}`, { 知识编号: `K${group}`, 标题: `合成知识${group}`, 可见对象: '坐席可读' });
  const values = [`合成场景${group}`, 'A1:A200', '使用', `KN${group}`, '正文', '换行', ''];
  batch.addRow(values);
  totals.batchFields += nonempty(values);
}
target('场景目录', 'SCENE', { 场景编号: 'SC1', 场景名称: '合成总场景', 适用范围: '合成范围', 起始任务编号: 'T1', 入口词: '合成' }, '合成演示新增场景');
target('执行任务', 'TASK1', { 记录类型: '任务', 任务编号: 'T1', 场景编号: 'SC1', 阶段: '结束', 任务名称: '合成任务',
  任务类型: '终点', 操作要求: '合成操作', 确认项配置: '无确认项', 关联知识编号: 'K1,K2,K3,K4,K5,K6', 关联资源编号: 'R1', 可见对象: '坐席可读' }, '合成演示新增任务');
target('资源与图片', 'IMAGE', { 资源编号: 'R1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成范围' });
const mapping = workbook.getWorksheet('来源整理');
let pictureFound = false;
for (let number = 4; number <= mapping.rowCount; number++) {
  const row = mapping.getRow(number);
  if (row.getCell(1).value !== 'p:1:1:1') continue;
  row.getCell(6).value = '使用'; row.getCell(7).value = 'IMAGE'; row.getCell(8).value = '图片';
  totals.pictureFields += 3; pictureFound = true;
}
if (!pictureFound) throw new Error('合成图片不存在');
const mappingBytes = Buffer.from(await workbook.xlsx.writeBuffer());
await write('1201合成整理表-已填写.xlsx', mappingBytes);
const status = await runSyntheticMappingCli(['build', join(output, '1201合成原表.xlsx'),
  join(output, '1201合成整理表-已填写.xlsx'), join(output, '合成输出')]);
if (status !== 3) throw new Error('来源核对应保持待处理');
const inspected = await inspectSyntheticSopSource(source);
totals.sourceObjects = inspected.inventory.objects.length;
totals.textObjects = inspected.inventory.objects.filter(item => item.kind === 'text').length;
totals.imageObjects = inspected.inventory.objects.filter(item => item.kind === 'image').length;
const parsed = await parseSopMaintenance(await readFile(join(output, '合成输出', '合成维护稿.xlsx')));
const report = new ExcelJS.Workbook();
await report.xlsx.readFile(join(output, '合成输出', '合成核对结果.xlsx'));
if (totals.sourceObjects !== 1201 || totals.textObjects !== 1200 || totals.imageObjects !== 1 || parsed.kind !== 'parsed'
  || parsed.document.knowledge.length !== 6 || parsed.document.branches.length !== 0 || parsed.document.resources.length !== 1
  || parsed.document.knowledge.some((row, index) => row.body !== Array.from({ length: 200 }, (_, n) => `合成场景${index + 1}的文字${n + 1}`).join('\n'))
  || report.getWorksheet('预期来源去向')?.rowCount !== 1202 || report.getWorksheet('核对概览')?.getCell('B3').value !== '未核验') {
  throw new Error('合成演示结果不符');
}
const evidence = { ...totals, sourceAreas: 6, entries: totals.batchFields + totals.targetFields + totals.pictureFields,
  note: '填写项按脚本实际写入的非空单元格计数，不是鼠标点击数、人工耗时或真实表格的估算。分支未批量生成，图片仍待核对。' };
await write('合成填写项统计.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
