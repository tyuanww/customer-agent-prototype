import { readFile, stat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMenokinSopReview } from '../dist/workbook.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fail = () => { throw new Error('LOCAL_REVIEW_INPUT_OR_OUTPUT_INVALID'); };
async function readBounded(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 33_554_432) fail();
  return readFile(path);
}
async function outsideRepository(path) {
  const parent = await realpath(dirname(path));
  const destination = resolve(parent, path.split(sep).at(-1));
  const root = await realpath(repository);
  if (destination === root || destination.startsWith(root + sep)) fail();
  let cursor = parent;
  while (true) {
    try { await stat(resolve(cursor, '.git')); fail(); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const next = dirname(cursor); if (next === cursor) break; cursor = next;
  }
  return destination;
}
async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--source', '--review', '--selection', '--output-dir'].includes(flag) || !args[i + 1] || flag in options) fail();
    options[flag] = args[i + 1];
  }
  if (!options['--source'] || !options['--output-dir']) fail();
  const destination = await outsideRepository(resolve(options['--output-dir']));
  const review = options['--review'] ? JSON.parse((await readBounded(options['--review'])).toString('utf8')) : undefined;
  const selectionRaw = options['--selection'] ? JSON.parse((await readBounded(options['--selection'])).toString('utf8')) : undefined;
  if (selectionRaw !== undefined && (!selectionRaw || typeof selectionRaw !== 'object' || Array.isArray(selectionRaw)
    || Object.keys(selectionRaw).some(key => !['rowIds', 'flowIds'].includes(key)))) fail();
  const result = await prepareMenokinSopReview(await readBounded(options['--source']), {
    ...(review === undefined ? {} : { review }), ...(selectionRaw === undefined ? {} : { selection: selectionRaw }),
  });
  await mkdir(destination, { mode: 0o700 });
  await writeFile(resolve(destination, 'report.json'), JSON.stringify(result.kind === 'invalid-input' ? result : {
    kind: result.kind, review: result.review,
  }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  if (result.kind === 'authoring-ready') await writeFile(resolve(destination, 'authoring-plan.json'),
    JSON.stringify(result.authoringPlan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ kind: result.kind }) + '\n');
  if (result.kind === 'invalid-input') process.exitCode = 2;
}
main().catch(() => {
  process.stderr.write('LOCAL_REVIEW_INPUT_OR_OUTPUT_INVALID\n');
  process.exitCode = 2;
});
