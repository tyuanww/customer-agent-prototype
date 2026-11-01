import { Alert, Button, Card, Checkbox, Collapse, Dropdown, Flex, Input, Modal, Radio, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled, CheckOutlined, CloseOutlined, EditOutlined, MoreOutlined, MinusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_SOP_DISPLAY_NAME_LENGTH, SOP_COPY_FEEDBACK_MS, matchSopChoices, type QuerySopCommand, type QuerySopWindowApi, type SopProjection, type SopCopyResult, type SopTaskSummary, type SopWindowResult } from '@shared/sop-window';
import { isImeComposing } from '../../lib/ime';
import { SopImages } from './SopImages';
import { SopRenameDrafts, useSopRenameDrafts } from './sop-rename-drafts';
import { SopStepDraft } from './sop-step-draft';
import '../../styles/query-sop.css';

type Intent = QuerySopCommand extends infer Command ? Command extends QuerySopCommand ? Omit<Command, 'taskId' | 'revision' | 'stepIndex'> : never : never;
type Confirmation = { kind: 'restart' | 'end' } | { kind: 'rewind'; stepIndex: number; title: string };
type PendingAction = 'copy' | 'command' | null;
type PendingRequest = {
  action: () => Promise<SopCopyResult | SopWindowResult>;
  kind: Exclude<PendingAction, null>;
  scriptId?: string;
  choiceId?: string;
};
export type SopTransferGuard = { prepareTransfer: () => Promise<boolean>; finishTransfer: () => void };
export type SopTransferRegistration = SopTransferGuard & { taskId: string; hostEpoch: number };
type DraftLoad = { taskId: string; hostEpoch: number; phase: 'loading' | 'ready' | 'error' };

