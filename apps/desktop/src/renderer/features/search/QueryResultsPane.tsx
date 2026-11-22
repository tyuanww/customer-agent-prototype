import { Button } from 'antd';
import type { Ref, ReactNode } from 'react';
import { COPY_SUCCESS_MESSAGE } from '@shared/contracts';
import type { OverlayPhase } from '@shared/overlay-machine';
import { SOP_ENTRY_BUTTON, SOP_ENTRY_HINT, SOP_RESUME_BUTTON } from '@shared/sop-window';
import { ScriptCard } from './ScriptCard';
import type { HelpStatus } from '@shared/product-help';
import { isIntakeRow, type QueryResult, type RankedScript } from './types';
import { IntakeFaqCard } from './IntakeFaqCard';
import { SopCandidateList, SopCandidateStatus } from './SopCandidateList';
import type { IntakeSopCandidatesEvent } from '@shared/content-intake-query';
import { hasResultCopyShortcut } from './query-view';

type QueryResultsPaneProps = {
  contextControls?: ReactNode;
  intakeSop?: {
    event: IntakeSopCandidatesEvent | null;
    manualEntry: ReactNode;
    manualError?: string;
    onLayoutChange: () => void;
    onEditQuestion: () => void;
  };
  phase: OverlayPhase;
  resultPaneRef: Ref<HTMLElement>;
  statusBannerRef: Ref<HTMLDivElement>;
  resultContentRef: Ref<HTMLDivElement>;
  errorMessage: string;
  results: QueryResult[];
  copying: boolean;
  copiedRank: 1 | 2 | 3 | null;
  helpStatus?: HelpStatus;
  sopEntryVisible?: boolean;
  sopEntryBusy?: boolean;
  sopEntryError?: string | null;
  sopEntryResume?: boolean;
  onOpenSop?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  onCopy: (script: QueryResult, trigger: HTMLElement | null) => void;
  reportedScriptIds?: ReadonlySet<string>;
  reportError?: string;
  onReportInaccuracy?: (script: RankedScript) => void;
  onCopyContact?: () => void;
  onOpenHelp?: () => void;
  onLeaveNoHit?: () => void;
};

