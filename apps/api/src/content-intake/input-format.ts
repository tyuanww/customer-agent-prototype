import { CSV_MAPPING_VERSION, CSV_POLICY_VERSION, CSV_STRUCTURE_SHA256, CSV_TEMPLATE_VERSION,
  INTAKE_POLICY, SOP_MAPPING_VERSION, SOP_RULE_VERSION, SOP_SHEET_NAMES, SOP_STRUCTURE_SHA256,
  SOP_TEMPLATE_VERSION, TEMPLATE_VERSION, type IntakeParseContext } from '@customer-agent/content-intake';
import type { ContentSourceType } from '../content-object-store.js';
import type { Source } from './authority.js';
import { IntakeRejection } from './transaction.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;

/** Owns the registered format tuple used by upload, isolated parsing and material.
 * Neither a client filename/MIME nor file metadata selects a template or grants a scope. */
export function sourceInputFormat(source: Source): Readonly<{
  mime: 'text/csv' | typeof XLSX;
  sourceType: ContentSourceType; context: IntakeParseContext; selectedSheets: string[];
}> {
  const scope = source.scope;
  const context = { sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId ?? 'brand',
    scopeKind: scope.shopId === null ? 'brand' as const : 'shop' as const, domain: scope.domain };
  if (source.templateVersion === CSV_TEMPLATE_VERSION && source.ruleVersion === CSV_POLICY_VERSION
    && source.mappingVersion === CSV_MAPPING_VERSION && source.structureDigest === CSV_STRUCTURE_SHA256) {
    return { mime: 'text/csv', sourceType: 'csv', context: { ...context, templateVersion: CSV_TEMPLATE_VERSION }, selectedSheets: ['CSV'] };
  }
  // The SOP workbook keeps the xlsx container type: sourceType describes the
  // object-store bytes, whose declared upload type and zip magic are both checked
  // separately, while the six sheet names are the registered template's own scope.
  //
  // A source registered with this tuple cannot produce a candidate today. The first
  // refusal is `IntakeMaterial` in material.ts: the frozen contract types it as a
  // two-variant union with no sop-v1 arm, so the schema check fails before any SQL
  // runs. Once the contract gains that arm, 0034 candidate_format_guard is the next
  // gate: it pins selectedSheets for every non-CSV object to the FAQ triple, and 0038
  // widened input_format_matches without widening that CASE. Returning the FAQ triple
  // here would make the material misreport which template it came from.
  if (source.templateVersion === SOP_TEMPLATE_VERSION && source.ruleVersion === SOP_RULE_VERSION
    && source.mappingVersion === SOP_MAPPING_VERSION && source.structureDigest === SOP_STRUCTURE_SHA256) {
    return { mime: XLSX, sourceType: 'excel', context: { ...context, templateVersion: SOP_TEMPLATE_VERSION },
      selectedSheets: [...SOP_SHEET_NAMES] };
  }
  if (source.templateVersion === TEMPLATE_VERSION && source.ruleVersion === INTAKE_POLICY.version
    && source.mappingVersion.length >= 1 && source.mappingVersion.length <= 64 && /^[0-9a-f]{64}$/.test(source.structureDigest)) {
    return { mime: XLSX, sourceType: 'excel',
      context: { ...context, sheet: 'FAQ', templateVersion: TEMPLATE_VERSION }, selectedSheets: ['来源', 'FAQ', '相似问法'] };
  }
  throw new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION');
}