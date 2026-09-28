import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardSoftwareCatalog } from '@shared/dashboard-ops-loop';
import type { DashboardAnnounceResult, DashboardAnnounceView } from '@shared/dashboard-announce';
import {
  LIBRARY_DOMAINS,
  LIBRARY_DOMAIN_LABELS,
  LIBRARY_DELTA_UNREADABLE,
  parseLibraryDelta,
  type LibraryDomain,
  type LibraryDelta,
  type LibraryStatus,
} from '@shared/library-delta';
import type { DomainId } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

type ActiveTab = 'wording' | 'software';

const LIBRARY_DOMAIN_IDS: Readonly<Record<LibraryDomain, DomainId>> = Object.freeze({
  product: 'product',
  campaign: 'campaign',
  presale: 'presale',
  aftersale: 'aftersale',
});

/**
 * Card-state source is the published `Announcement.summary` delta on this session's
 * `/v1/announce/current`. Never hydrate hashes or local sourceBindings. When the
 * summary is missing/garbled every card shows the honest 「无法标出…」 line.
 */
function libraryCardStatus(delta: LibraryDelta | null, domain: LibraryDomain): LibraryStatus | 'unknown' {
  if (!delta) return 'unknown';
  return delta[domain];
}

/** 卡上的一句话状态。无法解析 delta 时诚实写「无法标出」，不冒充已更新/沿用。 */
function libraryCardBadgeLabel(status: LibraryStatus | 'unknown'): string {
  if (status === 'updated') return '本版已更新';
  if (status === 'carried') return '本版沿用';
  return '无法标出';
}

function libraryCardDataStatus(status: LibraryStatus | 'unknown'): 'updated' | 'carried' | 'unknown' {
  if (status === 'updated' || status === 'carried') return status;
  return 'unknown';
}

function WordingTab({ onOpenDomain }: { onOpenDomain?: (domain: DomainId) => void }) {
  const [state, setState] = useState<DashboardAnnounceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = window.dashboardAnnounce;
    if (!api) {
      setState({ ok: false, code: 'UNAVAILABLE', signedIn: false });
      setLoading(false);
      return undefined;
    }
    let live = true;
    const load = () => {
      void api.current().then((result) => {
        if (!live) return;
        setState(result);
        setLoading(false);
      }).catch(() => {
        if (!live) return;
        setState({ ok: false, code: 'UNAVAILABLE', signedIn: false });
        setLoading(false);
      });
    };
    load();
    // dashboard preload 不挂 push，也无渲染侧定时器：窗口聚焦/重新可见时重取，
    // 加一个 10s poll 对齐坐席运输层节奏——窗口可见时另一台机器发布后四卡能自动跟上。
    const onVisible = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => {
      live = false;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, []);

  const view: DashboardAnnounceView | null = state?.ok ? state : null;
  const delta = useMemo(
    () => (view ? parseLibraryDelta(view.announcement?.summary ?? null) : null),
    [view],
  );
  const unreadDomains = useMemo(
    () => new Set(view?.unreadDomains ?? []),
    [view],
  );

  // 「话术版本更新」tab 实际可见时才清当前 userId 的未读。
  // document.hidden 不在 deps 里，所以必须自己听 visibilitychange，否则后台打开会卡住。
  useEffect(() => {
    if (!view?.unread || !unreadDomains.size) return undefined;
    const maybeRead = () => {
      if (document.hidden) return;
      void window.dashboardAnnounce?.markRead([...unreadDomains]);
    };
    maybeRead();
    document.addEventListener('visibilitychange', maybeRead);
    return () => document.removeEventListener('visibilitychange', maybeRead);
  }, [view, unreadDomains]);

  if (loading) {
    return (
      <div className="announce-empty" data-testid="announce-wording-loading">
        <strong>加载中…</strong>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="announce-empty" data-testid="announce-wording-empty">
        <strong>未接入当前发布</strong>
      </div>
    );
  }

  const title = view.announcement?.title ?? null;

  return (
    <>
      {!delta ? (
        <p className="dash-scope dash-scope-important" data-testid="announce-delta-unknown">
          {LIBRARY_DELTA_UNREADABLE}
        </p>
      ) : null}
      <div className="announce-library-grid" data-testid="announce-library-grid">
        {LIBRARY_DOMAINS.map((domain) => {
          const status = libraryCardStatus(delta, domain);
          const count = view.counts ? view.counts[domain] : null;
          const countLabel = count === null ? '—' : `${count} 条`;
          return (
            <button
              key={domain}
              type="button"
              className="dash-card announce-library-card"
              data-testid={`announce-library-${domain}`}
              data-library-status={libraryCardDataStatus(status)}
              onClick={() => onOpenDomain?.(LIBRARY_DOMAIN_IDS[domain])}
            >
              <div className="dash-card-row">
                <span className="dash-card-label">
                  {LIBRARY_DOMAIN_LABELS[domain]}
                  {unreadDomains.has(domain) ? (
                    <span className="announce-unread-dot" aria-label="有话术更新" role="img" />
                  ) : null}
                </span>
                <StatusBadge label={libraryCardBadgeLabel(status)} tone="neutral" />
              </div>
              {status === 'updated' && title ? (
                <p className="announce-library-title" data-testid={`announce-library-title-${domain}`}>{title}</p>
              ) : null}
              <p className="announce-library-count" data-testid={`announce-library-count-${domain}`}>
                {countLabel}
              </p>
            </button>
          );
        })}
      </div>
      <p className="dash-footnote" data-testid="announce-release-footnote">
        当前发布 {view.releaseId}
      </p>
    </>
  );
}

