import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_ENV_BADGES,
  DASHBOARD_STRUCTURE_DISCLAIMER,
  DASHBOARD_WINDOW_CHROME,
  DASHBOARD_WINDOW_SECURITY,
} from '../../src/shared/dashboard-window';

describe('dashboard window contract', () => {
  it('uses a standard framed desktop window instead of an overlay panel', () => {
    expect(DASHBOARD_WINDOW_CHROME).toMatchObject({
      width: 1180,
      height: 760,
      minWidth: 980,
      minHeight: 680,
      frame: true,
      transparent: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
    });
    expect(DASHBOARD_WINDOW_SECURITY).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    });
    expect('preload' in DASHBOARD_WINDOW_SECURITY).toBe(false);
  });

  it('uses one visible demo marker while keeping the non-Dafuyan boundary explicit', () => {
    expect(DASHBOARD_ENV_BADGES).toEqual(['演示数据']);
    expect(DASHBOARD_STRUCTURE_DISCLAIMER).toBe(
      '无后端 · 不保存 · 话术正文与 VOC 明细均为合成镜像',
    );
  });
});
