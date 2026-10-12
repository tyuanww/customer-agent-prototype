import type { components } from '@customer-agent/contracts';
import { exactKeys } from './product-session';
import { isIntakeUploadCommand, type IntakeUploadCommand, type IntakeUploadView } from './content-intake-upload';
type C = components['schemas'];
/** UI supplies intent only: no HTTP path, actor, candidate digest, grant or operation ID. */
export type IntakeManagementCommand =
  | IntakeUploadCommand
  | IntakeRollbackCommand
  | { action: 'list'; next: boolean }
  | { action: 'select'; selection: string }
  | { action: 'material'; next: boolean }
  | { action: 'quality'; phase: 'initial' | 'expanded' }
  | { action: 'quality-page'; offset: number }
  | { action: 'check'; scriptId: string; defect: boolean; reason: string }
  | { action: 'confirm-source'; versionKind: 'integer' | 'opaque'; versionValue: string; reason: string }
  | { action: 'publish'; title: string; summary: string }
  | { action: 'freeze' | 'submit' | 'recover' | 'retry' | 'discard' | 'refresh-candidate' | 'request-review' | 'read-review' | 'refresh-review' | 'revise' | 'cancel-candidate' };
export type QualityPage = {
  status: C['IntakeQualityStatus']; phase: 'initial' | 'expanded'; offset: number; total: number; checked: number;
  samples: (C['IntakeQualitySample'] & { draft: C['IntakeQualityCheck'] | null })[];
};
export type IntakeRollbackCommand =
  | { action: 'rollback-preview'; baseReleaseId: string; targetReleaseId: string }
  | { action: 'rollback-request-review' | 'rollback-read-review' | 'rollback-refresh-review' | 'rollback-execute' | 'rollback-recover' | 'rollback-retry' | 'rollback-discard' | 'rollback-correct' };
/** Presentation only: plan/digest, approval attachments and operation keys stay in Main. */
export type IntakeRollbackView = {
  available: boolean;
  impact: Pick<C['IntakeRollbackImpact'], 'baseReleaseId' | 'targetReleaseId' | 'scopes' | 'requiresCorrectiveCandidate'> | null;
  review: Pick<C['IntakeRollbackReview'], 'state' | 'checkedAt' | 'validUntil' | 'instanceCode'> | null;
  pending: { action: 'review-request' | 'review-refresh' | 'rollback'; recovery: 'receipt' | 'retry'; retryAllowed?: boolean } | null;
  result: { state: C['IntakeRollbackReceipt']['state']; releaseId: string | null } | null;
  hasReview: boolean; canExecute: boolean;
};
export type IntakeManagementView = {
  rollback: IntakeRollbackView;
  upload: IntakeUploadView;
  signedIn: boolean; displayName: string; authorized: boolean; validUntil: string | null;
  candidates: { selection: string; scopeLabel: string; candidate: C['IntakeCandidate'] }[]; moreCandidates: boolean;
  selected: C['IntakeCandidate'] | null; material: C['IntakeCandidatePage'] | null;
  canReview: boolean; quality: QualityPage | null; hasDraft: boolean;
  canConfirmSource: boolean; canPublish: boolean; canRevise: boolean; canCancel: boolean;
  review: C['IntakeReview'] | null;
  /** Historical result only. The current candidate is always read separately. */
  workflowResult: { operationId: string; action: 'source-confirm' | 'review-request' | 'review-refresh' | 'publish' | 'cancel'; state: string; releaseId: string | null } | null;
  pending: { action: C['IntakeQualityReceipt']['action'] | 'source-confirm' | 'review-request' | 'review-refresh' | 'publish' | 'cancel'; operationId: string; recovery: 'receipt' | 'retry'; retryAllowed?: boolean } | null;
  receipt: C['IntakeQualityReceipt'] | null;
};
export type IntakeManagementReply = { ok: true; view: IntakeManagementView } | { ok: false; code: string; message: string; view: IntakeManagementView | null };
export type IntakeManagementApi = {
  mode(): Promise<{ ok: boolean; enabled: boolean }>;
  current(): Promise<IntakeManagementReply>;
  command(command: IntakeManagementCommand): Promise<IntakeManagementReply>;
  onInvalidated(listener: () => void): () => void;
};
export function isIntakeManagementCommand(raw: unknown): raw is IntakeManagementCommand {
  if (isIntakeUploadCommand(raw)) return true;
  if (!raw || typeof raw !== 'object' || !('action' in raw)) return false;
  const r = raw as Record<string, unknown>;
  if (r.action === 'rollback-preview') return exactKeys(r, ['action','baseReleaseId','targetReleaseId']) && text(r.baseReleaseId, 128) && text(r.targetReleaseId, 128) && r.baseReleaseId !== r.targetReleaseId;
  if (['rollback-request-review','rollback-read-review','rollback-refresh-review','rollback-execute','rollback-recover','rollback-retry','rollback-discard','rollback-correct'].includes(r.action as string)) return exactKeys(r, ['action']);
  if (r.action === 'list' || r.action === 'material') return exactKeys(r, ['action','next']) && typeof r.next === 'boolean';
  if (r.action === 'select') return exactKeys(r, ['action','selection']) && typeof r.selection === 'string' && r.selection.length <= 128 && r.selection.length > 0;
  if (r.action === 'quality') return exactKeys(r, ['action','phase']) && (r.phase === 'initial' || r.phase === 'expanded');
  if (r.action === 'quality-page') return exactKeys(r, ['action','offset']) && Number.isSafeInteger(r.offset) && (r.offset as number) >= 0;
  if (r.action === 'check') return exactKeys(r, ['action','scriptId','defect','reason']) && typeof r.scriptId === 'string' && r.scriptId.length <= 128
    && typeof r.defect === 'boolean' && typeof r.reason === 'string' && [...r.reason].length <= 1000;
  if (r.action === 'confirm-source') return exactKeys(r, ['action','versionKind','versionValue','reason'])
    && (r.versionKind === 'integer' || r.versionKind === 'opaque') && text(r.versionValue, 128) && text(r.reason, 512)
    && (r.versionKind !== 'integer' || /^(0|[1-9][0-9]{0,18})$/u.test(r.versionValue as string));
  if (r.action === 'publish') return exactKeys(r, ['action','title','summary']) && text(r.title, 256) && text(r.summary, 2048);
  return ['freeze','submit','recover','retry','discard','refresh-candidate','request-review','read-review','refresh-review','revise','cancel-candidate'].includes(r.action as string) && exactKeys(r, ['action']);
}

function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && [...value].length <= max; }
