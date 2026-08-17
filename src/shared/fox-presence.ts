export const FOX_FOLLOW_MAX_PX = 1.75;
export const FOX_FOLLOW_MAX_DEG = 2;

export const FOX_PRESS_DURATION_MS = 110;
export const FOX_DRAG_SETTLE_WATCHDOG_MS = 1600;

export const FOX_DROWSY_AFTER_MS = 8000;
export const FOX_SLEEP_AFTER_MS = 14000;

export const FOX_ANNOYED_DRAG_AFTER_MS = 1600;
export const FOX_ANNOYED_DRAG_DISTANCE_PX = 180;
export const FOX_ANNOYED_DRAG_DURATION_MS = 1200;

export const FOX_STRUCTURAL_POSES = [
  'handoff',
  'snap',
  'peek',
  'retract',
  'dragging',
  'none',
] as const;
export type FoxStructuralPose = (typeof FOX_STRUCTURAL_POSES)[number];

export const FOX_TRANSIENT_POSES = ['none', 'pressed', 'dragging', 'annoyed-drag'] as const;
export type FoxTransientPose = (typeof FOX_TRANSIENT_POSES)[number];

export const FOX_AMBIENT_POSES = ['awake', 'following-local', 'drowsy', 'sleeping'] as const;
export type FoxAmbientPose = (typeof FOX_AMBIENT_POSES)[number];

export const FOX_RESOLVED_POSES = [
  'handoff',
  'snap',
  'peek',
  'retract',
  'annoyed-drag',
  'dragging',
  'pressed',
  'warning',
  'static',
  'following-local',
  'drowsy',
  'sleeping',
  'idle',
] as const;
export type FoxResolvedPose = (typeof FOX_RESOLVED_POSES)[number];

export const FOX_EXPRESSIONS = ['none', 'drowsy', 'closed', 'strained'] as const;
export type FoxExpression = (typeof FOX_EXPRESSIONS)[number];

export type FoxSleepSchedule = {
  token: number;
  drowsyAt: number;
  sleepAt: number;
};

export type FoxFollowOffset = {
  x: number;
  y: number;
  rot: number;
};

export type FoxDragSample = {
  lastDx: number;
  lastDy: number;
  totalDx: number;
  totalDy: number;
  distancePx: number;
  elapsedMs: number;
};

export function resolveFoxStructuralPose(input: {
  handoff: boolean;
  snap: boolean;
  peek: boolean;
  retract: boolean;
  dragging: boolean;
}): FoxStructuralPose {
  if (input.handoff) return 'handoff';
  if (input.snap) return 'snap';
  if (input.peek) return 'peek';
  if (input.retract) return 'retract';
  if (input.dragging) return 'dragging';
  return 'none';
}

export function resolveFoxPose(input: {
  reducedMotion: boolean;
  warning: boolean;
  structural: FoxStructuralPose;
  transient: FoxTransientPose;
  ambient: FoxAmbientPose;
}): FoxResolvedPose {
  if (input.structural === 'handoff') return 'handoff';
  if (input.structural === 'snap') return 'snap';
  if (input.structural === 'peek') return 'peek';
  if (input.structural === 'retract') return 'retract';
  if (input.structural === 'dragging' || input.transient === 'dragging' || input.transient === 'annoyed-drag') {
    return input.transient === 'annoyed-drag' ? 'annoyed-drag' : 'dragging';
  }
  if (input.transient === 'pressed') return 'pressed';
  if (input.reducedMotion) {
    if (input.ambient === 'drowsy') return 'drowsy';
    if (input.ambient === 'sleeping') return 'sleeping';
    return 'static';
  }
  if (input.warning) return 'warning';
  if (input.ambient === 'following-local') return 'following-local';
  if (input.ambient === 'drowsy') return 'drowsy';
  if (input.ambient === 'sleeping') return 'sleeping';
  return 'idle';
}

export function resolveFoxExpression(input: {
  warning: boolean;
  structural: FoxStructuralPose;
  transient: FoxTransientPose;
  ambient: FoxAmbientPose;
}): FoxExpression {
  if (
    input.structural === 'handoff'
    || input.structural === 'snap'
    || input.structural === 'peek'
    || input.structural === 'retract'
  ) {
    return 'none';
  }
  if (
    input.structural === 'dragging'
    || input.transient === 'dragging'
    || input.transient === 'annoyed-drag'
  ) {
    return 'strained';
  }
  if (input.warning) return 'none';
  if (input.transient !== 'none') return 'none';
  if (input.ambient === 'sleeping') return 'closed';
  if (input.ambient === 'drowsy') return 'drowsy';
  return 'none';
}

