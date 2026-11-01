import { describe, expect, it } from 'vitest';
import { checkRealSixSheetMapping, REAL_SOP_SHEETS, REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256, REAL_SOP_STRUCTURE, type RealSixSheetMapping } from '../src/sop-real-mapping.js';

const empty = (): RealSixSheetMapping => ({
  version: REAL_SOP_MAPPING_VERSION, mappingState: 'candidate', mappingStatus: 'ready-for-graph-preparation', publishable: false, sourcePath: '/tmp/real.xlsx', sourceSha256: REAL_SOP_SOURCE_SHA256, entryCodeHeaderPresent: false,
  sheets: REAL_SOP_SHEETS.map(sheet => ({ sheet, ...REAL_SOP_STRUCTURE[sheet],
    stableBusinessIds: [{ value: `${sheet}-1`, evidence: `review:business-confirmation:${sheet}` }],
    entryTerms: [{ value: `entry-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    branchTargets: [{ value: `branch-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    unableToDeterminePaths: [{ value: `uncertain-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    knowledgeOwnership: [{ value: `knowledge-owner-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    resourceOwnership: [{ value: `resource-owner-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    imageOwnership: [{ value: `image-owner-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    applicability: [{ value: `scope-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    visibility: [{ value: `visibility-${sheet}`, evidence: `review:business-confirmation:${sheet}` }],
    effectiveInterval: { from: '2026-01-01T00:00:00Z', to: null, evidence: `review:business-confirmation:${sheet}` },
  })),
});

describe('real six-sheet mapping', () => {
  it('requires explicit claims for every registered sheet', () => {
    const result = checkRealSixSheetMapping({ ...empty(), sheets: [] });
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues.some(issue => issue.field === 'sheets')).toBe(true);
  });
  it('accepts a complete mapping as graph-preparation input but never publishable', () => {
    const result = checkRealSixSheetMapping(empty());
    expect(result.status).toBe('ready-for-graph-preparation');
    expect(result.publishable).toBe(false);
  });
  it('rejects non-ISO or missing effective evidence', () => {
    const mapping = empty();
    const result = checkRealSixSheetMapping({ ...mapping, sheets: mapping.sheets.map((sheet, index) => index === 0 ? { ...sheet, effectiveInterval: null } : sheet) });
    expect(result.issues).toContainEqual(expect.objectContaining({ sheet: REAL_SOP_SHEETS[0], field: 'effectiveInterval' }));
  });
  it.each([undefined, null, {}])('rejects missing or malformed mapping claims: %s', value => {
    const mapping = empty();
    const sheets = mapping.sheets.map((sheet, index) => index === 0 ? { ...sheet, branchTargets: value } : sheet);
    const result = checkRealSixSheetMapping({ ...mapping, sheets } as RealSixSheetMapping);
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'branchTargets' }));
  });
  it.each(['2026-99-01T00:00:00Z', '2025-12-31T00:00:00Z', '2026-02-31T00:00:00Z', '2026-02-29T00:00:00.123Z', '2026-03-01T24:00:00Z'])('rejects invalid or reversed effective intervals: %s', to => {
    const mapping = empty();
    const result = checkRealSixSheetMapping({ ...mapping, sheets: mapping.sheets.map((sheet, index) => index === 0
      ? { ...sheet, effectiveInterval: { from: '2026-01-01T00:00:00Z', to, evidence: 'review:approved' } } : sheet) });
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'effectiveInterval' }));
  });
  it.each(['2028-02-29T00:00:00Z', '2026-02-28T23:59:59.123456Z'])('accepts real UTC dates and fractional seconds: %s', from => {
    const mapping = empty();
    const result = checkRealSixSheetMapping({ ...mapping, sheets: mapping.sheets.map((sheet, index) => index === 0
      ? { ...sheet, effectiveInterval: { from, to: null, evidence: 'review:approved' } } : sheet) });
    expect(result.status).toBe('ready-for-graph-preparation');
    expect(result.issues).toEqual([]);
  });
  it('rejects a normalized invalid start date even without an expiry', () => {
    const mapping = empty();
    const result = checkRealSixSheetMapping({ ...mapping, sheets: mapping.sheets.map((sheet, index) => index === 0
      ? { ...sheet, effectiveInterval: { from: '2026-02-31T00:00:00Z', to: null, evidence: 'review:approved' } } : sheet) });
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'effectiveInterval' }));
  });
  it('rejects a template whose structural counts drift from the source evidence', () => {
    const mapping = empty();
    const result = checkRealSixSheetMapping({ ...mapping, sheets: mapping.sheets.map((sheet, index) => index === 0 ? { ...sheet, rowCount: sheet.rowCount + 1 } : sheet) });
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues).toContainEqual(expect.objectContaining({ sheet: REAL_SOP_SHEETS[0], field: 'structure' }));
  });
  it('rejects a different workbook even when its hash has the right shape', () => {
    const result = checkRealSixSheetMapping({ ...empty(), sourceSha256: 'a'.repeat(64) });
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'sourceSha256' }));
  });
  it('requires machine-readable candidate and non-publishable markers', () => {
    const result = checkRealSixSheetMapping({ ...empty(), mappingState: undefined as never, mappingStatus: undefined as never, publishable: true as never });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'mappingState' }),
      expect.objectContaining({ field: 'mappingStatus' }),
      expect.objectContaining({ field: 'publishable' }),
    ]));
  });
  it('requires the declared review status to match the actual mapping result', () => {
    const result = checkRealSixSheetMapping({ ...empty(), mappingStatus: 'needs-business-confirmation' });
    expect(result.status).toBe('ready-for-graph-preparation');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'mappingStatus' }));
  });
  it('rejects placeholder business claims instead of treating them as complete mapping', () => {
    const mapping = empty();
    const result = checkRealSixSheetMapping({ ...mapping, sheets: mapping.sheets.map((sheet, index) => index === 0 ? {
      ...sheet,
      entryTerms: [{ value: '待业务确认', evidence: 'business-review:pending' }],
    } : sheet) });
    expect(result.status).toBe('needs-business-confirmation');
    expect(result.issues).toContainEqual(expect.objectContaining({ sheet: REAL_SOP_SHEETS[0], field: 'entryTerms' }));
  });
});
