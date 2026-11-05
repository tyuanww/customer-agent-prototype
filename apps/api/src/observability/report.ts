import type {
  AlertRecord,
  EvaluationRecord,
} from './contracts.generated.js';
import {
  BUDGET_SURFACES,
  DEFAULT_OBSERVABILITY_BUDGETS,
  evaluateBudget,
  type LatencySummary,
  type BudgetSurface,
  type Temperature,
} from './metrics.js';
import { redactAlertRecord, redactEvaluationRecord } from './redaction.js';
import type { TraceStatus } from './trace.js';
import { ObservabilityError } from './errors.js';

export type TraceStatusCounts = Readonly<Record<TraceStatus, number>>;

export type ObservabilityReportInput = Readonly<{
  observedAt: string;
  latency: readonly LatencySummary[];
  alerts: readonly AlertRecord[];
  traceStatusCounts: Readonly<{
    ordinary: TraceStatusCounts;
    sop: TraceStatusCounts;
  }>;
  evaluations: Readonly<{
    ordinary: Extract<EvaluationRecord, { kind: 'ordinary' }>;
    sop: Extract<EvaluationRecord, { kind: 'sop' }>;
  }>;
}>;

export type ObservabilityReport = Readonly<{
  schemaVersion: 1;
  mode: 'synthetic-mechanism';
  observedAt: string;
  notice: string;
  traceStatusCounts: ObservabilityReportInput['traceStatusCounts'];
  latency: readonly LatencySummary[];
  budgetChecks: readonly Readonly<{
    surface: BudgetSurface;
    temperature: Temperature;
    thresholdMs: number;
    observedMs: number;
    breached: boolean;
  }>[];
  alerts: readonly AlertRecord[];
  evaluations: ObservabilityReportInput['evaluations'];
}>;

const TRACE_STATUS_KEYS = [
  'complete',
  'incomplete',
  'cancelled',
  'failed',
  'stale',
  'unknown',
] as const satisfies readonly TraceStatus[];

function assertLatencyCoverage(latency: readonly LatencySummary[]): void {
  for (const surface of BUDGET_SURFACES) {
    for (const temperature of ['warm', 'cold'] as const) {
      const matches = latency.filter((summary) => (
        summary.surface === surface && summary.temperature === temperature
      ));
      const expected = temperature === 'warm' ? 200 : 20;
      if (matches.length !== 1 || matches[0]?.sampleCount !== expected) {
        throw new ObservabilityError(
          'REPORT_COVERAGE_INVALID',
          `report requires ${expected} ${temperature} samples for every budget surface`,
        );
      }
    }
  }
  if (latency.length !== BUDGET_SURFACES.length * 2) {
    throw new ObservabilityError(
      'REPORT_COVERAGE_INVALID',
      'report contains duplicate or extra latency summaries',
    );
  }
}