export function shouldShowFoxHeadsetSignal(input: {
  reducedMotion: boolean;
  warning: boolean;
  structural: FoxStructuralPose;
  transient: FoxTransientPose;
  ambient: FoxAmbientPose;
  justWoke: boolean;
}): boolean {
  if (
    input.reducedMotion
    || input.warning
    || input.structural !== 'none'
    || input.transient !== 'none'
  ) {
    return false;
  }
  return input.ambient === 'following-local'
    || (input.justWoke && input.ambient === 'awake');
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

export function clampLocalFollow(
  offsetX: number,
  offsetY: number,
  halfWidth: number,
  halfHeight: number,
): FoxFollowOffset {
  const nx = halfWidth > 0 ? clampNumber(offsetX / halfWidth, -1, 1) : 0;
  const ny = halfHeight > 0 ? clampNumber(offsetY / halfHeight, -1, 1) : 0;
  return {
    x: nx * FOX_FOLLOW_MAX_PX,
    y: ny * FOX_FOLLOW_MAX_PX,
    rot: nx * FOX_FOLLOW_MAX_DEG,
  };
}

export function computeDragReaction(totalDx: number, totalDy: number): FoxFollowOffset {
  return {
    x: clampNumber(totalDx * 0.02, -2.4, 2.4),
    y: clampNumber(-3.4 + totalDy * 0.024, -4.6, 0.6),
    rot: clampNumber(totalDx * 0.11, -12, 12),
  };
}

export function shouldEnterAnnoyedDrag(input: Pick<FoxDragSample, 'elapsedMs' | 'distancePx'>): boolean {
  return input.elapsedMs >= FOX_ANNOYED_DRAG_AFTER_MS || input.distancePx >= FOX_ANNOYED_DRAG_DISTANCE_PX;
}

export function createFoxSleepSchedule(now: number, token: number): FoxSleepSchedule {
  return {
    token,
    drowsyAt: now + FOX_DROWSY_AFTER_MS,
    sleepAt: now + FOX_SLEEP_AFTER_MS,
  };
}

export function isFoxSleepTokenCurrent(schedule: FoxSleepSchedule | null, token: number): boolean {
  return schedule !== null && schedule.token === token;
}

export function ambientFromDeadline(schedule: FoxSleepSchedule, now: number): Exclude<FoxAmbientPose, 'following-local'> {
  if (now >= schedule.sleepAt) return 'sleeping';
  if (now >= schedule.drowsyAt) return 'drowsy';
  return 'awake';
}

export function writeFoxCssVars(
  element: HTMLElement | null,
  prefix: 'follow' | 'drag' | 'session',
  offset: FoxFollowOffset | null,
): void {
  if (!element) return;
  if (!offset) {
    element.style.removeProperty(`--fox-${prefix}-x`);
    element.style.removeProperty(`--fox-${prefix}-y`);
    if (prefix !== 'session') {
      element.style.removeProperty(`--fox-${prefix}-rot`);
    }
    return;
  }
  element.style.setProperty(`--fox-${prefix}-x`, `${offset.x.toFixed(2)}px`);
  element.style.setProperty(`--fox-${prefix}-y`, `${offset.y.toFixed(2)}px`);
  if (prefix !== 'session') {
    element.style.setProperty(`--fox-${prefix}-rot`, `${offset.rot.toFixed(2)}deg`);
  }
}

type TimerHandle = unknown;
type SetTimeoutFn = (handler: () => void, timeout: number) => TimerHandle;
type ClearTimeoutFn = (handle: TimerHandle) => void;

export class FoxSleepClock {
  private token = 0;
  private timer: TimerHandle | null = null;
  private nested: TimerHandle | null = null;
  private schedule: FoxSleepSchedule | null = null;

  constructor(
    private readonly setTimeoutFn: SetTimeoutFn = (handler, timeout) => setTimeout(handler, timeout),
    private readonly clearTimeoutFn: ClearTimeoutFn = (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    private readonly nowFn: () => number = () => Date.now(),
  ) {}

  get currentToken(): number {
    return this.token;
  }

  get currentSchedule(): FoxSleepSchedule | null {
    return this.schedule;
  }

  start(onAmbient: (pose: Exclude<FoxAmbientPose, 'following-local'>) => void): number {
    this.clearTimers();
    const token = this.token + 1;
    this.token = token;
    const schedule = createFoxSleepSchedule(this.nowFn(), token);
    this.schedule = schedule;
    this.timer = this.setTimeoutFn(() => {
      if (!isFoxSleepTokenCurrent(this.schedule, token)) return;
      this.timer = null;
      const next = ambientFromDeadline(schedule, this.nowFn());
      onAmbient(next);
      if (next === 'sleeping') {
        return;
      }
      this.nested = this.setTimeoutFn(() => {
        if (!isFoxSleepTokenCurrent(this.schedule, token)) return;
        onAmbient('sleeping');
      }, Math.max(0, schedule.sleepAt - this.nowFn()));
    }, Math.max(0, schedule.drowsyAt - this.nowFn()));
    return token;
  }

  invalidate(): number {
    this.clearTimers();
    this.schedule = null;
    this.token += 1;
    return this.token;
  }

  dispose(): number {
    return this.invalidate();
  }

  private clearTimers(): void {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    if (this.nested !== null) {
      this.clearTimeoutFn(this.nested);
      this.nested = null;
    }
  }
}
