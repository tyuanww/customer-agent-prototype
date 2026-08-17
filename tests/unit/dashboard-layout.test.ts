import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectCssCustomPropertyValues,
  findTransitionAllRisks,
  parseCssDeclarations,
} from './helpers/css-transition-all-guard';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'src/renderer/styles/dashboard.css'), 'utf8');
const app = [
  readFileSync(path.join(root, 'src/renderer/DashboardApp.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/components/DashboardBrandFox.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/features/dashboard/DashboardIcons.tsx'), 'utf8'),
  readFileSync(path.join(root, 'src/renderer/features/dashboard/DashboardThemeMenu.tsx'), 'utf8'),
].join('\n');
const appearance = readFileSync(
  path.join(root, 'src/renderer/lib/dashboard-appearance.ts'),
  'utf8',
);
const rendererMain = readFileSync(path.join(root, 'src/renderer/main.tsx'), 'utf8');
const announce = readFileSync(
  path.join(root, 'src/renderer/features/dashboard/AnnounceModule.tsx'),
  'utf8',
);
const charts = readFileSync(
  path.join(root, 'src/renderer/features/dashboard/DashboardCharts.tsx'),
  'utf8',
);

describe('dashboard layout contract', () => {
  it('keeps a white-first light palette and a charcoal dark palette', () => {
    expect(css).toContain('--dash-radius: 8px');
    expect(css).toContain('--dash-panel-radius: var(--dash-radius)');
    expect(css).toContain('--dash-radius-pill: 999px');
    expect(css).toContain('--dash-radius-dot: 50%');
    expect(css).toContain('--dash-surface: light-dark(#ffffff, #1c1b20)');
    expect(css).toContain('--dash-canvas: light-dark(#f4f4f6, #16151a)');
    expect(css).toContain('--dash-sidebar-material: light-dark(rgba(242, 242, 246, 0.92), rgba(16, 15, 20, 0.92))');
    expect(css).toContain('--dash-material-chrome: light-dark(rgba(242, 242, 246, 0.88), rgba(16, 15, 20, 0.88))');
    expect(css).toContain('--dash-material-panel: light-dark(#ffffff, #1c1b20)');
    expect(css).toContain('--dash-chrome-hover: light-dark(rgba(36, 33, 42, 0.055), rgba(255, 255, 255, 0.065))');
    expect(css).toContain('--dash-chrome-selected: light-dark(rgba(111, 76, 195, 0.10), rgba(167, 139, 250, 0.16))');
    expect(css).toContain('--dash-nav-active: var(--dash-chrome-selected)');
    expect(css).toContain('--dash-purple: light-dark(#6f4cc3, #a78bfa)');
    expect(css).toContain('--dash-control-line: light-dark(#8e8797, #8f8798)');
    expect(css).toContain('--dash-heat-ink-4: light-dark(#21152f, #15121a)');
    expect(css).toContain("html[data-role='dashboard'][data-dashboard-theme='light']");
    expect(css).toContain("html[data-role='dashboard'][data-dashboard-theme='dark']");
    expect(css).not.toMatch(/background:\s*linear-gradient/);
    expect(charts).not.toContain('<linearGradient');
    expect(css).not.toContain('#000000');
    expect(css).not.toContain('#111014');
  });

  it('contains scroll inside the content region without global horizontal overflow', () => {
    expect(css).toContain('min-height: 0');
    expect(css).toContain('overflow: hidden');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('scrollbar-gutter: stable');
    expect(css).toContain('@media (max-width: 1040px)');
  });

  it('uses a compact enterprise navigation and the real fox brand asset', () => {
    expect(app).toContain('<DashboardBrandFox theme={resolvedTheme} size={40} />');
    expect(app).toContain("activeVariant = theme === 'dark' ? 'white-headset' : 'purple-headset'");
    expect(app).toContain("import darkFoxHeadUrl from '../assets/dashboard-fox-headset-dark.png'");
    expect(app).not.toContain('<FoxHead size={38}');
    expect(app).not.toContain('dashboard-brand-mark');
    expect(app).not.toContain('<small>{item.blurb}</small>');
    expect(app).not.toContain('Manager Decision Desk');
    expect(css).toContain('grid-template-columns: var(--dash-structure-boundary) minmax(0, 1fr)');
    expect(css).toContain('--dash-structure-boundary: var(--dash-rendered-nav-width, var(--dashboard-nav-width, 248px))');
    expect(css).toContain('min-height: 42px');
    const navButtonRule = css.match(/\.dashboard-nav-item > button\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(navButtonRule).toContain('background: transparent');
    expect(navButtonRule).not.toContain('border-left: 3px solid');
    expect(css).toContain('.dashboard-nav-item > button::before');
    expect(css).toContain('.dashboard-nav-item > button.is-active::before');
    expect(css).not.toMatch(
      /\.dashboard-nav-item > button\.is-active[^{]*\{[^}]*border-left-color:\s*var\(--dash-purple\)/s,
    );
    expect(css).toContain('background: var(--dash-nav-active)');
    expect(css).toContain('background: var(--dash-chrome-hover)');
    expect(css).not.toMatch(/border-left:\s*3px\s+solid\s+var\(--dash-purple\)/);
    expect(css).toContain('.wording-list > button.is-selected');
    expect(css).toContain('.iteration-list > button.is-selected');
    expect(css).toContain('.dash-release-card.is-selected');
    expect(css).toContain('.dash-segmented button.is-active');
    expect(css).toContain('.dash-action-primary');
    expect(css).not.toMatch(
      /\.dashboard-shell button:not\(:disabled\)[^{]*\{[^}]*filter:/s,
    );
    expect(css).not.toMatch(
      /\.dashboard-shell button[^}]*:active[^}]*\{[^}]*transform:\s*translateY/s,
    );
    const sharedControlTransition = css.match(
      /\.dashboard-shell button:not\(:disabled\),\s*\n\.dashboard-shell select:not\(:disabled\)\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(sharedControlTransition).not.toContain('transform');
    expect(css).toContain(".voc-heatmap-row button[role='gridcell']:hover:not(.is-selected)");
    expect(css).toContain("[aria-selected='true']");
    expect(css).toContain('color: HighlightText');
  });

  it('ships a transparent 1254px Dashboard-only white-headset asset', async () => {
    const asset = readFileSync(
      path.join(root, 'src/renderer/assets/dashboard-fox-headset-dark.png'),
    );
    const sharedFox = readFileSync(path.join(root, 'fox-head.png'));
    expect(asset.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(asset.readUInt32BE(16)).toBe(1254);
    expect(asset.readUInt32BE(20)).toBe(1254);
    expect(asset[24]).toBe(8);
    expect(asset[25]).toBe(6);

    const decoderUrl = pathToFileURL(path.join(root, 'scripts/generate-app-icons.mjs')).href;
    const { decodePng } = await import(decoderUrl) as {
      decodePng: (input: Buffer) => { width: number; height: number; pixels: Buffer };
    };
    const dark = decodePng(asset);
    const shared = decodePng(sharedFox);
    const rgbaAt = (pixels: Buffer, x: number, y: number) => {
      const offset = (y * dark.width + x) * 4;
      return [...pixels.subarray(offset, offset + 4)];
    };
    expect(rgbaAt(dark.pixels, 0, 0)).toEqual([0, 0, 0, 0]);
    let headsetPixels = 0;
    for (let index = 0; index < shared.pixels.length; index += 4) {
      const same = shared.pixels[index] === dark.pixels[index]
        && shared.pixels[index + 1] === dark.pixels[index + 1]
        && shared.pixels[index + 2] === dark.pixels[index + 2]
        && shared.pixels[index + 3] === dark.pixels[index + 3];
      if (same) continue;
      const sharedMax = Math.max(shared.pixels[index], shared.pixels[index + 1], shared.pixels[index + 2]);
      const darkMin = Math.min(dark.pixels[index], dark.pixels[index + 1], dark.pixels[index + 2]);
      if (sharedMax < 120 && darkMin > 180) {
        headsetPixels += 1;
      }
    }
    expect(headsetPixels).toBeGreaterThan(800);
  });

  it('extends macOS chrome into the titlebar with explicit drag and no-drag regions', () => {
    expect(app).toContain('data-dashboard-chrome={chromeMode}');
    expect(app).toContain('data-platform={hostPlatform}');
    expect(app).toContain('dashboard-drag-region');
    expect(app).toContain('dashboard-no-drag');
    expect(app).toContain('dashboard-titlebar-drag-strip');
    expect(app).toContain('dashboard-titlebar-control-island');
    expect(app).toContain('dashboard-topbar-drag-surface');
    expect(app).toContain('dashboard-brand dashboard-no-drag');
    expect(app).toContain('DASHBOARD_WINDOW_TITLE');
    expect(app).toContain('<strong>客服运营工作台</strong>');
    expect(css).toContain(".dashboard-shell[data-dashboard-chrome='integrated']");
    expect(css).toContain('--dash-titlebar-height: 48px');
    expect(css).toContain('--dash-control-safe-left: 72px');
    expect(css).toContain('--dash-control-island-right: 120px');
    expect(css).toContain('--dash-collapsed-surface-width: 72px');
    expect(css).toContain('--dash-collapsed-surface-width: 120px');
    expect(css).toContain('--dash-nav-icon-slot-width: 120px');
    expect(css).toContain('--dash-nav-icon-anchor-offset: 60px');
    expect(css).toContain('--dash-structure-boundary: var(--dash-rendered-nav-width, var(--dashboard-nav-width, 248px))');
    expect(css).toContain('.dashboard-titlebar-control-island');
    const islandRule = css.match(/\.dashboard-titlebar-control-island\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(islandRule).toContain('background: transparent');
    expect(islandRule).toContain('backdrop-filter: none');
    expect(islandRule).toContain('border: 0');
    expect(css).toContain('.dashboard-nav::after');
    expect(css).not.toMatch(
      /\[data-nav-phase='collapsed'\][\s\S]{0,220}\.dashboard-titlebar-control-island\s*\{[^}]*border-right:\s*1px\s+solid/s,
    );
    expect(css).not.toMatch(
      /\[data-nav-phase='collapsed'\][\s\S]{0,180}\.dashboard-nav::after\s*\{[^}]*top:\s*var\(--dash-titlebar-height\)/s,
    );
    expect(css).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.dashboard-nav\s*\{[^}]*border-right:\s*0;/,
    );
    expect(css).toContain('.dashboard-topbar-drag-surface');
    expect(css).not.toMatch(
      /\.dashboard-shell\[data-dashboard-chrome='integrated'\] \.dashboard-nav-toggle\s*\{[^}]*position:\s*fixed/s,
    );
    expect(css).not.toContain('--dash-titlebar-safe-top: 38px');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
    expect(css).toContain(".dashboard-shell[data-dashboard-chrome='integrated'] .dashboard-titlebar-drag-strip");
    expect(css).toContain("[data-nav-resizing='true'] :is(");
    expect(css).toContain('.dashboard-titlebar-drag-strip,');
    expect(css).toContain('.dashboard-topbar');
    expect(css).not.toContain(
      ".dashboard-shell[data-dashboard-chrome='integrated'] .dashboard-nav,\n.dashboard-shell[data-dashboard-chrome='integrated'] .dashboard-topbar",
    );
    expect(css).toContain('margin-top: var(--dash-titlebar-height)');
    expect(css).toContain('padding-top: 12px');
    expect(css).toContain('height: var(--dash-titlebar-height)');
    expect(css).toContain('min-height: var(--dash-titlebar-height)');
    expect(css).toContain('left: var(--dash-control-safe-left)');
    expect(app).toContain('dashboardChromeCssVars(chromeMode)');
    expect(app).toContain("'--dash-nav-rail-width': `${collapsedSurface}px`");
    expect(app).toContain('const liveStructureWidth = navResizing || navHoldFrameRef.current || navSettlingPreviewRef.current');
    expect(app).toContain("'--dash-rendered-nav-width': `${liveStructureWidth}px`");
    expect(app).toContain("'--dash-structure-boundary': `${liveStructureWidth}px`");
    expect(app).not.toContain('...(!(navResizing || navHoldFrameRef.current || navSettlingPreviewRef.current)');
    expect(app).toContain('const interruptNavSettle = useCallback');
    expect(app).toContain('const schedulePaintHold = useCallback');
    expect(app).not.toContain('onTransitionEnd={handleNavStructureTransition}');
    expect(app).toContain("shell.addEventListener('transitionend', onNativeTransition)");
    expect(app).toContain("shell.addEventListener('transitioncancel', onNativeTransition)");
    expect(css).toContain("[data-nav-hold='true']");
    expect(css).not.toContain('.dashboard-nav-toggle.is-expand-overlay');
    expect(app).toContain('data-nav-phase={navPhase}');
    expect(app).toContain('data-testid="dashboard-nav-toggle"');
    expect(app).not.toContain('dashboard-nav-toggle-collapse');
    expect(app).not.toContain('dashboard-nav-toggle-expand');
  });

  it('keeps glass structural and leaves data surfaces readable in the same material system', () => {
    expect(css).toContain('--dash-radius: 8px');
    expect(css).toContain('--dash-panel-radius: var(--dash-radius)');
    expect(css).toContain('border-radius: var(--dash-panel-radius)');
    const cardRule = css.match(/\.dash-card,\s*\n\.arch-card\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(cardRule).toContain('border: 1px solid var(--dash-line)');
    expect(cardRule).toContain('background: var(--dash-material-panel)');
    expect(cardRule).toContain('box-shadow: inset 0 1px 0 var(--dash-highlight)');
    expect(cardRule).not.toMatch(/box-shadow:\s*0\s+\d+px/);
    expect(cardRule).not.toContain('backdrop-filter');
    const contentRule = css.match(/\.dashboard-content\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(contentRule).not.toContain('backdrop-filter');
    expect(contentRule).toContain('color: var(--dash-ink)');
    expect(contentRule).toContain('padding: 20px 24px 24px');
    expect(css).toContain('backdrop-filter: blur(20px) saturate(114%)');
    expect(css).not.toContain('backdrop-filter: blur(18px) saturate(112%)');
    const glassSupportRule = css.match(
      /@supports \(\(backdrop-filter: blur\(1px\)\)[\s\S]*?@supports not/,
    )?.[0] ?? '';
    expect(glassSupportRule).toContain('.dashboard-nav {');
    expect(glassSupportRule).toContain(".dashboard-shell[data-nav-resizing='true'] .dashboard-nav,");
    expect(glassSupportRule).toContain(".dashboard-shell[data-nav-phase='collapsing'] .dashboard-nav,");
    expect(glassSupportRule).toContain(".dashboard-shell[data-nav-phase='expanding'] .dashboard-nav {");
    expect(glassSupportRule).toMatch(
      /data-nav-phase='expanding'[^}]*background:\s*var\(--dash-sidebar\);[^}]*-webkit-backdrop-filter:\s*none;[^}]*backdrop-filter:\s*none;/s,
    );
    expect(glassSupportRule).not.toContain('.dashboard-titlebar-control-island {');
    expect(glassSupportRule).not.toContain('.dashboard-topbar {');
    expect(glassSupportRule).toContain('.dashboard-nav-tooltip,');
    expect(glassSupportRule).toContain('.dashboard-theme-popover {');
    expect(glassSupportRule).not.toMatch(/\.dash-filter-toolbar[\s\S]*?backdrop-filter/);
    expect(glassSupportRule).not.toMatch(/\.dash-filterbar[\s\S]*?backdrop-filter/);
    expect(glassSupportRule).not.toMatch(/\.dash-card[\s\S]*?backdrop-filter/);
    expect(glassSupportRule).not.toMatch(/\.dashboard-content[\s\S]*?backdrop-filter/);
    expect(glassSupportRule).not.toMatch(/\.dashboard-topbar[\s\S]*?backdrop-filter/);
    expect(glassSupportRule).not.toContain('.dashboard-nav-toggle.is-expand-overlay::before');
    expect(css).toContain('.dashboard-main {');
    expect(css).toContain('background: #ffffff');
    expect(css).toContain('background: #1c1b20');
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(css).toMatch(/@supports not[\s\S]*?\.dashboard-nav\s*\{/);
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('--dash-material-panel: var(--dash-surface)');
    expect(css).toContain('--dash-chrome-hover: var(--dash-surface-subtle)');
    expect(css).toContain('--dash-nav-active: var(--dash-surface-selected)');
    expect(css).toContain('.dashboard-nav-item > button.is-active .dashboard-nav-icon');
    expect(css).toContain('color: var(--dash-purple)');
    expect(css).toContain('color: HighlightText');
    expect(css).not.toContain('drop-shadow');
    expect(css).toContain('.health-strip');
    expect(css).toContain('.manager-decision-table');
    expect(css).toContain('.dashboard-banners .env-badge');
    expect(css).not.toMatch(/border-left:\s*3px\s+solid\s+var\(--dash-purple\)/);
    expect(css).not.toMatch(
      /\.dashboard-nav-item > button\.is-active[^{]*\{[^}]*border-left:/s,
    );
  });

  it('invalidates every pending navigation frame when Dashboard unmounts', () => {
    const cleanup = app.match(
      /useEffect\(\(\) => \(\) => \{[\s\S]*?cancelResizeFrame\(\);[\s\S]*?clearNavPreviewWidth\(\);[\s\S]*?\}, \[cancelResizeFrame,[^\]]+\]\);/,
    )?.[0] ?? '';
    expect(cleanup).toContain('cancelSettleAndHoldRafs();');
    expect(cleanup).toContain('navSettleEpochRef.current += 1;');
    expect(cleanup).toContain('navPendingSettleTargetRef.current = null;');
    expect(cleanup).toContain('navPendingPhaseRef.current = null;');
    expect(cleanup).toContain('navSettlingPreviewRef.current = false;');
    expect(cleanup).toContain('setNavHoldFlag(false);');
  });

  it('keeps the default 1180px dashboard in two-chart mode and stacks below 1120px', () => {
    expect(css).toContain('@media (max-width: 1120px)');
    expect(css).not.toContain('@media (max-width: 1280px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.75fr)');
  });

  it('uses native content scrolling without mouse-drag handlers', () => {
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('scrollbar-gutter: stable');
    expect(css).toContain('touch-action: pan-y');
    expect(css).not.toContain('cursor: grab');
    expect(app).not.toContain('data-drag-scrolling');
    const contentMarkup = app.slice(app.indexOf('<main'), app.indexOf('</main>'));
    expect(contentMarkup).not.toMatch(/onPointerDown|onPointerMove|onLostPointerCapture/);
  });

  it('supports an adjustable separator, compact collapse, and PanelLeft state icons', () => {
    expect(app).toContain('aria-expanded={!navCollapsed}');
    expect(app).toContain('aria-controls="dashboard-primary-navigation"');
    expect(app).toContain('data-testid="dashboard-nav-toggle"');
    expect(app).not.toContain('data-variant="expand-overlay"');
    expect(app).not.toContain('dashboard-nav-toggle-collapse');
    expect(app).not.toContain('dashboard-nav-toggle-expand');
    expect(app).toContain('dashboard-nav-chrome');
    expect(app).toContain('resolveDashboardNavResizeIntent');
    expect(app).toContain('clampDashboardNavPreviewWidth');
    expect(app).toContain('navAutoExpandedRef');
    expect(app).toContain('scheduleNavPreview');
    expect(app).toContain('armAutoExpand');
    expect(appearance).toContain('shouldAutoExpandNavWidth');
    expect(appearance).toContain('DASHBOARD_NAV_AUTO_EXPAND_WIDTH');
    expect(app).toContain("useState<DashboardNavPhase>('expanded')");
    expect(app).toContain('data-nav-phase={navPhase}');
    expect(app).toContain('useLayoutEffect');
    expect(app).toContain('focus({ preventScroll: true })');
    expect(app).toContain('aria-disabled="true"');
    expect(app).toContain('role="separator"');
    expect(app).toContain('aria-label="调整工作台侧栏宽度"');
    expect(app).toContain('aria-valuemin={separatorAria.valuemin}');
    expect(app).toContain('aria-valuemax={separatorAria.valuemax}');
    expect(app).toContain('aria-valuenow={separatorAria.valuenow}');
    expect(app).toContain('resolveDashboardSeparatorAria');
    expect(appearance).toContain('export function resolveDashboardSeparatorAria');
    expect(appearance).toContain('export function visualDividerXFromPseudo');
    expect(app).toContain('onPointerDown={startNavResize}');
    expect(app).toContain('onPointerMove={moveNavResize}');
    expect(app).toContain('onPointerCancel={endNavResize}');
    expect(app).toContain('onLostPointerCapture={(event) => {');
    expect(app).not.toContain('if ((event.buttons & 1) === 1) return;');
    expect(app).toContain('publishCollapsedSeparatorAria');
    expect(app).toContain('shouldSettleDashboardNavTransition');
    expect(app).toContain('prefers-reduced-motion: reduce');
    expect(app).toContain('onKeyDown={handleNavResizeKey}');
    expect(app).toContain('const navResizeShellLeftRef = useRef<number | null>(null)');
    expect(css).toContain('--dash-rendered-nav-width');
    expect(css).toContain('grid-template-columns: var(--dash-structure-boundary) minmax(0, 1fr)');
    expect(css).toContain('padding: 0 8px 12px');
    expect(css).toContain('--dash-nav-icon-slot: var(--dash-nav-icon-slot-width, var(--dash-collapsed-surface-width, 72px))');
    expect(css).toContain('--dash-brand-copy-shift: 0px');
    expect(css).toContain('--dash-brand-copy-shift: -24px');
    expect(css).toContain('--dash-nav-icon-size: 20px');
    expect(css).toContain('--dash-nav-label-shift: calc(var(--dash-brand-copy-shift) - 4px)');
    expect(css).toContain('margin-inline-start: var(--dash-brand-copy-shift)');
    expect(css).toContain('margin-inline-start: var(--dash-nav-label-shift)');
    const navIconRule = css.match(/\.dashboard-nav-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(navIconRule).toContain('width: var(--dash-nav-icon-size)');
    expect(navIconRule).toContain('height: var(--dash-nav-icon-size)');
    expect(navIconRule).toContain('justify-self: center');
    expect(navIconRule).not.toMatch(/transform:/);
    const navIconSvg = css.match(/\.dashboard-nav-icon svg\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(navIconSvg).toContain('width: var(--dash-nav-icon-size)');
    expect(navIconSvg).toContain('height: var(--dash-nav-icon-size)');
    expect(app).toContain('viewBox="0 0 24 24"');
    const navLabelRule = css.match(/\.dashboard-nav-label\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(navLabelRule).toContain('margin-inline-start: var(--dash-nav-label-shift)');
    expect(navLabelRule).toContain('transition: opacity 90ms ease');
    expect(navLabelRule).not.toMatch(/transition:[^;]*margin/);
    expect(css).toContain(".dashboard-shell[data-nav-resizing='true']");
    expect(css).toContain(".dashboard-shell[data-nav-resizing='true'] .dashboard-nav-label,");
    expect(css).toContain('--dash-motion-structure: 190ms');
    expect(css).toContain('--dash-ease-structure: cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(css).toContain('.dashboard-nav-resizer');
    expect(css).toContain('cursor: col-resize');
    expect(css).toContain('touch-action: none');
    expect(css).not.toContain('.dashboard-nav-toggle.is-expand-overlay');
    expect(css).toContain('.dashboard-nav-chrome');
    expect(css).toContain('.dashboard-brand-logo {');
    expect(css).toContain('grid-template-columns: var(--dash-nav-icon-slot) minmax(0, 1fr)');
    expect(css).toContain('.dashboard-nav-toggle-icon.is-collapse-glyph');
    expect(css).toContain('.dashboard-nav-toggle-icon.is-expand-glyph');
    expect(css).toContain('left: var(--dash-control-safe-left)');
    expect(css).toContain('top: 4px');
    expect(css).not.toContain('transition: padding-left var(--dash-motion-structure) var(--dash-ease-structure)');
    expect(css).not.toMatch(/transition[^;]*margin/);
    expect(css).not.toContain('padding-left: 52px');
    expect(css).not.toMatch(
      /\[data-nav-phase='collapsing'\] \.dashboard-nav-label[\s\S]{0,80}max-width:\s*0/,
    );
    expect(css).not.toMatch(
      /\[data-nav-phase='collapsing'\] \.dashboard-brand-copy,[^{]*\{[^}]*max-width:\s*0/s,
    );
    expect(css).not.toContain(
      '.dashboard-shell.is-nav-collapsed .dashboard-nav-item > button {\n  justify-content: center;',
    );
    expect(css).not.toContain(
      '.dashboard-shell.is-nav-collapsed .dashboard-nav-group {\n  max-height: 0;',
    );
    expect(css).toContain('height: 18px');
    expect(css).toContain('white-space: nowrap');
    expect(app).toContain("<DashboardChromeIcon id=\"panel-close\" />");
    expect(app).toContain("<DashboardChromeIcon id=\"panel-open\" />");
    expect(app).not.toContain('dashboard-nav-toggle-icon__state');
    expect(app).not.toContain('dashboard-nav-toggle__bar');
    expect(app).not.toContain('Tornado');
    expect(app).not.toContain('type="checkbox"');
    expect(css).toContain('.dashboard-nav-toggle[hidden]');
    expect(css).toContain('--nav-toggle-control-size: 40px');
    const toggleRule = css.match(/\.dashboard-nav-toggle\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(toggleRule).toContain('border: 0');
    expect(toggleRule).toContain('background: transparent');
    expect(toggleRule).toContain('border-radius: var(--dash-radius)');
    expect(css).toContain('.dashboard-nav-toggle::before');
    expect(css).toContain('inset: 4px');
    expect(css).toContain('background: var(--dash-chrome-hover)');
    expect(css).not.toMatch(
      /\.dashboard-nav-toggle\[aria-expanded='true'\][^{]*\{[^}]*(?:background|border-color|color):/s,
    );
    expect(css).not.toContain('dashboard-nav-toggle-icon__state');
    expect(css).not.toContain('dashboard-nav-toggle__bar');
    expect(css).not.toContain('Uiverse');
    expect(css).toContain('color: var(--dash-muted)');
    expect(css).toContain('border: 1px solid var(--dash-control-line)');
    expect(css).toContain('color: var(--dash-heat-ink-4)');
  });

  it('provides collapsed tooltips, a single theme menu, and reduced-motion fallbacks', () => {
    expect(app).toContain('dashboard-nav-tooltip');
    expect(app).toContain('onMouseEnter={(event) => showNavTooltip');
    expect(app).toContain('onFocus={(event) => showNavTooltip');
    expect(app).toContain("if (event.key === 'Escape')");
    expect(css).toContain('position: fixed');
    expect(css).toContain('.dashboard-nav-tooltip.is-visible');

    expect(appearance).toContain("export type DashboardThemeMode = 'system' | 'light' | 'dark'");
    expect(appearance).toContain('DASHBOARD_THEME_TOKENS');
    expect(appearance).toContain('focusAdjacentTabbable');
    expect(app).toContain('aria-haspopup="menu"');
    expect(app).toContain('role="menuitemradio"');
    expect(app).toContain('dashboard-theme-trigger');
    expect(app).toContain("tabIndex={index === rovingIndex ? 0 : -1}");
    expect(app).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    expect(app).toContain("media.addEventListener('change', update)");
    expect(app).toContain('data-theme-mode={themeMode}');
    expect(app).toContain('data-theme={resolvedTheme}');
    expect(app).toContain('colorScheme: resolvedTheme');
    expect(app).toContain("closeMenu('dismiss')");
    expect(app).toContain("closeMenu(event.shiftKey ? 'tab-backward' : 'tab-forward')");
    expect(rendererMain).toContain("resolveDashboardTheme('system', systemPrefersDark)");
    expect(rendererMain).toContain("document.documentElement.dataset.dashboardThemeMode = 'system'");
    expect(app).not.toMatch(/localStorage|sessionStorage|indexedDB|customerAgent/);
    expect(css).toContain('color-scheme: inherit');
    expect(css).toContain("html[data-role='dashboard'][data-dashboard-theme='light'] .dashboard-shell :is(button");
    expect(css).toContain('--dash-ink: #24212a');
    expect(css).toContain('--dash-ink: #f5f3f7');
    expect(css).toContain('--dash-disabled-bg: #f5f3f6');
    expect(css).toContain('--dash-disabled-bg: #27242a');
    expect(css).toContain('min-width: 40px');
    expect(css).toContain('min-height: 40px');
    expect(css).toContain('border-radius: var(--dash-radius-pill)');
    expect(css).not.toContain('border-radius: 5px');
    expect(css).toContain('.overview-ranked-list li:first-child');
    expect(css).not.toMatch(/\.overview-scope-summary\s*\{[^}]*border-top:/s);
    expect(css).not.toMatch(/\.overview-scope-summary > div\s*\{[^}]*border-left:/s);
    expect(css).toContain('background: Canvas');
    expect(css).toContain('color: CanvasText');

    expect(css).toContain('@media (hover: none)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('-webkit-backdrop-filter: none');
    expect(css).toContain('.dashboard-nav-toggle-icon,');
    expect(css).toContain('.dashboard-nav-resizer::before,');
    expect(css).toContain('.dashboard-nav-tooltip,');
    expect(css).toContain('.dashboard-theme-popover {');
    expect(css).toContain('.dashboard-theme-trigger,');
    expect(css).toContain('[role=\'menuitemradio\'][aria-checked=\'true\']');
    expect(css).toContain('transition: none');

    const transitionValues = [...css.matchAll(/transition\s*:\s*([^;]+);/g)].map((match) => match[1]);
    expect(transitionValues).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/backdrop-filter|\bfilter\b|box-shadow|padding|margin|border-width/),
    ]));
    expect(
      findTransitionAllRisks(css),
      'Dashboard CSS must not use transition: all, including var() fallbacks and earlier scoped custom properties',
    ).toEqual([]);
    expect(css).toContain("[data-nav-phase='expanding']");
    expect(css).toContain('.dashboard-nav-label');
    expect(css).toContain('.dashboard-brand-copy');
    expect(css).toContain("[data-nav-phase='collapsed'] .dashboard-brand-copy");
  });

  it('keeps announce simulation local, transient, and timer-cleaned', () => {
    expect(announce).toContain('window.setTimeout');
    expect(announce).toContain('window.clearTimeout');
    expect(announce).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|customerAgent/);
  });

  it('fail-closes transition-all via direct values, var fallbacks, and earlier scoped custom properties', () => {
    const currentRisks = findTransitionAllRisks(css);
    expect(currentRisks, 'current dashboard.css must stay free of transition all').toEqual([]);

    const commentAndStringCss = `
      /* transition: all 190ms ease; */
      /* --dash-motion: all; */
      .safe {
        content: "transition: all 190ms";
        content: 'transition-property: all';
        transition: opacity 190ms ease;
      }
    `;
    expect(parseCssDeclarations(commentAndStringCss).map((item) => item.property)).toEqual([
      'content',
      'content',
      'transition',
    ]);
    expect(findTransitionAllRisks(commentAndStringCss)).toEqual([]);

    const dangerousFixtures: Array<{ name: string; source: string }> = [
      {
        name: 'direct shorthand all',
        source: '.x { transition: all 190ms ease; }',
      },
      {
        name: 'duration-first shorthand all',
        source: '.x { transition: 190ms all ease; }',
      },
      {
        name: 'transition-property all',
        source: '.x { transition-property: opacity, all; }',
      },
      {
        name: 'missing var fallback all',
        source: '.x { transition: var(--missing, all) 190ms ease; }',
      },
      {
        name: 'nested missing var fallback all',
        source: '.x { transition: var(--missing, var(--also-missing, all)) 190ms ease; }',
      },
      {
        name: 'earlier scoped custom property all not overwritten by a later safe value',
        source: `
          .scope-danger { --dash-motion-prop: all; }
          .scope-safe { --dash-motion-prop: opacity; }
          .uses-it { transition: var(--dash-motion-prop) 190ms ease; }
        `,
      },
      {
        name: 'later scoped custom property all still counted',
        source: `
          .scope-safe { --dash-motion-prop: opacity; }
          .scope-danger { --dash-motion-prop: all; }
          .uses-it { transition: var(--dash-motion-prop) 190ms ease; }
        `,
      },
    ];

    for (const fixture of dangerousFixtures) {
      const risks = findTransitionAllRisks(fixture.source);
      expect(risks.length, `${fixture.name} must fail-closed`).toBeGreaterThan(0);
      expect(
        risks.some((risk) => risk.resolved.toLowerCase().includes('all') || /all/i.test(risk.value)),
        `${fixture.name} must report an all risk, got ${JSON.stringify(risks)}`,
      ).toBe(true);
    }

    const definedSafeVar = `
      .x {
        --ok-prop: opacity;
        transition: var(--ok-prop, all) 190ms ease;
      }
    `;
    expect(findTransitionAllRisks(definedSafeVar)).toEqual([]);

    const overwritten = collectCssCustomPropertyValues(`
      .a { --dash-motion-prop: all; }
      .b { --dash-motion-prop: opacity; }
    `);
    expect(overwritten.get('--dash-motion-prop')).toEqual(['all', 'opacity']);
  });
});
