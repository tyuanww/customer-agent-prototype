export type WorkbenchKind = 'product-remote' | 'faq-v2' | 'legacy';

export type WorkbenchModeReply =
  | { ok: true; kind: WorkbenchKind }
  | { ok: false; code: 'FORBIDDEN' };

export function workbenchKind(profile: { apiOrigin: string; contentIntake?: 'faq-v2' } | null | undefined): WorkbenchKind {
  if (!profile) return 'legacy';
  if (profile.contentIntake === 'faq-v2') return 'faq-v2';
  if (profile.apiOrigin.startsWith('https://')) return 'product-remote';
  return 'legacy';
}

