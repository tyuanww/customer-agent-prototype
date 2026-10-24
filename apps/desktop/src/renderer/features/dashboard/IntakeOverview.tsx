import { createElement, useEffect, useRef, useState, type ComponentType } from 'react';
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
const USAGE_LATER = '坐席查询后会出现';
const USAGE_FAILED = '没读到。';
const TODO_EMPTY = '现在没有待办。';
const INACCURACY_EMPTY = '当前没有达到开单阈值的不准稿。';
const USAGE_SCOPE = '查询次数、没查到和被复制只含当前登录者最近读到的查询，不是全店。不准次数不随上面的日期变化。';
const INACCURACY_SCOPE = '只含已开待办记下的样本，不是这段时间的全部。';
const MISS_ALL_ANSWERED = '这段时间所有查询都有结果。';
const COPY_ONLY = '只表示复制了';

const nowrapCell = () => ({ style: { whiteSpace: 'nowrap' as const } });

type DayWindow = { start: number; end: number };

type UsageRead =
  | { readonly status: 'absent' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'unmounted' }
  | { readonly status: 'ready'; readonly rows: readonly UsageSourceRow[] };

type TaskRead =
  | { readonly status: 'loading' }
  | { readonly status: 'logged-out' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly tasks: readonly DashboardIterationTask[] };

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

/** Query count is every loaded row. aggregateUsage omits misses and also returns a rate. */
function countOverviewUsage(rows: readonly UsageSourceRow[]): OverviewUsageCounts {
  let misses = 0;
  let copied = 0;
  for (const row of rows) {
    if (row.result === 'miss') misses += 1;
    else if (row.result === 'copied') copied += 1;
  }
  return { queries: rows.length, misses, copied };
}

/** The tile adds the sample counts the inaccuracy table already computed. It does not walk the tasks again. */
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

function usageStatusText(read: UsageRead): string | null {
  switch (read.status) {
    case 'ready':
    case 'loading':
      return null;
    case 'failed':
      return USAGE_FAILED;
    case 'signed-out':
      return LOGGED_OUT;
    case 'unmounted':
    case 'absent':
      return USAGE_LATER;
  }
}

