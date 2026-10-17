import { useEffect, useState } from 'react';
import {
  ITERATION_COPY,
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
import { aggregateUsage, rankMissRows, rankUsageRows, trendFromUsage, type UsageSourceRow } from '@shared/usage-log-csv';
import { usageTrendMarkup } from '@shared/usage-trend';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import './workbench-v9.css';

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

type UsagePhase = 'loading' | 'empty' | 'ready' | 'failed' | 'unmounted' | 'signed-out';

function usageTile(phase: UsagePhase, value: string | undefined): string {
  if (phase === 'ready') return value ?? '0';
  if (phase === 'empty') return '0';
  if (phase === 'loading') return '…';
  return '—';
}

function usageProse(phase: UsagePhase): string {
  if (phase === 'loading') return '…';
  if (phase === 'empty') return WORKBENCH_EMPTY.usageEmpty;
  if (phase === 'unmounted') return WORKBENCH_EMPTY.usageUnmounted;
  if (phase === 'signed-out') return WORKBENCH_EMPTY.signedOut;
  return WORKBENCH_EMPTY.usageFailed;
}

function usagePhaseFromReply(code: string): UsagePhase {
  if (code === 'UNAVAILABLE') return 'unmounted';
  if (code === 'UNAUTHORIZED') return 'signed-out';
  return 'failed';
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

/** faq-v2 overview lists open iteration tasks only. It does not invent rates. */
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
  const [scriptTitles, setScriptTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [reminders, setReminders] = useState<readonly KnowledgeValidityReminder[]>([]);
  const [deskReminders, setDeskReminders] = useState<'unavailable' | 'ready'>('unavailable');
  const [deskRole, setDeskRole] = useState<'operator' | 'seat' | null>(null);
  const [causeById, setCauseById] = useState<Record<string, DashboardIterationCause>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<'usage' | 'sop' | 'miss' | 'expire' | 'todo'>('usage');
  const [days, setDays] = useState<7 | 30>(7);
  const [usageView, setUsageView] = useState<'script' | 'person'>('script');
  const [usageQuery, setUsageQuery] = useState('');
  const [usageDesc, setUsageDesc] = useState(true);
  const [sourceRows, setSourceRows] = useState<UsageSourceRow[] | null>(null);
  const [usagePhase, setUsagePhase] = useState<UsagePhase>(
    () => (typeof window !== 'undefined' && window.dashboardUsageLog ? 'loading' : 'failed'),
  );

  useEffect(() => {
    const api = window.dashboardIteration;
    if (!api) {
      setTasks(null);
      setMessage(WORKBENCH_EMPTY.noRecord);
      return undefined;
    }
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setTasks(null);
        setMessage(result.message);
        return;
      }
      setTasks(result.items);
      setMessage('');
    }).catch(() => {
      if (!live) return;
      setTasks(null);
      setMessage(WORKBENCH_EMPTY.noRecord);
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
      if (result.ok) {
        setScriptTitles(new Map(result.entries.map((entry) => [entry.scriptId, entry.title])));
      }
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
        ? '内容缺口要等这条话术有更新的已发布版本后才能标已处理。'
        : '暂不处理需要填写原因。');
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
        setMessage(result.message);
        return;
      }
      setTasks((current) => (current ?? []).map((row) => row.taskId === result.task.taskId ? result.task : row));
      setMessage('');
    }).catch(() => {
      setBusyId(null);
      setMessage(WORKBENCH_EMPTY.noRecord);
    });
  }

  const openTasks = (tasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  const openTaskCount = openTasks.length;
  useEffect(() => { onTodoCount?.(tasks === null ? 0 : openTaskCount); }, [tasks, openTaskCount, onTodoCount]);
  const panels = [
    ['usage', '话术使用排行'],
    ['sop', 'SOP 使用'],
    ['miss', '无命中排行'],
    ['expire', '话术过期提醒'],
    ['todo', '迭代待办'],
  ] as const;
  useEffect(() => {
    const api = window.dashboardUsageLog;
    if (!api) {
      setSourceRows(null);
      setUsagePhase('failed');
      return undefined;
    }
    let live = true;
    setUsagePhase('loading');
    void (async () => {
      const collected: UsageSourceRow[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const reply = await api.list({ result: '', query: '', cursor });
        if (!live) return;
        if (!reply.ok || (cursor !== null && seen.has(cursor))) {
          setSourceRows(null);
          setUsagePhase(reply.ok ? 'failed' : usagePhaseFromReply(reply.code));
          return;
        }
        if (cursor !== null) seen.add(cursor);
        collected.push(...reply.rows);
        cursor = reply.nextCursor;
      } while (cursor);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const windowed = collected.filter((row) => {
        const asked = Date.parse(row.askedAt);
        return Number.isFinite(asked) && asked >= cutoff;
      });
      if (!live) return;
      setSourceRows(windowed);
      setUsagePhase(windowed.length === 0 ? 'empty' : 'ready');
    })().catch(() => {
      if (!live) return;
      setSourceRows(null);
      setUsagePhase('failed');
    });
    return () => { live = false; };
  }, [days]);
  const sourced = sourceRows === null ? null : aggregateUsage(sourceRows);
  const headline = sourced
    ? { use: sourced.use.toLocaleString('en-US'), miss: sourced.miss.toLocaleString('en-US'), rate: sourced.rate }
    : null;
  const liveRanks = sourceRows === null ? null : rankUsageRows(sourceRows, usageView)
    .filter((row) => usageQuery === '' || row.name.includes(usageQuery));
  const orderedRanks = liveRanks === null ? null : (usageDesc ? liveRanks : [...liveRanks].reverse());
  const liveMisses = sourceRows === null ? null : rankMissRows(sourceRows);
  const liveTrend = sourceRows === null ? null : trendFromUsage(sourceRows);
  return <section className="dash-module intake-management intake-overview wb9" data-testid="module-overview">
    <h1 className="desk-sr">概览</h1>
    <div className="ov-head"><span className="mute">数据范围</span>
      <div className="seg" role="group" aria-label="时间范围">
        <button type="button" aria-pressed={days === 7} onClick={() => setDays(7)}>近 7 天</button>
        <button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>近 30 天</button>
      </div>
    </div>
    {usagePhase === 'ready' ? null : <p className="notready" data-testid="overview-usage-status">{usageProse(usagePhase)}</p>}
    <div className="tiles">
      <div className="tile"><span className="t-lbl">话术使用次数</span><b>{usageTile(usagePhase, headline?.use)}</b></div>
      <div className="tile"><span className="t-lbl">无命中次数</span><b>{usageTile(usagePhase, headline?.miss)}</b></div>
      <div className="tile"><span className="t-lbl">命中率</span><b>{usageTile(usagePhase, headline?.rate)}</b></div>
      <div className="tile"><span className="t-lbl">待处理迭代</span><b>{openTasks.length}</b><span className="t-sub">需要人工判断</span></div>
    </div>
    <div className="charts">
      <div className="card" aria-label="使用与无命中趋势">
        <div className="card-head"><h3>使用与无命中趋势</h3><span className="legend"><i style={{ background: 'var(--p)' }} />使用<i style={{ background: '#e0b050' }} />无命中</span></div>
        <div className="chart-wrap">{liveTrend === null
          ? <p className="notready">—</p>
          : liveTrend.length === 0
            ? <div data-testid="usage-trend-empty">
              <svg viewBox="0 0 640 188" role="img" aria-label="暂无使用记录">
                <rect x="0.5" y="0.5" width="639" height="187" fill="none" stroke="currentColor" strokeOpacity="0.12" />
                <line x1="28" y1="142" x2="628" y2="142" stroke="currentColor" strokeOpacity="0.2" />
              </svg>
              <p className="notready">{WORKBENCH_EMPTY.usageEmpty}</p>
            </div>
            : <svg viewBox="0 0 640 188" role="img" aria-label="使用与无命中趋势图" data-testid="usage-trend" dangerouslySetInnerHTML={{ __html: usageTrendMarkup(liveTrend) }} />}
        </div>
      </div>
    </div>
    <div className="card flush">
      <div className="ptabs" role="tablist" aria-label="概览分栏">
        {panels.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={panel === id} onClick={() => setPanel(id)}>{label}<b aria-hidden="true">{id === 'usage' ? (orderedRanks ? orderedRanks.length : '') : id === 'miss' ? (liveMisses ? liveMisses.length : '') : id === 'todo' ? openTasks.length : id === 'expire' ? reminders.length : ''}</b></button>)}
      </div>
      <div className="pn" hidden={panel !== 'usage'}>
        <div className="filters2">
          <div className="seg" role="group" aria-label="视图">
            <button type="button" aria-pressed={usageView === 'script'} onClick={() => setUsageView('script')}>按话术</button>
            <button type="button" aria-pressed={usageView === 'person'} onClick={() => setUsageView('person')}>按人员</button>
          </div>
          <span className="grow" />
          <div className="search"><svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input aria-label="搜索人员" placeholder="搜索人员" value={usageQuery} onChange={(event) => setUsageQuery(event.target.value.trim())} /></div>
        </div>
        <table className="fixed">
          <colgroup><col style={{ width: 96 }} /><col /><col style={{ width: 140 }} /><col style={{ width: 300 }} /><col style={{ width: 112 }} /></colgroup>
          <thead><tr><th>排名</th><th>{usageView === 'script' ? '话术名称' : '人员'}</th>
            <th><button type="button" className={`sort${usageDesc ? '' : ' asc'}`} aria-label="按使用次数排序" onClick={() => setUsageDesc((value) => !value)}>使用次数<svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg></button></th>
            <th>{usageView === 'script' ? '近 7 天 · 使用人' : '最常用话术'}</th><th></th></tr></thead>
          <tbody>
            {orderedRanks ? (orderedRanks.length === 0 ? <tr><td colSpan={5} className="empty">{usagePhase === 'empty' && usageQuery === '' ? '—' : '没有符合条件的记录'}</td></tr> : orderedRanks.map((row, index) => <tr className="item" key={row.name}>
              <td><span className={index < 3 ? 'rk top' : 'rk'}>{index + 1}</span></td>
              <td>{row.name}</td>
              <td><div className="cnt"><b>{row.total}</b></div></td>
              <td><span className="who">{row.extra}</span></td>
              <td />
            </tr>)) : <tr><td colSpan={5} className="empty">—</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pn" hidden={panel !== 'sop'}>
        <p className="notready" style={{ padding: '20px 12px' }}>{WORKBENCH_EMPTY.noRecord}</p>
      </div>
      <section className="pn" hidden={panel !== 'miss'} aria-label="无命中">
        <h2 className="desk-sr">无命中</h2>
        <table className="fixed">
          <thead><tr><th>排名</th><th>用户问题</th><th>未命中次数</th><th>最近一次</th><th></th></tr></thead>
          <tbody>{liveMisses ? (liveMisses.length === 0 ? <tr><td colSpan={5} className="empty">没有符合条件的记录</td></tr> : liveMisses.map((row, index) => <tr className="item" key={row.question}>
            <td><span className={index < 3 ? 'rk top' : 'rk'}>{index + 1}</span></td>
            <td>{row.question}</td>
            <td><div className="cnt warn"><b>{row.count}</b></div></td>
            <td className="mute">{row.latest}</td>
            <td className="jump"><button type="button" className="link" disabled={deskRole !== 'operator'} title={deskRole === 'seat' ? '坐席不能添加话术' : '请先确认运营身份'} onClick={() => onSupplyScript ? onSupplyScript(row.question) : onOpen('content')}>补充话术</button></td>
          </tr>)) : <tr><td colSpan={5} className="empty">{WORKBENCH_EMPTY.noRecord}</td></tr>}</tbody>
        </table>

      </section>
      <section hidden={panel !== 'expire'} aria-label="知识有效期">
        <h2 className="desk-sr">知识有效期</h2>
        {deskReminders !== 'ready' ? <p>{WORKBENCH_EMPTY.noRecord}</p> : reminders.length === 0 ? <p>{ITERATION_COPY.empty}</p> : <table className="desk-table" aria-label="知识有效期提醒">
          <thead><tr><th>状态</th><th>话术名称</th></tr></thead>
          <tbody>{reminders.map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.question}</td></tr>)}</tbody>
        </table>}
      </section>
      <div hidden={panel !== 'todo'}>
    <table className="desk-table" aria-label="话术迭代">
      <thead><tr><th>状态</th><th>事项</th><th>原因</th><th>操作</th></tr></thead>
      <tbody>
        {tasks === null ? <tr><td colSpan={4}>{message}</td></tr> : openTasks.length === 0 ? <tr><td colSpan={4}>{ITERATION_COPY.empty}</td></tr> : openTasks.map((task) => {
          const scriptId = inaccuracyScriptIdFromTask(task);
          const title = (scriptId && scriptTitles.get(scriptId)) || task.clusterKey;
          const cause = causeById[task.taskId] ?? task.suspectedCause;
          return <tr key={task.taskId}>
            <td>{statusLabel(task.status)}</td>
            <td>{title}</td>
            <td>
              <select aria-label={`原因 ${title}`} value={cause} onChange={(event) => {
                const value = event.target.value;
                if (!isCause(value)) return;
                setCauseById((current) => ({ ...current, [task.taskId]: value }));
              }}>
                {CAUSE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </td>
            <td><div className="desk-row-actions">
              {task.status === 'open' ? <button type="button" disabled={busyId === task.taskId} onClick={() => {
                const api = window.dashboardIteration;
                if (!api) return;
                setBusyId(task.taskId);
                void api.start({ taskId: task.taskId, expectedVersion: task.version }).then((result) => {
                  setBusyId(null);
                  if (!result.ok) { setMessage(result.message); return; }
                  setTasks((current) => (current ?? []).map((row) => row.taskId === result.task.taskId ? result.task : row));
                }).catch(() => { setBusyId(null); setMessage(WORKBENCH_EMPTY.noRecord); });
              }}>开始处理</button> : null}
              <input placeholder="处理说明" aria-label={`处理说明 ${title}`} value={noteById[task.taskId] ?? ''} onChange={(event) => {
                const value = event.target.value;
                setNoteById((current) => ({ ...current, [task.taskId]: value }));
              }} />
              <button type="button" className="dash-action-primary" disabled={busyId === task.taskId} onClick={() => closeTask(task, 'resolved')}>已处理</button>
              <button type="button" disabled={busyId === task.taskId} onClick={() => closeTask(task, 'wont_fix')}>暂不处理</button>
              <button type="button" onClick={() => onOpen('content')}>去知识库</button>
            </div></td>
          </tr>;
        })}
      </tbody>
    </table>
      </div>
    </div>
    {message && tasks !== null ? <p role="status">{message}</p> : null}
  </section>;
}
