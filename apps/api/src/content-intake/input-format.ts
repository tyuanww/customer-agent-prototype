import { CSV_MAPPING_VERSION, CSV_POLICY_VERSION, CSV_STRUCTURE_SHA256, CSV_TEMPLATE_VERSION,
  INTAKE_POLICY, TEMPLATE_VERSION, type IntakeParseContext } from '@customer-agent/content-intake';
import type { ContentSourceType } from '../content-object-store.js';
import type { Source } from './authority.js';
import { IntakeRejection } from './transaction.js';

/** Owns the registered format tuple used by upload, isolated parsing and material.
 * Neither a client filename/MIME nor file metadata selects a template or grants a scope. */
export function sourceInputFormat(source: Source): Readonly<{
  mime: 'text/csv' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  sourceType: ContentSourceType; context: IntakeParseContext; selectedSheets: string[];
}> {
  const scope = source.scope;
  const context = { sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId ?? 'brand',
    scopeKind: scope.shopId === null ? 'brand' as const : 'shop' as const, domain: scope.domain };
  if (source.templateVersion === CSV_TEMPLATE_VERSION && source.ruleVersion === CSV_POLICY_VERSION
    && source.mappingVersion === CSV_MAPPING_VERSION && source.structureDigest === CSV_STRUCTURE_SHA256) {
    return { mime: 'text/csv', sourceType: 'csv', context: { ...context, templateVersion: CSV_TEMPLATE_VERSION }, selectedSheets: ['CSV'] };
  }
  if (source.templateVersion === TEMPLATE_VERSION && source.ruleVersion === INTAKE_POLICY.version
    && source.mappingVersion.length >= 1 && source.mappingVersion.length <= 64 && /^[0-9a-f]{64}$/.test(source.structureDigest)) {
    return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sourceType: 'excel',
      context: { ...context, sheet: 'FAQ', templateVersion: TEMPLATE_VERSION }, selectedSheets: ['来源', 'FAQ', '相似问法'] };
  }
  throw new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION');
}
