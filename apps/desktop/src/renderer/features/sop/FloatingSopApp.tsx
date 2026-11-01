import { Alert, Button, Typography } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isSopFloatingSnapshot, SOP_UNAVAILABLE, type SopFloatingSnapshot, type SopTaskSummary } from '@shared/sop-window';
import { QueryAntdTheme } from '../../components/QueryAntdTheme';
import { QuerySopPanel, type SopTransferRegistration } from './QuerySopPanel';
import { QuerySopWindowControls } from './QuerySopWindowControls';
import { SopRenameDrafts } from './sop-rename-drafts';
import { useSopSnapshotRefresh } from './use-sop-snapshot-refresh';
import { SopAcceptedRevisions } from './sop-accepted-revisions';
import '../../styles/floating-sop-collapsed.css';

type FloatingAction = { type: 'show-query' | 'hide' | 'expand'; taskId: string; hostEpoch: number };
type FloatingError = { kind: 'action'; request: FloatingAction } | { kind: 'read' | 'prepare'; message: string };
const ACTION_ERROR = { 'show-query': '暂时无法显示查询，请重试', hide: '窗口收起失败，请重试', expand: '展开流程失败，请重试' };

/** The floating renderer consumes the same projection but never owns tasks or query capabilities. */
export function FloatingSopApp() {
  const api = window.sopFloating;
  const [drafts] = useState(() => new SopRenameDrafts());
  const [snapshot, setSnapshot] = useState<SopFloatingSnapshot | null>(null);
  const latest = useRef<SopFloatingSnapshot | null>(null);
  const lastReady = useRef<Extract<SopFloatingSnapshot, { kind: 'ready' }> | null>(null);
  const latestSequence = useRef(0);
  const ownedTaskId = useRef<string | null>(null);
  const acceptedRevisions = useRef(new SopAcceptedRevisions());
  const received = useRef(0);
  const [error, setError] = useState<FloatingError | null>(null);
  const [retry, setRetry] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pendingActions = useRef<Partial<Record<FloatingAction['type'], FloatingAction>>>({});
  const retryPending = useRef<FloatingAction | null>(null);
  const transferGuard = useRef<SopTransferRegistration | null>(null);
  const registerTransferGuard = useCallback((guard: SopTransferRegistration | null) => { transferGuard.current = guard; }, []);
  const prepared = useRef<number | null>(null);
  const accept = useCallback((value: unknown) => {
    let next = isSopFloatingSnapshot(value) ? value : SOP_UNAVAILABLE;
    if (next.kind === 'ready') {
      if (next.sequence < latestSequence.current || (next.sequence === latestSequence.current && latest.current?.kind === 'ready')) return;
      if (next.sequence === latestSequence.current && lastReady.current) next = lastReady.current;
      const activeIds = new Set(next.seenActiveTaskIds);
      if ((next.projection && ownedTaskId.current !== null && next.projection.taskId !== ownedTaskId.current)
        || !acceptedRevisions.current.observe(next.tasks, activeIds)) next = SOP_UNAVAILABLE;
      else {
        if (next.projection) ownedTaskId.current = next.projection.taskId;
        if (next.sequence > latestSequence.current) drafts.retain(activeIds);
        latestSequence.current = next.sequence;
        lastReady.current = next;
      }
    }
    received.current += 1;
    latest.current = next;
    setSnapshot(next);
    setError(previous => {
      if (!previous || previous.kind !== 'action' || next.kind !== 'ready' || !next.projection || next.access.kind !== 'executable') return null;
      const { request } = previous;
      if (request.taskId !== next.projection.taskId || request.hostEpoch !== next.access.hostEpoch) return null;
      if ((request.type === 'hide' && next.collapsed) || (request.type === 'expand' && !next.collapsed)) return null;
      return previous;
    });
  }, [drafts]);
  const { refresh, afterOperation } = useSopSnapshotRefresh(api?.current, accept, received);
  const readCopyGeneration = useCallback(() => latest.current?.kind === 'ready' ? latest.current.copyGeneration : 0, []);
  const afterStepOperation = useCallback(async (source: Pick<SopTaskSummary, 'taskId' | 'revision'>) => {
    acceptedRevisions.current.expect(source);
    await afterOperation();
    const current = latest.current;
    if (current?.kind === 'ready' && !acceptedRevisions.current.observe(current.tasks, new Set(current.seenActiveTaskIds))) accept(SOP_UNAVAILABLE);
  }, [accept, afterOperation]);
  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onProjection(accept);
    void refresh();
    return () => { unsubscribe(); received.current += 1; };
  }, [accept, api, refresh]);
  const previewMountId = snapshot?.kind === 'ready' && snapshot.access.kind === 'preview' && snapshot.projection ? snapshot.access.mountId : null;
  useLayoutEffect(() => {
    if (!api || previewMountId === null) return;
    const mountId = previewMountId;
    if (prepared.current === mountId) return;
    prepared.current = mountId;
    let cancelled = false;
    void api.ready({ mountId }).then(ok => { if (!cancelled && !ok) setError({ kind: 'prepare', message: '窗口准备失败，请重试' }); })
      .catch(() => { if (!cancelled) setError({ kind: 'prepare', message: '窗口准备失败，请重试' }); });
    return () => { cancelled = true; };
  }, [api, previewMountId, retry]);
  const projection = snapshot?.kind === 'ready' ? snapshot.projection : null;
  const task = snapshot?.kind === 'ready' && projection ? snapshot.tasks.find(task => task.taskId === projection.taskId) : null;
  const hostEpoch = snapshot?.kind === 'ready' && snapshot.access.kind === 'executable' ? snapshot.access.hostEpoch : null;
  const collapsed = snapshot?.kind === 'ready' && snapshot.collapsed;
  const name = task ? task.displayName ?? `${task.sceneTitle} #${task.ordinal}` : projection?.sceneTitle ?? '流程';
  const bookmarkName = task && !task.displayName ? `${task.sceneTitle}${task.ordinal}` : name;
  useEffect(() => { setExpanding(false); setRetrying(false); }, [projection?.taskId, hostEpoch]);
  const isCurrent = (request: FloatingAction) => latest.current?.kind === 'ready' && latest.current.projection?.taskId === request.taskId
    && latest.current.access.kind === 'executable' && latest.current.access.hostEpoch === request.hostEpoch;
  const stillNeedsAction = (request: FloatingAction) => latest.current?.kind === 'ready'
    && (request.type === 'show-query' || (request.type === 'hide' ? !latest.current.collapsed : latest.current.collapsed));
  const perform = async (request: FloatingAction): Promise<void> => {
    if (!api || !isCurrent(request)) return;
    const existing = pendingActions.current[request.type];
    if (existing && existing.taskId === request.taskId && existing.hostEpoch === request.hostEpoch) return;
    pendingActions.current[request.type] = request;
    if (request.type === 'expand') setExpanding(true);
    try {
      const ok = await api.windowIntent(request);
      if (!isCurrent(request)) return;
      if (!ok && stillNeedsAction(request)) setError({ kind: 'action', request });
      else setError(previous => previous?.kind === 'action' && previous.request.type === request.type
        && previous.request.taskId === request.taskId && previous.request.hostEpoch === request.hostEpoch ? null : previous);
    } catch {
      if (isCurrent(request) && stillNeedsAction(request)) setError({ kind: 'action', request });
    } finally {
      if (pendingActions.current[request.type] === request) {
        delete pendingActions.current[request.type];
        if (request.type === 'expand') setExpanding(false);
      }
    }
  };
  const showQuery = () => {
    if (projection && hostEpoch !== null) void perform({ type: 'show-query', taskId: projection.taskId, hostEpoch });
  };
  const hide = async () => {
    if (projection && hostEpoch !== null) await perform({ type: 'hide', taskId: projection.taskId, hostEpoch });
  };
  const expand = () => {
    if (projection && hostEpoch !== null) void perform({ type: 'expand', taskId: projection.taskId, hostEpoch });
  };
  const retryAction = async (request: FloatingAction) => {
    if (!isCurrent(request) || (retryPending.current?.taskId === request.taskId && retryPending.current.hostEpoch === request.hostEpoch)) return;
    retryPending.current = request;
    setRetrying(true);
    try {
      if (request.type === 'hide') {
        const guard = transferGuard.current;
        if (!guard || guard.taskId !== request.taskId || guard.hostEpoch !== request.hostEpoch || !await guard.prepareTransfer()) return;
        try { if (isCurrent(request)) await perform(request); }
        finally { guard.finishTransfer(); }
      } else await perform(request);
    } catch {
      if (isCurrent(request) && stillNeedsAction(request)) setError({ kind: 'action', request });
    } finally {
      if (retryPending.current === request) { retryPending.current = null; setRetrying(false); }
    }
  };
  const recover = () => {
    if (error?.kind === 'action') { void retryAction(error.request); return; }
    if (snapshot?.kind === 'ready' && snapshot.access.kind === 'preview') {
      prepared.current = null;
      setError(null);
      setRetry(value => value + 1);
    } else if (api) {
      const before = received.current;
      void api.current().then(value => { if (before === received.current) accept(value); })
        .catch(() => { if (before === received.current) setError({ kind: 'read', message: '读取失败，请重试' }); });
    }
  };
  const errorMessage = error?.kind === 'action' ? ACTION_ERROR[error.request.type] : error?.message ?? '';
  return <QueryAntdTheme><main className="query-shell floating-sop-shell" data-sop-view="true" data-workspace-view="sop" data-collapsed={collapsed ? 'true' : 'false'}>
    <div className="glass-shell">
      <div className="glass-surface" aria-hidden="true" />
      {errorMessage && !collapsed ? <Alert type="error" title={errorMessage} action={<Button size="small" loading={retrying} onClick={recover}>重试</Button>} /> : null}
      {api && projection && collapsed ? <div className="floating-sop-collapsed" role="group" aria-label="已折叠的 SOP">
          <Button className="floating-sop-bookmark" type="text" aria-label={hostEpoch === null && errorMessage ? '重新读取流程' : '展开流程'}
            aria-description={`${name} · 步骤 ${projection.stepIndex} · ${projection.taskTitle}`}
            disabled={hostEpoch === null && !errorMessage} loading={expanding || retrying} onClick={hostEpoch === null ? recover : expand}>
            <span className="floating-sop-collapsed-label">
              <Typography.Text strong>{bookmarkName}</Typography.Text>
              {errorMessage ? <span className="floating-sop-bookmark-error" role="alert">{hostEpoch === null ? '读取失败，点击重试' : '展开失败，点击重试'}</span> : null}
            </span>
          </Button>
      </div> : api && projection ? hostEpoch === null
        ? <QuerySopPanel mode="floating" task={task ?? undefined} projection={projection} hostEpoch={null} api={api} drafts={drafts} copyGeneration={snapshot?.kind === 'ready' ? snapshot.copyGeneration : 0} readCopyGeneration={readCopyGeneration} onOperationSuccess={afterStepOperation} onSearch={showQuery} searchLabel="显示查询" onCollapse={hide} />
        : <QuerySopWindowControls api={api} taskId={projection.taskId} hostEpoch={hostEpoch} mode="floating">{control =>
          <QuerySopPanel mode="floating" task={task ?? undefined} projection={projection} hostEpoch={hostEpoch} api={api} drafts={drafts} copyGeneration={snapshot?.kind === 'ready' ? snapshot.copyGeneration : 0} readCopyGeneration={readCopyGeneration} onOperationSuccess={afterStepOperation} onSearch={showQuery} searchLabel="显示查询" onCollapse={hide} windowControls={control} onTransferGuard={registerTransferGuard} />
        }</QuerySopWindowControls>
        : snapshot?.kind === 'unavailable' ? <Alert type="error" title={snapshot.message} action={<Button onClick={recover}>重新读取</Button>} />
          : <Typography.Text className="floating-sop-empty">从查询待办打开流程</Typography.Text>}
    </div>
  </main></QueryAntdTheme>;
}
