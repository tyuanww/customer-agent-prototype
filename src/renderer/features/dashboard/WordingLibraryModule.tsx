import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  DASHBOARD_MANIFEST,
  type DomainId,
  type WordingEntry,
  type WordingLifecycle,
} from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.wording;

function riskTone(risk: WordingEntry['risk']): 'ok' | 'warn' | 'danger' {
  return risk === 'low' ? 'ok' : risk === 'medium' ? 'warn' : 'danger';
}

export function WordingLibraryModule() {
  const [domain, setDomain] = useState<DomainId>('product');
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState<WordingLifecycle | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(data.entries[0]?.scriptId ?? null);
  const source = data.domains.find((item) => item.id === domain) ?? data.domains[0];
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return data.entries.filter((entry) => {
      if (entry.domain !== domain || (lifecycle !== 'all' && entry.lifecycle !== lifecycle)) {
        return false;
      }
      return !needle || `${entry.title} ${entry.scene} ${entry.answerPreview}`.toLocaleLowerCase('zh-CN').includes(needle);
    });
  }, [domain, lifecycle, query]);
  const selected = visible.find((item) => item.scriptId === selectedId) ?? visible[0];

  const chooseDomain = (next: DomainId) => {
    setDomain(next);
    setQuery('');
    setLifecycle('all');
    setSelectedId(data.entries.find((item) => item.domain === next)?.scriptId ?? null);
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

  return (
    <div className="dash-module" data-testid="module-wording">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">{data.disclaimer}</p>

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
            <span>{item.readiness === 'upstream_authoring' ? '待上游建设' : '结构已确认'}</span>
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
            <span className="dash-card-label">正式来源就绪度</span>
            <strong>{source.label}</strong>
          </div>
          <StatusBadge
            label={source.readinessLabel}
            tone={source.readiness === 'upstream_authoring' ? 'danger' : 'warn'}
          />
          <p>{source.sourceSummary}</p>
        </div>

        <div className="dash-filterbar" aria-label="话术筛选">
        <label>
          <span>关键词</span>
          <input
            data-testid="wording-search"
            value={query}
            placeholder="搜索标题 / 场景 / 合成正文"
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
            <option value="demo_effective">合成有效</option>
            <option value="demo_expiring">合成临期</option>
            <option value="structure_sample">结构样例 · 未发布</option>
          </select>
        </label>
        <button
          type="button"
          className="dash-reset"
          onClick={() => {
            setQuery('');
            setLifecycle('all');
            setSelectedId(data.entries.find((item) => item.domain === domain)?.scriptId ?? null);
          }}
        >
          重置
        </button>
        </div>

        <div className="dash-selection-status" aria-live="polite" data-testid="wording-filter-status">
          <span>当前域</span><strong>{source.label} · {visible.length} 条合成样例</strong><em>{source.readinessLabel}</em>
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
              <StatusBadge label={entry.lifecycleLabel} tone={entry.lifecycle === 'structure_sample' ? 'danger' : 'warn'} />
            </button>
          )) : (
            <div className="dash-empty-state" data-testid="wording-empty">
              <strong>没有匹配的合成样例</strong>
              <span>这不代表正式话术库无内容；当前 Dashboard 未连接正式源。</span>
            </div>
          )}
        </div>

        <aside className="dash-card wording-detail" data-testid="wording-detail">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label">DEMO · SYNTHETIC</span>
                <StatusBadge label={`风险 ${selected.risk}`} tone={riskTone(selected.risk)} />
              </div>
              <h2>{selected.title}</h2>
              <p className="wording-preview">{selected.answerPreview}</p>
              <dl className="dash-dl dash-dl-grid">
                <div><dt>script_id</dt><dd>{selected.scriptId}</dd></div>
                <div><dt>适用平台</dt><dd>{selected.platform}</dd></div>
                <div><dt>有效窗</dt><dd>{selected.effectiveWindow}</dd></div>
                <div><dt>Owner</dt><dd>{selected.ownerRole}</dd></div>
              </dl>
              <p className="dash-footnote">只读浏览 · 不复制、不编辑、不发布、不发送</p>
            </>
          ) : (
            <p className="dash-empty">选择一条合成样例查看结构</p>
          )}
        </aside>
        </div>
      </section>
    </div>
  );
}
