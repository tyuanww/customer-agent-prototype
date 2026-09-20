import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  type DomainId,
  type WordingEntry,
  type WordingLifecycle,
} from '../../data/dashboard-manifest';
import type { DashboardWordingView } from '@shared/dashboard-wording';
import { bindingsForRows } from '@shared/dashboard-content';
import {
  paginateWording,
  wordingPublishedCsv,
} from '@shared/wording-library-browse';
import { readCoachUploadFile } from './coach-content-upload';
import { StatusBadge } from './StatusBadge';

const WRITE_UNAVAILABLE = '未接入：冻结合同没有单条更新/删除命令。';

const WORDING_DOMAINS: readonly { id: DomainId; label: string }[] = [
  { id: 'product', label: '产品话术' },
  { id: 'campaign', label: '活动话术' },
  { id: 'presale', label: '售前流程' },
  { id: 'aftersale', label: '售后流程' },
];

function riskTone(risk: WordingEntry['risk']): 'ok' | 'warn' | 'danger' {
  return risk === 'low' ? 'ok' : risk === 'medium' ? 'warn' : 'danger';
}

function downloadTextFile(filename: string, body: string): void {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
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
  const [page, setPage] = useState(1);
  const [writeMessage, setWriteMessage] = useState<string | null>(null);

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

  const source = WORDING_DOMAINS.find((item) => item.id === domain) ?? WORDING_DOMAINS[0];
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
  const paged = useMemo(() => paginateWording(visible, page), [page, visible]);
  const selected = paged.slice.find((entry) => entry.scriptId === selectedId) ?? paged.slice[0];

  const chooseDomain = (next: DomainId) => {
    setDomain(next);
    setQuery('');
    setLifecycle('all');
    setPage(1);
    setSelectedId(entries.find((entry) => entry.domain === next)?.scriptId ?? null);
  };

  const handleDomainKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: DomainId) => {
    const currentIndex = WORDING_DOMAINS.findIndex((item) => item.id === current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % WORDING_DOMAINS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + WORDING_DOMAINS.length) % WORDING_DOMAINS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = WORDING_DOMAINS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = WORDING_DOMAINS[nextIndex];
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
    ? '未接入当前发布通道。'
    : domainCount > 0
      ? `${domainCount} 条 · 与查询胶囊同一份当前发布`
      : '当前域在当前发布中没有条目。';

  return (
    <div className="dash-module" data-testid="module-wording">
      <header className="dash-module-head">
        <div>
          <h1>话术库</h1>
          <p className="dash-kicker">列表读当前发布 · 上传走内容导入 · 单条改删未接入</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">
        浏览与导出当前发布。上传会调用产品导入接口。单条更新/删除没有冻结合同，按钮保持未接入。
      </p>
      <div className="dash-filter-toolbar" aria-label="话术写操作">
        <label className="dash-reset">
          上传
          <input
            data-testid="wording-upload-input"
            type="file"
            accept=".csv,.xlsx"
            hidden
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const api = window.dashboardContent;
              if (!api) {
                setWriteMessage('未接入：没有内容导入通道。');
                return;
              }
              void readCoachUploadFile(file).then(async (parsed) => {
                if (!parsed.ok) {
                  setWriteMessage(parsed.message);
                  return;
                }
                const result = await api.importDraft({
                  csvText: parsed.csvText,
                  sourceName: parsed.sourceName,
                  sourceBindings: bindingsForRows(parsed.rows),
                });
                setWriteMessage(result.ok ? `已导入草稿 ${result.importBatchId}` : result.message);
              });
            }}
          />
        </label>
        <button
          type="button"
          className="dash-reset"
          data-testid="wording-update"
          onClick={() => setWriteMessage(WRITE_UNAVAILABLE)}
        >
          更新
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="wording-delete"
          onClick={() => setWriteMessage(WRITE_UNAVAILABLE)}
        >
          删除
        </button>
      </div>
      {writeMessage ? <p className="dash-scope" data-testid="wording-write-status">{writeMessage}</p> : null}

      <div className="wording-domain-tabs" role="tablist" aria-label="话术域">
        {WORDING_DOMAINS.map((item) => (
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
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          <span>生命周期</span>
          <select
            data-testid="wording-lifecycle"
            value={lifecycle}
            onChange={(event) => {
              setLifecycle(event.target.value as WordingLifecycle | 'all');
              setPage(1);
            }}
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
            setPage(1);
            setSelectedId(entries.find((entry) => entry.domain === domain)?.scriptId ?? null);
          }}
        >
          重置
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="wording-export"
          disabled={visible.length === 0}
          onClick={() => {
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile(`话术库-${source.label}-已发布-${stamp}.csv`, wordingPublishedCsv(visible));
          }}
        >
          导出 CSV
        </button>
        </div>

        <div className="dash-selection-status" aria-live="polite" data-testid="wording-filter-status">
          <span>当前域</span><strong>{source.label} · {visible.length} 条</strong><em>{readinessLabel}</em>
        </div>

        <div className="wording-layout">
        <div className="wording-list" data-testid="wording-list">
          {visible.length ? paged.slice.map((entry) => (
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
              <span>{live ? '换一个域或清空筛选后再看。' : '未接入当前发布，不回退 fixture。'}</span>
            </div>
          )}
          {visible.length > 0 ? (
            <div className="wording-pager" data-testid="wording-pager">
              <button
                type="button"
                className="dash-reset"
                data-testid="wording-page-prev"
                disabled={paged.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <span data-testid="wording-page-status">第 {paged.page} / {paged.pageCount} 页</span>
              <button
                type="button"
                className="dash-reset"
                data-testid="wording-page-next"
                disabled={paged.page >= paged.pageCount}
                onClick={() => setPage((current) => Math.min(paged.pageCount, current + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}
        </div>

        <aside className="dash-card wording-detail" data-testid="wording-detail">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label" data-testid="wording-detail-owner">{selected.ownerRole}</span>
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
              <p className="dash-footnote">列表来自当前发布。单条更新/删除未接入冻结合同。</p>
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
