import { createElement, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { Button, DatePicker, Input, Select, Space, Table, type TableProps } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import dateZhCN from 'antd/es/date-picker/locale/zh_CN';
import {
  iterationMatterLabel,
  type DashboardIterationCause,
  type DashboardIterationTask,
} from '@shared/dashboard-iteration';
import type { DashboardWordingResult } from '@shared/dashboard-wording';
import type { WorkbenchKind } from '@shared/workbench-mode';
import { aggregateInaccuracyTodoCounts, inaccuracyScriptIdFromTask, INACCURACY_TODO_COPY } from '@shared/inaccuracy-todo';
import {
  INACCURACY_OUTCOME_COPY,
  outcomeSentence,
  type InaccuracyOutcome,
} from '@shared/inaccuracy-outcome';
import {
  decideIterationClose,
  type CloseHintCatalog,
  type CloseHintTask,
} from '@shared/iteration-close-hint';
import { asyncFailure, type AsyncResource } from '@shared/async-resource';
import { rankMissRows, type UsageSourceRow } from '@shared/usage-log-csv';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import { formatShortTime } from './intake-time';
import './workbench-v9.css';
import { WorkbenchFailed, WorkbenchLoading } from './WorkbenchState';

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

const LOGGED_OUT = '请先登录。';
const IDLE_RESOURCE = { status: 'idle' } as const;
const LOADING_RESOURCE = { status: 'loading' } as const;
const FORBIDDEN_TASKS = { status: 'forbidden', message: LOGGED_OUT } as const;
const USAGE_LATER = '坐席查询后会出现';
const USAGE_FAILED = '没读到。';
const TODO_EMPTY = '现在没有待办。';
const READ_SENTENCES = { forbidden: LOGGED_OUT, error: USAGE_FAILED } as const;
const INACCURACY_EMPTY = '当前没有达到开单阈值的不准稿。';
const USAGE_SCOPE = '查询次数、没查到和被复制只含当前登录者最近读到的记录，服务端最多 500 条，再按日期筛选，可能不完整。不准次数不随上面的日期变化。';
const QUESTION_SCOPE = '命中率、无命中率和不准反馈率依据当前数据库这段时间的记录计算，未按店铺筛选。';
const STATISTICS_UNAVAILABLE = '当前查询暂不能统计';
const TASKS_UNAVAILABLE = '当前待办暂不可用';
const OUTCOMES_UNAVAILABLE = '当前处理效果暂不可用';
const INACCURACY_SCOPE = '只含已开待办记下的样本，不是这段时间的全部。';
const MISS_ALL_ANSWERED = '所选时段内已读取的查询都有结果。';
const MISS_NO_QUERIES = '最近读取的记录中没有这段时间的查询。';
const COPY_ONLY = '只表示复制了';

const nowrapCell = () => ({ style: { whiteSpace: 'nowrap' as const } });

type DayWindow = { start: number; end: number };

type UsageRows = readonly UsageSourceRow[];
type UsageLoad = { rows: UsageRows; truncated: boolean };

type OverviewUsageCounts = {
  readonly queries: number;
  readonly misses: number;
  readonly copied: number;
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

type InaccuracyTableRow = {
  key: string;
  rank: number;
  scriptId: string;
  sampleCount: number;
  latest: string;
  openTaskCount: number;
};

function countOverviewUsage(rows: readonly UsageSourceRow[]): OverviewUsageCounts {
  let misses = 0;
  let copied = 0;
  for (const row of rows) {
    if (row.result === 'miss') misses += 1;
    else if (row.result === 'copied') copied += 1;
  }
  return { queries: rows.length, misses, copied };
}

function sumInaccuracySamples(rows: readonly { readonly sampleCount: number }[]): number {
  let total = 0;
  for (const row of rows) total += row.sampleCount;
  return total;
}

function recentWindow(days: number, now = new Date()): DayWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

function statusLabel(status: DashboardIterationTask['status']): string {
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'resolved') return '已处理';
  return '暂不处理';
}

function isCause(value: string): value is DashboardIterationCause {
  return value === 'content_gap' || value === 'ranking' || value === 'stale' || value === 'mixed';
}

function seatMessage(message: string): string {
  return message === '未接入' ? USAGE_FAILED : message;
}

function todoTitle(task: DashboardIterationTask): string {
  const scriptId = inaccuracyScriptIdFromTask(task);
  return scriptId ? `话术不准：${scriptId}` : iterationMatterLabel(task.clusterKey);
}

function OverviewEmpty({ description }: { description: string }) {
  return <p className="ov-empty">{description}</p>;
}

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

/** aggregateInaccuracyTodoCounts hides createdAt. The latest time stays on the task that owns it. */
function inaccuracyTableRows(tasks: readonly DashboardIterationTask[]): InaccuracyTableRow[] {
  const latestByScript = new Map<string, string>();
  for (const task of tasks) {
    const scriptId = inaccuracyScriptIdFromTask(task);
    if (scriptId === null) continue;
    const current = latestByScript.get(scriptId);
    if (!current || task.createdAt > current) latestByScript.set(scriptId, task.createdAt);
  }
  return aggregateInaccuracyTodoCounts(tasks).map((row, index) => ({
    key: row.scriptId,
    rank: index + 1,
    scriptId: row.scriptId,
    sampleCount: row.sampleCount,
    openTaskCount: row.openTaskCount,
    latest: formatShortTime(latestByScript.get(row.scriptId) ?? ''),
  }));
}

function CountTile({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  return <div className="tile">
    <span className="t-lbl">{label}</span>
    {value === null ? null : <b>{value}</b>}
    {detail ? <span className="t-sub">{detail}</span> : null}
  </div>;
}

function formatShopRate(value: string | null): string {
  if (value === null) return '没有查询';
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return '没有查询';
  const digits = `${match[1]}${match[2] ?? ''}`;
  const scale = match[2]?.length ?? 0;
  const shift = 3 - scale;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = BigInt(digits) * (10n ** BigInt(shift));
  } else {
    const cut = -shift;
    const body = digits.slice(0, digits.length - cut);
    const rest = digits.slice(digits.length - cut);
    const base = BigInt(body === '' ? '0' : body);
    scaled = base + (rest[0] !== undefined && rest[0] >= '5' ? 1n : 0n);
  }
  return `${scaled / 10n}.${scaled % 10n}%`;
}

function allocateShopTenths(hitCount: number, noHitCount: number, queryCount: number): [bigint, bigint] {
  const total = BigInt(queryCount);
  let hitTenths = (BigInt(hitCount) * 1000n) / total;
  let noHitTenths = (BigInt(noHitCount) * 1000n) / total;
  const hitRemainder = (BigInt(hitCount) * 1000n) % total;
  const noHitRemainder = (BigInt(noHitCount) * 1000n) % total;
  if (hitTenths + noHitTenths === 1000n) return [hitTenths, noHitTenths];
  if (hitRemainder > noHitRemainder || (hitRemainder === noHitRemainder && hitCount >= noHitCount)) {
    hitTenths += 1n;
  } else {
    noHitTenths += 1n;
  }
  return [hitTenths, noHitTenths];
}

function tenthsText(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}%`;
}

function shopRateText(rates: {
  queryCount: number;
  hitCount: number;
  noHitCount: number;
  hitRate: string | null;
  noHitRate: string | null;
  inaccuracyRate: string | null;
}): { hit: string; noHit: string; inaccuracy: string } {
  const inaccuracy = formatShopRate(rates.inaccuracyRate);
  if (rates.queryCount === 0 || rates.hitRate === null || rates.noHitRate === null) {
    return { hit: '没有查询', noHit: '没有查询', inaccuracy };
  }
  if (rates.hitCount + rates.noHitCount === rates.queryCount) {
    const [hitTenths, noHitTenths] = allocateShopTenths(rates.hitCount, rates.noHitCount, rates.queryCount);
    return { hit: tenthsText(hitTenths), noHit: tenthsText(noHitTenths), inaccuracy };
  }
  return {
    hit: formatShopRate(rates.hitRate),
    noHit: formatShopRate(rates.noHitRate),
    inaccuracy,
  };
}

function RateTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="tile">
    <span className="t-lbl">{label}</span>
    <b>{value}</b>
    {detail ? <span className="t-sub">{detail}</span> : null}
  </div>;
}

function usageStatusText(read: AsyncResource<UsageLoad>): string | null {
  switch (read.status) {
    case 'ready':
    case 'loading':
      return null;
    case 'idle':
      return USAGE_LATER;
    case 'error':
      return read.message;
    case 'forbidden':
      return read.message;
  }
}

function usageNote(read: AsyncResource<UsageLoad>, onRetry: () => void) {
  const text = usageStatusText(read);
  if (text === null) return null;
  if (read.status === 'error') {
    return <div data-testid="overview-usage-status">
      <WorkbenchFailed message={text} onRetry={onRetry} />
    </div>;
  }
  return <p className="t-sub" data-testid="overview-usage-status">{text}</p>;
}

function rowsInWindow(rows: readonly UsageSourceRow[], span: DayWindow): UsageSourceRow[] {
  return rows.filter((row) => {
    const asked = Date.parse(row.askedAt);
    return Number.isFinite(asked) && asked >= span.start && asked <= span.end;
  });
}

async function readUsageAll(isActive: () => boolean): Promise<AsyncResource<UsageLoad>> {
  const api = window.dashboardUsageLog;
  if (!api) return { status: 'idle' };
  try {
    const collected: UsageSourceRow[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let truncated = false;
    do {
      if (!isActive()) return { status: 'idle' };
      pages += 1;
      const reply = await api.list({ result: '', query: '', cursor });
      if (!isActive()) return { status: 'idle' };
      if (!reply.ok) {
        if (reply.code === 'UNAVAILABLE' && reply.message === WORKBENCH_EMPTY.usageUnmounted) return { status: 'idle' };
        return asyncFailure<UsageLoad>(reply.code, READ_SENTENCES);
      }
      if (cursor !== null && seen.has(cursor)) return { status: 'error', message: USAGE_FAILED };
      if (cursor !== null) seen.add(cursor);
      collected.push(...reply.rows);
      if (pages >= 20 && reply.nextCursor) {
        truncated = true;
        cursor = null;
      } else {
        cursor = reply.nextCursor;
      }
    } while (cursor);
    return { status: 'ready', value: { rows: collected, truncated } };
  } catch {
    return { status: 'error', message: USAGE_FAILED };
  }
}

/** A mode change invalidates both in-flight reads and previously displayed data. */
function useLegacyResource<T>(
  mode: WorkbenchKind | null,
  available: boolean,
  dependencies: readonly number[],
  read: (isActive: () => boolean) => Promise<AsyncResource<T>>,
): {
  resource: AsyncResource<T>;
  reload: () => void;
  replace: (update: (current: AsyncResource<T>) => AsyncResource<T>) => void;
} {
  const enabled = mode === 'legacy';
  const [modeState, setModeState] = useState({ mode, generation: 0 });
  if (modeState.mode !== mode) setModeState({ mode, generation: modeState.generation + 1 });
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{ generation: number; resource: AsyncResource<T> } | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const dependencyKey = dependencies.join(',');
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const generation = modeState.generation;
    setSnapshot({ generation, resource: available ? LOADING_RESOURCE : IDLE_RESOURCE });
    void readRef.current(() => active).then((resource) => {
      if (active) setSnapshot({ generation, resource });
    }).catch(() => {
      if (active) setSnapshot({ generation, resource: { status: 'error', message: USAGE_FAILED } });
    });
    return () => { active = false; };
  }, [enabled, modeState.generation, available, dependencyKey, retry]);

  const resource: AsyncResource<T> = !enabled ? IDLE_RESOURCE
    : snapshot?.generation === modeState.generation ? snapshot.resource
      : available ? LOADING_RESOURCE : IDLE_RESOURCE;
  return {
    resource,
    reload: () => setRetry((value) => value + 1),
    replace: (update) => {
      if (!enabled) return;
      const generation = modeState.generation;
      setSnapshot((current) => current?.generation === generation
        ? { generation, resource: update(current.resource) }
        : current);
    },
  };
}

type OutcomeValue = { items: readonly InaccuracyOutcome[]; truncated: boolean };

export function IntakeOverview({
  mode,
  onOpen,
  onTodoCount,
  onSupplyScript,
}: {
  mode: WorkbenchKind | null;
  onOpen: (target: 'content' | 'wording' | 'permissions') => void;
  onTodoCount?: (count: number) => void;
  onSupplyScript?: (question: string) => void;
}) {
  const todoSection = useRef<HTMLElement>(null);
  const taskTruncated = useRef(false);
  const tasksEnabled = mode === 'legacy';
  const tasksMounted = window.dashboardIteration !== undefined;
  const { resource: taskResource, reload: retryTasks, replace: setTaskRead } = useLegacyResource<readonly DashboardIterationTask[]>(
    mode,
    tasksMounted,
    [],
    async (isActive) => {
      const api = window.dashboardIteration;
      if (!api) return { status: 'forbidden', message: LOGGED_OUT };
      try {
        const result = await api.list();
        if (!isActive()) return { status: 'idle' };
        if (!result.ok) return asyncFailure<readonly DashboardIterationTask[]>(result.code, READ_SENTENCES);
        taskTruncated.current = result.truncated === true;
        return { status: 'ready', value: result.items };
      } catch {
        return { status: 'error', message: USAGE_FAILED };
      }
    },
  );
  const taskRead: AsyncResource<readonly DashboardIterationTask[]> = tasksEnabled && !tasksMounted
    ? FORBIDDEN_TASKS : taskResource;
  const usageMounted = window.dashboardUsageLog !== undefined;
  const { resource: usage, reload: retryUsage } = useLegacyResource<UsageLoad>(
    mode,
    usageMounted,
    [],
    readUsageAll,
  );
  const outcomesMounted = window.dashboardIteration?.outcomes !== undefined;
  const { resource: outcomeRead, reload: retryOutcomes } = useLegacyResource<OutcomeValue>(mode, outcomesMounted, [], async () => {
    const api = window.dashboardIteration;
    if (!api?.outcomes) return { status: 'idle' };
    try {
      const result = await api.outcomes();
      if (!result.ok) return asyncFailure(result.code, { forbidden: LOGGED_OUT, error: USAGE_FAILED });
      return { status: 'ready', value: { items: result.items, truncated: result.truncated === true } };
    } catch {
      return { status: 'error', message: USAGE_FAILED };
    }
  });
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CloseHintCatalog | null>(null);
  const [deskRole, setDeskRole] = useState<'operator' | 'seat' | null>(null);
  const [causeById, setCauseById] = useState<Record<string, DashboardIterationCause>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const mutation = useRef(false);
  const [span, setSpan] = useState<DayWindow>(() => recentWindow(7));
  const { resource: shopRates, reload: retryShopRates } = useLegacyResource(mode, window.dashboardOps?.questionRates !== undefined, [span.start, span.end], async () => {
    const read = window.dashboardOps?.questionRates;
    if (!read) return { status: 'idle' as const };
    try {
      const result = await read(new Date(span.start).toISOString(), new Date(span.end).toISOString());
      if (!result.ok) {
        if (result.code === 'FORBIDDEN' || result.code === 'UNAUTHORIZED') {
          return { status: 'forbidden' as const, message: result.message };
        }
        return { status: 'error' as const, message: USAGE_FAILED };
      }
      return {
        status: 'ready' as const,
        value: { ...result, windowStart: span.start, windowEnd: span.end },
      };
    } catch {
      return { status: 'error' as const, message: USAGE_FAILED };
    }
  });

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
      if (!result.ok) return;
      setDeskRole(result.view.role === 'seat' ? 'seat' : 'operator');
    }).catch(() => {
      if (live) setDeskRole(null);
    });
    return () => { live = false; };
  }, []);

  useLayoutEffect(() => {
    if (!tasksEnabled) {
      onTodoCount?.(0);
      return;
    }
    if (taskRead.status !== 'ready') return;
    const count = taskRead.value.filter((task) => task.status === 'open' || task.status === 'in_progress').length;
    onTodoCount?.(count);
  }, [tasksEnabled, taskRead, onTodoCount]);

  function closeTask(task: DashboardIterationTask, status: 'resolved' | 'wont_fix') {
    const api = window.dashboardIteration;
    if (!tasksEnabled || !api || mutation.current) return;
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
    mutation.current = true;
    setBusyId(task.taskId);
    const finish = () => { mutation.current = false; setBusyId(null); };
    void api.close({
      taskId: task.taskId,
      expectedVersion: task.version,
      status: decision.status,
      resolutionNote,
    }).then((result) => {
      finish();
      if (!result.ok) {
        setMessage(seatMessage(result.message));
        return;
      }
      setTaskRead((current) => {
        if (current.status !== 'ready') return current;
        return {
          status: 'ready',
          value: current.value.map((row) => row.taskId === result.task.taskId ? result.task : row),
        };
      });
      setMessage('');
    }).catch(() => {
      finish();
      setMessage(USAGE_FAILED);
    });
  }

  function startTask(task: DashboardIterationTask) {
    const api = window.dashboardIteration;
    if (!tasksEnabled || !api || mutation.current) return;
    mutation.current = true;
    setBusyId(task.taskId);
    const finish = () => { mutation.current = false; setBusyId(null); };
    void api.start({ taskId: task.taskId, expectedVersion: task.version }).then((result) => {
      finish();
      if (!result.ok) { setMessage(seatMessage(result.message)); return; }
      setTaskRead((current) => {
        if (current.status !== 'ready') return current;
        return {
          status: 'ready',
          value: current.value.map((row) => row.taskId === result.task.taskId ? result.task : row),
        };
      });
    }).catch(() => { finish(); setMessage(USAGE_FAILED); });
  }

  const loadedTasks = taskRead.status === 'ready' ? taskRead.value : null;
  const openTasks = (loadedTasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  const usageRows = usage.status === 'ready' ? rowsInWindow(usage.value.rows, span) : null;
  const usageTruncated = usage.status === 'ready' && usage.value.truncated;
  const usageCounts = usageRows ? countOverviewUsage(usageRows) : null;
  const missRows: MissTableRow[] | null = usageRows
    ? rankMissRows(usageRows).map((row, index) => ({
      key: row.question,
      rank: index + 1,
      question: row.question,
      count: row.count,
      latest: formatShortTime(row.latest),
    }))
    : null;
  const inaccuracyRows = loadedTasks === null ? [] : inaccuracyTableRows(loadedTasks);
  const inaccuracyTotal = loadedTasks === null ? null : sumInaccuracySamples(inaccuracyRows);
  const todoRows: TodoTableRow[] = openTasks.map((task) => ({ key: task.taskId, task }));
  const usageStatus = usageStatusText(usage);

  function supplyScript(question: string) {
    return <Button
      type="text"
      disabled={deskRole !== 'operator'}
      title={deskRole === 'seat' ? '坐席不能添加话术' : '仅运营可补充。'}
      onClick={() => { if (onSupplyScript) onSupplyScript(question); else onOpen('content'); }}
    >补充话术</Button>;
  }

  const readyShop = shopRates.status === 'ready' && shopRates.value
    && shopRates.value.windowStart === span.start
    && shopRates.value.windowEnd === span.end
    ? shopRates.value : null;
  const readyShopText = readyShop ? shopRateText(readyShop) : null;
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
          const startAt = start.startOf('day');
          let endAt = end.endOf('day');
          const limit = startAt.add(365, 'day').endOf('day');
          if (endAt.isAfter(limit)) endAt = limit;
          const shopRateWindowMs = 366 * 24 * 60 * 60 * 1000;
          if (endAt.valueOf() - startAt.valueOf() >= shopRateWindowMs) {
            endAt = dayjs(startAt.valueOf() + shopRateWindowMs - 1);
          }
          setSpan({ start: startAt.valueOf(), end: endAt.valueOf() });
        }}
      />
    </div>
    {mode === 'legacy' ? <div className="tiles" data-testid="shop-rates">
      {readyShop && readyShopText ? <>
        <RateTile label="命中率" value={readyShopText.hit} />
        <RateTile label="无命中率" value={readyShopText.noHit} />
        <RateTile label="不准反馈率" value={readyShopText.inaccuracy} detail={/^\d{3,}\./.test(readyShopText.inaccuracy) ? '报告数除以查询数，可以超过 100%。' : undefined} />
      </> : shopRates.status === 'loading' ? <div className="shop-rates-loading"><WorkbenchLoading rows={1} label="正在读取查询比率" /></div> : null}
    </div> : null}
    {mode === 'legacy' && readyShop ? <p className="t-sub">{QUESTION_SCOPE}{readyShop.otherCount > 0 ? '另有未归入命中或无命中的查询。' : ''}</p> : null}
    {mode === 'legacy' && shopRates.status === 'forbidden' ? <p className="t-sub" data-testid="shop-rates-status">{shopRates.message}</p> : null}
    {mode === 'legacy' && shopRates.status === 'error' ? <WorkbenchFailed message={shopRates.message} onRetry={retryShopRates} /> : null}
    <div className="tiles">
      <CountTile label="查询次数" value={usageCounts?.queries ?? null} />
      <CountTile label="没查到" value={usageCounts?.misses ?? null} />
      <CountTile label="被复制" value={usageCounts?.copied ?? null} detail={COPY_ONLY} />
      <CountTile label="不准次数" value={inaccuracyTotal} detail={inaccuracyTotal === null ? undefined : INACCURACY_SCOPE} />
    </div>
    {mode === 'legacy' && usage.status === 'ready' ? <p className="t-sub">{USAGE_SCOPE}</p> : null}
    {mode === 'legacy' && usageTruncated ? <p data-testid="usage-truncated">还有更多，这里只显示前 {usageRows?.length ?? 0} 条。</p> : null}
    {mode === 'legacy' ? usageNote(usage, retryUsage) : <p className="t-sub" data-testid="overview-usage-status">{STATISTICS_UNAVAILABLE}</p>}
    <section ref={todoSection} className="card" aria-label="待办" tabIndex={-1}>
      <div className="card-head"><h3>待办</h3></div>
      {!tasksEnabled ? <OverviewEmpty description={TASKS_UNAVAILABLE} />
        : taskRead.status === 'idle' || taskRead.status === 'loading' ? <WorkbenchLoading rows={3} label="正在读取待办" />
        : taskRead.status === 'forbidden' ? <OverviewEmpty description={taskRead.message} />
        : taskRead.status === 'error' ? <WorkbenchFailed message={taskRead.message} onRetry={retryTasks} />
        : openTasks.length === 0 ? <OverviewEmpty description={TODO_EMPTY} />
        : <A11yTable<TodoTableRow>
          aria-label="话术迭代"
          pagination={false}
          rowKey="key"
          dataSource={todoRows}
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
        />}
      {tasksEnabled && message ? <p role="status">{message}</p> : null}
      {taskTruncated.current && taskRead.status === 'ready'
        ? <p data-testid="todo-truncated">还有更多，这里只显示前 {taskRead.value.length} 条。</p>
        : null}
    </section>
    <section className="card" aria-label="不准的话术">
      <div className="card-head"><h3>不准的话术</h3></div>
      {!tasksEnabled ? <OverviewEmpty description={TASKS_UNAVAILABLE} />
        : taskRead.status === 'idle' || taskRead.status === 'loading' ? <WorkbenchLoading rows={2} label="正在读取不准的话术" />
        : taskRead.status === 'forbidden' ? <OverviewEmpty description={taskRead.message} />
        : taskRead.status === 'error' ? <WorkbenchFailed message={taskRead.message} onRetry={retryTasks} />
        : inaccuracyRows.length === 0 ? <OverviewEmpty description={INACCURACY_EMPTY} />
        : <>
          <A11yTable<InaccuracyTableRow>
            aria-label="不准的话术"
            pagination={false}
            rowKey="key"
            dataSource={inaccuracyRows}
            columns={[
              {
                title: '排名',
                dataIndex: 'rank',
                render: (rank: number) => <span className={rank <= 3 ? 'rk top' : 'rk'}>{rank}</span>,
              },
              { title: '话术', dataIndex: 'scriptId' },
              {
                title: '记下的样本',
                dataIndex: 'sampleCount',
                render: (count: number) => <div className="cnt warn"><b>{count}</b></div>,
              },
              { title: '最近一次', dataIndex: 'latest', render: (latest: string) => <span className="mute">{latest}</span> },
              {
                title: '',
                key: 'act',
                render: (_value, row) => row.openTaskCount > 0
                  ? <Button type="text" onClick={() => todoSection.current?.focus()}>去处理</Button>
                  : <span className="mute">已处理</span>,
              },
            ]}
          />
          <p className="mute">{INACCURACY_TODO_COPY.footnoteLive}</p>
        </>}
    </section>
    <section className="card" aria-label="没查到的问题">
      <div className="card-head"><h3>没查到的问题</h3></div>
      {mode !== 'legacy' ? <OverviewEmpty description={STATISTICS_UNAVAILABLE} />
        : usage.status === 'loading' ? <WorkbenchLoading rows={2} label="正在读取没查到的问题" />
        : usageStatus !== null ? <OverviewEmpty description={usageStatus} />
        : missRows !== null && missRows.length === 0 ? <OverviewEmpty description={usageRows?.length === 0 ? MISS_NO_QUERIES : MISS_ALL_ANSWERED} />
        : <A11yTable<MissTableRow>
          aria-label="没查到的问题"
          pagination={false}
          rowKey="key"
          dataSource={missRows ?? []}
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
        />}
    </section>
    <section className="card" aria-label={INACCURACY_OUTCOME_COPY.heading} data-testid="overview-outcomes">
      <div className="card-head"><h3>{INACCURACY_OUTCOME_COPY.heading}</h3></div>
      {!tasksEnabled ? <OverviewEmpty description={OUTCOMES_UNAVAILABLE} />
        : outcomeRead.status === 'error'
        ? <p>{outcomeRead.message} <Button type="link" onClick={retryOutcomes}>{INACCURACY_OUTCOME_COPY.retry}</Button></p>
        : outcomeRead.status === 'forbidden'
          ? <OverviewEmpty description={outcomeRead.message} />
          : outcomeRead.status === 'loading'
            ? <WorkbenchLoading rows={2} label="正在读取处理结果" />
            : outcomeRead.status === 'idle'
              ? <OverviewEmpty description={INACCURACY_OUTCOME_COPY.later} />
              : outcomeRead.value.items.length === 0
                ? <OverviewEmpty description={INACCURACY_OUTCOME_COPY.empty} />
                : <>
                  <ul>
                    {outcomeRead.value.items.map((row) => <li key={row.scriptId}>{row.scriptId} {outcomeSentence(row)}</li>)}
                  </ul>
                  {outcomeRead.value.truncated
                    ? <p data-testid="outcome-truncated">还有更多，这里只显示前 {outcomeRead.value.items.length} 条。</p>
                    : null}
                </>}
    </section>
  </section>;
}
