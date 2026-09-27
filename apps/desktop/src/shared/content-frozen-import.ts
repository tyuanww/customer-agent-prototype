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

/**
 * Stable content identity for an imported row. The worker derives
 * `question_id = 'q_' + script_id` at version 1 (content-normalize.ts), so script_id
 * is a permanent identity: publishing it under different text is refused as
 * QUESTION_IDENTITY_CONFLICT. A row ordinal therefore cannot be the id, because
 * importing any second table after any first table collides on row 1.
 *
 * Two independent FNV-1a 32-bit passes seed a 16-hex-char digest. This needs to be
 * deterministic across machines and runs, not collision-proof against an adversary,
 * and it must stay renderer-safe (no node:crypto in a @shared module).
 */
function contentHash16(scene: string, script: string, domain: string): string {
  const input = `${domain}\u0000${scene}\u0000${script}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function frozenImportCsv(
  rows: readonly DashboardContentRow[],
  bindings: readonly DashboardContentBinding[],
): string | null {
  if (rows.length < 1 || bindings.length < 1) return null;
  const byDomain = new Map<DashboardContentDomain, DashboardContentBinding>();
  for (const binding of bindings) byDomain.set(binding.domain, binding);
  const lines = [HEADER.join(',')];
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = row.domain;
    if (!domain) return null;
    const binding = byDomain.get(domain);
    if (!binding) return null;
    const sourceRef = STACK_SOURCE_REFS[binding.source_version_id];
    if (!sourceRef) return null;
    const scriptId = `upl${contentHash16(row.scene, row.script, domain)}`;
    // Identical content in one batch would be the same identity twice; keep one row,
    // which is what "the same question and the same answer" already means.
    if (seen.has(scriptId)) continue;
    seen.add(scriptId);
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
  if (lines.length < 2) return null;
  return `${lines.join('\n')}\n`;
}
