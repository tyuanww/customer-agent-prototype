import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { DASHBOARD_FONT_FAMILY } from '../../src/renderer/features/dashboard/intake-antd';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('dashboard theme', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('paints the workbench shell with the shared font stack and hides the intake profile names', () => {
    render(<DashboardApp />);
    expect(screen.getByTestId('dashboard-shell').style.fontFamily).toBe(DASHBOARD_FONT_FAMILY);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('synthetic-local');
    expect(text).not.toContain('faq-v2');

    const deskChrome = readFileSync(resolve(desktopRoot, 'src/renderer/features/dashboard/desk-chrome.css'), 'utf8');
    const workbench = readFileSync(resolve(desktopRoot, 'src/renderer/features/dashboard/workbench-v9.css'), 'utf8');
    const intakeManagement = readFileSync(resolve(desktopRoot, 'src/renderer/features/dashboard/intake-management.css'), 'utf8');
    expect(deskChrome).not.toContain('system-ui');
    expect(deskChrome).not.toContain('#1d1b26');
    expect(workbench).not.toContain('system-ui');
    expect(workbench).not.toContain('#1d1b26');
    expect(intakeManagement).not.toContain('system-ui');
    expect(workbench).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(intakeManagement).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(deskChrome).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
