import { useMemo, useState } from 'react';
import {
  DASHBOARD_MANIFEST,
  type LedgerRow,
  type LedgerTerminal,
} from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.ledger;

function terminalTone(row: LedgerRow): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (row.terminal === 'copied') return 'ok';
  if (row.terminal === 'no_hit') return 'warn';
  if (row.terminal === 'risk_escalated') return 'danger';
  return 'neutral';
}

export function LedgerModule() {
  const [selectedId, setSelectedId] = useState<string | null>(data.rows[0]?.operationId ?? null);
  const [terminal, setTerminal] = useState<LedgerTerminal | 'all'>('all');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return data.rows.filter((row) => {
      if (terminal !== 'all' && row.terminal !== terminal) return false;
      if (!needle) return true;
      return `${row.operationId} ${row.rootQuestionId} ${row.rootQuestion} ${row.scene}`
        .toLocaleLowerCase('zh-CN')
        .includes(needle);
    });
  }, [query, terminal]);
  const selected = visible.find((row) => row.operationId === selectedId) ?? visible[0];

  return (
    <div className="dash-module" data-testid="module-ledger">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <StatusBadge label="自动事实 · 合成流水" tone="mock" />
      </header>
      <p className="dash-scope">{data.emptyHint}</p>

      <div className="dash-filter-toolbar compact" aria-label="检索流水筛选">
        <label className="is-grow">
          <span>搜索</span>
          <input
            type="search"
            value={query}
            data-testid="ledger-search"
            placeholder="问题 / operation_id / 场景"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
            }}
          />
        </label>
        <label>
          <span>终态</span>
          <select
            value={terminal}
            data-testid="ledger-terminal-filter"
            onChange={(event) => {
              setTerminal(event.target.value as LedgerTerminal | 'all');
              setSelectedId(null);
            }}
          >
            <option value="all">全部终态</option>
            <option value="copied">已复制</option>
            <option value="no_hit">无命中</option>
            <option value="abandoned">展开未选择</option>
            <option value="risk_escalated">风险升级</option>
          </select>
        </label>
        <button
          type="button"
          className="dash-reset"
          onClick={() => {
            setQuery('');
            setTerminal('all');
            setSelectedId(data.rows[0]?.operationId ?? null);
          }}
        >
          重置
        </button>
      </div>
      <div className="dash-selection-status" aria-live="polite" data-testid="ledger-filter-status">
        <span>筛选结果</span><strong>{visible.length} 条合成操作</strong><em>终态分账，不读取最终发送正文</em>
      </div>

      <div className="dash-split ledger-layout">
        <div className="dash-table-wrap">
          <table className="dash-table" data-testid="ledger-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>根问题</th>
                <th>操作</th>
                <th>Chosen</th>
                <th>终态</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.operationId}
                  data-testid={`ledger-row-${row.operationId}`}
                  className={row.operationId === selected?.operationId ? 'is-selected' : ''}
                >
                  <td>{row.askedAt}</td>
                  <td>
                    <button
                      type="button"
                      className="dash-linkish"
                      aria-pressed={row.operationId === selected?.operationId}
                      onClick={() => setSelectedId(row.operationId)}
                    >
                      {row.rootQuestion}
                    </button>
                    <div className="dash-mini">{row.rootQuestionId}</div>
                  </td>
                  <td>
                    {row.operationId}
                    <div className="dash-mini">{row.operationNote}</div>
                  </td>
                  <td>{row.chosenRank ?? '—'}</td>
                  <td><StatusBadge label={row.terminalLabel} tone={terminalTone(row)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length ? (
            <div className="dash-empty-state" data-testid="ledger-empty">
              <strong>没有符合筛选的合成流水</strong><span>调整关键词或终态；空态不代表生产没有记录。</span>
            </div>
          ) : null}
        </div>

        <aside className="dash-card dash-detail" data-testid="ledger-detail" aria-live="polite">
          {selected ? (
            <>
              <p className="dash-card-label">合成详情</p>
              <h2>{selected.scene}</h2>
              <dl className="dash-dl">
                <div><dt>root question</dt><dd>{selected.rootQuestionId}</dd></div>
                <div><dt>search operation</dt><dd>{selected.operationId}</dd></div>
                <div><dt>终态</dt><dd>{selected.terminalLabel}</dd></div>
              </dl>
              <p className="dash-muted">{selected.operationNote}</p>
              {selected.top3.length > 0 ? (
                <ul className="dash-binding-list">
                  {selected.top3.map((item) => (
                    <li key={`${item.scriptId}-${item.rank}`}>
                      <strong>#{item.rank}</strong> {item.releaseId} / {item.scriptId} / {item.version}
                      <span>{item.contentHash}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="dash-empty">无 Top3 绑定 · 有效期过滤后空集</p>}
              <p className="dash-footnote">不展示最终发送正文。本 Demo 也不存在发送动作。</p>
            </>
          ) : <p className="dash-empty">当前筛选没有可查看的合成详情</p>}
        </aside>
      </div>
    </div>
  );
}
