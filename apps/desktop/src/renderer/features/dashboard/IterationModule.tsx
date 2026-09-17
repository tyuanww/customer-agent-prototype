import { useMemo, useState } from 'react';
import {
  DASHBOARD_MANIFEST,
  listOpenP0IterationTasks,
  type IterationCause,
  type IterationStatus,
  type IterationTask,
} from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.iteration;

/** UI 三态：已关闭 = resolved ∪ wont_fix。 */
type StatusFacet = 'open' | 'in_progress' | 'closed';
type QueueStatusFilter = 'all' | StatusFacet;

const STATUS_FACETS: readonly { value: StatusFacet; label: string }[] = [
  { value: 'open', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'closed', label: '已关闭' },
];

const CAUSE_LABELS: Readonly<Record<IterationCause, string>> = {
  content_gap: '内容缺口',
  ranking: '排序问题',
  stale: '过期仍召回',
  mixed: '待判',
};

const KICKER_CAUSE = '内容缺口、排序、过期召回与待判分开处理';

function statusFacetOf(status: IterationStatus): StatusFacet {
  return status === 'open' || status === 'in_progress' ? status : 'closed';
}

function statusLabelOf(status: IterationStatus): string {
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'resolved') return '已处理';
  return '暂不处理';
}

function toneFor(status: IterationStatus): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'resolved') return 'ok';
  if (status === 'in_progress') return 'warn';
  if (status === 'open') return 'danger';
  return 'neutral';
}

/** 演练改动过的任务 id 集合，用于「重置演练」是否可用的判断。 */
function isEdited(task: IterationTask, source: IterationTask): boolean {
  return (
    task.status !== source.status ||
    task.version !== source.version ||
    task.resolution !== source.resolution ||
    task.resolutionNote !== source.resolutionNote
  );
}

function initialServerVersions(): Record<string, number> {
  return Object.fromEntries(data.tasks.map((task) => [task.taskId, task.version]));
}

