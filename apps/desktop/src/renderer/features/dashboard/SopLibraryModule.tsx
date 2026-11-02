import type { SopUse } from '@shared/page-use';
import { WorkbenchLoading } from './WorkbenchState';

export function SopLibraryModule({ sop }: { sop?: SopUse } = {}) {
  const text = sop?.state === 'not-published' ? 'SOP 流程发布后会显示在这里'
    : sop?.state === 'closed' ? '没有权限，请找人开通。'
    : !sop ? '请先登录后再管理 SOP。'
    : 'SOP 暂时不可用。';
  return <section className="dash-module" data-testid="module-sop" aria-label="SOP">
    <h1 className="desk-sr">SOP</h1>
    {sop?.state === 'pending' ? <WorkbenchLoading rows={3} label="正在读取 SOP" />
      : <p className="ov-empty" data-testid="sop-library-empty">{text}</p>}
  </section>;
}
