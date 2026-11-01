import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { checkSopMaintenance, createSopMaintenanceTemplate } from '../packages/content-intake/dist/maintenance.js';
import { INTAKE_POLICY } from '../packages/content-intake/dist/policy.js';
import { parseSyntheticSourceDecisionJson, readSyntheticSourceFile } from '../packages/content-intake/dist/sop-source-cli.js';
import { checkSyntheticSopSourceDraft } from '../packages/content-intake/dist/sop-source-draft.js';

const args = process.argv.slice(2);
const [input, output] = args;
const usage = 'Usage: node scripts/check-sop-maintenance.mjs input.xlsx report.json | --template output.xlsx | --source /absolute/source.xlsx /absolute/decisions.json /absolute/input.xlsx /absolute/report.json';
try {
  if (input === '--source' && args.length === 5) {
    const [, source, decisions, workbook, reportPath] = args;
    if (!isAbsolute(reportPath)) throw new Error('ABSOLUTE_PATH_REQUIRED');
    const report = await checkSyntheticSopSourceDraft({
      source: await readSyntheticSourceFile(source, INTAKE_POLICY.fileBytes),
      decisions: parseSyntheticSourceDecisionJson(await readSyntheticSourceFile(decisions, INTAKE_POLICY.fileBytes)),
      workbook: await readSyntheticSourceFile(workbook, INTAKE_POLICY.fileBytes),
    });
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ mode: report.mode, status: report.status, sourceCheck: report.sourceCheck,
      publishable: report.publishable, workbookMatchesMapping: report.workbookMatchesMapping, reasons: report.reasons }));
    process.exitCode = report.status === 'reviewed' ? 0 : report.status === 'needs-review' ? 3 : 2;
  } else if (!input || !output || args.length !== 2 || input === '--source') {
    console.error(usage);
    process.exitCode = 2;
  } else if (input === '--template') {
    await writeFile(output, await createSopMaintenanceTemplate(), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'template-created', publishable: false }));
  } else {
    const report = await checkSopMaintenance(await readFile(input));
    await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ templateVersion: report.templateVersion, status: report.status, sourceCheck: report.sourceCheck,
      publishable: report.publishable, entries: report.entries, resources: report.resources, images: report.images, issues: report.issues.length }));
    process.exitCode = report.status === 'reviewed' ? 0 : report.status === 'needs-review' ? 3 : 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'SOP_CHECK_FAILED');
  process.exitCode = 2;
}
