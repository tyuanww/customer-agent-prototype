import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { INTAKE_POLICY as P } from './policy.js';
import { readSyntheticSourceFile } from './sop-source-cli.js';
import { buildSyntheticSopDraft, checkSyntheticSopSourceDraft } from './sop-source-draft.js';
import { buildSyntheticMappingDraft, createSyntheticMappingReport, createSyntheticMappingWorkbook, decisionsFromSyntheticMapping } from './sop-source-mapping.js';

const usage = 'prepare /绝对路径/合成原表.xlsx /绝对路径/整理表.xlsx | build /绝对路径/合成原表.xlsx /绝对路径/整理表.xlsx /绝对路径/新目录 | verify /绝对路径/合成原表.xlsx /绝对路径/整理表.xlsx /绝对路径/维护稿.xlsx /绝对路径/核对结果.xlsx';
async function writeNew(path: string, value: Buffer): Promise<void> {
  if (!isAbsolute(path)) throw new Error('路径必须是绝对路径');
  await writeFile(path, value, { flag: 'wx', mode: 0o600 });
}

export async function runSyntheticMappingCli(args: readonly string[]): Promise<number> {
  const [command, sourcePath, mappingPath, output, reportPath] = args;
  if (!sourcePath || !mappingPath || !isAbsolute(sourcePath) || !isAbsolute(mappingPath)
    || (command === 'prepare' && args.length !== 3)
    || (command === 'build' && (args.length !== 4 || !output || !isAbsolute(output)))
    || (command === 'verify' && (args.length !== 5 || !output || !reportPath || !isAbsolute(output) || !isAbsolute(reportPath)))
    || (command !== 'prepare' && command !== 'build' && command !== 'verify')) throw new Error(usage);
  const source = await readSyntheticSourceFile(sourcePath, P.fileBytes);
  if (command === 'prepare') {
    await writeNew(mappingPath, await createSyntheticMappingWorkbook(source));
    console.log('合成整理表已生成。请编辑来源整理和六张目标表；图片预览仅供核对，不能发布。');
    return 0;
  }
  const mapping = await readSyntheticSourceFile(mappingPath, P.fileBytes);
  if (command === 'build' && output) {
    const result = await buildSyntheticMappingDraft(source, mapping);
    await mkdir(output, { mode: 0o700 });
    const workbookPath = join(output, '合成维护稿.xlsx');
    await writeNew(workbookPath, result.draft.workbook);
    const saved = await readFile(workbookPath);
    const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: saved });
    await writeNew(join(output, '合成核对结果.xlsx'), await createSyntheticMappingReport(source, result.draft, check, result.decisions, saved));
    console.log(JSON.stringify({ coverage: check.counts.pending || check.counts.unsupported ? 'pending' : 'covered',
      sourceCheck: check.sourceCheck, businessReview: 'not-verified', publishable: false, counts: check.counts, reasons: check.reasons }));
    return 3;
  }
  if (command === 'verify' && output && reportPath) {
    const saved = await readSyntheticSourceFile(output, P.fileBytes);
    const decisions = await decisionsFromSyntheticMapping(source, mapping);
    const draft = await buildSyntheticSopDraft(source, decisions);
    const check = await checkSyntheticSopSourceDraft({ source, decisions, workbook: saved });
    await writeNew(reportPath, await createSyntheticMappingReport(source, draft, check, decisions, saved));
    console.log(JSON.stringify({ coverage: check.counts.pending || check.counts.unsupported ? 'pending' : 'covered',
      sourceCheck: check.sourceCheck, businessReview: 'not-verified', publishable: false, counts: check.counts, reasons: check.reasons }));
    return 3;
  }
  throw new Error(usage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runSyntheticMappingCli(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : '合成整理失败');
    process.exitCode = 2;
  }
}
