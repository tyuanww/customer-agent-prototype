import type { components } from '@customer-agent/contracts';
import { exactKeys } from './product-session';

type C = components['schemas'];
/** Renderer supplies choices only; Main owns identifiers, bytes and original write operations. */
export type IntakeUploadCommand =
  | { action: 'upload-source'; selection: string }
  | { action: 'upload-submit'; preparerSelection: string; editorSelections: string[]; confirmed: true }
  | { action: 'upload-choose' | 'upload-refresh' | 'upload-retry' | 'upload-stop' | 'upload-save-report' | 'upload-reset' | 'upload-open' };
export type IntakeUploadPhase = 'idle' | 'selected' | 'choosing' | 'confirming' | 'uploading' | 'receiving'
  | 'parsing' | 'failed' | 'validated' | 'unknown' | 'stopped';
export type IntakeUploadView = {
  draftRevision: number; phase: IntakeUploadPhase; busy: boolean; authorized: boolean; validUntil: string | null;
  /** Display only. Main retains the complete old key; renderer cannot replace it. */
  revisionOf: { candidateId: string; version: number } | null;
  sources: { selection: string; label: string }[]; sourceSelection: string | null;
  file: { name: string; bytes: number } | null;
  principals: { selection: string; displayLabel: string; enabled: boolean }[];
  preparerSelection: string | null; editorSelections: string[]; confirmed: boolean;
  pending: 'upload' | 'receive' | null;
  job: Pick<C['IntakeParseJob'], 'state' | 'issues' | 'totalIssues' | 'excludedSheetCount' | 'excludedMediaCount'> | null;
  canChoose: boolean; canSubmit: boolean; canRetry: boolean; canRefresh: boolean;
  canStop: boolean; canSaveReport: boolean; canOpen: boolean; canReset: boolean; notice: string | null;
};
export const INTAKE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** 134,999 bounded issues produced 2,727,593 bytes (~2.60 MiB) in packages/content-intake/scripts/probe-issue-report.mjs. */
export const INTAKE_REPORT_MAX_BYTES = 8 * 1024 * 1024;
const selection = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function isIntakeUploadCommand(raw: unknown): raw is IntakeUploadCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('action' in raw)) return false;
  const r = raw as Record<string, unknown>;
  if (r.action === 'upload-source') return exactKeys(r, ['action', 'selection']) && selection(r.selection);
  if (r.action === 'upload-submit') return exactKeys(r, ['action', 'preparerSelection', 'editorSelections', 'confirmed'])
    && selection(r.preparerSelection) && r.confirmed === true && Array.isArray(r.editorSelections)
    && r.editorSelections.length >= 1 && r.editorSelections.length <= 98 && r.editorSelections.every(selection)
    && new Set(r.editorSelections).size === r.editorSelections.length;
  return ['upload-choose', 'upload-refresh', 'upload-retry', 'upload-stop', 'upload-save-report', 'upload-reset', 'upload-open'].includes(r.action as string)
    && exactKeys(r, ['action']);
}
