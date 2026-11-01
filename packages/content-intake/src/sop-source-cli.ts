import { constants } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSopMaintenance } from './maintenance.js';
import { buildSyntheticSopDraft, createSourceDecisionTemplate } from './sop-source-draft.js';
import { inspectSyntheticSopSource, type SourceImage } from './sop-source-inventory.js';
import { createSyntheticSourcePreview } from './sop-source-preview.js';
import { INTAKE_POLICY as P } from './policy.js';

export async function readSyntheticSourceFile(path: string, limit: number): Promise<Buffer> {
  if (!isAbsolute(path)) throw new Error('ABSOLUTE_PATH_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > limit) throw new Error('INPUT_FILE_INVALID');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const bytes = buffer.subarray(0, length), after = await handle.stat();
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs) throw new Error('INPUT_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** This engineering format uses JSON.stringify's representation so duplicate keys
 * cannot be silently overwritten by the standard JSON parser. */
export function parseSyntheticSourceDecisionJson(bytes: Buffer): unknown {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(source);
    const compact = source.replace(/("(?:[^"\\]|\\.)*")|\s+/gu, (_match, quoted: string | undefined) => quoted ?? '');
    if (JSON.stringify(value) !== compact) throw new Error('NONCANONICAL_DECISIONS_JSON');
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === 'NONCANONICAL_DECISIONS_JSON') throw error;
    throw new Error('INVALID_DECISIONS_JSON');
  }
}
async function writeNew(path: string, value: string | Buffer): Promise<void> {
  await writeFile(path, value, { flag: 'wx', mode: 0o600 });
}

export async function runSyntheticSourceCli(args: readonly string[]): Promise<number> {
  const [command, sourcePath, third, fourth] = args;
  if ((command !== 'inventory' && command !== 'draft') || !sourcePath || !third
    || (command === 'inventory' && args.length !== 3) || (command === 'draft' && (args.length !== 4 || !fourth))) {
    throw new Error('USAGE: inventory /absolute/source.xlsx /absolute/new-directory | draft /absolute/source.xlsx /absolute/decisions.json /absolute/new-directory');
  }
  const output = command === 'inventory' ? third : fourth;
  if (!output || !isAbsolute(output)) throw new Error('ABSOLUTE_PATH_REQUIRED');
  const sourceBytes = await readSyntheticSourceFile(sourcePath, P.fileBytes);
  if (command === 'inventory') {
    const source = await inspectSyntheticSopSource(sourceBytes);
    await mkdir(output, { mode: 0o700 });
    await writeNew(join(output, 'inventory.json'), json(source.inventory));
    await writeNew(join(output, 'decisions.json'), json(createSourceDecisionTemplate(source)));
    await writeNew(join(output, 'inventory-preview.xlsx'), await createSyntheticSourcePreview(source));
    const pictures = source.inventory.objects.filter((item): item is SourceImage => item.kind === 'image' || item.kind === 'background');
    if (pictures.length) await mkdir(join(output, 'assets'), { mode: 0o700 });
    const written = new Set<string>();
    for (const picture of pictures) {
      const bytes = source.images.get(picture.id);
      if (!bytes) throw new Error('MISSING_IMAGE_BYTES');
      const name = `${picture.sha256}.${picture.extension}`;
      if (!written.has(name)) { await writeNew(join(output, 'assets', name), bytes); written.add(name); }
    }
    console.log(JSON.stringify({ status: 'inventory', publishable: false, objects: source.inventory.objects.length, images: pictures.length }));
    return 0;
  }
  const decisionBytes = await readSyntheticSourceFile(third, P.fileBytes);
  const input = parseSyntheticSourceDecisionJson(decisionBytes);
  const draft = await buildSyntheticSopDraft(sourceBytes, input);
  await mkdir(output, { mode: 0o700 });
  const workbookPath = join(output, 'maintenance.xlsx');
  await writeNew(workbookPath, draft.workbook);
  // Reopen the actual file, not just the in-memory buffer returned by ExcelJS.
  const saved = await readFile(workbookPath);
  const rechecked = await parseSopMaintenance(saved);
  if (createHash('sha256').update(saved).digest('hex') !== draft.report.workbookSha256
    || JSON.stringify(rechecked.report) !== JSON.stringify(draft.report.maintenance)) throw new Error('OUTPUT_RECHECK_FAILED');
  await writeNew(join(output, 'reconciliation.json'), json(draft.report));
  console.log(JSON.stringify({ status: draft.report.mappingComplete ? 'reconciled' : 'needs-review',
    maintenanceStatus: draft.report.maintenance.status, publishable: false,
    mappingComplete: draft.report.mappingComplete, counts: draft.report.counts }));
  return draft.report.mappingComplete ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runSyntheticSourceCli(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'SYNTHETIC_DRAFT_FAILED');
    process.exitCode = 2;
  }
}
