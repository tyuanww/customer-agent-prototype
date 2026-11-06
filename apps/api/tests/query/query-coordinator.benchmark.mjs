import { createHash } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  toQueryAccessView,
} from '@customer-agent/unified-contracts';
import { ContentPipeline } from '../../dist/query/content-pipeline.js';
import { QueryCoordinator } from '../../dist/query/query-coordinator.js';
import { createReleaseStore } from '../../dist/query/release-snapshot.js';

const SAMPLE_COUNT = 200;
const WARMUP_COUNT = 20;
const NOW = '2026-11-05T00:30:00.000Z';
const NOW_MS = Date.parse(NOW);
const scope = {
  kind: 'source',
  tenantId: 'tenant_synthetic_bench',
  appId: 'app_synthetic_bench',
  brandId: 'brand_synthetic_bench',
  shopId: 'shop_synthetic_bench',
  domain: 'general',
  sourceId: 'source_synthetic_bench',
};

function accessDecision() {
  return {
    userId: 'usr_synthetic_bench',
    role: 'agent',
    state: 'allowed',
    allowedScopes: [{
      scope,
      actions: ['query'],
      validUntil: '2026-11-06T00:30:00.000Z',
    }],
    accessRevision: 1,
    factsVersion: 1,
    revocationGeneration: 0,
    policyVersion: 1,
    storeSetVersion: 1,
    resolvedAt: NOW,
    expiresAt: '2026-11-06T00:30:00.000Z',
    denyReason: null,
  };
}

function releaseSnapshot(size) {
  const hash = createHash('sha256').update(`release-${String(size)}`).digest('hex');
  return {
    releaseId: `rel_synthetic_bench_${String(size)}`,
    sequence: size === 152 ? 1 : 2,
    publishedAt: NOW,
    content: {
      state: 'ready',
      indexId: `idx_synthetic_bench_${String(size)}`,
      indexVersion: 1,
      itemCount: size,
      indexHash: hash,
    },
    sop: { state: 'empty', indexId: null, indexVersion: null, itemCount: 0, indexHash: null },
  };
}

function contentItems(size, snapshot) {
  return Array.from({ length: size }, (_, index) => {
    const ordinal = String(index).padStart(5, '0');
    return {
      releaseId: snapshot.releaseId,
      scriptId: `script_synthetic_${ordinal}`,
      scriptVersion: 1,
      contentHash: createHash('sha256').update(`body-${ordinal}`).digest('hex'),
      title: `合成发货时效 ${ordinal}`,
      body: `合成发货原文 ${ordinal}`,
      questionTexts: [`发货问题 ${ordinal}`, '什么时候发货'],
      platformScope: ['qianniu', 'douyin'],
      productScopeType: 'storewide',
      productScopeRefs: [],
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      scope,
    };
  });
}

function percentile(sorted, fraction) {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: samples.length,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

async function measureScale(size) {
  const snapshot = releaseSnapshot(size);
  const items = contentItems(size, snapshot);
  const pipeline = new ContentPipeline({ now: () => new Date(NOW_MS) });
  const activationStarted = performance.now();
  pipeline.activate(snapshot, items);
  const activationMs = performance.now() - activationStarted;
  const access = toQueryAccessView(accessDecision());
  const coordinator = new QueryCoordinator({
    access: { evaluate: async () => accessDecision() },
    releases: createReleaseStore(async () => snapshot),
    content: pipeline,
    now: () => new Date(NOW_MS),
  });

  const query = (sample) => `发货问题 ${String(sample % size).padStart(5, '0')}`;
  let errors = 0;
  for (let sample = 0; sample < WARMUP_COUNT; sample += 1) {
    const pipelineResult = await pipeline.query({
      queryId: `warm-pipeline-${String(sample)}`,
      text: query(sample),
      snapshot,
      access,
    });
    const coordinatorResult = await coordinator.query({
      queryId: `warm-coordinator-${String(sample)}`,
      text: query(sample),
      route: 'content',
    });
    if (!pipelineResult.ok || coordinatorResult.kind !== 'content') errors += 1;
  }

  const pipelineSamples = [];
  const coordinatorSamples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const pipelineStarted = performance.now();
    const pipelineResult = await pipeline.query({
      queryId: `bench-pipeline-${String(sample)}`,
      text: query(sample),
      snapshot,
      access,
    });
    pipelineSamples.push(performance.now() - pipelineStarted);
    if (!pipelineResult.ok) errors += 1;

    const coordinatorStarted = performance.now();
    const coordinatorResult = await coordinator.query({
      queryId: `bench-coordinator-${String(sample)}`,
      text: query(sample),
      route: 'content',
    });
    coordinatorSamples.push(performance.now() - coordinatorStarted);
    if (coordinatorResult.kind !== 'content') errors += 1;
  }

  const inspection = pipeline.inspect();
  if (inspection.activationCount !== 1 || inspection.indexId !== snapshot.content.indexId) {
    errors += 1;
  }
  return {
    scale: size,
    coldActivationMs: activationMs,
    warmState: true,
    observations: SAMPLE_COUNT,
    measurements: {
      warmOrdinaryQuery: summarize(coordinatorSamples),
      inProcessRanking: summarize(pipelineSamples),
    },
    indexBuilds: inspection.activationCount,
    perQueryRebuilds: Math.max(0, inspection.activationCount - 1),
    errors,
  };
}

const cpu = os.cpus()[0]?.model ?? 'unknown';
const scales = [];
for (const size of [152, 5_000]) scales.push(await measureScale(size));

const report = {
  benchmark: 'QRY-01 ordinary content query',
  capturedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    pnpm: '11.19.0',
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu,
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  workload: {
    syntheticOnly: true,
    warmupsPerScale: WARMUP_COUNT,
    samplesPerScale: SAMPLE_COUNT,
    observationMode: 'pipeline and coordinator observations interleaved on one prepared index',
    text: 'synthetic Chinese shipping questions and answers',
  },
  limiterReason: 'single-process Node.js CPU; no network, database, dense model, or external model work in the measured path; prepared BM25 scoring scans the eligible document view',
  zeroPerQueryRebuild: scales.every((scale) => scale.indexBuilds === 1 && scale.perQueryRebuilds === 0),
  errorCount: scales.reduce((sum, scale) => sum + scale.errors, 0),
  scales,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.zeroPerQueryRebuild || report.errorCount !== 0) process.exitCode = 1;
