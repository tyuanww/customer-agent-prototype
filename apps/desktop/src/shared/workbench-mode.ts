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

export const PRODUCT_REMOTE_NAV = Object.freeze([
  { id: 'overview', label: '概览', group: '经营总览' },
  { id: 'wording', label: '话术库', group: '话术运营' },
  { id: 'sop', label: 'SOP', group: '话术运营' },
  { id: 'publish', label: '内容管理', group: '治理与架构' },
  { id: 'announce', label: '系统同步', group: '治理与架构' },
] as const);
