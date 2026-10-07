import type { components } from '@customer-agent/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntakeManagementCommand, IntakeManagementView, QualityPage } from '@shared/content-intake-management';
import { IntakeRollback } from './IntakeRollback';
import { IntakeUpload } from './IntakeUpload';
import './intake-management.css';
const states: Record<string, string> = { 'awaiting-evidence': '等待补证', ready: '候选就绪', publishing: '发布中', published: '已发布', cancelled: '已取消', invalidated: '已失效',
  confirmed: '来源已确认', creating: '审批创建结果待确认', pending: '等待组织审批', approved: '组织审批已通过', rejected: '组织审批未通过', revoked: '组织审批已撤回', unavailable: '审批服务暂不可用', unknown: '操作结果待确认', failed: '操作失败', not_frozen: '待冻结抽样', revision_required: '需要修订后重新检查', initial_required: '等待初检', expansion_required: '等待扩检', passed: '质量检查通过', blocked: '质量检查未通过' };
const readinessLabels: Record<string, string> = {
  SOURCE_MISMATCH: '来源已变更，请核对当前材料', BASE_CHANGED: '已发布版本已变更，请重新核对候选',
  SOURCE_CONFIRMATION_REQUIRED: '待确认来源版本', APPROVAL_REVOKED: '组织审批已撤回',
  APPROVAL_UNAVAILABLE: '审批结果需重新核验', AWAITING_APPROVAL: '待组织审批通过',
  PERMISSION_CHANGED: '复核人资格已变更，需重新核验',
};
const riskLabels: Record<components['schemas']['IntakeRisk']['level'], string> = { routine: '常规内容', critical: '关键变更' };
function readinessLabel(reason: string) {
  return Object.hasOwn(readinessLabels, reason) ? readinessLabels[reason] : '还有待核验事项，请刷新候选状态';
}
/** An instance can be bound before the first observation exists. The frozen
 * wire uses unavailable for both that state and a later provider failure. */
