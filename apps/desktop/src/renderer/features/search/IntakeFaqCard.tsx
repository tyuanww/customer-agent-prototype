import { Button } from 'antd';
import { useId } from 'react';
import type { IntakeQueryRow } from '@shared/content-intake-query';
import { hasResultCopyShortcut } from './query-view';

export function IntakeFaqCard({ row, copying, copied, shortcutsActive, onCopy }: {
  row: IntakeQueryRow; copying: boolean; copied: boolean;
  shortcutsActive: boolean;
  onCopy: (row: IntakeQueryRow, trigger: HTMLElement) => void;
}) {
  const notesId = useId();
  const riskNote = row.riskNote.trim();
  const applicabilityNote = row.applicabilityNote.trim();
  const hasNotes = Boolean(riskNote || applicabilityNote);
  const hasShortcut = hasResultCopyShortcut(row);

  return <article className={`script-card intake-faq-card${row.rank === 1 ? ' is-lead' : ''}`} data-testid={`script-card-${row.rank}`}>
    <div className="card-top">
      <div className="card-kicker">
        {hasShortcut && shortcutsActive
          ? <kbd className="rank" aria-label={`按数字 ${row.rank} 复制`}>{row.rank}</kbd>
          : <span className="intake-faq-rank">{row.rank}</span>}
        <strong>{row.title}</strong>
      </div>
    </div>
    {hasNotes ? <div className="intake-faq-notes" id={notesId}>
      {riskNote ? <p className="intake-faq-risk">风险提示：{riskNote}</p> : null}
      {applicabilityNote ? <p>适用说明：{applicabilityNote}</p> : null}
    </div> : null}
    <div className="card-answer-row">
      <p className="answer-text" data-testid={`answer-text-${row.rank}`}>{row.answerText}</p>
      <Button className={copied ? 'copy-btn is-copied' : 'copy-btn'} data-testid={`copy-button-${row.rank}`}
        disabled={copying} aria-keyshortcuts={hasShortcut && shortcutsActive ? String(row.rank) : undefined}
        aria-describedby={hasNotes ? notesId : undefined} onClick={event => onCopy(row, event.currentTarget)}>
        {copied ? '已复制' : '复制话术'}
      </Button>
    </div>
    <div className="meta-row"><span>已发布版本 {row.releaseId}</span><span>资格至 {new Date(row.validUntil).toLocaleTimeString()}</span></div>
  </article>;
}
