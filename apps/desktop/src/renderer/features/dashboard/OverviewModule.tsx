import { useState } from 'react';
import {
  DASHBOARD_MANIFEST,
  type DashboardModuleId,
  type OverviewStructureItem,
  type OverviewTrendMetricId,
} from '../../data/dashboard-manifest';
import { StructureDonut, TrendChart } from './DashboardCharts';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.overview;

function trendValue(point: (typeof data.trend)[number], metric: OverviewTrendMetricId): number {
  if (metric === 'questions') return point.questions;
  if (metric === 'noHitRate') return point.noHitRate;
  return point.copyRate;
}

export function OverviewModule({ onNavigate }: { onNavigate?: (target: DashboardModuleId) => void }) {
  const [trendMetric, setTrendMetric] = useState<OverviewTrendMetricId>('questions');
  const [trendIndex, setTrendIndex] = useState(data.trend.length - 1);
  const [structureId, setStructureId] = useState<OverviewStructureItem['id']>('copied');
  const [healthId, setHealthId] = useState(data.health[0].id);
  const metric = data.trendMetrics.find((item) => item.id === trendMetric) ?? data.trendMetrics[0];
  const trendPoint = data.trend[trendIndex] ?? data.trend.at(-1) ?? data.trend[0];
  const structure = data.operationStructure.find((item) => item.id === structureId) ?? data.operationStructure[0];
  const selectedHealth = data.health.find((item) => item.id === healthId) ?? data.health[0];
  const trendDisplay = `${trendValue(trendPoint, trendMetric).toFixed(metric.decimals)}${metric.unit}`;

  return (
    <div className="dash-module" data-testid="module-overview">
      <header className="dash-module-head overview-hero">
        <div>
          <h1>运营概览</h1>
          <p className="dash-kicker">最近 8 个固定周期 · 全渠道结构样例</p>
        </div>
      </header>

      <dl className="overview-scope-summary" aria-label="当前统计范围" data-testid="dashboard-scope">
        <div><dt>统计周期</dt><dd>06/22–08/13 · 固定 8 期</dd></div>
        <div><dt>业务范围</dt><dd>全渠道结构样例</dd></div>
        <div><dt>数据级别</dt><dd>去标识合成镜像</dd></div>
      </dl>

      <section className="manager-decision-panel" aria-labelledby="manager-decisions-title">
        <div className="dash-section-title">
          <div><h2 id="manager-decisions-title">待处理决策（{data.decisions.length}）</h2></div>
          <p>按阻断和风险排序，不做个人排名</p>
        </div>
        <div className="manager-decision-table" role="table" aria-label="待处理决策">
          <div role="rowgroup" className="manager-decision-table-head">
            <div role="row" className="manager-decision-row">
              <span role="columnheader">优先级</span>
              <span role="columnheader">决策事项与影响</span>
              <span role="columnheader">责任与下一步</span>
              <span role="columnheader">状态 / 处理窗口</span>
              <span role="columnheader">操作</span>
            </div>
          </div>
          <div role="rowgroup" className="manager-decision-list">
            {data.decisions.map((item) => (
              <div key={item.id} role="row" className="manager-decision-row manager-decision" data-testid={`decision-${item.id}`}>
                <div role="cell" className="manager-decision-priority">
                  <StatusBadge label={item.priority} tone={item.priority === 'P0' ? 'danger' : 'warn'} />
                </div>
                <div role="cell" className="manager-decision-main">
                  <h3>{item.title}</h3>
                  <p>{item.evidence}</p>
                  <strong>{item.impact}</strong>
                </div>
                <div role="cell" className="manager-decision-owner">
                  <dl>
                    <div><dt>Owner</dt><dd>{item.owner}</dd></div>
                    <div><dt>下一步</dt><dd>{item.nextStep}</dd></div>
                  </dl>
                </div>
                <div role="cell" className="manager-decision-state">
                  <strong>{item.statusLabel}</strong>
                  <span>{item.reviewWindow}</span>
                </div>
                <div role="cell" className="manager-decision-action">
                  <button
                    type="button"
                    aria-label={`查看：${item.title}`}
                    onClick={() => onNavigate?.(item.target)}
                  >
                    查看
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overview-health">
        <div className="dash-section-title">
          <div><h2>数据质量与内容健康</h2></div>
          <p>选择指标查看口径与明细入口</p>
        </div>
        <div className="health-strip" role="list" aria-label="数据质量与内容健康指标" data-testid="overview-health-strip">
          {data.health.map((item) => (
            <article
              key={item.id}
              className={`health-kpi${item.id === selectedHealth.id ? ' is-selected' : ''}`}
              role="listitem"
              data-metric-id={item.id}
            >
              <button
                type="button"
                aria-pressed={item.id === selectedHealth.id}
                data-testid={`overview-health-${item.id}`}
                onClick={() => setHealthId(item.id)}
              >
                <span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small>
              </button>
            </article>
          ))}
        </div>
        <div className="health-definition" role="status" aria-live="polite" data-testid="overview-health-definition">
          <div>
            <strong>{selectedHealth.label}</strong>
            <span>{selectedHealth.period}</span>
            <p>{selectedHealth.definition}</p>
          </div>
          {selectedHealth.target !== 'overview' ? (
            <button type="button" onClick={() => onNavigate?.(selectedHealth.target)}>查看明细</button>
          ) : null}
        </div>
      </section>

      <section className="overview-charts" aria-labelledby="overview-signal-title">
        <div className="dash-section-title">
          <div><h2 id="overview-signal-title">检索趋势与操作终态</h2></div>
          <p>最近 8 个固定周期 · 选择指标或数据点查看口径</p>
        </div>
        <div className="overview-chart-grid">
          <article className="dash-card dash-chart-card">
            <div className="dash-chart-head">
              <div>
                <span className="dash-card-label">八周期趋势</span>
                <h3>{metric.label}</h3>
              </div>
              <div className="dash-segmented" role="group" aria-label="选择概览趋势指标">
                {data.trendMetrics.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === trendMetric ? 'is-active' : ''}
                    aria-pressed={item.id === trendMetric}
                    data-testid={`overview-trend-metric-${item.id}`}
                    onClick={() => {
                      setTrendMetric(item.id);
                      setTrendIndex(data.trend.length - 1);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart
              points={data.trend}
              metric={trendMetric}
              metricLabel={metric.label}
              unit={metric.unit}
              decimals={metric.decimals}
              selectedIndex={trendIndex}
              onSelect={setTrendIndex}
            />
            <div className="dash-chart-feedback" aria-live="polite" data-testid="overview-trend-feedback">
              <div><strong>{trendPoint.range}</strong><span>{metric.label}</span></div>
              <b>{trendDisplay}</b>
              <p>{metric.explanation}</p>
            </div>
          </article>

          <article className="dash-card dash-chart-card">
            <div className="dash-chart-head">
              <div>
                <span className="dash-card-label">检索终态结构</span>
                <h3>346 次合成检索操作</h3>
              </div>
              <span className="dash-chart-context">四类终态分账</span>
            </div>
            <StructureDonut items={data.operationStructure} selectedId={structure.id} onSelect={setStructureId} />
            <div className="dash-chart-feedback is-structure" aria-live="polite" data-testid="overview-structure-feedback">
              <div><strong>{structure.label}</strong><span>{structure.count} 次</span></div>
              <p>{structure.explanation}</p>
            </div>
          </article>
        </div>
      </section>

      <section className="overview-two-column">
        <article className="dash-card">
          <div className="dash-card-row">
            <strong>重点 VOC 问题</strong>
            <button type="button" className="dash-linkish" onClick={() => onNavigate?.('workorders')}>查看明细</button>
          </div>
          <ol className="overview-ranked-list">
            {DASHBOARD_MANIFEST.workorders.insights.slice(0, 4).map((item, index) => (
              <li key={item.id}>
                <span>{index + 1}</span>
                <div><strong>{item.label}</strong><small>{item.count} 条合成镜像 · {item.owner}</small></div>
                <em>{item.pct}%</em>
              </li>
            ))}
          </ol>
        </article>
        <article className="dash-card">
          <div className="dash-card-row">
            <strong>四域来源健康</strong>
            <button type="button" className="dash-linkish" onClick={() => onNavigate?.('wording')}>查看话术库</button>
          </div>
          <ul className="domain-health-list">
            {DASHBOARD_MANIFEST.wording.domains.map((item) => (
              <li key={item.id}>
                <div><strong>{item.label}</strong><small>{item.sourceSummary}</small></div>
                <StatusBadge
                  label={item.readiness === 'upstream_authoring' ? '待建设' : '结构已确认'}
                  tone={item.readiness === 'upstream_authoring' ? 'danger' : 'warn'}
                />
              </li>
            ))}
          </ul>
        </article>
      </section>

      <details className="dash-contract-details overview-technical">
        <summary>查看 Demo 技术指标与数据边界</summary>
        <p className="dash-scope">{DASHBOARD_MANIFEST.banners.metricScope}</p>
        <div className="dash-metric-grid compact">
          {data.metrics.map((item) => (
            <article key={item.id} className="dash-card" data-testid={`metric-${item.id}`}>
              <p className="dash-card-label">{item.label}</p>
              <p className="dash-card-value">
                {item.value}{item.unit ? <span className="dash-card-unit">{item.unit}</span> : null}
              </p>
              <p className="dash-card-note">{item.sampleNote}</p>
              {item.explanation ? (
                <p className="dash-card-explain" data-testid="adopted-disclaimer">{item.explanation}</p>
              ) : null}
            </article>
          ))}
        </div>
        <ul className="dash-notes">{data.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </details>
    </div>
  );
}
