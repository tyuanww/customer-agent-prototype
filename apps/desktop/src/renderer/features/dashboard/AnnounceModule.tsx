import { useEffect, useState } from 'react';
import type { DashboardWordingView } from '@shared/dashboard-wording';
import { StatusBadge } from './StatusBadge';

type ActiveTab = 'wording' | 'software';

function WordingTab() {
  const [catalog, setCatalog] = useState<DashboardWordingView | null>(null);
  const [message, setMessage] = useState('加载中…');

  useEffect(() => {
    const api = window.dashboardWording;
    if (!api) {
      setMessage('未接入：没有话术库通道。');
      return undefined;
    }
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setCatalog(null);
        setMessage('未接入当前发布。');
        return;
      }
      setCatalog(result);
      setMessage('');
    }).catch(() => {
      if (!live) return;
      setCatalog(null);
      setMessage('未接入当前发布。');
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <p className="dash-scope">话术版本来自当前发布，不是合成演练。</p>
      {catalog ? (
        <div className="dash-card" data-testid="announce-wording-live">
          <div className="dash-card-row">
            <span className="dash-card-label">当前话术发布</span>
            <StatusBadge label={catalog.releaseId ? '已挂载' : '空发布'} tone={catalog.releaseId ? 'ok' : 'warn'} />
          </div>
          <dl className="dash-dl">
            <div><dt>目标版本</dt><dd data-testid="announce-release-id">{catalog.releaseId ?? '未挂载'}</dd></div>
            <div><dt>条目数</dt><dd>{catalog.total}</dd></div>
          </dl>
        </div>
      ) : (
        <div className="dash-empty-state" data-testid="announce-wording-empty">
          <strong>{message}</strong>
        </div>
      )}
    </>
  );
}

function SoftwareTab() {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <p className="dash-scope">安装包目录和自动更新没有冻结合同，不能假装检查成功。</p>
      <div className="dash-card" data-testid="software-version-card">
        <div className="dash-card-row">
          <span className="dash-card-label">软件版本</span>
          <StatusBadge label="未接入" tone="warn" />
        </div>
        <button
          type="button"
          className="dash-reset"
          data-testid="software-check-update"
          onClick={() => setMessage('未接入：没有安装包目录接口，UNSIGNED 禁止 latest.yml。')}
        >
          检查更新
        </button>
        {message ? <p data-testid="software-update-status">{message}</p> : null}
      </div>
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
          <p className="dash-kicker">话术版本读当前发布 · 软件更新未接入</p>
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
