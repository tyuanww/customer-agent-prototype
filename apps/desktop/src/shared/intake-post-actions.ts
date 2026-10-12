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
