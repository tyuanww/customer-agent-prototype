import ExcelJS from 'exceljs';
import { crc32, deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { SOP_MAINTENANCE_HEADERS } from '../dist/maintenance.js';
import { SYNTHETIC_SOURCE_CREATOR } from '../dist/sop-source-inventory.js';
import { createSyntheticMappingWorkbook } from '../dist/sop-source-mapping.js';
import { runSyntheticMappingCli } from '../dist/sop-source-mapping-cli.js';

const output = process.argv[2];
if (!output || !isAbsolute(output) || process.argv.length !== 3) throw new Error('请提供一个不存在的绝对目录');
await mkdir(output, { mode: 0o700 });
const write = async (name, data) => writeFile(join(output, name), data, { flag: 'wx', mode: 0o600 });
const pngChunk = (type, data) => {
  const name = Buffer.from(type), length = Buffer.alloc(4), check = Buffer.alloc(4);
  length.writeUInt32BE(data.length); check.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, check]);
};
const width = 80, height = 48, ihdr = Buffer.alloc(13), pixels = Buffer.alloc((1 + width * 4) * height);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const offset = y * (1 + width * 4) + 1 + x * 4;
  const box = x > 12 && x < 68 && y > 9 && y < 39;
  pixels.set(box ? [108, 75, 194, 255] : [238, 232, 255, 255], offset);
}
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
const sourceBook = new ExcelJS.Workbook();
sourceBook.creator = SYNTHETIC_SOURCE_CREATOR;
const sheet = sourceBook.addWorksheet('合成原表');
sheet.getCell('A1').value = '收到商品后，请先检查包装。确认无误后，告知顾客处理结果。';
sheet.getCell('B1').value = '如有疑问请联系主管。';
sheet.getCell('C1').value = '包装检查（合成）';
sheet.getCell('D1').value = '核对包装状态（合成）';
sheet.getCell('E1').value = '处理完毕（合成）';
const picture = sourceBook.addImage({ buffer: new Uint8Array(png).buffer, extension: 'png' });
sheet.addImage(picture, 'F1:G3');
const source = Buffer.from(await sourceBook.xlsx.writeBuffer());
await write('合成原表.xlsx', source);
await write('合成整理表-空白.xlsx', await createSyntheticMappingWorkbook(source));
const book = new ExcelJS.Workbook();
await book.xlsx.load(new Uint8Array(await readFile(join(output, '合成整理表-空白.xlsx'))).buffer);
const mapping = book.getWorksheet('来源整理');
const find = id => {
  for (let index = 4; index <= mapping.rowCount; index++) if (mapping.getRow(index).getCell(1).value === id) return mapping.getRow(index);
  throw new Error('缺少合成来源');
};
const map = (row, target, field, joinMode = '') => {
  row.getCell(6).value = '使用'; row.getCell(7).value = target; row.getCell(8).value = field; row.getCell(9).value = joinMode;
};
const first = find('c:1:A1'), second = mapping.addRow([...first.values].slice(1));
first.getCell(5).value = '收到商品后，请先检查包装。';
second.getCell(5).value = '确认无误后，告知顾客处理结果。';
map(first, 'KN', '正文', '换行'); map(second, 'SCRIPT', '对客正文');
map(find('c:1:B1'), 'KN', '正文', '换行'); map(find('c:1:C1'), 'SCENE', '场景名称');
map(find('c:1:D1'), 'TASK1', '操作要求'); map(find('c:1:E1'), 'TASK2', '操作要求');
map(find('p:1:1:1'), 'IMAGE', '图片');
const target = (name, key, fields, note = '') => book.getWorksheet(name).addRow(
  [key, note, ...SOP_MAINTENANCE_HEADERS[name].filter(header => header !== '维护状态' && header !== '业务确认人').map(header => fields[header] ?? '')]);
target('场景目录', 'SCENE', { 场景编号: 'SC1', 适用范围: '合成范围', 起始任务编号: 'T1', 入口词: '包装' });
target('执行任务', 'TASK1', { 记录类型: '任务', 任务编号: 'T1', 场景编号: 'SC1', 阶段: '判断', 任务名称: '检查包装',
  任务类型: '判断', 确认项配置: '无确认项', 关联知识编号: 'K1', 关联资源编号: 'R1', 可见对象: '坐席可读' });
target('执行任务', 'TASK2', { 记录类型: '任务', 任务编号: 'T2', 场景编号: 'SC1', 阶段: '结束', 任务名称: '处理完成',
  任务类型: '终点', 确认项配置: '无确认项', 可见对象: '坐席可读' });
target('执行任务', 'TASK3', { 记录类型: '任务', 任务编号: 'T3', 场景编号: 'SC1', 阶段: '协助', 任务名称: '请求协助',
  任务类型: '终点', 操作要求: '请联系主管（合成）', 确认项配置: '无确认项', 可见对象: '坐席可读' }, '合成示例手工新增');
target('判断分支', 'BR1', { 分支编号: 'B1', 任务编号: 'T1', 选项: '包装完好', 判断依据: '无明显破损（合成）', 目标任务编号: 'T2',
  是否无法判断: '否', 匹配词: '不设置', 分支顺序: '1' }, '合成示例手工新增');
target('判断分支', 'BR2', { 分支编号: 'B2', 任务编号: 'T1', 选项: '无法判断', 判断依据: '需要补充信息（合成）', 目标任务编号: 'T3',
  是否无法判断: '是', 匹配词: '不设置', 分支顺序: '2' }, '合成示例手工新增');
target('知识与案例', 'KN', { 知识编号: 'K1', 标题: '包装检查知识（合成）', 可见对象: '坐席可读' });
target('客户话术', 'SCRIPT', { 话术编号: 'S1', 话术标题: '包装检查话术（合成）' });
target('资源与图片', 'IMAGE', { 资源编号: 'R1', 资源类型: '图片', 资源名称: '示意图（合成）', 可见对象: '坐席可读', 适用范围: '合成范围' });
await write('合成整理表-已填写.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
const status = await runSyntheticMappingCli(['build', join(output, '合成原表.xlsx'),
  join(output, '合成整理表-已填写.xlsx'), join(output, '合成输出')]);
if (status !== 3) throw new Error('合成演示应保持待核对');
