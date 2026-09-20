/**
 * Local PREP for 「话术不准」: accept/dedupe/count, and whether an
 * iteration_task should open. Persistence later is POST /v1/inaccuracy-reports
 * via contracts:intake. This module has no HTTP, IPC, or rewrite.
 */

/** One report per query session + script. Neither part may contain NUL. */
export const INACCURACY_REPORT_KEY_SEPARATOR = '\0';

export const INACCURACY_TASK_THRESHOLD_24H = 3;
export const INACCURACY_TASK_THRESHOLD_7D = 10;

export type InaccuracyReportIdentity = Readonly<{
  sessionKey: string;
  scriptId: string;
}>;

export type InaccuracyReportAcceptInput = InaccuracyReportIdentity & Readonly<{
  seenKeys: ReadonlySet<string>;
}>;

export type InaccuracyCount = Readonly<{
  scriptId: string;
  count: number;
}>;

export type IterationTaskOpenInput = Readonly<{
  count24h: number;
  count7d: number;
}>;

export function inaccuracyReportKey(input: InaccuracyReportIdentity): string {
  return `${input.sessionKey}${INACCURACY_REPORT_KEY_SEPARATOR}${input.scriptId}`;
}

export function shouldAcceptInaccuracyReport(input: InaccuracyReportAcceptInput): boolean {
  if (!isInaccuracyReportIdentity(input)) {
    return false;
  }
  return !input.seenKeys.has(inaccuracyReportKey(input));
}

export function aggregateInaccuracyCounts(
  reports: readonly InaccuracyReportIdentity[],
): readonly InaccuracyCount[] {
  const seenKeys = new Set<string>();
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const report of reports) {
    if (!isInaccuracyReportIdentity(report)) {
      continue;
    }
    const key = inaccuracyReportKey(report);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    const current = counts.get(report.scriptId);
    if (current === undefined) {
      counts.set(report.scriptId, 1);
      order.push(report.scriptId);
    } else {
      counts.set(report.scriptId, current + 1);
    }
  }

  return order.map((scriptId) =>
    Object.freeze({ scriptId, count: counts.get(scriptId) ?? 0 }),
  );
}

export function shouldOpenIterationTask(input: IterationTaskOpenInput): boolean {
  const { count24h, count7d } = input;
  if (!isNonNegativeInt(count24h) || !isNonNegativeInt(count7d)) {
    return false;
  }
  return count24h >= INACCURACY_TASK_THRESHOLD_24H || count7d >= INACCURACY_TASK_THRESHOLD_7D;
}

function isInaccuracyReportIdentity(input: InaccuracyReportIdentity): boolean {
  return isIdentityPart(input.sessionKey) && isIdentityPart(input.scriptId);
}

function isIdentityPart(value: string): boolean {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes(INACCURACY_REPORT_KEY_SEPARATOR);
}

function isNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
