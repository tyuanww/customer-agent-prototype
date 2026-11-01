import { clipboard } from 'electron';
import { resolveClipboardWrite } from '../shared/clipboard-write';
import { advanceSopNext, chooseSopEdge, currentSopNode, projectSop, sopScriptCopyable, startSopProgress,
  type SopProgress, type SopPublishSet, type SopTree, type SopViewerRole } from '../shared/sop-model';
import { findSyntheticSopTree } from '../shared/synthetic-sops';
import { MAX_SOP_TASKS, SOP_COPY_FEEDBACK_MS, sopWindowFailure, type QuerySopCommand, type QuerySopCopyRequest,
  type SopRenameRequest, type SopTaskSummary, type SopCopyResult, type SopProjection, type SopWindowResult } from '../shared/sop-window';
import { GuardedScheduler } from './guarded-scheduler';

export type SopWindowControllerOptions = {
  enabled: () => boolean;
  presentation: {
    selectedTask: () => string | null;
    canExecuteTask?: (taskId: string) => boolean;
    showTask: (taskId: string) => Promise<boolean>;
    removeTask: (taskId: string) => void;
    changed: () => void;
  };
  sessionRole: () => SopViewerRole;
  publishedScriptIds?: () => SopPublishSet;
  writeClipboard?: (text: string) => void;
};
type Session = {
  taskId: string;
  ordinal: number;
  revision: number;
  displayName: string | null;
  tree: SopTree;
  history: SopProgress[];
  choices: Map<number, string>;
  confirmations: Map<number, readonly string[]>;
  checked: Set<string>;
  selectedScriptId: string | null;
  waiting: 'customer' | 'internal' | null;
  copied: boolean;
  copyTimer: ReturnType<typeof setTimeout> | null;
};

/** Owns the only task map and copy transaction. Presentation never owns business progress. */
export class SopWindowController {
  private readonly sessions = new Map<string, Session>();
  private ordinal = 0;
  private copySequence = 0;
  private disposed = false;
  private readonly scheduler = new GuardedScheduler();
  constructor(private readonly options: SopWindowControllerOptions) {}
  entryAvailable(): boolean { return !this.disposed && this.options.enabled(); }
  resumeAvailable(): boolean { return this.entryAvailable() && this.sessions.size > 0; }
  copyGeneration(): number { return this.copySequence; }
  private progress(session: Session): SopProgress { return session.history[session.history.length - 1]; }
  async open(sceneId: string): Promise<SopWindowResult> {
    if (!this.entryAvailable()) return sopWindowFailure('UNAVAILABLE', '当前环境没有可用流程');
    const tree = findSyntheticSopTree(sceneId);
    if (!tree) return sopWindowFailure('INVALID', '没有找到该流程');
    if (this.sessions.size >= MAX_SOP_TASKS) return sopWindowFailure('INVALID', `最多保留 ${MAX_SOP_TASKS} 条待办，请先结束一条`);
    const ordinal = ++this.ordinal;
    const session: Session = { taskId: `sop-${ordinal}`, ordinal, revision: 1, displayName: null, tree, history: [startSopProgress(tree)],
      choices: new Map(), confirmations: new Map(), checked: new Set(), selectedScriptId: null, waiting: null, copied: false, copyTimer: null };
    this.resetStep(session);
    this.sessions.set(session.taskId, session);
    this.publish();
    return await this.options.presentation.showTask(session.taskId) ? { ok: true } : sopWindowFailure('FAILED', '流程窗口未打开，请从待办重试');
  }
  async restore(taskId: string, revision: number): Promise<SopWindowResult> {
    const task = this.sessions.get(taskId);
    if (!this.entryAvailable() || !task || task.revision !== revision) return sopWindowFailure('INVALID', '待办已变化，请重新选择');
    return await this.options.presentation.showTask(taskId) ? { ok: true } : sopWindowFailure('FAILED', '流程窗口未打开，请从待办重试');
  }
  endFlow(): void {
    this.clearTasks();
    this.publish();
  }
  private clearTasks(): void {
    const tasks = [...this.sessions.values()];
    this.sessions.clear();
    for (const task of tasks) { this.clearCopy(task); this.options.presentation.removeTask(task.taskId); }
  }
  current(): SopProjection | null { return this.projection(this.options.presentation.selectedTask()); }
  projection(taskId: string | null): SopProjection | null {
    if (!taskId || !this.entryAvailable()) return null;
    const task = this.sessions.get(taskId);
    return task ? this.project(task) : null;
  }
  summaries(): readonly SopTaskSummary[] {
    if (!this.entryAvailable()) this.clearTasks();
    return [...this.sessions.values()].map(task => ({ taskId: task.taskId, ordinal: task.ordinal, displayName: task.displayName,
      revision: task.revision, sceneId: task.tree.sceneId, sceneTitle: task.tree.sceneTitle,
      taskTitle: currentSopNode(task.tree, this.progress(task))?.title ?? task.tree.sceneTitle,
      stepIndex: this.progress(task).stepIndex, waiting: task.waiting }));
  }
  rename(request: SopRenameRequest): SopWindowResult {
    const task = this.sessions.get(request.taskId);
    if (!this.entryAvailable() || !task || task.revision !== request.revision) return sopWindowFailure('INVALID', '待办已变化，请重新选择');
    if (task.displayName !== request.displayName) { task.displayName = request.displayName; task.revision += 1; this.publish(); }
    return { ok: true };
  }
  private project(task: Session): SopProjection {
    return projectSop({ tree: task.tree, progress: this.progress(task), role: this.options.sessionRole(),
      published: this.options.publishedScriptIds?.() ?? 'fixture', copied: task.copied, taskId: task.taskId, revision: task.revision,
      checked: task.checked, selectedScriptId: task.selectedScriptId, history: task.history,
      choices: task.choices, confirmations: task.confirmations, waiting: task.waiting });
  }