function stateLabel(state: string, review?: IntakeManagementView['review']) {
  if (state === 'unavailable') {
    if (!review || review.state !== state) return '审批结果尚未确认';
    if (review.instanceCode && review.checkedAt === null) return '尚未核验审批结果';
  }
  return states[state] ?? state;
}
function EntryDetails({ entry }: { entry: components['schemas']['IntakeEntry'] }) {
  return <details><summary>查看完整检查材料</summary><dl>
    <dt>条目 / 版本</dt><dd>{entry.businessEntryId} / {entry.scriptVersion}</dd>
    <dt>操作</dt><dd>{entry.operation === 'disable' ? '停用' : '新增或更新'}</dd>
    <dt>分类</dt><dd>{entry.category || '未填写'}</dd>
    <dt>适用说明</dt><dd>{entry.applicabilityNote || '未填写'}</dd>
    <dt>有效时间</dt><dd>{entry.effectiveFrom} 至 {entry.effectiveTo ?? '长期'}</dd>
    <dt>问题表达</dt><dd>{entry.questions.map(q => `${q.text}（${q.active ? '启用' : '停用'} · ${q.id} / ${q.version}）`).join('；') || '无'}</dd>
    <dt>商品 / 场景引用</dt><dd>{[...entry.productRefs, ...entry.scenarioRefs].map(r => `${r.id} / ${r.displayVersion}`).join('；') || '无'}</dd>
    <dt>内部说明</dt><dd>{entry.internalNote || '无'}</dd><dt>风险提示</dt><dd>{entry.riskNote || '无'}</dd>
    <dt>附件说明</dt><dd>{entry.attachmentNote || '无'}</dd>
    <dt>关联来源 / 条目</dt><dd>{entry.familySourceId ?? '无'} / {entry.familyBusinessEntryId ?? '无'}</dd>
    <dt>品牌不可覆盖</dt><dd>{entry.brandNonOverridable ? '是' : '否'}</dd>
  </dl></details>;
}
function CheckRow({ sample, disabled, save, onDirty }: { sample: QualityPage['samples'][number]; disabled: boolean; save: (c: IntakeManagementCommand) => void; onDirty: (id: string, dirty: boolean) => void }) {
  const saved = sample.check ?? sample.draft;
  const [choice, setChoice] = useState(saved ? saved.defect ? 'defect' : 'pass' : '');
  const [reason, setReason] = useState(saved?.reason ?? '');
  const dirty = choice !== (saved ? saved.defect ? 'defect' : 'pass' : '') || reason !== (saved?.reason ?? '');
  useEffect(() => { onDirty(sample.scriptId, dirty); return () => { onDirty(sample.scriptId, false); }; }, [dirty, onDirty, sample.scriptId]);
  return <article className="intake-card">
    <h3>{sample.entry.title} {sample.mandatory && <small>必检</small>}</h3>
    <p className="intake-answer">{sample.entry.answerText}</p>
    <EntryDetails entry={sample.entry} />
    {sample.check ? <p>已提交：{sample.check.defect ? '有缺陷' : '无缺陷'} {sample.check.reason}</p>
      : <fieldset disabled={disabled}>
        <legend>人工判断{sample.draft ? '（已暂存）' : '（尚未填写）'}</legend>
        <label>检查结论<select value={choice} onChange={e => setChoice(e.target.value)} aria-label={`检查结论 ${sample.entry.title}`}>
          <option value="">请选择</option><option value="pass">无缺陷</option><option value="defect">有缺陷</option>
        </select></label>
        <label>判断说明<textarea value={reason} onChange={e => setReason(e.target.value)} aria-label={`判断说明 ${sample.entry.title}`} /></label>
        <button disabled={!choice || (choice === 'defect' && !reason.trim()) || [...reason].length > 1000}
          onClick={() => save({ action: 'check', scriptId: sample.scriptId, defect: choice === 'defect', reason })}>保存本条判断</button>
      </fieldset>}
  </article>;
}
function CandidateWorkflow({ view, disabled, apply, onDirty }: { view: IntakeManagementView; disabled: boolean;
  apply: (command: IntakeManagementCommand) => void; onDirty: (id: string, dirty: boolean) => void }) {
  const [versionKind, setVersionKind] = useState<'integer' | 'opaque'>('opaque');
  const [versionValue, setVersionValue] = useState(''), [reason, setReason] = useState('');
  const [title, setTitle] = useState(''), [summary, setSummary] = useState('');
  const candidate = view.selected!, result = view.workflowResult;
  const mutable = ['awaiting-evidence', 'ready'].includes(candidate.state);
  const sourceDirty = !!versionValue || !!reason, publishDirty = !!title || !!summary;
  const canReplaceReview = !!view.review?.instanceCode && view.review.state !== 'creating';
  const sourceValid = !!versionValue.trim() && !!reason.trim() && [...versionValue].length <= 128 && [...reason].length <= 512
    && (versionKind !== 'integer' || /^(0|[1-9][0-9]{0,18})$/u.test(versionValue));
  useEffect(() => {
    onDirty('workflow-source', !!versionValue || !!reason);
    return () => onDirty('workflow-source', false);
  }, [versionValue, reason, onDirty]);
  useEffect(() => {
    onDirty('workflow-publish', !!title || !!summary);
    return () => onDirty('workflow-publish', false);
  }, [title, summary, onDirty]);
  useEffect(() => {
    if (result?.action === 'source-confirm' && result.state === 'confirmed') { setVersionValue(''); setReason(''); }
    if (result?.action === 'publish' && result.state === 'published') { setTitle(''); setSummary(''); }
  }, [result?.operationId, result?.action, result?.state]);
  return <section aria-label="来源审批与发布">
    <h2>来源确认</h2><p>已记录 {candidate.sourceEvidenceVersion} 次来源确认。请核对原资料版本与当前候选材料。</p>
    {view.canConfirmSource ? <fieldset disabled={disabled || view.hasDraft || publishDirty || !mutable || !view.material}>
      <legend>确认本次导出对应的来源版本</legend>
      {!view.material && <p>请先查看材料，核对本次上传内容。</p>}
      <label>来源版本类型<select aria-label="来源版本类型" value={versionKind} onChange={e => setVersionKind(e.target.value as 'integer' | 'opaque')}>
        <option value="opaque">版本标识</option><option value="integer">递增整数</option></select></label>
      <label>来源版本<input aria-label="来源版本" value={versionValue} onChange={e => setVersionValue(e.target.value)} /></label>
      <label>来源确认说明<textarea aria-label="来源确认说明" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p>版本最多 128 字；说明最多 512 字。递增整数须为 0 或不带前导零的正整数。</p>
      <button disabled={!sourceValid} onClick={() => apply({ action: 'confirm-source', versionKind, versionValue, reason })}>确认来源版本</button>
    </fieldset> : <p>当前没有此来源的确认权限。</p>}
    <h2>组织审批</h2><p>组织审核在飞书完成。此处发起审核并核验服务端返回的结果。</p>
    <div className="intake-toolbar">
      <button disabled={disabled || view.hasDraft || sourceDirty || publishDirty || !mutable || !candidate.sourceEvidenceVersion || (!!candidate.approvalEvidenceVersion && !canReplaceReview)}
        onClick={() => { if (!candidate.approvalEvidenceVersion || window.confirm('重新发起会生成新的审核记录，发布将以新记录为准。确认重新发起？')) apply({ action: 'request-review' }); }}>{candidate.approvalEvidenceVersion ? '重新发起组织审批' : '发起组织审批'}</button>
      <button disabled={disabled || !candidate.approvalEvidenceVersion} onClick={() => apply({ action: 'read-review' })}>读取审批状态</button>
      <button disabled={disabled || view.hasDraft || sourceDirty || publishDirty || !candidate.approvalEvidenceVersion} onClick={() => apply({ action: 'refresh-review' })}>刷新审批结果</button>
    </div>
    {!candidate.approvalEvidenceVersion && <p>尚未发起组织审批。</p>}
    {view.review && <div role="status"><p>{stateLabel(view.review.state, view.review)}{view.review.instanceCode ? ` · 审批编号 ${view.review.instanceCode}` : ''}</p>
      <p>最近核验：{view.review.checkedAt ?? '尚未核验'} · 核验有效至：{view.review.validUntil ?? '尚无有效核验'}</p>
      <p>上述结果为最近一次观察，发布时会再次核验。</p></div>}
    <h2>发布</h2><p>来源、审批与质量检查均满足要求后，由具备发布权限的人员提交。</p>
    {view.canPublish ? <fieldset disabled={disabled || view.hasDraft || sourceDirty || !view.material || candidate.state !== 'ready'}>
      <legend>本次发布说明</legend>
      <label>发布标题<input aria-label="发布标题" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>发布摘要<textarea aria-label="发布摘要" value={summary} onChange={e => setSummary(e.target.value)} /></label>
      <p>标题最多 256 字；摘要最多 2048 字。</p>
      <button disabled={!title.trim() || !summary.trim() || [...title].length > 256 || [...summary].length > 2048}
        onClick={() => apply({ action: 'publish', title, summary })}>发布当前候选</button>
    </fieldset> : <p>当前没有此来源的发布权限。</p>}
    {candidate.publishedReleaseId && <p role="status">当前候选已发布：{candidate.publishedReleaseId}。坐席重新查询后可读取新版本。</p>}
    {result && <p role="status">本次操作结果：{result.action === 'publish' && ['pending', 'unknown'].includes(result.state) ? '发布结果待确认' : stateLabel(result.state, view.review)}{result.releaseId ? ` · ${result.releaseId}` : ''}。这是操作记录；当前候选状态可单独刷新。</p>}
  </section>;
}
export function IntakeManagement() {
  const [view, setView] = useState<IntakeManagementView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uploadRequest, setUploadRequest] = useState(false), [stopping, setStopping] = useState(false);
  const generation = useRef(0), pending = useRef<number | null>(null);
  const stopPending = useRef(false);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const onDirty = useCallback((id: string, dirty: boolean) => setDirtyIds(previous => {
    if (previous.has(id) === dirty) return previous;
    const next = new Set(previous); if (dirty) next.add(id); else next.delete(id); return next;
  }), []);
  const apply = async (command?: IntakeManagementCommand) => {
    if (command?.action === 'upload-stop') {
      if (stopPending.current) return;
      stopPending.current = true; setStopping(true); const gen = ++generation.current;
      try {
        const reply = await window.dashboardIntake!.command(command);
        if (generation.current === gen) { setView(reply.view); setError(reply.ok ? '' : reply.message); }
      } catch { if (generation.current === gen) setError('停止请求尚未确认，请重新读取当前状态。服务器可能仍在处理原任务。'); }
      finally {
        // Main's stop acknowledgement releases local waiting. A late original
        // response must neither replace this view nor unlock a newer request.
        pending.current = null; setBusy(false); setUploadRequest(false);
        stopPending.current = false; setStopping(false);
      }
      return;
    }
    if (pending.current !== null || stopPending.current) return;
    setBusy(true); setError(''); const gen = ++generation.current; pending.current = gen;
    const uploading = command?.action.startsWith('upload-') ?? false; setUploadRequest(uploading);
    try {
      const api = window.dashboardIntake!;
      const reply = await (command ? api.command(command) : api.current());
      if (generation.current !== gen) return;
      setView(reply.view); if (!reply.ok) setError(reply.message);
    } catch {
      if (generation.current !== gen) return;
      if (uploading) {
        // Re-read Main's access-filtered projection before keeping form input.
        // A failed IPC reply alone cannot prove either success or revocation.
        try {
          const reply = await window.dashboardIntake!.current();
          if (generation.current === gen) { setView(reply.view); setError(reply.ok ? '本次操作未完整返回，已重新读取当前状态。请按当前提示继续。' : reply.message); }
        } catch { if (generation.current === gen) { setView(null); setError('管理服务不可用，请重新读取当前状态。'); } }
      } else { setView(null); setError('管理服务不可用，请刷新。'); }
    } finally {
      if (pending.current === gen) { pending.current = null; setBusy(false); setUploadRequest(false); }
    }
  };
  useEffect(() => {
    if (!busy || !uploadRequest) return;
    let active = true, reading = false;
    const gen = generation.current;
    // current() projects Main memory only. Keep stop/progress visible while the
    // original command is pending; never start overlapping HTTP refresh writes.
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const reply = await window.dashboardIntake!.current();
        if (active && generation.current === gen && reply.view) setView(reply.view);
      } catch { /* The original command owns its visible transport outcome. */ }
      finally { reading = false; }
    };
    void read(); const timer = window.setInterval(() => void read(), 250);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, uploadRequest]);
  useEffect(() => {
    const api = window.dashboardIntake!;
    const off = api.onInvalidated(() => {
      const gen = ++generation.current; setDirtyIds(new Set()); setView(null); setError('会话、权限或请求上下文已改变，请刷新。');
      // Preserve only a Main-owned unknown receipt handle, never the old material.
      void api.current().then(reply => { if (generation.current === gen) setView(reply.view); })
        .catch(() => { if (generation.current === gen) setView(null); });
    });
    void apply({ action: 'list', next: false });
    const invalidate = () => { generation.current++; };
    return () => { invalidate(); off(); };
  }, []);
  const upload = view?.upload;
  const disabled = busy || stopping || !!view?.rollback.pending || !!view?.pending || !!upload?.busy || !!upload?.pending;
  const uploadDraft = !!(upload?.file || upload?.revisionOf) && upload?.phase !== 'validated';
  const quality = view?.quality;
  const dirty = dirtyIds.size > 0;
  const qualityDirty = [...dirtyIds].some(id => id !== 'workflow-source' && id !== 'workflow-publish');
  const workflowDirty = dirtyIds.has('workflow-source') || dirtyIds.has('workflow-publish');
  const editable = quality?.status.state === (quality?.phase === 'initial' ? 'initial_required' : 'expansion_required');
  return <section className="intake-management" aria-label="FAQ 资料管理">
    <header><div><h1>资料审核</h1><p>上传 FAQ、核对候选材料并审核发布</p></div><span>{view?.displayName ?? (busy ? '正在读取会话…' : '会话待确认')}</span></header>
    {error && <div><p role="alert">{error}</p><button disabled={busy || stopping} onClick={() => void apply()}>重新读取当前状态</button></div>}
    {view?.signedIn && upload && <IntakeUpload view={upload} busy={busy} stopping={stopping}
      blocked={dirty || view.hasDraft || !!view.pending || !!view.rollback.pending || !!view.selected} refreshBlocked={dirty || view.hasDraft} apply={c => void apply(c)} />}
    {view?.signedIn && upload && (!upload.authorized || !!upload.pending) && <button disabled={busy || stopping}
      onClick={() => void apply({ action: 'list', next: false })}>刷新上传权限</button>}
    {view?.pending && <section className="intake-notice" aria-label="待恢复操作"><h2>操作结果待确认</h2>
      {view.pending.action === 'cancel' && <p>取消结果尚未确认。取得最终回执前，不能认定候选已经取消。</p>}
      <p>{view.pending.recovery === 'receipt' ? '请查询原操作回执。' : '请按原请求重试，继续确认本次操作结果。'}重试会沿用同一操作编号。</p><code>{view.pending.operationId}</code>
      <div>{view.pending.recovery === 'receipt' && <button disabled={busy} onClick={() => void apply({ action: 'recover' })}>查询原操作回执</button>}
        <button disabled={busy} onClick={() => void apply({ action: 'retry' })}>重试原操作</button></div></section>}
    {view?.signedIn && (view.rollback.available || view.rollback.pending) && <IntakeRollback view={view} busy={busy || stopping}
      blocked={!!view.pending || !!upload?.busy || !!upload?.pending || uploadDraft || view.hasDraft || [...dirtyIds].some(id => id !== 'rollback-input')}
      apply={c => void apply(c)} onDirty={onDirty} />}
    <div className="intake-toolbar"><button disabled={disabled || dirty || uploadDraft} onClick={() => void apply({ action: 'list', next: false })}>刷新候选</button>
      <button disabled={disabled || dirty || uploadDraft || !view?.moreCandidates} onClick={() => void apply({ action: 'list', next: true })}>下一页候选</button>
      {view?.selected && <button disabled={disabled} onClick={() => { if (window.confirm('放弃尚未提交的判断并关闭当前候选？')) void apply({ action: 'discard' }); }}>关闭当前候选</button>}</div>
    {view && !view.signedIn && <p>请先在查询窗口登录。</p>}
    {view?.signedIn && !view.authorized && !view.pending && <p>当前没有可用的资料管理权限，请确认登录身份与店铺授权。</p>}
    {view?.authorized && <>
      <section aria-label="候选列表"><h2>有权范围内的候选</h2>
        {!view.candidates.length && <p>这一页没有候选。</p>}
        <div className="intake-candidates">{view.candidates.map(row => <button key={row.selection} disabled={disabled || dirty || view.hasDraft || uploadDraft}
          onClick={() => void apply({ action: 'select', selection: row.selection })}>
          <strong>{row.candidate.sourceId}</strong><span>{states[row.candidate.state]} · 版本 {row.candidate.key.version}</span><small>{row.candidate.key.candidateId}</small>
        </button>)}</div></section>
      {dirty && <p role="status">当前有尚未提交的输入。请完成对应操作，或关闭当前候选并明确放弃。</p>}
      {view.selected && <section aria-label="当前候选"><h2>当前候选 · {view.selected.sourceId} · 版本 {view.selected.key.version}</h2>
        <p>{states[view.selected.state]} · {['awaiting-evidence','ready'].includes(view.selected.state)
          ? [...new Set(view.selected.readinessReasons.map(readinessLabel))].join(' / ') || '基础证据已齐备，发布仍须独立核验' : '此版本不再接受修改或发布。'}</p>
        {(view.canRevise || view.canCancel) && <div className="intake-toolbar">
          {view.canRevise && <button disabled={disabled || dirty || view.hasDraft} onClick={() => {
            if (window.confirm('修订当前候选？请上传完整修订稿。校验成功后旧版失效，新版须重新确认来源、审批和质量检查；校验失败保留旧版。')) void apply({ action: 'revise' });
          }}>修订当前候选</button>}
          {view.canCancel && <button className="intake-danger" disabled={disabled || dirty || view.hasDraft} onClick={() => {
            if (window.confirm('确认取消当前候选？取消成功后该版本不能再发布，已发布内容不受影响。这不是停止本机等待。')) void apply({ action: 'cancel-candidate' });
          }}>取消当前候选</button>}
        </div>}
        <div className="intake-toolbar"><button disabled={disabled} onClick={() => void apply({ action: 'refresh-candidate' })}>刷新候选状态</button>
          <button disabled={disabled} onClick={() => void apply({ action: 'material', next: false })}>查看材料</button>
          <button disabled={disabled || !view.material?.nextCursor} onClick={() => void apply({ action: 'material', next: true })}>下一页材料</button>
          {view.canReview && <><button disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'initial' })}>读取初检</button>
            <button disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'expanded' })}>读取扩检</button></>}</div>
        {view.material && <section aria-label="当前页材料与差异">
          <p>来源版本：{view.material.materialHeader.sourceClaim.versionValue ?? '尚未确认'} · 风险等级：{riskLabels[view.material.materialHeader.risk.level]}</p>
          {view.material.entries.map(entry => <article className="intake-card" key={entry.businessEntryId}><h3>{entry.title}</h3><p className="intake-answer">{entry.answerText}</p><EntryDetails entry={entry} /></article>)}
          <h3>当前页差异</h3>{view.material.differences.map(d => <p key={d.businessEntryId}>{d.businessEntryId} · {({ add: '新增', modify: '修改', disable: '停用', reenable: '重新启用' })[d.change]} · {d.previousVersion ?? '无前版'} → {d.nextVersion}</p>)}
        </section>}
        {quality && <section aria-label="人工质量检查"><h2>{states[quality.status.state] ?? quality.status.state}</h2><p>本轮 {quality.total} 条 · 已填写 {quality.checked} 条</p>
          {!quality.status.frozen && <button disabled={disabled || workflowDirty} onClick={() => void apply({ action: 'freeze' })}>冻结本次抽样</button>}
          <div className="intake-toolbar"><button disabled={disabled || dirty || quality.offset === 0} onClick={() => void apply({ action: 'quality-page', offset: Math.max(0, quality.offset - 20) })}>上一页检查</button>
            <button disabled={disabled || dirty || quality.offset + 20 >= quality.total} onClick={() => void apply({ action: 'quality-page', offset: quality.offset + 20 })}>下一页检查</button></div>
          {quality.samples.map(sample => <CheckRow key={`${view.selected!.key.digest}-${quality.phase}-${quality.offset}-${sample.scriptId}`} sample={sample}
            disabled={disabled || workflowDirty || !editable} onDirty={onDirty} save={c => void apply(c)} />)}
          <button disabled={disabled || dirty || quality.checked !== quality.total || !editable}
            onClick={() => void apply({ action: 'submit' })}>提交本轮人工检查</button>
        </section>}
        <CandidateWorkflow key={view.selected.key.digest} view={view} disabled={disabled || qualityDirty} apply={c => void apply(c)} onDirty={onDirty} />
        {view.receipt && <p role="status">操作回执：{states[view.receipt.state] ?? view.receipt.state}。这是本次操作记录，请重新读取检查状态。</p>}
      </section>}
    </>}
  </section>;
}
