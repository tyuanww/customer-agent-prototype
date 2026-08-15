import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLOBAL_ACCELERATOR,
  bindGlobalShortcut,
  describeShortcutFailure,
  formatAcceleratorLabel,
} from '../../src/shared/shortcut';

describe('global shortcut binding', () => {
  it('uses a cross-platform default accelerator', () => {
    expect(DEFAULT_GLOBAL_ACCELERATOR).toBe('CommandOrControl+Shift+Space');
    expect(formatAcceleratorLabel(DEFAULT_GLOBAL_ACCELERATOR, 'darwin')).toContain('⌘');
    expect(formatAcceleratorLabel(DEFAULT_GLOBAL_ACCELERATOR, 'win32')).toContain('Ctrl');
  });

  it('returns a visible failure message instead of failing silently', () => {
    const register = vi.fn(() => false);
    const result = bindGlobalShortcut(register, DEFAULT_GLOBAL_ACCELERATOR, 'darwin');
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain('注册失败');
    expect(result.message).toContain('点击狐狸头');
    expect(result.message).toBe(
      describeShortcutFailure(DEFAULT_GLOBAL_ACCELERATOR, 'darwin'),
    );
  });

  it('records success when Electron accepts the accelerator', () => {
    const register = vi.fn(() => true);
    expect(bindGlobalShortcut(register)).toEqual({
      ok: true,
      accelerator: DEFAULT_GLOBAL_ACCELERATOR,
    });
    expect(register).toHaveBeenCalledWith(DEFAULT_GLOBAL_ACCELERATOR);
  });
});
