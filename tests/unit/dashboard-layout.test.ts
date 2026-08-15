import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'src/renderer/styles/dashboard.css'), 'utf8');
const app = readFileSync(path.join(root, 'src/renderer/DashboardApp.tsx'), 'utf8');
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
  it('keeps a white-first light palette and a semantic dark palette', () => {
    expect(css).toContain('--dash-surface: light-dark(#ffffff, #1c1a1f)');
    expect(css).toContain('--dash-sidebar: light-dark(#fbfafd, #17151a)');
    expect(css).toContain('--dash-purple: light-dark(#6f4cc3, #a78bfa)');
    expect(css).toContain('--dash-control-line: light-dark(#8e8797, #8f8798)');
    expect(css).toContain('--dash-heat-ink-4: light-dark(#21152f, #15121a)');
    expect(css).toContain("html[data-role='dashboard'][data-dashboard-theme='light']");
    expect(css).toContain("html[data-role='dashboard'][data-dashboard-theme='dark']");
    expect(css).not.toMatch(/background:\s*linear-gradient/);
    expect(charts).not.toContain('<linearGradient');
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
    expect(app).toContain('<FoxHead size={38} className="dashboard-brand-fox" />');
    expect(app).not.toContain('dashboard-brand-mark');
    expect(app).not.toContain('<small>{item.blurb}</small>');
    expect(app).not.toContain('Manager Decision Desk');
    expect(css).toContain('grid-template-columns: var(--dashboard-nav-width, 248px) minmax(0, 1fr)');
    expect(css).toContain('min-height: 42px');
    expect(css).toContain('border-left: 3px solid transparent');
    expect(css).toContain('border-left-color: var(--dash-purple)');
  });

  it('keeps standard panels flat, bordered, and consistently rounded', () => {
    expect(css).toContain('--dash-panel-radius: 8px');
    expect(css).toContain('border-radius: var(--dash-panel-radius)');
    const cardRule = css.match(/\.dash-card,\s*\n\.arch-card\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(cardRule).toContain('border: 1px solid var(--dash-line)');
    expect(cardRule).toContain('background: var(--dash-surface)');
    expect(cardRule).not.toContain('box-shadow');
    expect(css).not.toMatch(/backdrop-filter|drop-shadow/);
    expect(css).toContain('.health-strip');
    expect(css).toContain('.manager-decision-table');
    expect(css).toContain('.dashboard-banners .env-badge');
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
    expect(app).toContain("data-variant={navCollapsed ? 'expand-overlay' : 'collapse'}");
    expect(app).toContain('aria-disabled="true"');
    expect(app).toContain('role="separator"');
    expect(app).toContain('aria-label="调整工作台侧栏宽度"');
    expect(app).toContain('aria-valuemin={DASHBOARD_NAV_MIN_WIDTH}');
    expect(app).toContain('aria-valuemax={navMaxWidth}');
    expect(app).toContain('aria-valuenow={navWidth}');
    expect(app).toContain('onPointerDown={startNavResize}');
    expect(app).toContain('onPointerMove={moveNavResize}');
    expect(app).toContain('onPointerCancel={endNavResize}');
    expect(app).toContain('onLostPointerCapture={finishNavResize}');
    expect(app).toContain('onKeyDown={handleNavResizeKey}');
    expect(css).toContain('.dashboard-shell.is-nav-collapsed');
    expect(css).toContain('grid-template-columns: 72px minmax(0, 1fr)');
    expect(css).toContain(".dashboard-shell[data-nav-resizing='true']");
    expect(css).toContain('.dashboard-nav-resizer');
    expect(css).toContain('cursor: col-resize');
    expect(css).toContain('touch-action: none');
    expect(css).toContain('.dashboard-nav-toggle.is-expand-overlay');
    expect(css).toContain('.dashboard-brand:hover .dashboard-nav-toggle.is-expand-overlay');
    expect(css).toContain('.dashboard-brand:focus-within .dashboard-nav-toggle.is-expand-overlay');
    expect(css).toContain('.dashboard-brand-logo,');
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
    expect(app).toContain('dashboard-nav-toggle-icon__state is-close');
    expect(app).toContain('dashboard-nav-toggle-icon__state is-open');
    expect(app).not.toContain('dashboard-nav-toggle__bar');
    expect(app).not.toContain('Tornado');
    expect(app).not.toContain('type="checkbox"');
    expect(css).toContain('--nav-toggle-control-size: 40px');
    expect(css).toContain('.dashboard-nav-toggle-icon__state.is-close');
    expect(css).toContain('.dashboard-nav-toggle-icon__state.is-open');
    expect(css).not.toContain('dashboard-nav-toggle__bar');
    expect(css).not.toContain('Uiverse');
    expect(css).toContain('color: var(--dash-muted)');
    expect(css).toContain('border: 1px solid var(--dash-control-line)');
    expect(css).toContain('color: var(--dash-heat-ink-4)');
  });

  it('provides collapsed tooltips, three theme modes, and reduced-motion fallbacks', () => {
    expect(app).toContain('dashboard-nav-tooltip');
    expect(app).toContain('onMouseEnter={(event) => showNavTooltip');
    expect(app).toContain('onFocus={(event) => showNavTooltip');
    expect(app).toContain("if (event.key === 'Escape')");
    expect(css).toContain('position: fixed');
    expect(css).toContain('.dashboard-nav-tooltip.is-visible');

    expect(appearance).toContain("export type DashboardThemeMode = 'system' | 'light' | 'dark'");
    expect(app).toContain('DASHBOARD_THEME_OPTIONS.map');
    expect(app).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    expect(app).toContain("media.addEventListener('change', update)");
    expect(app).toContain('data-theme-mode={themeMode}');
    expect(app).toContain('data-theme={resolvedTheme}');
    expect(rendererMain).toContain("resolveDashboardTheme('system', systemPrefersDark)");
    expect(rendererMain).toContain("document.documentElement.dataset.dashboardThemeMode = 'system'");
    expect(app).not.toMatch(/localStorage|sessionStorage|indexedDB|customerAgent/);

    expect(css).toContain('@media (hover: none)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.dashboard-nav-toggle-icon__state,');
    expect(css).toContain('.dashboard-nav-resizer::before,');
    expect(css).toContain('.dashboard-nav-tooltip,');
    expect(css).toContain('.dashboard-theme-switcher button,');
    expect(css).toContain('transition: none');
  });

  it('keeps announce simulation local, transient, and timer-cleaned', () => {
    expect(announce).toContain('window.setTimeout');
    expect(announce).toContain('window.clearTimeout');
    expect(announce).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|customerAgent/);
  });
});
