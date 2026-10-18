import type { components } from '@customer-agent/contracts';
import { Button, Empty, Input, Modal, Segmented, Select, Table, type ButtonProps, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { IntakeManagementCommand, IntakeManagementView, QualityPage } from '@shared/content-intake-management';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import { IntakeAntdTheme } from './intake-antd';
import { IntakeRollback } from './IntakeRollback';
import { IntakeUpload } from './IntakeUpload';
import { formatSeatClock } from './intake-time';
import './intake-management.css';

function askConfirm(content: string, onOk: () => void) {
  Modal.confirm({
    title: '请确认',
    content,
    okText: '确认',
    cancelText: '取消',
    okButtonProps: { autoInsertSpace: false },
    cancelButtonProps: { autoInsertSpace: false },
    onOk,
    transitionName: '',
    maskTransitionName: '',
  });
}

function ActionButton(props: ButtonProps) {
  return <Button autoInsertSpace={false} {...props} />;
}
type CandidateRow = IntakeManagementView['candidates'][number];
const domainWord: Record<string, string> = { product: '产品', campaign: '活动', presale: '售前', aftersale: '售后' };
function scopeWording(scopeLabel: string | undefined, sourceId: string, domain?: string) {
  const label = scopeLabel?.trim() ?? '';
  const word = domain ? domainWord[domain] : undefined;
  const fallback = word ? `该店铺 · ${word} · 该来源` : '该店铺 · 该来源';
  if (!label || label === '—' || label === sourceId || label.startsWith('source-')) return fallback;
  const parts = label.split(' · ');
  const head = parts[0] ?? '';
  if (parts.length >= 2 && !/[\u3400-\u9fff]/.test(head)) return ['该店铺', ...parts.slice(1)].join(' · ');
  return label;
}
function candidateTitle(scopeLabel: string | undefined, version: number, sourceId: string, domain?: string) {
  return `${scopeWording(scopeLabel, sourceId, domain)} 第 ${version} 版`;
}
function differenceTitle(entries: { businessEntryId: string; title: string }[], businessEntryId: string) {
  const title = entries.find(entry => entry.businessEntryId === businessEntryId)?.title.trim();
  return title || '未命名条目';
}
const states: Record<string, string> = { 'awaiting-evidence': '等待补证', ready: '候选就绪', publishing: '发布中', published: '已发布', cancelled: '已取消', invalidated: '已失效',
  confirmed: '来源已确认', creating: '审批创建结果待确认', pending: '等待组织审批', approved: '组织审批已通过', rejected: '组织审批未通过', revoked: '组织审批已撤回', unavailable: '审批服务暂不可用', unknown: '操作结果待确认', failed: '操作失败', not_frozen: '待冻结抽样', revision_required: '需要修订后重新检查', initial_required: '等待初检', expansion_required: '等待扩检', passed: '质量检查通过', blocked: '质量检查未通过' };
const readinessLabels: Record<string, string> = {
  SOURCE_MISMATCH: '来源已变更，请核对当前材料', BASE_CHANGED: '已发布版本已变更，请重新核对候选',
  SOURCE_CONFIRMATION_REQUIRED: '待确认来源版本', APPROVAL_REVOKED: '组织审批已撤回',
  APPROVAL_UNAVAILABLE: '审批结果需重新核验', AWAITING_APPROVAL: '待组织审批通过',
  PERMISSION_CHANGED: '当前资格已变更，请刷新并核对权限',
  QUALITY_NOT_PASSED: '待完成质量检查',
};
const riskLabels: Record<components['schemas']['IntakeRisk']['level'], string> = { routine: '常规内容', critical: '关键变更' };
function readinessLabel(reason: string) {
  return Object.hasOwn(readinessLabels, reason) ? readinessLabels[reason] : '还有待核验事项，请刷新候选状态';
}
function workflowPane(target: string | undefined, policy: string | undefined): 'source' | 'publish' | 'legacy' | 'none' {
  if (target === 'source') return 'source';
  if (target === 'publish') return 'publish';
  if (target === 'candidate' && policy === 'approval-v1') return 'legacy';
  return 'none';
}
function MaterialPage({ material, disabled, apply }: { material: NonNullable<IntakeManagementView['material']>; disabled: boolean; apply: (command: IntakeManagementCommand) => void }) {
  return <section aria-label="当前页材料与差异">
    <p>来源版本：{material.materialHeader.sourceClaim.versionValue ?? '尚未确认'} · 风险等级：{riskLabels[material.materialHeader.risk.level]}</p>
    <ActionButton disabled={disabled || !material.nextCursor} onClick={() => apply({ action: 'material', next: true })}>下一页材料</ActionButton>
    {material.entries.map(entry => <article className="intake-card" key={entry.businessEntryId}><h3>{entry.title}</h3><p className="intake-answer">{entry.answerText}</p><EntryDetails entry={entry} /></article>)}
    <h3>当前页差异</h3>{material.differences.map(difference => <p key={difference.businessEntryId}>{differenceTitle(material.entries, difference.businessEntryId)} · {({ add: '新增', modify: '修改', disable: '停用', reenable: '重新启用' })[difference.change]} · {difference.previousVersion ?? '无前版'} → {difference.nextVersion}</p>)}
  </section>;
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
    <dt>条目 / 版本</dt><dd>{entry.title} / {entry.scriptVersion}</dd>
    <dt>操作</dt><dd>{entry.operation === 'disable' ? '停用' : '新增或更新'}</dd>
    <dt>分类</dt><dd>{entry.category || '未填写'}</dd>
    <dt>适用说明</dt><dd>{entry.applicabilityNote || '未填写'}</dd>
    <dt>有效时间</dt><dd>{formatSeatClock(entry.effectiveFrom)} 至 {entry.effectiveTo ? formatSeatClock(entry.effectiveTo) : '长期'}</dd>
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
        <label>检查结论<Select aria-label={`检查结论 ${sample.entry.title}`} value={choice || undefined} placeholder="请选择" disabled={disabled}
          virtual={false} style={{ width: 160 }} onChange={value => setChoice(value)}
          options={[{ value: 'pass', label: '无缺陷' }, { value: 'defect', label: '有缺陷' }]} /></label>
        <label>判断说明<Input.TextArea value={reason} onChange={e => setReason(e.target.value)} aria-label={`判断说明 ${sample.entry.title}`} autoSize={{ minRows: 2, maxRows: 6 }} /></label>
        <ActionButton disabled={!choice || (choice === 'defect' && !reason.trim()) || [...reason].length > 1000}
          onClick={() => save({ action: 'check', scriptId: sample.scriptId, defect: choice === 'defect', reason })}>保存本条判断</ActionButton>
      </fieldset>}
  </article>;
}
function CandidateWorkflow({ view, disabled, apply, onDirty, sectionId, open, children }: { view: IntakeManagementView; disabled: boolean;
  sectionId: string; open: 'source' | 'publish' | 'legacy' | 'none'; children: ReactNode;
  apply: (command: IntakeManagementCommand) => void; onDirty: (id: string, dirty: boolean) => void }) {
  const [versionKind, setVersionKind] = useState<'integer' | 'opaque'>('opaque');
  const [versionValue, setVersionValue] = useState(''), [reason, setReason] = useState('');
  const [title, setTitle] = useState(''), [summary, setSummary] = useState('');
  const candidate = view.selected!, result = view.workflowResult;
  const mutable = ['awaiting-evidence', 'ready'].includes(candidate.state);
  const sourceDirty = !!versionValue || !!reason, publishDirty = !!title || !!summary;
  const legacy = candidate.publicationPolicy === 'approval-v1';
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
  return <section aria-label="来源确认与发布">
    <div hidden={open !== 'source'}>
    <h2 id={`${sectionId}-source`} tabIndex={-1}>2. 确认来源</h2><p>已记录 {candidate.sourceEvidenceVersion} 次来源确认。请核对原资料版本与当前候选材料。</p>
    {view.material && <MaterialPage material={view.material} disabled={disabled} apply={apply} />}
    {view.canConfirmSource ? <fieldset disabled={disabled || view.hasDraft || publishDirty || !mutable || !view.material}>
      <legend>确认本次导出对应的来源版本</legend>
      {!view.material && <p>请先查看材料，核对本次上传内容。</p>}
      <label>来源版本类型<Select aria-label="来源版本类型" value={versionKind} virtual={false} style={{ width: 160 }}
        onChange={value => { if (value === 'integer' || value === 'opaque') setVersionKind(value); }}
        options={[{ value: 'opaque', label: '版本标识' }, { value: 'integer', label: '递增整数' }]} /></label>
      <label>来源版本<Input aria-label="来源版本" value={versionValue} onChange={e => setVersionValue(e.target.value)} /></label>
      <label>来源确认说明<Input.TextArea aria-label="来源确认说明" value={reason} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setReason(e.target.value)} /></label>
      <p>版本最多 128 字；说明最多 512 字。递增整数须为 0 或不带前导零的正整数。</p>
      <ActionButton type="primary" disabled={!sourceValid} onClick={() => apply({ action: 'confirm-source', versionKind, versionValue, reason })}>确认来源版本</ActionButton>
    </fieldset> : <p>当前没有此来源的确认权限。</p>}
    </div>
    {legacy && <section hidden={open !== 'legacy'} aria-label="历史审批记录"><h2>历史审批记录</h2>
      <p>这是旧审批流程的候选。首次确认直发须显式修订或重新导入，不能直接转换；已发布历史保留原审核记录。</p>
      <ActionButton disabled={disabled || !candidate.approvalEvidenceVersion} onClick={() => apply({ action: 'read-review' })}>读取历史审批</ActionButton>
      {view.review && <div role="status"><p>{stateLabel(view.review.state, view.review)}{view.review.instanceCode ? ` · 审批编号 ${view.review.instanceCode}` : ''}</p>
        <p>历史核验：{view.review.checkedAt ? formatSeatClock(view.review.checkedAt) : '尚未核验'} · 有效至：{view.review.validUntil ? formatSeatClock(view.review.validUntil) : '尚无有效核验'}。此处只读，不延长有效期。</p></div>}
    </section>}
    {children}
    <div hidden={open !== 'publish'}>
    <h2 id={`${sectionId}-publish`} tabIndex={-1}>4. 确认发布</h2><p>来源与质量检查满足要求后，由具备发布权限的人员确认发布。点击发布将弹窗再次确认。</p>
    {view.canPublish ? <fieldset disabled={disabled || view.hasDraft || sourceDirty || !view.material || legacy || candidate.state !== 'ready'}>
      <legend>本次发布说明</legend>
      <label>发布标题<Input aria-label="发布标题" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>发布摘要<Input.TextArea aria-label="发布摘要" value={summary} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setSummary(e.target.value)} /></label>
      <p>标题最多 256 字；摘要最多 2048 字。</p>
      <ActionButton type="primary" disabled={!title.trim() || !summary.trim() || [...title].length > 256 || [...summary].length > 2048}
        onClick={() => apply({ action: 'publish', title, summary })}>发布当前候选</ActionButton>
    </fieldset> : <p>当前没有此来源的发布权限。</p>}
    </div>
    {(candidate.state === 'published' || candidate.publishedReleaseId) && <div role="status"><p>已发布。</p>
      {candidate.publishedReleaseId ? <p>{candidate.publishedReleaseId}</p> : null}<p>坐席重新查询后可读取新版本。</p></div>}
    {result && <div role="status"><p>本次操作结果：{result.action === 'publish' && ['pending', 'unknown'].includes(result.state) ? '发布结果待确认' : stateLabel(result.state, view.review)}。</p>
      {result.releaseId ? <p>{result.releaseId}</p> : null}<p>这是操作记录；当前候选状态可单独刷新。</p></div>}
  </section>;
}
/** Navigation advice only. Main/API continue to own every operation's eligibility. */
function currentStep(view: IntakeManagementView, dirtyIds: Set<string>): { title: string; detail: string; target: string } {
  if (view.pending) return { title: '确认上次操作结果', detail: '先取得原操作的结果，再继续处理当前资料。', target: 'recovery' };
  const candidate = view.selected!;
  if (!['awaiting-evidence', 'ready'].includes(candidate.state)) return { title: stateLabel(candidate.state), detail: '请查看当前候选状态与操作记录。', target: 'candidate' };
  if (candidate.publicationPolicy === 'approval-v1') return { title: '先修订或重新导入旧候选', detail: '旧审批记录继续保留；直接发布需要新的候选及检查。', target: 'candidate' };
  if (dirtyIds.has('workflow-source')) return { title: '完成来源确认', detail: '请提交当前填写的来源版本和确认说明，或清空这些输入。', target: 'source' };
  if (dirtyIds.has('workflow-publish')) return { title: '完成发布说明', detail: '请核对当前标题和摘要。点击发布后，还需在弹窗中再次确认。', target: 'publish' };
  if (dirtyIds.size || view.hasDraft) return { title: '完成本轮质量检查', detail: '先保存各条判断，再提交本轮检查。已暂存的判断还没有完成提交。', target: 'quality' };
  if (!view.material) return { title: '1. 核对材料', detail: '先查看当前候选的内容和差异，再确认它对应的来源版本。', target: 'material' };
  if (!candidate.sourceEvidenceVersion) return { title: '2. 确认来源', detail: view.canConfirmSource ? '填写本次导出的来源版本，并说明核对结果。' : '需要有此来源确认权限的人员完成核对。', target: 'source' };
  if (candidate.state === 'ready') return { title: '4. 确认发布', detail: view.canPublish ? '填写发布标题和摘要；点击发布后，弹窗会要求再次确认。' : '当前候选就绪，需要有此来源发布权限的人员操作。', target: 'publish' };
  if (view.receipt && !view.quality) return { title: '读取最新检查状态', detail: '已收到本次操作回执。请重新读取初检或扩检，核对当前结果。', target: 'quality' };
  const state = view.quality?.status.state;
  if (state === 'blocked' || state === 'revision_required') return { title: '修订后重新检查', detail: '本次质量检查未通过，请修订资料后重新上传和检查。', target: 'quality' };
  if (state === 'passed' || candidate.readinessReasons.some(reason => !['SOURCE_CONFIRMATION_REQUIRED', 'QUALITY_NOT_PASSED'].includes(reason))) {
    return { title: '核对候选状态', detail: '请刷新候选状态，并处理下方提示的待核验事项。', target: 'candidate' };
  }
  return { title: '3. 完成质量检查', detail: !view.canReview ? '需要有此来源检查权限的人员完成本轮检查。'
    : state === 'expansion_required' ? '读取扩检，逐条保存人工判断，再提交本轮检查。'
      : '读取初检并确定抽样范围，逐条保存人工判断，再提交本轮检查。', target: 'quality' };
}
type CandidateFilter = 'open' | 'published' | 'all';
function isOpenCandidate(state: string) {
  return state === 'awaiting-evidence' || state === 'ready' || state === 'publishing';
}
function candidateVisible(state: string, filter: CandidateFilter, selected: boolean) {
  if (selected) return true;
  if (filter === 'all') return true;
  if (filter === 'published') return state === 'published';
  return isOpenCandidate(state);
}
function listNext(candidate: components['schemas']['IntakeCandidate']) {
  if (candidate.state === 'publishing') return states.publishing;
  if (candidate.publicationPolicy === 'approval-v1' && isOpenCandidate(candidate.state)) return '先修订或重新导入旧候选';
  if (!isOpenCandidate(candidate.state)) return states[candidate.state] ?? candidate.state;
  if (!candidate.sourceEvidenceVersion) return '核对材料';
  if (candidate.state === 'ready') return '确认发布';
  return '质量检查';
}
function sameCandidate(candidate: components['schemas']['IntakeCandidate'], selected: components['schemas']['IntakeCandidate'] | null) {
  return !!selected && candidate.key.candidateId === selected.key.candidateId && candidate.key.version === selected.key.version && candidate.sourceId === selected.sourceId;
}
export function IntakeManagement() {
  const sectionId = useId();
  const [view, setView] = useState<IntakeManagementView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uploadRequest, setUploadRequest] = useState(false), [stopping, setStopping] = useState(false);
  const generation = useRef(0), pending = useRef<number | null>(null);
  const stopPending = useRef(false);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('open');
  const [rollbackFocus, setRollbackFocus] = useState(0);
  const onDirty = useCallback((id: string, dirty: boolean) => setDirtyIds(previous => {
    if (previous.has(id) === dirty) return previous;
    const next = new Set(previous); if (dirty) next.add(id); else next.delete(id); return next;
  }), []);
  const apply = async (command?: IntakeManagementCommand) => {
    if (command?.action === 'upload-stop') {
      if (stopPending.current) return;
      if (!window.dashboardIntake) {
        setError(WORKBENCH_EMPTY.intakeUnmounted);
        return;
      }
      stopPending.current = true; setStopping(true); const gen = ++generation.current;
      try {
        const reply = await window.dashboardIntake.command(command);
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
    if (!window.dashboardIntake) {
      setView(null);
      setError(WORKBENCH_EMPTY.intakeUnmounted);
      setBusy(false);
      return;
    }
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
    const api = window.dashboardIntake;
    if (!api) {
      setView(null);
      setError(WORKBENCH_EMPTY.intakeUnmounted);
      return undefined;
    }
    const off = api.onInvalidated(() => {
      const gen = ++generation.current; setDirtyIds(new Set()); setView(null); setError('请重新读取当前状态。');
      // Preserve only a Main-owned unknown receipt handle, never the old material.
      void api.current().then(reply => { if (generation.current === gen) setView(reply.view); })
        .catch(() => { if (generation.current === gen) setView(null); });
    });
    void apply({ action: 'list', next: false });
    const invalidate = () => { generation.current++; };
    return () => { invalidate(); pending.current = null; off(); };
  }, []);
  useEffect(() => {
    if (rollbackFocus === 0) return;
    const region = document.querySelector<HTMLElement>('[aria-label="已发布目录纠正回退"]');
    if (!region) return;
    region.focus();
    if (typeof region.scrollIntoView === 'function') region.scrollIntoView({ block: 'start' });
  }, [rollbackFocus, view?.selected]);
  const upload = view?.upload;
  const disabled = busy || stopping || !!view?.rollback.pending || !!view?.pending || !!upload?.busy || !!upload?.pending;
  const uploadDraft = !!(upload?.file || upload?.revisionOf) && upload?.phase !== 'validated';
  const quality = view?.quality;
  const dirty = dirtyIds.size > 0;
  const qualityDirty = [...dirtyIds].some(id => id !== 'workflow-source' && id !== 'workflow-publish');
  const workflowDirty = dirtyIds.has('workflow-source') || dirtyIds.has('workflow-publish');
  const editable = quality?.status.state === (quality?.phase === 'initial' ? 'initial_required' : 'expansion_required');
  const step = view?.authorized && view.selected && !view.rollback.pending && !view.rollback.impact && !dirtyIds.has('rollback-input')
    ? currentStep(view, dirtyIds) : null;
  const visibleCandidates = (view?.candidates ?? []).filter(row => candidateVisible(row.candidate.state, candidateFilter, sameCandidate(row.candidate, view?.selected ?? null)));
  const rowDisabled = disabled || dirty || !!view?.hasDraft || uploadDraft;
  const candidateColumns: TableColumnsType<CandidateRow> = [
    { title: '名称', key: 'name', render: (_value, row) => <>
      <ActionButton type="text" disabled={rowDisabled} onClick={() => void apply({ action: 'select', selection: row.selection })}>{candidateTitle(row.scopeLabel, row.candidate.key.version, row.candidate.sourceId)}</ActionButton>
      {row.candidate.state === 'published' && <ActionButton type="text" disabled={rowDisabled} onClick={() => { setRollbackFocus(focus => focus + 1); void apply({ action: 'select', selection: row.selection }); }}>回退</ActionButton>}
    </> },
    { title: '范围', key: 'scope', render: (_value, row) => scopeWording(row.scopeLabel, row.candidate.sourceId) },
    { title: '状态', key: 'state', render: (_value, row) => states[row.candidate.state] ?? row.candidate.state },
    { title: '下一步', key: 'next', render: (_value, row) => {
      const current = sameCandidate(row.candidate, view?.selected ?? null);
      return current && step ? step.title : listNext(row.candidate);
    } },
    { title: '时间', key: 'time', render: (_value, row) => formatSeatClock(row.candidate.updatedAt) },
  ];
  return <IntakeAntdTheme><section className="intake-management" aria-label="FAQ 资料管理">
    <header><div><h1>资料管理</h1><p>上传后核对并发布</p></div><span>{view?.displayName ?? (busy ? '正在读取会话…' : '会话待确认')}</span></header>
    {error && <div><p role="alert">{error}</p><ActionButton disabled={busy || stopping} onClick={() => void apply()}>重新读取当前状态</ActionButton></div>}
    {step && <section className="intake-notice intake-current-step" aria-label="当前步骤">
      <div><h2>{step.title}</h2><p>{step.detail}</p><small>核对材料 → 确认来源 → 质量检查 → 确认发布</small></div>
      <ActionButton onClick={() => {
        const target = document.getElementById(`${sectionId}-${step.target}`);
        target?.focus(); target?.scrollIntoView({ block: 'start' });
      }}>前往当前步骤</ActionButton>
    </section>}
    {view?.signedIn && upload && <IntakeUpload view={upload} busy={busy} stopping={stopping}
      blocked={dirty || view.hasDraft || !!view.pending || !!view.rollback.pending || !!view.selected} refreshBlocked={dirty || view.hasDraft} apply={c => void apply(c)} />}
    {view?.signedIn && upload && (!upload.authorized || !!upload.pending) && <ActionButton disabled={busy || stopping}
      onClick={() => void apply({ action: 'list', next: false })}>刷新上传权限</ActionButton>}
    {view?.pending && <section className="intake-notice" aria-label="待恢复操作"><h2 id={`${sectionId}-recovery`} tabIndex={-1}>操作结果待确认</h2>
      {view.pending.action === 'cancel' && <p>取消结果尚未确认。取得最终回执前，不能认定候选已经取消。</p>}
      <p>{view.pending.recovery === 'receipt' ? '请查询原操作回执。' : '请按原请求重试，继续确认本次操作结果。'}重试会沿用同一操作编号。</p><code>{view.pending.operationId}</code>
      <div className="intake-toolbar">{view.pending.recovery === 'receipt' && <ActionButton disabled={busy} onClick={() => void apply({ action: 'recover' })}>查询原操作回执</ActionButton>}
        {view.pending.retryAllowed !== false && <ActionButton disabled={busy} onClick={() => void apply({ action: 'retry' })}>重试原操作</ActionButton>}
        {view.pending.retryAllowed === false && <p>旧流程操作不能转成确认直发，请查询原回执或读取历史状态。</p>}</div></section>}
    {view?.signedIn && (view.rollback.pending || !!view.rollback.impact || (view.rollback.available && view.selected?.state === 'published')) && <IntakeRollback view={view} busy={busy || stopping}
      blocked={!!view.pending || !!upload?.busy || !!upload?.pending || uploadDraft || view.hasDraft || [...dirtyIds].some(id => id !== 'rollback-input')}
      apply={c => void apply(c)} onDirty={onDirty} />}
    {view && !view.signedIn && <p>请先在查询窗口登录。</p>}
    {view?.signedIn && !view.authorized && !view.pending && <p>请确认登录与店铺授权。</p>}
    {view?.authorized && <div className={view.selected ? 'intake-stage has-sheet' : 'intake-stage'}>
      <section aria-label="候选列表">
        <div className="intake-candidate-head">
          <h2>有权范围内的候选</h2>
          <div className="intake-toolbar">
            <ActionButton disabled={disabled || dirty || uploadDraft} onClick={() => void apply({ action: 'list', next: false })}>刷新候选</ActionButton>
            <ActionButton disabled={disabled || dirty || uploadDraft || !view?.moreCandidates} onClick={() => void apply({ action: 'list', next: true })}>下一页候选</ActionButton>
            {view?.selected && <ActionButton disabled={disabled} onClick={() => askConfirm('放弃尚未提交的判断并关闭当前候选？', () => void apply({ action: 'discard' }))}>关闭当前候选</ActionButton>}
            <Segmented
              aria-label="候选筛选"
              disabled={disabled}
              value={candidateFilter}
              onChange={(value) => {
                if (value === 'open' || value === 'published' || value === 'all') setCandidateFilter(value);
              }}
              options={[
                { label: '待我处理', value: 'open' },
                { label: '已发布', value: 'published' },
                { label: '全部', value: 'all' },
              ]}
            />
          </div>
        </div>
        <Table<CandidateRow> columns={candidateColumns} dataSource={visibleCandidates} pagination={false} rowKey="selection"
          locale={{ emptyText: view.candidates.length
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个筛选下没有候选。" />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这一页没有候选。选择来源并上传资料后，会出现在这里。" /> }} />
        {dirty && <p role="status">当前有尚未提交的输入。请完成对应操作，或关闭当前候选并明确放弃。</p>}
      </section>
      {view.selected && <section className="intake-sheet" aria-label="当前候选"><h2 id={`${sectionId}-candidate`} tabIndex={-1}>{candidateTitle(view.candidates.find(row => sameCandidate(row.candidate, view.selected))?.scopeLabel, view.selected.key.version, view.selected.sourceId, view.material?.materialHeader.scope.domain)}</h2>
        <p>{states[view.selected.state]} · {['awaiting-evidence','ready'].includes(view.selected.state)
          ? [...new Set(view.selected.readinessReasons.map(readinessLabel))].join(' / ') || '基础证据已齐备，发布仍须独立核验' : '此版本不再接受修改或发布。'}</p>
        {(view.canRevise || view.canCancel) && <div className="intake-toolbar">
          {view.canRevise && <ActionButton disabled={disabled || dirty || view.hasDraft} onClick={() => askConfirm('修订当前候选？请上传完整修订稿。校验成功后旧版失效，新版须重新确认来源和质量检查；校验失败保留旧版。', () => void apply({ action: 'revise' }))}>修订当前候选</ActionButton>}
          {view.canCancel && <ActionButton danger disabled={disabled || dirty || view.hasDraft} onClick={() => askConfirm('确认取消当前候选？取消成功后该版本不能再发布，已发布内容不受影响。这不是停止本机等待。', () => void apply({ action: 'cancel-candidate' }))}>取消当前候选</ActionButton>}
        </div>}
        <ActionButton disabled={disabled} onClick={() => void apply({ action: 'refresh-candidate' })}>刷新候选状态</ActionButton>
        <div hidden={step?.target !== 'material'}>
        <h2 id={`${sectionId}-material`} tabIndex={-1}>1. 核对材料</h2>
        <div className="intake-toolbar"><ActionButton type="primary" disabled={disabled} onClick={() => void apply({ action: 'material', next: false })}>查看材料</ActionButton></div>
        </div>
        <CandidateWorkflow key={view.selected.key.digest} view={view} disabled={disabled || qualityDirty} apply={c => void apply(c)} onDirty={onDirty} sectionId={sectionId}
          open={workflowPane(step?.target, view.selected.publicationPolicy)}>
          <section aria-label="人工质量检查" hidden={step?.target !== 'quality'}><h2 id={`${sectionId}-quality`} tabIndex={-1}>3. 质量检查</h2>
          <p>{view.selected.publicationPolicy === 'approval-v1' ? '旧候选保留原审批记录；如需直接发布，请先修订或重新导入。' : '检查用于核对资料质量。通过后可直接确认发布，无需另行审批。'}</p>
          {view.canReview ? <div className="intake-toolbar"><ActionButton type={quality ? 'default' : 'primary'} disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'initial' })}>读取初检</ActionButton>
            <ActionButton disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'expanded' })}>读取扩检</ActionButton></div> : <p>当前没有此来源的检查权限。</p>}
        {quality && <><h3>{states[quality.status.state] ?? quality.status.state}</h3><p>本轮 {quality.total} 条 · 已填写 {quality.checked} 条</p>
          {!quality.status.frozen && <><p>冻结抽样会固定本轮要检查的条目，不会发布资料。</p><ActionButton type="primary" disabled={disabled || workflowDirty} onClick={() => void apply({ action: 'freeze' })}>冻结本次抽样</ActionButton></>}
          <div className="intake-toolbar"><ActionButton disabled={disabled || dirty || quality.offset === 0} onClick={() => void apply({ action: 'quality-page', offset: Math.max(0, quality.offset - 20) })}>上一页检查</ActionButton>
            <ActionButton disabled={disabled || dirty || quality.offset + 20 >= quality.total} onClick={() => void apply({ action: 'quality-page', offset: quality.offset + 20 })}>下一页检查</ActionButton></div>
          {quality.samples.map(sample => <CheckRow key={`${view.selected!.key.digest}-${quality.phase}-${quality.offset}-${sample.scriptId}`} sample={sample}
            disabled={disabled || workflowDirty || !editable} onDirty={onDirty} save={c => void apply(c)} />)}
          <ActionButton type={quality.status.frozen ? 'primary' : 'default'} disabled={disabled || dirty || quality.checked !== quality.total || !editable}
            onClick={() => void apply({ action: 'submit' })}>提交本轮人工检查</ActionButton>
        </>}
          </section>
        </CandidateWorkflow>
        {view.receipt && <p role="status">操作回执：{states[view.receipt.state] ?? view.receipt.state}。这是本次操作记录，请重新读取检查状态。</p>}
      </section>}
    </div>}
  </section></IntakeAntdTheme>;
}
