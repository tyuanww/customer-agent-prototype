export const IPC_CHANNELS = {
  COPY_TEXT: 'clipboard:copy-text',
  GET_WINDOW_CONTEXT: 'overlay:get-window-context',
  OPEN_SEARCH: 'overlay:open-search',
  OPEN_DASHBOARD: 'dashboard:open',
  DISMISS: 'overlay:dismiss',
  REPORT_UI_PHASE: 'overlay:report-ui-phase',
  REPORT_HANDOFF_MILESTONE: 'overlay:report-handoff-milestone',
  REPORT_QUERY_LAYOUT: 'overlay:report-query-layout',
  RESIZE_QUERY_HEIGHT: 'overlay:resize-query-height',
  MOVE_FOX_BY: 'overlay:move-fox-by',
  COMMIT_FOX_DRAG_SETTLE: 'overlay:commit-fox-drag-settle',
  SET_FOX_PEEK: 'overlay:set-fox-peek',
  OVERLAY_COMMAND: 'overlay:command',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_CHANNEL_WHITELIST: readonly IpcChannel[] = Object.freeze(
  Object.values(IPC_CHANNELS),
);
