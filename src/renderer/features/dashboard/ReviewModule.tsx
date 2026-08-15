import { useState } from 'react';
import {
  DASHBOARD_MANIFEST,
  type OfflineReviewDimensionId,
} from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.review;

function outcomeTone(tone: string): 'ok' | 'warn' | 'neutral' | 'mock' {
  if (tone === 'positive') return 'ok';
  if (tone === 'warning') return 'warn';
  if (tone === 'unknown') return 'mock';
  return 'neutral';
}

export function ReviewModule() {
  const [dimensionId, setDimensionId] = useState<OfflineReviewDimensionId>('modified');
  const active = data.dimensions.find((dimension) => dimension.id === dimensionId) ?? data.dimensions[0];
  const [outcomeId, setOutcomeId] = useState(active.outcomes[0].id);
  const selected = active.outcomes.find((outcome) => outcome.id === outcomeId) ?? active.outcomes[0];

  const selectDimension = (nextId: OfflineReviewDimensionId) => {
    const next = data.dimensions.find((dimension) => dimension.id === nextId) ?? data.dimensions[0];
    setDimensionId(next.id);
    setOutcomeId(next.outcomes[0].id);
  };

  return (
    <div className="dash-module" data-testid="module-review">
      <header className="dash-module-head review-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <StatusBadge label={data.pool.evidenceGrade} tone="mock" />
      </header>

      <p className="dash-scope dash-scope-important">{data.scope}</p>
      <section className="review-inference-boundary" data-testid="review-inference-boundary">
        <strong>不可推断边界</strong>
        <p>{data.inferenceBoundary}</p>
      </section>

      <div className="review-pool-grid" aria-label="合成抽样池概览">
        <article className="dash-card">
          <span>冻结样本池</span>
          <strong>{data.pool.frozen}</strong>
          <small>去重根问题 · 合成</small>
        </article>
        <article className="dash-card">
          <span>已完成复核</span>
          <strong>{data.pool.reviewed}</strong>
          <small>三维分别判定</small>
        </article>
        <article className="dash-card">
          <span>抽样复核覆盖</span>
          <strong>{data.pool.coverage}</strong>
          <small>不外推全量经营结果</small>
        </article>
        <article className="dash-card">
          <span>当前维度不可核验</span>
          <strong>{active.unverifiable}</strong>
          <small>单独列示，不补零</small>
        </article>
      </div>

      <div className="review-dimension-tabs" role="tablist" aria-label="离线复核维度">
        {data.dimensions.map((dimension) => {
          const selectedDimension = dimension.id === active.id;
          return (
            <button
              key={dimension.id}
              id={`review-tab-${dimension.id}`}
              type="button"
              role="tab"
              aria-selected={selectedDimension}
              aria-controls="review-dimension-panel"
              className={selectedDimension ? 'is-active' : ''}
              data-testid={`review-dimension-${dimension.id}`}
              onClick={() => selectDimension(dimension.id)}
            >
              <strong>{dimension.label}</strong>
              <span>{dimension.verifiable} 可核验 / {dimension.unverifiable} 不可核验</span>
            </button>
          );
        })}
      </div>

      <section
        id="review-dimension-panel"
        className="review-dimension-panel"
        role="tabpanel"
        aria-labelledby={`review-tab-${active.id}`}
        data-testid="review-dimension-panel"
      >
        <div className="dash-card review-outcome-card">
          <div className="dash-card-row">
            <div>
              <span className="dash-card-label">人工复核问题</span>
              <h2>{active.question}</h2>
            </div>
            <StatusBadge label={active.evidenceGrade} tone="mock" />
          </div>
          <p className="review-denominator">{active.denominatorLabel}</p>
          <div className="review-outcome-list" data-testid="review-outcome-list">
            {active.outcomes.map((outcome) => (
              <button
                key={outcome.id}
                type="button"
                className={selected.id === outcome.id ? 'is-selected' : ''}
                aria-pressed={selected.id === outcome.id}
                data-testid={`review-outcome-${outcome.id}`}
                onClick={() => setOutcomeId(outcome.id)}
              >
                <span>
                  <strong>{outcome.label}</strong>
                  <small>{outcome.count} 个合成根问题</small>
                </span>
                <span className="review-outcome-bar" aria-hidden="true">
                  <i style={{ width: `${(outcome.count / active.reviewed) * 100}%` }} />
                </span>
              </button>
            ))}
          </div>
        </div>

        <aside className="dash-card review-outcome-detail" data-testid="review-outcome-detail">
          <div className="dash-card-row">
            <span className="dash-card-label">所选结论口径</span>
            <StatusBadge label={selected.label} tone={outcomeTone(selected.tone)} />
          </div>
          <strong className="review-outcome-count">{selected.count}</strong>
          <span>个合成根问题</span>
          <p>{selected.definition}</p>
          <dl className="dash-dl">
            <div><dt>维度</dt><dd>{active.label}</dd></div>
            <div><dt>该维度已复核</dt><dd>{active.reviewed}</dd></div>
            <div><dt>有效分母</dt><dd>{active.verifiable}</dd></div>
            <div><dt>不可核验</dt><dd>{active.unverifiable}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="dash-card review-strata-card">
        <div className="dash-card-row">
          <div>
            <span className="dash-card-label">合成分层样本</span>
            <h2>高风险与异常结果优先覆盖</h2>
          </div>
          <span className="dash-muted">planned / reviewed 分账</span>
        </div>
        <div className="review-strata-grid" data-testid="review-strata">
          {data.strata.map((stratum) => (
            <article key={stratum.id}>
              <div><strong>{stratum.label}</strong><span>{stratum.rule}</span></div>
              <p><b>{stratum.reviewed}</b> / {stratum.planned}</p>
            </article>
          ))}
        </div>
      </section>

      <details className="dash-contract-details review-method">
        <summary>查看抽样口径与证据限制</summary>
        <ul className="dash-notes">
          {data.methodNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </details>
    </div>
  );
}
