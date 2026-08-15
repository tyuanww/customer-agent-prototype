import { useMemo, useState } from 'react';
import {
  DASHBOARD_MANIFEST,
  type VocInsight,
  type VocTimeGrain,
  type VocTimeSlice,
} from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.workorders;
type SeverityFilter = VocInsight['severity'] | 'all';

function tone(severity: VocInsight['severity']): 'neutral' | 'warn' | 'danger' {
  return severity === 'risk' ? 'danger' : severity === 'warn' ? 'warn' : 'neutral';
}

function severityLabel(severity: SeverityFilter): string {
  if (severity === 'risk') return '风险升级';
  if (severity === 'warn') return '重点复核';
  if (severity === 'watch') return '持续观察';
  return '全部等级';
}

function grainLabel(grain: VocTimeGrain): string {
  if (grain === 'month') return '月';
  if (grain === 'day') return '日';
  return '年';
}

function insightForTimeSlice(item: VocInsight, slice: VocTimeSlice): VocInsight {
  const counts = slice.issueCounts.find((entry) => entry.insightId === item.id);
  const productBreakdown = counts?.productBreakdown ?? [];
  const count = productBreakdown.reduce((sum, part) => sum + part.count, 0);
  return {
    ...item,
    count,
    pct: slice.ticketCount ? Number(((count / slice.ticketCount) * 100).toFixed(1)) : 0,
    productBreakdown,
  };
}

function countForProduct(item: VocInsight, product: string): number {
  if (product === '全部产品线') return item.count;
  return item.productBreakdown.find((part) => part.product === product)?.count ?? 0;
}

function heatLevel(count: number, max: number): number {
  if (!count || !max) return 0;
  return Math.max(1, Math.ceil((count / max) * 4));
}

