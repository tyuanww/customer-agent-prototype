import { Alert, Button, Tooltip } from 'antd';
import { ExportOutlined, ImportOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SOP_RESIZE_EDGES, type QuerySopWindowIntent, type SopResizeEdge } from '@shared/query-sop-window';
import type { QuerySopWindowApi } from '@shared/sop-window';

type TransferGuard = Readonly<{ prepareTransfer: () => Promise<boolean>; finishTransfer: () => void }>;

/** Only epoch-bound intentions cross IPC. Main owns the frame and its size preference. */
export function QuerySopWindowControls({ api, taskId, hostEpoch, mode, children }: {
  api: Pick<QuerySopWindowApi, 'windowIntent'>;
  taskId: string;
  hostEpoch: number | null;
  mode: 'query' | 'floating';
  children: (modeControl: (disabled: boolean, guard?: TransferGuard) => ReactNode) => ReactNode;
}) {
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const pendingSwitch = useRef(false);
  const counter = useRef(Date.now());
  const gesture = useRef<{ id: number; x: number; y: number; pointer: number; taskId: string; hostEpoch: number } | null>(null);
  const send = useCallback(async (intent: QuerySopWindowIntent) => {
    try { return await api.windowIntent?.(intent) === true; }
    catch { return false; }
  }, [api]);
  const finish = useCallback((type: 'resize-end' | 'resize-cancel') => {
    const active = gesture.current;
    gesture.current = null;
    if (active) void send({ taskId: active.taskId, hostEpoch: active.hostEpoch, type, gesture: active.id });
  }, [send]);
  useEffect(() => {
    const settle = () => finish('resize-end');
    window.addEventListener('blur', settle);
    return () => { window.removeEventListener('blur', settle); finish('resize-cancel'); };
  }, [finish, taskId, hostEpoch]);
  const start = (event: React.PointerEvent<HTMLDivElement>, edge: SopResizeEdge) => {
    if (event.button !== 0 || hostEpoch === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const id = ++counter.current;
    gesture.current = { id, x: event.screenX, y: event.screenY, pointer: event.pointerId, taskId, hostEpoch };
    void send({ taskId, hostEpoch, type: 'resize-start', gesture: id, edge }).then(ok => {
      if (!ok && gesture.current?.id === id) { gesture.current = null; setError('暂时无法调整窗口大小'); }
    });
  };
  const label = mode === 'floating' ? '合回查询' : '独立悬浮';
  const modeControl = (disabled: boolean, guard?: TransferGuard) => <Tooltip title={disabled ? '当前操作完成后再试' : label}>
    <span><Button type="text" icon={mode === 'floating' ? <ImportOutlined /> : <ExportOutlined />} aria-label={label} disabled={hostEpoch === null || disabled} loading={switching} onClick={() => {
      if (pendingSwitch.current || hostEpoch === null || disabled) return;
      pendingSwitch.current = true;
      setSwitching(true);
      void (async () => {
        try {
          if (guard && !await guard.prepareTransfer()) return;
          const ok = await send({ taskId, hostEpoch, type: mode === 'floating' ? 'attach' : 'detach' });
          setError(ok ? '' : '窗口切换失败，请重试');
        } catch {
          setError('窗口切换失败，请重试');
        } finally {
          guard?.finishTransfer();
          pendingSwitch.current = false;
          setSwitching(false);
        }
      })();
    }} /></span>
  </Tooltip>;
  return <>
    {error ? <Alert type="error" title={error} /> : null}
    {children(modeControl)}
    {hostEpoch !== null ? SOP_RESIZE_EDGES.map(edge => <div key={edge} className={`sop-resize-edge sop-resize-${edge}`} aria-hidden="true"
      onPointerDown={event => start(event, edge)} onPointerUp={() => finish('resize-end')}
      onPointerCancel={() => finish('resize-cancel')} onLostPointerCapture={() => finish('resize-end')}
      onPointerMove={event => {
        const active = gesture.current;
        if (!active || active.pointer !== event.pointerId) return;
        if ((event.buttons & 1) === 0) { finish('resize-end'); return; }
        void send({ taskId: active.taskId, hostEpoch: active.hostEpoch, type: 'resize', gesture: active.id, dx: event.screenX - active.x, dy: event.screenY - active.y });
      }} />) : null}
  </>;
}
