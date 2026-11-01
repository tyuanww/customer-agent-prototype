import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { SOP_UNAVAILABLE } from '@shared/sop-window';

/** Reconciles missed notifications without allowing an older read to replace a newer event. */
export function useSopSnapshotRefresh(read: (() => Promise<unknown>) | undefined, accept: (value: unknown) => void, received: RefObject<number>) {
  const inFlight = useRef<Promise<void> | null>(null);
  const focusFollowup = useRef<Promise<void> | null>(null);
  const lifetime = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback((mayAccept?: () => boolean): Promise<void> => {
    if (!read || !mounted.current) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const before = received.current;
    const generation = lifetime.current;
    let request: Promise<unknown>;
    try { request = read(); }
    catch { request = Promise.reject(new Error('SOP snapshot read failed')); }
    const result = request.then(
      value => { if (generation === lifetime.current && before === received.current && (mayAccept?.() ?? true)) accept(value); },
      () => { if (generation === lifetime.current && before === received.current && (mayAccept?.() ?? true)) accept(SOP_UNAVAILABLE); },
    );
    const flight = result.finally(() => { if (inFlight.current === flight) inFlight.current = null; });
    inFlight.current = flight;
    return flight;
  }, [accept, read, received]);
  const afterOperation = useCallback(async (mayAccept?: () => boolean) => {
    if (inFlight.current) await inFlight.current;
    if (mayAccept && !mayAccept()) return;
    await refresh(mayAccept);
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!inFlight.current) { void refresh(); return; }
      if (focusFollowup.current) return;
      const following = inFlight.current.then(() => refresh()).finally(() => {
        if (focusFollowup.current === following) focusFollowup.current = null;
      });
      focusFollowup.current = following;
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      lifetime.current += 1;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  return { refresh, afterOperation };
}
