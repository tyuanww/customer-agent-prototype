export const IPC_CHANNELS = {
  COPY_TEXT: 'clipboard:copy-text',
  GET_PLATFORM: 'app:get-platform',
  GET_WINDOW_CONTEXT: 'overlay:get-window-context',
  OPEN_SEARCH: 'overlay:open-search',
  OPEN_DASHBOARD: 'dashboard:open',
  DISMISS: 'overlay:dismiss',
  REPORT_UI_PHASE: 'overlay:report-ui-phase',
  REPORT_HANDOFF_MILESTONE: 'overlay:report-handoff-milestone',
  MOVE_FOX_BY: 'overlay:move-fox-by',
  SET_FOX_PEEK: 'overlay:set-fox-peek',
  OVERLAY_COMMAND: 'overlay:command',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_CHANNEL_WHITELIST: readonly IpcChannel[] = Object.freeze(
  Object.values(IPC_CHANNELS),
);
