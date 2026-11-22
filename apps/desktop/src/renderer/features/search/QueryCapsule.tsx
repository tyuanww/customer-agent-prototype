import { useId, type Ref } from 'react';
import { MAX_QUERY_CHARS } from '@shared/contracts';
import { FoxHead } from '../../components/FoxHead';
import { useWindowDrag } from '../../lib/use-window-drag';
import {
  QUERY_PLACEHOLDER_SIGNED_IN,
  QUERY_PLACEHOLDER_UNSIGNED,
  type QueryFoxVisualState,
  type SessionNotice,
} from './query-view';

type QueryCapsuleProps = {
  productControl?: React.ReactNode;
  scopeControl?: {
    context: { shop: string; filterCount: number } | null;
    description: string;
    panelId: string;
    open: boolean;
    onToggle: () => void;
  };
  manualSopControl?: React.ReactNode;
  manualSopError?: string;
  intake?: boolean;
  foxVisualState: QueryFoxVisualState;
  foxDrag: ReturnType<typeof useWindowDrag>;
  deepThinkingDescription: string;
  smartEnabled: boolean;
  query: string;
  inputRef: Ref<HTMLInputElement>;
  invalidMessage: string;
  sessionNotice: SessionNotice | null;
  searching: boolean;
  scopePending?: boolean;
  signedIn: boolean;
  inputIdle: boolean;
  onCancelScheduledResultFocus: () => void;
  onCancelScheduledInputFocus: () => void;
  onChangeQuery: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onOpenDashboard: () => void;
  onToggleSmartRetrieval: () => void;
  onSearch: () => void;
};

