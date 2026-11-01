import type { components } from '@customer-agent/contracts';

type IntakeAction = components['schemas']['IntakeAction'];

export const INTAKE_POSTS = ['客服', '客服主管'] as const;
export type IntakePost = (typeof INTAKE_POSTS)[number];
export const DEFAULT_INTAKE_POST: IntakePost = '客服';

const POST_ACTIONS = {
  客服: ['query'],
  客服主管: ['content-manage', 'import', 'source-confirm', 'publish'],
} as const satisfies Record<IntakePost, readonly IntakeAction[]>;

export const REVIEW_GRANT_ACTIONS = ['content-manage', 'review'] as const satisfies readonly IntakeAction[];
export const INTAKE_GRANT_CHOICES = [...INTAKE_POSTS, '资料审核'] as const;
export type IntakeGrantChoice = (typeof INTAKE_GRANT_CHOICES)[number];

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

export function isIntakeGrantChoice(value: string): value is IntakeGrantChoice {
  return (INTAKE_GRANT_CHOICES as readonly string[]).includes(value);
}

export function actionsForIntakeGrantChoice(choice: IntakeGrantChoice): readonly IntakeAction[] {
  return choice === '资料审核' ? REVIEW_GRANT_ACTIONS : POST_ACTIONS[choice];
}

export function intakeGrantChoicesCoveredBy(scopeActions: readonly unknown[]): IntakeGrantChoice[] {
  return INTAKE_GRANT_CHOICES.filter(choice => actionsForIntakeGrantChoice(choice).every(action => scopeActions.includes(action)));
}

export type IntakeGrantStatus = {
  choices: IntakeGrantChoice[];
  hasOther: boolean;
  status: '未授权' | '已授权' | '部分生效' | '未生效' | '已撤销' | '已过期' | '时间异常';
};

function grantTimestamp(value: string): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/iu.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = parts;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`), timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && calendar.getUTCFullYear() === Number(year)
    && calendar.getUTCMonth() + 1 === Number(month) && calendar.getUTCDate() === Number(day)
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && Number(offsetHour) < 24 && Number(offsetMinute) < 60 ? timestamp : null;
}

export function intakeGrantWindow(grant: { startsAt: string; expiresAt: string }): { start: number; end: number } | null {
  const start = grantTimestamp(grant.startsAt), end = grantTimestamp(grant.expiresAt);
  return start !== null && end !== null && start < end ? { start, end } : null;
}

export function intakeGrantStatusForGrants(grants: readonly { action: unknown; revoked: boolean; startsAt: string; expiresAt: string }[], now = Date.now()): IntakeGrantStatus {
  const live: unknown[] = [], future: unknown[] = [], expired: unknown[] = [];
  let invalid = false;
  for (const grant of grants) {
    if (grant.revoked) continue;
    const window = intakeGrantWindow(grant);
    if (!window || !Number.isFinite(now)) invalid = true;
    else if (now < window.start) future.push(grant.action);
    else if (now >= window.end) expired.push(grant.action);
    else live.push(grant.action);
  }
  const status = invalid ? '时间异常' : live.length && future.length ? '部分生效' : live.length ? '已授权'
    : future.length ? '未生效' : expired.length ? '已过期' : grants.length ? '已撤销' : '未授权';
  const actions = live.length ? live : future.length ? future : expired;
  const choices = intakeGrantChoicesCoveredBy(actions);
  const covered: ReadonlySet<unknown> = new Set(choices.flatMap(choice => actionsForIntakeGrantChoice(choice)));
  return { choices, hasOther: actions.some(action => !covered.has(action)), status };
}
