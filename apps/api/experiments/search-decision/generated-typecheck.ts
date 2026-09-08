import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeLabSearch } from './lab-search.js';
import { API_ROOT, EXPERIMENT_ROOT, GENERATED_SEARCH_DECISION } from './paths.js';

export const GENERATED_TSCONFIG = resolve(EXPERIMENT_ROOT, 'tsconfig.generated.json');

export type GeneratedTscResult = Readonly<{
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}>;

function tscBin(): string {
  const path = resolve(API_ROOT, 'node_modules/typescript/bin/tsc');
  if (!existsSync(path)) {
    throw new Error(`SEARCH_DECISION_LAB_TSC_MISSING:${path}`);
  }
  return path;
}

export function runGeneratedTsc(
  extraArgs: readonly string[] = [],
  tsconfig = GENERATED_TSCONFIG,
): GeneratedTscResult {
  if (tsconfig === GENERATED_TSCONFIG && !existsSync(GENERATED_SEARCH_DECISION)) {
    throw new Error('SEARCH_DECISION_LAB_GENERATED_MISSING');
  }
  const result = spawnSync(process.execPath, [tscBin(), '--pretty', 'false', '-p', tsconfig, ...extraArgs], {
    cwd: API_ROOT,
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`SEARCH_DECISION_LAB_GENERATED_TSC_SPAWN:${result.error.message}`);
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return Object.freeze({
    status: result.status === null ? 1 : result.status,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
  });
}

export function materializeAndTypecheckGenerated(): string {
  const generatedPath = materializeLabSearch();
  const result = runGeneratedTsc(['--noEmit']);
  if (result.status !== 0) {
    throw new Error(`SEARCH_DECISION_LAB_GENERATED_TSC:${result.status}\n${result.output}`);
  }
  return generatedPath;
}

function isExecutedAsScript(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isExecutedAsScript()) {
  try {
    process.stdout.write(`${materializeAndTypecheckGenerated()}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
