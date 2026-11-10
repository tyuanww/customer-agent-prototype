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
    let deadline = schedule.drowsyAt;
    const advance = (): void => {
      if (!isFoxSleepTokenCurrent(this.schedule, token)) return;
      this.timer = null;
      const now = this.nowFn();
      if (now >= deadline) {
        const next = ambientFromDeadline(schedule, now);
        onAmbient(next);
        if (next === 'sleeping' || !isFoxSleepTokenCurrent(this.schedule, token)) return;
        deadline = schedule.sleepAt;
      }
      // Browser timers can run before a fractional performance.now deadline.
      // Recheck that deadline before advancing or queuing the next phase.
      this.timer = this.setTimeoutFn(advance, Math.max(1, Math.ceil(deadline - this.nowFn())));
    };
    advance();
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
  }
}