export function QueryResultsPane({
  contextControls,
  intakeSop,
  phase,
  resultPaneRef,
  statusBannerRef,
  resultContentRef,
  errorMessage,
  results,
  copying,
  copiedRank,
  helpStatus,
  sopEntryVisible = false,
  sopEntryBusy = false,
  sopEntryError = null,
  sopEntryResume = false,
  onOpenSop,
  onRetry,
  retryLabel = '重试',
  onCopy,
  reportedScriptIds,
  reportError,
  onReportInaccuracy,
  onCopyContact,
  onOpenHelp,
  onLeaveNoHit,
}: QueryResultsPaneProps) {
  const sopEvent = intakeSop?.event;
  const candidates = sopEvent && 'candidates' in sopEvent ? sopEvent.candidates : [];
  const candidateStatus = sopEvent && 'status' in sopEvent ? sopEvent.status : null;
  const hasCandidates = candidates.length > 0;
  const shortcutsActive = phase === 'RESULTS' && !copying;
  const faqShortcutKeys = shortcutsActive ? results.filter(hasResultCopyShortcut).map(row => row.rank).join(' / ') : '';

  return (
          <section
            ref={resultPaneRef}
            className="result-pane"
            data-testid="result-pane"
            aria-label="候选话术"
            tabIndex={-1}
          >
            {intakeSop && (hasCandidates || candidateStatus || intakeSop.manualEntry) ? (
              <section className="intake-sop-entry" aria-label="办理流程" data-sop-entry>
                {hasCandidates ? <div className="intake-sop-candidates" data-sop-candidates>
                  <SopCandidateList key={sopEvent?.contextId} candidates={candidates} onFeedbackLayoutChange={intakeSop.onLayoutChange} />
                </div> : null}
                {intakeSop.manualEntry}
                {candidateStatus ? <SopCandidateStatus status={candidateStatus} /> : null}
                {intakeSop.manualError ? <p className="validation-error" role="status">{intakeSop.manualError}</p> : null}
              </section>
            ) : null}
            {contextControls ? <div data-query-context>{contextControls}</div> : null}
            {phase === 'EMPTY' && intakeSop ? (
              <div ref={statusBannerRef} className="status-banner intake-faq-empty" data-testid={hasCandidates || candidateStatus ? undefined : 'no-hit'}>
                <strong role="status">
                  {hasCandidates ? '没有匹配的 FAQ 话术，可从上方选择流程办理。'
                    : candidateStatus ? '没有匹配的 FAQ 话术。' : '没找到可用话术'}
                </strong>
                <Button className="retry-btn" onClick={intakeSop.onEditQuestion}>修改问句</Button>
                {!hasCandidates && candidateStatus !== 'searching' ? (
                  <p className="intake-faq-empty-contact">仍需帮助时，请到客服飞书群联系值班人员。</p>
                ) : null}
              </div>
            ) : null}
            {phase === 'EMPTY' && !intakeSop ? (
              <div ref={statusBannerRef} className="status-banner no-hit" data-testid="no-hit" role="status" aria-live="polite">
                <span className="no-hit-mark" aria-hidden="true">?</span>
                <strong>没找到可用话术</strong>
                <span>请先让客户稍等，再联系话术师或运营，必要时升级客服经理。这不是转交回执。</span>
                {errorMessage ? <span>{errorMessage}</span> : null}
                {onCopyContact || onOpenHelp ? (
                  <div className="no-hit-help" data-testid="no-hit-help">
                    {onCopyContact ? <button type="button" className="retry-btn" data-testid="copy-contact-button" onClick={onCopyContact}>复制联系方式</button> : null}
                    {onOpenHelp ? <button type="button" className="retry-btn" data-testid="open-help-button" onClick={onOpenHelp}>打开求助入口</button> : null}
                    {onLeaveNoHit ? <button type="button" className="retry-btn" data-testid="no-hit-exit-button" onClick={onLeaveNoHit}>离开</button> : null}
                    <span className="help-status" data-testid="help-status">{helpStatus || '待核实'}</span>
                  </div>
                ) : <span>当前没有可用的升级入口。</span>}
              </div>
            ) : null}

            {phase === 'ERROR' ? (
              <div ref={statusBannerRef} className="status-banner is-error" data-testid="error-state">
                <strong>查询未完成</strong>
                {errorMessage ? <span role="status">{errorMessage}</span> : null}
                {onRetry ? <button type="button" className="retry-btn" data-testid="retry-button" onClick={onRetry}>
                  {retryLabel}
                </button> : null}
              </div>
            ) : null}

            {phase === 'RESULTS' || phase === 'COPIED' || (phase === 'ERROR' && results.length > 0) ? (
              <div className="result-content" data-testid="result-content" ref={resultContentRef}>
                {results.length > 0 ? <div className="card-list" data-testid="result-list">
                  <div className="result-heading" role="status" aria-live="polite">
                    <strong>候选话术</strong>
                    {phase === 'COPIED' ? (
                      <span className="copied-feedback" data-testid="toast">
                        {COPY_SUCCESS_MESSAGE}{errorMessage ? `；${errorMessage}` : ''}
                      </span>
                    ) : (
                      <span>{results.length} 条{intakeSop ? (faqShortcutKeys && ` · 按 ${faqShortcutKeys} 复制`) : ' · 按 1 / 2 / 3 复制'}</span>
                    )}
                  </div>
                  {reportError ? <div className="validation-error" role="status">{reportError}</div> : null}
                  {sopEntryVisible ? (
                    <div className="sop-entry-banner" data-testid="sop-entry-banner">
                      <span>{SOP_ENTRY_HINT}</span>
                      <button
                        type="button"
                        className="retry-btn"
                        data-testid="open-allergy-sop"
                        disabled={sopEntryBusy}
                        onClick={onOpenSop}
                      >
                        {sopEntryResume ? SOP_RESUME_BUTTON : SOP_ENTRY_BUTTON}
                      </button>
                      {sopEntryError ? (
                        <span className="validation-error" data-testid="sop-open-error">{sopEntryError}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {results.map((script) => isIntakeRow(script) ? (
                    <IntakeFaqCard key={script.key} row={script} copying={copying || phase === 'COPIED'}
                      copied={copiedRank === script.rank} shortcutsActive={shortcutsActive} onCopy={onCopy} />
                  ) : (
                    <ScriptCard
                      key={script.scriptId}
                      script={script}
                      copying={copying || phase === 'COPIED'}
                      copied={copiedRank === script.rank}
                      reported={reportedScriptIds?.has(script.scriptId)}
                      onReport={onReportInaccuracy}
                      onCopy={(item, trigger) => {
                        onCopy(item, trigger);
                      }}
                    />
                  ))}
                </div> : null}
              </div>
            ) : null}
          </section>
  );
}
