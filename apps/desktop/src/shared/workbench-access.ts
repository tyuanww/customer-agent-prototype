import type { SessionJobView } from './product-session';

/**
 * What a person sees when the workbench will not let them do something.
 *
 * This decides display only. Whether an action is allowed is decided by the server and by the
 * session's job rights, which arrive already computed in `SessionJobView`; this module reads
 * them and says, in the person's words, what is missing. A block that names a role says whom to ask. It never grants,
 * widens or infers access, and a `null` answer means "show the control", not "the action will
 * succeed". The server still checks.
 *
 * Upload SOP names 客服主管. A resolved job without grant shows 「没有权限，请找人开通。」
 * because the server does not yet send allowed, reason, and askRole. Who may grant is still
 * `job.rights`, which mirrors the job roster. The knowledge base is not here: it gates on the
 * session role in `desk-knowledge-ipc.ts`, and repeating that rule here would create a second owner.
 */
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
  // A missing job means the session did not deliver it, which a fresh sign-in fixes. A blank,
  // unknown or duplicate title is a roster problem only an administrator can fix.
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
