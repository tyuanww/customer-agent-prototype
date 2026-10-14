import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type UsageLogExportPreview,
  type UsageLogResult,
  type UsageLogRow,
} from '@shared/dashboard-usage-log';
import { formatShortTime } from './intake-time';
import './intake-management.css';

const RESULT_FILTERS: ReadonlyArray<{ id: UsageLogResult | ''; label: string }> = [
  { id: '', label: '全部' },
  { id: 'copied', label: '已复制' },
  { id: 'viewed', label: '仅查看' },
  { id: 'miss', label: '未命中' },
];
const RESULT_LABEL: Readonly<Record<UsageLogResult, string>> = { copied: '已复制', viewed: '仅查看', miss: '未命中' };

type Load = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'failed' } | { kind: 'ready' };

/** 系统同步页下的「使用情况」。接口没接上时只写「未接入」，不画假数据。 */
export function IntakeUsageLog() {
  const [result, setResult] = useState<UsageLogResult | ''>('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<UsageLogRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [load, setLoad] = useState<Load>(() => (window.dashboardUsageLog ? { kind: 'loading' } : { kind: 'unavailable' }));
  const [moreBusy, setMoreBusy] = useState(false);
  const [preview, setPreview] = useState<UsageLogExportPreview | null>(null);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  const fetchPage = useCallback((cursor: string | null, filterResult: UsageLogResult | '', filterQuery: string) => {
    const api = window.dashboardUsageLog;
    if (!api) { setLoad({ kind: 'unavailable' }); return; }
    const gen = ++generation.current;
    if (cursor === null) setLoad({ kind: 'loading' }); else setMoreBusy(true);
    void api.list({ result: filterResult, query: filterQuery, cursor }).then((reply) => {
      if (gen !== generation.current) return;
      setMoreBusy(false);
      if (!reply.ok) { setLoad({ kind: reply.code === 'UNAVAILABLE' ? 'unavailable' : 'failed' }); return; }
      setRows((current) => (cursor === null ? reply.rows : [...current, ...reply.rows]));
      setNext(reply.nextCursor);
      setCanExport(reply.canExport);
      setLoad({ kind: 'ready' });
    }).catch(() => {
      if (gen !== generation.current) return;
      setMoreBusy(false);
      setLoad({ kind: 'failed' });
    });
  }, []);

  useEffect(() => {
    if (!window.dashboardUsageLog) return undefined;
    const timer = setTimeout(() => fetchPage(null, result, query.trim()), query === '' ? 0 : 250);
    return () => clearTimeout(timer);
  }, [result, query, fetchPage]);

  useEffect(() => () => { generation.current++; }, []);

  const startExport = () => {
    const api = window.dashboardUsageLog;
    if (!api) return;
    setNotice('');
    void api.previewExport().then(setPreview).catch(() => setNotice('导出暂时不可用，请重试。'));
  };
  const confirmExport = () => {
    const api = window.dashboardUsageLog;
    if (!api) return;
    void api.export().then((reply) => {
      setPreview(null);
      if (reply.ok) setNotice(`已导出 ${reply.written} 条。`);
      else if (reply.code !== 'CANCELLED') setNotice('导出失败，请重试。');
    }).catch(() => { setPreview(null); setNotice('导出失败，请重试。'); });
  };

  return <section className="sec intake-usage-log" aria-label="使用情况">
    <div className="sec-head">
      <h2>使用情况</h2>
      {canExport && load.kind === 'ready' ? <button type="button" className="btn" onClick={startExport}>导出训练样本</button> : null}
    </div>
    {load.kind === 'unavailable' ? <p className="notready" style={{ padding: '12px 0' }}>未接入</p> : <>
      <div className="filters2" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="seg" role="group" aria-label="结果">
          {RESULT_FILTERS.map((item) => <button key={item.id || 'all'} type="button" aria-pressed={result === item.id}
            onClick={() => setResult(item.id)}>{item.label}</button>)}
        </div>
        <span className="grow" />
        <div className="search"><svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input aria-label="搜索问题或坐席" placeholder="搜索问题或坐席" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      </div>
      {preview ? <div className="funnel" role="alertdialog" aria-label="导出训练样本" style={{ marginTop: 0, marginBottom: 12 }}>
        {preview.ok ? <>
          <p className="fn-note" style={{ margin: '0 0 12px' }}>将导出 {preview.exportable} 条记录。已脱敏的 {preview.redacted} 条和未同意采集的 {preview.withoutConsent} 条不会导出，同一条只记一次。“已复制”不等于已发送，训练时请按此理解。</p>
          <div className="acts">
            <button type="button" className="btn btn-sm" onClick={() => setPreview(null)}>取消</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={preview.exportable === 0} onClick={confirmExport}>导出 CSV</button>
          </div>
        </> : <>
          <p className="fn-note" style={{ margin: '0 0 12px' }}>导出暂时不可用，请重试。</p>
          <div className="acts"><button type="button" className="btn btn-sm" onClick={() => setPreview(null)}>关闭</button></div>
        </>}
      </div> : null}
      {notice ? <p role="status" className="hint">{notice}</p> : null}
      {load.kind === 'failed' ? <p role="alert">使用情况读取失败，请重试。
        <button type="button" className="btn btn-sm" onClick={() => fetchPage(null, result, query.trim())}>重试</button></p> : null}
      {load.kind === 'loading' ? <p role="status">正在读取…</p> : null}
      {load.kind === 'ready' ? <table className="fixed intake-usage-table" aria-label="使用情况">
        <colgroup><col style={{ width: 120 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 200 }} /><col style={{ width: 104 }} /></colgroup>
        <thead><tr><th>时间</th><th>坐席</th><th>客户问题</th><th>命中话术</th><th>结果</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={5} className="empty">没有符合条件的记录</td></tr> : rows.map((row) => <tr className="item" key={row.id}>
            <td className="mute">{formatShortTime(row.askedAt)}</td>
            <td>{row.agent}</td>
            <td>{row.question === null ? <span className="redact">已脱敏</span> : row.question}</td>
            <td>{row.scriptTitle ?? <span className="mute">—</span>}{row.snapshotStale ? <span className="stale" title="坐席当时用的是旧快照">旧快照</span> : null}</td>
            <td><span className="res"><i className={`dot${row.result === 'copied' ? ' ok' : row.result === 'viewed' ? ' wait' : ''}`} />{RESULT_LABEL[row.result]}</span></td>
          </tr>)}
        </tbody>
      </table> : null}
      {load.kind === 'ready' && next !== null ? <div className="pager">
        <button type="button" className="btn btn-sm" disabled={moreBusy} onClick={() => fetchPage(next, result, query.trim())}>加载更多</button></div> : null}
      {load.kind === 'ready' ? <p className="hint" style={{ marginTop: 10 }}>“已复制”表示话术进了输入框，系统不知道最后是否发送。</p> : null}
    </>}
  </section>;
}