  command(request: QuerySopCommand): SopWindowResult {
    const session = this.sessions.get(request.taskId);
    if (!this.entryAvailable() || !session || request.revision !== session.revision || request.stepIndex !== this.progress(session).stepIndex) {
      return sopWindowFailure('INVALID', '步骤已变化，请按当前步骤操作');
    }
    // Ending a background task must not disturb the displayed task or search results.
    if (request.type === 'end') {
      this.clearCopy(session); this.sessions.delete(session.taskId); this.options.presentation.removeTask(session.taskId); this.publish(); return { ok: true };
    }
    const executable = this.options.presentation.canExecuteTask?.(request.taskId) ?? this.current()?.taskId === request.taskId;
    if (!executable) return sopWindowFailure('INVALID', '请先打开该待办');
    const progress = this.progress(session), node = currentSopNode(session.tree, progress);
    if (!node) return sopWindowFailure('INVALID', '当前步骤不可用');
    const failed = (message: string): SopWindowResult => sopWindowFailure('INVALID', message);
    switch (request.type) {
      case 'restart': session.history = [startSopProgress(session.tree)]; session.choices.clear(); session.confirmations.clear(); this.resetStep(session); break;
      case 'rewind': {
        if (request.targetStepIndex >= progress.stepIndex) return failed('请选择此前已执行的步骤');
        const index = session.history.findIndex(item => item.stepIndex === request.targetStepIndex);
        if (index < 0) return failed('历史步骤不存在');
        session.history = session.history.slice(0, index + 1);
        for (const step of session.choices.keys()) if (step >= request.targetStepIndex) session.choices.delete(step);
        for (const step of session.confirmations.keys()) if (step >= request.targetStepIndex) session.confirmations.delete(step);
        this.resetStep(session); break;
      }
      case 'wait': if (node.kind === 'terminal') return failed('当前流程已到终点'); session.waiting = request.reason; break;
      case 'resume': if (!session.waiting) return failed('当前流程没有等待事项'); session.waiting = null; break;
      case 'check':
        if (session.waiting) return failed('请先继续流程');
        if (!node.requirements.some(item => item.id === request.requirementId)) return failed('该核实项不属于当前步骤');
        if (request.checked) session.checked.add(request.requirementId); else session.checked.delete(request.requirementId);
        break;
      case 'select-script':
        if (session.waiting) return failed('请先继续流程');
        if (!node.scripts.some(item => item.id === request.scriptId)) return failed('该话术不属于当前步骤');
        session.selectedScriptId = request.scriptId; break;
      case 'choose': case 'next': {
        if (session.waiting) return failed('请先继续流程');
        if (!node.requirements.every(item => session.checked.has(item.id))) return failed('请先完成当前步骤的必要核实');
        const next = request.type === 'choose' ? chooseSopEdge(session.tree, progress, request.edgeId) : advanceSopNext(session.tree, progress);
        if (!next) return failed('请先选择当前步骤的实际情况');
        if (request.type === 'choose' && node.kind === 'decision') {
          const edge = node.edges.find(item => item.id === request.edgeId);
          if (edge) session.choices.set(progress.stepIndex, edge.label);
        }
        this.advance(session, next); break;
      }
      default: { const exhaustive: never = request; return exhaustive; }
    }
    session.revision += 1; this.clearCopy(session); this.publish(); return { ok: true };
  }
  copyCurrent(request: QuerySopCopyRequest): SopCopyResult {
    const session = this.sessions.get(request.taskId);
    const executable = this.options.presentation.canExecuteTask?.(request.taskId) ?? this.current()?.taskId === request.taskId;
    if (!this.entryAvailable() || !executable || !session || request.revision !== session.revision || request.stepIndex !== this.progress(session).stepIndex) {
      return { ok: false, message: '步骤已变化，请按当前步骤复制' };
    }
    if (session.waiting) return { ok: false, message: '请先继续流程' };
    const progress = this.progress(session), node = currentSopNode(session.tree, progress);
    const script = node?.scripts.find(item => item.id === request.scriptId);
    if (!node || !script) return { ok: false, message: '该话术当前不可复制' };
    if (!sopScriptCopyable(script, this.options.publishedScriptIds?.() ?? 'fixture')) {
      this.clearCopy(session); session.revision += 1; this.publish();
      return { ok: false, message: '该话术当前不可复制' };
    }
    const resolved = resolveClipboardWrite(script.answerText);
    if (!resolved.ok) return resolved;
    const next = node.kind === 'action' && node.requirements.every(item => session.checked.has(item.id))
      ? advanceSopNext(session.tree, progress) : null;
    try { (this.options.writeClipboard ?? clipboard.writeText)(resolved.payload); }
    catch { return { ok: false, message: '复制失败，请重试' }; }
    const copyGeneration = ++this.copySequence;
    for (const task of this.sessions.values()) this.clearCopy(task);
    if (next) this.advance(session, next);
    else { session.selectedScriptId = script.id; session.copied = true; }
    session.revision += 1;
    if (!next) session.copyTimer = this.scheduler.schedule(() => {
      session.copyTimer = null; session.copied = false; this.publish();
    }, SOP_COPY_FEEDBACK_MS);
    this.publish();
    const source = { taskId: session.taskId, revision: request.revision, stepIndex: progress.stepIndex };
    return next ? { ok: true, outcome: 'copied-advanced', source, sourceTitle: node.title, copyGeneration }
      : { ok: true, outcome: 'copied-stayed', source, sourceTitle: node.title, reason: node.kind === 'action' ? 'requirements' : node.kind, copyGeneration };
  }
  private advance(session: Session, next: SopProgress): void {
    const progress = this.progress(session), node = currentSopNode(session.tree, progress);
    session.confirmations.set(progress.stepIndex, node?.requirements.filter(item => session.checked.has(item.id)).map(item => item.label) ?? []);
    session.history.push(next); this.resetStep(session);
  }
  destroy(): void { this.disposed = true; this.sessions.clear(); this.scheduler.dispose(); }
  private resetStep(session: Session): void {
    const scripts = currentSopNode(session.tree, this.progress(session))?.scripts ?? [];
    session.checked.clear(); session.waiting = null;
    session.selectedScriptId = scripts.length === 1 ? scripts[0]?.id ?? null : null;
  }
  private clearCopy(session: Session): void { this.scheduler.clear(session.copyTimer); session.copyTimer = null; session.copied = false; }
  reportExternalCopy(): number {
    this.copySequence += 1;
    for (const task of this.sessions.values()) this.clearCopy(task);
    this.publish();
    return this.copySequence;
  }
  publish(): void { this.options.presentation.changed(); }
}
