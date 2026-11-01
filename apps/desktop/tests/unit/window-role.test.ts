import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRendererRole } from '../../src/shared/overlay-events';
import { readRoleFromLocation } from '../../src/renderer/lib/window-role';

const appSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer/App.tsx'),
  'utf8',
);
const querySource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer/QueryApp.tsx'),
  'utf8',
);
const queryResultsSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer/features/search/QueryResultsPane.tsx'),
  'utf8',
);

describe('window role routing', () => {
  it('accepts fox, query, and dashboard roles', () => {
    expect(isRendererRole('fox')).toBe(true);
    expect(isRendererRole('query')).toBe(true);
    expect(isRendererRole('dashboard')).toBe(true);
    expect(isRendererRole('login')).toBe(true);
    expect(isRendererRole('sop')).toBe(false);
    expect(isRendererRole('admin')).toBe(false);
    expect(readRoleFromLocation('?role=fox')).toBe('fox');
    expect(readRoleFromLocation('?role=dashboard')).toBe('dashboard');
    expect(readRoleFromLocation('?role=nope')).toBe('query');
  });

  it('does not eagerly load the login window into the overlay renderer', () => {
    expect(appSource).not.toContain("import { LoginApp }");
    expect(appSource).toContain("import('./LoginApp')");
  });

  it('has no retired standalone SOP route', () => {
    expect(appSource).not.toContain("from './SopApp'");
    expect(isRendererRole('sop-floating')).toBe(true);
    expect(appSource).not.toContain("resolved === 'sop'");
  });

  it('keeps Query free of the SOP tree fixture', () => {
    expect(querySource).not.toContain('synthetic-sops');
    expect(queryResultsSource).not.toContain('synthetic-sops');
  });
});
