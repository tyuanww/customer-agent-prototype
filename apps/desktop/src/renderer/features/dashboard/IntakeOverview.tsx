import { createElement, useEffect, useState, type ComponentType, type KeyboardEvent } from 'react';
import { Button, DatePicker, Empty, Input, Segmented, Select, Space, Table, type TableProps } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import dateZhCN from 'antd/es/date-picker/locale/zh_CN';
import {
  ITERATION_COPY,
  iterationMatterLabel,
  type DashboardIterationCause,
  type DashboardIterationTask,
} from '@shared/dashboard-iteration';
import type { DashboardWordingResult } from '@shared/dashboard-wording';
import { inaccuracyScriptIdFromTask } from '@shared/inaccuracy-todo';
import {
  decideIterationClose,
  type CloseHintCatalog,
  type CloseHintTask,
} from '@shared/iteration-close-hint';
import {
  knowledgeValidityReminders,
  type KnowledgeValidityReminder,
} from '@shared/query-action-ledger';
import { v9Donut, v9DonutRings, v9Headline, v9Trend, v9UsageQuery, V9_MISS, V9_PAGE_SIZE } from './v9-overview-model';
import { aggregateUsage, rankMissRows, rankUsageRows, trendFromUsage, type UsageSourceRow } from '@shared/usage-log-csv';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import { formatShortTime } from './intake-time';
import './workbench-v9.css';

dayjs.locale('zh-cn');

const CAUSE_LABELS = {
  content_gap: '内容缺口',
  ranking: '排序问题',
  stale: '过期仍召回',
  mixed: '待判',
} as const;

const CAUSE_OPTIONS = [
  ['content_gap', CAUSE_LABELS.content_gap],
  ['ranking', CAUSE_LABELS.ranking],
  ['stale', CAUSE_LABELS.stale],
  ['mixed', CAUSE_LABELS.mixed],
] as const;

const LOGIN_TODO = '请先登录后再查看待办。';
const AFTER_QUERY = '坐席查询后会出现';
const TREND_EMPTY = '坐席查询后，趋势会出现在这里。';
const SHARE_EMPTY = '坐席查询后，占比会出现在这里。';
const SHARE_UNTYPED = '这些记录还分不出话术类型。';
const USAGE_EMPTY = '坐席查询后，排行会出现在这里。';
const SOP_EMPTY = '坐席走完 SOP 后，次数会出现在这里。';
const MISS_EMPTY = '坐席问到没有话术的问题后，会出现在这里。';
const EXPIRE_EMPTY = '登录后可以看即将到期的知识。';
const NO_ROWS = '没有符合条件的记录。换个词，或清空搜索后再看。';

const ROLE_OPTIONS = [
  { value: '', label: '全部岗位' },
  { value: '客服', label: '客服' },
  { value: '客服主管', label: '客服主管' },
];

const TYPE_OPTIONS = ['', '产品', '活动', '售前', '售后'].map((type) => ({
  label: type || '全部',
  value: type,
}));

type OverviewPanel = 'usage' | 'sop' | 'miss' | 'expire' | 'todo';

type UsageTableRow = {
  key: string;
  rank: number;
  name: string;
  tag?: string;
  total: number;
  extra: string;
  person?: boolean;
  trend?: { points: string; up: boolean } | null;
  bar?: number;
  library?: boolean;
};

type MissTableRow = {
  key: string;
  rank: number;
  question: string;
  count: number;
  latest: string;
};

type TodoTableRow = {
  key: string;
  task: DashboardIterationTask;
};

function statusLabel(status: DashboardIterationTask['status']): string {
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'resolved') return '已处理';
  return '暂不处理';
}

function isCause(value: string): value is DashboardIterationCause {
  return value === 'content_gap' || value === 'ranking' || value === 'stale' || value === 'mixed';
}

type DayWindow = { start: number; end: number };

const OVERVIEW_PANELS: ReadonlyArray<{ id: OverviewPanel; label: string }> = [
  { id: 'usage', label: '话术使用排行' },
  { id: 'sop', label: 'SOP 使用' },
  { id: 'miss', label: '无命中排行' },
  { id: 'expire', label: '话术过期提醒' },
  { id: 'todo', label: '迭代待办' },
];

