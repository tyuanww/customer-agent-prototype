import { useEffect, useMemo, useRef, useState } from 'react';
import { DASHBOARD_MANIFEST } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.announce;
type AnnounceFilter = 'all' | 'attention' | 'ack_missing' | 'lease_expired';
type SimulationOutcome = 'success' | 'error';
type SimulationStatus = 'idle' | 'loading' | 'success' | 'error';

type SimulationRun = {
  itemId: string;
  status: SimulationStatus;
};

function facetLabel(on: boolean, onText: string, offText: string): string {
  return on ? onText : offText;
}

export function AnnounceModule() {
  const [filter, setFilter] = useState<AnnounceFilter>('all');
  const [selectedId, setSelectedId] = useState(data.rows[0]?.itemId ?? '');
  const [outcome, setOutcome] = useState<SimulationOutcome>('success');
  const [simulation, setSimulation] = useState<SimulationRun>({ itemId: '', status: 'idle' });
  const simulationTimer = useRef<number | null>(null);
  const visible = useMemo(() => data.rows.filter((row) => {
    if (filter === 'ack_missing') return row.published && !row.clientAck;
    if (filter === 'lease_expired') return row.published && !row.offlineLease;
    if (filter === 'attention') return !row.published || !row.announced || !row.clientAck || !row.offlineLease;
    return true;
  }), [filter]);
  const selected = visible.find((row) => row.itemId === selectedId) ?? visible[0];
  const selectedIssues = selected
    ? [
        !selected.published ? '未发布' : null,
        !selected.announced ? '未公告' : null,
        !selected.clientAck ? '客户端未 ACK' : null,
        !selected.offlineLease ? '离线租约失效' : null,
      ].filter(Boolean)
    : [];
  const simulationStatus = simulation.itemId === selected?.itemId ? simulation.status : 'idle';
  const simulationMessage = !selected
    ? '选择一个合成对象后可开始本地演练。'
    : !selected.published
      ? data.simulation.unpublishedMessage
      : simulationStatus === 'loading'
        ? data.simulation.loadingMessage
        : simulationStatus === 'success'
          ? data.simulation.successMessage
          : simulationStatus === 'error'
            ? data.simulation.errorMessage
            : '准备就绪：可选择合成成功或失败回执，演练不会改变任何同步分面。';

  const clearSimulationTimer = () => {
    if (simulationTimer.current === null) return;
    window.clearTimeout(simulationTimer.current);
    simulationTimer.current = null;
  };

  const resetSimulation = () => {
    clearSimulationTimer();
    setSimulation({ itemId: '', status: 'idle' });
  };

  const startSimulation = () => {
    if (!selected?.published || simulationStatus === 'loading') return;
    clearSimulationTimer();
    const itemId = selected.itemId;
    setSimulation({ itemId, status: 'loading' });
    simulationTimer.current = window.setTimeout(() => {
      setSimulation({ itemId, status: outcome });
      simulationTimer.current = null;
    }, data.simulation.delayMs);
  };

  useEffect(() => () => clearSimulationTimer(), []);

  return (
    <div className="dash-module" data-testid="module-announce">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <StatusBadge label="四分面 · 不合并成已同步" tone="mock" />
      </header>
      <p className="dash-scope">{data.story}</p>
      <ul className="dash-facet-legend">
        {data.facets.map((facet) => <li key={facet.id}><strong>{facet.label}</strong>{facet.meaning}</li>)}
      </ul>

      <div className="dash-filter-toolbar compact" aria-label="公告与同步筛选">
        <div className="dash-filter-group is-grow" role="group" aria-label="状态筛选">
          <span>查看</span>
          <div className="dash-segmented">
            {([
              ['all', '全部'],
              ['attention', '需关注'],
              ['ack_missing', '待 ACK'],
              ['lease_expired', '租约失效'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? 'is-active' : ''}
                aria-pressed={filter === id}
                data-testid={`announce-filter-${id}`}
                onClick={() => {
                  resetSimulation();
                  setFilter(id);
                  setSelectedId('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="dash-selection-status" aria-live="polite" data-testid="announce-filter-status">
        <span>筛选结果</span><strong>{visible.length} 个合成同步对象</strong><em>四分面只读；本地演练不回写</em>
      </div>

      <section className="dash-card announce-simulation" data-testid="announce-push-panel" aria-labelledby="announce-simulation-title">
        <div className="announce-simulation-copy">
          <span className="dash-card-label">本地模拟推送</span>
          <h2 id="announce-simulation-title">演练回执状态，不执行真实发送</h2>
          <p>{data.simulation.disclaimer}</p>
        </div>
        <div className="announce-simulation-controls">
          <label>
            <span>演练结果</span>
            <select
              value={outcome}
              data-testid="announce-push-outcome"
              disabled={!selected?.published || simulationStatus === 'loading'}
              onChange={(event) => {
                resetSimulation();
                setOutcome(event.target.value as SimulationOutcome);
              }}
            >
              <option value="success">合成成功回执</option>
              <option value="error">合成失败回执</option>
            </select>
          </label>
          <button
            type="button"
            className="dash-reset announce-simulation-action"
            data-testid="announce-push-action"
            disabled={!selected?.published || simulationStatus === 'loading'}
            onClick={startSimulation}
          >
            {simulationStatus === 'loading' ? '本地演练中…' : simulationStatus === 'error' ? '重新演练' : '开始本地演练'}
          </button>
        </div>
        <div
          className="announce-simulation-status"
          role="status"
          aria-live="polite"
          aria-busy={simulationStatus === 'loading'}
          data-state={simulationStatus}
          data-testid="announce-push-status"
        >
          <strong>{selected ? `对象：${selected.title}` : '未选择对象'}</strong>
          <span>{simulationMessage}</span>
        </div>
      </section>

      <div className="dash-split announce-layout">
        <div className="dash-table-wrap">
          <table className="dash-table" data-testid="announce-table">
            <thead>
              <tr><th>对象</th><th>published</th><th>announced</th><th>client ACK</th><th>offline lease</th></tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.itemId} className={selected?.itemId === row.itemId ? 'is-selected' : ''}>
                  <td>
                    <button
                      type="button"
                      className="dash-linkish"
                      aria-pressed={selected?.itemId === row.itemId}
                      onClick={() => {
                        resetSimulation();
                        setSelectedId(row.itemId);
                      }}
                    >
                      {row.title}
                    </button>
                  </td>
                  <td>{facetLabel(row.published, '已发布', '未发布')}</td>
                  <td>{facetLabel(row.announced, '已公告', '未公告')}</td>
                  <td>{facetLabel(row.clientAck, '已 ACK', '未 ACK')}</td>
                  <td>{facetLabel(row.offlineLease, '租约有效', '租约失效')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length ? <div className="dash-empty-state"><strong>当前筛选无合成对象</strong><span>这不是生产同步状态。</span></div> : null}
        </div>
        <aside className="dash-card announce-detail" aria-live="polite" data-testid="announce-detail">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label">合成状态详情</span>
                <StatusBadge label={selectedIssues.length ? '需关注' : '四分面完成'} tone={selectedIssues.length ? 'warn' : 'ok'} />
              </div>
              <h2>{selected.title}</h2>
              <dl className="dash-dl">
                <div><dt>published</dt><dd>{facetLabel(selected.published, '已发布', '未发布')}</dd></div>
                <div><dt>announced</dt><dd>{facetLabel(selected.announced, '已公告', '未公告')}</dd></div>
                <div><dt>client ACK</dt><dd>{facetLabel(selected.clientAck, '已 ACK', '未 ACK')}</dd></div>
                <div><dt>offline lease</dt><dd>{facetLabel(selected.offlineLease, '租约有效', '租约失效')}</dd></div>
              </dl>
              <p className="dash-next-step"><span>经理判读</span>{selectedIssues.length ? selectedIssues.join('；') : '四个合成分面均完成。'}。Demo 不执行重发、续租或回滚。</p>
            </>
          ) : <p className="dash-empty">选择一个对象查看四分面状态</p>}
        </aside>
      </div>
      <p className="dash-footnote" data-testid="announce-no-synced">表中没有「已同步」合成列。四列必须分开读。</p>
    </div>
  );
}
