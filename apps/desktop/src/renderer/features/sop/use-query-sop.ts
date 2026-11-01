import { useCallback, useEffect, useRef, useState } from 'react';
import { isQuerySopSnapshot, SOP_UNAVAILABLE, type QuerySopSnapshot, type SopTaskSummary, type SopWindowResult } from '@shared/sop-window';
import type { QuerySopNavigation } from '@shared/query-sop-window';
import { useSopSnapshotRefresh } from './use-sop-snapshot-refresh';
import { SopAcceptedRevisions } from './sop-accepted-revisions';

/** Keeps one validated Main projection and rejects late reads after a newer event. */
export function useQuerySop() {
  const api = window.customerAgent?.sopWindow;
  const [snapshot, setSnapshot] = useState<QuerySopSnapshot | null>(null);
  const snapshotRef = useRef<QuerySopSnapshot | null>(null);
  const lastReady = useRef<Extract<QuerySopSnapshot, { kind: 'ready' }> | null>(null);
  const latestSequence = useRef(0);
  const acceptedRevisions = useRef(new SopAcceptedRevisions());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);
  const cancellable = useRef<{ id: number; loading: boolean } | null>(null);
  const writing = useRef(false);
  const received = useRef(0);
  const milestone = useRef<string | null>(null);
  const recoveryRequest = useRef<number | null>(null);
  const accept = useCallback((value: unknown) => {
    let next = isQuerySopSnapshot(value) ? value : SOP_UNAVAILABLE;
    const prior = snapshotRef.current;
    if (next.kind === 'ready') {
      const cleared = next.sequence > latestSequence.current && next.projection === null && next.tasks.length === 0;
      const handoff = next.sequence > latestSequence.current && next.access.kind === 'preview';
      if (prior?.kind === 'unavailable' && !cleared && !handoff && recoveryRequest.current !== pending.current) return;
      if (next.sequence < latestSequence.current || (next.sequence === latestSequence.current && prior?.kind === 'ready')) return;
      if (next.sequence === latestSequence.current && lastReady.current) next = lastReady.current;
      if (!acceptedRevisions.current.observe(next.tasks, new Set(next.tasks.map(task => task.taskId)))) next = SOP_UNAVAILABLE;
      else { latestSequence.current = next.sequence; lastReady.current = next; }
    }
    if (next.kind === 'unavailable') recoveryRequest.current = null;
    received.current += 1;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const { refresh, afterOperation } = useSopSnapshotRefresh(api?.current, accept, received);
  const afterStepOperation = useCallback(async (source: Pick<SopTaskSummary, 'taskId' | 'revision'>) => {
    acceptedRevisions.current.expect(source);
    await afterOperation();
    const current = snapshotRef.current;
    if (current?.kind === 'ready' && !acceptedRevisions.current.observe(current.tasks, new Set(current.tasks.map(task => task.taskId)))) accept(SOP_UNAVAILABLE);
  }, [accept, afterOperation]);
  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onProjection?.(accept);
    void refresh();
    return () => { unsubscribe?.(); pending.current += 1; };
  }, [accept, api, refresh]);
  const syncBusy = useCallback(() => { setBusy(writing.current || cancellable.current?.loading === true); }, []);
  const cancelPending = useCallback(() => {
    if (!cancellable.current) return;
    if (!writing.current) received.current += 1;
    pending.current += 1;
    cancellable.current = null;
    syncBusy();
  }, [syncBusy]);
  const runCancellable = useCallback(async (action: () => Promise<SopWindowResult>, loading = true, restoreUnavailable = false) => {
    if (loading && (writing.current || cancellable.current?.loading)) return false;
    if (cancellable.current && !writing.current) received.current += 1;
    const id = ++pending.current;
    cancellable.current = { id, loading };
    if (restoreUnavailable) recoveryRequest.current = id;
    syncBusy();
    setError(null);
    try {
      let result: SopWindowResult;
      try { result = await action(); }
      catch { if (cancellable.current?.id === id) setError('流程操作失败，请重试'); return false; }
      if (cancellable.current?.id !== id) return false;
      if (!result.ok) { setError(result.message); return false; }
      await afterOperation(() => cancellable.current?.id === id);
      return true;
    } finally {
      if (recoveryRequest.current === id) recoveryRequest.current = null;
      if (cancellable.current?.id === id) { cancellable.current = null; syncBusy(); }
    }
  }, [afterOperation, syncBusy]);
  const runWrite = useCallback(async (action: () => Promise<SopWindowResult>) => {
    if (writing.current || cancellable.current?.loading) return false;
    writing.current = true;
    syncBusy();
    setError(null);
    try {
      let result: SopWindowResult;
      try { result = await action(); }
      catch { setError('流程操作失败，请重试'); return false; }
      if (!result.ok) { setError(result.message); return false; }
      await afterOperation();
      return true;
    } finally { writing.current = false; syncBusy(); }
  }, [afterOperation, syncBusy]);
  const navigate = useCallback(async (intent: Omit<Extract<QuerySopNavigation, { type: 'view-ready' }>, 'viewEpoch'> | { type: 'home' | 'results' | 'view-finished' }): Promise<void> => {
    const current = snapshotRef.current, send = api?.navigate;
    if (current?.kind !== 'ready' || !send) return;
    const request = { ...intent, viewEpoch: current.viewEpoch };
    if (intent.type === 'view-ready' || intent.type === 'view-finished') {
      const key = `${current.viewEpoch}:${intent.type}`;
      if (milestone.current === key) return;
      milestone.current = key;
      await send(request).catch(() => { setError('窗口调整失败，请重试'); });
      return;
    }
    await runCancellable(() => send(request), false);
  }, [api, runCancellable]);
  const open = useCallback((sceneId: string) => {
    if (!api || busy) return;
    void runCancellable(() => api.open(sceneId), true, true);
  }, [api, busy, runCancellable]);
  const restore = useCallback((task: SopTaskSummary) => {
    const current = snapshotRef.current;
    const send = api?.navigate;
    if (current?.kind !== 'ready' || !send || busy) return;
    void runCancellable(() => send({ type: 'restore', taskId: task.taskId, revision: task.revision, viewEpoch: current.viewEpoch }));
  }, [api, busy, runCancellable]);
  const close = useCallback((task: SopTaskSummary) => {
    const command = api?.endTask;
    if (!command) return;
    void runWrite(() => command({ taskId: task.taskId, revision: task.revision, stepIndex: task.stepIndex }));
  }, [api, runWrite]);
  const rename = useCallback(async (task: SopTaskSummary, name: string) => {
    if (!api?.rename) return false;
    return runWrite(() => api.rename!({ taskId: task.taskId, revision: task.revision, displayName: name.trim() || null }));
  }, [api, runWrite]);
  useEffect(() => {
    if (snapshot?.kind === 'ready' && snapshot.access.kind === 'preview') {
      void api?.ready?.({ mountId: snapshot.access.mountId }).catch(() => { setError('流程窗口准备失败，请重试'); });
    }
  }, [api, snapshot]);
  const recover = useCallback(() => {
    if (!api?.current || writing.current || cancellable.current?.loading) return;
    if (cancellable.current) received.current += 1;
    const id = ++pending.current, before = received.current;
    cancellable.current = { id, loading: true };
    recoveryRequest.current = id;
    syncBusy(); setError(null);
    void api.current().then(value => { if (cancellable.current?.id === id && received.current === before) {
      accept(value);
    } })
      .catch(() => { if (cancellable.current?.id === id && received.current === before) accept(SOP_UNAVAILABLE); })
      .finally(() => {
        if (recoveryRequest.current === id) recoveryRequest.current = null;
        if (cancellable.current?.id === id) { cancellable.current = null; syncBusy(); }
      });
  }, [accept, api, syncBusy]);
  return { snapshot, snapshotRef, busy, error, navigate, open, restore, close, rename, recover, cancelPending, afterStepOperation };
}
