import { useState } from 'react';
import { DASHBOARD_MANIFEST } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.content;

export function ContentModule() {
  const [selectedId, setSelectedId] = useState(data.releases[0]?.releaseId ?? '');
  const selected = data.releases.find((release) => release.releaseId === selectedId) ?? data.releases[0];

  return (
    <div className="dash-module" data-testid="module-content">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <div className="dash-publish-box">
          <button type="button" className="dash-publish" disabled data-testid="publish-action">Publish</button>
          <span data-testid="publish-disabled-reason">{data.publishDisabledReason}</span>
        </div>
      </header>

      <ol className="dash-pipeline">
        {data.pipeline.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
      </ol>

      <p className="dash-scope dash-scope-important" data-testid="formal-source-warning">
        正式来源现状：产品、活动已有受控材料，但四域整体签发尚未完成；售前、售后仍为
        NOT_CREATED / UPSTREAM_AUTHORING。下列 release 仅演示“缺域即阻断”的产品合同，不代表正式四域已齐。
      </p>

      <div className="dash-release-grid" aria-label="选择合成发布结构">
        {data.releases.map((release) => (
          <button
            key={release.releaseId}
            type="button"
            className={`dash-card dash-release-card${release.blocked ? ' is-blocked' : ''}${selected.releaseId === release.releaseId ? ' is-selected' : ''}`}
            aria-pressed={selected.releaseId === release.releaseId}
            data-testid={`release-${release.releaseId}`}
            onClick={() => setSelectedId(release.releaseId)}
          >
            <span className="dash-card-row">
              <strong>{release.title}</strong>
              <StatusBadge label={release.blocked ? '阻断' : '结构演示'} tone={release.blocked ? 'danger' : 'mock'} />
            </span>
            <span className="dash-mini">{release.releaseId}</span>
            <span className="dash-domain-summary">
              {release.bindings.map((binding) => (
                <span key={binding.domain} className={binding.bound ? 'is-bound' : 'is-missing'}>
                  {binding.label} · {binding.bound ? '已绑定样例' : '缺域'}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <section className="dash-card dash-release-detail" aria-live="polite" data-testid="release-detail">
        <div className="dash-card-row">
          <div><span className="dash-card-label">所选合成发布门禁</span><h2>{selected.title}</h2></div>
          <StatusBadge label={selected.blocked ? '不可继续' : '只读结构演练'} tone={selected.blocked ? 'danger' : 'mock'} />
        </div>
        <div className="release-gate-grid">
          {selected.bindings.map((binding) => (
            <article key={binding.domain} className={binding.bound ? 'is-bound' : 'is-missing'}>
              <span>{binding.label}</span>
              <strong>{binding.bound ? '已绑定合成样例' : '缺域阻断'}</strong>
              <small>{binding.sourceId}</small>
            </article>
          ))}
        </div>
        <dl className="dash-dl dash-dl-grid">
          <div><dt>审核</dt><dd>{selected.review}</dd></div>
          <div><dt>质量</dt><dd>{selected.quality}</dd></div>
          <div><dt>有效期</dt><dd>{selected.validity}</dd></div>
          <div><dt>风险</dt><dd>{selected.risk}</dd></div>
        </dl>
        {selected.blockReason ? <p className="dash-block" data-testid="missing-domain-block">{selected.blockReason}</p> : null}
        <p className="dash-footnote">选择只改变本地展示；发布、回滚、审核、绑定均不可操作，也不会写入任何系统。</p>
      </section>
    </div>
  );
}