function usageNote(read: UsageRead, onRetry: () => void) {
  const text = usageStatusText(read);
  if (text === null) return null;
  if (read.status === 'failed') {
    return <div data-testid="overview-usage-status">
      <WorkbenchFailed message={text} onRetry={onRetry} />
    </div>;
  }
  return <p className="t-sub" data-testid="overview-usage-status">{text}</p>;
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
  const todoSection = useRef<HTMLElement>(null);
  const [taskRead, setTaskRead] = useState<TaskRead>(() => (
    window.dashboardIteration ? { status: 'loading' } : { status: 'logged-out' }
  ));
  const [outcomes, setOutcomes] = useState<readonly InaccuracyOutcome[] | null>(null);
  const [outcomeFailed, setOutcomeFailed] = useState(false);
  const [outcomeAttempt, setOutcomeAttempt] = useState(0);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CloseHintCatalog | null>(null);
  const [deskRole, setDeskRole] = useState<'operator' | 'seat' | null>(null);
  const [causeById, setCauseById] = useState<Record<string, DashboardIterationCause>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [span, setSpan] = useState<DayWindow>(() => recentWindow(7));
  const [usageAttempt, setUsageAttempt] = useState(0);
  const [taskAttempt, setTaskAttempt] = useState(0);
  const [usage, setUsage] = useState<UsageRead>(() => (
    window.dashboardUsageLog ? { status: 'loading' } : { status: 'absent' }
  ));

  // A missing iteration API means the person is not signed in. A failed list is a read,
  // including a list that stopped before the last page.
  useEffect(() => {
    const api = window.dashboardIteration;
    if (!api) {
      setTaskRead({ status: 'logged-out' });
      return undefined;
    }
    setTaskRead({ status: 'loading' });
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setTaskRead({ status: result.code === 'UNAUTHORIZED' ? 'logged-out' : 'failed' });
        return;
      }
      setTaskRead({ status: 'ready', tasks: result.items });
    }).catch(() => {
      if (!live) return;
      setTaskRead({ status: 'failed' });
    });
    return () => { live = false; };
  }, [taskAttempt]);

  useEffect(() => {
    const api = window.dashboardIteration;
    if (!api || typeof api.outcomes !== 'function') {
      setOutcomes([]);
      setOutcomeFailed(false);
      return undefined;
    }
    let live = true;
    void api.outcomes().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setOutcomes(null);
        setOutcomeFailed(true);
        return;
      }
      setOutcomes(result.items);
      setOutcomeFailed(false);
    }).catch(() => {
      if (!live) return;
      setOutcomes(null);
      setOutcomeFailed(true);
    });
    return () => { live = false; };
  }, [outcomeAttempt]);

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

  useEffect(() => {
    const api = window.dashboardUsageLog;
    if (!api) {
      setUsage({ status: 'absent' });
      return undefined;
    }
    setUsage({ status: 'loading' });
    let live = true;
    void (async () => {
      const collected: UsageSourceRow[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const reply = await api.list({ result: '', query: '', cursor });
        if (!live) return;
        if (!reply.ok) {
          const unmounted = reply.code === 'UNAVAILABLE' && reply.message === WORKBENCH_EMPTY.usageUnmounted;
          setUsage({
            status: reply.code === 'UNAUTHORIZED' ? 'signed-out'
              : unmounted ? 'unmounted'
              : 'failed',
          });
          return;
        }
        if (cursor !== null && seen.has(cursor)) {
          setUsage({ status: 'failed' });
          return;
        }
        if (cursor !== null) seen.add(cursor);
        collected.push(...reply.rows);
        cursor = reply.nextCursor;
      } while (cursor);
      if (!live) return;
      const rows = collected.filter((row) => {
        const asked = Date.parse(row.askedAt);
        return Number.isFinite(asked) && asked >= span.start && asked <= span.end;
      });
      setUsage({ status: 'ready', rows });
    })().catch(() => {
      if (live) setUsage({ status: 'failed' });
    });
    return () => { live = false; };
  }, [span.start, span.end, usageAttempt]);

  useEffect(() => {
    const count = taskRead.status === 'ready'
      ? taskRead.tasks.filter((task) => task.status === 'open' || task.status === 'in_progress').length
      : 0;
    onTodoCount?.(count);
  }, [taskRead, onTodoCount]);

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
      setTaskRead((current) => {
        if (current.status !== 'ready') return current;
        return {
          status: 'ready',
          tasks: current.tasks.map((row) => row.taskId === result.task.taskId ? result.task : row),
        };
      });
      setMessage('');
    }).catch(() => {
      setBusyId(null);
      setMessage(USAGE_FAILED);
    });
  }

  function startTask(task: DashboardIterationTask) {
    const api = window.dashboardIteration;
    if (!api) return;
    setBusyId(task.taskId);
    void api.start({ taskId: task.taskId, expectedVersion: task.version }).then((result) => {
      setBusyId(null);
      if (!result.ok) { setMessage(seatMessage(result.message)); return; }
      setTaskRead((current) => {
        if (current.status !== 'ready') return current;
        return {
          status: 'ready',
          tasks: current.tasks.map((row) => row.taskId === result.task.taskId ? result.task : row),
        };
      });
    }).catch(() => { setBusyId(null); setMessage(USAGE_FAILED); });
  }

  const loadedTasks = taskRead.status === 'ready' ? taskRead.tasks : null;
  const openTasks = (loadedTasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  const usageCounts = usage.status === 'ready' ? countOverviewUsage(usage.rows) : null;
  const missRows: MissTableRow[] | null = usage.status === 'ready'
    ? rankMissRows(usage.rows).map((row, index) => ({
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
    {/* .tiles is three columns in workbench-v9.css. Four counts share one row. */}
    <div className="tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
      <CountTile label="查询次数" value={usageCounts?.queries ?? null} />
      <CountTile label="没查到" value={usageCounts?.misses ?? null} />
      <CountTile label="被复制" value={usageCounts?.copied ?? null} detail={COPY_ONLY} />
      <CountTile label="不准次数" value={inaccuracyTotal} detail={inaccuracyTotal === null ? undefined : INACCURACY_SCOPE} />
    </div>
    {usage.status === 'ready' ? <p className="t-sub">{USAGE_SCOPE}</p> : null}
    {usageNote(usage, () => setUsageAttempt((current) => current + 1))}
    <section ref={todoSection} className="card" aria-label="待办" tabIndex={-1}>
      <div className="card-head"><h3>待办</h3></div>
      {taskRead.status === 'loading' ? <WorkbenchLoading rows={3} label="正在读取待办" />
        : taskRead.status === 'logged-out' ? <OverviewEmpty description={LOGGED_OUT} />
        : taskRead.status === 'failed' ? <WorkbenchFailed message={USAGE_FAILED} onRetry={() => setTaskAttempt((current) => current + 1)} />
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
      {message ? <p role="status">{message}</p> : null}
    </section>
    <section className="card" aria-label="不准的话术">
      <div className="card-head"><h3>不准的话术</h3></div>
      {taskRead.status === 'loading' ? <WorkbenchLoading rows={2} label="正在读取不准的话术" />
        : taskRead.status === 'logged-out' ? <OverviewEmpty description={LOGGED_OUT} />
        : taskRead.status === 'failed' ? <WorkbenchFailed message={USAGE_FAILED} onRetry={() => setTaskAttempt((current) => current + 1)} />
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
      {usage.status === 'loading' ? <WorkbenchLoading rows={2} label="正在读取没查到的问题" />
        : usageStatus !== null ? <OverviewEmpty description={usageStatus} />
        : missRows !== null && missRows.length === 0 ? <OverviewEmpty description={MISS_ALL_ANSWERED} />
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
      {outcomeFailed
        ? <p>{INACCURACY_OUTCOME_COPY.failed} <Button type="link" onClick={() => setOutcomeAttempt((current) => current + 1)}>{INACCURACY_OUTCOME_COPY.retry}</Button></p>
        : outcomes === null
          ? <WorkbenchLoading rows={2} label="正在读取处理结果" />
          : outcomes.length === 0
            ? <OverviewEmpty description={INACCURACY_OUTCOME_COPY.empty} />
            : <ul>
              {outcomes.map((row) => <li key={row.scriptId}>{row.scriptId} {outcomeSentence(row)}</li>)}
            </ul>}
    </section>
  </section>;
}