export function QueryCapsule({
  productControl,
  scopeControl,
  manualSopControl,
  manualSopError,
  intake = false,
  foxVisualState,
  foxDrag,
  deepThinkingDescription,
  smartEnabled,
  query,
  inputRef,
  invalidMessage,
  sessionNotice,
  searching,
  scopePending = false,
  signedIn,
  inputIdle,
  onCancelScheduledResultFocus,
  onCancelScheduledInputFocus,
  onChangeQuery,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
  onOpenDashboard,
  onToggleSmartRetrieval,
  onSearch,
}: QueryCapsuleProps) {
  const scopeDescriptionId = useId();
  const blockingSessionHint = sessionNotice && (sessionNotice.kind === 'failed' || sessionNotice.kind === 'expired'
    || sessionNotice.kind === 'waiting') ? sessionNotice : null;
  const sessionHint = blockingSessionHint
    ?? (intake && sessionNotice?.kind === 'success' && !manualSopError ? sessionNotice : null);
  const guidance = invalidMessage || sessionHint || manualSopError ? (
    <p id="query-guidance" className="capsule-hint" aria-live="polite">
      {invalidMessage ? (
        <span className="validation-error" data-testid="validation-error">{invalidMessage}</span>
      ) : sessionHint ? (
        <span className={`session-notice is-${sessionHint.kind}`} data-testid={`session-notice-${sessionHint.kind}`} role="status">
          {sessionHint.text}
        </span>
      ) : <span className="validation-error" role="status">{manualSopError}</span>}
    </p>
  ) : null;
  const scopeContext = signedIn ? scopeControl?.context : null;

  return (
        <div className="query-capsule" data-intake={intake ? true : undefined}>
          <button
            type="button"
            className="capsule-fox"
            data-testid="capsule-fox"
            data-fox-state={foxVisualState}
            aria-label="点击收起查询，拖拽移动查询窗"
            title="点击收起 · 拖拽移动"
            {...foxDrag}
          >
            <FoxHead size={64} className={`is-query-${foxVisualState.toLowerCase()}`} />
            <span className="fox-focus-ring" aria-hidden="true" data-testid="query-fox-focus-ring" />
          </button>
          <div className="capsule-field">
            <label className="sr-only" htmlFor="customer-question">
              客户问题
            </label>
            <input
                id="customer-question"
                ref={inputRef}
                className="capsule-input"
                data-testid="question-input"
                value={query}
                maxLength={intake ? undefined : MAX_QUERY_CHARS}
                autoComplete="off"
                aria-describedby={invalidMessage || blockingSessionHint ? 'query-guidance' : undefined}
                aria-invalid={invalidMessage ? true : undefined}
                spellCheck={false}
                readOnly={inputIdle}
                tabIndex={inputIdle ? -1 : 0}
                placeholder={signedIn ? QUERY_PLACEHOLDER_SIGNED_IN : QUERY_PLACEHOLDER_UNSIGNED}
                onPointerDown={onCancelScheduledResultFocus}
                onFocus={onCancelScheduledResultFocus}
                onBeforeInput={onCancelScheduledInputFocus}
                onChange={(event) => {
                  onChangeQuery(event.target.value);
                }}
                onCompositionStart={() => {
                  onCancelScheduledInputFocus();
                  onCompositionStart();
                }}
                onCompositionEnd={() => {
                  onCompositionEnd();
                }}
                onKeyDown={onKeyDown}
              />
            {!intake ? <span id="deep-thinking-description" className="sr-only">
              {deepThinkingDescription}
            </span> : null}
            <div className="capsule-meta">
              {!intake ? guidance : null}
              <div className="capsule-tools">
                {productControl}
                {!intake ? <button
                  type="button"
                  className="dashboard-entry"
                  data-testid="open-dashboard"
                  aria-label="打开运营工作台"
                  title="打开运营工作台"
                  onClick={onOpenDashboard}
                >
                  <svg
                    className="dashboard-entry-icon"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.25" />
                    <path d="M3 7.25h14M7.25 7.5v9" />
                    <path d="M10 10.25h4.5M10 13.25h3" />
                  </svg>
                </button> : null}
                {scopeControl ? <>
                  <button
                    type="button"
                    className="intake-filter-toggle query-scope-toggle"
                    data-query-scope-toggle
                    data-selected={scopeContext ? true : undefined}
                    disabled={!signedIn}
                    aria-expanded={scopeControl.open}
                    aria-controls={scopeControl.open ? scopeControl.panelId : undefined}
                    aria-describedby={signedIn ? scopeDescriptionId : undefined}
                    title={signedIn && scopeContext ? scopeControl.description : undefined}
                    onFocus={onCancelScheduledResultFocus}
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      scopeControl.onToggle();
                    }}
                  >
                    <span className="query-scope-label">查询范围</span>
                    {scopeContext ? <>
                      <span className="query-scope-shop" aria-hidden="true">{scopeContext.shop}</span>
                      {scopeContext.filterCount > 0 ? <span className="query-scope-count" aria-hidden="true">+{scopeContext.filterCount}</span> : null}
                    </> : null}
                  </button>
                  {signedIn ? <span className="sr-only" id={scopeDescriptionId}>{scopeControl.description}</span> : null}
                </> : !intake ? <div className="capsule-tools-end">
                  <span className="smart-retrieval-label" aria-hidden="true">智能检索</span>
                  <button
                    type="button"
                    className="deep-thinking-entry"
                    data-testid="deep-thinking-toggle"
                    role="switch"
                    aria-label={`智能检索${smartEnabled ? '开' : '关'}，点击切换。`}
                    aria-checked={smartEnabled}
                    aria-describedby="deep-thinking-description"
                    title="智能检索：MiniMax 规划检索式并重排已有话术，不生成正文"
                    onClick={onToggleSmartRetrieval}
                  >
                    <span className="smart-toggle-thumb" aria-hidden="true" />
                  </button>
                </div> : null}
              </div>
              {intake ? guidance : null}
            </div>
          </div>
          <div className="capsule-action-stack">
            {manualSopControl}
            <button
              type="button"
              className="search-btn"
              data-testid="search-button"
              onClick={onSearch}
              disabled={searching || scopePending}
              aria-busy={searching || scopePending}
              title={scopePending ? '正在更新查询范围，请稍后查询。' : undefined}
            >
              {searching ? (
                <span className="searching-label" data-testid="searching-indicator">
                  <span className="searching-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  检索中
                </span>
              ) : (
                scopePending ? '更新中' : '查询'
              )}
            </button>
          </div>
        </div>
  );
}
