import { describe, expect, it } from 'vitest';
import { createSyntheticSopWorkbook, createTemplate, parseWorkbook, tryParseSopAsFaq,
  CSV_MAPPING_VERSION, CSV_POLICY_VERSION, CSV_STRUCTURE_SHA256, CSV_TEMPLATE_VERSION,
  INTAKE_POLICY, SOP_MAPPING_VERSION, SOP_RULE_VERSION, SOP_SHEET_NAMES, SOP_STRUCTURE_SHA256,
  SOP_TEMPLATE_VERSION, TEMPLATE_VERSION } from '@customer-agent/content-intake';
import type { Source } from '../src/content-intake/authority.js';
import { sourceInputFormat } from '../src/content-intake/input-format.js';
import { digest, materialFromParse } from '../src/content-intake/material.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;
const scope = { tenantId: 't', appId: 'a', brandId: 'b', shopId: 'shop', sourceId: 'source' } as const;

/** The tuple 0038 registers for src-menokin-sop. A client filename, MIME or
 * sheet list can never produce this; only the registry row can. The frozen contract
 * types the scope domain as four values, so a `sop` scope is reachable only through
 * the database; the cast is the point of the test, not a shortcut around it. */
const registeredSopSource: Source = { scopeId: 'scope-sop',
  scope: { ...scope, domain: 'sop' } as unknown as Source['scope'], version: 1,
  templateVersion: SOP_TEMPLATE_VERSION, ruleVersion: SOP_RULE_VERSION, mappingVersion: SOP_MAPPING_VERSION,
  structureDigest: SOP_STRUCTURE_SHA256, mode: 'v2-preview' };
const registeredFaqSource: Source = { scopeId: 'scope', scope: { ...scope, domain: 'product' }, version: 1,
  templateVersion: TEMPLATE_VERSION, ruleVersion: INTAKE_POLICY.version, mappingVersion: 'mapping-p1.1',
  structureDigest: 'a'.repeat(64), mode: 'v2-preview' };

describe('registered source format tuple', () => {
  it('selects the SOP workbook parser from the registered tuple, not from a caller-supplied sheet list', () => {
    const format = sourceInputFormat(registeredSopSource);
    expect(format.mime).toBe(XLSX);
    expect(format.sourceType).toBe('excel');
    expect(format.selectedSheets).toEqual([...SOP_SHEET_NAMES]);
    expect(format.context).toMatchObject({ sourceId: 'source', domain: 'sop', templateVersion: 'sop-v1' });
  });

  it('keeps the FAQ template on its own three-sheet excel format', () => {
    const format = sourceInputFormat(registeredFaqSource);
    expect(format.mime).toBe(XLSX);
    expect(format.selectedSheets).toEqual(['来源', 'FAQ', '相似问法']);
    expect(format.context).toMatchObject({ sheet: 'FAQ', templateVersion: TEMPLATE_VERSION });
  });

  it('refuses a tuple that is neither registered FAQ nor registered SOP', () => {
    const nearMiss: Source = { ...registeredSopSource, structureDigest: 'b'.repeat(64) };
    expect(() => sourceInputFormat(nearMiss)).toThrowError(expect.objectContaining({ reason: 'SOURCE_FORMAT_MISMATCH' }));
  });
});

describe('material policy version against a registered SOP source', () => {
  // The frozen contract still types IntakeMaterial.scope.domain as the four FAQ
  // domains, so a real `sop` scope cannot even build a material until the upstream
  // enum lands. The rule-version exception below is independent of that gap.
  const contractDomainSopSource: Source = { ...registeredSopSource, scope: { ...scope, domain: 'product' } };

  it('cannot build a material for the real sop-v1 tuple while the consumed contract has no SOP variant', async () => {
    // Tripwire, not an endorsement: IntakeMaterial is a two-variant discriminated
    // union (faq-p1.1 + three sheets, faq-csv-v1 + CSV). A real SOP source must be
    // refused here until the upstream contract adds a sop-v1 variant. When that
    // lands this case is replaced by the positive one above.
    const { bytes } = await createSyntheticSopWorkbook();
    const sop = (await tryParseSopAsFaq(bytes, { sourceId: 'source', brandId: 'b', shopId: 'shop' }))!;
    expect(() => materialFromParse({ parsed: sop.parsed, source: contractDomainSopSource,
      object: { objectId: 'object', sourceId: 'source', sha256: digest(bytes), bytes: bytes.length, mime: XLSX },
      contributors: ['principal'], previous: [], terms: [], baseReleaseId: null, now: Date.parse('2026-10-22T00:00:00Z'), recentDisables: 0 }))
      .toThrowError(/Contract validation failed for IntakeMaterial/);
  });

  it('still refuses an FAQ parse presented under a CSV source', async () => {
    const context: Parameters<typeof createTemplate>[0] = { sourceId: scope.sourceId, brandId: scope.brandId, scope: 'shop',
      domain: 'product', sheet: 'FAQ', templateVersion: TEMPLATE_VERSION };
    const bytes = await createTemplate(context, [['entry-a', '合成标题', '合成回答', '', '', '分类', '', '启用', '', '', '', '', '', '', 'false']]);
    const parsed = await parseWorkbook(bytes, { ...context, scopeKind: 'shop' });
    const csvSource: Source = { ...registeredFaqSource, templateVersion: CSV_TEMPLATE_VERSION,
      ruleVersion: CSV_POLICY_VERSION, mappingVersion: CSV_MAPPING_VERSION, structureDigest: CSV_STRUCTURE_SHA256 };
    expect(() => materialFromParse({ parsed, source: csvSource,
      object: { objectId: 'object', sourceId: 'source', sha256: digest(bytes), bytes: bytes.length, mime: XLSX },
      contributors: ['principal'], previous: [], terms: [], baseReleaseId: null, now: Date.parse('2026-10-22T00:00:00Z'), recentDisables: 0 }))
      .toThrowError(expect.objectContaining({ reason: 'SOURCE_FORMAT_MISMATCH' }));
  });
});
