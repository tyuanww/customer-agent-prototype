import type {
  FoxPeekIntent,
  FoxVisualTransform,
  HandoffMilestone,
  OverlayCommand,
  WindowContext,
} from './overlay-events';
import type { ReportablePhase, ResultCount } from './overlay-events';
import type { CopyTextResult, PlatformInfo } from './contracts-types';

export type {
  CopyTextResult,
  PlatformInfo,
  PlatformName,
} from './contracts-types';

export { IPC_CHANNELS, IPC_CHANNEL_WHITELIST } from './ipc-channels';
export type { IpcChannel } from './ipc-channels';

export type CustomerAgentApi = {
  copyText: (text: string) => Promise<CopyTextResult>;
  getPlatform: () => Promise<PlatformInfo>;
  getWindowContext: () => Promise<WindowContext>;
  openSearch: (visualTransform?: FoxVisualTransform) => Promise<void>;
  openDashboard: () => Promise<void>;
  dismiss: () => Promise<void>;
  reportUiPhase: (phase: ReportablePhase, resultCount?: ResultCount) => Promise<void>;
  reportHandoffMilestone?: (handoffId: number, milestone: HandoffMilestone) => Promise<void>;
  moveFoxBy: (deltaX: number, deltaY: number, finished?: boolean) => Promise<void>;
  setFoxPeek: (intent: FoxPeekIntent, epoch: number) => Promise<void>;
  onOverlayCommand: (handler: (command: OverlayCommand) => void) => () => void;
};

export const COPY_SUCCESS_MESSAGE = '已复制';
export const FORBIDDEN_COPY_PHRASES = ['已发送', '已采纳', '已解决'] as const;

export const MAX_QUERY_CHARS = 2000;
export const QUERY_TOO_LONG_MESSAGE = '客户问题最多 2000 字，请精简后再查找';
export const EMPTY_QUERY_MESSAGE = '请输入客户问题后再查询';
