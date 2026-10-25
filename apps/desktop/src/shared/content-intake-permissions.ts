import type { components } from '@customer-agent/contracts';
import { GRANTABLE_ACTIONS } from './page-use';
import { exactKeys } from './product-session';
type Action = components['schemas']['IntakeAction'];
export type IntakePermissionCommand =
  | { action: 'refresh' | 'save' | 'retry' | 'discard' | 'stop' }
  | { action: 'source'; selection: string }
  | { action: 'preview'; person: string; actions: Action[]; startsAt: string; expiresAt: string; reason: string }
  | { action: 'revoke'; selection: string; reason: string };
export type IntakePermissionView = {
  signedIn: boolean; available: boolean; busy: boolean; validUntil: string | null;
  sources: { selection: string; label: string }[]; source: string | null;
  people: { selection: string; label: string }[]; actions: Action[];
  grants: { selection: string; reference: string; person: string; personSelection: string | null; action: Action; scope: string; startsAt: string; reason: string; expiresAt: string; revoked: boolean; canRevoke: boolean }[];
  preview: { person: string; actions: Action[]; scope: string; startsAt: string; expiresAt: string; reason: string } | null;
  pending: boolean; resultUnknown: boolean; notice: string | null;
};
export type IntakePermissionReply = { ok: true; view: IntakePermissionView } | { ok: false; message: string; view: IntakePermissionView | null };
export type IntakePermissionApi = { current(): Promise<IntakePermissionReply>; command(command: IntakePermissionCommand): Promise<IntakePermissionReply>; onInvalidated(listener: () => void): () => void };
const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;
export function isIntakePermissionCommand(value: unknown): value is IntakePermissionCommand {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string,unknown>;
  if (['refresh','save','retry','discard','stop'].includes(r.action as string)) return exactKeys(r,['action']);
  if (r.action === 'source') return exactKeys(r,['action','selection']) && text(r.selection,128);
  if (r.action === 'revoke') return exactKeys(r,['action','selection','reason']) && text(r.selection,128) && text(r.reason,512);
  return r.action === 'preview' && exactKeys(r,['action','person','actions','startsAt','expiresAt','reason']) && text(r.person,128)
    && text(r.reason,512) && text(r.startsAt,35) && text(r.expiresAt,35) && Array.isArray(r.actions) && r.actions.length > 0 && r.actions.length <= 8
    && new Set(r.actions).size === r.actions.length && r.actions.every(a => typeof a === 'string' && (GRANTABLE_ACTIONS as readonly string[]).includes(a));
}
export const INTAKE_PERMISSION_ACTION_LABELS: Readonly<Record<Action,string>> = { query:'查询复制', 'content-manage':'查看与管理资料',import:'上传资料','source-confirm':'确认来源',review:'旧审批（不提供新配置）',publish:'发布资料','candidate-cancel':'取消候选',rollback:'回退发布' };
