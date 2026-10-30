import { Button, Checkbox, Form, Modal, Select, Space, Table, type ButtonProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { IntakeUploadCommand, IntakeUploadView } from '@shared/content-intake-upload';
import { joinDisplayParts } from '@shared/display-separator';

function ActionButton(props: ButtonProps) {
  return <Button autoInsertSpace={false} {...props} />;
}
const domainWord = { product: '产品', campaign: '活动', presale: '售前', aftersale: '售后' } as const;
const phases: Record<IntakeUploadView['phase'], string> = {
  idle: '请选择资料来源', selected: '等待选择文件', choosing: '正在选择文件', confirming: '请确认实际参与人',
  uploading: '正在上传文件', receiving: '正在提交校验任务', parsing: '正在校验资料', failed: '整批校验未通过',
  validated: '校验通过，待审核资料已生成', unknown: '提交结果待确认', stopped: '已停止本机等待',
};
const jobStates: Record<NonNullable<IntakeUploadView['job']>['state'], string> = {
  reading: '正在读取文件', parsing: '正在校验内容', validated: '校验通过', failed: '校验未通过', cancelled: '解析已终止',
};

/** This form keeps human choices only. Main owns the selected file, identities,
 * original write requests and candidate; no filesystem or HTTP input crosses it. */
export function IntakeUpload({ view, active = true, busy, blocked, refreshBlocked, stopping, apply }: {
  active?: boolean;
  view: IntakeUploadView; busy: boolean; blocked: boolean; refreshBlocked: boolean; stopping: boolean;
  apply: (command: IntakeUploadCommand) => void;
}) {
  const [preparer, setPreparer] = useState(view.preparerSelection ?? '');
  const [editors, setEditors] = useState<string[]>(view.editorSelections);
  const [confirmed, setConfirmed] = useState(false);
  const confirmation = useRef<ReturnType<typeof Modal.confirm> | null>(null);
  useEffect(() => () => { confirmation.current?.destroy(); confirmation.current = null; }, [active]);
  const declarationRevision = useRef(view.draftRevision);
  useEffect(() => {
    if (declarationRevision.current === view.draftRevision) return;
    declarationRevision.current = view.draftRevision;
    setPreparer(view.preparerSelection ?? ''); setEditors(view.editorSelections); setConfirmed(false);
    // A successful new native selection has a Main-owned revision, including
    // same-name/same-size corrections. Cancelled dialogs preserve the draft.
  }, [view.draftRevision, view.editorSelections, view.preparerSelection]);
  const readingDisabled = !active || busy || view.busy || stopping;
  const disabled = readingDisabled || blocked;
  const declaring = !!view.file && view.canSubmit;
  const ready = !!preparer && editors.length > 0 && confirmed;
  return <section className="intake-upload" aria-label="上传 FAQ 资料">
    <Space wrap className="intake-upload-row" size={8}>
      <Select aria-label="上传来源" value={view.sourceSelection ?? undefined} virtual={false} style={{ width: 280 }}
        placeholder="请选择有权维护的来源" disabled={disabled || !view.authorized || !!view.pending || !!view.file || !!view.revisionOf}
        onChange={selection => { if (selection) apply({ action: 'upload-source', selection }); }}
        options={view.sources.map(source => ({ value: source.selection, label: joinDisplayParts([domainWord[source.domain] ?? '', source.label]) }))} />
      <ActionButton disabled={disabled || !view.canChoose} onClick={() => apply({ action: 'upload-choose' })}>选择 CSV / Excel 文件</ActionButton>
      {(view.sourceSelection || view.canReset) && <ActionButton disabled={disabled || !view.canReset} onClick={() => {
        const run = () => apply({ action: 'upload-reset' });
        if (!view.file && !view.revisionOf) run();
        else confirmation.current = Modal.confirm({
          title: '请确认',
          content: '放弃本地上传准备？已经提交的服务端任务不会因此撤销，原资料也不会因此取消。',
          okText: '确认',
          cancelText: '取消',
          okButtonProps: { autoInsertSpace: false },
          cancelButtonProps: { autoInsertSpace: false },
          onOk: run,
          transitionName: '',
          maskTransitionName: '',
        });
      }}>{!view.authorized ? '清除本地上传准备' : view.revisionOf && view.phase !== 'validated' ? '放弃本地修订' : '重新选择来源'}</ActionButton>}
      <span className="intake-upload-state" role="status" aria-live="polite">{phases[view.phase]}{view.file ? `：${view.file.name}` : ''}</span>
    </Space>
    {view.revisionOf && <p className="intake-notice" role="status">{view.phase === 'validated' ? '已完成修订' : '正在准备修订'}：{view.revisionOf.candidateId}，原版本 {view.revisionOf.version}。请上传完整修订稿。</p>}
    {blocked && <p className="intake-notice">开始新的上传前，请完成当前审核并关闭，或在批次详情中放弃未提交的输入。</p>}
    {!view.authorized && <p>请核对登录与来源授权。</p>}
    {view.notice && <p role="status">{view.notice}</p>}
    {declaring && <fieldset className="intake-fields" disabled={disabled}>
      <legend>确认整理责任人与全部实际改稿人</legend>
      <p>请选择实际参与人。本人制作也须显式勾选本人；列入声明不会授予其操作权限。</p>
      <Form.Item label="整理责任人"><Select aria-label="整理责任人" value={preparer || undefined} placeholder="请选择整理责任人" disabled={disabled} virtual={false}
        onChange={value => { setPreparer(value); setConfirmed(false); }}
        options={view.principals.map(person => ({ value: person.selection, label: `${person.displayLabel}${person.enabled ? '' : '（当前未启用）'}` }))} /></Form.Item>
      <div className="intake-contributors" role="group" aria-label="全部实际改稿人">
        {view.principals.map(person => <Checkbox key={person.selection}
          aria-label={`实际改稿人 ${person.displayLabel}`} checked={editors.includes(person.selection)} onChange={event => {
            setEditors(current => event.target.checked ? [...current, person.selection] : current.filter(value => value !== person.selection)); setConfirmed(false);
          }}>{person.displayLabel}{!person.enabled && <small>（当前未启用，可记录历史参与）</small>}</Checkbox>)}
      </div>
      <Checkbox className="intake-confirmation" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}>我已核对整理责任人及全部实际改稿人</Checkbox>
      <ActionButton type="primary" disabled={!ready} onClick={() => apply({ action: 'upload-submit', preparerSelection: preparer, editorSelections: editors, confirmed: true })}>上传并校验</ActionButton>
    </fieldset>}
    {view.pending && <div className="intake-notice" role="status">
      <p>{view.pending === 'upload' ? '文件上传' : '校验任务提交'}结果尚未确定。重试沿用原文件和原请求，不会换一个操作编号。</p>
      <ActionButton disabled={disabled || !view.canRetry} onClick={() => apply({ action: 'upload-retry' })}>按原请求重试上传</ActionButton>
    </div>}
    <div className="intake-toolbar">
      {view.canStop && <ActionButton disabled={stopping} onClick={() => apply({ action: 'upload-stop' })}>停止本机等待</ActionButton>}
      {view.canRefresh && (!!view.file || !!view.job) && <ActionButton disabled={readingDisabled || refreshBlocked} onClick={() => apply({ action: 'upload-refresh' })}>刷新解析进度</ActionButton>}
      {view.canSaveReport && <ActionButton disabled={readingDisabled} onClick={() => apply({ action: 'upload-save-report' })}>保存完整错误报告</ActionButton>}
      {view.canOpen && <ActionButton disabled={disabled} onClick={() => apply({ action: 'upload-open' })}>审核本次资料</ActionButton>}
    </div>
    {(view.canStop || view.phase === 'stopped' || !!view.pending) && <p>停止本机等待不会撤销服务器已接收的任务。请继续核对原任务结果；生成待审核资料后再按其权限处理。</p>}
    {view.job && <section aria-label="资料校验结果">
      <h3>校验结果</h3>
      <p>最近读取的服务端状态：{jobStates[view.job.state]}。停止本机等待不会改变此状态。</p>
      <p>共 {view.job.totalIssues} 个问题，当前显示 {view.job.issues.length} 个。{view.job.totalIssues > view.job.issues.length && '完整问题请保存错误报告查看。'}</p>
      <p>已排除 {view.job.excludedSheetCount} 张说明或非业务工作表、{view.job.excludedMediaCount} 个媒体对象。</p>
      {view.job.issues.some(issue => issue.location.sheet === 'CSV') && <p>CSV 行号按记录计算，表头为第 1 行；引号内换行不另计一行。</p>}
      {view.job.issues.length > 0 && <Table
        pagination={false}
        size="small"
        rowKey={(issue) => `${issue.location.sheet}-${issue.location.row}-${issue.location.column}-${issue.message}`}
        dataSource={[...view.job.issues]}
        columns={[
          { title: '工作表', dataIndex: ['location', 'sheet'] },
          { title: '行 / 列', key: 'cell', render: (_value, issue) => `${issue.location.row} / ${issue.location.column}` },
          { title: '问题与修正建议', dataIndex: 'message' },
        ]}
      />}
      {view.job.state === 'failed' && <p>本批尚未生成待审核资料。请按报告修正资料中的全部阻断问题，再重新选择 CSV / Excel 文件。</p>}
    </section>}
  </section>;
}
