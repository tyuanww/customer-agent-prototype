import type { components } from '@customer-agent/contracts';

type IntakeAction = components['schemas']['IntakeAction'];

export const INTAKE_POSTS = ['客服', '客服主管'] as const;
export type IntakePost = (typeof INTAKE_POSTS)[number];
export const DEFAULT_INTAKE_POST: IntakePost = '客服';

const POST_ACTIONS = {
  客服: ['query'],
  客服主管: ['content-manage', 'import', 'source-confirm', 'publish'],
} as const satisfies Record<IntakePost, readonly IntakeAction[]>;

export type IntakePostActions =
  | { ok: true; actions: readonly IntakeAction[] }
  | { ok: false; error: 'unknown-post' };

export function isIntakePost(value: string): value is IntakePost {
  return (INTAKE_POSTS as readonly string[]).includes(value);
}

export function actionsForIntakePost(post: unknown): IntakePostActions {
  if (typeof post !== 'string' || !isIntakePost(post)) return { ok: false, error: 'unknown-post' };
  return { ok: true, actions: [...POST_ACTIONS[post]] };
}

function sameActionSet(expected: readonly IntakeAction[], actual: readonly unknown[]): boolean {
  if (expected.length !== actual.length || actual.some(action => typeof action !== 'string')) return false;
  const left = [...expected].sort();
  const right = [...actual].sort();
  return left.every((action, index) => action === right[index]);
}

export function intakePostForActions(actions: readonly unknown[]): IntakePost | null {
  for (const post of INTAKE_POSTS) {
    const mapped = actionsForIntakePost(post);
    if (mapped.ok && sameActionSet(mapped.actions, actions)) return post;
  }
  return null;
}

export function intakePostsCoveredBy(scopeActions: readonly unknown[]): IntakePost[] {
  return INTAKE_POSTS.filter(post => {
    const mapped = actionsForIntakePost(post);
    return mapped.ok && mapped.actions.every(action => scopeActions.includes(action));
  });
}

export type IntakeGrantPostStatus = {
  post: IntakePost | null;
  status: '未授权' | '已授权' | '已撤销' | '已过期';
};

function grantStillCovers(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return true;
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires > now;
}

export function intakePostStatusForGrants(grants: readonly { action: unknown; revoked: boolean; expiresAt?: string | null }[], now = Date.now()): IntakeGrantPostStatus {
  const live = grants.filter(grant => !grant.revoked && grantStillCovers(grant.expiresAt, now));
  if (live.length === 0) {
    const expired = grants.filter(grant => !grant.revoked && !grantStillCovers(grant.expiresAt, now));
    if (expired.length > 0) return { post: intakePostForActions([...new Set(expired.map(grant => grant.action))]), status: '已过期' };
    return { post: null, status: grants.length > 0 ? '已撤销' : '未授权' };
  }
  return { post: intakePostForActions([...new Set(live.map(grant => grant.action))]), status: '已授权' };
}
