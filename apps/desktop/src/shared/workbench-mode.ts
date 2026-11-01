export type WorkbenchKind = 'product-remote' | 'faq-v2' | 'legacy' | 'synthetic-offline';

export type WorkbenchModeReply =
  | { ok: true; kind: WorkbenchKind }
  | { ok: false; code: 'FORBIDDEN' };

export function workbenchKind(profile: {
  readonly mode?: 'synthetic-local' | 'product-remote';
  readonly contentIntake?: 'faq-v2';
} | null | undefined): WorkbenchKind {
  if (!profile) return 'synthetic-offline';
  if (profile.mode === 'product-remote') return 'product-remote';
  if (profile.contentIntake === 'faq-v2') return 'faq-v2';
  return 'legacy';
}