function recentWindow(days: number, now = new Date()): DayWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

function sameLocalDay(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function presetDays(span: DayWindow, now = new Date()): 7 | 30 | null {
  const seven = recentWindow(7, now);
  const thirty = recentWindow(30, now);
  if (sameLocalDay(span.start, seven.start) && sameLocalDay(span.end, seven.end)) return 7;
  if (sameLocalDay(span.start, thirty.start) && sameLocalDay(span.end, thirty.end)) return 30;
  return null;
}

function spanLabel(span: DayWindow): string {
  const format = (ms: number) => {
    const date = new Date(ms);
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  return `${format(span.start)} 至 ${format(span.end)}`;
}

function movePanel(event: KeyboardEvent<HTMLElement>, index: number, select: (id: OverviewPanel) => void) {
  const next = event.key === 'ArrowRight' ? (index + 1) % OVERVIEW_PANELS.length
    : event.key === 'ArrowLeft' ? (index + OVERVIEW_PANELS.length - 1) % OVERVIEW_PANELS.length
    : event.key === 'Home' ? 0
    : event.key === 'End' ? OVERVIEW_PANELS.length - 1
    : null;
  if (next === null) return;
  event.preventDefault();
  const id = OVERVIEW_PANELS[next]!.id;
  select(id);
  document.getElementById(`overview-tab-${id}`)?.focus();
}

function seatMessage(message: string): string {
  return message === '未接入' ? LOGIN_TODO : message;
}

function todoTitle(task: DashboardIterationTask): string {
  const scriptId = inaccuracyScriptIdFromTask(task);
  return scriptId ? `话术不准 · ${scriptId}` : iterationMatterLabel(task.clusterKey);
}

function OverviewEmpty({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

function tabLabel(label: string, count: number | null) {
  return <span>{label}{count === null ? null : <b aria-hidden="true" style={{ marginLeft: 6 }}>{count}</b>}</span>;
}

const nowrapCell = () => ({ style: { whiteSpace: 'nowrap' as const } });

/** rc-table copies aria-label onto the table element. antd's prop type omits it. */
function A11yTable<RecordType extends object>(
  props: TableProps<RecordType> & { 'aria-label': string },
) {
  return createElement(Table as ComponentType<typeof props>, props);
}

function catalogFromWording(result: DashboardWordingResult): CloseHintCatalog | null {
  if (!result.ok) return null;
  return {
    catalogRefreshedAt: result.catalogRefreshedAt,
    matchesLease: result.matchesLease,
    entries: result.entries.map((entry) => ({
      scriptId: entry.scriptId,
      effectiveFrom: entry.effectiveFrom,
    })),
  };
}

function judgedTask(task: DashboardIterationTask, cause: DashboardIterationCause): CloseHintTask {
  return {
    signalId: task.signalId,
    clusterKey: task.clusterKey,
    suggestedScriptIds: task.suggestedScriptIds,
    sampleQueryIds: task.sampleQueryIds,
    status: task.status === 'in_progress' ? 'in_progress' : 'open',
    suspectedCause: cause,
    createdAt: task.createdAt,
  };
}

function TrendLines({ points }: { points: ReadonlyArray<{ day: string; use: number; miss: number }> }) {
  const width = 600;
  const height = 200;
  const left = 28;
  const right = 12;
  const top = 16;
  const bottom = 28;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => Math.max(point.use, point.miss)));
  const xAt = (index: number) => points.length === 1 ? left + innerW / 2 : left + (innerW * index) / (points.length - 1);
  const yAt = (value: number) => top + innerH - (value / max) * innerH;
  const line = (key: 'use' | 'miss') => points.map((point, index) => `${index ? 'L' : 'M'}${xAt(index).toFixed(1)} ${yAt(point[key]).toFixed(1)}`).join(' ');
  const labelEvery = points.length > 8 ? Math.ceil(points.length / 6) : 1;
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="使用趋势图" style={{ width: '100%', height: 200 }}>
    <path d={line('use')} fill="none" stroke="var(--chart-use)" strokeWidth="2.5" />
    <path d={line('miss')} fill="none" stroke="var(--chart-miss)" strokeWidth="2.5" />
    {points.map((point, index) => <g key={point.day}>
      <circle cx={xAt(index)} cy={yAt(point.use)} r="4" fill="var(--chart-use)" />
      <circle cx={xAt(index)} cy={yAt(point.miss)} r="4" fill="var(--chart-miss)" />
      {index % labelEvery === 0 || index === points.length - 1
        ? <text x={xAt(index)} y={height - 8} textAnchor="middle" fontSize="11" fill="currentColor">{point.day.slice(5)}</text>
        : null}
    </g>)}
  </svg>;
}

export function IntakeOverview({
  onOpen,
  onTodoCount,
  onSupplyScript,
}: {
  onOpen: (target: 'content' | 'wording' | 'permissions') => void;
  onTodoCount?: (count: number) => void;
  onSupplyScript?: (question: string) => void;
}) {
  const [tasks, setTasks] = useState<readonly DashboardIterationTask[] | null>(null);
  const [message, setMessage] = useState('加载中…');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CloseHintCatalog | null>(null);
  const [reminders, setReminders] = useState<readonly KnowledgeValidityReminder[]>([]);
  const [deskReminders, setDeskReminders] = useState<'unavailable' | 'ready'>('unavailable');
  const [deskRole, setDeskRole] = useState<'operator' | 'seat' | null>(null);
  const [causeById, setCauseById] = useState<Record<string, DashboardIterationCause>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<OverviewPanel>('usage');
  const [span, setSpan] = useState<DayWindow>(() => recentWindow(7));
  const [usageView, setUsageView] = useState<'script' | 'person'>('script');
  const [usageType, setUsageType] = useState('');
  const [usageRole, setUsageRole] = useState('');
  const [usageQuery, setUsageQuery] = useState('');
  const [usageDesc, setUsageDesc] = useState(true);
  const [usagePage, setUsagePage] = useState(0);
  const [sourceRows, setSourceRows] = useState<UsageSourceRow[] | null>(null);
  const [usageState, setUsageState] = useState<'absent' | 'loading' | 'failed' | 'ready' | 'empty' | 'signed-out' | 'unmounted'>(() => window.dashboardUsageLog ? 'loading' : 'absent');
  const previewLocation = window.location;
  const showSynthetic = (previewLocation.hostname === '127.0.0.1' || previewLocation.hostname === 'localhost')
    && new URLSearchParams(previewLocation.search).get('preview') === 'intake';

  useEffect(() => {
    const api = window.dashboardIteration;
    if (!api) {
      setTasks(null);
      setMessage(LOGIN_TODO);
      return undefined;
    }
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setTasks(null);
        setMessage(LOGIN_TODO);
        return;
      }
      setTasks(result.items);
      setMessage('');
    }).catch(() => {
      if (!live) return;
      setTasks(null);
      setMessage(LOGIN_TODO);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const api = window.dashboardWording;
    if (!api) return undefined;
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      setCatalog(catalogFromWording(result));
    }).catch(() => {
      if (live) setCatalog(null);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const api = window.dashboardDesk;
    if (!api) return undefined;
    let live = true;
    void api.current().then((result) => {
      if (!live) return;
      if (!result.ok) { setDeskReminders('unavailable'); return; }
      setDeskRole(result.view.role === 'seat' ? 'seat' : 'operator');
      setReminders(knowledgeValidityReminders(result.view.items.map((item) => ({
        id: item.id,
        question: item.name,
        statusLabel: item.statusLabel,
      }))));
      setDeskReminders('ready');
    }).catch(() => {
      if (live) setDeskReminders('unavailable');
    });
    return () => { live = false; };
  }, []);

  function closeTask(task: DashboardIterationTask, status: 'resolved' | 'wont_fix') {
    const api = window.dashboardIteration;
    if (!api || busyId !== null) return;
    const cause = causeById[task.taskId] ?? task.suspectedCause;
    const note = noteById[task.taskId] ?? '';
    const decision = decideIterationClose({
      task: judgedTask(task, cause),
      catalog,
      status,
      resolutionNote: note,
    });
    if (!decision.ok) {
      setMessage(decision.reason === 'needs_newer_release'
        ? '等更新发布后再标已处理。'
        : '请填写原因。');
      return;
    }
    const resolutionNote = decision.resolutionNote.length > 0
      ? `${CAUSE_LABELS[cause]}：${decision.resolutionNote}`
      : CAUSE_LABELS[cause];
    setBusyId(task.taskId);
    void api.close({
      taskId: task.taskId,
      expectedVersion: task.version,
      status: decision.status,
      resolutionNote,
    }).then((result) => {
      setBusyId(null);
      if (!result.ok) {
        setMessage(seatMessage(result.message));
        return;
      }
      setTasks((current) => (current ?? []).map((row) => row.taskId === result.task.taskId ? result.task : row));
      setMessage('');
    }).catch(() => {
      setBusyId(null);
      setMessage(LOGIN_TODO);
    });
  }

  function startTask(task: DashboardIterationTask) {
    const api = window.dashboardIteration;
    if (!api) return;
    setBusyId(task.taskId);
    void api.start({ taskId: task.taskId, expectedVersion: task.version }).then((result) => {
      setBusyId(null);
      if (!result.ok) { setMessage(seatMessage(result.message)); return; }
      setTasks((current) => (current ?? []).map((row) => row.taskId === result.task.taskId ? result.task : row));
    }).catch(() => { setBusyId(null); setMessage(LOGIN_TODO); });
  }

  const openTasks = (tasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  const openTaskCount = openTasks.length;
  useEffect(() => { onTodoCount?.(tasks === null ? 0 : openTaskCount); }, [tasks, openTaskCount, onTodoCount]);
  useEffect(() => {
    const api = window.dashboardUsageLog;
    if (!api) { setUsageState('absent'); setSourceRows(null); return undefined; }
    setUsageState('loading');
    let live = true;
    void (async () => {
      const collected: UsageSourceRow[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const reply = await api.list({ result: '', query: '', cursor });
        if (!live) return;
        if (!reply.ok) {
          setSourceRows(null);
          setUsageState(reply.code === 'UNAUTHORIZED' ? 'signed-out' : reply.code === 'UNAVAILABLE' ? 'unmounted' : 'failed');
          return;
        }
        if (cursor !== null && seen.has(cursor)) { setSourceRows(null); setUsageState('failed'); return; }
        if (cursor !== null) seen.add(cursor);
        collected.push(...reply.rows);
        cursor = reply.nextCursor;
      } while (cursor);
      const windowed = collected.filter((row) => {
        const asked = Date.parse(row.askedAt);
        return Number.isFinite(asked) && asked >= span.start && asked <= span.end;
      });
      if (live) { setSourceRows(windowed); setUsageState(windowed.length === 0 ? 'empty' : 'ready'); }
    })().catch(() => { if (live) { setSourceRows(null); setUsageState('failed'); } });
    return () => { live = false; };
  }, [span.start, span.end]);
  const sourced = sourceRows === null ? null : aggregateUsage(sourceRows);
  const sampleDays = presetDays(span);
  const sampleHeadline = showSynthetic && usageState === 'absent' && sampleDays !== null;
  const headline = sourced
    ? { use: sourced.use.toLocaleString('en-US'), miss: sourced.miss.toLocaleString('en-US'), rate: sourced.rate }
    : (sampleHeadline && sampleDays ? v9Headline(sampleDays) : null);
  const liveRanks = sourceRows === null ? null : rankUsageRows(sourceRows, usageView)
    .filter((row) => {
      const needle = usageQuery.trim();
      return needle === '' || row.name.includes(needle);
    });
  const orderedRanks = liveRanks === null ? null : (usageDesc ? liveRanks : [...liveRanks].reverse());
  const liveMisses = sourceRows === null ? null : rankMissRows(sourceRows);
  const liveTrend = sourceRows === null ? null : trendFromUsage(sourceRows);
  const usage = sampleHeadline
    ? v9UsageQuery({ view: usageView, type: usageType, role: usageRole, q: usageQuery.trim(), desc: usageDesc, page: usagePage })
    : null;
  const usageRows = usage?.rows ?? [];
  const maxUsage = Math.max(...usageRows.map((row) => row.total), 1);
  const showSampleCharts = sampleHeadline;
  const rings = showSampleCharts ? v9DonutRings() : null;
  const donut = showSampleCharts ? v9Donut() : null;
  const usageTableRows: UsageTableRow[] = orderedRanks
    ? orderedRanks.map((row, index) => ({
      key: row.name,
      rank: index + 1,
      name: row.name,
      total: row.total,
      extra: row.extra,
    }))
    : usage
      ? usageRows.map((row, index) => {
        const rank = usageDesc ? usage.page * V9_PAGE_SIZE + index + 1 : usage.count - (usage.page * V9_PAGE_SIZE + index);
        return {
          key: row.name,
          rank,
          name: row.name,
          tag: row.tag,
          total: row.total,
          extra: row.extra,
          person: row.person,
          trend: row.trend,
          bar: Math.round(row.total / maxUsage * 100),
          library: !row.person,
        };
      })
      : [];
  const usageCount = orderedRanks ? orderedRanks.length : usage ? usage.count : null;
  const missRows: MissTableRow[] | null = liveMisses
    ? liveMisses.map((row, index) => ({
      key: row.question,
      rank: index + 1,
      question: row.question,
      count: row.count,
      latest: formatShortTime(row.latest),
    }))
    : sampleHeadline
      ? V9_MISS.map(([question, count, when], index) => ({
        key: question,
        rank: index + 1,
        question,
        count,
        latest: when,
      }))
      : null;
  const missCount = liveMisses ? liveMisses.length : sampleHeadline ? V9_MISS.length : null;
  const todoRows: TodoTableRow[] = (tasks === null ? [] : openTasks).map((task) => ({ key: task.taskId, task }));
  const panelCounts: Record<OverviewPanel, number | null> = {
    usage: usageCount,
    sop: null,
    miss: missCount,
    expire: reminders.length,
    todo: openTasks.length,
  };

  function supplyScript(question: string) {
    return <Button
      type="text"
      disabled={deskRole !== 'operator'}
      title={deskRole === 'seat' ? '坐席不能添加话术' : '仅运营可补充。'}
      onClick={() => { if (onSupplyScript) onSupplyScript(question); else onOpen('content'); }}
    >补充话术</Button>;
  }

  return <section className="dash-module intake-management intake-overview wb9" data-testid="module-overview">
    <h1 className="desk-sr">概览</h1>
    <div className="ov-head"><span className="mute">数据范围</span>
      <DatePicker.RangePicker
        aria-label="时间范围"
        allowClear={false}
        format="YYYY-MM-DD"
        inputReadOnly={false}
        classNames={{ popup: { root: 'overview-range-popup' } }}
        getPopupContainer={() => document.body}
        locale={dateZhCN}
        placeholder={['开始日期', '结束日期']}
        placement="bottomRight"
        style={{ width: 260 }}
        value={[dayjs(span.start), dayjs(span.end)]}
        presets={[
          { label: '近 7 天', value: () => { const next = recentWindow(7); return [dayjs(next.start), dayjs(next.end)]; } },
          { label: '近 30 天', value: () => { const next = recentWindow(30); return [dayjs(next.start), dayjs(next.end)]; } },
        ]}
        onChange={(dates) => {
          const start = dates?.[0];
          const end = dates?.[1];
          if (!start || !end) return;
          setSpan({ start: start.startOf('day').valueOf(), end: end.endOf('day').valueOf() });
        }}
      />
    </div>
    <div className="tiles">
      <div className="tile"><span className="t-lbl">话术使用次数</span><b>{headline?.use ?? '—'}</b>{sampleHeadline ? <span className="t-sub up">较上期 ↑ 8%</span> : null}{headline || usageState === 'signed-out' ? null : <span className="t-sub">{usageState === 'failed' ? '使用记录没读到。刷新页面后再看。' : AFTER_QUERY}</span>}</div>
      <div className="tile"><span className="t-lbl">无命中次数</span><b>{headline?.miss ?? '—'}</b>{sampleHeadline ? <span className="t-sub down">较上期 ↓ 5%</span> : null}{headline || usageState === 'signed-out' ? null : <span className="t-sub">{usageState === 'failed' ? '使用记录没读到。刷新页面后再看。' : AFTER_QUERY}</span>}</div>
      <div className="tile"><span className="t-lbl">命中率</span><b>{headline?.rate ?? '—'}</b>{sampleHeadline ? <span className="t-sub up">较上期 ↑ 1.2 个百分点</span> : null}{headline || usageState === 'signed-out' ? null : <span className="t-sub">{usageState === 'failed' ? '使用记录没读到。刷新页面后再看。' : AFTER_QUERY}</span>}</div>
      <div className="tile"><span className="t-lbl">待办</span><b>{openTasks.length}</b><Button type="text" onClick={() => setPanel('todo')}>去处理</Button></div>
    </div>
    <div className="charts">
      <div className="card" aria-label="使用趋势">
        <div className="card-head"><h3>使用趋势</h3><span className="legend"><i style={{ background: 'var(--chart-use)' }} />使用<i style={{ background: 'var(--chart-miss)' }} />无命中</span></div>
        <div className="chart-wrap">{usageState === 'signed-out'
          ? <p data-testid="overview-usage-status">{WORKBENCH_EMPTY.signedOut}</p>
          : usageState === 'unmounted'
          ? <p data-testid="overview-usage-status">{WORKBENCH_EMPTY.usageUnmounted}</p>
          : liveTrend && liveTrend.length > 0
          ? <TrendLines points={liveTrend} />
          : usageState === 'empty'
            ? <div data-testid="usage-trend-empty">
              <svg viewBox="0 0 640 188" role="img" aria-label="暂无使用记录">
                <rect x="0.5" y="0.5" width="639" height="187" fill="none" stroke="currentColor" strokeOpacity="0.12" />
                <line x1="28" y1="142" x2="628" y2="142" stroke="currentColor" strokeOpacity="0.2" />
              </svg>
              <p>{WORKBENCH_EMPTY.usageEmpty}</p>
            </div>
          : sampleHeadline
            ? <svg viewBox="0 0 600 222" dangerouslySetInnerHTML={{ __html: sampleDays ? v9Trend(sampleDays) : '' }} />
            : <OverviewEmpty description={TREND_EMPTY} />}</div>
      </div>
      <div className="card" aria-label="话术类型占比">
        <div className="card-head"><h3>话术类型占比</h3></div>
        {donut ? <div className="donut-wrap">
          <svg viewBox="0 0 140 140" width="140" height="140">
            {rings?.rings.map((ring) => <circle key={ring.color} cx="70" cy="70" r={rings.radius} fill="none" stroke={ring.color} strokeWidth="16" strokeDasharray={`${ring.dash} ${ring.gap}`} strokeDashoffset={ring.offset} transform="rotate(-90 70 70)" />)}
            <text x="70" y="68" textAnchor="middle" fontSize="18" fontWeight="600" fill="currentColor">{donut.all.toLocaleString('en-US')}</text>
            <text x="70" y="86" textAnchor="middle" fontSize="11" fill="currentColor">使用次数</text>
          </svg>
          <ul className="dlegend">{donut.parts.map((part) => <li key={part.type}><i style={{ background: part.color }} />{part.type}<span className="n">{part.total.toLocaleString('en-US')}</span><b>{part.pct}%</b></li>)}</ul>
        </div> : sourceRows === null
          ? <OverviewEmpty description={SHARE_EMPTY} />
          : <OverviewEmpty description={SHARE_UNTYPED} />}
      </div>
    </div>
    <div className="card flush">
      <div className="tabbar">
        <div className="tabs" role="tablist" aria-label="概览分栏">
          {OVERVIEW_PANELS.map((item, index) => <Button
            type="text"
            role="tab"
            key={item.id}
            id={`overview-tab-${item.id}`}
            aria-selected={panel === item.id}
            aria-controls="overview-panel"
            tabIndex={panel === item.id ? 0 : -1}
            className="tab"
            onClick={() => setPanel(item.id)}
            onKeyDown={(event) => movePanel(event, index, setPanel)}
          >{tabLabel(item.label, panelCounts[item.id])}</Button>)}
        </div>
      </div>
      <div id="overview-panel" role="tabpanel" aria-labelledby={`overview-tab-${panel}`}>
      {panel === 'usage' ? <div className="pn">
              <div className="filters2">
                <Segmented
                  aria-label="视图"
                  value={usageView}
                  onChange={(value) => {
                    if (value !== 'script' && value !== 'person') return;
                    setUsageView(value);
                    setUsagePage(0);
                  }}
                  options={[{ label: '按话术', value: 'script' }, { label: '按人员', value: 'person' }]}
                />
                {sourceRows === null ? <Segmented
                  aria-label="话术类型"
                  value={usageType}
                  onChange={(value) => { setUsageType(String(value)); setUsagePage(0); }}
                  options={TYPE_OPTIONS}
                /> : null}
                <span className="grow" />
                {sourceRows === null ? <Select
                  aria-label="岗位"
                  value={usageRole}
                  style={{ width: 140 }}
                  onChange={(value) => { setUsageRole(value); setUsagePage(0); }}
                  options={ROLE_OPTIONS}
                /> : null}
                <Input aria-label={usageView === 'script' ? '搜索话术' : '搜索人员'} placeholder={usageView === 'script' ? '搜索话术' : '搜索人员'} style={{ width: 220 }} value={usageQuery} onChange={(event) => { setUsageQuery(event.target.value); setUsagePage(0); }} />
              </div>
              <A11yTable<UsageTableRow>
                aria-label="话术使用排行"
                pagination={false}
                rowKey="key"
                dataSource={usageTableRows}
                locale={{ emptyText: <OverviewEmpty description={orderedRanks !== null || usage !== null ? NO_ROWS : USAGE_EMPTY} /> }}
                columns={[
                  {
                    title: '排名',
                    dataIndex: 'rank',
                    width: 96,
                    render: (rank: number) => <span className={rank <= 3 ? 'rk top' : 'rk'}>{rank}</span>,
                  },
                  {
                    title: usageView === 'script' ? '话术名称' : '人员',
                    dataIndex: 'name',
                    render: (_name, row) => <>
                      {row.person
                        ? <Button type="text" title={`只看${row.name}用过的话术`} onClick={() => { setUsageQuery(row.name); setUsageView('script'); setUsagePage(0); }}>{row.name}</Button>
                        : row.name}
                      {row.tag ? <span className="tag">{row.tag}</span> : null}
                    </>,
                  },
                  {
                    title: <Button type="text" aria-label="按使用次数排序" onClick={() => { setUsageDesc((value) => !value); setUsagePage(0); }}>使用次数</Button>,
                    dataIndex: 'total',
                    width: 140,
                    render: (total: number, row) => <div className="cnt"><b>{total}</b>{row.bar === undefined ? null : <i style={{ width: `${row.bar}%` }} />}</div>,
                  },
                  {
                    title: usageView === 'script' ? `${spanLabel(span)} · 使用人` : '最常用话术',
                    dataIndex: 'extra',
                    render: (extra: string, row) => row.trend
                      ? <div className="trend"><svg viewBox="0 0 76 20" className={row.trend.up ? '' : 'down'} aria-label="近7天趋势"><polyline points={row.trend.points} /></svg><span className="who">{extra}</span></div>
                      : <span className="who">{extra}</span>,
                  },
                  {
                    title: '',
                    key: 'jump',
                    width: 112,
                    render: (_value, row) => row.library ? <Button type="text" onClick={() => onOpen('content')}>去知识库</Button> : null,
                  },
                ]}
              />
              {usage ? <div className="pager"><span>共 {usage.count} 条{usageView === 'person' ? ` · ${usage.people} 位人员` : ''}</span><span className="grow" />
                <Button disabled={usage.page === 0} onClick={() => setUsagePage(usage.page - 1)}>上一页</Button>
                <span>{usage.page + 1} / {usage.pages}</span>
                <Button disabled={usage.page >= usage.pages - 1} onClick={() => setUsagePage(usage.page + 1)}>下一页</Button></div> : null}
            </div> : null}
      {panel === 'sop' ? <div className="pn"><OverviewEmpty description={SOP_EMPTY} /></div> : null}
      {panel === 'miss' ? <section className="pn" aria-label="无命中">
              <h2 className="desk-sr">无命中</h2>
              <A11yTable<MissTableRow>
                aria-label="无命中排行"
                pagination={false}
                rowKey="key"
                dataSource={missRows ?? []}
                locale={{ emptyText: <OverviewEmpty description={missRows && missRows.length === 0 ? NO_ROWS : MISS_EMPTY} /> }}
                columns={[
                  {
                    title: '排名',
                    dataIndex: 'rank',
                    render: (rank: number) => <span className={rank <= 3 ? 'rk top' : 'rk'}>{rank}</span>,
                  },
                  { title: '用户问题', dataIndex: 'question' },
                  {
                    title: '未命中次数',
                    dataIndex: 'count',
                    render: (count: number) => <div className="cnt warn"><b>{count}</b></div>,
                  },
                  { title: '最近一次', dataIndex: 'latest', render: (latest: string) => <span className="mute">{latest}</span> },
                  { title: '', key: 'supply', render: (_value, row) => supplyScript(row.question) },
                ]}
              />
            </section> : null}
      {panel === 'expire' ? <section aria-label="知识有效期">
              <h2 className="desk-sr">知识有效期</h2>
              {deskReminders !== 'ready'
                ? <OverviewEmpty description={EXPIRE_EMPTY} />
                : <A11yTable<KnowledgeValidityReminder>
                  aria-label="知识有效期提醒"
                  pagination={false}
                  rowKey="id"
                  dataSource={[...reminders]}
                  locale={{ emptyText: <OverviewEmpty description={ITERATION_COPY.empty} /> }}
                  columns={[
                    { title: '状态', dataIndex: 'label' },
                    { title: '话术名称', dataIndex: 'question' },
                  ]}
                />}
            </section> : null}
      {panel === 'todo' ? <A11yTable<TodoTableRow>
              aria-label="话术迭代"
              pagination={false}
              rowKey="key"
              dataSource={todoRows}
              locale={{ emptyText: <OverviewEmpty description={tasks === null ? message : ITERATION_COPY.empty} /> }}
              columns={[
                {
                  title: '状态',
                  width: 88,
                  onCell: nowrapCell,
                  onHeaderCell: nowrapCell,
                  render: (_value, row) => statusLabel(row.task.status),
                },
                { title: '事项', render: (_value, row) => todoTitle(row.task) },
                {
                  title: '原因',
                  render: (_value, row) => {
                    const cause = causeById[row.task.taskId] ?? row.task.suspectedCause;
                    const title = todoTitle(row.task);
                    return <Select
                      aria-label={`原因 ${title}`}
                      value={cause}
                      onChange={(value) => {
                        if (!isCause(value)) return;
                        setCauseById((current) => ({ ...current, [row.task.taskId]: value }));
                      }}
                      options={CAUSE_OPTIONS.map(([value, label]) => ({ value, label }))}
                    />;
                  },
                },
                {
                  title: '操作',
                  render: (_value, row) => {
                    const task = row.task;
                    const title = todoTitle(task);
                    const busy = busyId === task.taskId;
                    if (task.status === 'open') {
                      return <Space size={8}>
                        <Button type="primary" disabled={busy} onClick={() => startTask(task)}>开始处理</Button>
                        <Button type="text" onClick={() => onOpen('content')}>去知识库</Button>
                      </Space>;
                    }
                    return <Space wrap size={8} align="center">
                      <Input style={{ width: 180 }} placeholder="处理说明" aria-label={`处理说明 ${title}`} value={noteById[task.taskId] ?? ''} onChange={(event) => {
                        const value = event.target.value;
                        setNoteById((current) => ({ ...current, [task.taskId]: value }));
                      }} />
                      <Button type="primary" disabled={busy} onClick={() => closeTask(task, 'resolved')}>已处理</Button>
                      <Button type="text" disabled={busy || (noteById[task.taskId] ?? '').trim().length === 0} onClick={() => closeTask(task, 'wont_fix')}>暂不处理</Button>
                    </Space>;
                  },
                },
              ]}
            /> : null}
      </div>
    </div>
    {message && tasks !== null ? <p role="status">{message}</p> : null}
  </section>;
}
