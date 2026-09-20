import { useMemo, useState } from 'react';
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

function noHitTone(rate: number): 'danger' | 'warn' | 'ok' {
  if (rate > 10) return 'danger';
  if (rate >= 5) return 'warn';
  return 'ok';
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

  const latestTrend = data.trend.at(-1);
  const riskEscalated = data.operationStructure.find((item) => item.id === 'risk_escalated');
  const sourceGaps = data.health.find((item) => item.id === 'source-gaps');
  const top1AdoptionRate = useMemo(() => {
    const rows = DASHBOARD_MANIFEST.ledger.rows;
    const withChoice = rows.filter((row) => row.chosenRank !== null);
    if (withChoice.length === 0) return null;
    const top1Count = withChoice.filter((row) => row.chosenRank === 1).length;
    return Math.round((top1Count / withChoice.length) * 100);
  }, []);

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

      {/* 第一层：今日状态 — 3 个关键告警卡 */}
      <section className="overview-action-strip" aria-label="今日状态">
        <article className="overview-action-card" data-tone={data.decisions.length > 0 ? 'danger' : 'ok'}>
          <strong className="overview-action-value">{data.decisions.length}</strong>
          <span className="overview-action-label">待处理决策</span>
          <p className="overview-action-note">{data.decisions.filter((d) => d.priority === 'P0').length} 项 P0</p>
        </article>
        <article className="overview-action-card" data-tone={latestTrend ? noHitTone(latestTrend.noHitRate) : 'ok'}>
          <strong className="overview-action-value">{latestTrend ? `${latestTrend.noHitRate.toFixed(1)}%` : '—'}</strong>
          <span className="overview-action-label">无命中率</span>
          <p className="overview-action-note">{latestTrend ? latestTrend.range : '暂无数据'}</p>
        </article>
        <article className="overview-action-card" data-tone={sourceGaps ? 'danger' : 'ok'}>
          <strong className="overview-action-value">{sourceGaps?.value ?? '—'}</strong>
          <span className="overview-action-label">待建正式来源</span>
          <p className="overview-action-note">{sourceGaps?.note ?? ''}</p>
        </article>
      </section>

      {/* 第二层：核心运营指标 — 4 宫格 */}
      <section className="overview-kpi-grid" aria-labelledby="overview-kpi-title">
        <div className="dash-section-title">
          <div><h2 id="overview-kpi-title">核心运营指标</h2></div>
          <p>以上指标基于最近 8 个固定周期合成演示数据</p>
        </div>
        <dl className="health-strip" role="list" aria-label="核心运营指标">
          <div className="health-kpi" role="listitem">
            <dt>无命中率</dt>
            <dd>{latestTrend ? `${latestTrend.noHitRate.toFixed(1)}%` : '暂无数据'}</dd>
            <p>{latestTrend ? latestTrend.range : ''}</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>复制完成率</dt>
            <dd>{latestTrend ? `${latestTrend.copyRate.toFixed(1)}%` : '暂无数据'}</dd>
            <p>{latestTrend ? latestTrend.range : ''}</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>Top1 采纳率</dt>
            <dd>{top1AdoptionRate !== null ? `${top1AdoptionRate}%` : '暂无数据'}</dd>
            <p>有选择的操作中</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>风险升级次数</dt>
            <dd>{riskEscalated ? riskEscalated.count : '暂无数据'}</dd>
            <p>最近 8 个周期合计</p>
          </div>
        </dl>
      </section>

      {/* 第三层 A：待处理事项表 */}
      <section className="overview-action-list" aria-labelledby="overview-decisions-title">
        <div className="dash-section-title">
          <div><h2 id="overview-decisions-title">待处理事项（{data.decisions.length}）</h2></div>
          <p>按阻断和风险排序，不做个人排名</p>
        </div>
        <div className="manager-decision-table" role="table" aria-label="待处理事项">
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

      {/* 第三层 B：双栏卡片 — 待办 + 四域来源 */}
      <section className="overview-two-column">
        <article className="dash-card">
          <div className="dash-card-row">
            <strong>话术优化待办</strong>
            <button type="button" className="dash-linkish" onClick={() => onNavigate?.('content')}>查看内容管理</button>
          </div>
          <ol className="overview-ranked-list">
            {DASHBOARD_MANIFEST.iteration.tasks.slice(0, 4).map((item, index) => (
              <li key={item.taskId}>
                <span>{index + 1}</span>
                <div><strong>{item.title}</strong><small>{item.cause} · {item.owner}</small></div>
                <em>{item.priority}</em>
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

      {/* 第三层 C：检索趋势详情（可折叠） */}
      <details className="overview-charts-details">
        <summary>查看检索趋势详情</summary>
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
      </details>

      {/* 技术指标折叠块 */}
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
