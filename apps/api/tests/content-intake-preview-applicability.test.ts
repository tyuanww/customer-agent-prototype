import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mediaObjectId, previewApplies, previewFromBytes } from '../src/content-intake/linked-preview.js';
import { sourceUsesSopWorkbook } from '../src/content-intake/sop-source.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');

describe('SOP preview identity and applicability', () => {
  it('gives each source its own object id for the same bytes', () => {
    const content = createHash('sha256').update(png).digest('hex');
    const shop = previewFromBytes(png, 'image/png', 'src-shop', 'sop:过敏流程SOP:2');
    const other = previewFromBytes(png, 'image/png', 'src-other', 'sop:过敏流程SOP:2');
    expect(shop.sha256).toBe(content);
    expect(other.sha256).toBe(content);
    expect(shop.objectId).toBe(mediaObjectId('src-shop', png));
    expect(shop.objectId).not.toBe(other.objectId);
    expect(shop.objectId).not.toBe(`med_${content}`);
  });

  it('selects the registered SOP tuple and leaves ordinary product sources on the FAQ parser', () => {
    const registered = { scope: { domain: 'sop' }, templateVersion: 'sop-v1', ruleVersion: 'sop-not-imported', mappingVersion: 'not-imported' };
    const product = { scope: { domain: 'product' }, templateVersion: 'faq-p1.1', ruleVersion: 'intake-p1.1', mappingVersion: 'mapping-p1.1' };
    const fixture = { ...product, mappingVersion: 'sop-not-imported' };
    expect(sourceUsesSopWorkbook(registered)).toBe(true);
    expect(sourceUsesSopWorkbook(product)).toBe(false);
    expect(sourceUsesSopWorkbook(fixture)).toBe(true);
  });

  it('hides empty rows when a product is selected and hides only brand roots when no filter is set', () => {
    const empty = { productRefIds: [], scenarioRefIds: [], familySourceId: '' };
    const named = { productRefIds: ['product-one'], scenarioRefIds: [], familySourceId: '' };
    expect(previewApplies(empty, { productIds: [], scenarioIds: [] }, false)).toBe(true);
    expect(previewApplies(empty, { productIds: ['product-one'], scenarioIds: [] }, false)).toBe(false);
    expect(previewApplies(named, { productIds: ['product-one'], scenarioIds: [] }, false)).toBe(true);
    expect(previewApplies(empty, { productIds: [], scenarioIds: [] }, true)).toBe(false);
    expect(previewApplies({ ...empty, familySourceId: 'source-brand' }, { productIds: [], scenarioIds: [] }, true)).toBe(true);
  });
});
