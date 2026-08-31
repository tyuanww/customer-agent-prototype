import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOX_HALO_DURATION_MS,
  FOX_HALO_OPACITY_MAX,
  FOX_HALO_OPACITY_MIN,
  FOX_HALO_SIZE_MAX_PX,
  FOX_HALO_SIZE_MIN_PX,
  FOX_DOCK_READY_MAX_SCALE,
  FOX_DOCK_READY_RISE_PX,
  FOX_DOCK_READY_TILT_DEG,
  FOX_DOCK_READY_TRAVEL_PX,
  FOX_IDLE_DURATION_MS,
  FOX_IDLE_FLOAT_PX,
  FOX_IDLE_MAX_SCALE,
  FOX_IDLE_SWING_DEG,
  FOX_PEEK_DURATION_MS,
  FOX_RETRACT_DURATION_MS,
  FOX_SNAP_DURATION_MS,
  QUERY_CLOSE_DURATION_MS,
  QUERY_OPEN_DURATION_MS,
  queryHandoffGeometry,
  isAllowedIdleScale,
  isAllowedSnapDuration,
  isVisibleIdleDuration,
  isVisibleIdleFloat,
  isVisibleIdleSwing,
} from '../../src/shared/fox-motion';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'src/renderer/styles/app.css'), 'utf8');
const foxApp = readFileSync(path.join(root, 'src/renderer/FoxApp.tsx'), 'utf8');

