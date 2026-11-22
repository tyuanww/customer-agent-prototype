import type { components } from '@customer-agent/contracts';
import { Button, Collapse, ConfigProvider, Input, Modal, Segmented, Select, Table, type ButtonProps, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { INTAKE_BATCH_LIST_FAILURE_MESSAGES, type IntakeManagementCommand, type IntakeManagementReply, type IntakeManagementView, type QualityPage } from '@shared/content-intake-management';
import { asyncFailure, type AsyncResource } from '@shared/async-resource';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import { READ_DISCARDED, useAsyncResource, type DashboardRead } from './use-async-resource';
import { DISPLAY_SEPARATOR } from '@shared/display-separator';
import { IntakeAntdTheme } from './intake-antd';
import { IntakeRollback } from './IntakeRollback';
import { IntakeUpload } from './IntakeUpload';
import { formatSeatClock } from './intake-time';
import { WorkbenchFailed, WorkbenchLoading, WorkbenchNoAccess } from './WorkbenchState';
import './intake-management.css';

function askConfirm(content: string, onOk: () => void, danger = false) {
  return Modal.confirm({
    title: '请确认',
    content,
    okText: '确认',
    cancelText: '取消',
    focusable: { autoFocusButton: 'cancel' },
    okButtonProps: { danger, autoInsertSpace: false },
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
type OverviewSelection = { action: 'select-from-overview'; row: CandidateRow };
const domainWord: Record<string, string> = { product: '产品', campaign: '活动', presale: '售前', aftersale: '售后' };
function candidateCategory(scopeLabel?: string, domain?: string) {
  const label = scopeLabel?.split(DISPLAY_SEPARATOR).at(-1)?.trim();
  return label && Object.values(domainWord).includes(label) ? label : (domain && domainWord[domain]) || '—';
}
function shortBatchId(candidateId: string) {
  return candidateId.length <= 16 ? candidateId : `${candidateId.slice(0, 6)}…${candidateId.slice(-6)}`;
}
function candidateState(candidate: CandidateRow['candidate']) {
  if (candidate.state === 'awaiting-evidence') return candidate.sourceEvidenceVersion ? '待审核' : '待确认来源';
  return stateLabel(candidate.state);
}
function differenceTitle(entries: { businessEntryId: string; title: string }[], businessEntryId: string) {
  const title = entries.find(entry => entry.businessEntryId === businessEntryId)?.title.trim();
  return title || '未命名条目';
}
const states: Record<string, string> = { 'awaiting-evidence': '待审核', ready: '待发布', publishing: '发布中', published: '已发布', cancelled: '已取消', invalidated: '已失效',
  confirmed: '来源已确认', creating: '审批创建结果待确认', pending: '等待组织审批', approved: '组织审批已通过', rejected: '组织审批未通过', revoked: '组织审批已撤回', unavailable: '审批服务暂不可用', unknown: '操作结果待确认', failed: '操作失败', not_frozen: '待开始审核', revision_required: '需上传修订版重新审核', initial_required: '待完成审核', expansion_required: '待完成追加检查', passed: '质量检查通过', blocked: '质量检查未通过' };
const readinessLabels: Record<string, string> = {
  SOURCE_MISMATCH: '来源已变更，请核对当前材料', BASE_CHANGED: '已发布版本已变更，请重新核对资料',
  SOURCE_CONFIRMATION_REQUIRED: '待确认来源版本', APPROVAL_REVOKED: '组织审批已撤回',
  APPROVAL_UNAVAILABLE: '审批结果需重新核验', AWAITING_APPROVAL: '待组织审批通过',
  PERMISSION_CHANGED: '当前资格已变更，请刷新并核对权限',
  QUALITY_NOT_PASSED: '待完成质量检查',
};
const riskLabels: Record<components['schemas']['IntakeRisk']['level'], string> = { routine: '常规内容', critical: '关键变更' };
function readinessLabel(reason: string) {
  return Object.hasOwn(readinessLabels, reason) ? readinessLabels[reason] : '还有待核验事项，请刷新审核状态';
}
type ReviewPane = 'material' | 'source' | 'quality' | 'publish' | 'legacy';
function workflowPane(target: string | undefined, policy: string | undefined): ReviewPane {
  if (target === 'source') return 'source';
  if (target === 'publish') return 'publish';
  if (target === 'quality') return 'quality';
  if (target === 'candidate' && policy === 'approval-v1') return 'legacy';
  return 'material';
}
function MaterialPage({ material, disabled, apply, pageIndex }: { material: NonNullable<IntakeManagementView['material']>; disabled: boolean; apply: (command: IntakeManagementCommand) => void; pageIndex: number }) {
  return <section aria-label="当前页材料与差异">
    <dl className="intake-facts"><dt>来源版本</dt><dd>{material.materialHeader.sourceClaim.versionValue ?? '尚未确认'}</dd><dt>风险等级</dt><dd>{riskLabels[material.materialHeader.risk.level]}</dd><dt>页码</dt><dd>第 {pageIndex + 1} 页</dd></dl>
    <div className="intake-toolbar">
      <ActionButton disabled={disabled || pageIndex === 0} onClick={() => apply({ action: 'material', next: false, previous: true })}>上一页材料</ActionButton>
      <ActionButton disabled={disabled || !material.nextCursor} onClick={() => apply({ action: 'material', next: true })}>下一页材料</ActionButton>
    </div>
    <Table rowKey="businessEntryId" dataSource={material.entries} pagination={false} size="small"
      locale={{ emptyText: '当前页没有原文条目。' }}
      columns={[
        // Workbook titles may repeat; the business code identifies the original row.
        { title: '条目编号', dataIndex: 'businessEntryId', render: id => <code>{id}</code> },
        { title: '标题', dataIndex: 'title' },
        { title: '版本', dataIndex: 'scriptVersion' },
      ]}
      expandable={{
        columnTitle: '原文', columnWidth: 100,
        expandIcon: ({ expanded, onExpand, record }) => <ActionButton type="text"
          aria-label={`${expanded ? '收起' : '查看'}原文 ${record.businessEntryId}`} aria-expanded={expanded}
          onClick={event => onExpand(record, event)}>{expanded ? '收起原文' : '查看原文'}</ActionButton>,
        expandedRowRender: entry => <><h3>{entry.title}</h3><p className="intake-answer">{entry.answerText}</p><EntryDetails entry={entry} /></>,
      }} />
    <h3>当前页差异</h3>
    <Table rowKey="businessEntryId" dataSource={material.differences} pagination={false} size="small" locale={{ emptyText: '当前页没有变更记录。' }}
      columns={[
        { title: '条目编号', dataIndex: 'businessEntryId', render: id => <code>{id}</code> },
        { title: '标题', key: 'title', render: (_value, difference) => differenceTitle(material.entries, difference.businessEntryId) },
        { title: '变更', dataIndex: 'change', render: (change: 'add' | 'modify' | 'disable' | 'reenable') => ({ add: '新增', modify: '修改', disable: '停用', reenable: '重新启用' })[change] },
        { title: '版本', key: 'version', render: (_value, difference) => `${difference.previousVersion ?? '无前版'} → ${difference.nextVersion}` },
      ]} />
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
    <dt>问题表达</dt><dd>{entry.questions.map(q => `${q.text}（${q.active ? '启用' : '停用'}，${q.id} / ${q.version}）`).join('；') || '无'}</dd>
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
    <h3>{sample.entry.title} <small>{sample.mandatory ? '必检条目' : '抽检条目'}</small></h3>
    <p className="intake-answer">{sample.entry.answerText}</p>
    <EntryDetails entry={sample.entry} />
    {sample.check ? <p>已提交：{sample.check.defect ? '需修改' : '通过'} {sample.check.reason}</p>
      : <fieldset disabled={disabled}>
        <legend>本条判断{sample.draft ? '（已暂存，尚未提交）' : '（尚未填写）'}</legend>
        <label>检查结论<Select aria-label={`检查结论 ${sample.entry.title}`} value={choice || undefined} placeholder="请选择" disabled={disabled}
          virtual={false} style={{ width: 160 }} onChange={value => setChoice(value)}
          options={[{ value: 'pass', label: '通过' }, { value: 'defect', label: '需修改' }]} /></label>
        <label>判断说明<Input.TextArea value={reason} onChange={e => setReason(e.target.value)} aria-label={`判断说明 ${sample.entry.title}`} autoSize={{ minRows: 2, maxRows: 6 }} /></label>
        <ActionButton disabled={!choice || (choice === 'defect' && !reason.trim()) || [...reason].length > 1000}
          onClick={() => save({ action: 'check', scriptId: sample.scriptId, defect: choice === 'defect', reason })}>暂存本条判断</ActionButton>
      </fieldset>}
  </article>;
}
function CandidateWorkflow({ view, disabled, apply, onDirty, sectionId, open, children }: { view: IntakeManagementView; disabled: boolean;
  sectionId: string; open: ReviewPane; children: ReactNode;
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
    <h2 id={`${sectionId}-source`} tabIndex={-1}>确认来源</h2><p>已记录 {candidate.sourceEvidenceVersion} 次来源确认。</p>
    {view.canConfirmSource ? <fieldset disabled={disabled || view.hasDraft || publishDirty || !mutable || !view.material}>
      <legend>确认本次导出对应的来源版本</legend>
      {!view.material && <p>请先查看材料，核对本次上传内容。</p>}
      <label>来源版本<Input aria-label="来源版本" value={versionValue} onChange={e => setVersionValue(e.target.value)} /></label>
      <label>来源确认说明<Input.TextArea aria-label="来源确认说明" value={reason} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setReason(e.target.value)} /></label>
      <Collapse ghost size="small" items={[{ key: 'format', label: '来源版本格式与填写限制', children: <>
        <label>来源版本类型<Select aria-label="来源版本类型" value={versionKind} virtual={false} style={{ width: 160 }}
          onChange={value => { if (value === 'integer' || value === 'opaque') setVersionKind(value); }}
          options={[{ value: 'opaque', label: '版本标识' }, { value: 'integer', label: '递增整数' }]} /></label>
        <p>版本最多 128 字；说明最多 512 字。递增整数须为 0 或不带前导零的正整数。</p>
      </> }]} />
      <ActionButton type="primary" disabled={!sourceValid} onClick={() => apply({ action: 'confirm-source', versionKind, versionValue, reason })}>确认来源版本</ActionButton>
    </fieldset> : <p>当前没有此来源的确认权限。</p>}
    </div>
    {legacy && <section hidden={open !== 'legacy'} aria-label="历史审批记录"><h2>历史审批记录</h2>
      <p>旧审批流程的资料，需先修订或重新导入才能直接发布。</p>
      <ActionButton disabled={disabled || !candidate.approvalEvidenceVersion} onClick={() => apply({ action: 'read-review' })}>读取历史审批</ActionButton>
      {view.review && <div role="status"><p>{stateLabel(view.review.state, view.review)}{view.review.instanceCode ? `，审批编号 ${view.review.instanceCode}` : ''}</p>
        <p>历史核验：{view.review.checkedAt ? formatSeatClock(view.review.checkedAt) : '尚未核验'}，有效至：{view.review.validUntil ? formatSeatClock(view.review.validUntil) : '尚无有效核验'}</p></div>}
    </section>}
    {children}
    <div hidden={open !== 'publish'}>
    <h2 id={`${sectionId}-publish`} tabIndex={-1}>确认发布</h2><p>发布整批资料前，还需在弹窗中确认。</p>
    {view.canPublish ? <fieldset disabled={disabled || view.hasDraft || sourceDirty || !view.material || legacy || candidate.state !== 'ready'}>
      <legend>本次发布说明</legend>
      <label>发布标题<Input aria-label="发布标题" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>发布摘要<Input.TextArea aria-label="发布摘要" value={summary} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setSummary(e.target.value)} /></label>
      <p>标题最多 256 字；摘要最多 2048 字。</p>
      <ActionButton type="primary" disabled={!title.trim() || !summary.trim() || [...title].length > 256 || [...summary].length > 2048}
        onClick={() => apply({ action: 'publish', title, summary })}>发布整批资料</ActionButton>
    </fieldset> : <p>当前没有此来源的发布权限。</p>}
    </div>
    {(candidate.state === 'published' || candidate.publishedReleaseId) && <div role="status"><p>已发布。</p>
      {candidate.publishedReleaseId ? <p>{candidate.publishedReleaseId}</p> : null}<p>坐席重新查询后可读取新版本。</p></div>}
    {result && <div role="status"><p>本次操作结果：{result.action === 'publish' && ['pending', 'unknown'].includes(result.state) ? '发布结果待确认' : stateLabel(result.state, view.review)}。</p>
      {result.releaseId ? <p>{result.releaseId}</p> : null}<p>这是操作记录；当前审核状态可单独刷新。</p></div>}
  </section>;
}
/** Navigation advice only. Main/API continue to own every operation's eligibility. */
function currentStep(view: IntakeManagementView, dirtyIds: Set<string>): { title: string; target: string } {
  if (view.pending) return { title: '确认上次操作结果', target: 'recovery' };
  const candidate = view.selected!;
  if (!['awaiting-evidence', 'ready'].includes(candidate.state)) return { title: stateLabel(candidate.state), target: 'candidate' };
  if (candidate.publicationPolicy === 'approval-v1') return { title: '上传修订版或重新导入', target: 'candidate' };
  if (dirtyIds.has('workflow-source')) return { title: '完成来源确认', target: 'source' };
  if (dirtyIds.has('workflow-publish')) return { title: '完成发布说明', target: 'publish' };
  if (dirtyIds.size || view.hasDraft) return { title: '完成本轮质量检查', target: 'quality' };
  if (!view.material) return { title: '核对材料', target: 'material' };
  if (!candidate.sourceEvidenceVersion) return { title: '确认来源', target: 'source' };
  if (candidate.state === 'ready') return { title: '确认发布', target: 'publish' };
  if (view.receipt && !view.quality) return { title: '读取最新检查状态', target: 'quality' };
  const state = view.quality?.status.state;
  if (state === 'blocked' || state === 'revision_required') return { title: '上传修订版后重新审核', target: 'quality' };
  if (state === 'passed' || candidate.readinessReasons.some(reason => !['SOURCE_CONFIRMATION_REQUIRED', 'QUALITY_NOT_PASSED'].includes(reason))) {
    return { title: '核对审核状态', target: 'candidate' };
  }
  return { title: '完成质量检查', target: 'quality' };
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
  if (candidate.publicationPolicy === 'approval-v1' && isOpenCandidate(candidate.state)) return '上传修订版或重新导入';
  if (!isOpenCandidate(candidate.state)) return states[candidate.state] ?? candidate.state;
  if (!candidate.sourceEvidenceVersion) return '核对材料';
  if (candidate.state === 'ready') return '确认发布';
  return '质量检查';
}
function sameCandidate(candidate: components['schemas']['IntakeCandidate'], selected: components['schemas']['IntakeCandidate'] | null) {
  return !!selected && candidate.key.candidateId === selected.key.candidateId && candidate.key.version === selected.key.version
    && candidate.key.digest === selected.key.digest && candidate.sourceId === selected.sourceId;
}
function resourceForReply(reply: IntakeManagementReply): AsyncResource<IntakeManagementView> {
  if (reply.view) return { status: 'ready', value: reply.view };
  if (!reply.ok) return asyncFailure(reply.code, { forbidden: reply.message, error: reply.message });
  return { status: 'idle' };
}
/** The host keeps this instance across both destinations. A second overview
 * reader would duplicate access invalidation and lose the in-progress forms. */
export function IntakeManagement({ active = true, presentation = 'review', onOpenReview, readProjectionFirst = false }: {
  active?: boolean;
  presentation?: 'overview' | 'review';
  onOpenReview?: () => void;
  readProjectionFirst?: boolean;
}) {
  const sectionId = useId();
  const [detailOpen, setDetailOpen] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewPane, setReviewPane] = useState<ReviewPane | null>(null);
  const activeReview = useRef(active && presentation === 'review');
  activeReview.current = active && presentation === 'review';
  const overviewVisit = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    if (active && presentation === 'overview') overviewVisit.current = Symbol();
    return () => { overviewVisit.current = null; };
  }, [active, presentation]);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const focusDetail = useRef(false);
  const openOverviewDetail = () => {
    setDetailOpen(true);
    focusDetail.current = true;
    onOpenReview?.();
  };
  const confirmation = useRef<ReturnType<typeof Modal.confirm> | null>(null);
  useEffect(() => () => { confirmation.current?.destroy(); confirmation.current = null; }, [active, presentation]);
  const confirm = (content: string, onOk: () => void, danger = false) => {
    confirmation.current?.destroy();
    confirmation.current = askConfirm(content, onOk, danger);
  };
  const [operation, setOperation] = useState<{ kind: 'review'; action?: IntakeManagementCommand['action'] } | { kind: 'overview'; selection: CandidateRow['selection'] } | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [rereading, setRereading] = useState(false);
  const generation = useRef(0), pending = useRef<number | null>(null);
  const stopPending = useRef(false);
  const batchList = useRef<'initial' | 'loaded' | 'retry-first-page'>('initial');
  const readProjection = useRef(readProjectionFirst);
  const readTicket = useRef(0);
  const held = useRef<AsyncResource<IntakeManagementView>>(window.dashboardIntake
    ? { status: 'idle' }
    : { status: 'error', message: WORKBENCH_EMPTY.intakeUnmounted });
  const readCurrent = async (): Promise<DashboardRead<IntakeManagementView>> => {
    const ticket = readTicket.current;
    const gen = generation.current;
    // A newer command or session notification owns the screen. Resolving here would
    // let this older read replace that result after the hook applies it.
    const stale = () => Promise.resolve(READ_DISCARDED);
    const finish = (next: AsyncResource<IntakeManagementView>) => {
      if (generation.current !== gen) return stale();
      held.current = next;
      if (readTicket.current === ticket) setRereading(false);
      return next;
    };
    const api = window.dashboardIntake;
    if (!api) return finish({ status: 'error', message: WORKBENCH_EMPTY.intakeUnmounted });
    try {
      const projectionOnly = readProjection.current || batchList.current === 'loaded';
      const reply = projectionOnly ? await api.current() : await api.command({ action: 'list', next: false });
      if (generation.current !== gen) return stale();
      readProjection.current = false;
      if (reply.ok || reply.code === 'UNAUTHORIZED') batchList.current = 'loaded';
      else if (reply.view?.batchListFailure?.retryFirstBatchPage) batchList.current = 'retry-first-page';
      setError(!reply.ok && reply.view ? reply.message : '');
      return finish(resourceForReply(reply));
    } catch {
      if (generation.current !== gen) return stale();
      setError('');
      return finish({ status: 'error', message: '管理服务不可用，请刷新。' });
    }
  };
  const { resource, reload, replace } = useAsyncResource(readCurrent, [], held.current, { retainReady: true });
  const view = resource.status === 'ready' ? resource.value : null;
  const reading = resource.status === 'loading';
  const readFailure = resource.status === 'error' || resource.status === 'forbidden' ? resource.message : '';
  const commit = (next: AsyncResource<IntakeManagementView>) => {
    held.current = next;
    replace(next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const reread = () => {
    generation.current += 1;
    readTicket.current += 1;
    setError('');
    setRereading(true);
    reload();
  };
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('open');
  const onDirty = useCallback((id: string, dirty: boolean) => setDirtyIds(previous => {
    if (previous.has(id) === dirty) return previous;
    const next = new Set(previous); if (dirty) next.add(id); else next.delete(id); return next;
  }), []);
  const apply = async (request?: IntakeManagementCommand | OverviewSelection) => {
    const fromOverview = request?.action === 'select-from-overview';
    const visit = overviewVisit.current;
    if (fromOverview ? !visit || !onOpenReview : !activeReview.current) return;
    const command: IntakeManagementCommand | undefined = fromOverview ? { action: 'select', selection: request.row.selection } : request;
    if (command?.action === 'upload-stop') {
      if (stopPending.current) return;
      if (!window.dashboardIntake) {
        setError(WORKBENCH_EMPTY.intakeUnmounted);
        return;
      }
      stopPending.current = true; setStopping(true); const gen = ++generation.current;
      try {
        const reply = await window.dashboardIntake.command(command);
        if (generation.current === gen) {
          commit(resourceForReply(reply));
          setError(reply.ok ? '' : reply.message);
        }
      } catch { if (generation.current === gen) setError('停止请求尚未确认，请重新读取当前状态。服务器可能仍在处理原任务。'); }
      finally {
        // Main's stop acknowledgement releases local waiting. A late original
        // response must neither replace this view nor unlock a newer request.
        pending.current = null; setOperation(null);
        stopPending.current = false; setStopping(false);
      }
      return;
    }
    if (pending.current !== null || stopPending.current) return;
    if (!window.dashboardIntake) {
      commit({ status: 'error', message: WORKBENCH_EMPTY.intakeUnmounted });
      setError(WORKBENCH_EMPTY.intakeUnmounted);
      return;
    }
    setOperation(fromOverview ? { kind: 'overview', selection: request.row.selection } : { kind: 'review', action: command?.action });
    setError(''); const gen = ++generation.current; pending.current = gen;
    const uploading = command?.action.startsWith('upload-') ?? false;
    try {
      const api = window.dashboardIntake!;
      const reply = await (command ? api.command(command) : api.current());
      if (generation.current !== gen) return;
      if (command?.action === 'list') batchList.current = reply.ok || reply.code === 'UNAUTHORIZED' ? 'loaded' : 'retry-first-page';
      if (fromOverview && reply.ok && (!reply.view.signedIn || !reply.view.authorized || !sameCandidate(request.row.candidate, reply.view.selected))) {
        commit(resourceForReply(reply));
        setError('无法打开该批次，请重新读取当前状态。');
        return;
      }
      commit(resourceForReply(reply)); if (!reply.ok) setError(reply.message);
      if (reply.ok && command) {
        if (command.action === 'select' || command.action === 'upload-open') {
          if (fromOverview && overviewVisit.current === visit) openOverviewDetail();
          else setDetailOpen(true);
        }
        if (['select', 'upload-open', 'confirm-source', 'freeze', 'submit', 'refresh-candidate', 'discard', 'revise'].includes(command.action)) setReviewPane(null);
        if (command.action === 'revise') setUploadOpen(true);
      }
    } catch {
      if (generation.current !== gen) return;
      if (command?.action === 'list') batchList.current = 'retry-first-page';
      if (uploading) {
        // Re-read Main's access-filtered projection before keeping form input.
        // A failed IPC reply alone cannot prove either success or revocation.
        try {
          const reply = await window.dashboardIntake!.current();
          if (generation.current === gen) {
            commit(resourceForReply(reply));
            setError(reply.ok ? '本次操作未完整返回，已重新读取当前状态。请按当前提示继续。' : reply.message);
          }
        } catch { if (generation.current === gen) {
          commit({ status: 'error', message: '管理服务不可用，请重新读取当前状态。' });
          setError('管理服务不可用，请重新读取当前状态。');
        } }
      } else {
        commit({ status: 'error', message: '管理服务不可用，请刷新。' });
        setError('管理服务不可用，请刷新。');
      }
    } finally {
      if (pending.current === gen) { pending.current = null; setOperation(null); }
    }
  };
  const upload = view?.upload;
  const reviewAction = operation?.kind === 'review' ? operation.action : undefined;
  const refreshingUpload = reviewAction === 'upload-refresh';
  const uploadParsing = active && presentation === 'review' && !!upload?.file
    && (upload.job?.state === 'reading' || upload.job?.state === 'parsing');
  const uploadPolling = !refreshingUpload && (reviewAction?.startsWith('upload-') || uploadParsing);
  useEffect(() => {
    if (!uploadPolling) return;
    let active = true, polling = false;
    const read = async () => {
      if (polling || stopPending.current) return;
      polling = true;
      // An upload command can start and finish while the poller keeps running.
      // Capture its generation per tick and leave the command's final reply in place.
      const gen = generation.current, command = pending.current;
      try {
        const reply = await window.dashboardIntake!.current();
        if (active && generation.current === gen && pending.current === command && reply.view) {
          commitRef.current({ status: 'ready', value: reply.view });
        }
      } catch { /* The original command owns its visible transport outcome. */ }
      finally { polling = false; }
    };
    void read(); const timer = window.setInterval(() => void read(), 250);
    return () => { active = false; window.clearInterval(timer); };
  }, [uploadPolling]);
  useEffect(() => {
    const api = window.dashboardIntake;
    if (!api) return undefined;
    const off = api.onInvalidated(() => {
      const gen = ++generation.current; setDirtyIds(new Set());
      commitRef.current({ status: 'loading' });
      setError(''); setRereading(false);
      void api.current().then(reply => {
        if (generation.current !== gen) return;
        if (!reply.ok && reply.view?.batchListFailure?.retryFirstBatchPage) batchList.current = 'retry-first-page';
        setError(!reply.ok && reply.view ? reply.message : '');
        commitRef.current(resourceForReply(reply));
      }).catch(() => {
        if (generation.current === gen) commitRef.current({ status: 'error', message: '管理服务不可用，请刷新。' });
      });
    });
    const invalidate = () => { generation.current++; };
    return () => { invalidate(); pending.current = null; off(); };
  }, []);
  const uploadPhase = upload?.phase;
  const hasSelected = !!view?.selected;
  useEffect(() => {
    if (hasSelected && uploadPhase === 'validated') setUploadOpen(false);
    else if (uploadPhase && uploadPhase !== 'idle' && !hasSelected) setUploadOpen(true);
  }, [uploadPhase, hasSelected]);
  const unavailable = !active || busy || reading || rereading || stopping || !!view?.rollback.pending || !!view?.pending || !!upload?.busy || !!upload?.pending;
  const disabled = presentation !== 'review' || unavailable;
  const uploadDraft = !!(upload?.file || upload?.revisionOf) && upload?.phase !== 'validated';
  const quality = view?.quality;
  const dirty = dirtyIds.size > 0;
  const qualityDirty = [...dirtyIds].some(id => id !== 'workflow-source' && id !== 'workflow-publish');
  const workflowDirty = dirtyIds.has('workflow-source') || dirtyIds.has('workflow-publish');
  const editable = quality?.status.state === (quality?.phase === 'initial' ? 'initial_required' : 'expansion_required');
  const step = view?.authorized && view.selected && !view.rollback.pending && !view.rollback.impact && !dirtyIds.has('rollback-input')
    ? currentStep(view, dirtyIds) : null;
  const pane = reviewPane ?? workflowPane(step?.target, view?.selected?.publicationPolicy);
  const inDetail = !!view?.selected && detailOpen;
  useLayoutEffect(() => {
    if (active && presentation === 'review' && inDetail && focusDetail.current) {
      focusDetail.current = false;
      detailHeading.current?.focus();
    }
  }, [active, presentation, inDetail]);
  const candidates = view?.candidates ?? [];
  const currentPublishedReleaseId = candidates
    .filter(row => row.candidate.state === 'published' && row.candidate.publishedReleaseId !== null)
    .sort((left, right) => Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt))[0]
    ?.candidate.publishedReleaseId ?? null;
  const visibleCandidates = candidates.filter(row => candidateVisible(row.candidate.state, candidateFilter, sameCandidate(row.candidate, view?.selected ?? null)));
  const selectionBlocked = dirty || !!view?.hasDraft || uploadDraft;
  const rowDisabled = disabled || selectionBlocked;
  const accessKnown = !!view?.validUntil;
  const canOpenUpload = !!upload && (upload.authorized || upload.phase !== 'idle' || !!upload.pending || upload.canReset || upload.busy);
  const showUpload = uploadOpen && canOpenUpload;
  const reviewRecoveryPending = !!(view?.pending || view?.rollback.pending);
  const lastListFailure = view?.batchListFailure;
  const failureMessage = error || readFailure || (lastListFailure && INTAKE_BATCH_LIST_FAILURE_MESSAGES[lastListFailure.stage]);
  const showAccessStatus = !failureMessage && !reviewRecoveryPending;
  const checkingStatus = busy || reading || rereading || stopping;
  const hasLoadedBatches = batchList.current === 'loaded' && !lastListFailure;
  const batchListLoading = !hasLoadedBatches && !failureMessage && checkingStatus;
  const refreshAccess = () => {
    if (batchList.current === 'loaded') batchList.current = 'initial';
    readProjection.current = false;
    reread();
  };
  const refreshAccessDisabled = checkingStatus || !!upload?.busy || dirty || !!view?.hasDraft || reviewRecoveryPending;
  const needsAccessRefresh = !!view?.signedIn && (!accessKnown || !view.authorized || !upload?.authorized || !!upload.pending);
  const retryList = !!window.dashboardIntake && view?.signedIn !== false && !reviewRecoveryPending
    && (!hasLoadedBatches || (view?.signedIn && !accessKnown));
  const retryLabel = accessKnown || lastListFailure?.retryFirstBatchPage || batchList.current === 'retry-first-page' ? '重新读取第一页批次' : '刷新资料权限';
  const failure = failureMessage && <WorkbenchFailed message={failureMessage}
    retryLabel={retryList ? retryLabel : '重新读取当前状态'}
    onRetry={(retryList ? refreshAccessDisabled : checkingStatus) ? undefined : retryList ? refreshAccess : reread} />;
  const explainUploadAccess = showAccessStatus && accessKnown && !!upload && !upload.authorized;
  const uploadAccessId = `${sectionId}-upload-access`;
  const batchColumns: TableColumnsType<CandidateRow> = [
    { title: '资料批次', key: 'batch', render: (_value, row) => <div className="intake-batch-label">
      <span title={row.candidate.key.candidateId}>{candidateCategory(row.scopeLabel)} / {shortBatchId(row.candidate.key.candidateId)}</span>
      <small>修订 {row.candidate.key.version}</small>
    </div> },
    { title: '分类', key: 'category', render: (_value, row) => candidateCategory(row.scopeLabel) },
    { title: '更新时间', key: 'time', render: (_value, row) => formatSeatClock(row.candidate.updatedAt) },
    { title: '审核状态', key: 'state', render: (_value, row) => candidateState(row.candidate) },
    { title: '下一步', key: 'next', render: (_value, row) => listNext(row.candidate) },
  ];
  const overviewColumns: TableColumnsType<CandidateRow> = [...batchColumns,
    { title: '操作', key: 'action', render: (_value, row) => {
      const current = sameCandidate(row.candidate, view?.selected ?? null);
      return <ActionButton type="text" disabled={!onOpenReview || unavailable || (!current && selectionBlocked)}
        loading={operation?.kind === 'overview' && operation.selection === row.selection}
        aria-label={`查看详情 ${candidateCategory(row.scopeLabel)} / ${shortBatchId(row.candidate.key.candidateId)} / 修订 ${row.candidate.key.version}`}
        onClick={() => current ? openOverviewDetail() : void apply({ action: 'select-from-overview', row })}>查看详情</ActionButton>;
    } },
  ];
  const candidateColumns: TableColumnsType<CandidateRow> = [...batchColumns,
    { title: '操作', key: 'action', render: (_value, row) => {
      const current = sameCandidate(row.candidate, view?.selected ?? null);
      const label = current ? '继续查看' : isOpenCandidate(row.candidate.state) ? '审核' : '查看';
      const rollbackTarget = view?.rollback.available && row.candidate.state === 'published'
        ? row.candidate.publishedReleaseId : null;
      return <div>
        <ActionButton type="text" disabled={!current && rowDisabled}
          aria-label={`${label} ${candidateCategory(row.scopeLabel)} / ${shortBatchId(row.candidate.key.candidateId)}`}
          onClick={() => current ? setDetailOpen(true) : void apply({ action: 'select', selection: row.selection })}>{label}</ActionButton>
        {rollbackTarget && currentPublishedReleaseId && rollbackTarget !== currentPublishedReleaseId
          ? <ActionButton type="text" disabled={rowDisabled}
              onClick={() => void apply({ action: 'rollback-preview', baseReleaseId: currentPublishedReleaseId, targetReleaseId: rollbackTarget })}>回退</ActionButton>
          : null}
      </div>;
    } },
  ];
  const selectedRow = view?.candidates.find(row => sameCandidate(row.candidate, view.selected));
  return <IntakeAntdTheme><ConfigProvider getPopupContainer={trigger => trigger?.parentElement ?? document.body}><section className="intake-management" aria-label={presentation === 'overview' ? '工作台待审核资料' : '资料审核'}
    data-testid={presentation === 'overview' ? 'module-overview' : undefined}>
    {presentation === 'overview' && <section aria-label="待审核资料">
      <div className="intake-candidate-head"><h1>待审核资料</h1><ActionButton disabled={!onOpenReview} onClick={onOpenReview}>查看全部资料</ActionButton></div>
      {failure}
      {reading || rereading || batchListLoading || (!view && !failureMessage) ? <WorkbenchLoading label="读取待审核资料" />
        : view?.signedIn && view.authorized && hasLoadedBatches
        ? <><Table<CandidateRow> columns={overviewColumns} dataSource={candidates.filter(row => isOpenCandidate(row.candidate.state))}
          pagination={false} rowKey="selection" locale={{ emptyText: view.moreCandidates ? '当前页没有待审核资料，后续批次尚未读取。' : '有可处理的资料批次时，会显示在这里。' }} />
          {(selectionBlocked || view.pending || view.rollback.pending || upload?.pending) && <p role="status">请先在资料审核处理当前操作，再切换批次。</p>}
          {view.moreCandidates && <p className="intake-muted">这里只显示当前已读取的批次。点击“查看全部资料”，可在批次列表继续翻页。</p>}</>
        : showAccessStatus && view && (!view.signedIn ? <p>登录后可查看待审核资料。</p>
          : !view.authorized && <><p>{accessKnown ? '取得资料查看权限后，会显示可处理的批次。' : '刷新资料权限后可查看待审核批次。'}</p>
            <ActionButton disabled={refreshAccessDisabled} onClick={refreshAccess}>刷新资料权限</ActionButton></>)}
    </section>}
    <div hidden={presentation !== 'review'}>
    <h1>资料审核</h1>
    {view && <p className="intake-operator">{view.displayName}</p>}
    {!view && !failureMessage && <WorkbenchLoading label="读取资料权限" />}
    {presentation === 'review' && failure}
    {view && !view.signedIn && showAccessStatus && <p>请先在查询窗口登录。</p>}
    {view?.signedIn && upload && <section aria-label="资料上传">
      {!accessKnown && showAccessStatus && <p>刷新资料权限后可查看当前可用操作。</p>}
      <div className="intake-toolbar">
        <ActionButton type={upload.authorized && !inDetail ? 'primary' : 'default'} disabled={!canOpenUpload}
          aria-expanded={showUpload} aria-controls={`${sectionId}-upload`} aria-describedby={explainUploadAccess ? uploadAccessId : undefined}
          onClick={() => setUploadOpen(!showUpload)}>{showUpload ? '收起上传区' : canOpenUpload && !upload.authorized ? '查看上传进度' : '上传资料'}</ActionButton>
        {needsAccessRefresh && !(failureMessage && retryList) && <ActionButton disabled={refreshAccessDisabled} onClick={refreshAccess}>刷新资料权限</ActionButton>}
      </div>
      {explainUploadAccess && <p id={uploadAccessId}>上传资料需要可维护的来源。没有权限，请找人开通。</p>}
      <div id={`${sectionId}-upload`} hidden={!showUpload}>
        <IntakeUpload view={upload} active={active && presentation === 'review' && showUpload} busy={presentation !== 'review' || busy || rereading} refreshing={refreshingUpload} stopping={stopping}
          blocked={dirty || view.hasDraft || !!view.pending || !!view.rollback.pending || !!view.selected} refreshBlocked={dirty || view.hasDraft} apply={c => void apply(c)} />
      </div>
    </section>}
    {view?.pending && <section className="intake-notice" aria-label="待恢复操作"><h2 id={`${sectionId}-recovery`} tabIndex={-1}>操作结果待确认</h2>
      {view.pending.action === 'cancel' && <p>取消结果尚未确认。取得最终回执前，不能认定资料已经取消。</p>}
      <p>{view.pending.recovery === 'receipt' ? '请查询原操作回执。' : '请按原请求重试，继续确认本次操作结果。'}重试会沿用同一操作编号。</p><code>{view.pending.operationId}</code>
      <div className="intake-toolbar">{view.pending.recovery === 'receipt' && <ActionButton disabled={busy || rereading} onClick={() => void apply({ action: 'recover' })}>查询原操作回执</ActionButton>}
        {view.pending.retryAllowed !== false && <ActionButton disabled={busy || rereading} onClick={() => void apply({ action: 'retry' })}>重试原操作</ActionButton>}
        {view.pending.retryAllowed === false && <p>旧流程操作不能转成确认直发，请查询原回执或读取历史状态。</p>}</div></section>}
    {view?.signedIn && (view.rollback.pending || !!view.rollback.impact || !!view.rollback.result) && <IntakeRollback active={active && presentation === 'review'} view={view} busy={!active || presentation !== 'review' || busy || rereading || stopping}
      blocked={!!view.pending || !!upload?.busy || !!upload?.pending || uploadDraft || view.hasDraft || [...dirtyIds].some(id => id !== 'rollback-input')}
      apply={c => void apply(c)} onDirty={onDirty} />}
    {view?.signedIn && accessKnown && !view.authorized && showAccessStatus &&
      <WorkbenchNoAccess need="查看资料批次" detail="没有权限，请找人开通。" />}
    {view?.authorized && <div className="intake-stage">
      {!inDetail && batchListLoading && <WorkbenchLoading label="读取资料批次" />}
      {hasLoadedBatches && <section aria-label="资料批次列表" hidden={inDetail}>
        <div className="intake-candidate-head">
          <h2>资料批次</h2>
          <div className="intake-toolbar">
            <ActionButton disabled={disabled || dirty || view.hasDraft || uploadDraft} onClick={() => void apply({ action: 'list', next: false })}>刷新批次</ActionButton>
            <ActionButton disabled={disabled || dirty || view.hasDraft || uploadDraft || !view?.moreCandidates} onClick={() => void apply({ action: 'list', next: true })}>下一页批次</ActionButton>
            {view.selected && <ActionButton onClick={() => setDetailOpen(true)}>继续当前审核</ActionButton>}
            <Segmented
              aria-label="批次筛选"
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
            ? '这个筛选下没有资料批次。'
            : upload?.authorized ? '上传资料并通过校验后，会显示在这里。' : '有可查看的资料批次时，会显示在这里。' }} />
        {(dirty || view.hasDraft) && <p role="status">当前审核有未提交的输入，请继续当前审核，或进入详情后放弃输入。</p>}
      </section>}
      {view.selected && <section className="intake-sheet" aria-label="批次详情" hidden={!inDetail}>
        <div className="intake-toolbar"><ActionButton onClick={() => setDetailOpen(false)}>返回批次列表</ActionButton>
          <ActionButton disabled={disabled} onClick={() => confirm('放弃尚未提交的输入并关闭当前审核？已提交的记录不会撤销。', () => void apply({ action: 'discard' }))}>放弃输入并关闭</ActionButton></div>
        <h2 ref={detailHeading} id={`${sectionId}-candidate`} tabIndex={-1}>{candidateCategory(selectedRow?.scopeLabel, view.material?.materialHeader.scope.domain)} / {shortBatchId(view.selected.key.candidateId)}</h2>
        <p className="intake-muted">修订 {view.selected.key.version} / 更新于 {formatSeatClock(view.selected.updatedAt)}</p>
        <p>{candidateState(view.selected)}：{['awaiting-evidence','ready'].includes(view.selected.state)
          ? [...new Set(view.selected.readinessReasons.map(readinessLabel))].join(' / ') || '基础证据已齐备，发布仍须独立核验' : '此版本不再接受修改或发布。'}</p>
        {(view.canRevise || view.canCancel) && <div className="intake-toolbar">
          {view.canRevise && <ActionButton disabled={disabled || dirty || view.hasDraft} onClick={() => confirm('上传这份资料的修订版？请上传完整修订稿。校验成功后旧版失效，新版须重新确认来源和审核；校验失败保留旧版。', () => void apply({ action: 'revise' }))}>上传修订版</ActionButton>}
          {view.canCancel && <ActionButton danger disabled={disabled || dirty || view.hasDraft} onClick={() => confirm('确认取消这份资料？取消成功后该版本不能再发布，已发布内容不受影响。这不是停止本机等待。', () => void apply({ action: 'cancel-candidate' }), true)}>取消这份资料</ActionButton>}
        </div>}
        <ActionButton disabled={disabled} onClick={() => void apply({ action: 'refresh-candidate' })}>刷新审核状态</ActionButton>
        {step && <p className="intake-review-progress" aria-label="当前步骤">当前：{step.title}</p>}
        <div className="intake-toolbar" role="navigation" aria-label="审核内容">
          {(['material', 'source', 'quality', ...(view.selected.publicationPolicy === 'approval-v1' ? ['legacy'] as const : ['publish'] as const)] as const).map(target =>
            <ActionButton key={target} aria-pressed={pane === target} onClick={() => setReviewPane(target)}>
              {{ material: '原始材料', source: '来源确认', quality: '人工质量检查', publish: '发布资料', legacy: '历史审批' }[target]}
            </ActionButton>)}
        </div>
        <div hidden={pane !== 'material' && pane !== 'source'}>
        <h2 id={`${sectionId}-material`} tabIndex={-1}>核对材料</h2>
        <div className="intake-toolbar"><ActionButton type={view.material ? 'default' : 'primary'} disabled={disabled || qualityDirty || view.hasDraft} onClick={() => void apply({ action: 'material', next: false })}>查看材料</ActionButton></div>
        {view.material && <MaterialPage key={`${view.selected.key.digest}-${view.materialPage}`} material={view.material} disabled={disabled || qualityDirty || view.hasDraft} apply={c => void apply(c)} pageIndex={view.materialPage} />}
        </div>
        <CandidateWorkflow key={view.selected.key.digest} view={view} disabled={disabled || qualityDirty} apply={c => void apply(c)} onDirty={onDirty} sectionId={sectionId}
          open={pane}>
          <section aria-label="人工质量检查" hidden={pane !== 'quality'}><h2 id={`${sectionId}-quality`} tabIndex={-1}>人工质量检查</h2>
          <p>检查范围由本轮抽样确定。暂存判断后需提交本轮审核，整批发布另行确认。</p>
          {view.selected.publicationPolicy === 'approval-v1' ? <p>旧版资料需先修订或重新导入，才能直接发布。</p> : null}
          {view.canReview ? <div className="intake-toolbar"><ActionButton type={quality ? 'default' : 'primary'} disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'initial' })}>读取审核清单</ActionButton>
            <ActionButton disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'expanded' })}>读取追加检查</ActionButton></div> : <p>当前没有此来源的检查权限。</p>}
        {quality && <><h3>{states[quality.status.state] ?? quality.status.state}</h3><p>本轮 {quality.total} 条，已填写 {quality.checked} 条</p>
          {!quality.status.frozen && <><ActionButton type="primary" disabled={disabled || workflowDirty} onClick={() => void apply({ action: 'freeze' })}>开始本轮审核</ActionButton></>}
          <div className="intake-toolbar"><ActionButton disabled={disabled || dirty || quality.offset === 0} onClick={() => void apply({ action: 'quality-page', offset: Math.max(0, quality.offset - 20) })}>上一页检查</ActionButton>
            <ActionButton disabled={disabled || dirty || quality.offset + 20 >= quality.total} onClick={() => void apply({ action: 'quality-page', offset: quality.offset + 20 })}>下一页检查</ActionButton></div>
          {quality.samples.map(sample => <CheckRow key={`${view.selected!.key.digest}-${quality.phase}-${quality.offset}-${sample.scriptId}`} sample={sample}
            disabled={disabled || workflowDirty || !editable} onDirty={onDirty} save={c => void apply(c)} />)}
          <ActionButton type={quality.status.frozen ? 'primary' : 'default'} disabled={disabled || dirty || quality.checked !== quality.total || !editable}
            onClick={() => void apply({ action: 'submit' })}>提交本轮审核</ActionButton>
        </>}
          </section>
        </CandidateWorkflow>
        {view.receipt && <p role="status">操作回执：{states[view.receipt.state] ?? view.receipt.state}。这是本次操作记录，请重新读取检查状态。</p>}
      </section>}
    </div>}
    </div>
  </section></ConfigProvider></IntakeAntdTheme>;
}
