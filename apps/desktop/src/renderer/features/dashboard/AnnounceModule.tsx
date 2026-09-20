import { useEffect, useMemo, useRef, useState } from 'react';
import { DASHBOARD_MANIFEST } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.announce;
type AnnounceFilter = 'all' | 'attention' | 'ack_missing' | 'lease_expired';
type SimulationOutcome = 'success' | 'error';
type SimulationStatus = 'idle' | 'loading' | 'success' | 'error';
type ActiveTab = 'wording' | 'software';

type SimulationRun = {
  itemId: string;
  status: SimulationStatus;
};

type SoftwareUpdateStatus = 'idle' | 'checking' | 'up-to-date';

const MOCK_SOFTWARE_VERSIONS = [
  { version: 'v0.3.16', date: '2026-09-20', note: '修复导入状态轮询过慢，xlsx 解析加固' },
  { version: 'v0.3.15', date: '2026-09-10', note: '登录流程优化' },
  { version: 'v0.3.14', date: '2026-09-01', note: '公告与租约同步' },
] as const;

const CURRENT_VERSION = 'v0.3.16';
const LATEST_VERSION = 'v0.3.16';

function facetLabel(on: boolean, onText: string, offText: string): string {
  return on ? onText : offText;
}

function WordingTab() {
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
    <>
      <p className="dash-scope">{data.story}</p>
      <ul className="dash-facet-legend">
        {data.facets.map((facet) => <li key={facet.id}><strong>{facet.label}</strong>{facet.meaning}</li>)}
      </ul>

      <div className="dash-filter-toolbar compact" aria-label="话术版本筛选">
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
            className="dash-action-primary announce-simulation-action"
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
    </>
  );
}

function SoftwareTab() {
  const [updateStatus, setUpdateStatus] = useState<SoftwareUpdateStatus>('idle');
  const updateTimerRef = useRef<number | null>(null);

  const checkUpdate = () => {
    if (updateStatus === 'checking') return;
    setUpdateStatus('checking');
    updateTimerRef.current = window.setTimeout(() => {
      setUpdateStatus('up-to-date');
      updateTimerRef.current = null;
    }, 1200);
  };

  useEffect(() => () => {
    if (updateTimerRef.current !== null) window.clearTimeout(updateTimerRef.current);
  }, []);

  return (
    <>
      <div className="dash-card" data-testid="software-version-card">
        <div className="dash-card-row">
          <span className="dash-card-label">软件版本</span>
          <StatusBadge label="未签名 · 手动更新" tone="warn" />
        </div>
        <dl className="dash-dl">
          <div><dt>当前版本</dt><dd>{CURRENT_VERSION}</dd></div>
          <div>
            <dt>最新可用版本</dt>
            <dd>{LATEST_VERSION}{updateStatus === 'up-to-date' ? '（当前已是最新版本）' : ''}</dd>
          </div>
        </dl>
        <div className="dash-card-row">
          <button
            type="button"
            className="dash-action-primary"
            data-testid="software-check-update"
            disabled={updateStatus === 'checking'}
            onClick={checkUpdate}
          >
            {updateStatus === 'checking' ? '检查中…' : updateStatus === 'up-to-date' ? '已是最新' : '检查更新'}
          </button>
          {updateStatus === 'up-to-date' && (
            <span aria-live="polite">当前已是最新版本（{LATEST_VERSION}）</span>
          )}
        </div>
        <p className="system-sync-unsigned-note">
          当前安装包为未签名版本（UNSIGNED），更新请联系管理员获取最新安装包并手动替换。自动更新功能待后续正式签名版本启用。
        </p>
      </div>

      <section aria-labelledby="software-history-title">
        <div className="dash-section-title">
          <h2 id="software-history-title">版本历史</h2>
        </div>
        <table className="dash-table" data-testid="software-version-history">
          <thead>
            <tr><th>版本号</th><th>发布日期</th><th>更新说明</th></tr>
          </thead>
          <tbody>
            {MOCK_SOFTWARE_VERSIONS.map((v) => (
              <tr key={v.version}>
                <td>{v.version}</td>
                <td>{v.date}</td>
                <td>{v.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function AnnounceModule() {
  const [tab, setTab] = useState<ActiveTab>('wording');

  return (
    <div className="dash-module" data-testid="module-announce">
      <header className="dash-module-head">
        <div>
          <h1>系统同步</h1>
          <p className="dash-kicker">话术版本 / 软件版本更新</p>
        </div>
      </header>

      <div className="system-sync-tabs" role="tablist" aria-label="系统同步选项">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'wording'}
          data-testid="system-sync-tab-wording"
          onClick={() => setTab('wording')}
        >
          话术版本更新
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'software'}
          data-testid="system-sync-tab-software"
          onClick={() => setTab('software')}
        >
          软件版本更新
        </button>
      </div>

      <div role="tabpanel" aria-label={tab === 'wording' ? '话术版本更新' : '软件版本更新'}>
        {tab === 'wording' ? <WordingTab /> : <SoftwareTab />}
      </div>
    </div>
  );
}
