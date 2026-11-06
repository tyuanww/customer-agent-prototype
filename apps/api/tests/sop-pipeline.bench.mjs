import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { materializeSopReleaseFacts } from '@customer-agent/content-intake';
import { SopPipeline } from '../dist/query/sop-pipeline.js';

const sizes = [152, 5000];
const coldRuns = 7;
const warmRuns = 500;
const branchRuns = 2000;
const order = [
  'allergy',
  'acne',
  'quality-after-sale',
  'minor-error-broken',
  'tax',
];

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function summary(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function documentFor(rows) {
  const steps = Array.from({ length: rows }, (_, index) => ({
    stepId: index === rows - 1 ? 'branch-decision' : `step-${index + 1}`,
    kind: index === rows - 1 ? 'decision' : 'ordered',
    sequence: index + 1,
    parentStepId: null,
    nextStepId: index === rows - 2 ? 'branch-decision' : index === rows - 1 ? null : `step-${index + 2}`,
    targetStepId: null,
    title: `合成步骤 ${index + 1}`,
    description: '',
  }));
  return {
    definitions: [{
      sopId: 'synthetic-benchmark',
      sceneId: 'synthetic-benchmark',
      groupId: 'allergy',
      title: '合成性能流程',
      entryStepId: 'step-1',
      steps,
      branches: [{
        branchId: 'branch-a',
        sourceStepId: 'branch-decision',
        label: '选择 A',
        targetStepId: 'step-1',
      }],
      messages: [{ messageId: 'message-1', stepId: 'step-1', text: '合成命中话术', riskLevel: 'low' }],
      resources: [],
      searchEntries: [{
        entryId: 'route-synthetic',
        stepId: 'step-1',
        purpose: 'classify',
        text: '合成性能流程',
      }],
    }],
  };
}

function coldRun(rows) {
  const document = documentFor(rows);
  const releaseId = `rel_bench_${rows}`;
  const materializeStart = performance.now();
  const facts = materializeSopReleaseFacts(document, releaseId, order);
  const materializeMs = performance.now() - materializeStart;
  const indexStart = performance.now();
  const pipeline = new SopPipeline(facts.projection);
  const indexMs = performance.now() - indexStart;
  return {
    pipeline,
    totalMs: materializeMs + indexMs,
    materializeMs,
    indexMs,
  };
}

const cold = new Map(sizes.map((size) => [
  size,
  { total: [], materialize: [], index: [] },
]));
const prepared = new Map();
let errors = 0;
for (let run = 0; run < coldRuns; run += 1) {
  const current = run % 2 === 0 ? sizes : [...sizes].reverse();
  for (const size of current) {
    const result = coldRun(size);
    const bucket = cold.get(size);
    bucket.total.push(result.totalMs);
    bucket.materialize.push(result.materializeMs);
    bucket.index.push(result.indexMs);
    prepared.set(size, result.pipeline);
  }
}

const warm = new Map();
const branch = new Map();
let sink = 0;
for (const size of sizes) {
  const pipeline = prepared.get(size);
  const lease = {
    releaseId: `rel_bench_${size}`,
    sessionEpoch: 1,
    revoked: false,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  for (let index = 0; index < 50; index += 1) {
    const warmup = pipeline.query({
      queryId: `warmup-${size}-${index}`,
      text: '合成性能流程',
      lease,
    });
    if (warmup.kind !== 'sop') errors += 1;
  }
  const warmTimes = [];
  let flow;
  for (let index = 0; index < warmRuns; index += 1) {
    const start = performance.now();
    const outcome = pipeline.query({
      queryId: `warm-${size}-${index}`,
      text: '客户咨询合成性能流程',
      lease,
    });
    warmTimes.push(performance.now() - start);
    if (outcome.kind !== 'sop' || outcome.flow.steps.length !== size) {
      errors += 1;
    } else {
      flow = outcome.flow;
      sink += outcome.flow.steps.length + outcome.flow.entryStepId.length;
    }
  }
  const branchTimes = [];
  for (let index = 0; index < branchRuns; index += 1) {
    const start = performance.now();
    const first = flow.steps.find((step) => step.stepId === flow.entryStepId);
    const selected = flow.branches.find((item) => item.branchId === 'branch-a');
    branchTimes.push(performance.now() - start);
    sink += (first?.stepId.length ?? 0) + (selected?.targetStepId.length ?? 0);
  }
  warm.set(size, summary(warmTimes));
  branch.set(size, summary(branchTimes));
}

const report = {
  claim: 'release-fact materialization, pipeline index construction, and warm SOP lookup across 152 and 5000 synthetic rows',
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cores: cpus().length,
    loadAverage: loadavg(),
  },
  scales: Object.fromEntries(sizes.map((size) => [
    String(size),
    {
      coldBuildMs: {
        total: summary(cold.get(size).total),
        materialize: summary(cold.get(size).materialize),
        index: summary(cold.get(size).index),
      },
      warmQueryMs: warm.get(size),
      firstStepAndBranchLookupMs: branch.get(size),
    },
  ])),
  runs: { coldRuns, warmRuns, branchRuns },
  errors,
  workObserved: sink > 0,
  limiter: 'single-threaded JavaScript object construction and canonical JSON hashing during cold materialization; warm lookup is a normalized substring scan plus a prebuilt flow map lookup',
};

process.stdout.write(`SOP_PIPELINE_BENCH=${JSON.stringify(report)}\n`);
