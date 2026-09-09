import type { ProductSearchApi } from './product-search';
import type { OpenDashboardResult } from './dashboard-access';
import type {
  FoxDragSettleAck,
  FoxPeekIntent,
  FoxVisualTransform,
  HandoffMilestone,
  OverlayCommand,
  ReportablePhase,
  ResultCount,
  WindowContext,
} from './overlay-events';
import type {
  QueryLayoutAck,
  QueryLayoutRequest,
  QueryResizeRequest,
} from './query-layout';

export type CopyTextResult =
  | { ok: true }
  | { ok: false; message: string };
export type { OpenDashboardResult } from './dashboard-access';
export {
  OPEN_DASHBOARD_FAILURE_MESSAGE,
  isOpenDashboardResult,
  openDashboardUnavailable,
} from './dashboard-access';

export { IPC_CHANNELS, IPC_CHANNEL_WHITELIST } from './ipc-channels';
export type { IpcChannel } from './ipc-channels';

export type CustomerAgentApi = {
  product?: import('./product-session').ProductSessionApi;
  productSearch?: ProductSearchApi;
  productAnnounce?: import('./product-announce').ProductAnnounceApi;
  productHelp?: import('./product-help').ProductHelpApi;
  productCatalog?: import('./product-catalog').ProductCatalogApi;
  copyText: (text: string) => Promise<CopyTextResult>;
  getWindowContext: () => Promise<WindowContext>;
  openSearch: (visualTransform?: FoxVisualTransform) => Promise<void>;
  openDashboard: () => Promise<OpenDashboardResult>;
  dismiss: () => Promise<void>;
  reportUiPhase: (phase: ReportablePhase, resultCount?: ResultCount) => Promise<void>;
  reportHandoffMilestone?: (handoffId: number, milestone: HandoffMilestone) => Promise<void>;
  reportQueryLayout?: (request: QueryLayoutRequest) => Promise<QueryLayoutAck>;
  resizeQueryHeight?: (request: QueryResizeRequest) => Promise<QueryLayoutAck>;
  moveFoxBy: (
    deltaX: number,
    deltaY: number,
    finished?: boolean,
    generation?: number,
  ) => Promise<FoxDragSettleAck | null>;
  commitFoxDragSettle: (settleId: number) => Promise<void>;
  setFoxPeek: (intent: FoxPeekIntent, epoch: number) => Promise<void>;
  onOverlayCommand: (handler: (command: OverlayCommand) => void) => () => void;
};

export const COPY_SUCCESS_MESSAGE = '已复制';
export const FORBIDDEN_COPY_PHRASES = ['已发送', '已采纳', '已解决'] as const;

export const MAX_QUERY_CHARS = 2000;
export const QUERY_TOO_LONG_MESSAGE = '客户问题最多 2000 字，请精简后再查找';
export const EMPTY_QUERY_MESSAGE = '请输入客户问题后再查询';