function normalizedCounts(counts: TraceStatusCounts): TraceStatusCounts {
  return Object.freeze({
    complete: counts.complete,
    incomplete: counts.incomplete,
    cancelled: counts.cancelled,
    failed: counts.failed,
    stale: counts.stale,
    unknown: counts.unknown,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildObservabilityReport(input: ObservabilityReportInput): ObservabilityReport {
  assertLatencyCoverage(input.latency);
  if (input.evaluations.ordinary.kind !== 'ordinary' || input.evaluations.sop.kind !== 'sop') {
    throw new ObservabilityError('REPORT_COVERAGE_INVALID', 'evaluations must keep query kinds separate');
  }
  const latency = Object.freeze([...input.latency].sort((left, right) => (
    compareText(
      `${left.surface}:${left.temperature}`,
      `${right.surface}:${right.temperature}`,
    )
  )));
  const budgetChecks = Object.freeze(latency.map((summary) => {
    const evaluated = evaluateBudget(summary, DEFAULT_OBSERVABILITY_BUDGETS);
    return Object.freeze({
      surface: evaluated.surface,
      temperature: evaluated.temperature,
      thresholdMs: evaluated.thresholdMs,
      observedMs: evaluated.observedMs,
      breached: evaluated.breached,
    });
  }));
  return Object.freeze({
    schemaVersion: 1,
    mode: 'synthetic-mechanism',
    observedAt: input.observedAt,
    notice: 'Synthetic fixtures exercise the observability mechanism. This is not production telemetry or a runtime latency measurement.',
    traceStatusCounts: Object.freeze({
      ordinary: normalizedCounts(input.traceStatusCounts.ordinary),
      sop: normalizedCounts(input.traceStatusCounts.sop),
    }),
    latency,
    budgetChecks,
    alerts: Object.freeze(input.alerts.map(redactAlertRecord)),
    evaluations: Object.freeze({
      ordinary: redactEvaluationRecord(input.evaluations.ordinary) as ObservabilityReportInput['evaluations']['ordinary'],
      sop: redactEvaluationRecord(input.evaluations.sop) as ObservabilityReportInput['evaluations']['sop'],
    }),
  });
}

function reportProjection(report: ObservabilityReport) {
  return {
    schemaVersion: report.schemaVersion,
    mode: report.mode,
    observedAt: report.observedAt,
    notice: report.notice,
    traceStatusCounts: {
      ordinary: report.traceStatusCounts.ordinary,
      sop: report.traceStatusCounts.sop,
    },
    latency: report.latency.map((summary) => ({
      surface: summary.surface,
      stage: summary.stage,
      budgetClass: summary.budgetClass,
      temperature: summary.temperature,
      limiter: summary.limiter,
      sampleCount: summary.sampleCount,
      errorCount: summary.errorCount,
      p50Ms: summary.p50Ms,
      p95Ms: summary.p95Ms,
      p99Ms: summary.p99Ms,
    })),
    budgetChecks: report.budgetChecks.map((check) => ({
      surface: check.surface,
      temperature: check.temperature,
      thresholdMs: check.thresholdMs,
      observedMs: check.observedMs,
      breached: check.breached,
    })),
    alerts: report.alerts.map(redactAlertRecord),
    evaluations: {
      ordinary: redactEvaluationRecord(report.evaluations.ordinary),
      sop: redactEvaluationRecord(report.evaluations.sop),
    },
  };
}

function markdownRows(report: ObservabilityReport): string[] {
  return report.latency.map((summary) => (
    `| ${summary.surface} | ${summary.temperature} | ${summary.sampleCount} | ${summary.errorCount} | ${summary.p50Ms} | ${summary.p95Ms} | ${summary.p99Ms} | ${summary.limiter} |`
  ));
}

export function renderObservabilityReport(report: ObservabilityReport): Readonly<{
  json: string;
  markdown: string;
}> {
  const json = `${JSON.stringify(reportProjection(report), null, 2)}\n`;
  const alerts = report.alerts.map((alert) => `- ${alert.kind}`).join('\n');
  const markdown = [
    '# Observability mechanism report',
    '',
    report.notice,
    '',
    `Observed at: ${report.observedAt}`,
    '',
    '## Latency fixtures',
    '',
    '| Surface | Temperature | Samples | Errors | p50 ms | p95 ms | p99 ms | Limiter |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...markdownRows(report),
    '',
    '## Trace status',
    '',
    `Ordinary: ${TRACE_STATUS_KEYS.map((key) => `${key}=${report.traceStatusCounts.ordinary[key]}`).join(', ')}`,
    '',
    `SOP: ${TRACE_STATUS_KEYS.map((key) => `${key}=${report.traceStatusCounts.sop[key]}`).join(', ')}`,
    '',
    '## Evaluations',
    '',
    `Ordinary: dataset=${report.evaluations.ordinary.datasetId}, version=${report.evaluations.ordinary.datasetVersion}, samples=${report.evaluations.ordinary.samples}, recall@${report.evaluations.ordinary.metrics.topK}=${report.evaluations.ordinary.metrics.recallAtK}`,
    '',
    `SOP: dataset=${report.evaluations.sop.datasetId}, version=${report.evaluations.sop.datasetVersion}, samples=${report.evaluations.sop.samples}, matched=${report.evaluations.sop.metrics.matchedCount}, valid-paths=${report.evaluations.sop.metrics.validPathCount}`,
    '',
    '## Alerts',
    '',
    alerts.length > 0 ? alerts : '- none',
    '',
  ].join('\n');
  return Object.freeze({ json, markdown });
}
