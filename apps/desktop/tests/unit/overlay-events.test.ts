import { describe, expect, it } from 'vitest';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  activateSearchCommand,
  collapseQueryCommand,
  foxDragSettledCommand,
  foxEdgeCommand,
  isFoxDragSettleAck,
  isFoxVisualTransform,
  isOverlayCommand,
  prepareSearchCommand,
  selectAuthoritativeFoxDockSnapshot,
  shortcutStatusCommand,
  syncFoxEdgeCommand,
  syncQueryAnchorCommand,
} from '../../src/shared/overlay-events';

describe('overlay command boundary', () => {
  it('accepts only complete fox drag settle acknowledgements', () => {
    expect(isFoxDragSettleAck({
      edge: 'left',
      epoch: 4,
      settleId: 9,
      generation: 2,
    })).toBe(true);
    expect(isFoxDragSettleAck({ edge: 'left', epoch: 4 })).toBe(false);
    expect(isFoxDragSettleAck({
      edge: 'outside',
      epoch: 4,
      settleId: 9,
      generation: 2,
    })).toBe(false);
    expect(isFoxDragSettleAck({ edge: 'left', epoch: 4, settleId: 0, generation: 2 })).toBe(false);
    expect(isFoxDragSettleAck({ edge: 'left', epoch: 4, settleId: 9, generation: 0 })).toBe(false);
  });

  it('selects the latest fox dock snapshot and keeps a tied preferred ACK', () => {
    expect(selectAuthoritativeFoxDockSnapshot(
      { edge: 'left', epoch: 11 },
      { edge: 'right', epoch: 10 },
    )).toEqual({ edge: 'left', epoch: 11 });
    expect(selectAuthoritativeFoxDockSnapshot(
      { edge: 'left', epoch: 11 },
      { edge: 'right', epoch: 11 },
    )).toEqual({ edge: 'left', epoch: 11 });
    expect(selectAuthoritativeFoxDockSnapshot(
      { edge: 'left', epoch: 11 },
      { edge: 'right', epoch: 12 },
    )).toEqual({ edge: 'right', epoch: 12 });
    expect(selectAuthoritativeFoxDockSnapshot(null, { edge: 'right', epoch: 8 })).toEqual({
      edge: 'right',
      epoch: 8,
    });
    expect(selectAuthoritativeFoxDockSnapshot(undefined)).toBeNull();
  });

  it('requires explicit animation intent and an anchor for chrome handoffs', () => {
    expect(
      isOverlayCommand({
        type: 'prepare-search',
        handoffId: 1,
        anchor: 'left',
        handoffCenterX: -8,
        handoffCenterY: 44,
        foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
      }),
    ).toBe(true);
    expect(isOverlayCommand({ type: 'activate-search', anchor: 'left', animate: true })).toBe(true);
    expect(
      isOverlayCommand({ type: 'activate-search', handoffId: 2, anchor: 'right', animate: true }),
    ).toBe(true);
    expect(isOverlayCommand({ type: 'activate-search', anchor: 'right', animate: false })).toBe(true);
    expect(isOverlayCommand({
      type: 'collapse',
      anchor: 'left',
      dockEdge: 'none',
      animate: true,
      handoffCenterX: 44,
      handoffCenterY: 44,
    })).toBe(true);
    expect(isOverlayCommand({
      type: 'query-layout-ack',
      sessionId: 1,
      sequence: 2,
      phase: 'RESULTS',
      resultCount: 3,
      height: 312,
      resizeEdge: 'bottom',
    })).toBe(true);
    expect(isOverlayCommand({
      type: 'query-layout-ack',
      sessionId: 1,
      sequence: 2,
      height: 312,
      resizeEdge: 'bottom',
    })).toBe(false);
    expect(isOverlayCommand({
      type: 'query-layout-ack',
      sessionId: 1,
      sequence: 2,
      phase: 'RESULTS',
      resultCount: 3,
      height: 312,
      resizeEdge: 'bottom',
      width: 800,
    })).toBe(false);
    expect(isOverlayCommand({ type: 'sync-fox-edge', edge: 'right', epoch: 3 })).toBe(true);
    expect(isOverlayCommand({
      type: 'fox-drag-settled',
      edge: 'right',
      epoch: 4,
      settleId: 3,
      generation: 2,
    })).toBe(true);
    expect(isOverlayCommand({ type: 'sync-query-anchor', anchor: 'right' })).toBe(true);

    expect(isOverlayCommand({ type: 'activate-search', anchor: 'left' })).toBe(false);
    expect(
      isOverlayCommand({
        type: 'prepare-search',
        handoffId: 0,
        anchor: 'left',
        handoffCenterX: -8,
        handoffCenterY: 44,
        foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
      }),
    ).toBe(false);
    expect(
      isOverlayCommand({
        type: 'prepare-search',
        handoffId: 1,
        anchor: 'left',
        handoffCenterX: Number.NaN,
        handoffCenterY: 44,
        foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
      }),
    ).toBe(false);
    expect(isOverlayCommand({ type: 'collapse' })).toBe(false);
    expect(isOverlayCommand({
      type: 'collapse',
      anchor: 'left',
      dockEdge: 'none',
      animate: true,
    })).toBe(false);
    expect(isOverlayCommand({ type: 'collapse', anchor: 'center', dockEdge: 'none', animate: true })).toBe(false);
    expect(isOverlayCommand({ type: 'collapse', anchor: 'right', dockEdge: 'none', animate: 'yes' })).toBe(false);
    expect(isOverlayCommand({ type: 'collapse', anchor: 'right', dockEdge: 'outside', animate: true })).toBe(false);
    expect(isOverlayCommand({ type: 'sync-fox-edge', edge: 'outside', epoch: 3 })).toBe(false);
    expect(isOverlayCommand({
      type: 'fox-drag-settled',
      edge: 'right',
      epoch: 4,
      settleId: 0,
      generation: 2,
    })).toBe(false);
    expect(isOverlayCommand({ type: 'sync-query-anchor', anchor: 'center' })).toBe(false);
  });

  it('builds overlay command payloads that stay inside the existing protocol', () => {
    const prepare = prepareSearchCommand({
      handoffId: 1,
      anchor: 'left',
      handoffCenterX: -8,
      handoffCenterY: 44,
      foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
    });
    expect(prepare).toEqual({
      type: 'prepare-search',
      handoffId: 1,
      anchor: 'left',
      handoffCenterX: -8,
      handoffCenterY: 44,
      foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
    });
    expect(isOverlayCommand(prepare)).toBe(true);
    expect(activateSearchCommand('right', false)).toEqual({
      type: 'activate-search',
      anchor: 'right',
      animate: false,
    });
    expect(activateSearchCommand('left', true, 7)).toEqual({
      type: 'activate-search',
      anchor: 'left',
      animate: true,
      handoffId: 7,
    });
    expect(isOverlayCommand(activateSearchCommand('left', true, 7))).toBe(true);
    expect(collapseQueryCommand({
      handoffId: 3,
      anchor: 'right',
      dockEdge: 'left',
      animate: true,
      handoffCenterX: 32,
      handoffCenterY: 44,
    })).toEqual({
      type: 'collapse',
      handoffId: 3,
      anchor: 'right',
      dockEdge: 'left',
      animate: true,
      handoffCenterX: 32,
      handoffCenterY: 44,
    });
    expect(foxEdgeCommand('right', 4)).toEqual({ type: 'fox-edge', edge: 'right', epoch: 4 });
    expect(syncFoxEdgeCommand('none', 5)).toEqual({ type: 'sync-fox-edge', edge: 'none', epoch: 5 });
    expect(syncQueryAnchorCommand('left')).toEqual({ type: 'sync-query-anchor', anchor: 'left' });
    expect(shortcutStatusCommand({
      registered: false,
      accelerator: 'CommandOrControl+Shift+Space',
      message: '快捷键注册失败',
    })).toEqual({
      type: 'shortcut-status',
      registered: false,
      accelerator: 'CommandOrControl+Shift+Space',
      message: '快捷键注册失败',
    });
    expect(foxDragSettledCommand({
      edge: 'left',
      epoch: 4,
      settleId: 9,
      generation: 2,
    })).toEqual({
      type: 'fox-drag-settled',
      edge: 'left',
      epoch: 4,
      settleId: 9,
      generation: 2,
    });
  });

  it('accepts only bounded, non-mirrored 2D fox visual matrices', () => {
    expect(IDENTITY_FOX_VISUAL_TRANSFORM).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(isFoxVisualTransform(IDENTITY_FOX_VISUAL_TRANSFORM)).toBe(true);
    const handed = { a: 1.06, b: 0.1, c: -0.1, d: 1.06, e: 6, f: -4 };
    expect(isFoxVisualTransform(handed)).toBe(true);
    expect(handed).toMatchObject({ a: 1.06, b: 0.1, c: -0.1, d: 1.06, e: 6, f: -4 });
    expect(isFoxVisualTransform({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false);
    expect(isFoxVisualTransform({ a: 1, b: 0, c: 0, d: 1, e: 49, f: 0 })).toBe(false);
    expect(isFoxVisualTransform({ a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false);
    expect(isFoxVisualTransform({ a: 1, b: 0, c: 0, d: 1, e: 0 })).toBe(false);
  });
});
