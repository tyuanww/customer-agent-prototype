import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOX_ANNOYED_DRAG_AFTER_MS,
  FOX_ANNOYED_DRAG_DISTANCE_PX,
  FOX_ANNOYED_DRAG_DURATION_MS,
  FOX_DRAG_SETTLE_WATCHDOG_MS,
  FOX_DROWSY_AFTER_MS,
  FOX_FOLLOW_MAX_DEG,
  FOX_FOLLOW_MAX_PX,
  FOX_SLEEP_AFTER_MS,
  FoxSleepClock,
  ambientFromDeadline,
  clampLocalFollow,
  computeDragReaction,
  createFoxSleepSchedule,
  isFoxSleepTokenCurrent,
  resolveFoxExpression,
  resolveFoxPose,
  resolveFoxStructuralPose,
  shouldEnterAnnoyedDrag,
  shouldShowFoxHeadsetSignal,
  writeFoxCssVars,
  type FoxAmbientPose,
  type FoxResolvedPose,
  type FoxStructuralPose,
  type FoxTransientPose,
} from '../../src/shared/fox-presence';
import {
  FOX_CLOSED_LID,
  FOX_EYE_ROI,
  FOX_SLEEP_POSE_SCALE_X,
  FOX_SLEEP_POSE_SCALE_Y,
  measureClosedLidInSleepPose,
  quadraticArcDepth,
} from '../../src/renderer/components/FoxHead';
import { findTransitionAllRisks } from './helpers/css-transition-all-guard';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'src/renderer/styles/app.css'), 'utf8');
const foxApp = readFileSync(path.join(root, 'src/renderer/FoxApp.tsx'), 'utf8');
const foxHead = readFileSync(path.join(root, 'src/renderer/components/FoxHead.tsx'), 'utf8');
const presenceHook = readFileSync(path.join(root, 'src/renderer/lib/use-fox-presence.ts'), 'utf8');
const dragHook = readFileSync(path.join(root, 'src/renderer/lib/use-window-drag.ts'), 'utf8');
const queryApp = [
  readFileSync(path.join(root, 'src/renderer/QueryApp.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/features/search/QueryCapsule.tsx'), 'utf8'),
].join('\n');

const STRUCTURAL: FoxStructuralPose[] = ['handoff', 'snap', 'peek', 'retract', 'dragging', 'none'];
const TRANSIENT: FoxTransientPose[] = ['none', 'pressed', 'dragging', 'annoyed-drag'];
const AMBIENT: FoxAmbientPose[] = ['awake', 'following-local', 'drowsy', 'sleeping'];

