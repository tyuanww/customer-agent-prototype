import { Alert, Button, Table, Tabs } from 'antd';
import { useState } from 'react';
import type { SopWorkbookView } from '@shared/sop-workbook-preview';
import { IntakeAntdTheme } from './intake-antd';
import { WorkbenchEmpty, WorkbenchFailed, WorkbenchLoading } from './WorkbenchState';
import { useAsyncResource } from './use-async-resource';
import './workbench-v9.css';

type SopLine = SopWorkbookView['sheets'][number]['lines'][number];

/** Read-only preview of an operator's local SOP workbook. Nothing here publishes or switches the
 *  seat's flow; the page says so once, in the status line above the table. */
export function IntakeSopSource() {
  const api = window.dashboardSopWorkbook;
  const [sheetName, setSheetName] = useState('');
  const [opened, setOpened] = useState(0);
  const { resource, reload } = useAsyncResource<SopWorkbookView>(async () => {
    const opener = window.dashboardSopWorkbook;
    if (!opener || opened === 0) return { status: 'idle' };
    try {
      const reply = await opener.open();
      if (!reply.ok) {
        if (reply.code === 'CANCELLED') return { status: 'idle' };
        return { status: 'error', message: reply.message };
      }
      setSheetName(reply.sheets[0]?.name ?? '');
      return { status: 'ready', value: reply };
    } catch {
      return { status: 'error', message: '这个文件读不开。' };
    }
  }, [opened], { status: 'idle' });
  const open = () => {
    if (!api || resource.status === 'loading') return;
    if (opened === 0) setOpened(1);
    else reload();
  };
  const view = resource.status === 'ready' ? resource.value : null;
  const busy = resource.status === 'loading';
  const problem = resource.status === 'error' ? resource.message : '';
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
        title="这张表没有通过检查，没有展示半成品。"
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
