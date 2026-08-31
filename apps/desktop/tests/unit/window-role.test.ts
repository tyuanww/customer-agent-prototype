import { describe, expect, it } from 'vitest';
import { isRendererRole } from '../../src/shared/overlay-events';
import { readRoleFromLocation } from '../../src/renderer/lib/window-role';

describe('window role routing', () => {
  it('accepts fox, query, and dashboard roles', () => {
    expect(isRendererRole('fox')).toBe(true);
    expect(isRendererRole('query')).toBe(true);
    expect(isRendererRole('dashboard')).toBe(true);
    expect(isRendererRole('admin')).toBe(false);
    expect(readRoleFromLocation('?role=fox')).toBe('fox');
    expect(readRoleFromLocation('?role=dashboard')).toBe('dashboard');
    expect(readRoleFromLocation('?role=nope')).toBe('query');
  });
});
