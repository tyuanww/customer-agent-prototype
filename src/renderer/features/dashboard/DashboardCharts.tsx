import type {
  OverviewStructureItem,
  OverviewTrendMetricId,
  OverviewTrendPoint,
} from '../../data/dashboard-manifest';

const TREND_WIDTH = 720;
const TREND_HEIGHT = 238;
const TREND_MARGIN = { top: 18, right: 18, bottom: 34, left: 48 } as const;

function valueFor(point: OverviewTrendPoint, metric: OverviewTrendMetricId): number {
  if (metric === 'questions') return point.questions;
  if (metric === 'noHitRate') return point.noHitRate;
  return point.copyRate;
}

function formatValue(value: number, unit: string, decimals: number): string {
  return `${value.toFixed(decimals)}${unit}`;
}

type TrendChartProps = {
  points: readonly OverviewTrendPoint[];
  metric: OverviewTrendMetricId;
  metricLabel: string;
  unit: string;
  decimals: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function TrendChart({
  points,
  metric,
  metricLabel,
  unit,
  decimals,
  selectedIndex,
  onSelect,
}: TrendChartProps) {
  const values = points.map((point) => valueFor(point, metric));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawSpan = Math.max(rawMax - rawMin, rawMax * 0.08, 1);
  const min = Math.max(0, rawMin - rawSpan * 0.22);
  const max = rawMax + rawSpan * 0.22;
  const plotWidth = TREND_WIDTH - TREND_MARGIN.left - TREND_MARGIN.right;
  const plotHeight = TREND_HEIGHT - TREND_MARGIN.top - TREND_MARGIN.bottom;
  const xFor = (index: number) =>
    TREND_MARGIN.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value: number) =>
    TREND_MARGIN.top + (1 - (value - min) / Math.max(max - min, 1)) * plotHeight;
  const coordinates = values.map((value, index) => ({ x: xFor(index), y: yFor(value) }));
  const linePath = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const ticks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    return {
      value: max - (max - min) * ratio,
      y: TREND_MARGIN.top + plotHeight * ratio,
    };
  });

  return (
    <svg
      className="dash-line-chart"
      viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
      role="group"
      aria-label={`${metricLabel}八个固定合成周期趋势，可选择数据点查看口径`}
      data-testid="overview-trend-chart"
    >
      {ticks.map((tick) => (
        <g key={tick.y} className="dash-chart-gridline">
          <line
            x1={TREND_MARGIN.left}
            x2={TREND_WIDTH - TREND_MARGIN.right}
            y1={tick.y}
            y2={tick.y}
          />
          <text x={TREND_MARGIN.left - 8} y={tick.y + 4} textAnchor="end">
            {formatValue(tick.value, unit, decimals)}
          </text>
        </g>
      ))}
      {points.map((point, index) => (
        <text
          key={point.label}
          className="dash-chart-x-label"
          x={xFor(index)}
          y={TREND_HEIGHT - 10}
          textAnchor="middle"
        >
          {point.label}
        </text>
      ))}
      <path className="dash-chart-line" d={linePath} />
      {coordinates.map((coordinate, index) => {
        const point = points[index];
        const selected = index === selectedIndex;
        return (
          <circle
            key={point.label}
            className={selected ? 'dash-chart-point is-selected' : 'dash-chart-point'}
            cx={coordinate.x}
            cy={coordinate.y}
            r={selected ? 6 : 4}
            role="button"
            tabIndex={0}
            aria-label={`${point.range}，${metricLabel}${formatValue(values[index], unit, decimals)}`}
            aria-pressed={selected}
            data-testid={`overview-trend-point-${index}`}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(index);
              }
            }}
          >
            <title>{`${point.range} · ${metricLabel} ${formatValue(values[index], unit, decimals)}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

type StructureDonutProps = {
  items: readonly OverviewStructureItem[];
  selectedId: OverviewStructureItem['id'];
  onSelect: (id: OverviewStructureItem['id']) => void;
};

export function StructureDonut({ items, selectedId, onSelect }: StructureDonutProps) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="dash-structure-chart" data-testid="overview-structure-chart">
      <svg viewBox="0 0 140 140" role="img" aria-label={`合成检索操作结构，共 ${total} 次`}>
        <circle className="dash-donut-track" cx="70" cy="70" r={radius} />
        {items.map((item) => {
          const length = total ? (item.count / total) * circumference : 0;
          const segmentOffset = offset;
          offset += length;
          return (
            <circle
              key={item.id}
              className={`dash-donut-segment is-${item.tone}${selectedId === item.id ? ' is-selected' : ''}`}
              cx="70"
              cy="70"
              r={radius}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-segmentOffset}
              transform="rotate(-90 70 70)"
            >
              <title>{`${item.label} ${item.count} 次`}</title>
            </circle>
          );
        })}
        <text className="dash-donut-total" x="70" y="67" textAnchor="middle">{total}</text>
        <text className="dash-donut-caption" x="70" y="84" textAnchor="middle">合成操作</text>
      </svg>
      <div className="dash-structure-legend" aria-label="检索终态结构">
        {items.map((item) => {
          const selected = item.id === selectedId;
          const pct = total ? (item.count / total) * 100 : 0;
          return (
            <button
              key={item.id}
              type="button"
              className={selected ? 'is-selected' : ''}
              aria-pressed={selected}
              data-tone={item.tone}
              data-testid={`overview-structure-${item.id}`}
              onClick={() => onSelect(item.id)}
            >
              <span aria-hidden="true" />
              <strong>{item.label}</strong>
              <em>{item.count} · {pct.toFixed(1)}%</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}
