import {
  STACK_SOURCE_REFS,
  type DashboardContentBinding,
  type DashboardContentDomain,
  type DashboardContentRow,
} from './dashboard-content';

const HEADER = [
  'script_id', 'category', 'title', 'answer_text', 'source_version_id', 'source_ref',
  'question_text', 'risk_level', 'has_conflict', 'platform_scope', 'product_scope_type',
  'product_scope_refs', 'placeholder_keys', 'effective_from', 'effective_to',
] as const;

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function frozenImportCsv(
  rows: readonly DashboardContentRow[],
  bindings: readonly DashboardContentBinding[],
): string | null {
  if (rows.length < 1 || bindings.length < 1) return null;
  const byDomain = new Map<DashboardContentDomain, DashboardContentBinding>();
  for (const binding of bindings) byDomain.set(binding.domain, binding);
  const lines = [HEADER.join(',')];
  for (const [index, row] of rows.entries()) {
    const domain = row.domain;
    if (!domain) return null;
    const binding = byDomain.get(domain);
    if (!binding) return null;
    const sourceRef = STACK_SOURCE_REFS[binding.source_version_id];
    if (!sourceRef) return null;
    const scriptId = `upl${String(index + 1).padStart(5, '0')}`;
    const campaign = domain === 'campaign';
    lines.push([
      scriptId,
      domain,
      row.scene,
      row.script,
      binding.source_version_id,
      sourceRef,
      row.scene,
      'low',
      'false',
      'qianniu',
      'storewide',
      '',
      '',
      campaign ? '2026-01-01T00:00:00Z' : '',
      campaign ? '2099-12-31T00:00:00Z' : '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
