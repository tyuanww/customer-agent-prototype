import { afterEach, describe, expect, it } from 'vitest';
import { digest } from '../src/content-intake/material.js';
import { discardPreviews, mediaObjectId, previewFromBytes, stagePreviews } from '../src/content-intake/linked-preview.js';
import { createReleasePreviewReader } from '../src/content-intake/sop-preview.js';
import type { IntakePreviewItem } from '../src/content-intake/usage.js';
import type { IntakeTransaction } from '../src/content-intake/transaction.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const other = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
// Release media identity is derived from the source and the exact bytes, so the
// SQL row and the staged candidate row genuinely collide on the same image.
const released = mediaObjectId('source-sop', png);
const stagedOnly = mediaObjectId('source-sop', other);

describe('release preview reader', () => {
  afterEach(() => { discardPreviews('rel_1'); discardPreviews('object-1'); });

  it('takes published rows from SQL, keeps candidate rows from the staged generation and deduplicates by identity', async () => {
    const rows = [{ objectId: released, payloadObjectId: `obj_${'c'.repeat(64)}`, sha256: digest(png), bytes: png.length,
      mime: 'image/png', sourceId: 'source-sop', rowId: 'sop:过敏流程SOP:2', businessEntryId: 'sop1',
      productRefIds: [], scenarioRefIds: [], familySourceId: '', operation: 'upsert',
      effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: null }];
    const client = { query: async () => ({ rows: [{ value: { items: rows } }] }) } as unknown as IntakeTransaction;
    const read: string[] = [];
    const reader = createReleasePreviewReader({
      readAttachment: async expected => { read.push(expected.objectId); return png; },
    });
    // The published image is also still in the candidate generation; only one copy may surface.
    stagePreviews('rel_1', [
      previewFromBytes(png, 'image/png', 'source-sop', 'sop:过敏流程SOP:2'),
      previewFromBytes(other, 'image/png', 'source-sop', 'sop:长痘痘SOP:3'),
    ]);
    const items = await reader.list(client, { principalId: 'p', entitlementHash: 'h', sessionTokenHash: 's',
      releaseId: 'rel_1', sourceIds: new Set(['source-sop']) }) as IntakePreviewItem[];
    expect(items.map(item => item.objectId)).toEqual([released, stagedOnly]);
    expect(items[0]!.storage).toMatchObject({ objectId: `obj_${'c'.repeat(64)}` });
    expect(Buffer.isBuffer(items[1]!.storage)).toBe(true);

    expect(await reader.read(items[0]!)).toEqual(png);
    expect(read).toEqual([`obj_${'c'.repeat(64)}`]);
    expect(await reader.read(items[1]!)).toEqual(other);
  });

  it('fails closed on a published descriptor when the store cannot read release bytes', async () => {
    const client = { query: async () => ({ rows: [{ value: { items: [{ objectId: released,
      payloadObjectId: `obj_${'c'.repeat(64)}`, sha256: digest(png), bytes: png.length, mime: 'image/png',
      sourceId: 'source-sop', rowId: 'sop:过敏流程SOP:2', businessEntryId: 'sop1', productRefIds: [], scenarioRefIds: [],
      familySourceId: '', operation: 'upsert', effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: null }] } }] }) } as unknown as IntakeTransaction;
    const reader = createReleasePreviewReader({});
    const items = await reader.list(client, { principalId: 'p', entitlementHash: 'h', sessionTokenHash: 's',
      releaseId: 'rel_1', sourceIds: new Set(['source-sop']) });
    await expect(reader.read(items[0]!)).rejects.toMatchObject({ reason: 'FILE_INVALID' });
  });
});