/** Main owns progress and copy targets. Expanding reference text never advances a task. */
export function QuerySopPanel({ projection, api, onSearch, searchLabel = '返回搜索', mode = 'query', onCollapse, windowControls, hostEpoch, task, drafts, onOperationSuccess, copyGeneration = 0, readCopyGeneration, onTransferGuard }: {
  projection: SopProjection;
  api: Pick<QuerySopWindowApi, 'command' | 'copyCurrent' | 'renameCurrent' | 'draftCurrent' | 'draftStart' | 'draftUpdate' | 'draftDiscard'>;
  hostEpoch: number | null;
  task?: SopTaskSummary;
  onSearch?: () => void | Promise<void>;
  searchLabel?: '返回搜索' | '显示查询';
  mode?: 'query' | 'floating';
  onCollapse: () => void | Promise<void>;
  windowControls?: (disabled: boolean, guard: SopTransferGuard) => ReactNode;
  drafts?: SopRenameDrafts;
  onOperationSuccess?: (source: Pick<SopProjection, 'taskId' | 'revision'>) => Promise<void>;
  copyGeneration?: number;
  readCopyGeneration?: () => number;
  onTransferGuard?: (registration: SopTransferRegistration | null) => void;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [localDrafts] = useState(() => new SopRenameDrafts());
  const renameDrafts = useSopRenameDrafts(drafts ?? localDrafts);
  const [draftLoad, setDraftLoad] = useState<DraftLoad | null>(null);
  const [draftLoadAttempt, setDraftLoadAttempt] = useState(0);
  const [transferPending, setTransferPending] = useState(false);
  const transferLocked = useRef(false);
  const transferAttempt = useRef(0);
  useEffect(() => () => { transferAttempt.current += 1; }, [projection.taskId]);
  const draftBridge = useRef<SopStepDraft | null>(null);
  const draftGeneration = useRef(0);
  const hasDraftCapability = !!task && !!api.renameCurrent;
  const draftReady = !hasDraftCapability || (hostEpoch !== null && draftLoad?.taskId === projection.taskId
    && draftLoad.hostEpoch === hostEpoch && draftLoad.phase === 'ready');
  const rename = draftReady ? renameDrafts.get(projection.taskId) ?? null : null;
  const [renameNotice, setRenameNotice] = useState<'label' | 'check' | null>(null);
  const renamePending = useRef(false);
  const renameComposing = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const titleLine = useRef<HTMLDivElement>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const pendingActionRef = useRef<PendingAction>(null);
  const [pendingCopyScriptId, setPendingCopyScriptId] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{ taskId: string; nodeId: string; stepIndex: number; edgeId: string } | null>(null);
  const seenCopyGeneration = useRef(copyGeneration);
  seenCopyGeneration.current = Math.max(seenCopyGeneration.current, copyGeneration, readCopyGeneration?.() ?? 0);
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const [expandedScripts, setExpandedScripts] = useState<string[]>([]);
  const [situation, setSituation] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<{ taskId: string; stepIndex: number; advanced: boolean; message: string; generation: number; scriptId: string | null } | null>(null);
  const current = useRef({ projection, hostEpoch });
  current.current = { projection, hostEpoch };
  const requestGeneration = useRef(0);
  useEffect(() => {
    requestGeneration.current += 1;
    setCopyFeedback(null);
    setConfirmation(null);
    setRenameNotice(null);
    renamePending.current = false;
    renameComposing.current = false;
    pendingActionRef.current = null;
    setPendingAction(null);
    setPendingCopyScriptId(null);
    setPendingChoice(null);
    return () => { requestGeneration.current += 1; };
  }, [projection.taskId, hostEpoch]);
  const [error, setError] = useState('');
  useEffect(() => {
    const generation = ++draftGeneration.current;
    transferLocked.current = false;
    setTransferPending(false);
    if (!hasDraftCapability || hostEpoch === null) { draftBridge.current = null; setDraftLoad(null); return; }
    const taskId = projection.taskId;
    const bridge = new SopStepDraft({ draftCurrent: api.draftCurrent, draftStart: api.draftStart,
      draftUpdate: api.draftUpdate, draftDiscard: api.draftDiscard }, { taskId, hostEpoch });
    draftBridge.current = bridge;
    setDraftLoad({ taskId, hostEpoch, phase: 'loading' });
    if (!bridge.available()) { setDraftLoad({ taskId, hostEpoch, phase: 'error' }); return; }
    void bridge.current().then(result => {
      if (generation !== draftGeneration.current) return;
      if (!result.ok) { setDraftLoad({ taskId, hostEpoch, phase: 'error' }); return; }
      renameDrafts.delete(taskId);
      if (result.draft) renameDrafts.start(taskId, { revision: result.draft.revision, initialName: result.draft.initialName, value: result.draft.value, stage: 'editing', error: '' });
      setDraftLoad({ taskId, hostEpoch, phase: 'ready' });
    });
    return () => { draftGeneration.current += 1; };
  }, [api.draftCurrent, api.draftStart, api.draftUpdate, api.draftDiscard, draftLoadAttempt, hasDraftCapability, hostEpoch, projection.taskId, renameDrafts]);
  useEffect(() => {
    setCopyFeedback(value => value && value.generation < copyGeneration ? null : value);
  }, [copyGeneration]);
  useEffect(() => {
    if (!copyFeedback) return undefined;
    const timer = window.setTimeout(() => setCopyFeedback(null), SOP_COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);
  useEffect(() => {
    if (!renameNotice) return undefined;
    const timer = window.setTimeout(() => setRenameNotice(renameNotice === 'label' ? 'check' : null), renameNotice === 'label' ? 1200 : 900);
    return () => window.clearTimeout(timer);
  }, [renameNotice]);
  useEffect(() => {
    if (!renameDrafts.get(projection.taskId)) panel.current?.focus({ preventScroll: true });
  }, [projection.taskId, renameDrafts]);
  const resetTaskView = useCallback(() => {
    setExpandedScripts([]);
    setSituation('');
    if (body.current) body.current.scrollTop = 0;
    stepTitle.current?.focus({ preventScroll: true });
  }, []);
  useEffect(resetTaskView, [projection.taskId, projection.nodeId, projection.stepIndex, resetTaskView]);
  const run = useCallback(async ({ action, kind, scriptId, choiceId }: PendingRequest) => {
    if (pendingActionRef.current || transferLocked.current || current.current.hostEpoch === null) return;
    const generation = requestGeneration.current;
    const requestHostEpoch = current.current.hostEpoch;
    const source = { taskId: current.current.projection.taskId, revision: current.current.projection.revision };
    const sourceNode = current.current.projection.nodeId;
    pendingActionRef.current = kind;
    setPendingAction(kind);
    setPendingCopyScriptId(kind === 'copy' ? scriptId ?? null : null);
    setPendingChoice(choiceId ? { taskId: source.taskId, nodeId: sourceNode, stepIndex: current.current.projection.stepIndex, edgeId: choiceId } : null);
    setError('');
    try {
      const result = await action();
      if (result.ok) await onOperationSuccess?.(source);
      if (generation !== requestGeneration.current || requestHostEpoch !== current.current.hostEpoch) return;
      if (result.ok) setError(currentError => currentError === '当前操作处理中，请稍后重试' ? '' : currentError);
      if (!result.ok) {
        setError(result.message ?? '操作失败，请重试');
      } else if (kind === 'copy' && 'outcome' in result && result.source.taskId === current.current.projection.taskId
        && (result.outcome === 'copied-advanced'
          ? current.current.projection.stepIndex === result.source.stepIndex || current.current.projection.stepIndex === result.source.stepIndex + 1
          : current.current.projection.stepIndex === result.source.stepIndex && current.current.projection.nodeId === sourceNode)) {
        seenCopyGeneration.current = Math.max(seenCopyGeneration.current, readCopyGeneration?.() ?? 0);
        if (result.copyGeneration < seenCopyGeneration.current) return;
        seenCopyGeneration.current = result.copyGeneration;
        const advanced = result.outcome === 'copied-advanced';
        const message = result.outcome === 'copied-advanced' ? `已复制步骤 ${result.source.stepIndex}，已进入下一步`
          : result.reason === 'requirements' ? '已复制，完成必要核实后再继续'
            : result.reason === 'decision' ? '已复制，请选择实际情况' : '已复制，确认后可结束流程';
        setCopyFeedback({ taskId: result.source.taskId, stepIndex: result.source.stepIndex, advanced, message, generation: result.copyGeneration, scriptId: scriptId ?? null });
      }
    } catch {
      if (generation === requestGeneration.current && requestHostEpoch === current.current.hostEpoch) setError('操作失败，请重试');
    } finally {
      if (generation === requestGeneration.current) {
        pendingActionRef.current = null;
        setPendingAction(null);
        setPendingCopyScriptId(null);
        setPendingChoice(null);
      }
    }
  }, [onOperationSuccess, readCopyGeneration]);
  const command = useCallback((intent: Intent) => {
    if (hostEpoch === null) return;
    const request = { ...intent, hostEpoch, taskId: projection.taskId, revision: projection.revision, stepIndex: projection.stepIndex };
    void run({ action: async () => {
      const result = await (api.command?.(request) ?? Promise.resolve({ ok: false as const, code: 'UNAVAILABLE' as const, message: '流程暂不可用' }));
      if (result.ok && hostEpoch === current.current.hostEpoch && projection.taskId === current.current.projection.taskId && (intent.type === 'restart' || intent.type === 'rewind')) { resetTaskView(); setCopyFeedback(null); }
      return result;
    }, kind: 'command', choiceId: intent.type === 'choose' ? intent.edgeId : undefined });
  }, [api, hostEpoch, projection.taskId, projection.revision, projection.stepIndex, resetTaskView, run]);
  const selectedScript = projection.scripts.find(script => script.scriptId === projection.selectedScriptId);
  const copy = useCallback((scriptId: string) => {
    const script = projection.scripts.find(item => item.scriptId === scriptId);
    if (!script || script.unpublished || projection.waiting || hostEpoch === null) return;
    void run({ action: () => api.copyCurrent?.({ hostEpoch, taskId: projection.taskId, revision: projection.revision, stepIndex: projection.stepIndex, scriptId }) ?? Promise.resolve({ ok: false, message: '复制暂不可用' }), kind: 'copy', scriptId });
  }, [api, hostEpoch, projection.scripts, projection.waiting, projection.taskId, projection.revision, projection.stepIndex, run]);
  useEffect(() => { setError(''); }, [projection.revision, projection.stepIndex]);
  useEffect(() => { setCopyFeedback(null); }, [projection.taskId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (hostEpoch === null || !draftReady || transferPending || transferLocked.current || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || pendingAction !== null || projection.waiting
        || isImeComposing(event) || confirmation || rename || document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)')
        || (event.target instanceof HTMLElement && event.target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'))) return;
      if (event.key === 'F6' && selectedScript && !selectedScript.unpublished) { event.preventDefault(); copy(selectedScript.scriptId); }
      if (event.key === 'F8' && projection.nodeKind === 'action' && projection.canNext && !projection.terminal) { event.preventDefault(); command({ type: 'next' }); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [command, confirmation, copy, draftReady, hostEpoch, projection.canNext, projection.nodeKind, projection.terminal, projection.waiting, selectedScript, pendingAction, rename, transferPending]);
  const copyFeedbackValid = copyFeedback?.taskId === projection.taskId
    && copyFeedback.generation === seenCopyGeneration.current
    && (copyFeedback.advanced || copyGeneration !== copyFeedback.generation || projection.copied)
    && (copyFeedback.stepIndex === projection.stepIndex || (copyFeedback.advanced && copyFeedback.stepIndex + 1 === projection.stepIndex));
  const feedback = copyFeedbackValid ? copyFeedback.message : '';
  const copiedScriptId = copyFeedbackValid && !copyFeedback.advanced && copyFeedback.stepIndex === projection.stepIndex ? copyFeedback.scriptId : null;
  const operationBlocked = hostEpoch === null || pendingAction !== null || rename !== null || !draftReady || transferPending;
  const unavailable = operationBlocked || projection.waiting !== null;
  const previous = projection.history.filter(item => item.stepIndex < projection.stepIndex).at(-1);
  const canNext = projection.nodeKind === 'action' && !projection.terminal && projection.canNext;
  const recommended = matchSopChoices(situation, projection.edges);
  const canRecommend = projection.edges.some(edge => edge.matchTerms.length > 0);
  const confirm = () => {
    if (!confirmation) return;
    command(confirmation.kind === 'rewind' ? { type: 'rewind', targetStepIndex: confirmation.stepIndex } : { type: confirmation.kind });
    setConfirmation(null);
  };
  const label = task ? task.displayName ?? `${task.sceneTitle} #${task.ordinal}` : projection.sceneTitle;
  const startRename = () => {
    const bridge = draftBridge.current;
    if (!task || task.taskId !== projection.taskId || hostEpoch === null || !api.renameCurrent || pendingAction !== null || !draftReady || transferLocked.current || !bridge) return;
    renameComposing.current = false;
    setRenameNotice(null);
    const draft = renameDrafts.start(task.taskId, { revision: projection.revision, initialName: task.displayName, value: label, stage: 'editing', error: '' });
    void bridge.start(projection.revision).then(remote => {
      if (!remote && draftBridge.current === bridge) renameDrafts.update(task.taskId, draft.editId, currentDraft => ({ ...currentDraft, error: '未能保留名称草稿，请重试' }));
    });
  };
  const cancelRename = async () => {
    const bridge = draftBridge.current;
    if (!rename || rename.stage === 'saving' || renamePending.current || transferLocked.current || !bridge) return;
    const taskId = projection.taskId, editId = rename.editId, generation = requestGeneration.current;
    renameComposing.current = false;
    renamePending.current = true;
    renameDrafts.update(taskId, editId, currentDraft => ({ ...currentDraft, stage: 'saving', error: '' }));
    try {
      if (await bridge.discard(rename.revision)) {
        renameDrafts.update(taskId, editId, () => null);
        if (generation === requestGeneration.current) window.requestAnimationFrame(() => editButton.current?.focus());
      } else renameDrafts.update(taskId, editId, currentDraft => ({ ...currentDraft, stage: 'editing', error: '未能取消名称草稿，请重试' }));
    } finally { if (generation === requestGeneration.current) renamePending.current = false; }
  };
  const updateRename = (value: string, errorMessage: string) => {
    if (!rename || transferLocked.current) return;
    const bridge = draftBridge.current, taskId = projection.taskId, editId = rename.editId;
    renameDrafts.update(taskId, editId, currentDraft => ({ ...currentDraft, value, error: errorMessage }));
    if (!bridge) return;
    void bridge.write(rename.revision, value).then(result => {
      if (draftBridge.current !== bridge || !bridge.latest(result.sequence)) return;
      renameDrafts.update(taskId, editId, currentDraft => {
        if (currentDraft.stage !== 'editing') return currentDraft;
        if (!result.ok) return { ...currentDraft, error: '未能保留名称草稿，请重试' };
        return currentDraft.error === '未能保留名称草稿，请重试' ? { ...currentDraft, error: '' } : currentDraft;
      });
    });
  };
  const finishTransfer = () => {
    if (current.current.projection.taskId !== projection.taskId || current.current.hostEpoch !== hostEpoch) return;
    transferLocked.current = false;
    setTransferPending(false);
  };
  const prepareTransfer = async (): Promise<boolean> => {
    if (transferLocked.current || !draftReady || renamePending.current) return false;
    if (pendingActionRef.current) { setError('当前操作处理中，请稍后重试'); return false; }
    if (renameComposing.current) {
      if (rename) renameDrafts.update(projection.taskId, rename.editId, currentDraft => ({ ...currentDraft, error: '请先完成输入' }));
      return false;
    }
    transferLocked.current = true;
    setTransferPending(true);
    const active = renameDrafts.get(projection.taskId), bridge = draftBridge.current;
    if (!active) return true;
    const result = bridge ? await bridge.write(active.revision, active.value) : { ok: false };
    if (current.current.projection.taskId !== projection.taskId || current.current.hostEpoch !== hostEpoch) return false;
    if (result.ok) return true;
    renameDrafts.update(projection.taskId, active.editId, currentDraft => ({ ...currentDraft, error: '未能保留名称草稿，请重试' }));
    finishTransfer();
    return false;
  };
  const runWithDraft = async (action: () => void | Promise<void>) => {
    if (!await prepareTransfer()) return;
    if (current.current.projection.taskId !== projection.taskId || current.current.hostEpoch !== hostEpoch) return;
    const attempt = ++transferAttempt.current;
    try { await action(); }
    catch {
      // A failed native transfer can restore the same task under a fresh host epoch.
      if (attempt === transferAttempt.current && current.current.projection.taskId === projection.taskId
        && current.current.projection.revision === projection.revision) setError('操作失败，请重试');
    }
    finally { finishTransfer(); }
  };
  const transferHandlers = useRef<SopTransferGuard>({ prepareTransfer, finishTransfer });
  transferHandlers.current = { prepareTransfer, finishTransfer };
  useEffect(() => {
    if (!onTransferGuard || hostEpoch === null) return undefined;
    const taskId = projection.taskId;
    let active = true;
    const ownsRegistration = () => active && current.current.projection.taskId === taskId && current.current.hostEpoch === hostEpoch;
    onTransferGuard({ taskId, hostEpoch, prepareTransfer: async () => {
      if (!ownsRegistration()) return false;
      const prepared = await transferHandlers.current.prepareTransfer();
      return ownsRegistration() && prepared;
    }, finishTransfer: () => { if (ownsRegistration()) transferHandlers.current.finishTransfer(); } });
    return () => { active = false; onTransferGuard(null); };
  }, [onTransferGuard, projection.taskId, hostEpoch]);
  const saveRename = async () => {
    const bridge = draftBridge.current;
    if (!rename || rename.stage !== 'editing' || renamePending.current || renameComposing.current || transferLocked.current || !api.renameCurrent || !task || hostEpoch === null || !bridge) return;
    if (task.taskId !== projection.taskId) return;
    const taskId = task.taskId;
    const editId = rename.editId;
    const value = rename.value.trim();
    const defaultName = `${task.sceneTitle} #${task.ordinal}`;
    const displayName = !value || (rename.initialName === null && value === defaultName) ? null : value;
    if (displayName !== null && Array.from(displayName).length > MAX_SOP_DISPLAY_NAME_LENGTH) {
      renameDrafts.update(taskId, editId, draft => ({ ...draft, error: '最多 20 字' }));
      return;
    }
    if (displayName === task.displayName) { await cancelRename(); return; }
    if (projection.revision !== rename.revision) {
      renameDrafts.update(taskId, editId, draft => ({ ...draft, revision: projection.revision, error: '待办已变化，请核对后再次保存' }));
      return;
    }
    const generation = requestGeneration.current;
    const revision = rename.revision;
    renamePending.current = true;
    renameDrafts.update(taskId, editId, draft => ({ ...draft, stage: 'saving', error: '' }));
    try {
      const flushed = await bridge.write(revision, rename.value);
      if (generation !== requestGeneration.current || current.current.projection.taskId !== taskId || current.current.hostEpoch !== hostEpoch) return;
      if (!flushed.ok) {
        renameDrafts.update(taskId, editId, draft => ({ ...draft, stage: 'editing', error: '未能保留名称草稿，请重试' }));
        return;
      }
      const result = await api.renameCurrent({ taskId, revision, hostEpoch, displayName });
      if (result.ok) {
        bridge.forget();
        renameDrafts.update(taskId, editId, () => null);
        try { await onOperationSuccess?.({ taskId, revision }); }
        catch { if (generation === requestGeneration.current) setError('名称已保存，但刷新失败，请重新进入流程'); }
        if (generation === requestGeneration.current && current.current.projection.taskId === taskId && current.current.hostEpoch === hostEpoch) {
          if (document.hasFocus() && (document.activeElement === document.body || titleLine.current?.contains(document.activeElement))) {
            stepTitle.current?.focus({ preventScroll: true });
          }
          setRenameNotice('label');
        }
      } else renameDrafts.update(taskId, editId, draft => ({ ...draft, stage: 'editing', error: result.message }));
    } catch {
      renameDrafts.update(taskId, editId, draft => ({ ...draft, stage: 'editing', error: '名称修改失败，请重试' }));
    } finally { if (generation === requestGeneration.current) renamePending.current = false; }
  };
  return <section ref={panel} className="query-sop-panel" aria-label="SOP 流程" tabIndex={-1} onKeyDown={event => {
    if (rename && event.key === 'Escape') {
      event.stopPropagation();
      if (!renameComposing.current && !isImeComposing(event.nativeEvent)) { event.preventDefault(); void cancelRename(); }
    }
  }}>
    <header className="query-sop-header">
      {mode === 'floating' ? <Tooltip title="结束流程"><Button type="text" icon={<CloseOutlined />} aria-label="结束流程" disabled={operationBlocked}
        onClick={() => setConfirmation({ kind: 'end' })} /></Tooltip> : onSearch ? <Tooltip title={searchLabel}><Button type="text" icon={<ArrowLeftOutlined />} aria-label={searchLabel} disabled={hostEpoch === null || transferPending || (rename?.stage === 'saving' && searchLabel === '返回搜索')}
        onClick={() => { if (searchLabel === '显示查询') void onSearch(); else void runWithDraft(onSearch); }} /></Tooltip> : null}
      <div className="query-sop-title"><div ref={titleLine} className="query-sop-title-line">
        {rename ? <Input autoFocus aria-label="流程名称" value={rename.value} disabled={hostEpoch === null || rename.stage === 'saving' || transferPending}
          onFocus={event => event.currentTarget.select()}
          onCompositionStart={() => { renameComposing.current = true; }}
          onCompositionEnd={event => {
            if (!renameComposing.current) return;
            renameComposing.current = false;
            const value = event.currentTarget.value;
            updateRename(value, Array.from(value).length > MAX_SOP_DISPLAY_NAME_LENGTH ? '最多 20 字' : '');
          }}
          onChange={event => {
            const value = event.target.value;
            const length = Array.from(value).length;
            if (!renameComposing.current && length > MAX_SOP_DISPLAY_NAME_LENGTH && length > Array.from(rename.value).length) {
              renameDrafts.update(projection.taskId, rename.editId, draft => ({ ...draft, error: '最多 20 字' }));
            } else updateRename(value, !renameComposing.current && length > MAX_SOP_DISPLAY_NAME_LENGTH ? '最多 20 字' : '');
          }}
          onKeyDown={event => { if (event.key === 'Enter' && !renameComposing.current && !isImeComposing(event.nativeEvent)) { event.preventDefault(); void saveRename(); } }} />
          : <Tooltip title={label} trigger={['hover', 'focus']}><Typography.Text strong tabIndex={0} aria-label={label}>{label}</Typography.Text></Tooltip>}
        {task && api.renameCurrent ? rename
          ? <Tooltip title="保存名称，Esc 取消"><Button type="text" icon={<CheckOutlined />} aria-label="保存流程名称" disabled={hostEpoch === null} loading={rename.stage === 'saving'} onClick={() => { void saveRename(); }} /></Tooltip>
          : renameNotice === 'label' ? <Button type="text" icon={<CheckOutlined />} aria-label="名称已保存" disabled />
          : <Tooltip title="编辑名称"><Button ref={editButton} type="text" icon={<EditOutlined />} aria-label="编辑流程名称" disabled={hostEpoch === null || pendingAction !== null || !draftReady || transferPending} onClick={startRename} /></Tooltip>
          : null}
      </div>
        {label !== projection.sceneTitle ? <Tooltip title={projection.sceneTitle} trigger={['hover', 'focus']}><Typography.Text type="secondary" tabIndex={0}
          className="query-sop-process-title" aria-label={projection.sceneTitle}>{projection.sceneTitle}</Typography.Text></Tooltip> : null}
        {rename?.error ? <Typography.Text type="danger" role="alert" className="query-sop-rename-error">{rename.error}</Typography.Text> : null}
      </div>
      <Flex gap={4} align="center">
        {windowControls?.(!draftReady || rename?.stage === 'saving' || transferPending, { prepareTransfer, finishTransfer })}
        <Tooltip title="收起"><Button type="text" icon={<MinusOutlined />} aria-label="收起" disabled={hostEpoch === null || rename?.stage === 'saving' || transferPending} onClick={() => { void runWithDraft(onCollapse); }} /></Tooltip>
        <Dropdown trigger={['click']} menu={{ items: [
          ...(mode === 'floating' && onSearch ? [{ key: 'show-query', label: '显示查询' }] : []),
          { key: 'wait-customer', label: '等待客户', disabled: unavailable || projection.terminal },
          { key: 'wait-internal', label: '等待内部协助', disabled: unavailable || projection.terminal },
          { type: 'divider' },
          { key: 'restart', label: '重新开始', disabled: operationBlocked },
          { key: 'end', label: '结束流程', danger: true, disabled: operationBlocked },
        ], onClick: ({ key }) => {
          if (key === 'show-query') void onSearch?.();
          if (key === 'restart' || key === 'end') setConfirmation({ kind: key });
          if (key === 'wait-customer') command({ type: 'wait', reason: 'customer' });
          if (key === 'wait-internal') command({ type: 'wait', reason: 'internal' });
        } }}>
          <Button type="text" icon={<MoreOutlined />} aria-label="更多操作" disabled={hostEpoch === null || (mode !== 'floating' && rename !== null)} />
        </Dropdown>
      </Flex>
      <div className="query-sop-rename-notice" data-visible={renameNotice !== null} data-phase={renameNotice === 'label' ? 'label' : 'check'} aria-hidden={renameNotice === null}
        role="status" aria-label="名称已调整">{renameNotice === 'label' ? <span>已调整</span> : <CheckCircleFilled aria-hidden="true" />}</div>
    </header>
    <div className="query-sop-step">
      <Typography.Text type="secondary">步骤 {projection.stepIndex}</Typography.Text>
      <Typography.Title level={5} ref={stepTitle} tabIndex={-1} aria-live="polite">{projection.taskTitle}</Typography.Title>
    </div>
    <div ref={body} className="query-sop-body" data-testid="sop-scroll-content">
      {projection.waiting ? <Alert type="info" title={projection.waiting === 'customer' ? '等待客户' : '等待内部协助'}
        action={<Button size="small" disabled={operationBlocked} onClick={() => command({ type: 'resume' })}>继续处理</Button>} /> : null}
      {projection.prompt ? <Alert className="query-sop-instruction" role="note" type="info" showIcon title={projection.prompt} /> : null}
      {projection.images.length || projection.requirements.length ? <Card className="query-sop-card query-sop-task">
        <SopImages images={projection.images} />
        {projection.requirements.length ? <Flex vertical gap={8} className="query-sop-requirements" role="group" aria-label="需要核实">
          {projection.requirements.map(requirement => <Checkbox key={requirement.id} checked={requirement.checked} disabled={unavailable}
            onChange={event => command({ type: 'check', requirementId: requirement.id, checked: event.target.checked })}>{requirement.label}</Checkbox>)}
        </Flex> : null}
      </Card> : null}
      {projection.scripts.length ? <div className="query-sop-scripts" aria-label="客户话术">
        {projection.scripts.map(script => script.unpublished ? <Card className="query-sop-card query-sop-script" key={script.scriptId}>
          <Typography.Text type="warning">该话术当前不可用</Typography.Text>
        </Card> : <Card className="query-sop-card query-sop-script" key={script.scriptId} data-selected={projection.selectedScriptId === script.scriptId}>
          <div className="query-sop-script-row">
            {projection.scripts.length > 1 ? <Radio checked={projection.selectedScriptId === script.scriptId} disabled={unavailable}
              aria-label={`选择${script.title}`} onChange={() => command({ type: 'select-script', scriptId: script.scriptId })} /> : null}
            <Button type="text" className="query-sop-script-toggle" aria-expanded={expandedScripts.includes(script.scriptId)}
              aria-controls={`sop-script-${script.scriptId}`} onClick={() => setExpandedScripts(current => current.includes(script.scriptId)
                ? current.filter(id => id !== script.scriptId) : [...current, script.scriptId])}>{script.title}<span aria-hidden="true">{expandedScripts.includes(script.scriptId) ? '收起' : '展开'}</span></Button>
            <Button loading={pendingAction === 'copy' && pendingCopyScriptId === script.scriptId}
              disabled={unavailable} aria-label={`复制${script.title}`} onClick={() => copy(script.scriptId)}>
              {copiedScriptId === script.scriptId ? '已复制' : '复制'}
            </Button>
          </div>
          {script.condition ? <Typography.Text type="secondary" className="query-sop-script-condition">{script.condition}</Typography.Text> : null}
          <div id={`sop-script-${script.scriptId}`} hidden={!expandedScripts.includes(script.scriptId)} className="query-sop-script-body"><Typography.Paragraph>{script.answerText}</Typography.Paragraph>
            {expandedScripts.includes(script.scriptId) ? <SopImages images={script.images} /> : null}</div>
        </Card>)}
      </div> : null}
      {projection.internalNote ? <Card className="query-sop-card query-sop-note"><Typography.Text strong>内部说明</Typography.Text><Typography.Paragraph>{projection.internalNote}</Typography.Paragraph></Card> : null}
      {projection.edges.length ? <div className="query-sop-decisions">
        {canRecommend ? <Input aria-label="客户当前情况" placeholder="输入当前情况，查找适用选项" maxLength={500} value={situation} disabled={unavailable}
          onChange={event => setSituation(event.target.value)} /> : null}
        <div className="query-sop-choice-grid" role="group" aria-label="判断选项" data-choice-count={projection.edges.length}>
        {projection.edges.map(edge => {
          const pending = pendingChoice?.taskId === projection.taskId && pendingChoice.nodeId === projection.nodeId
            && pendingChoice.stepIndex === projection.stepIndex && pendingChoice.edgeId === edge.id;
          return <Button key={edge.id} disabled={unavailable || !projection.canChoose} className="query-sop-choice" type={pending ? 'primary' : 'default'}
            aria-busy={pending || undefined} data-pending={pending || undefined}
            onClick={() => command({ type: 'choose', edgeId: edge.id })}><span><strong>{edge.label}</strong><span className="query-sop-criterion">{edge.criterion}</span>
            {recommended.has(edge.id) ? <span className="query-sop-recommendation">推荐 · 匹配 {recommended.get(edge.id)?.join('、')}</span> : null}</span></Button>;
        })}
        </div>
      </div> : null}
      {projection.knowledge.length ? <Collapse ghost size="small" items={projection.knowledge.map(item => ({ key: item.id, label: item.title,
        children: <><Typography.Paragraph>{item.body}</Typography.Paragraph><SopImages images={item.images} /></> }))} /> : null}
      {projection.history.length > 1 ? <Collapse ghost size="small" items={[{ key: 'history', label: '已走步骤', children: <Collapse ghost size="small"
        items={projection.history.map(item => ({ key: `${item.stepIndex}-${item.nodeId}`, label: `步骤 ${item.stepIndex} ${item.title}`,
          children: <div className="query-sop-history-detail"><Typography.Paragraph>{item.instruction}</Typography.Paragraph>
            {item.choiceLabel ? <Typography.Paragraph>已选 {item.choiceLabel}</Typography.Paragraph> : null}
            {item.confirmedRequirements.length ? <ul aria-label="已确认材料">{item.confirmedRequirements.map(label => <li key={label}>{label}</li>)}</ul> : null}
            {item.stepIndex < projection.stepIndex ? <Button size="small" disabled={operationBlocked}
              onClick={() => setConfirmation({ kind: 'rewind', stepIndex: item.stepIndex, title: item.title })}>返回此步</Button> : <Typography.Text type="secondary">当前步骤</Typography.Text>}
          </div> }))} /> }]} /> : null}
    </div>
    <div className="query-sop-feedback" data-testid="sop-feedback" aria-live="polite">
      {draftLoad?.taskId === projection.taskId && draftLoad.hostEpoch === hostEpoch && draftLoad.phase === 'error'
        ? <Alert type="error" title="无法读取名称草稿" action={<Button size="small" onClick={() => setDraftLoadAttempt(value => value + 1)}>重新读取</Button>} />
        : error ? <Alert type="error" title={error} /> : feedback ? <Typography.Text type="secondary">{feedback}</Typography.Text> : null}
    </div>
    <footer className="query-sop-footer">
      {projection.scripts.length ? <Tooltip title={selectedScript ? 'F6' : '先选择一条话术'}><Button loading={pendingAction === 'copy'} disabled={unavailable || !selectedScript || selectedScript.unpublished}
        onClick={() => { if (selectedScript) copy(selectedScript.scriptId); }}><span aria-live="polite">{projection.copied && copyGeneration === seenCopyGeneration.current ? '已复制' : '复制话术'}</span></Button></Tooltip> : <span />}
      <div className="query-sop-step-actions">
        <Button disabled={operationBlocked || !previous} onClick={() => { if (previous) setConfirmation({ kind: 'rewind', stepIndex: previous.stepIndex, title: previous.title }); }}>上一步</Button>
        <Tooltip title={canNext ? 'F8' : projection.nodeKind === 'decision' ? '请选择实际情况' : projection.terminal ? '当前已到终点' : '先完成必要核实'}><span><Button type="primary" disabled={unavailable || !canNext} onClick={() => command({ type: 'next' })}>下一步</Button></span></Tooltip>
        {projection.terminal ? <Button type="primary" disabled={operationBlocked} onClick={() => setConfirmation({ kind: 'end' })}>结束流程</Button> : null}
      </div>
    </footer>
    <Modal open={confirmation !== null} title={confirmation?.kind === 'rewind' ? `返回「${confirmation.title}」？` : confirmation?.kind === 'restart' ? '重新开始并清除进度？' : '结束并清除进度？'}
      width={320} centered closable={false} okText={confirmation?.kind === 'rewind' ? '返回并清除后续进度' : confirmation?.kind === 'restart' ? '重新开始' : '结束流程'} cancelText="取消"
      onCancel={() => setConfirmation(null)} onOk={confirm} okButtonProps={{ danger: confirmation?.kind === 'end' }}>
      {confirmation?.kind === 'end' ? <Typography.Paragraph>结束「{label}」后将清除这条流程的进度，其他流程不受影响。</Typography.Paragraph> : null}
      {confirmation?.kind === 'rewind' ? <Typography.Paragraph>将清除这一步及后续的选择和确认记录，已复制内容无法撤回。</Typography.Paragraph> : null}
    </Modal>
  </section>;
}
