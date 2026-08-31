import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  clampLocalFollow,
  type FoxAmbientPose,
  type FoxFollowOffset,
} from '@shared/fox-presence';
import { FoxSleepClock, writeFoxCssVars } from './fox-presence-runtime';

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => {
      setReduced(Boolean(media.matches));
    };
    sync();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }
    if (typeof media.addListener === 'function') {
      media.addListener(sync);
      return () => media.removeListener(sync);
    }
  }, []);

  return reduced;
}

export function useFoxAmbient(input: {
  paused: boolean;
  reducedMotion: boolean;
}): {
  ambient: Exclude<FoxAmbientPose, 'following-local'>;
  wake: () => void;
} {
  const [ambient, setAmbient] = useState<Exclude<FoxAmbientPose, 'following-local'>>('awake');
  const clockRef = useRef<FoxSleepClock | null>(null);
  const pausedRef = useRef(input.paused);
  const reducedRef = useRef(input.reducedMotion);

  if (!clockRef.current) {
    clockRef.current = new FoxSleepClock(
      (handler, timeout) => window.setTimeout(handler, timeout),
      (handle) => window.clearTimeout(handle as number),
      () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    );
  }

  const restart = useCallback((): void => {
    setAmbient((current) => (current === 'awake' ? current : 'awake'));
    if (pausedRef.current || reducedRef.current) {
      clockRef.current?.invalidate();
      return;
    }
    clockRef.current?.start((next) => {
      setAmbient(next);
    });
  }, []);

  const wake = useCallback((): void => {
    clockRef.current?.invalidate();
    restart();
  }, [restart]);

  useEffect(() => {
    pausedRef.current = input.paused;
    reducedRef.current = input.reducedMotion;
    if (input.paused || input.reducedMotion) {
      clockRef.current?.invalidate();
      setAmbient('awake');
      return;
    }
    restart();
  }, [input.paused, input.reducedMotion, restart]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        clockRef.current?.invalidate();
        setAmbient('awake');
        return;
      }
      wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clockRef.current?.dispose();
    };
  }, [wake]);

  return { ambient, wake };
}

export function useFoxLocalFollow(
  rootRef: RefObject<HTMLElement | null>,
  input: {
    enabled: boolean;
    reducedMotion: boolean;
    onActivity?: () => void;
  },
): {
  following: boolean;
  reset: () => void;
} {
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<FoxFollowOffset | null>(null);
  const enabledRef = useRef(input.enabled);
  const reducedRef = useRef(input.reducedMotion);
  const activityRef = useRef(input.onActivity);
  const lastActivityAtRef = useRef(Number.NEGATIVE_INFINITY);

  const publishFollowing = useCallback((next: boolean): void => {
    if (followingRef.current === next) return;
    followingRef.current = next;
    setFollowing(next);
  }, []);

  enabledRef.current = input.enabled;
  reducedRef.current = input.reducedMotion;
  activityRef.current = input.onActivity;

  const cancelRaf = useCallback((): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const flushReset = useCallback((): void => {
    cancelRaf();
    writeFoxCssVars(rootRef.current, 'follow', null);
    publishFollowing(false);
  }, [cancelRaf, publishFollowing, rootRef]);

  const reset = useCallback((): void => {
    flushReset();
  }, [flushReset]);

  useEffect(() => {
    if (!input.enabled || input.reducedMotion) {
      flushReset();
    }
  }, [flushReset, input.enabled, input.reducedMotion]);

  useEffect(() => {
    const applyPending = (): void => {
      rafRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (!enabledRef.current || reducedRef.current) {
        writeFoxCssVars(rootRef.current, 'follow', null);
        publishFollowing(false);
        return;
      }
      writeFoxCssVars(rootRef.current, 'follow', next);
      publishFollowing(Boolean(next && (next.x !== 0 || next.y !== 0 || next.rot !== 0)));
    };

    const queueFollow = (offset: FoxFollowOffset | null): void => {
      pendingRef.current = offset;
      if (rafRef.current !== null) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(applyPending);
    };

    const readOffset = (event: PointerEvent): FoxFollowOffset | null => {
      const root = rootRef.current;
      if (!root) return null;
      const box = root.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      if (
        event.clientX < box.left
        || event.clientX > box.right
        || event.clientY < box.top
        || event.clientY > box.bottom
      ) {
        return null;
      }
      const localX = event.clientX - (box.left + box.width / 2);
      const localY = event.clientY - (box.top + box.height / 2);
      return clampLocalFollow(localX, localY, box.width / 2, box.height / 2);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!enabledRef.current || reducedRef.current) {
        return;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastActivityAtRef.current >= 750) {
        lastActivityAtRef.current = now;
        activityRef.current?.();
      }
      queueFollow(readOffset(event));
    };

    const onLeave = (): void => {
      lastActivityAtRef.current = Number.NEGATIVE_INFINITY;
      queueFollow(null);
      publishFollowing(false);
    };

    const target = rootRef.current;
    target?.addEventListener('pointermove', onPointerMove);
    target?.addEventListener('pointerleave', onLeave);
    target?.addEventListener('pointercancel', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      target?.removeEventListener('pointermove', onPointerMove);
      target?.removeEventListener('pointerleave', onLeave);
      target?.removeEventListener('pointercancel', onLeave);
      window.removeEventListener('blur', onLeave);
      cancelRaf();
      writeFoxCssVars(target, 'follow', null);
    };
  }, [cancelRaf, publishFollowing, rootRef]);

  return { following, reset };
}
