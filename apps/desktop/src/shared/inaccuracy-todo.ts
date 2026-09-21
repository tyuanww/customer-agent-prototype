import {
  INACCURACY_TASK_THRESHOLD_24H,
  INACCURACY_TASK_THRESHOLD_7D,
} from './inaccuracy-report';

export const INACCURACY_SIGNAL_PREFIX = 'inaccuracy:';

export const INACCURACY_TODO_COPY = Object.freeze({
  heading: '按稿不准次数',
  empty: '当前没有达到开单阈值的不准稿。',
  footnoteLive:
    `「话术不准」按稿列出本页待办的样本查询数。达到 24 小时 ≥ ${INACCURACY_TASK_THRESHOLD_24H} 或 7 天 ≥ ${INACCURACY_TASK_THRESHOLD_7D} 才会打开待办；未达阈值的稿不会出现。不自动改写或关单。`,
  footnoteMock:
    `「话术不准」计数尚未接入。达到 24 小时 ≥ ${INACCURACY_TASK_THRESHOLD_24H} 或 7 天 ≥ ${INACCURACY_TASK_THRESHOLD_7D} 才会打开 iteration_task；本页不展示实时数字，也不自动改写或关单。`,
});

export type InaccuracyTodoTask = Readonly<{
  signalId: string;
  clusterKey: string;
  suggestedScriptIds: readonly string[];
  sampleQueryIds: readonly string[];
  status: 'open' | 'in_progress' | 'resolved' | 'wont_fix';
  suspectedCause?: 'content_gap' | 'ranking' | 'stale' | 'mixed';
}>;

export type InaccuracyTodoCount = Readonly<{
  scriptId: string;
  sampleCount: number;
  openTaskCount: number;
}>;

export function inaccuracyScriptIdFromTask(task: InaccuracyTodoTask): string | null {
  if (!task.signalId.startsWith(INACCURACY_SIGNAL_PREFIX)) return null;
  const fromSignal = task.signalId.slice(INACCURACY_SIGNAL_PREFIX.length).trim();
  if (fromSignal.length > 0) return fromSignal;
  const suggested = task.suggestedScriptIds[0]?.trim() ?? '';
  if (suggested.length > 0) return suggested;
  const cluster = task.clusterKey.trim();
  return cluster.length > 0 ? cluster : null;
}

export function aggregateInaccuracyTodoCounts(
  tasks: readonly InaccuracyTodoTask[],
): readonly InaccuracyTodoCount[] {
  const order: string[] = [];
  const samples = new Map<string, Set<string>>();
  const openTasks = new Map<string, number>();

  for (const task of tasks) {
    const scriptId = inaccuracyScriptIdFromTask(task);
    if (scriptId === null) continue;
    if (!samples.has(scriptId)) {
      samples.set(scriptId, new Set());
      openTasks.set(scriptId, 0);
      order.push(scriptId);
    }
    const bucket = samples.get(scriptId);
    if (bucket) {
      for (const queryId of task.sampleQueryIds) {
        if (typeof queryId === 'string' && queryId.length > 0) bucket.add(queryId);
      }
    }
    if (task.status === 'open' || task.status === 'in_progress') {
      openTasks.set(scriptId, (openTasks.get(scriptId) ?? 0) + 1);
    }
  }

  return Object.freeze(order.map((scriptId) => Object.freeze({
    scriptId,
    sampleCount: samples.get(scriptId)?.size ?? 0,
    openTaskCount: openTasks.get(scriptId) ?? 0,
  })));
}
