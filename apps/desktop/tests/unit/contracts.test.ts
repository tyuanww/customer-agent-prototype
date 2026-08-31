import { describe, expect, it } from 'vitest';
import { COPY_SUCCESS_MESSAGE, IPC_CHANNEL_WHITELIST, IPC_CHANNELS } from '../../src/shared/contracts';

describe('IPC whitelist', () => {
  it('only allows the typed overlay and clipboard channels', () => {
    expect(IPC_CHANNEL_WHITELIST).toEqual([
      IPC_CHANNELS.COPY_TEXT,
      IPC_CHANNELS.GET_WINDOW_CONTEXT,
      IPC_CHANNELS.OPEN_SEARCH,
      IPC_CHANNELS.OPEN_DASHBOARD,
      IPC_CHANNELS.DISMISS,
      IPC_CHANNELS.REPORT_UI_PHASE,
      IPC_CHANNELS.REPORT_HANDOFF_MILESTONE,
      IPC_CHANNELS.REPORT_QUERY_LAYOUT,
      IPC_CHANNELS.RESIZE_QUERY_HEIGHT,
      IPC_CHANNELS.MOVE_FOX_BY,
      IPC_CHANNELS.COMMIT_FOX_DRAG_SETTLE,
      IPC_CHANNELS.SET_FOX_PEEK,
      IPC_CHANNELS.OVERLAY_COMMAND,
    ]);
    expect(new Set(IPC_CHANNEL_WHITELIST).size).toBe(IPC_CHANNEL_WHITELIST.length);
  });

  it('uses 已复制 as the only success copy label', () => {
    expect(COPY_SUCCESS_MESSAGE).toBe('已复制');
    expect(COPY_SUCCESS_MESSAGE).not.toContain('已发送');
  });
});
