import { createElement, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Button, Empty, Input, Segmented, Table, type ButtonProps, type TableColumnsType, type TableProps } from 'antd';
import {
  isUsageLogResult,
  type UsageLogExportPreview,
  type UsageLogResult,
  type UsageLogRow,
} from '@shared/dashboard-usage-log';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import { formatShortTime } from './intake-time';
import './intake-management.css';
import { WorkbenchFailed, WorkbenchLoading } from './WorkbenchState';

const RESULT_FILTERS: ReadonlyArray<{ id: UsageLogResult | ''; label: string }> = [
  { id: '', label: '全部' },
  { id: 'copied', label: '已复制' },
  { id: 'viewed', label: '仅查看' },
  { id: 'miss', label: '未命中' },
];
const RESULT_LABEL: Readonly<Record<UsageLogResult, string>> = { copied: '已复制', viewed: '仅查看', miss: '未命中' };

type Load = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'failed' } | { kind: 'ready' };

function LogButton(props: ButtonProps) {
  return <Button {...props} autoInsertSpace={false} />;
}

/** rc-table copies aria-label onto the table. antd's prop type omits it. */
function UsageTable(props: TableProps<UsageLogRow> & { 'aria-label': string }) {
  return createElement(Table as ComponentType<typeof props>, props);
}

export function IntakeUsageLog() {
  const [result, setResult] = useState<UsageLogResult | ''>('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<UsageLogRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [load, setLoad] = useState<Load>(() => (window.dashboardUsageLog ? { kind: 'loading' } : { kind: 'unavailable' }));
  const [moreBusy, setMoreBusy] = useState(false);
  const [preview, setPreview] = useState<UsageLogExportPreview | null>(null);
  const [exporting, setExporting] = useState(false);
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
  const resultClass = (value: UsageLogRow['result']) => {
    if (value === 'copied') return ' is-copied';
    if (value === 'viewed') return ' is-viewed';
    return '';
  };
  const confirmExport = async () => {
    const api = window.dashboardUsageLog;
    if (!api || exporting) return;
    setExporting(true);
    try {
      const reply = await api.export();
      setPreview(null);
      if (reply.ok) setNotice(`已导出 ${reply.written} 条。`);
      else if (reply.code !== 'CANCELLED') setNotice('导出失败，请重试。');
    } catch {
      setPreview(null);
      setNotice('导出失败，请重试。');
    } finally {
      setExporting(false);
    }
  };
  const columns: TableColumnsType<UsageLogRow> = [
    { title: '时间', dataIndex: 'askedAt', width: 108, onCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (askedAt: UsageLogRow['askedAt']) => <span className="mute">{formatShortTime(askedAt)}</span> },
    { title: '坐席', dataIndex: 'agent', width: 84, ellipsis: true },
    { title: '客户问题', dataIndex: 'question', ellipsis: true, render: (question: UsageLogRow['question']) => (question === null ? <span className="redact">已脱敏</span> : question) },
    { title: '命中话术', key: 'script', ellipsis: true, render: (_value: unknown, row) => <>
      {row.scriptTitle ?? <span className="mute">—</span>}
      {row.snapshotStale ? <span className="stale" title="坐席当时用的是旧快照">旧快照</span> : null}
    </> },
    { title: '结果', dataIndex: 'result', width: 96, onCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (value: UsageLogRow['result']) => <span className={`res intake-result${resultClass(value)}`}>{RESULT_LABEL[value]}</span> },
  ];

  return <section className="sec intake-usage-log" aria-label="使用情况">
    <div className="sec-head">
      <h2>使用情况</h2>
      {canExport && load.kind === 'ready' ? <LogButton onClick={startExport}>导出使用记录</LogButton> : null}
    </div>
    {load.kind === 'unavailable' ? <p className="notready" style={{ padding: '12px 0' }}>{WORKBENCH_EMPTY.usageUnmounted}</p> : <>
      <div className="filters2" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <Segmented
          aria-label="结果"
          value={result || 'all'}
          options={RESULT_FILTERS.map((item) => ({ label: item.label, value: item.id || 'all' }))}
          onChange={(value) => {
            if (value === 'all') setResult('');
            else if (isUsageLogResult(value)) setResult(value);
          }}
        />
        <span className="grow" />
        <Input aria-label="搜索问题或坐席" placeholder="搜索问题或坐席" style={{ width: 220 }} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {preview ? <div className="funnel" role="alertdialog" aria-label="导出使用记录" style={{ marginTop: 0, marginBottom: 12 }}>
        {preview.ok ? <>
          <p className="fn-note" style={{ margin: '0 0 12px' }}>将导出 {preview.exportable} 条记录。已脱敏的 {preview.redacted} 条和未同意采集的 {preview.withoutConsent} 条不会导出，同一条只记一次。“已复制”不等于已发送，训练时请按此理解。</p>
          <div className="acts">
            <LogButton disabled={exporting} onClick={() => setPreview(null)}>取消</LogButton>
            <LogButton type="primary" disabled={exporting || preview.exportable === 0} onClick={() => void confirmExport()}>导出 CSV</LogButton>
          </div>
        </> : <>
          <p className="fn-note" style={{ margin: '0 0 12px' }}>导出暂时不可用，请重试。</p>
          <div className="acts">
            <LogButton onClick={() => setPreview(null)}>关闭</LogButton>
            <LogButton type="primary" onClick={startExport}>重试</LogButton>
          </div>
        </>}
      </div> : null}
      {notice ? <p role="status" className="hint">{notice}</p> : null}
      {load.kind === 'failed' ? <WorkbenchFailed message={WORKBENCH_EMPTY.usageFailed} onRetry={() => fetchPage(null, result, query.trim())} /> : null}
      {load.kind === 'loading' ? <WorkbenchLoading rows={5} label="正在读取使用情况" /> : null}
      {load.kind === 'ready' ? <UsageTable
        aria-label="使用情况"
        pagination={false}
        tableLayout="fixed"
        rowKey="id"
        rowClassName={() => 'item'}
        dataSource={rows}
        columns={columns}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={result === '' && query.trim() === '' ? WORKBENCH_EMPTY.usageEmpty : '没有符合条件的记录'} /> }}
      /> : null}
      {load.kind === 'ready' && next !== null ? <div className="pager">
        <LogButton disabled={moreBusy} onClick={() => fetchPage(next, result, query.trim())}>加载更多</LogButton></div> : null}
      {load.kind === 'ready' ? <p className="hint" style={{ marginTop: 10 }}>“已复制”表示话术进了输入框，系统不知道最后是否发送。</p> : null}
    </>}
  </section>;
}
