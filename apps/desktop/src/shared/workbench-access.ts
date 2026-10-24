import type { SessionJobView } from './product-session';

/**
 * What a person sees when the workbench will not let them do something.
 *
 * This decides display only. Whether an action is allowed is decided by the server and by the
 * session's job rights, which arrive already computed in `SessionJobView`; this module reads
 * them and says, in the person's words, what is missing and which role to ask. It never grants,
 * widens or infers access, and a `null` answer means "show the control", not "the action will
 * succeed" — the server still checks.
 *
 * Each ability names the role that can open it. That mapping mirrors the job roster's rights
 * (`@customer-agent/job-roster` JOB_ROSTER): supervisors and leads may upload SOP, only managers,
 * directors and engineers may grant. The knowledge base is not here: it gates on the session
 * role in `desk-knowledge-ipc.ts`, and repeating that rule here would create a second owner.
 */
export type WorkbenchAbility = 'grant' | 'upload-sop';

export type AccessAsk = '客服主管' | '你的经理' | '管理员';

export type AccessBlock = Readonly<{
  /** The missing ability, completing 「你还不能…」. */
  need: string;
  ask: AccessAsk;
  /** Replaces the default 「请联系{ask}开通。」 when the cause is not a missing grant. */
  detail?: string;
}>;

const NEED: Readonly<Record<WorkbenchAbility, string>> = Object.freeze({
  grant: '给他人开通权限',
  'upload-sop': '上传 SOP',
});

const ASK: Readonly<Record<WorkbenchAbility, AccessAsk>> = Object.freeze({
  grant: '你的经理',
  'upload-sop': '客服主管',
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
  return holds(job, ability) ? null : { need, ask: ASK[ability] };
}
