import { describe, expect, it } from 'vitest';
import { COPY_SUCCESS_MESSAGE, IPC_CHANNEL_WHITELIST, IPC_CHANNELS } from '../../src/shared/contracts';
import { ALLOWED_HELP_STATUS, FORBIDDEN_HELP_PHRASES } from '../../src/shared/product-help';

describe('IPC whitelist', () => {
  it('only allows the typed overlay and clipboard channels', () => {
    expect(IPC_CHANNEL_WHITELIST).toEqual([
      IPC_CHANNELS.PRODUCT_SEARCH,
      IPC_CHANNELS.PRODUCT_CANCEL_SEARCH,
      IPC_CHANNELS.PRODUCT_COPY_ADOPT,
      IPC_CHANNELS.PRODUCT_SESSION_STATUS,
      IPC_CHANNELS.PRODUCT_LOGIN,
      IPC_CHANNELS.PRODUCT_LOGOUT,
      IPC_CHANNELS.PRODUCT_SESSION_CHANGED,
      IPC_CHANNELS.PRODUCT_ANNOUNCE_REFRESH,
      IPC_CHANNELS.PRODUCT_ANNOUNCE_INVALIDATED,
      IPC_CHANNELS.PRODUCT_ESCALATE,
      IPC_CHANNELS.PRODUCT_RECORD_TERMINAL,
      IPC_CHANNELS.PRODUCT_CATALOG,
      IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_GET,
      IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_SET,
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

  it('keeps help status off transfer-success copy', () => {
    expect(ALLOWED_HELP_STATUS).toEqual(['待核实', '已打开入口', '已复制联系方式']);
    for (const phrase of FORBIDDEN_HELP_PHRASES) {
      expect(ALLOWED_HELP_STATUS.join('\n')).not.toContain(phrase);
    }
  });
});
