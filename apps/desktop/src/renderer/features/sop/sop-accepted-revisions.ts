import type { SopTaskSummary } from '@shared/sop-window';

/** A confirmed write must be followed by a newer task revision before that task is usable again. */
export class SopAcceptedRevisions {
  private readonly pending = new Map<string, number>();

  expect(source: Pick<SopTaskSummary, 'taskId' | 'revision'>) {
    this.pending.set(source.taskId, Math.max(this.pending.get(source.taskId) ?? 0, source.revision));
  }

  observe(tasks: readonly SopTaskSummary[], activeTaskIds: ReadonlySet<string>) {
    let current = true;
    for (const [taskId, revision] of this.pending) {
      if (!activeTaskIds.has(taskId)) { this.pending.delete(taskId); continue; }
      const task = tasks.find(item => item.taskId === taskId);
      if (!task) continue;
      if (task.revision > revision) this.pending.delete(taskId);
      else current = false;
    }
    return current;
  }
}
