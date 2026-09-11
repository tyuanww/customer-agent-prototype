import { getValidityInfo } from './validity';
import type { RankedScript, RiskLevel } from './types';

type ScriptCardProps = {
  script: RankedScript;
  copying: boolean;
  copied: boolean;
  onCopy: (script: RankedScript, trigger: HTMLButtonElement | null) => void;
};

const RISK_COPY: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: '低风险', className: 'risk-chip' },
  medium: { label: '需人工核对', className: 'risk-chip is-medium' },
  high: { label: '高风险 · 需复核', className: 'risk-chip is-high' },
};

export function ScriptCard({ script, copying, copied, onCopy }: ScriptCardProps) {
  const validNow = Date.parse(script.effectiveFrom) <= Date.now() && (!script.effectiveTo || Date.now() < Date.parse(script.effectiveTo));
  const validity = script.productCopy ? { kind: validNow ? 'active' : 'expired', text: validNow ? '当前有效' : '已失效，请重新查询' } : getValidityInfo(script.effectiveFrom, script.effectiveTo);
  const risk = RISK_COPY[script.riskLevel];
  const lead = script.rank === 1;

  return (
    <article
      className={['script-card', lead ? 'is-lead' : '', script.riskLevel === 'high' ? 'is-high' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid={`script-card-${script.rank}`}
    >
      <div className="card-top">
        <div className="card-kicker">
          <kbd className="rank" aria-label={`按数字 ${script.rank} 快速复制`}>
            {script.rank}
          </kbd>
          <span className="scene-label">{script.scopeLabel}</span>
        </div>
        <div className="card-top-tags">
          <span className={risk.className} data-testid={`risk-${script.rank}`}>
            {risk.label}
          </span>
        </div>
      </div>
      <div className="card-answer-row">
        <p className="answer-text" data-testid={`answer-text-${script.rank}`}>
          {script.answerText}
        </p>
        <button
          type="button"
          className={copied ? 'copy-btn is-copied' : 'copy-btn'}
          data-testid={`copy-button-${script.rank}`}
          disabled={copying || (!!script.productCopy && !validNow)}
          aria-keyshortcuts={String(script.rank)}
          onClick={(event) => onCopy(script, event.currentTarget)}
        >
          {copied ? '已复制' : '复制话术'}
        </button>
      </div>
      <div className="meta-row">
        <span className={`match-chip is-${script.matchKind}`} data-testid={`match-reason-${script.rank}`}>
          {script.matchLabel}
        </span>
        <span className="meta-chip">{script.domain}</span>
        <span className="meta-chip">{script.platform}</span>
        <span className={`validity-chip is-${validity.kind}`} data-testid={`validity-${script.rank}`}>
          {validity.text}
        </span>
      </div>
    </article>
  );
}
