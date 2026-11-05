import { performance } from 'node:perf_hooks';
import { parseAccessDecision, parseQueryOutcome, toQueryAccessView } from '../dist/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const count = 10_000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportDir = process.env.ARC01_REPORT_DIR ?? path.resolve(root, '../../reports');
const now = '2026-11-05T08:00:00Z';
const access = { userId: 'user-owner', role: 'director', state: 'allowed', allowedScopes: [{ scope: { kind: 'source', tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'aftersale', sourceId: 'source-a' }, actions: ['query'], validUntil: '2026-11-05T09:00:00Z' }], accessRevision: 12, factsVersion: 8, revocationGeneration: 3, policyVersion: 5, storeSetVersion: 4, resolvedAt: now, expiresAt: '2026-11-05T09:00:00Z', denyReason: null };
const content = { kind: 'content', queryId: 'query-1', releaseId: 'release-2', candidates: [{ candidateId: 'script-1', title: '合成发货说明', body: '合成正文，只用于基准测试。', copyHandle: 'copy-1', rank: 1 }] };
const sop = { kind: 'sop', queryId: 'query-2', releaseId: 'release-2', flow: { sopId: 'sop-1', title: '合成流程', entryStepId: 'step-1', steps: [{ stepId: 'step-1', kind: 'decision', sequence: 1, text: '确认。', media: [] }], branches: [{ branchId: 'branch-1', label: '是', targetStepId: 'step-1' }] } };

function run(name, input, fn) { const samples = []; let errors = 0; for (let i = 0; i < count; i += 1) { const start = performance.now(); try { fn(input); } catch { errors += 1; } samples.push(performance.now() - start); } samples.sort((a, b) => a - b); const at = (p) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]; return { name, iterations: count, inputScale: name === 'access' ? '1 decision, 1 source scope, 1 action' : '1 discriminated result, 1 item/step', p50Ms: at(0.50), p95Ms: at(0.95), p99Ms: at(0.99), errorCount: errors }; }

const results = [run('content', content, parseQueryOutcome), run('sop', sop, parseQueryOutcome), run('access', access, (v) => toQueryAccessView(parseAccessDecision(v)))];
const report = { benchmark: 'ARC-01 contract parsing and projection', timestamp: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: process.env.PROCESSOR_IDENTIFIER ?? 'not reported' }, baseline: { source: 'origin/main@83a59ed8', status: 'unavailable: package did not exist on baseline', p95Ms: null }, limiterReason: 'No trunk implementation exists for a same-shape comparison; limits are the brief target of p95 < 2 ms and errorCount = 0.', results };
await mkdir(reportDir, { recursive: true });
await writeFile(path.join(reportDir, 'arc-01-contract-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
