import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  applyOverlayEvent,
  createInitialOverlayState,
  type OverlayState,
} from '../../src/shared/overlay-machine';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../../src/shared/overlay-events';

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function activeState(): OverlayState {
  const initial = createInitialOverlayState({
    sessionEpoch: 1,
    generation: 1,
    windowGeneration: 1,
    releaseId: 'rel_synthetic',
  });
  const opening = applyOverlayEvent(initial, {
    type: 'OPEN_REQUESTED',
    sessionEpoch: 1,
    generation: 1,
    windowGeneration: 1,
    anchor: 'left',
    dockEdge: 'none',
    queryBounds: { x: 20, y: 100, width: 600, height: 88 },
    foxBounds: { x: 20, y: 100, width: 88, height: 88 },
    handoffCenterX: 250,
    handoffCenterY: 44,
    foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
    animate: false,
  });
  const armed = applyOverlayEvent(opening.state, {
    type: 'HANDOFF_ARMED',
    sessionEpoch: 1,
    generation: opening.state.generation,
    windowGeneration: 1,
    handoffId: opening.state.handoff.id,
  });
  return applyOverlayEvent(armed.state, {
    type: 'HANDOFF_OPENED',
    sessionEpoch: 1,
    generation: armed.state.generation,
    windowGeneration: 1,
    handoffId: armed.state.handoff.id,
  }).state;
}

describe('authoritative reducer performance', () => {
  it('dispatches 500 synthetic content events with p95 below 2 ms', () => {
    let state = activeState();
    const coldStarted = performance.now();
    const cold = applyOverlayEvent(state, {
      type: 'CONTENT_CHANGED',
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentPhase: 'RESULTS',
      resultCount: 3,
    });
    const coldMs = performance.now() - coldStarted;
    state = cold.state;

    for (let index = 0; index < 50; index += 1) {
      const transition = applyOverlayEvent(state, {
        type: 'CONTENT_CHANGED',
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration,
        contentPhase: index % 2 === 0 ? 'RESULTS' : 'EMPTY',
        resultCount: index % 2 === 0 ? 3 : 0,
      });
      state = transition.state;
    }

    const samples: number[] = [];
    let errors = 0;
    for (let index = 0; index < 500; index += 1) {
      const started = performance.now();
      try {
        const transition = applyOverlayEvent(state, {
          type: 'CONTENT_CHANGED',
          sessionEpoch: state.sessionEpoch,
          generation: state.generation,
          windowGeneration: state.windowGeneration,
          contentPhase: index % 3 === 0 ? 'RESULTS' : index % 3 === 1 ? 'EMPTY' : 'ERROR',
          resultCount: index % 3 === 0 ? 3 : 0,
        });
        if (transition.decision !== 'applied') {
          errors += 1;
        }
        state = transition.state;
      } catch {
        errors += 1;
      }
      samples.push(performance.now() - started);
    }

    const sorted = samples.sort((left, right) => left - right);
    const metrics = {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      coldMs,
      warm: '50-event warmup before measurement',
      inputScale: samples.length,
      errors,
      environment: `${process.platform}/${process.arch} Node ${process.version}`,
      limiter: 'pure in-memory reducer; no timers, filesystem, IPC or DOM',
    };
    console.log(`OVL_REDUCER_PERF ${JSON.stringify(metrics)}`);
    expect(metrics.p95).toBeLessThan(2);
    expect(metrics.errors).toBe(0);
  });
});