describe('fox motion parameters', () => {
  it('keeps idle motion visibly stronger than the old 2px / 0.8deg cycle', () => {
    expect(isVisibleIdleDuration(FOX_IDLE_DURATION_MS)).toBe(true);
    expect(isVisibleIdleFloat(FOX_IDLE_FLOAT_PX)).toBe(true);
    expect(isVisibleIdleSwing(FOX_IDLE_SWING_DEG)).toBe(true);
    expect(isAllowedIdleScale(FOX_IDLE_MAX_SCALE)).toBe(true);
    expect(FOX_IDLE_FLOAT_PX).toBeGreaterThanOrEqual(3);
    expect(FOX_IDLE_SWING_DEG).toBeGreaterThan(0.8);
    expect(FOX_IDLE_MAX_SCALE).toBeLessThanOrEqual(1.04);
  });

  it('keeps the edge snap inside the 420-560ms directional window', () => {
    expect(isAllowedSnapDuration(FOX_SNAP_DURATION_MS)).toBe(true);
    expect(isAllowedSnapDuration(419)).toBe(false);
    expect(isAllowedSnapDuration(561)).toBe(false);
  });

  it('keeps the hover peek noticeable without becoming a blocking loop', () => {
    expect(FOX_PEEK_DURATION_MS).toBeGreaterThanOrEqual(400);
    expect(FOX_PEEK_DURATION_MS).toBeLessThanOrEqual(500);
    expect(FOX_RETRACT_DURATION_MS).toBeGreaterThanOrEqual(240);
    expect(FOX_RETRACT_DURATION_MS).toBeLessThan(FOX_PEEK_DURATION_MS);
  });

  it('gives a docked fox a mirrored inward ready motion without paint-heavy animation', () => {
    expect(FOX_DOCK_READY_TRAVEL_PX).toBe(3);
    expect(FOX_DOCK_READY_RISE_PX).toBe(2);
    expect(FOX_DOCK_READY_TILT_DEG).toBe(5);
    expect(FOX_DOCK_READY_MAX_SCALE).toBe(1.035);
    expect(foxApp).toContain("'--fox-dock-ready-travel': `${FOX_DOCK_READY_TRAVEL_PX}px`");
    expect(foxApp).toContain("'--fox-dock-ready-rise': `${FOX_DOCK_READY_RISE_PX}px`");
    expect(foxApp).toContain("'--fox-dock-ready-tilt': `${FOX_DOCK_READY_TILT_DEG}deg`");
    expect(css).toContain('@keyframes fox-docked-ready-left');
    expect(css).toContain('@keyframes fox-docked-ready-right');
    expect(css).toContain('var(--fox-dock-ready-travel)');
    expect(css).toContain('var(--fox-follow-x, 0px)');
    expect(css).toContain('rotate(calc(var(--fox-dock-ready-tilt) + var(--fox-follow-rot, 0deg)))');
    expect(css).toContain('rotate(calc(0deg - var(--fox-dock-ready-tilt) + var(--fox-follow-rot, 0deg)))');
    expect(css).toContain('.is-snapping,');
    expect(css).toContain('.is-peeking,');
    expect(css).toContain('.is-retracting,');
    expect(css).toContain('.is-handoff-frozen');
    const readyMotion = css.slice(
      css.indexOf('@keyframes fox-docked-ready-left'),
      css.indexOf('@keyframes fox-halo-breathe'),
    );
    expect(readyMotion).toContain('transform:');
    expect(readyMotion).not.toMatch(/\bfilter:|\bopacity:|\bclip-path:|\bbackdrop-filter:/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*\.fox-idle\.is-docked-left \.fox-head\.is-glowing[\s\S]*animation: none !important/,
    );
  });

  it('splits the idle halo onto an opacity-only purple layer', () => {
    expect(FOX_HALO_DURATION_MS).toBeGreaterThanOrEqual(3000);
    expect(FOX_HALO_DURATION_MS).toBeLessThanOrEqual(3400);
    expect(FOX_HALO_SIZE_MIN_PX).toBe(76);
    expect(FOX_HALO_SIZE_MAX_PX).toBe(84);
    expect(FOX_HALO_OPACITY_MIN).toBeGreaterThanOrEqual(0.52);
    expect(FOX_HALO_OPACITY_MIN).toBeLessThanOrEqual(0.6);
    expect(FOX_HALO_OPACITY_MAX).toBeGreaterThanOrEqual(0.92);
    expect(FOX_HALO_OPACITY_MAX).toBeLessThanOrEqual(0.95);
    expect(css).toContain('.fox-button::before');
    expect(foxApp).toContain("'--fox-halo-size': `${FOX_HALO_SIZE_MIN_PX}px`");
    expect(foxApp).toContain("'--fox-halo-outer-size': `${FOX_HALO_SIZE_MAX_PX}px`");
    expect(foxApp).toContain("'--fox-halo-opacity-min': FOX_HALO_OPACITY_MIN");
    expect(foxApp).toContain("'--fox-halo-opacity-max': FOX_HALO_OPACITY_MAX");
    expect(css).toContain('@keyframes fox-halo-breathe');
    expect(css).toContain('rgba(139, 92, 246');
    expect(css).not.toContain('@keyframes fox-dock-glint');
    const idleMotion = css.match(/@keyframes fox-idle-motion\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(idleMotion).toContain('transform:');
    expect(idleMotion).not.toMatch(/\bfilter:/);
    const haloMotion = css.match(/@keyframes fox-halo-breathe\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(haloMotion).toContain('opacity:');
    expect(haloMotion).not.toMatch(/\bfilter:|\btransform:/);
    expect(css).toContain('.fox-idle.is-handoff-frozen .fox-button::before');
    expect(css).toContain('.fox-idle .fox-button:focus-visible');
    expect(css).toContain('.fox-focus-ring');
    expect(css).toContain('.fox-button:has(.fox-head.is-warning)::before');
    expect(css).toContain('.fox-button::after');
    expect(css).toContain('--fox-halo-reduced-opacity');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.fox-idle \.fox-button::before[\s\S]*animation: none/);
    expect(css).toMatch(/prefers-reduced-transparency: reduce[\s\S]*\.fox-button::after/);
  });

  it('keeps the frequent query handoff brief and closes faster than it opens', () => {
    expect(QUERY_OPEN_DURATION_MS).toBeGreaterThanOrEqual(220);
    expect(QUERY_OPEN_DURATION_MS).toBeLessThanOrEqual(300);
    expect(QUERY_CLOSE_DURATION_MS).toBeGreaterThanOrEqual(160);
    expect(QUERY_CLOSE_DURATION_MS).toBeLessThan(QUERY_OPEN_DURATION_MS);
  });

  it('collapses every query height onto the same left or right fox center', () => {
    for (const height of [88, 240, 340, 430, 620]) {
      for (const anchor of ['left', 'right'] as const) {
        const geometry = queryHandoffGeometry(600, height, anchor);
        const transformedLeft = geometry.originX * (1 - geometry.scaleX);
        const transformedTop = geometry.originY * (1 - geometry.scaleY);
        const centerX = transformedLeft + (600 * geometry.scaleX) / 2;
        const centerY = transformedTop + (height * geometry.scaleY) / 2;
        const clipWidth = 600 - geometry.clipLeft - geometry.clipRight;
        const clipHeight = height - geometry.clipTop - geometry.clipBottom;
        const clipCenterX = geometry.clipLeft + clipWidth / 2;
        const clipCenterY = geometry.clipTop + clipHeight / 2;
        expect(centerX).toBeCloseTo(anchor === 'left' ? 44 : 556, 5);
        expect(centerY).toBeCloseTo(44, 5);
        expect(clipWidth).toBe(64);
        expect(clipHeight).toBe(64);
        expect(clipCenterX).toBeCloseTo(centerX, 5);
        expect(clipCenterY).toBeCloseTo(centerY, 5);
      }
    }
  });

  it('moves the collapse target to the half-hidden fox center when docked', () => {
    for (const [anchor, edge, expectedCenter] of [
      ['left', 'left', 0],
      ['right', 'right', 600],
    ] as const) {
      const geometry = queryHandoffGeometry(600, 620, anchor, edge);
      const transformedLeft = geometry.originX * (1 - geometry.scaleX);
      const centerX = transformedLeft + (600 * geometry.scaleX) / 2;
      const clipWidth = 600 - geometry.clipLeft - geometry.clipRight;
      const clipCenterX = geometry.clipLeft + clipWidth / 2;
      expect(centerX).toBeCloseTo(expectedCenter, 5);
      expect(clipWidth).toBe(64);
      expect(clipCenterX).toBeCloseTo(expectedCenter, 5);
    }
  });
});
