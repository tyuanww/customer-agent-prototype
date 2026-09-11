import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'src/renderer/styles/app.css'), 'utf8');
const tokens = readFileSync(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
const queryApp = [
  readFileSync(path.join(root, 'src/renderer/QueryApp.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/features/search/QueryCapsule.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/features/search/QueryResultsPane.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/features/search/query-view.ts'), 'utf8'),
].join('\n');

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as unknown as Rgb;
}

function composite(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  return foreground.map((value, index) => Math.round(
    value * alpha + background[index] * (1 - alpha),
  )) as unknown as Rgb;
}

function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe('query capsule visual contract', () => {
  it('keeps the shared-element handoff geometry and timing unchanged', () => {
    expect(css).toContain('--query-open-duration: 260ms');
    expect(css).toContain('--query-close-duration: 200ms');
    expect(css).toContain('animation: query-shell-unfold var(--query-open-duration)');
    expect(css).toContain('animation: query-shell-fold var(--query-close-duration)');
    expect(css).toContain('animation: query-surface-in var(--query-open-duration) ease-out both');
    expect(css).toContain('animation: query-surface-out var(--query-close-duration) ease-in both');
    expect(css).toContain('var(--query-handoff-clip-top)');
    expect(css).toContain('var(--query-handoff-fox-a)');
    expect(queryApp).toContain("reportHandoffMilestone(command.handoffId, 'open-armed')");
    expect(queryApp).toContain("reportHandoffMilestone(activeHandoffIdRef.current, 'open-finished')");
    expect(queryApp).toContain("reportHandoffMilestone(activeHandoffIdRef.current, 'close-finished')");
    expect(queryApp).toContain("event.animationName === 'query-shell-unfold'");
    expect(queryApp).toContain("event.animationName === 'query-shell-fold'");
    expect(queryApp).toContain('export const SEARCH_FEEDBACK_MS = 280');
    expect(queryApp).toContain('export const COPY_FEEDBACK_MS = 900');
  });

  it('treats the capsule as a white-first desktop input with purple as the action anchor', () => {
    expect(tokens).toContain('--glass: rgba(250, 252, 255, 0.88)');
    expect(tokens).toContain('--query-glass: rgba(248, 249, 252, 0.80)');
    expect(tokens).toContain('--query-glass-inner: rgba(255, 255, 255, 0.48)');
    expect(tokens).toContain('--query-blur: blur(28px) saturate(118%)');
    expect(tokens).toContain('0 22px 58px rgba(23, 27, 38, 0.22)');
    expect(tokens).toContain('--fox: #8b5cf6');
    expect(css).toContain('backdrop-filter: var(--query-blur)');
    expect(css).toContain('background: var(--query-glass)');
    expect(css).not.toContain('linear-gradient(var(--query-glass-inner), var(--query-glass-inner))');
    expect(css).toContain('box-shadow: var(--query-shadow), var(--query-highlight)');
    expect(css).toContain('.capsule-field:focus-within');
    expect(css).not.toContain('border-color: rgba(91, 140, 255, 0.48)');
    expect(css).toContain('background: var(--query-accent-control)');
    expect(css).toContain('.dashboard-entry');
    expect(css).toContain('.deep-thinking-entry');
    expect(css).toContain('.capsule-session-entry');
    expect(css).toContain('background: var(--fox-soft)');
    expect(tokens).toContain('--ink: #f5f5f7');
    expect(tokens).toContain('--muted: #b9b5c0');
    expect(tokens).toContain('--hairline: rgba(255, 255, 255, 0.14)');
    expect(tokens).toContain('--query-control-hover: rgba(255, 255, 255, 0.13)');
    expect(tokens).toContain('--query-accent-control: rgba(139, 92, 246, 0.28)');
    expect(tokens).toContain('--query-rank-ink: #ded1ff');
    expect(tokens).toContain('--query-match-exact-ink: #8bdfc0');
    expect(tokens).toContain('--query-success-ink: #1d765f');
    expect(tokens).toContain('--query-success-ink: #62c4a4');
    expect(css).not.toContain('background: rgba(255, 255, 255, 0.72)');
    expect(css).not.toContain('color: #6543aa');
    expect(css).toContain('color: var(--query-success-ink)');
    expect(css).toContain(".deep-thinking-entry[aria-pressed='true'] span {\n  color: var(--query-rank-ink)");
  });

  it('provides glass fallbacks without changing the reduced-motion handoff snap', () => {
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(tokens).toContain('--glass-solid: #ffffff');
    expect(tokens).toContain('--glass-inner-solid: #f5f6f8');
    expect(tokens).toContain('--fox-soft-solid: #f2eefb');
    expect(css).toContain('--query-glass: var(--query-glass-solid)');
    expect(css).toContain('--glass: var(--glass-solid)');
    expect(css).toContain('.capsule-field:focus-within,');
    expect(css).toContain('.dashboard-entry:hover,');
    expect(css).toContain(".deep-thinking-entry[aria-pressed='true'],");
    expect(css).toContain('.search-btn:hover,');
    expect(css).toContain('.copy-btn:hover:not(:disabled)');
    expect(css).toContain('.query-shell.is-opening .glass-shell {');
    expect(css).toContain('clip-path: inset(0 round var(--radius-shell))');
    expect(css).toContain('.query-shell.is-closing .glass-shell {');
    expect(css).toContain('var(--query-handoff-clip-left)');
    expect(css).toContain("html[data-role='query'] {");
    expect(css).toContain('--query-control: var(--glass-solid)');
    expect(css).toContain('--fox-soft: var(--fox-soft-solid)');
    expect(css).toContain('--query-match-exact-surface: var(--query-match-exact-solid)');
  });

  it('keeps a visible mirrored resize affordance inside the 20px hit target', () => {
    expect(css).toMatch(/\.query-resize-grip\s*\{[\s\S]*?height: 20px/);
    expect(css).toMatch(/\.query-resize-grip::after\s*\{[\s\S]*?width: 28px;[\s\S]*?height: 3px/);
    expect(css).toContain(".query-resize-grip[data-edge='bottom']::after");
    expect(css).toContain(".query-resize-grip[data-edge='top']::after");
    expect(css).toContain('.query-resize-grip:hover::after,');
    expect(css).toContain('.query-resize-grip:focus-visible::after');
    expect(css).toContain('.query-resize-grip:active::after');
    expect(css).toMatch(/forced-colors: active[\s\S]*?\.query-resize-grip::after\s*\{[\s\S]*?background: CanvasText/);
  });

  it('keeps small semantic text readable on light and dark material fallbacks', () => {
    const lightBase = rgb('#f7f8fb');
    const darkBase = rgb('#2a2930');
    const ratios = [
      contrast(rgb('#6543aa'), composite(rgb('#ffffff'), 0.58, lightBase)),
      contrast(rgb('#1d765f'), composite(rgb('#effcf8'), 0.94, lightBase)),
      contrast(rgb('#1d765f'), composite(rgb('#48c9a9'), 0.14, lightBase)),
      contrast(rgb('#b9b5c0'), composite(rgb('#ffffff'), 0.08, darkBase)),
      contrast(rgb('#62c4a4'), composite(rgb('#62c4a4'), 0.18, darkBase)),
      contrast(rgb('#ded1ff'), composite(rgb('#a78bfa'), 0.18, darkBase)),
      contrast(rgb('#a9c9ff'), composite(rgb('#5b8cff'), 0.16, darkBase)),
      contrast(rgb('#8bdfc0'), composite(rgb('#62c4a4'), 0.16, darkBase)),
    ];
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  it('never animates the expensive glass sampling properties', () => {
    const transitionValues = [...css.matchAll(/transition\s*:\s*([^;]+);/g)]
      .map((match) => match[1]);
    expect(transitionValues).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/backdrop-filter|\bfilter\b|box-shadow/),
    ]));
    const keyframeBodies = [...css.matchAll(/@keyframes\s+(query-shell-unfold|query-shell-fold|query-surface-in|query-surface-out)\s*\{([\s\S]*?)\n\}/g)]
      .map((match) => match[2]);
    expect(keyframeBodies.length).toBeGreaterThanOrEqual(4);
    for (const body of keyframeBodies) {
      expect(body).not.toMatch(/backdrop-filter|\bfilter\b|box-shadow/);
    }
    const searchingFox = css.match(/@keyframes query-fox-searching\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(searchingFox).not.toMatch(/\bfilter:/);
    expect(css).toContain('will-change: opacity');
    expect(css).toContain('will-change: clip-path');
    expect(css).not.toContain('will-change: backdrop-filter');
    expect(css).toContain('background: Canvas');
    expect(css).toContain('color: CanvasText');
    expect(css).toContain('outline: 2px solid Highlight');
    expect(css).toContain('.capsule-fox:focus-visible');
    expect(css).toContain('.capsule-fox:focus-visible .fox-focus-ring');
    expect(queryApp).toContain('query-fox-focus-ring');
  });
});