function extractKeyframes(source: string, name: string): string {
  const start = source.indexOf(`@keyframes ${name}`);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

describe('fox presence resolver', () => {
  it('keeps the structural stack above transient, ambient, warning, and reduced motion', () => {
    const table: Array<{
      name: string;
      input: Parameters<typeof resolveFoxPose>[0];
      expected: FoxResolvedPose;
    }> = [
      {
        name: 'handoff beats everything',
        input: {
          reducedMotion: true,
          warning: true,
          structural: 'handoff',
          transient: 'annoyed-drag',
          ambient: 'sleeping',
        },
        expected: 'handoff',
      },
      {
        name: 'snap beats peek and drag',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'snap',
          transient: 'dragging',
          ambient: 'following-local',
        },
        expected: 'snap',
      },
      {
        name: 'peek beats retract and drag',
        input: {
          reducedMotion: false,
          warning: true,
          structural: 'peek',
          transient: 'annoyed-drag',
          ambient: 'drowsy',
        },
        expected: 'peek',
      },
      {
        name: 'retract beats dragging',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'retract',
          transient: 'dragging',
          ambient: 'awake',
        },
        expected: 'retract',
      },
      {
        name: 'annoyed-drag beats plain dragging',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'dragging',
          transient: 'annoyed-drag',
          ambient: 'following-local',
        },
        expected: 'annoyed-drag',
      },
      {
        name: 'transient dragging wins over ambient',
        input: {
          reducedMotion: true,
          warning: true,
          structural: 'none',
          transient: 'dragging',
          ambient: 'sleeping',
        },
        expected: 'dragging',
      },
      {
        name: 'pressed wins over sleep and reduced motion',
        input: {
          reducedMotion: true,
          warning: true,
          structural: 'none',
          transient: 'pressed',
          ambient: 'sleeping',
        },
        expected: 'pressed',
      },
      {
        name: 'reduced motion freezes ambient',
        input: {
          reducedMotion: true,
          warning: false,
          structural: 'none',
          transient: 'none',
          ambient: 'following-local',
        },
        expected: 'static',
      },
      {
        name: 'warning pauses ambient',
        input: {
          reducedMotion: false,
          warning: true,
          structural: 'none',
          transient: 'none',
          ambient: 'sleeping',
        },
        expected: 'warning',
      },
      {
        name: 'local follow is ambient only',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'none',
          transient: 'none',
          ambient: 'following-local',
        },
        expected: 'following-local',
      },
      {
        name: 'drowsy is below follow',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'none',
          transient: 'none',
          ambient: 'drowsy',
        },
        expected: 'drowsy',
      },
      {
        name: 'sleeping is below drowsy',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'none',
          transient: 'none',
          ambient: 'sleeping',
        },
        expected: 'sleeping',
      },
      {
        name: 'default awake is idle',
        input: {
          reducedMotion: false,
          warning: false,
          structural: 'none',
          transient: 'none',
          ambient: 'awake',
        },
        expected: 'idle',
      },
    ];

    for (const row of table) {
      expect(resolveFoxPose(row.input), row.name).toBe(row.expected);
    }
  });

  it('covers the full structural × transient × ambient grid without unordered boolean collapse', () => {
    for (const structural of STRUCTURAL) {
      for (const transient of TRANSIENT) {
        for (const ambient of AMBIENT) {
          const pose = resolveFoxPose({
            reducedMotion: false,
            warning: false,
            structural,
            transient,
            ambient,
          });
          if (structural === 'handoff') expect(pose).toBe('handoff');
          else if (structural === 'snap') expect(pose).toBe('snap');
          else if (structural === 'peek') expect(pose).toBe('peek');
          else if (structural === 'retract') expect(pose).toBe('retract');
          else if (structural === 'dragging' || transient === 'dragging' || transient === 'annoyed-drag') {
            expect(pose).toBe(transient === 'annoyed-drag' ? 'annoyed-drag' : 'dragging');
          } else if (transient === 'pressed') expect(pose).toBe('pressed');
          else if (ambient === 'following-local') expect(pose).toBe('following-local');
          else if (ambient === 'drowsy') expect(pose).toBe('drowsy');
          else if (ambient === 'sleeping') expect(pose).toBe('sleeping');
          else expect(pose).toBe('idle');
        }
      }
    }
  });

  it('resolves structural flags with handoff > snap > peek > retract > dragging', () => {
    expect(resolveFoxStructuralPose({
      handoff: true,
      snap: true,
      peek: true,
      retract: true,
      dragging: true,
    })).toBe('handoff');
    expect(resolveFoxStructuralPose({
      handoff: false,
      snap: true,
      peek: true,
      retract: true,
      dragging: true,
    })).toBe('snap');
    expect(resolveFoxStructuralPose({
      handoff: false,
      snap: false,
      peek: true,
      retract: true,
      dragging: true,
    })).toBe('peek');
    expect(resolveFoxStructuralPose({
      handoff: false,
      snap: false,
      peek: false,
      retract: true,
      dragging: true,
    })).toBe('retract');
    expect(resolveFoxStructuralPose({
      handoff: false,
      snap: false,
      peek: false,
      retract: false,
      dragging: true,
    })).toBe('dragging');
    expect(resolveFoxStructuralPose({
      handoff: false,
      snap: false,
      peek: false,
      retract: false,
      dragging: false,
    })).toBe('none');
  });

  it('keeps reduced-motion sleep semantic while freezing awake ambient motion', () => {
    expect(resolveFoxPose({
      reducedMotion: true,
      warning: false,
      structural: 'none',
      transient: 'none',
      ambient: 'awake',
    })).toBe('static');
    expect(resolveFoxPose({
      reducedMotion: true,
      warning: false,
      structural: 'none',
      transient: 'none',
      ambient: 'drowsy',
    })).toBe('drowsy');
    expect(resolveFoxPose({
      reducedMotion: true,
      warning: false,
      structural: 'none',
      transient: 'none',
      ambient: 'sleeping',
    })).toBe('sleeping');
  });

  it('derives one mutually exclusive central-eye expression from the pose stack', () => {
    expect(resolveFoxExpression({
      warning: false,
      structural: 'none',
      transient: 'none',
      ambient: 'awake',
    })).toBe('none');
    expect(resolveFoxExpression({
      warning: false,
      structural: 'none',
      transient: 'none',
      ambient: 'drowsy',
    })).toBe('drowsy');
    expect(resolveFoxExpression({
      warning: false,
      structural: 'none',
      transient: 'none',
      ambient: 'sleeping',
    })).toBe('closed');
    expect(resolveFoxExpression({
      warning: false,
      structural: 'dragging',
      transient: 'dragging',
      ambient: 'sleeping',
    })).toBe('strained');
    expect(resolveFoxExpression({
      warning: true,
      structural: 'dragging',
      transient: 'dragging',
      ambient: 'sleeping',
    })).toBe('strained');
    expect(resolveFoxExpression({
      warning: true,
      structural: 'none',
      transient: 'none',
      ambient: 'sleeping',
    })).toBe('none');
    expect(resolveFoxExpression({
      warning: false,
      structural: 'handoff',
      transient: 'none',
      ambient: 'sleeping',
    })).toBe('none');
  });

  it('limits the headset signal to local follow or a just-woke awake frame', () => {
    const base = {
      reducedMotion: false,
      warning: false,
      structural: 'none' as const,
      transient: 'none' as const,
      justWoke: false,
    };
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'following-local' })).toBe(true);
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'awake', justWoke: true })).toBe(true);
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'sleeping', justWoke: true })).toBe(false);
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'following-local', reducedMotion: true })).toBe(false);
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'following-local', warning: true })).toBe(false);
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'following-local', structural: 'peek' })).toBe(false);
    expect(shouldShowFoxHeadsetSignal({ ...base, ambient: 'following-local', transient: 'dragging' })).toBe(false);
  });
});

