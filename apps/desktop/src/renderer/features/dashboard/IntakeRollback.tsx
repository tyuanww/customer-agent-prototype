import { Button, Modal, type ButtonProps } from 'antd';
import { useEffect } from 'react';
import type { IntakeManagementCommand, IntakeManagementView } from '@shared/content-intake-management';
import { formatSeatClock } from './intake-time';
import { joinDisplayParts } from '@shared/display-separator';

function ActionButton(props: ButtonProps) {
  return <Button autoInsertSpace={false} {...props} />;
}
const labels: Record<string, string> = { creating: '审批创建结果待确认', pending: '待审批', approved: '审批已通过', rejected: '审批未通过', revoked: '审批已撤回', unavailable: '审批结果尚未核验', published: '回退已发布', unknown: '回退结果待确认', failed: '回退未完成', cancelled: '回退已取消' };
/** Rollback publishes a new version of the entire catalog. Its controls only send
 * human intent; Main retains material identity and any uncertain operation. */
export function IntakeRollback({ view, busy, blocked, apply, onDirty }: { view: Pick<IntakeManagementView, 'rollback' | 'candidates'>; busy: boolean; blocked: boolean;
  apply: (command: IntakeManagementCommand) => void; onDirty: (id: string, dirty: boolean) => void }) {
  const rollback = view.rollback, impact = rollback.impact, review = rollback.review;
  const disabled = busy || blocked || !!rollback.pending;
  useEffect(() => { onDirty('rollback-input', false); return () => onDirty('rollback-input', false); }, [onDirty]);
  const reset = () => apply({ action: 'rollback-discard' });
  const execute = () => {
    // 取消不发送回退。Main 在真正发布前仍会再用系统对话框核对一次。
    Modal.confirm({
      title: '回退整个发布目录到上一版',
      content: '回退之后不能撤销这次发布。坐席重新查询后会使用上一版内容。要回到现在这一版，需要再发布一次。',
      okText: '确认回退',
      cancelText: '取消',
      focusable: { autoFocusButton: 'cancel' },
      okButtonProps: { danger: true, autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () => apply({ action: 'rollback-execute' }),
      transitionName: '',
      maskTransitionName: '',
    });
  };
  return <section aria-label="已发布目录纠正回退" tabIndex={-1}>
    <h2>纠正已发布内容</h2><p>回退影响整个发布目录，不是只撤销某个店铺。先查看全部影响范围，发布前由系统弹窗再次确认。</p>
    {rollback.pending && <div className="intake-notice" aria-label="待恢复回退操作"><h3>回退操作结果待确认</h3>
      <p>请恢复原操作。确认最终结果前，不能更换计划或创建新的发布操作。</p>
      {rollback.pending.recovery === 'receipt' && <ActionButton disabled={busy} onClick={() => apply({ action: 'rollback-recover' })}>查询原回退回执</ActionButton>}
      {rollback.pending.retryAllowed !== false && <ActionButton disabled={busy} onClick={() => apply({ action: 'rollback-retry' })}>重试原回退操作</ActionButton>}
      {rollback.pending.retryAllowed === false && <p>旧回退操作只能查询原回执，不能转成新的确认发布。</p>}
    </div>}
    {rollback.result && <div role="status"><p>{labels[rollback.result.state] ?? '回退结果待确认'}。</p>{rollback.result.releaseId ? <p>发布号 {rollback.result.releaseId}。坐席重新查询后读取新版本。</p> : null}</div>}
    {rollback.available && <>
      {!impact && <fieldset disabled={disabled}>
        <legend>选择回退版本</legend>
        <p>请先读取当前版和上一版。</p>
      </fieldset>}
      {impact && <>
        <p>当前版</p>
        <p>上一版</p>
        <h3>{impact.requiresCorrectiveCandidate ? '有权查看的影响范围' : '全部受影响范围'}</h3><ul>{impact.scopes.map((scope, index) => <li key={index}>{joinDisplayParts([`品牌 ${scope.brandId}`, scope.shopId ? `店铺 ${scope.shopId}` : '品牌通用', `来源 ${scope.sourceId ?? '未指定'}`])}</li>)}</ul>
        {impact.requiresCorrectiveCandidate ? <div className="intake-notice"><h3>需要提交纠正候选</h3><p>影响超出当前授权范围，列表不包含无权查看的来源，不能据此执行整库回退。请在有权范围内上传完整纠正稿，重新校验、检查与确认发布。</p>
          <ActionButton disabled={disabled} onClick={() => { apply({ action: 'rollback-correct' }); }}>返回上传纠正稿</ActionButton></div> : <>
          {rollback.hasReview && <div className="intake-toolbar"><p>这是历史审批计划，仅可查看记录。请关闭后重新查看回退影响。</p>
            <ActionButton disabled={disabled} onClick={() => apply({ action: 'rollback-read-review' })}>读取历史回退审批</ActionButton>
          </div>}
          {review && <div role="status"><p>{labels[review.state]}{review.instanceCode ? `，审批编号 ${review.instanceCode}` : ''}</p>
            <p>最近核验：{review.checkedAt ? formatSeatClock(review.checkedAt) : '尚未核验'}，有效至：{review.validUntil ? formatSeatClock(review.validUntil) : '尚无有效核验'}</p></div>}
        </>}
        <div className="intake-toolbar">
          {!impact.requiresCorrectiveCandidate && <ActionButton danger disabled={disabled || !rollback.canExecute}
            onClick={execute}>确认回退并发布</ActionButton>}
          <ActionButton disabled={disabled} onClick={reset}>关闭回退计划</ActionButton>
        </div>
      </>}
    </>}
  </section>;
}
