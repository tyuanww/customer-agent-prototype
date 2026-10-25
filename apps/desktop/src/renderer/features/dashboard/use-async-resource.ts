import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { type AsyncResource } from '@shared/async-resource';

export const READ_DISCARDED = { discarded: true as const };

export type DashboardRead<T> = AsyncResource<T> | typeof READ_DISCARDED;

function inputKey(deps: readonly unknown[]): string {
  return deps.map((item) => (item === undefined ? 'undefined' : String(item))).join('\0');
}

function isDiscarded<T>(value: DashboardRead<T>): value is typeof READ_DISCARDED {
  return value === READ_DISCARDED;
}

/**
 * One dashboard read with the five states from `AsyncResource`.
 * `retainReady` keeps the last list on screen while a later read is in flight.
 * The caller owns action sentences. This hook does not store them.
 * A discarded read is dropped and does not change the five states.
 */
export function useAsyncResource<T>(
  read: () => Promise<DashboardRead<T>>,
  deps: readonly unknown[],
  initial: AsyncResource<T>,
  options?: { readonly retainReady?: boolean },
): {
  readonly resource: AsyncResource<T>;
  readonly reload: () => void;
  readonly replace: Dispatch<SetStateAction<AsyncResource<T>>>;
} {
  const readRef = useRef(read);
  readRef.current = read;
  const retainReady = options?.retainReady === true;
  const [epoch, setEpoch] = useState(0);
  const [resource, setResource] = useState(initial);
  const statusRef = useRef(initial.status);
  statusRef.current = resource.status;
  const key = inputKey(deps);

  useEffect(() => {
    let live = true;
    let settled = false;
    if (epoch === 0 && statusRef.current === 'forbidden') return undefined;
    const shouldLoad = statusRef.current !== 'forbidden' && !(retainReady && statusRef.current === 'ready');
    void readRef.current().then((next) => {
      settled = true;
      if (!live || isDiscarded(next)) return;
      setResource(next);
    });
    queueMicrotask(() => {
      if (!live || settled || !shouldLoad) return;
      setResource((current) => (current.status === 'loading' ? current : { status: 'loading' }));
    });
    return () => { live = false; };
  }, [epoch, key, retainReady]);

  const reload = useCallback(() => {
    setEpoch((current) => current + 1);
  }, []);

  return { resource, reload, replace: setResource };
}