describe('local whole-head follow clamp', () => {
  it('clamps pointer offsets to the local 1.5-2px / 2deg envelope', () => {
    expect(FOX_FOLLOW_MAX_PX).toBeGreaterThanOrEqual(1.5);
    expect(FOX_FOLLOW_MAX_PX).toBeLessThanOrEqual(2);
    expect(FOX_FOLLOW_MAX_DEG).toBeLessThanOrEqual(2);

    const center = clampLocalFollow(0, 0, 44, 44);
    expect(center).toEqual({ x: 0, y: 0, rot: 0 });

    const far = clampLocalFollow(400, -400, 44, 44);
    expect(far.x).toBeCloseTo(FOX_FOLLOW_MAX_PX);
    expect(far.y).toBeCloseTo(-FOX_FOLLOW_MAX_PX);
    expect(far.rot).toBeCloseTo(FOX_FOLLOW_MAX_DEG);

    const half = clampLocalFollow(22, 11, 44, 44);
    expect(half.x).toBeCloseTo(FOX_FOLLOW_MAX_PX / 2);
    expect(half.y).toBeCloseTo(FOX_FOLLOW_MAX_PX / 4);
    expect(half.rot).toBeCloseTo(FOX_FOLLOW_MAX_DEG / 2);
    expect(FOX_DRAG_SETTLE_WATCHDOG_MS).toBeGreaterThanOrEqual(1200);
    expect(FOX_DRAG_SETTLE_WATCHDOG_MS).toBeLessThanOrEqual(2000);
  });

  it('does not invent eye-tracking language or a global cursor sample', () => {
    expect(foxApp).not.toMatch(/eye tracking|eyeball|globalThis\.screenX|setInterval/i);
    expect(presenceHook).not.toMatch(/setInterval/);
    expect(presenceHook).toContain('requestAnimationFrame');
    expect(presenceHook).toContain('cancelAnimationFrame');
  });
});

