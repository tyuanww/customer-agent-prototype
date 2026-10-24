import { Alert, Button, Table, Tabs } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { SopWorkbookView } from '@shared/sop-workbook-preview';
import { IntakeAntdTheme } from './intake-antd';
import { WorkbenchEmpty, WorkbenchFailed, WorkbenchLoading } from './WorkbenchState';
import './workbench-v9.css';

type SopLine = SopWorkbookView['sheets'][number]['lines'][number];

/** Read-only preview of an operator's local SOP workbook. Nothing here publishes or switches the
 *  seat's flow; the page says so once, in the status line above the table. */
export function IntakeSopSource() {
  const api = window.dashboardSopWorkbook;
  const [view, setView] = useState<SopWorkbookView | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const open = async () => {
    if (!api || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const reply = await api.open();
      if (!liveRef.current) return;
      if (!reply.ok) {
        if (reply.code !== 'CANCELLED') {
          setView(null);
          setSheetName('');
          setProblem(reply.message);
        }
        return;
      }
      setView(reply);
      setSheetName(reply.sheets[0]?.name ?? '');
    } catch {
      if (!liveRef.current) return;
      setView(null);
      setSheetName('');
      setProblem('这个文件读不开。');
    } finally {
      if (liveRef.current) setBusy(false);
    }
  };

  const sheet = view?.sheets.find((item) => item.name === sheetName) ?? view?.sheets[0];
  return <IntakeAntdTheme><section className="dash-module wb9 sop-source" data-testid="module-sop" aria-label="SOP">
    <h1 className="desk-sr">SOP</h1>
    {api ? <div className="sop-source-bar">
      <Button type="primary" loading={busy} onClick={() => void open()}>{busy ? '正在读取…' : '打开原始 SOP 表'}</Button>
      {view ? <span className="sop-source-file">{view.fileName}</span> : null}
    </div> : null}
    {problem ? <WorkbenchFailed message={problem} onRetry={api ? () => void open() : undefined} retryLabel="重新选择文件" /> : null}
    {busy && !view ? <WorkbenchLoading rows={6} label="正在读取 SOP 表" /> : null}
    {!busy && !view && !problem ? <WorkbenchEmpty>还没有 SOP。</WorkbenchEmpty> : null}
    {view ? <>
      <p className="sop-source-status">原始资料，未发布。坐席流程不变。</p>
      {!view.accepted ? <Alert
        type="warning"
        showIcon={false}
        message="这张表没有通过检查，没有展示半成品。"
        description={<ul className="sop-source-issues">{view.issues.map((issue) => <li key={`${issue.code}-${issue.sheet}-${issue.row}`}>{issue.sheet || '文件'} 第 {issue.row} 行：{issue.fix}</li>)}</ul>}
      /> : <>
        <Tabs
          activeKey={sheet?.name}
          onChange={setSheetName}
          aria-label="SOP 工作表"
          items={view.sheets.map((item) => ({ key: item.name, label: item.name }))}
        />
        <Table<SopLine>
          aria-label={sheet?.name ?? 'SOP 原文'}
          rowKey="row"
          size="middle"
          pagination={false}
          tableLayout="fixed"
          dataSource={sheet?.lines ?? []}
          columns={[
            { title: '行', dataIndex: 'row', width: 64 },
            {
              title: '原文',
              dataIndex: 'text',
              render: (text: string, line) => <>
                {text}
                {line.images > 0 ? <span className="cell-sub">本行有 {line.images} 张图，未入库。</span> : null}
              </>,
            },
          ]}
        />
      </>}
    </> : null}
  </section></IntakeAntdTheme>;
}
