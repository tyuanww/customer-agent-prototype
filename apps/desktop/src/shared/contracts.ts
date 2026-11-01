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
import type { QuerySopWindowApi } from './sop-window';

export type CopyTextResult =
  | { ok: true }
  | { ok: true; copyGeneration: number }
  | { ok: true; feedbackSyncFailed: true }
  | { ok: false; message: string };
export function isCopyTextResult(value: unknown): value is CopyTextResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('ok' in value)) return false;
  const fields = Object.keys(value);
  if (value.ok === false) return fields.length === 2 && 'message' in value && typeof value.message === 'string' && value.message.length > 0;
  if (value.ok !== true) return false;
  if (fields.length === 1) return true;
  if (fields.length !== 2) return false;
  return ('copyGeneration' in value && typeof value.copyGeneration === 'number' && Number.isSafeInteger(value.copyGeneration) && value.copyGeneration > 0)
    || ('feedbackSyncFailed' in value && value.feedbackSyncFailed === true);
}
export type { OpenDashboardResult } from './dashboard-access';
export {
  OPEN_DASHBOARD_FAILURE_MESSAGE,
  isOpenDashboardResult,
  openDashboardUnavailable,
} from './dashboard-access';

export { IPC_CHANNELS, IPC_CHANNEL_WHITELIST } from './ipc-channels';
export type { IpcChannel } from './ipc-channels';

export type CustomerAgentApi = {
  intakeQuery?: import('./content-intake-query').IntakeQueryApi;
  product?: import('./product-session').ProductSessionApi;
  productSearch?: ProductSearchApi;
  productAnnounce?: import('./product-announce').ProductAnnounceApi;
  productHelp?: import('./product-help').ProductHelpApi;
  productCatalog?: import('./product-catalog').ProductCatalogApi;
  copyText: (text: string) => Promise<CopyTextResult>;
  getWindowContext: () => Promise<WindowContext>;
  openSearch: (visualTransform?: FoxVisualTransform) => Promise<void>;
  openDashboard: () => Promise<OpenDashboardResult>;
  dismiss: (restorePreviousApp?: boolean) => Promise<void>;
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
  sopWindow?: QuerySopWindowApi;
};

export const COPY_SUCCESS_MESSAGE = '已复制';
export const FORBIDDEN_COPY_PHRASES = ['已发送', '已采纳', '已解决'] as const;

export const MAX_QUERY_CHARS = 2000;
export const QUERY_TOO_LONG_MESSAGE = '客户问题最多 2000 字，请精简后再查找';
export const EMPTY_QUERY_MESSAGE = '请输入客户问题后再查询';
