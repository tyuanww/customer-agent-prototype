import { useEffect, useRef, useState } from 'react';
import type { IntakeUploadCommand, IntakeUploadView } from '@shared/content-intake-upload';

const phases: Record<IntakeUploadView['phase'], string> = {
  idle: '请选择资料来源', selected: '等待选择文件', choosing: '正在选择文件', confirming: '请确认实际参与人',
  uploading: '正在上传文件', receiving: '正在提交校验任务', parsing: '正在校验工作簿', failed: '整批校验未通过',
  validated: '校验通过，候选已形成', unknown: '提交结果待确认', stopped: '已停止本机等待',
};
const jobStates: Record<NonNullable<IntakeUploadView['job']>['state'], string> = {
  reading: '正在读取文件', parsing: '正在校验内容', validated: '校验通过', failed: '校验未通过', cancelled: '解析已终止',
};

/** This form keeps human choices only. Main owns the selected file, identities,
 * original write requests and candidate; no filesystem or HTTP input crosses it. */
export function IntakeUpload({ view, busy, blocked, refreshBlocked, stopping, apply }: {
  view: IntakeUploadView; busy: boolean; blocked: boolean; refreshBlocked: boolean; stopping: boolean;
  apply: (command: IntakeUploadCommand) => void;
}) {
  const [preparer, setPreparer] = useState(view.preparerSelection ?? '');
  const [editors, setEditors] = useState<string[]>(view.editorSelections);
  const [confirmed, setConfirmed] = useState(false);
  const declarationRevision = useRef(view.draftRevision);
  useEffect(() => {
    if (declarationRevision.current === view.draftRevision) return;
    declarationRevision.current = view.draftRevision;
    setPreparer(view.preparerSelection ?? ''); setEditors(view.editorSelections); setConfirmed(false);
    // A successful new native selection has a Main-owned revision, including
    // same-name/same-size corrections. Cancelled dialogs preserve the draft.
  }, [view.draftRevision, view.editorSelections, view.preparerSelection]);
  const readingDisabled = busy || view.busy || stopping;
  const disabled = readingDisabled || blocked;
  const declaring = !!view.file && view.canSubmit;
  const ready = !!preparer && editors.length > 0 && confirmed;
  return <section className="intake-upload" aria-label="上传 FAQ 资料">
    <h2>上传 FAQ 资料</h2>
    <p>使用统一 Excel 模板。缺少某行不会删除已发布资料；有阻断错误时，请整批修正后重新选择文件。</p>
    {blocked && <p className="intake-notice">开始新的上传前，请先完成当前候选中的输入并关闭候选，或关闭时明确放弃尚未提交的输入。</p>}
    {!view.authorized && <p>当前没有可上传的来源，请核对登录身份与来源授权。</p>}
    <label>上传来源<select aria-label="上传来源" value={view.sourceSelection ?? ''}
      disabled={disabled || !view.authorized || !!view.pending || !!view.file}
      onChange={event => { if (event.target.value) apply({ action: 'upload-source', selection: event.target.value }); }}>
      <option value="">请选择有权维护的来源</option>
      {view.sources.map(source => <option key={source.selection} value={source.selection}>{source.label}</option>)}
    </select></label>
    <div className="intake-toolbar">
      <button disabled={disabled || !view.canChoose} onClick={() => apply({ action: 'upload-choose' })}>选择 Excel 文件</button>
      {view.sourceSelection && <button disabled={disabled || !!view.pending} onClick={() => {
        if (!view.file || window.confirm('放弃本地上传准备并重新选择来源？已经提交的服务端任务不会因此撤销。')) apply({ action: 'upload-reset' });
      }}>重新选择来源</button>}
    </div>
    {view.file && <p className="intake-file">已选择：<strong>{view.file.name}</strong> · {(view.file.bytes / 1024).toFixed(1)} KB</p>}
    <p className="intake-upload-state" role="status" aria-live="polite">{phases[view.phase]}</p>
    {view.notice && <p role="status">{view.notice}</p>}
    {declaring && <fieldset disabled={disabled}>
      <legend>确认整理责任人与全部实际改稿人</legend>
      <p>请选择实际参与人。本人制作也须显式勾选本人；列入声明不会授予其操作权限。</p>
      <label>整理责任人<select aria-label="整理责任人" value={preparer} onChange={event => { setPreparer(event.target.value); setConfirmed(false); }}>
        <option value="">请选择整理责任人</option>
        {view.principals.map(person => <option key={person.selection} value={person.selection}>{person.displayLabel}{person.enabled ? '' : '（当前未启用）'}</option>)}
      </select></label>
      <div className="intake-contributors" role="group" aria-label="全部实际改稿人">
        {view.principals.map(person => <label key={person.selection}>
          <input type="checkbox" aria-label={`实际改稿人 ${person.displayLabel}`} checked={editors.includes(person.selection)} onChange={event => {
            setEditors(current => event.target.checked ? [...current, person.selection] : current.filter(value => value !== person.selection)); setConfirmed(false);
          }} />
          <span>{person.displayLabel}{!person.enabled && <small>（当前未启用，可记录历史参与）</small>}</span>
        </label>)}
      </div>
      <label className="intake-confirmation"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>我已核对整理责任人及全部实际改稿人</span></label>
      <button className="intake-primary" disabled={!ready} onClick={() => apply({ action: 'upload-submit', preparerSelection: preparer, editorSelections: editors, confirmed: true })}>上传并校验</button>
    </fieldset>}
    {view.pending && <div className="intake-notice" role="status">
      <p>{view.pending === 'upload' ? '文件上传' : '校验任务提交'}结果尚未确定。重试沿用原文件和原请求，不会换一个操作编号。</p>
      <button disabled={disabled || !view.canRetry} onClick={() => apply({ action: 'upload-retry' })}>按原请求重试上传</button>
    </div>}
    <div className="intake-toolbar">
      {view.canStop && <button disabled={stopping} onClick={() => apply({ action: 'upload-stop' })}>停止本机等待</button>}
      {view.canRefresh && <button disabled={readingDisabled || refreshBlocked} onClick={() => apply({ action: 'upload-refresh' })}>刷新解析进度</button>}
      {view.canSaveReport && <button disabled={readingDisabled} onClick={() => apply({ action: 'upload-save-report' })}>保存完整错误报告</button>}
      {view.canOpen && <button className="intake-primary" disabled={disabled} onClick={() => apply({ action: 'upload-open' })}>打开候选继续审核</button>}
    </div>
    {(view.canStop || view.phase === 'stopped' || !!view.pending) && <p>停止本机等待不会撤销服务器已接收的任务。请继续核对原任务结果；形成候选后再按其权限处理。</p>}
    {view.job && <section aria-label="工作簿校验结果">
      <h3>校验结果</h3>
      <p>最近读取的服务端状态：{jobStates[view.job.state]}。停止本机等待不会改变此状态。</p>
      <p>共 {view.job.totalIssues} 个问题，当前显示 {view.job.issues.length} 个。{view.job.totalIssues > view.job.issues.length && '完整问题请保存错误报告查看。'}</p>
      <p>已排除 {view.job.excludedSheetCount} 张说明或非业务工作表、{view.job.excludedMediaCount} 个媒体对象。</p>
      {view.job.issues.length > 0 && <div className="intake-issues"><table><caption>问题位置与修正建议</caption>
        <thead><tr><th scope="col">工作表</th><th scope="col">行 / 列</th><th scope="col">问题与修正建议</th></tr></thead>
        <tbody>{view.job.issues.map((issue, index) => <tr key={`${issue.location.sheet}-${issue.location.row}-${issue.location.column}-${index}`}>
          <th scope="row">{issue.location.sheet}</th><td>{issue.location.row} / {issue.location.column}</td><td>{issue.message}</td>
        </tr>)}</tbody></table></div>}
      {view.job.state === 'failed' && <p>本批尚未形成可审批候选。请按报告修正工作簿中的全部阻断问题，再重新选择 Excel 文件。</p>}
    </section>}
  </section>;
}