export function WorkorderModule() {
  const { batch } = data;
  const defaultPeriod = data.timeSlices.find((slice) => slice.grain === 'year') ?? data.timeSlices[0];
  const [grain, setGrain] = useState<VocTimeGrain>('year');
  const [periodId, setPeriodId] = useState(defaultPeriod.id);
  const [product, setProduct] = useState(data.productFilters[0]);
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [selectedId, setSelectedId] = useState(data.insights[0]?.id ?? '');
  const products = data.productFilters.slice(1);
  const periods = useMemo(
    () => data.timeSlices.filter((slice) => slice.grain === grain),
    [grain],
  );
  const period = periods.find((slice) => slice.id === periodId) ?? periods[0] ?? defaultPeriod;
  const timedInsights = useMemo(
    () => data.insights.map((item) => insightForTimeSlice(item, period)),
    [period],
  );
  const heatmapInsights = useMemo(
    () => timedInsights.filter(
      (item) => item.count > 0 && (severity === 'all' || item.severity === severity),
    ),
    [severity, timedInsights],
  );
  const pareto = useMemo(() => {
    const rows = timedInsights
      .filter((item) => severity === 'all' || item.severity === severity)
      .map((item) => ({ item, count: countForProduct(item, product) }))
      .filter((row) => row.count > 0)
      .sort((left, right) => right.count - left.count);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    let running = 0;
    return rows.map((row) => {
      running += row.count;
      return {
        ...row,
        share: total ? (row.count / total) * 100 : 0,
        cumulative: total ? (running / total) * 100 : 0,
      };
    });
  }, [product, severity, timedInsights]);
  const selected = pareto.find((row) => row.item.id === selectedId)?.item ?? pareto[0]?.item;
  const currentCount = pareto.reduce((sum, row) => sum + row.count, 0);
  const maxCount = Math.max(...pareto.map((row) => row.count), 1);
  const currentIndex = data.stages.findIndex((stage) => stage.id === batch.currentStage);
  const selectedCount = selected ? countForProduct(selected, product) : 0;
  const selectedPeriodPct = period.ticketCount
    ? ((selectedCount / period.ticketCount) * 100).toFixed(1)
    : '0.0';

  const chooseProduct = (next: string) => {
    setProduct(next);
    setSelectedId('');
  };

  const chooseGrain = (next: VocTimeGrain) => {
    const nextPeriod = data.timeSlices.find((slice) => slice.grain === next);
    setGrain(next);
    setPeriodId(nextPeriod?.id ?? defaultPeriod.id);
    setSelectedId('');
  };

  return (
    <div className="dash-module" data-testid="module-workorders">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <StatusBadge label="聚合镜像 · 无客户原文" tone="mock" />
      </header>
      <p className="dash-scope dash-scope-important">{data.story}</p>

      <div className="dash-filter-toolbar" aria-label="VOC 聚合筛选">
        <div className="dash-filter-group" role="group" aria-label="统计粒度">
          <span>统计粒度</span>
          <div className="dash-segmented">
            {(['year', 'month', 'day'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={grain === item ? 'is-active' : ''}
                aria-pressed={grain === item}
                data-testid={`voc-grain-${item}`}
                onClick={() => chooseGrain(item)}
              >
                {grainLabel(item)}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span>统计期间</span>
          <select
            data-testid="voc-period-filter"
            value={period.id}
            onChange={(event) => {
              setPeriodId(event.target.value);
              setSelectedId('');
            }}
          >
            {periods.map((slice) => <option key={slice.id} value={slice.id}>{slice.label}</option>)}
          </select>
        </label>
        <label>
          <span>产品线</span>
          <select
            id="voc-product"
            data-testid="voc-product-filter"
            value={product}
            onChange={(event) => chooseProduct(event.target.value)}
          >
            {data.productFilters.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <div className="dash-filter-group" role="group" aria-label="风险等级">
          <span>风险等级</span>
          <div className="dash-segmented">
            {(['all', 'risk', 'warn', 'watch'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={severity === item ? 'is-active' : ''}
                aria-pressed={severity === item}
                data-testid={`voc-severity-${item}`}
                onClick={() => {
                  setSeverity(item);
                  setSelectedId('');
                }}
              >
                {severityLabel(item)}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="dash-reset"
          data-testid="voc-reset"
          onClick={() => {
            setGrain('year');
            setPeriodId(defaultPeriod.id);
            setProduct(data.productFilters[0]);
            setSeverity('all');
            setSelectedId(data.insights[0]?.id ?? '');
          }}
        >
          重置筛选
        </button>
      </div>

      <div className="dash-selection-status" aria-live="polite" data-testid="voc-filter-status">
        <span>当前视图</span>
        <strong>{period.label} · {product} · {severityLabel(severity)}</strong>
        <em>{pareto.length} 个问题簇 / {currentCount.toLocaleString()} 条合成聚合</em>
      </div>

      <div className="voc-signal-grid">
        <article className="dash-card"><span>合成问题记录</span><strong data-testid="voc-period-ticket-count">{period.ticketCount.toLocaleString()}</strong><small>{period.rangeLabel} · 非真实工单总量</small></article>
        <article className="dash-card"><span>合成影响订单</span><strong data-testid="voc-period-order-count">{period.uniqueOrders.toLocaleString()}</strong><small>一单可有多问题，不按订单去重删行</small></article>
        <article className="dash-card"><span>当前筛选记录</span><strong>{currentCount.toLocaleString()}</strong><small>{product} · {severityLabel(severity)}</small></article>
        <article className="dash-card"><span>Top 问题集中度</span><strong>{pareto[0]?.share.toFixed(1) ?? '0.0'}%</strong><small>当前筛选内 Pareto 占比，不代表客诉率</small></article>
      </div>

      <div className="voc-layout">
        <section className="dash-card voc-pareto" aria-labelledby="voc-pareto-title">
          <div className="dash-card-row">
            <div>
              <span className="dash-card-label">Pareto 排序</span>
              <h2 id="voc-pareto-title">先看集中度，再决定下钻</h2>
            </div>
            <span className="dash-muted">条长 = 当前筛选内数量</span>
          </div>
          <div className="dash-pareto-axis" aria-hidden="true"><span>0</span><span>{maxCount.toLocaleString()}</span></div>
          <div className="dash-bars" data-testid="workorder-distribution">
            {pareto.map((row) => (
              <button
                key={row.item.id}
                type="button"
                className={`dash-pareto-row${selected?.id === row.item.id ? ' is-selected' : ''}`}
                aria-pressed={selected?.id === row.item.id}
                data-testid={`voc-insight-${row.item.id}`}
                onClick={() => setSelectedId(row.item.id)}
              >
                <span className="dash-pareto-label">
                  <strong>{row.item.label}</strong>
                  <em>{row.count.toLocaleString()} · {row.share.toFixed(1)}%</em>
                </span>
                <span className="dash-bar-track" aria-hidden="true">
                  <i style={{ width: `${(row.count / maxCount) * 100}%` }} />
                </span>
                <span className="dash-pareto-cumulative">累计 {row.cumulative.toFixed(1)}%</span>
              </button>
            ))}
          </div>
          {!pareto.length ? (
            <div className="dash-empty-state" data-testid="voc-empty">
              <strong>当前筛选没有合成问题簇</strong>
              <span>可重置筛选查看全部聚合；空态不代表真实业务没有问题。</span>
            </div>
          ) : null}
        </section>

        <aside className="dash-card voc-detail" data-testid="voc-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label">经理归因</span>
                <StatusBadge label={selected.severity === 'risk' ? '人工升级' : '需要复核'} tone={tone(selected.severity)} />
              </div>
              <h2>{selected.label}</h2>
              <strong className="voc-detail-number">{selectedCount.toLocaleString()}</strong>
              <span className="dash-muted">条当前筛选合成聚合</span>
              <dl className="dash-dl dash-dl-grid">
                <div><dt>产品范围</dt><dd>{selected.productScope.join(' / ')}</dd></div>
                <div><dt>所选期间占比</dt><dd>{selectedPeriodPct}%</dd></div>
                <div><dt>话术缺口</dt><dd>{selected.wordingGap}</dd></div>
                <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
              </dl>
              <p className="dash-next-step"><span>建议下一步</span>{selected.nextStep}</p>
            </>
          ) : <p className="dash-empty">选择一个问题簇查看归因</p>}
        </aside>
      </div>

      <section className="dash-card voc-heatmap-card" aria-labelledby="voc-heatmap-title">
        <div className="dash-card-row">
          <div>
            <span className="dash-card-label">产品 × 问题热力</span>
            <h2 id="voc-heatmap-title">同一问题簇落在哪条产品线</h2>
          </div>
          <span className="dash-muted">点击有值单元格联动 Pareto 与详情</span>
        </div>
        <div className="voc-heatmap" role="grid" aria-label="合成产品问题热力图" data-testid="voc-heatmap">
          <div className="voc-heatmap-corner" role="columnheader">问题簇</div>
          {products.map((item) => <div key={item} className={product === item ? 'is-active' : ''} role="columnheader">{item}</div>)}
          {heatmapInsights.map((item) => {
            const max = Math.max(...item.productBreakdown.map((part) => part.count), 1);
            return (
              <div className="voc-heatmap-row" role="row" key={item.id}>
                <div role="rowheader"><strong>{item.label}</strong><small>{severityLabel(item.severity)}</small></div>
                {products.map((itemProduct, index) => {
                  const count = item.productBreakdown.find((part) => part.product === itemProduct)?.count ?? 0;
                  const level = heatLevel(count, max);
                  return count ? (
                    <button
                      key={itemProduct}
                      type="button"
                      role="gridcell"
                      className={`is-heat-${level}${product === itemProduct && selected?.id === item.id ? ' is-selected' : ''}`}
                      aria-label={`${itemProduct}，${item.label}，${count} 条合成聚合`}
                      data-testid={`voc-heat-${item.id}-${index}`}
                      onClick={() => {
                        chooseProduct(itemProduct);
                        setSelectedId(item.id);
                      }}
                    >
                      {count}
                    </button>
                  ) : <span key={itemProduct} role="gridcell" aria-label={`${itemProduct}，${item.label}，无聚合`}>—</span>;
                })}
              </div>
            );
          })}
        </div>
        <div className="voc-heat-legend" aria-hidden="true"><span>低</span><i /><i /><i /><i /><span>高</span></div>
      </section>

      <details className="dash-contract-details">
        <summary>查看数据契约与导入流程</summary>
        <ol className="dash-pipeline" data-testid="workorder-pipeline">
          {data.stages.map((stage, index) => (
            <li key={stage.id} className={index === currentIndex ? 'is-current' : index < currentIndex ? 'is-done' : ''}>
              <span>{index + 1}</span>{stage.label}
            </li>
          ))}
        </ol>
        <div className="dash-split compact">
          <div>
            <strong>拒绝字段</strong>
            <ul className="dash-chip-list">{batch.rejectedFields.map((field) => <li key={field}>{field}</li>)}</ul>
          </div>
          <div>
            <p className="dash-footnote" data-testid="workorder-no-writeback">{data.noWriteback}</p>
            <p className="dash-empty">{data.noUpload}</p>
          </div>
        </div>
      </details>
    </div>
  );
}
