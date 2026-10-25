import type { IntakePermissionView } from './content-intake-permissions';
import type { DashboardSopNode } from './dashboard-ops-loop';

export const GRANTABLE_ACTIONS = [
  'query', 'content-manage', 'import', 'source-confirm',
  'publish', 'candidate-cancel', 'rollback',
] as const;

export type GrantableAction = (typeof GRANTABLE_ACTIONS)[number];

const grantable: ReadonlySet<string> = new Set(GRANTABLE_ACTIONS);

export function authorizationAllowsGrant(
  capabilities: readonly { readonly mayAllocate: readonly string[] }[],
): boolean {
  return capabilities.some((row) => row.mayAllocate.some((action) => grantable.has(action)));
}

export const openGrantBrand: unique symbol = Symbol('page-use.open-grant');

export type OpenGrant = { readonly state: 'open'; readonly [openGrantBrand]: true };

export type PermissionsUse =
  | { readonly state: 'pending' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'closed'; readonly recovery: string | null }
  | { readonly state: 'open'; readonly body: IntakePermissionView | null };

export type SopUse =
  | { readonly state: 'pending' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'closed' }
  | { readonly state: 'open'; readonly nodes: readonly DashboardSopNode[] };

export type PageUseSnapshot =
  | { readonly phase: 'signed-out' }
  | {
      readonly phase: 'ready';
      readonly epoch: number;
      readonly permissions: PermissionsUse;
      readonly sop: SopUse;
    };

export type PageUseApi = {
  current(): Promise<PageUseSnapshot>;
  onChanged(listener: (snapshot: PageUseSnapshot) => void): () => void;
};

export function canOpenPermissions(snapshot: PageUseSnapshot): boolean {
  return snapshot.phase === 'ready' && snapshot.permissions.state === 'open';
}

export function canGrant(snapshot: PageUseSnapshot): boolean {
  return canOpenPermissions(snapshot);
}

export function canUploadSop(snapshot: PageUseSnapshot): boolean {
  return snapshot.phase === 'ready' && snapshot.sop.state === 'open';
}

export function grantUse(
  capabilities: readonly { readonly mayAllocate: readonly string[] }[],
  recovery: string | null,
): OpenGrant | { readonly state: 'closed'; readonly recovery: string | null } {
  if (!authorizationAllowsGrant(capabilities)) return { state: 'closed', recovery };
  return { state: 'open', [openGrantBrand]: true };
}

export function withPermissionsBody(
  gate: OpenGrant,
  body: IntakePermissionView,
): Extract<PermissionsUse, { state: 'open' }> & { readonly body: IntakePermissionView } {
  void gate;
  return { state: 'open', body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isPermissionsUse(value: unknown): value is PermissionsUse {
  if (!isRecord(value) || typeof value.state !== 'string') return false;
  if (value.state === 'pending' || value.state === 'unavailable') return !('body' in value);
  if (value.state === 'closed') {
    return !('body' in value) && (value.recovery === null || typeof value.recovery === 'string');
  }
  return value.state === 'open' && (value.body === null || isRecord(value.body));
}

function isSopUse(value: unknown): value is SopUse {
  if (!isRecord(value) || typeof value.state !== 'string') return false;
  if (value.state === 'pending' || value.state === 'unavailable' || value.state === 'closed') {
    return !('nodes' in value);
  }
  return value.state === 'open' && Array.isArray(value.nodes);
}

export function isPageUseSnapshot(value: unknown): value is PageUseSnapshot {
  if (!isRecord(value)) return false;
  if (value.phase === 'signed-out') return !('permissions' in value) && !('sop' in value);
  return value.phase === 'ready'
    && typeof value.epoch === 'number'
    && Number.isSafeInteger(value.epoch)
    && isPermissionsUse(value.permissions)
    && isSopUse(value.sop);
}
