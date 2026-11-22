export type WorkbenchMode =
  | { kind: 'legacy' }
  // The Query entry is wired for this run. The Query window still checks session and workflow access.
  | { kind: 'product-remote' | 'faq-v2'; manualSopEntry: boolean };

export type WorkbenchKind = WorkbenchMode['kind'];

export type WorkbenchModeReply =
  | ({ ok: true } & WorkbenchMode)
  | { ok: false; code: 'FORBIDDEN' };

export function workbenchKind(profile: {
  readonly mode?: 'synthetic-local' | 'product-remote';
  readonly contentIntake?: 'faq-v2';
} | null | undefined): WorkbenchKind {
  if (!profile) return 'legacy';
  if (profile.mode === 'product-remote') return 'product-remote';
  if (profile.contentIntake === 'faq-v2') return 'faq-v2';
  return 'legacy';
}

