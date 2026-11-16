import { describe, expect, it } from 'vitest';
import { digest } from '../src/content-intake/material.js';
import { parseOwnerReviewedSopFacts } from '../src/sop-owner-reviewed-query-facts.js';

const originalSha256 = 'a'.repeat(64);
const source = {
  kind: 'owner-reviewed-file', originalSha256, artifactSha256: 'b'.repeat(64), reviewedByPrincipalId: 'director',
  document: { candidateId: 'candidate-a', candidateVersion: 1, sourceId: 'source-a', flowId: 'flow-a',
    graphDigest: 'c'.repeat(64), sopGroup: '品质售后SOP', permissions: [
      { entry: { sourceId: 'source-a', businessEntryId: 'entry-a', scriptVersion: 1 }, risk_level: 'unclassified',
        copy_allowed: null, source_ref: `owner-reviewed-file:${originalSha256}@review-1#entry-a` },
    ] },
};
const input = (value: unknown) => ({ version: 'review-1', bytes: Buffer.from(JSON.stringify(value)) });
describe('owner-reviewed local file source parsing', () => {
  it('binds the reviewed bytes and retains unclassified risk and unknown copy permission', () => {
    const supplied = input(source), parsed = parseOwnerReviewedSopFacts(supplied);
    expect(parsed.sourceSha256).toBe(digest(supplied.bytes));
    expect(parsed.originalSha256).toBe(originalSha256);
    expect(parsed.artifactSha256).toBe(source.artifactSha256);
    expect(parsed.document.permissions[0]).toMatchObject({ risk_level: 'unclassified', copy_allowed: null });
  });
  it.each([
    { ...source, kind: 'synthetic' },
    { ...source, originalSha256: 'not-a-hash' },
    { ...source, unexpected: true },
    { ...source, reviewedByPrincipalId: null },
    { ...source, document: { ...source.document, permissions: [{ ...source.document.permissions[0], source_ref: 'synthetic:wrong@v1#entry-a' }] } },
    { ...source, document: { ...source.document, permissions: [{ ...source.document.permissions[0], risk_level: undefined }] } },
  ])('rejects unsupported or incomplete source declarations', value => {
    expect(() => parseOwnerReviewedSopFacts(input(value))).toThrow();
  });
  it('rejects invalid UTF-8 and unbounded source input', () => {
    expect(() => parseOwnerReviewedSopFacts({ version: 'review-1', bytes: Buffer.from([0xff]) })).toThrow();
    expect(() => parseOwnerReviewedSopFacts({ version: 'review-1', bytes: Buffer.alloc(1_048_577) })).toThrow();
  });
});
