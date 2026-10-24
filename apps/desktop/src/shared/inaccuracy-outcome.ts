export const INACCURACY_OUTCOME_COPY = Object.freeze({
  heading: '改过之后有没有变好',
  empty: '现在没有已处理的不准待办。',
  early: '处理后时间还短，先不比较。',
  failed: '没读到。',
  retry: '重试',
});

export type InaccuracyOutcome = Readonly<{
  scriptId: string;
  resolvedAt: string;
  ready: boolean;
  beforeCount: number | null;
  afterCount: number | null;
  windowDays: number;
}>;

export type InaccuracyOutcomeList = Readonly<{
  ok: true;
  items: readonly InaccuracyOutcome[];
}>;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function isOutcome(value: unknown): value is InaccuracyOutcome {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.scriptId !== 'string' || row.scriptId.length < 1 || row.scriptId.length > 128) return false;
  if (typeof row.resolvedAt !== 'string' || !Number.isFinite(Date.parse(row.resolvedAt))) return false;
  if (row.windowDays !== 7) return false;
  if (row.ready === false) return row.beforeCount === null && row.afterCount === null;
  return row.ready === true && isCount(row.beforeCount) && isCount(row.afterCount);
}

export function parseInaccuracyOutcomeList(value: unknown): InaccuracyOutcomeList | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.items) || body.items.length > 200) return null;
  if (!body.items.every(isOutcome)) return null;
  const seen = new Set<string>();
  for (const item of body.items) {
    if (seen.has(item.scriptId)) return null;
    seen.add(item.scriptId);
  }
  return Object.freeze({
    ok: true as const,
    items: Object.freeze(body.items.map((item) => Object.freeze({ ...item }))),
  });
}

export function outcomeSentence(row: InaccuracyOutcome): string {
  if (!row.ready || row.beforeCount === null || row.afterCount === null) return INACCURACY_OUTCOME_COPY.early;
  return `处理前 ${row.windowDays} 天 ${row.beforeCount} 次，处理后 ${row.windowDays} 天 ${row.afterCount} 次。`;
}
