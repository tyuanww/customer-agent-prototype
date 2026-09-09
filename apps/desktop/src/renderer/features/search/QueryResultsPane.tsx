import type { Ref, ReactNode } from 'react';
import { COPY_SUCCESS_MESSAGE } from '@shared/contracts';
import type { OverlayPhase } from '@shared/overlay-machine';
import { ScriptCard } from './ScriptCard';
import type { HelpStatus } from '@shared/product-help';
import type { RankedScript } from './types';

type QueryResultsPaneProps = {
  contextControls?: ReactNode;
  phase: OverlayPhase;
  resultPaneRef: Ref<HTMLElement>;
  statusBannerRef: Ref<HTMLDivElement>;
  resultContentRef: Ref<HTMLDivElement>;
  errorMessage: string;
  results: RankedScript[];
  copying: boolean;
  copiedRank: 1 | 2 | 3 | null;
  helpStatus?: HelpStatus;
  onRetry: () => void;
  onCopy: (script: RankedScript, trigger: HTMLButtonElement | null) => void;
  onCopyContact?: () => void;
  onOpenHelp?: () => void;
  onLeaveNoHit?: () => void;
};

export function QueryResultsPane({
  contextControls,
  phase,
  resultPaneRef,
  statusBannerRef,
  resultContentRef,
  errorMessage,
  results,
  copying,
  copiedRank,
  helpStatus,
  onRetry,
  onCopy,
  onCopyContact,
  onOpenHelp,
  onLeaveNoHit,
}: QueryResultsPaneProps) {
  return (
          <section
            ref={resultPaneRef}
            className="result-pane"
            data-testid="result-pane"
            aria-label="候选话术"
            tabIndex={-1}
          >
            {phase === 'EMPTY' ? (
              <div ref={statusBannerRef} className="status-banner no-hit" data-testid="no-hit" role="status" aria-live="polite">
                {contextControls}
                <span className="no-hit-mark" aria-hidden="true">?</span>
                <strong>没找到可用话术</strong>
                <span>请先让客户稍等，再联系话术师或运营核实；必要时升级客服经理。打开入口或复制联系方式只表示动作完成，不是转交回执。</span>
                {errorMessage ? <span>{errorMessage}</span> : null}
                {onCopyContact || onOpenHelp ? (
                  <div className="no-hit-help" data-testid="no-hit-help">
                    {onCopyContact ? <button type="button" className="retry-btn" data-testid="copy-contact-button" onClick={onCopyContact}>复制合成联系方式</button> : null}
                    {onOpenHelp ? <button type="button" className="retry-btn" data-testid="open-help-button" onClick={onOpenHelp}>打开合成入口</button> : null}
                    {onLeaveNoHit ? <button type="button" className="retry-btn" data-testid="no-hit-exit-button" onClick={onLeaveNoHit}>离开</button> : null}
                    <span className="help-status" data-testid="help-status">{helpStatus || '待核实'}</span>
                  </div>
                ) : <span>当前 Demo 未接通真实话术库。</span>}
              </div>
            ) : null}

            {phase === 'ERROR' ? (
              <div ref={statusBannerRef} className="status-banner is-error" data-testid="error-state">
                <strong>查询未完成</strong>
                {results.length === 0 ? contextControls : null}
                <span>{errorMessage || '出现可恢复错误，请重试。'}</span>
                <button type="button" className="retry-btn" data-testid="retry-button" onClick={onRetry}>
                  重试
                </button>
              </div>
            ) : null}

            {phase === 'RESULTS' || phase === 'COPIED' || (phase === 'ERROR' && results.length > 0) ? (
              <div className="result-content" data-testid="result-content" ref={resultContentRef}>
                {contextControls}
                <div className="card-list" data-testid="result-list">
                  <div className="result-heading" role="status" aria-live="polite">
                    <strong>候选话术</strong>
                    {phase === 'COPIED' ? (
                      <span className="copied-feedback" data-testid="toast">
                        {COPY_SUCCESS_MESSAGE}{errorMessage ? `；${errorMessage}` : ''}
                      </span>
                    ) : (
                      <span>{results.length} 条 · 按 1 / 2 / 3 复制</span>
                    )}
                  </div>
                  {results.map((script) => (
                    <ScriptCard
                      key={script.scriptId}
                      script={script}
                      copying={copying || phase === 'COPIED'}
                      copied={copiedRank === script.rank}
                      onCopy={(item, trigger) => {
                        onCopy(item, trigger);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
  );
}
