import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDocs = new Set(['README.md', 'PROJECT_CHARTER.md', 'CHANGELOG.md', 'TODOS.md', 'DESIGN.md', 'DEVELOPMENT_BRIEF.md']);
export const RULE_DOCUMENTS = new Set(['AGENTS.md', 'docs/reference-engineering-workflow.md', 'docs/reference-document-lifecycle.md', 'docs/how-to-verify-desktop.md']);

/** Unknown files, empty diffs and build metadata fail closed to the full lanes. */
export function verificationPlan(files) {
  if (!Array.isArray(files) || files.length === 0) return { mode: 'full', rules: true };
  let ruleChange = false;
  for (const file of files) {
    if (typeof file !== 'string' || file.includes('..') || file.includes('\\') || file.startsWith('/')) return { mode: 'full', rules: true };
    if (RULE_DOCUMENTS.has(file)) { ruleChange = true; continue; }
    if (rootDocs.has(file) || /^docs\/.+\.md$/u.test(file)) continue;
    return { mode: 'full', rules: true };
  }
  return { mode: 'docs', rules: ruleChange };
}

/** Includes both sides of renames and deletions. Local mode includes untracked files. */
export function changedFiles(base, head, cwd = root) {
  if (!/^[0-9a-f]{7,40}$/u.test(base) || (head && !/^[0-9a-f]{7,40}$/u.test(head))) throw new Error('VERIFICATION_REF_INVALID');
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = git(['diff', '--no-renames', '--name-only', '-z', base, ...(head ? [head] : []), '--']);
  if (!head) files.push(...git(['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set(files)].sort();
}

export function assertCiGate(needs) {
  for (const key of ['changes', 'quality', 'postgres-15', 'windows-feasibility']) {
    if (needs?.[key]?.result !== 'success') throw new Error(`CI_REQUIRED_JOB_NOT_SUCCESS: ${key}`);
  }
  if (!['docs', 'full'].includes(needs.changes.outputs?.mode)) throw new Error('CI_PLAN_MISSING');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'gate' && args.length === 0) {
    assertCiGate(JSON.parse(process.env.CI_NEEDS ?? 'null'));
    console.log('CI gate PASS: every required job completed successfully.');
  } else if (command === 'plan') {
    let base; let head;
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === '--base' && !base) base = args[i + 1];
      else if (args[i] === '--head' && !head) head = args[i + 1];
      else throw new Error('VERIFICATION_ARGUMENT_INVALID');
    }
    const files = changedFiles(base, head);
    const plan = verificationPlan(files);
    console.log(JSON.stringify({ ...plan, files }, null, 2));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nrules=${plan.rules}\n`);
  } else throw new Error('VERIFICATION_COMMAND_INVALID');
}
