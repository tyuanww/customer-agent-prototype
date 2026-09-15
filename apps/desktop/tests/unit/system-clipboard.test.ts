import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn(), readText: vi.fn(() => '') },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 1 })) };
});

import { clipboard } from 'electron';
import { writeSystemClipboard } from '../../src/main/system-clipboard';

describe('system clipboard', () => {
  it('accepts an Electron write that sticks', () => {
    vi.mocked(clipboard.writeText).mockImplementation(() => undefined);
    vi.mocked(clipboard.readText).mockReturnValue('合成联系卡');
    writeSystemClipboard('合成联系卡');
    expect(clipboard.writeText).toHaveBeenCalledWith('合成联系卡');
  });

  it('throws when Electron write does not stick and the platform fallback fails', () => {
    if (process.platform === 'darwin') return;
    vi.mocked(clipboard.writeText).mockImplementation(() => undefined);
    vi.mocked(clipboard.readText).mockReturnValue('');
    expect(() => writeSystemClipboard('合成联系卡')).toThrow(/did not stick/);
  });
});
