import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  DASHBOARD_MANIFEST,
  type DomainId,
  type WordingEntry,
  type WordingLifecycle,
} from '../../data/dashboard-manifest';
import type { DashboardWordingView } from '@shared/dashboard-wording';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.wording;

function riskTone(risk: WordingEntry['risk']): 'ok' | 'warn' | 'danger' {
  return risk === 'low' ? 'ok' : risk === 'medium' ? 'warn' : 'danger';
}

function asWordingEntry(entry: DashboardWordingView['entries'][number]): WordingEntry {
  return {
    scriptId: entry.scriptId,
    domain: entry.domain,
    title: entry.title,
    scene: entry.scene,
    answerPreview: entry.answerPreview,
    platform: entry.platform,
    version: entry.version,
    effectiveWindow: entry.effectiveWindow,
    risk: entry.risk,
    lifecycle: entry.lifecycle,
    lifecycleLabel: entry.lifecycleLabel,
    ownerRole: entry.ownerRole,
    dataClass: entry.dataClass,
  };
}

export function WordingLibraryModule() {
  const [catalog, setCatalog] = useState<DashboardWordingView | null>(null);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState<WordingLifecycle | 'all'>('all');
  const [domain, setDomain] = useState<DomainId>('product');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const api = window.dashboardWording;
    if (!api) return undefined;
    const load = () => {
      void api.list().then((result) => {
        if (!live || !result.ok) return;
        setCatalog(result);
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  const entries = useMemo(
    () => (catalog?.entries ?? []).map(asWordingEntry),
    [catalog],
  );
  const live = catalog !== null;

  const source = data.domains.find((item) => item.id === domain) ?? data.domains[0];
  const domainCount = entries.filter((entry) => entry.domain === domain).length;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return entries.filter((entry) => {
      if (entry.domain !== domain || (lifecycle !== 'all' && entry.lifecycle !== lifecycle)) {
        return false;
      }
      return !needle || `${entry.title} ${entry.scene} ${entry.answerPreview}`.toLocaleLowerCase('zh-CN').includes(needle);
    });
  }, [domain, entries, lifecycle, query]);
  const selected = visible.find((entry) => entry.scriptId === selectedId) ?? visible[0];

  const chooseDomain = (next: DomainId) => {
    setDomain(next);
    setQuery('');
    setLifecycle('all');
    setSelectedId(entries.find((entry) => entry.domain === next)?.scriptId ?? null);
  };

  const handleDomainKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: DomainId) => {
    const currentIndex = data.domains.findIndex((item) => item.id === current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % data.domains.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + data.domains.length) % data.domains.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = data.domains.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = data.domains[nextIndex];
    chooseDomain(next.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`wording-tab-${next.id}`)?.focus();
    });
  };

  const readinessLabel = !live
    ? '当前发布未挂载'
    : domainCount > 0
      ? '当前发布已挂载'
      : '当前发布无此域';
  const sourceSummary = !live
    ? '工作台只读通道未接通。VOC / 工单仍是架构模拟。'
    : domainCount > 0
      ? `${domainCount} 条 · 与查询胶囊同一份当前发布`
      : '当前域在当前发布中没有条目。';

  return (
    <div className="dash-module" data-testid="module-wording">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">当前发布只读 · 与查询胶囊同一份目录</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">
        只读浏览当前发布话术。不复制、不编辑、不发布、不发送。VOC / 工单仍是架构模拟。
      </p>

      <div className="wording-domain-tabs" role="tablist" aria-label="话术域">
        {data.domains.map((item) => (
          <button
            key={item.id}
            id={`wording-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={domain === item.id}
            aria-controls="wording-domain-panel"
            tabIndex={domain === item.id ? 0 : -1}
            className={domain === item.id ? 'is-active' : ''}
            data-testid={`wording-domain-${item.id}`}
            onClick={() => chooseDomain(item.id)}
            onKeyDown={(event) => handleDomainKeyDown(event, item.id)}
          >
            <strong>{item.label}</strong>
            <span>{live ? `${entries.filter((entry) => entry.domain === item.id).length} 条` : '未挂载'}</span>
          </button>
        ))}
      </div>

      <section
        id="wording-domain-panel"
        role="tabpanel"
        aria-labelledby={`wording-tab-${domain}`}
        className="wording-domain-panel"
      >
        <div className="source-readiness" data-testid="wording-source-readiness">
          <div>
            <span className="dash-card-label">当前发布</span>
            <strong>{source.label}</strong>
          </div>
          <StatusBadge
            label={readinessLabel}
            tone={!live || domainCount === 0 ? 'warn' : 'ok'}
          />
          <p>{sourceSummary}</p>
        </div>

        <div className="dash-filterbar" aria-label="话术筛选">
        <label>
          <span>关键词</span>
          <input
            data-testid="wording-search"
            value={query}
            placeholder="搜索标题 / 场景 / 正文"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>生命周期</span>
          <select
            data-testid="wording-lifecycle"
            value={lifecycle}
            onChange={(event) => setLifecycle(event.target.value as WordingLifecycle | 'all')}
          >
            <option value="all">全部</option>
            <option value="published">已发布</option>
          </select>
        </label>
        <button
          type="button"
          className="dash-reset"
          onClick={() => {
            setQuery('');
            setLifecycle('all');
            setSelectedId(entries.find((entry) => entry.domain === domain)?.scriptId ?? null);
          }}
        >
          重置
        </button>
        </div>

        <div className="dash-selection-status" aria-live="polite" data-testid="wording-filter-status">
          <span>当前域</span><strong>{source.label} · {visible.length} 条</strong><em>{readinessLabel}</em>
        </div>

        <div className="wording-layout">
        <div className="wording-list" data-testid="wording-list">
          {visible.length ? visible.map((entry) => (
            <button
              key={entry.scriptId}
              type="button"
              className={selected?.scriptId === entry.scriptId ? 'is-selected' : ''}
              aria-pressed={selected?.scriptId === entry.scriptId}
              onClick={() => setSelectedId(entry.scriptId)}
            >
              <span>
                <strong>{entry.title}</strong>
                <small>{entry.scene} · {entry.version}</small>
              </span>
              <StatusBadge label={entry.lifecycleLabel} tone="ok" />
            </button>
          )) : (
            <div className="dash-empty-state" data-testid="wording-empty">
              <strong>{live ? '没有匹配的话术' : '本机话术库未挂载'}</strong>
              <span>{live ? '换一个域或清空筛选后再看。' : '工作台只读通道未接通，不会回退到合成样例。'}</span>
            </div>
          )}
        </div>

        <aside className="dash-card wording-detail" data-testid="wording-detail">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label">本机话术库</span>
                <StatusBadge label={`风险 ${selected.risk}`} tone={riskTone(selected.risk)} />
              </div>
              <h2>{selected.title}</h2>
              <p className="wording-preview">{selected.answerPreview}</p>
              <dl className="dash-dl dash-dl-grid">
                <div><dt>script_id</dt><dd>{selected.scriptId}</dd></div>
                <div><dt>适用平台</dt><dd>{selected.platform}</dd></div>
                <div><dt>有效窗</dt><dd>{selected.effectiveWindow}</dd></div>
                <div><dt>来源</dt><dd>{selected.ownerRole}</dd></div>
              </dl>
              <p className="dash-footnote">只读浏览 · 不复制、不编辑、不发布、不发送</p>
            </>
          ) : (
            <p className="dash-empty">选择一条话术查看正文</p>
          )}
        </aside>
        </div>
      </section>
    </div>
  );
}