function softwareBadgeTone(catalog: DashboardSoftwareCatalog | null): 'ok' | 'warn' {
  if (catalog?.current?.signed) return 'ok';
  return 'warn';
}

function SoftwareTab() {
  const [catalog, setCatalog] = useState<DashboardSoftwareCatalog | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const liveRef = useRef(true);

  const load = () => {
    const api = window.dashboardOps;
    if (!api) {
      if (!liveRef.current) return;
      setCatalog(null);
      setMessage('未接入：没有安装包目录。');
      return;
    }
    void api.softwareCatalog().then((result) => {
      if (!liveRef.current) return;
      if (!result.ok) {
        setCatalog(null);
        setMessage(result.message);
        return;
      }
      setCatalog(result);
      const current = result.current;
      if (!current) {
        setMessage('目录为空，没有当前建议版本。');
        return;
      }
      const signedLabel = current.signed ? '已签名' : 'UNSIGNED';
      setMessage(`${current.version} · ${signedLabel} · 不跑 latest.yml`);
    }).catch(() => {
      if (!liveRef.current) return;
      setCatalog(null);
      setMessage('未接入：没有安装包目录。');
    });
  };

  useEffect(() => {
    liveRef.current = true;
    load();
    return () => {
      liveRef.current = false;
    };
  }, []);

  return (
    <>
      <div className="dash-card software-version-card" data-testid="software-version-card">
        <div className="dash-card-row">
          <span className="dash-card-label">软件版本</span>
          <StatusBadge
            label={catalog?.current ? catalog.current.version : '未接入'}
            tone={softwareBadgeTone(catalog)}
          />
        </div>
        {catalog?.current ? (
          <dl className="dash-dl">
            <div><dt>平台</dt><dd>{catalog.current.platform}</dd></div>
            <div><dt>签名</dt><dd>{catalog.current.signed ? '已签名' : 'UNSIGNED'}</dd></div>
          </dl>
        ) : null}
        <button
          type="button"
          className="dash-reset"
          data-testid="software-check-update"
          onClick={load}
        >
          检查更新
        </button>
        {message ? <p data-testid="software-update-status">{message}</p> : null}
      </div>
    </>
  );
}

export function AnnounceModule({ onOpenDomain }: { onOpenDomain?: (domain: DomainId) => void } = {}) {
  const [tab, setTab] = useState<ActiveTab>('wording');

  return (
    <div className="dash-module" data-testid="module-announce">
      <header className="dash-module-head">
        <h1>系统同步</h1>
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
        {tab === 'wording' ? <WordingTab onOpenDomain={onOpenDomain} /> : <SoftwareTab />}
      </div>
    </div>
  );
}
