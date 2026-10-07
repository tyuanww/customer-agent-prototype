import type { components } from '@customer-agent/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntakeManagementCommand, IntakeManagementView, QualityPage } from '@shared/content-intake-management';
import './intake-management.css';
const states: Record<string, string> = { 'awaiting-evidence': '等待补证', ready: '候选就绪', publishing: '发布中', published: '已发布', cancelled: '已取消', invalidated: '已失效',
  not_frozen: '待冻结抽样', revision_required: '需要修订后重新检查', initial_required: '等待初检', expansion_required: '等待扩检', passed: '质量检查通过', blocked: '质量检查未通过' };
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
export function IntakeManagement() {
  const [view, setView] = useState<IntakeManagementView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), pending = useRef(false);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const onDirty = useCallback((id: string, dirty: boolean) => setDirtyIds(previous => {
    if (previous.has(id) === dirty) return previous;
    const next = new Set(previous); if (dirty) next.add(id); else next.delete(id); return next;
  }), []);
  const apply = async (command?: IntakeManagementCommand) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); const gen = ++generation.current;
    try {
      const api = window.dashboardIntake!;
      const reply = await (command ? api.command(command) : api.current());
      if (generation.current !== gen) return;
      setView(reply.view); if (!reply.ok) setError(reply.message);
    } catch { if (generation.current === gen) { setView(null); setError('管理服务不可用，请刷新。'); } }
    finally { pending.current = false; setBusy(false); }
  };
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
  const disabled = busy || !!view?.pending;
  const quality = view?.quality;
  const dirty = dirtyIds.size > 0;
  const editable = quality?.status.state === (quality?.phase === 'initial' ? 'initial_required' : 'expansion_required');
  return <main className="intake-management">
    <header><div><p className="intake-eyebrow">PILOT-S0 · SYNTHETIC</p><h1>资料审核</h1><p>查看候选材料并完成逐条人工质量检查</p></div><span>{view?.displayName ?? '正在读取会话'}</span></header>
    {error && <p role="alert">{error}</p>}
    {view?.pending && <section className="intake-notice" aria-label="待恢复操作"><h2>操作结果待确认</h2>
      <p>请查询原操作回执。重试会沿用同一操作编号，不会创建新的提交。</p><code>{view.pending.operationId}</code>
      <div><button disabled={busy} onClick={() => void apply({ action: 'recover' })}>查询原操作回执</button>
        <button disabled={busy} onClick={() => void apply({ action: 'retry' })}>重试原操作</button></div></section>}
    <div className="intake-toolbar"><button disabled={disabled || dirty} onClick={() => void apply({ action: 'list', next: false })}>刷新候选</button>
      <button disabled={disabled || dirty || !view?.moreCandidates} onClick={() => void apply({ action: 'list', next: true })}>下一页候选</button>
      {view?.selected && <button disabled={disabled} onClick={() => { if (window.confirm('放弃尚未提交的判断并关闭当前候选？')) void apply({ action: 'discard' }); }}>关闭当前候选</button>}</div>
    {view && !view.signedIn && <p>请先在查询窗口登录。</p>}
    {view?.signedIn && !view.authorized && !view.pending && <p>当前没有可用的资料管理权限，请确认登录身份与店铺授权。</p>}
    {view?.authorized && <>
      <section aria-label="候选列表"><h2>有权范围内的候选</h2>
        {!view.candidates.length && <p>这一页没有候选。</p>}
        <div className="intake-candidates">{view.candidates.map(row => <button key={row.selection} disabled={disabled || dirty || view.hasDraft}
          onClick={() => void apply({ action: 'select', selection: row.selection })}>
          <strong>{row.candidate.sourceId}</strong><span>{states[row.candidate.state]} · 版本 {row.candidate.key.version}</span><small>{row.candidate.key.candidateId}</small>
        </button>)}</div></section>
      {dirty && <p role="status">当前有未保存的判断，请先保存本条判断后再提交或翻页。</p>}
      {view.selected && <section aria-label="当前候选"><h2>当前候选 · {view.selected.sourceId} · 版本 {view.selected.key.version}</h2>
        <p>{states[view.selected.state]} · {view.selected.readinessReasons.join(' / ') || '基础证据已齐备，发布仍须独立核验'}</p>
        <div className="intake-toolbar"><button disabled={disabled} onClick={() => void apply({ action: 'material', next: false })}>查看材料</button>
          <button disabled={disabled || !view.material?.nextCursor} onClick={() => void apply({ action: 'material', next: true })}>下一页材料</button>
          {view.canReview && <><button disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'initial' })}>读取初检</button>
            <button disabled={disabled || dirty || view.hasDraft} onClick={() => void apply({ action: 'quality', phase: 'expanded' })}>读取扩检</button></>}</div>
        {view.material && <section aria-label="当前页材料与差异">
          <p>来源版本：{view.material.materialHeader.sourceClaim.versionValue ?? '尚未确认'} · 风险等级：{view.material.materialHeader.risk.level}</p>
          {view.material.entries.map(entry => <article className="intake-card" key={entry.businessEntryId}><h3>{entry.title}</h3><p className="intake-answer">{entry.answerText}</p><EntryDetails entry={entry} /></article>)}
          <h3>当前页差异</h3>{view.material.differences.map(d => <p key={d.businessEntryId}>{d.businessEntryId} · {({ add: '新增', modify: '修改', disable: '停用', reenable: '重新启用' })[d.change]} · {d.previousVersion ?? '无前版'} → {d.nextVersion}</p>)}
        </section>}
        {quality && <section aria-label="人工质量检查"><h2>{states[quality.status.state] ?? quality.status.state}</h2><p>本轮 {quality.total} 条 · 已填写 {quality.checked} 条</p>
          {!quality.status.frozen && <button disabled={disabled} onClick={() => void apply({ action: 'freeze' })}>冻结本次抽样</button>}
          <div className="intake-toolbar"><button disabled={disabled || dirty || quality.offset === 0} onClick={() => void apply({ action: 'quality-page', offset: Math.max(0, quality.offset - 20) })}>上一页检查</button>
            <button disabled={disabled || dirty || quality.offset + 20 >= quality.total} onClick={() => void apply({ action: 'quality-page', offset: quality.offset + 20 })}>下一页检查</button></div>
          {quality.samples.map(sample => <CheckRow key={`${view.selected!.key.digest}-${quality.phase}-${quality.offset}-${sample.scriptId}`} sample={sample}
            disabled={disabled || !editable} onDirty={onDirty} save={c => void apply(c)} />)}
          <button disabled={disabled || dirty || quality.checked !== quality.total || !editable}
            onClick={() => void apply({ action: 'submit' })}>提交本轮人工检查</button>
        </section>}
        {view.receipt && <p role="status">操作回执：{states[view.receipt.state] ?? view.receipt.state}。这是本次操作记录，请重新读取检查状态。</p>}
      </section>}
    </>}
  </main>;
}