describe('drag reaction and annoyed-drag thresholds', () => {
  it('tilts with drag direction and only becomes annoyed after time or distance', () => {
    const left = computeDragReaction(-80, 10);
    const right = computeDragReaction(80, -40);
    expect(left.rot).toBeLessThan(0);
    expect(right.rot).toBeGreaterThan(0);
    expect(right.y).toBeLessThan(left.y);

    expect(shouldEnterAnnoyedDrag({ elapsedMs: FOX_ANNOYED_DRAG_AFTER_MS - 1, distancePx: 10 })).toBe(false);
    expect(shouldEnterAnnoyedDrag({ elapsedMs: FOX_ANNOYED_DRAG_AFTER_MS, distancePx: 10 })).toBe(true);
    expect(shouldEnterAnnoyedDrag({
      elapsedMs: 200,
      distancePx: FOX_ANNOYED_DRAG_DISTANCE_PX,
    })).toBe(true);
    expect(FOX_ANNOYED_DRAG_DURATION_MS).toBeGreaterThanOrEqual(1000);
    expect(FOX_ANNOYED_DRAG_DURATION_MS).toBeLessThanOrEqual(1400);
  });
});

describe('interruptible sleep clock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks awake to drowsy to sleeping on the deadline, not a 1Hz tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const seen: string[] = [];
    const clock = new FoxSleepClock();
    const first = clock.start((pose) => {
      seen.push(pose);
    });
    expect(first).toBe(1);
    expect(clock.currentSchedule?.drowsyAt).toBe(1_000 + FOX_DROWSY_AFTER_MS);
    expect(clock.currentSchedule?.sleepAt).toBe(1_000 + FOX_SLEEP_AFTER_MS);
    expect(ambientFromDeadline(clock.currentSchedule!, 1_000)).toBe('awake');

    vi.advanceTimersByTime(FOX_DROWSY_AFTER_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['drowsy']);
    expect(ambientFromDeadline(clock.currentSchedule!, Date.now())).toBe('drowsy');

    vi.advanceTimersByTime(FOX_SLEEP_AFTER_MS - FOX_DROWSY_AFTER_MS - 1);
    expect(seen).toEqual(['drowsy']);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['drowsy', 'sleeping']);
  });

  it('invalidates stale tokens on activity, fox-edge, open, and unmount', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const clock = new FoxSleepClock();
    const stale = clock.start((pose) => {
      seen.push(`stale:${pose}`);
    });
    const next = clock.invalidate();
    expect(next).toBeGreaterThan(stale);
    expect(isFoxSleepTokenCurrent(clock.currentSchedule, stale)).toBe(false);

    clock.start((pose) => {
      seen.push(`live:${pose}`);
    });
    vi.advanceTimersByTime(FOX_SLEEP_AFTER_MS);
    expect(seen).toEqual(['live:drowsy', 'live:sleeping']);

    clock.dispose();
    vi.advanceTimersByTime(FOX_SLEEP_AFTER_MS);
    expect(seen).toEqual(['live:drowsy', 'live:sleeping']);
  });

  it('creates independent deadline snapshots so an old callback cannot leak', () => {
    const first = createFoxSleepSchedule(0, 3);
    const second = createFoxSleepSchedule(50, 4);
    expect(isFoxSleepTokenCurrent(first, 4)).toBe(false);
    expect(isFoxSleepTokenCurrent(second, 4)).toBe(true);
    expect(ambientFromDeadline(first, FOX_DROWSY_AFTER_MS)).toBe('drowsy');
    expect(ambientFromDeadline(first, FOX_SLEEP_AFTER_MS)).toBe('sleeping');
  });

  it('skips the stale drowsy frame when a throttled callback arrives after the sleep deadline', () => {
    let now = 0;
    const deadlines: Array<() => void> = [];
    const seen: string[] = [];
    const clock = new FoxSleepClock(
      (handler) => {
        deadlines.push(handler);
        return handler;
      },
      () => undefined,
      () => now,
    );

    clock.start((pose) => {
      seen.push(pose);
    });
    now = FOX_SLEEP_AFTER_MS + 250;
    deadlines[0]?.();

    expect(seen).toEqual(['sleeping']);
  });
});

