import type { Ref } from 'react';
import { MAX_QUERY_CHARS } from '@shared/contracts';
import { FoxHead } from '../../components/FoxHead';
import { useWindowDrag } from '../../lib/use-window-drag';
import type { QueryFoxVisualState, SessionNotice } from './query-view';

type QueryCapsuleProps = {
  productControl?: React.ReactNode;
  foxVisualState: QueryFoxVisualState;
  foxDrag: ReturnType<typeof useWindowDrag>;
  deepThinkingDescription: string;
  smartEnabled: boolean;
  query: string;
  inputRef: Ref<HTMLInputElement>;
  invalidMessage: string;
  sessionNotice: SessionNotice | null;
  shortcutFailed: boolean;
  shortcutLabel: string;
  searching: boolean;
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
  foxVisualState,
  foxDrag,
  deepThinkingDescription,
  smartEnabled,
  query,
  inputRef,
  invalidMessage,
  sessionNotice,
  shortcutFailed,
  shortcutLabel,
  searching,
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
  return (
        <div className="query-capsule">
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
                maxLength={MAX_QUERY_CHARS}
                autoComplete="off"
                aria-describedby="query-guidance"
                aria-invalid={invalidMessage ? true : undefined}
                spellCheck={false}
                placeholder="输入或粘贴客户问题，回车查询"
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
            <span id="deep-thinking-description" className="sr-only">
              {deepThinkingDescription}
            </span>
            <div className="capsule-meta">
              <p
                id="query-guidance"
                className="capsule-hint"
                aria-live={invalidMessage || sessionNotice ? 'polite' : undefined}
              >
                {invalidMessage ? (
                  <span className="validation-error" data-testid="validation-error">
                    {invalidMessage}
                  </span>
                ) : sessionNotice ? (
                  <span
                    className={`session-notice is-${sessionNotice.kind}`}
                    data-testid={`session-notice-${sessionNotice.kind}`}
                    role="status"
                  >
                    {sessionNotice.text}
                  </span>
                ) : (
                  <span>
                    Enter 查询 · Esc 收起 · 只复制不代发
                    {shortcutFailed ? '' : ` · ${shortcutLabel}`}
                  </span>
                )}
              </p>
              <div className="capsule-tools">
                {productControl}
                <button
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
                </button>
                <button
                  type="button"
                  className="deep-thinking-entry"
                  data-testid="deep-thinking-toggle"
                  aria-label={`智能检索当前${smartEnabled ? '开启' : '关闭'}，点击切换。默认开启。`}
                  aria-pressed={smartEnabled}
                  aria-describedby="deep-thinking-description"
                  title="智能检索：MiniMax 规划检索式并重排已有话术，不生成正文"
                  onClick={onToggleSmartRetrieval}
                >
                  智能检索 <span>{smartEnabled ? 'ON' : 'OFF'}</span>
                </button>
                <div className="env-badges" data-testid="env-badges">
                  <span className="env-badge">DEMO</span>
                  <span className="env-badge">MOCK AUTH</span>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="search-btn"
            data-testid="search-button"
            onClick={onSearch}
            disabled={searching}
            aria-busy={searching}
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
              '查询'
            )}
          </button>
        </div>
  );
}