export function IterationModule() {
  // 会话内演练：克隆 manifest 到 React state，刷新即丢。不落盘、不联网、不发 IPC。
  const [tasks, setTasks] = useState<readonly IterationTask[]>(data.tasks);
  // 演练里的「服务端」版本号。start / close 用 expected_version 比对，不一致就当成 409。
  const [serverVersions, setServerVersions] = useState<Record<string, number>>(initialServerVersions);
  const [status, setStatus] = useState<QueueStatusFilter>('all');
  const [cause, setCause] = useState<IterationCause | 'all'>('all');
  const [selectedId, setSelectedId] = useState(data.tasks[0]?.taskId ?? '');
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (status === 'all' || statusFacetOf(task.status) === status) &&
          (cause === 'all' || task.cause === cause),
      ),
    [cause, status, tasks],
  );
  // 详情独立于筛选：横幅点选后即使筛掉了该行，详情仍跟随选中项。
  const selected = tasks.find((task) => task.taskId === selectedId) ?? visible[0];
  const p0Open = listOpenP0IterationTasks(tasks);
  const edited =
    tasks.some((task) => {
      const source = data.tasks.find((item) => item.taskId === task.taskId);
      return source ? isEdited(task, source) : false;
    }) || data.tasks.some((task) => serverVersions[task.taskId] !== task.version);

  function selectTask(taskId: string) {
    const task = tasks.find((item) => item.taskId === taskId);
    if (!task) return;
    // 横幅只列 P0 / open，可能落在当前筛选之外；放宽筛选让被选中的那行留在队列里可见。
    if ((status !== 'all' && statusFacetOf(task.status) !== status) || (cause !== 'all' && task.cause !== cause)) {
      setStatus('all');
      setCause('all');
    }
    setSelectedId(task.taskId);
    setNote('');
    setConflict(null);
  }

  /** CAS：客户端快照版本必须等于演练里的服务端版本，否则不落地任何状态。 */
  function passesExpectedVersion(task: IterationTask): boolean {
    if (task.version === serverVersions[task.taskId]) return true;
    setConflict('待办已更新，请刷新后再处理');
    return false;
  }

  function mutate(task: IterationTask, next: Partial<IterationTask>) {
    setTasks((current) =>
      current.map((item) => (item.taskId === task.taskId ? { ...item, ...next } : item)),
    );
    setServerVersions((current) => ({
      ...current,
      [task.taskId]: (current[task.taskId] ?? task.version) + 1,
    }));
    setConflict(null);
  }

  function startTask(task: IterationTask) {
    if (task.status !== 'open' || !passesExpectedVersion(task)) return;
    mutate(task, { status: 'in_progress', version: task.version + 1 });
  }

  function closeTask(task: IterationTask, next: 'resolved' | 'wont_fix') {
    if (task.status !== 'in_progress' || !noteValid || !passesExpectedVersion(task)) return;
    mutate(task, {
      status: next,
      resolution: next,
      resolutionNote: note.trim(),
      version: task.version + 1,
    });
    setNote('');
  }

  /** 服务端抢先 +1，客户端快照不动。真实 CAS 是 expected_version 落后，不是把本地 version 改小。 */
  function simulateConcurrentUpdate(task: IterationTask) {
    setServerVersions((current) => ({
      ...current,
      [task.taskId]: (current[task.taskId] ?? task.version) + 1,
    }));
    setConflict('本条会话内版本已过期，可用于演示冲突');
  }

  function resetFilters() {
    setStatus('all');
    setCause('all');
    setSelectedId(data.tasks[0]?.taskId ?? '');
  }

  function resetDrill() {
    setTasks(data.tasks);
    setServerVersions(initialServerVersions());
    setNote('');
    setConflict(null);
  }

  const noteValid = note.trim().length >= 1 && note.trim().length <= 2000;

  return (
    <div className="dash-module" data-testid="module-iteration">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <div className="iteration-role-note">
          <StatusBadge label="正式仅 coach / owner · agent 403 · 本页 MOCK AUTH" tone="mock" />
          <StatusBadge label={DASHBOARD_MANIFEST.banners.syntheticMark} tone="mock" />
        </div>
      </header>
      <p className="dash-scope">{data.domainNote}</p>

      <section
        className={`dash-card iteration-reminder${p0Open.length === 0 ? ' is-empty' : ''}`}
        aria-labelledby="iteration-reminder-title"
        data-testid="iteration-reminder"
      >
        <div className="dash-card-row">
          <h2 id="iteration-reminder-title">
            {p0Open.length > 0 ? `有 ${p0Open.length} 条待处理 P0 需要跟进` : '当前没有待处理 P0'}
          </h2>
          <StatusBadge label={DASHBOARD_MANIFEST.banners.syntheticMark} tone="mock" />
        </div>
        {p0Open.length > 0 ? (
          <ul className="iteration-reminder-list">
            {p0Open.map((task) => (
              <li key={task.taskId}>
                <button
                  type="button"
                  className={selected?.taskId === task.taskId ? 'is-selected' : ''}
                  aria-pressed={selected?.taskId === task.taskId}
                  data-testid={`iteration-reminder-${task.taskId}`}
                  onClick={() => selectTask(task.taskId)}
                >
                  {task.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-footnote" data-testid="iteration-reminder-empty">
            处理中或已关闭的不出现在这里。重置演练可恢复合成清单。
          </p>
        )}
      </section>

      <div className="dash-filter-toolbar compact" aria-label="优化待办筛选">
        <label>
          <span>根因</span>
          <select
            value={cause}
            data-testid="iteration-cause-filter"
            onChange={(event) => {
              setCause(event.target.value as IterationCause | 'all');
            }}
          >
            <option value="all">全部根因</option>
            {(Object.keys(CAUSE_LABELS) as IterationCause[]).map((value) => (
              <option key={value} value={value}>{CAUSE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select
            value={status}
            data-testid="iteration-status-filter"
            onChange={(event) => {
              setStatus(event.target.value as QueueStatusFilter);
            }}
          >
            <option value="all">全部状态</option>
            {STATUS_FACETS.map((facet) => (
              <option key={facet.value} value={facet.value}>{facet.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="dash-reset" data-testid="iteration-reset-filters" onClick={resetFilters}>
          重置筛选
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="iteration-reset-drill"
          disabled={!edited}
          onClick={resetDrill}
        >
          重置演练
        </button>
      </div>
      <div className="dash-selection-status" aria-live="polite" data-testid="iteration-filter-status">
        <span>当前队列</span><strong>{visible.length} 项合成待办</strong><em>{KICKER_CAUSE}</em>
      </div>

      <div className="iteration-layout">
        <div className="iteration-list" data-testid="iteration-list">
          {visible.map((task) => (
            <button
              key={task.taskId}
              type="button"
              className={selected?.taskId === task.taskId ? 'is-selected' : ''}
              aria-pressed={selected?.taskId === task.taskId}
              data-testid={`iteration-${task.taskId}`}
              onClick={() => selectTask(task.taskId)}
            >
              <span className="iteration-item-top">
                <StatusBadge label={task.priority} tone={task.priority === 'P0' ? 'danger' : task.priority === 'P1' ? 'warn' : 'neutral'} />
                <StatusBadge label={CAUSE_LABELS[task.cause]} />
                <StatusBadge label={statusLabelOf(task.status)} tone={toneFor(task.status)} />
              </span>
              <strong>{task.title}</strong>
              <small>{task.evidenceCount} 条合成证据 · {task.owner}</small>
            </button>
          ))}
          {!visible.length ? (
            <div className="dash-empty-state"><strong>当前筛选没有合成待办</strong><span>重置筛选查看完整只读队列。</span></div>
          ) : null}
        </div>

        <aside className="dash-card iteration-detail" aria-live="polite" data-testid="iteration-detail">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label">{selected.taskId}</span>
                <StatusBadge label={statusLabelOf(selected.status)} tone={toneFor(selected.status)} />
              </div>
              <h2>{selected.title}</h2>
              <p>{selected.detail}</p>
              <dl className="dash-dl dash-dl-grid">
                <div><dt>根因</dt><dd>{CAUSE_LABELS[selected.cause]}</dd></div>
                <div><dt>版本</dt><dd data-testid="iteration-detail-version">v{selected.version}</dd></div>
                <div><dt>信号</dt><dd data-testid="iteration-detail-signal">{selected.signalId}</dd></div>
                <div><dt>标记</dt><dd>{selected.priority}</dd></div>
                <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
                <div><dt>证据量</dt><dd>{selected.evidenceCount} 条合成事实</dd></div>
              </dl>
              <p className="dash-next-step"><span>建议下一步</span>{selected.nextStep}</p>
              <p className="dash-footnote" data-testid="iteration-detail-meta">
                聚类键 {selected.clusterKey} · 建议话术 {selected.suggestedScriptIds.join(' / ') || '暂无'} ·
                样本 {selected.sampleQueryIds.length} 条脱敏合成查询
              </p>

              <div className="iteration-drill" data-testid="iteration-drill">
                <h3>会话内演练</h3>
                {selected.status === 'open' ? (
                  <button
                    type="button"
                    className="dash-action-primary"
                    data-testid="iteration-start"
                    onClick={() => startTask(selected)}
                  >
                    开始处理
                  </button>
                ) : null}

                {selected.status === 'in_progress' ? (
                  <label className="iteration-drill-note">
                    <span>处理结论（1–2000 字，必填）</span>
                    <textarea
                      value={note}
                      maxLength={2000}
                      data-testid="iteration-note"
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                ) : null}

                {selected.status === 'in_progress' || selected.status === 'resolved' || selected.status === 'wont_fix' ? (
                  <div className="iteration-drill-actions">
                    <button
                      type="button"
                      className="dash-action-primary"
                      data-testid="iteration-close-resolved"
                      disabled={selected.status !== 'in_progress' || !noteValid}
                      onClick={() => closeTask(selected, 'resolved')}
                    >
                      已处理
                    </button>
                    <button
                      type="button"
                      className="dash-reset"
                      data-testid="iteration-close-wont-fix"
                      disabled={selected.status !== 'in_progress' || !noteValid}
                      onClick={() => closeTask(selected, 'wont_fix')}
                    >
                      暂不处理
                    </button>
                  </div>
                ) : null}

                {selected.status === 'open' || selected.status === 'in_progress' ? (
                  <button
                    type="button"
                    className="dash-reset"
                    data-testid="iteration-stale-attempt"
                    onClick={() => simulateConcurrentUpdate(selected)}
                  >
                    演示版本冲突
                  </button>
                ) : null}

                {selected.status === 'resolved' || selected.status === 'wont_fix' ? (
                  <p className="iteration-drill-terminal" data-testid="iteration-terminal">
                    终态不可再变更{selected.resolutionNote ? ` · 结论：${selected.resolutionNote}` : ''}
                  </p>
                ) : null}

                {conflict ? (
                  <p className="iteration-drill-conflict" role="alert" data-testid="iteration-conflict">
                    {conflict}
                  </p>
                ) : null}
              </div>

              <p className="dash-footnote">{data.footnote}</p>
              <p className="dash-footnote" data-testid="iteration-detail-footnote">
                不自动改写 Answer。关闭待办不等于已发布。演练不保存、不联网。
              </p>
            </>
          ) : <p className="dash-empty">选择一项待办查看处理口径</p>}
        </aside>
      </div>

      {edited ? (
        <p className="dash-footnote" data-testid="iteration-drill-state">
          演练改动仅存在本页内存；「重置演练」恢复合成清单。
        </p>
      ) : null}
    </div>
  );
}
