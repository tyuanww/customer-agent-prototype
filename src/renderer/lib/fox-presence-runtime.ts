import {
  ambientFromDeadline,
  createFoxSleepSchedule,
  isFoxSleepTokenCurrent,
  type FoxAmbientPose,
  type FoxFollowOffset,
  type FoxSleepSchedule,
} from '@shared/fox-presence';

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

/** Owns the renderer-only timers that advance the pure shared sleep schedule. */
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
