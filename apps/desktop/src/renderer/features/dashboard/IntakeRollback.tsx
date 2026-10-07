import { useEffect, useState } from 'react';
import type { IntakeManagementCommand, IntakeManagementView } from '@shared/content-intake-management';
const labels: Record<string, string> = { creating: '审批创建结果待确认', pending: '待审批', approved: '审批已通过', rejected: '审批未通过', revoked: '审批已撤回', unavailable: '审批结果尚未核验', published: '回退已发布', unknown: '回退结果待确认', failed: '回退未完成', cancelled: '回退已取消' };
/** Rollback is a separate review of the entire catalog. Its controls only send
 * human intent; Main retains material identity and any uncertain operation. */
export function IntakeRollback({ view, busy, blocked, apply, onDirty }: { view: Pick<IntakeManagementView, 'rollback' | 'candidates'>; busy: boolean; blocked: boolean;
  apply: (command: IntakeManagementCommand) => void; onDirty: (id: string, dirty: boolean) => void }) {
  const [base, setBase] = useState(''), [target, setTarget] = useState('');
  const rollback = view.rollback, impact = rollback.impact, review = rollback.review;
  const disabled = busy || blocked || !!rollback.pending;
  useEffect(() => { onDirty('rollback-input', !!base || !!target); return () => onDirty('rollback-input', false); }, [base, target, onDirty]);
  useEffect(() => { if (impact) { setBase(''); setTarget(''); } }, [impact]);
  const reset = () => { setBase(''); setTarget(''); apply({ action: 'rollback-discard' }); };
  return <section aria-label="已发布目录纠正回退">
    <h2>纠正已发布内容</h2><p>回退影响整个发布目录，不是只撤销某个店铺。先查看影响范围，再单独发起飞书复核；原候选审批不能复用。</p>
    {rollback.pending && <div className="intake-notice" aria-label="待恢复回退操作"><h3>回退操作结果待确认</h3>
      <p>请恢复原操作。确认最终结果前，不能更换计划或重复创建审批。</p>
      {rollback.pending.recovery === 'receipt' && <button disabled={busy} onClick={() => apply({ action: 'rollback-recover' })}>查询原回退回执</button>}
      <button disabled={busy} onClick={() => apply({ action: 'rollback-retry' })}>重试原回退操作</button>
    </div>}
    {rollback.result && <p role="status">{labels[rollback.result.state] ?? '回退结果待确认'}{rollback.result.releaseId ? ` · 新发布版本 ${rollback.result.releaseId}。坐席重新查询后读取新版本。` : ''}</p>}
    {rollback.available && <>
      {!impact && <fieldset disabled={disabled}>
        <legend>选择回退版本</legend><p>当前只支持回退到上一发布版本，不支持任意历史版本。请输入发布记录中的当前版本与上一发布版本编号；服务端会验证基线、权限和内容是否仍可使用。</p>
        <label>当前发布版本<input aria-label="当前发布版本" value={base} maxLength={128} onChange={e => setBase(e.target.value)} list="intake-release-options" /></label>
        <label>目标历史版本<input aria-label="目标历史版本" value={target} maxLength={128} onChange={e => setTarget(e.target.value)} list="intake-release-options" /></label>
        <datalist id="intake-release-options">{[...new Set(view.candidates.flatMap(row => row.candidate.publishedReleaseId ? [row.candidate.publishedReleaseId] : []))].map(id => <option key={id} value={id} />)}</datalist>
        <button disabled={!base.trim() || !target.trim() || base.trim() === target.trim()} onClick={() => apply({ action: 'rollback-preview', baseReleaseId: base.trim(), targetReleaseId: target.trim() })}>查看回退影响</button>
        {(base || target) && <button onClick={reset}>清空回退输入</button>}
      </fieldset>}
      {impact && <>
        <p>当前版本 {impact.baseReleaseId} → 目标历史版本 {impact.targetReleaseId}</p>
        <h3>{impact.requiresCorrectiveCandidate ? '有权查看的影响范围' : '全部受影响范围'}</h3><ul>{impact.scopes.map((scope, index) => <li key={index}>品牌 {scope.brandId} · {scope.shopId ? `店铺 ${scope.shopId}` : '品牌通用'} · 来源 {scope.sourceId ?? '未指定'}</li>)}</ul>
        {impact.requiresCorrectiveCandidate ? <div className="intake-notice"><h3>需要提交纠正候选</h3><p>影响超出当前授权范围，列表不包含无权查看的来源，不能据此执行整库回退。请在有权范围内上传完整纠正稿，重新校验、审批与发布。</p>
          <button disabled={disabled} onClick={() => { apply({ action: 'rollback-correct' }); }}>返回上传纠正稿</button></div> : <>
          <div className="intake-toolbar">
            <button disabled={disabled || (!!review && review.state === 'creating')} onClick={() => {
              if (!review || window.confirm('重新发起回退复核将替换当前审核记录。确认继续？')) apply({ action: 'rollback-request-review' });
            }}>{review ? '重新发起回退复核' : '发起回退复核'}</button>
            <button disabled={disabled || !rollback.hasReview} onClick={() => apply({ action: 'rollback-read-review' })}>读取回退审批</button>
            <button disabled={disabled || !rollback.hasReview} onClick={() => apply({ action: 'rollback-refresh-review' })}>核验回退审批</button>
          </div>
          {review && <div role="status"><p>{labels[review.state]}{review.instanceCode ? ` · 审批编号 ${review.instanceCode}` : ''}</p>
            <p>最近核验：{review.checkedAt ?? '尚未核验'} · 有效至：{review.validUntil ?? '尚无有效核验'}。执行时仍会重新校验。</p></div>}
          <button className="intake-danger" disabled={disabled || !rollback.canExecute} onClick={() => {
            if (window.confirm(`确认将整个目录恢复为上一发布版本 ${impact.targetReleaseId} 的可用内容？将影响上述全部范围，并创建新的发布版本。`)) apply({ action: 'rollback-execute' });
          }}>确认回退并发布</button>
        </>}
        <button disabled={disabled} onClick={reset}>关闭回退计划</button>
      </>}
    </>}
  </section>;
}
