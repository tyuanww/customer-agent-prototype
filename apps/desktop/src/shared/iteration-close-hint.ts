import { inaccuracyScriptIdFromTask, type InaccuracyTodoTask } from './inaccuracy-todo';

export const ITERATION_CLOSE_HINT_COPY = Object.freeze({
  badge: '已有新发布',
  action: '可关单',
  footnote: '新发布后可关单。关闭不等于已发布。不自动关单。',
});

const SCRIPT_PREFIXES = ['stale:', 'top1_skipped:', 'ranking:', 'inaccuracy:'] as const;

export type CloseHintTask = InaccuracyTodoTask & Readonly<{
  createdAt: string;
  suspectedCause: 'content_gap' | 'ranking' | 'stale' | 'mixed';
}>;

export type CloseHintCatalog = Readonly<{
  catalogRefreshedAt: string | null;
  entries: readonly Readonly<{ scriptId: string }>[];
}>;

export function relatedScriptIdsForTask(task: InaccuracyTodoTask): readonly string[] {
  const ids = new Set<string>();
  for (const scriptId of task.suggestedScriptIds) {
    const trimmed = scriptId.trim();
    if (trimmed.length > 0) ids.add(trimmed);
  }
  const inaccuracy = inaccuracyScriptIdFromTask(task);
  if (inaccuracy) ids.add(inaccuracy);
  for (const prefix of SCRIPT_PREFIXES) {
    for (const token of [task.clusterKey, task.signalId]) {
      if (!token.startsWith(prefix)) continue;
      const rest = token.slice(prefix.length).trim();
      if (rest.length > 0) ids.add(rest);
    }
  }
  return Object.freeze([...ids]);
}

export function hasPublishCloseHint(task: CloseHintTask, catalog: CloseHintCatalog | null): boolean {
  if (catalog === null) return false;
  if (task.status !== 'open' && task.status !== 'in_progress') return false;
  const created = Date.parse(task.createdAt);
  const refreshed = catalog.catalogRefreshedAt === null ? Number.NaN : Date.parse(catalog.catalogRefreshedAt);
  if (!Number.isFinite(created) || !Number.isFinite(refreshed) || refreshed <= created) return false;
  const related = relatedScriptIdsForTask(task);
  if (related.length === 0) return task.suspectedCause === 'content_gap';
  const published = new Set(catalog.entries.map((entry) => entry.scriptId));
  return related.some((scriptId) => published.has(scriptId));
}

export type IterationCloseDecision =
  | { ok: true; status: 'resolved' | 'wont_fix'; resolutionNote: string }
  | { ok: false; reason: 'needs_newer_release' | 'needs_reason' };

/** 排序问题 and 过期仍召回 do not rewrite published script text. No cause auto-rewrites. */
export function scriptTextAfterCause(
  scriptText: string,
  cause: CloseHintTask['suspectedCause'],
): string {
  if (cause === 'ranking' || cause === 'stale') return scriptText;
  return scriptText;
}

export function decideIterationClose(input: {
  task: CloseHintTask;
  catalog: CloseHintCatalog | null;
  status: 'resolved' | 'wont_fix';
  resolutionNote: string;
}): IterationCloseDecision {
  const note = input.resolutionNote.trim();
  if (input.status === 'wont_fix') {
    if (note.length === 0) return Object.freeze({ ok: false, reason: 'needs_reason' });
    return Object.freeze({ ok: true, status: 'wont_fix', resolutionNote: note });
  }
  if (input.task.suspectedCause === 'content_gap' && !hasPublishCloseHint(input.task, input.catalog)) {
    return Object.freeze({ ok: false, reason: 'needs_newer_release' });
  }
  return Object.freeze({ ok: true, status: 'resolved', resolutionNote: note });
}
