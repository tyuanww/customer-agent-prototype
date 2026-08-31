import type { Ref } from 'react';
import { COPY_SUCCESS_MESSAGE } from '@shared/contracts';
import type { OverlayPhase } from '@shared/overlay-machine';
import { ScriptCard } from './ScriptCard';
import type { RankedScript } from './types';

type QueryResultsPaneProps = {
  phase: OverlayPhase;
  resultPaneRef: Ref<HTMLElement>;
  statusBannerRef: Ref<HTMLDivElement>;
  resultContentRef: Ref<HTMLDivElement>;
  errorMessage: string;
  results: RankedScript[];
  copying: boolean;
  copiedRank: 1 | 2 | 3 | null;
  onRetry: () => void;
  onCopy: (script: RankedScript, trigger: HTMLButtonElement | null) => void;
};

export function QueryResultsPane({
  phase,
  resultPaneRef,
  statusBannerRef,
  resultContentRef,
  errorMessage,
  results,
  copying,
  copiedRank,
  onRetry,
  onCopy,
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
                <span className="no-hit-mark" aria-hidden="true">?</span>
                <strong>没找到合适话术</strong>
                <span>换个说法再试，或转人工话术师。当前 Demo 未接通真实话术库。</span>
              </div>
            ) : null}

            {phase === 'ERROR' ? (
              <div ref={statusBannerRef} className="status-banner is-error" data-testid="error-state">
                <strong>查询未完成</strong>
                <span>{errorMessage || '出现可恢复错误，请重试。'}</span>
                <button type="button" className="retry-btn" data-testid="retry-button" onClick={onRetry}>
                  重试
                </button>
              </div>
            ) : null}

            {phase === 'RESULTS' || phase === 'COPIED' || (phase === 'ERROR' && results.length > 0) ? (
              <div className="result-content" data-testid="result-content" ref={resultContentRef}>
                <div className="card-list" data-testid="result-list">
                  <div className="result-heading" role="status" aria-live="polite">
                    <strong>候选话术</strong>
                    {phase === 'COPIED' ? (
                      <span className="copied-feedback" data-testid="toast">
                        {COPY_SUCCESS_MESSAGE}
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
