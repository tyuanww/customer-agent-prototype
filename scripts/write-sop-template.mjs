#!/usr/bin/env node
/**
 * Writes the SOP workbook template the business fills in. The template is code, not
 * a file checked into the repository: row 1 must be the header and every data row
 * must carry its own code, and those are the parser's own rules.
 *
 *   node scripts/write-sop-template.mjs --out ./SOP-模板.xlsx
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createSopTemplate } from '../packages/content-intake/dist/workbook.js';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
if (at < 0 || !args[at + 1]) {
  console.error('write-sop-template: pass --out <file.xlsx>');
  process.exit(2);
}
const target = path.resolve(args[at + 1]);
const samples = [
  ['【示例·导入前请删除】第一步：确认订单号与买家诉求'],
  ['【示例·导入前请删除】第二步：核对物流轨迹后再答复', '同一行的多个单元格会拼成一段'],
];
await writeFile(target, await createSopTemplate(samples));
console.log(`wrote ${target}`);
