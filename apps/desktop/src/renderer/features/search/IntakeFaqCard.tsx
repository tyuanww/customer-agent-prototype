import type { IntakeQueryRow } from '@shared/content-intake-query';

export function IntakeFaqCard({ row, copying, copied, onCopy }: {
  row: IntakeQueryRow; copying: boolean; copied: boolean;
  onCopy: (row: IntakeQueryRow, trigger: HTMLButtonElement) => void;
}) {
  return <article className={`script-card intake-faq-card${row.rank === 1 ? ' is-lead' : ''}`} data-testid={`script-card-${row.rank}`}>
    <div className="card-top"><div className="card-kicker"><kbd className="rank">{row.rank}</kbd><strong>{row.title}</strong></div></div>
    <div className="card-answer-row">
      <p className="answer-text" data-testid={`answer-text-${row.rank}`}>{row.answerText}</p>
      <button className={copied ? 'copy-btn is-copied' : 'copy-btn'} data-testid={`copy-button-${row.rank}`}
        disabled={copying} aria-keyshortcuts={String(row.rank)} onClick={event => onCopy(row, event.currentTarget)}>
        {copied ? '已复制' : '复制话术'}
      </button>
    </div>
    {row.applicabilityNote ? <p>适用说明：{row.applicabilityNote}</p> : null}
    {row.riskNote ? <p className="validation-error">风险提示：{row.riskNote}</p> : null}
    <div className="meta-row"><span>已发布版本 {row.releaseId}</span><span>资格至 {new Date(row.validUntil).toLocaleTimeString()}</span></div>
  </article>;
}
