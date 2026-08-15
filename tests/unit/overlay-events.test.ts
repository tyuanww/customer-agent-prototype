import { describe, expect, it } from 'vitest';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  isFoxVisualTransform,
  isOverlayCommand,
} from '../../src/shared/overlay-events';

describe('overlay command boundary', () => {
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
    expect(isOverlayCommand({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: true })).toBe(true);

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
    expect(isOverlayCommand({ type: 'collapse', anchor: 'center', dockEdge: 'none', animate: true })).toBe(false);
    expect(isOverlayCommand({ type: 'collapse', anchor: 'right', dockEdge: 'none', animate: 'yes' })).toBe(false);
    expect(isOverlayCommand({ type: 'collapse', anchor: 'right', dockEdge: 'outside', animate: true })).toBe(false);
  });

  it('accepts only bounded, non-mirrored 2D fox visual matrices', () => {
    expect(isFoxVisualTransform(IDENTITY_FOX_VISUAL_TRANSFORM)).toBe(true);
    expect(isFoxVisualTransform({ a: 1.06, b: 0.1, c: -0.1, d: 1.06, e: 6, f: -4 })).toBe(true);
    expect(isFoxVisualTransform({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false);
    expect(isFoxVisualTransform({ a: 1, b: 0, c: 0, d: 1, e: 49, f: 0 })).toBe(false);
    expect(isFoxVisualTransform({ a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false);
  });
});
