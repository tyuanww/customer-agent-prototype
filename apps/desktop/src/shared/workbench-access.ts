import type { SessionJobView } from './product-session';

/** Display only. The server still checks. `null` while `signedIn` is null means the session has not answered. `null` when the job holds the ability means show the control. Upload SOP asks 客服主管 until the server sends `askRole`. Knowledge gating stays in `desk-knowledge-ipc.ts`. */
export type WorkbenchAbility = 'grant' | 'upload-sop';

export type AccessAsk = '客服主管' | '管理员';

export type AccessBlock = Readonly<{
  /** The missing ability, completing 「你还不能…」. */
  need: string;
} & (
  | { ask: AccessAsk; detail?: string }
  | { detail: string; ask?: undefined }
)>;

const NEED: Readonly<Record<WorkbenchAbility, string>> = Object.freeze({
  grant: '给他人开通权限',
  'upload-sop': '上传 SOP',
});

function holds(job: Extract<SessionJobView, { status: 'resolved' }>, ability: WorkbenchAbility): boolean {
  return ability === 'grant' ? job.rights.grant : job.rights.uploadSop;
}

/**
 * `signedIn` null means the session has not answered yet: show nothing, the page is loading.
 * An unresolved job means the person's title was not recognised, which an administrator fixes.
 */
export function accessBlock(
  ability: WorkbenchAbility,
  signedIn: boolean | null,
  job: SessionJobView | null,
): AccessBlock | null {
  if (signedIn === null) return null;
  const need = NEED[ability];
  if (!signedIn) return { need, ask: '管理员', detail: '请先登录。' };
  if (!job || (job.status === 'unresolved' && job.reason === 'missing')) {
    return { need, ask: '管理员', detail: '请重新登录后再查看职务。' };
  }
  if (job.status === 'unresolved') {
    return { need, ask: '管理员', detail: '你的职务还没有登记，请联系管理员。' };
  }
  if (job.permission === 'expired') return { need, ask: '管理员', detail: '登录状态需要确认，请重新登录。' };
  if (holds(job, ability)) return null;
  if (ability === 'upload-sop') return { need, ask: '客服主管' };
  return { need, detail: '没有权限，请找人开通。' };
}