describe('presence CSS and source contracts', () => {
  it('keeps new motion on transform/opacity and leaves crop/image/query business poses alone', () => {
    const annoyed = extractKeyframes(css, 'fox-annoyed-drag');
    expect(annoyed).toContain('transform:');
    expect(annoyed).not.toMatch(/\bfilter:|\bbox-shadow:|\bbackdrop-filter:|\bclip-path:|\bleft:|\btop:/);

    expect(css).toContain(".fox-idle[data-fox-pose='pressed'] .fox-head");
    expect(css).toContain('scale(1.08, 0.84)');
    expect(css).toContain(".fox-idle[data-fox-pose='dragging'] .fox-head");
    expect(css).toContain('var(--fox-session-x, 0px)');
    expect(css).toContain(".fox-idle[data-fox-pose='annoyed-drag'] .fox-head");
    expect(css).toContain(".fox-idle[data-fox-pose='drowsy'] .fox-head");
    expect(css).not.toContain('fox-slit-drowsy');
    expect(css).toContain(".fox-idle[data-fox-pose='sleeping'] .fox-head");
    expect(css).toContain('translate(1.5px, 6.5px) rotate(-10deg) scale(1.06, 0.82)');
    expect(css).toContain('translate(-1.5px, 6.5px) rotate(10deg) scale(1.06, 0.82)');
    expect(css).toContain('fox-zzz');
    expect(css).toContain('.fox-ground-shadow');
    expect(css).toContain('scale(1.45, 0.64)');
    expect(foxHead).not.toContain('fox-ground-shadow');
    expect(foxApp).toContain('data-testid="fox-ground-shadow"');
    expect(css.match(/\.fox-head\s*\{([^}]*)\}/)?.[1] ?? '').not.toContain('filter:');
    expect(css).toMatch(/\.fox-idle \.fox-head\s*\{[\s\S]*?drop-shadow/);
    expect(css).toContain('.fox-expression-layer');
    expect(css).toContain(".fox-expression-layer[data-expression-state='awake'] .fox-expression-cover");
    expect(css).toContain(".fox-expression-layer[data-expression-state='awake'] .fox-expression-mark");
    const awakeGate = css.match(
      /\.fox-expression-layer\[data-expression-state='awake'\] \.fox-expression-cover,\s*\n\.fox-expression-layer\[data-expression-state='awake'\] \.fox-expression-mark\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(awakeGate).toMatch(/opacity:\s*0/);
    expect(awakeGate).toMatch(/transition:\s*none/);
    expect(awakeGate).toMatch(/transition-duration:\s*0s/);
    expect(css).toMatch(/\.fox-expression-cover\s*\{[\s\S]*?opacity: 0/);
    expect(css).toContain(".fox-expression-layer[data-expression-state='drowsy'] .fox-expression-cover");
    expect(css).toContain(".fox-expression-layer[data-expression-state='closed'] .fox-expression-cover");
    expect(css).toContain(".fox-expression-layer[data-expression-state='strained'] .fox-expression-cover");
    expect(css).toContain(".fox-expression-layer[data-expression-state='drowsy'] .fox-expression-mark.is-drowsy");
    expect(css).toContain(".fox-expression-layer[data-expression-state='closed'] .fox-expression-mark.is-closed");
    expect(css).toContain(".fox-expression-layer[data-expression-state='strained'] .fox-expression-mark");
    expect(css).toContain('--fox-expression-duration: 280ms');
    expect(css).toContain('--fox-expression-duration: 320ms');
    expect(css).toContain('.fox-headset-signal');
    expect(foxHead).toContain('viewBox="0 0 64 64"');
    expect(foxHead).toContain("expression === 'none' ? 'awake' : expression");
    expect(foxHead).toContain('data-testid="fox-expression-awake"');
    expect(foxHead).toContain('data-testid="fox-expression-drowsy"');
    expect(foxHead).toContain('data-testid="fox-expression-closed"');
    expect(foxHead).toContain('data-testid="fox-expression-strained"');
    expect(foxHead).toContain('fill="#F9D6C5"');
    expect(foxHead).toContain('fill="#A45C4A"');
    expect(foxHead).toContain('stroke="#A45C4A"');
    expect(foxHead).toContain('M25 45.8 L28.2 47.8 L25 49.8');
    expect(foxHead).toContain('M34.4 45.8 L31.2 47.8 L34.4 49.8');
    expect(foxHead).not.toContain('cy="46.6"');
    expect(foxHead).not.toContain('rx="3.6"');
    expect(foxHead).not.toMatch(/fill=["'](?:white|#fff(?:fff)?)["']/i);
    expect(css).not.toContain('.fox-eye-slit');
    expect(css).not.toContain('.fox-visor-layer');
    expect(css).not.toContain('.fox-eye-glint');
    expect(css).not.toContain('.fox-eyelid');
    expect(css).toContain('.fox-idle .fox-button:focus-visible');
    expect(css).toContain('outline: none');
    expect(css).toContain('.fox-focus-ring');
    expect(css).toContain("[data-fox-keyboard-focus='true'][data-fox-drag-session='left'] .fox-focus-ring");
    expect(css).toContain("[data-fox-keyboard-focus='true'][data-fox-settling='true'] .fox-focus-ring");
    expect(css).not.toMatch(/\.fox-button:focus-visible \.fox-focus-ring\s*\{[\s\S]*?opacity:\s*1/);
    expect(css).toContain('.capsule-fox:focus-visible .fox-focus-ring');
    expect(queryApp).toContain('query-fox-focus-ring');
    expect(css).not.toContain('box-shadow: 0 0 0 2px var(--focus)');
    expect(css).toMatch(/\.fox-idle\[data-fox-pose='sleeping'\] \.fox-sleep-mark\s*\{[\s\S]*?opacity: 0\.86/);
    expect(css).toMatch(/\.fox-sleep-mark\s*\{[\s\S]*?font-size: 11px;[\s\S]*?line-height: 11px;/);
    expect(css).toMatch(/\.fox-ground-shadow\s*\{[\s\S]*?opacity: 0\.52/);
    expect(css).toMatch(/\.fox-ground-shadow\s*\{[\s\S]*?transform 300ms[\s\S]*?opacity 300ms/);
    expect(css).toMatch(/\[data-fox-pose='drowsy'\] \.fox-ground-shadow\s*\{[\s\S]*?transition-duration: 280ms/);
    expect(css).toMatch(/\[data-fox-pose='sleeping'\] \.fox-ground-shadow\s*\{[\s\S]*?transition-duration: 320ms/);
    expect(css).toContain('will-change: transform');
    expect(css).toMatch(/\.fox-idle\.is-docked-left\s*\{[\s\S]*transform: translateX/);
    expect(css).not.toMatch(/\.fox-idle\s*\{[^}]*animation:/);
    expect(css).not.toMatch(/\.fox-head-image[^{]*\{[^}]*animation:/);
    expect(css).not.toMatch(/\.fox-head-image[^{]*\{[^}]*transform:/);
    expect(css).toContain('.fox-idle.is-handoff-frozen .fox-head');
    expect(css).toContain('animation: none !important');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.fox-idle\[data-fox-pose='sleeping'\] \.fox-sleep-mark span\s*\{[\s\S]*?opacity: 0\.72/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.fox-expression-mark,[\s\S]*?transition: none !important/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.fox-idle\[data-fox-pose='sleeping'\] \.fox-head[\s\S]*?scale\(1\.06, 0\.82\)/);
    expect(queryApp).toContain('is-query-${foxVisualState.toLowerCase()}');
    expect(queryApp).toContain("'SEARCHING'");
    expect(queryApp).toContain("'RESULTS'");
    expect(queryApp).toContain("'EMPTY'");
    expect(queryApp).toContain("'COPIED'");
    expect(queryApp).not.toContain('data-fox-pose');
    expect(queryApp).not.toContain('following-local');
    expect(queryApp).not.toContain('expression=');
    expect(queryApp).not.toContain('headsetSignal=');
    expect(findTransitionAllRisks(css)).toEqual([]);
  });

  it('keeps the sleeping closed lid readable after the 64px sleep pose transform', () => {
    expect(css).toContain(`scale(${FOX_SLEEP_POSE_SCALE_X}, ${FOX_SLEEP_POSE_SCALE_Y})`);
    expect(foxHead).toContain(`strokeWidth={FOX_CLOSED_LID.strokeWidth}`);
    expect(foxHead).toContain('data-testid="fox-expression-closed-lid"');
    expect(foxHead).toContain('data-testid="fox-expression-closed-stem"');
    expect(foxHead).toMatch(/is-closed[\s\S]*fill="none"[\s\S]*stroke="#A45C4A"/);

    const independent = {
      visibleWidth: (FOX_CLOSED_LID.rightX - FOX_CLOSED_LID.leftX) * FOX_SLEEP_POSE_SCALE_X,
      arcDepth: quadraticArcDepth(FOX_CLOSED_LID.lidY, FOX_CLOSED_LID.controlY) * FOX_SLEEP_POSE_SCALE_Y,
      strokeThickness: FOX_CLOSED_LID.strokeWidth * FOX_SLEEP_POSE_SCALE_Y,
      stemLength: (FOX_CLOSED_LID.stemEndY - FOX_CLOSED_LID.stemStartY) * FOX_SLEEP_POSE_SCALE_Y,
    };
    const measured = measureClosedLidInSleepPose();
    expect(measured).toEqual(independent);
    expect(measured.visibleWidth).toBeGreaterThanOrEqual(9);
    expect(measured.arcDepth).toBeGreaterThanOrEqual(2);
    expect(measured.strokeThickness).toBeGreaterThanOrEqual(1.25);
    expect(measured.stemLength).toBeGreaterThanOrEqual(2.3);
    expect(measured.stemLength).toBeLessThanOrEqual(3);
    expect(FOX_CLOSED_LID.lidY).toBeGreaterThan(FOX_EYE_ROI.minY);
    expect(FOX_CLOSED_LID.lidY).toBeLessThan(47);
    expect(FOX_CLOSED_LID.leftX).toBeGreaterThan(FOX_EYE_ROI.minX);
    expect(FOX_CLOSED_LID.rightX).toBeLessThan(FOX_EYE_ROI.maxX);
    expect(FOX_CLOSED_LID.stemEndY).toBeLessThanOrEqual(FOX_EYE_ROI.maxY);

    const lidPath = foxHead.match(
      /data-testid="fox-expression-closed-lid"\s*d=\{`([^`]+)`\}/,
    )?.[1] ?? '';
    expect(lidPath).toBe(
      `M\${FOX_CLOSED_LID.leftX} \${FOX_CLOSED_LID.lidY} Q\${FOX_CLOSED_LID.controlX} \${FOX_CLOSED_LID.controlY} \${FOX_CLOSED_LID.rightX} \${FOX_CLOSED_LID.lidY}`,
    );

    const headsetBlock = foxHead.match(/className="fox-headset-signal"[\s\S]*?<\/svg>/)?.[0] ?? '';
    const headsetXs = [...headsetBlock.matchAll(/[MQ](-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    expect(headsetXs.length).toBeGreaterThan(0);
    expect(headsetXs.every((x) => x < FOX_EYE_ROI.minX || x > FOX_EYE_ROI.maxX)).toBe(true);
  });

  it('does not import ZIP assets, AGPL sources, or paint-heavy presence loops', () => {
    const scanned = [css, foxApp, presenceHook, dragHook];
    for (const source of scanned) {
      expect(source).not.toMatch(/clawd|clawd-on-desk|AGPL-3\.0/i);
      expect(source).not.toMatch(/assets\/.+\.(svg|gif|ico)/i);
      expect(source).not.toContain('setInterval');
      expect(source).not.toMatch(/transition\s*:\s*all/i);
    }
    expect(css).not.toMatch(/@keyframes fox-annoyed-drag[\s\S]{0,400}infinite/);
    const headsetWave = extractKeyframes(css, 'fox-headset-wave');
    expect(headsetWave).toContain('opacity:');
    expect(headsetWave).toContain('transform:');
    expect(headsetWave).not.toMatch(/\bfilter:|\bbox-shadow:|\bbackdrop-filter:|\bclip-path:|\bleft:|\btop:/);
    expect(css).toContain('fox-headset-wave 680ms cubic-bezier(0.22, 1, 0.36, 1) 2 both');
    expect(css).not.toMatch(/fox-headset-wave[^;]*infinite/);
    expect(foxApp).not.toContain('eye tracking');
    expect(foxApp).toContain("aria-label={shortcutFailed ? `打开话术查询。${hint}` : '打开话术查询'}");
    expect(foxApp).not.toContain('aria-live');
  });

  it('keeps the drag finish contract and uses the typed settle ack without renderer IPC access', () => {
    expect(dragHook).toContain("finishDrag(true, 'up')");
    expect(dragHook).toContain("finishDrag(false, 'cancel')");
    expect(dragHook).toContain("finishDrag(false, 'lost')");
    expect(dragHook).toContain("finishDrag(false, 'blur')");
    expect(dragHook).toContain("finishDrag(false, 'buttons0')");
    expect(foxApp).toContain('beginPendingSettle');
    expect(foxApp).toContain('data-fox-settling');
    expect(foxApp).toContain('startDockDragSession');
    expect(foxApp).toContain('commitDragSettleAck');
    expect(foxApp).toContain('FOX_DRAG_SETTLE_WATCHDOG_MS');
    expect(foxApp).toContain('clearSettleWatchdog');
    expect(presenceHook).toContain("document.visibilityState === 'hidden'");
    expect(presenceHook).toContain('clockRef.current?.invalidate()');
    expect(foxApp).toContain('pendingDragSyncRef');
    expect(foxApp).toContain('commitFoxDragSettle');
    expect(foxApp).not.toContain('openSearchRequested');
    expect(foxApp).not.toContain("transientRef.current === 'dragging' || transientRef.current === 'annoyed-drag'");
    expect(dragHook).toContain('event.ctrlKey');
    expect(dragHook).toContain('event.button > 0');
    expect(dragHook).toContain('event.detail === 0');
    expect(foxApp).not.toContain('customerAgent?.setFoxAmbient');
    expect(foxApp).not.toContain('ipcRenderer');
    expect(presenceHook).not.toContain('customerAgent');
  });
});

describe('css var writer', () => {
  it('writes and clears follow/drag custom properties without setState', () => {
    const props = new Map<string, string>();
    const element = {
      style: {
        setProperty(name: string, value: string) {
          props.set(name, value);
        },
        removeProperty(name: string) {
          props.delete(name);
        },
      },
    } as unknown as HTMLElement;

    writeFoxCssVars(element, 'follow', { x: 1.5, y: -0.5, rot: 1.25 });
    expect(props.get('--fox-follow-x')).toBe('1.50px');
    expect(props.get('--fox-follow-y')).toBe('-0.50px');
    expect(props.get('--fox-follow-rot')).toBe('1.25deg');
    writeFoxCssVars(element, 'session', { x: -34, y: 0, rot: 0 });
    expect(props.get('--fox-session-x')).toBe('-34.00px');
    writeFoxCssVars(element, 'follow', null);
    writeFoxCssVars(element, 'session', null);
    expect(props.size).toBe(0);
  });
});
