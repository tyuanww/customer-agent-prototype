import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSyntheticFixtures,
  type ObservabilityRuntime,
} from './fixtures.ts';

export const DEFAULT_OBSERVABILITY_REPORT_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'generated',
);

export type SyntheticReportArtifacts = Readonly<{
  json: string;
  markdown: string;
}>;

let runtimePromise: Promise<typeof import('../../apps/api/dist/observability/index.js')> | null = null;

function observabilityRuntime(): Promise<typeof import('../../apps/api/dist/observability/index.js')> {
  if (runtimePromise !== null) return runtimePromise;
  runtimePromise = (async () => {
    execFileSync(
      'pnpm',
      ['--filter', '@customer-agent/api', 'build'],
      { cwd: repositoryRoot, stdio: 'pipe' },
    );
    return import('../../apps/api/dist/observability/index.js');
  })();
  return runtimePromise;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildSyntheticReportArtifacts(): Promise<SyntheticReportArtifacts> {
  const runtime = await observabilityRuntime();
  const fixtures = buildSyntheticFixtures(runtime as ObservabilityRuntime);
  const evaluations = runtime.aggregateEvaluationPair(
    fixtures.evaluations.ordinary,
    fixtures.evaluations.sop,
  );
  const alerts = runtime.buildAlertRecords({
    observedAt: fixtures.observedAt,
    latency: fixtures.latency,
    unknownOperations: fixtures.unknownOperations,
    deadLetters: fixtures.deadLetters,
    staleReleases: fixtures.staleReleases,
    releaseIndexFailures: fixtures.releaseIndexFailures,
  });
  const report = runtime.buildObservabilityReport({
    observedAt: fixtures.observedAt,
    latency: fixtures.latency,
    alerts,
    traceStatusCounts: fixtures.traceStatusCounts,
    evaluations,
  });
  const rendered = runtime.renderObservabilityReport(report);
  return Object.freeze({ json: rendered.json, markdown: rendered.markdown });
}

export async function writeSyntheticReport(
  outputDirectory = DEFAULT_OBSERVABILITY_REPORT_DIRECTORY,
): Promise<SyntheticReportArtifacts> {
  const artifacts = await buildSyntheticReportArtifacts();
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, 'observability-report.json'), artifacts.json);
  writeFileSync(join(outputDirectory, 'observability-report.md'), artifacts.markdown);
  return artifacts;
}

export async function checkSyntheticReport(
  outputDirectory = DEFAULT_OBSERVABILITY_REPORT_DIRECTORY,
): Promise<void> {
  const artifacts = await buildSyntheticReportArtifacts();
  const json = readFileSync(join(outputDirectory, 'observability-report.json'), 'utf8');
  const markdown = readFileSync(join(outputDirectory, 'observability-report.md'), 'utf8');
  if (json !== artifacts.json || markdown !== artifacts.markdown) {
    throw new Error('generated observability report is stale');
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  if (check) {
    await checkSyntheticReport();
    process.stdout.write('observability report is current\n');
    return;
  }
  const artifacts = await writeSyntheticReport();
  process.stdout.write(
    `wrote ${artifacts.json.length} bytes of JSON and ${artifacts.markdown.length} bytes of Markdown\n`,
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await main();
}
