import { describe, expect, it, vi } from 'vitest';
import type { ReleaseId, ReleaseSnapshot } from '@customer-agent/unified-contracts';
import { createReleaseStore } from '../../src/query/release-snapshot.js';

const releaseId = 'rel_synthetic_qry_001' as ReleaseId;

function snapshot(sequence = 1, id = releaseId): ReleaseSnapshot {
  return {
    releaseId: id,
    sequence,
    publishedAt: '2026-11-05T00:00:00.000Z',
    content: {
      state: 'ready',
      indexId: `idx_${String(sequence)}`,
      indexVersion: sequence,
      itemCount: 2,
      indexHash: `${String(sequence)}`.repeat(64).slice(0, 64) as string,
    },
    sop: { state: 'empty', indexId: null, indexVersion: null, itemCount: 0, indexHash: null },
  };
}

describe('ReleaseStore', () => {
  it('returns the ARC snapshot identity unchanged and deeply immutable', async () => {
    const first = snapshot();
    const store = createReleaseStore(async () => first);

    const current = await store.current();

    expect(current?.releaseId).toBe(first.releaseId);
    expect(current).not.toBe(first);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current?.content)).toBe(true);
    expect(Object.isFrozen(current?.sop)).toBe(true);
    await expect(store.current()).resolves.toEqual(current);
  });

  it('re-reads current state without mutating a prior immutable snapshot', async () => {
    let current: ReleaseSnapshot = snapshot(1);
    const read = vi.fn(async () => current);
    const store = createReleaseStore(read);
    const first = await store.current();

    current = snapshot(2, 'rel_synthetic_qry_002' as ReleaseId);
    const second = await store.current();

    expect(read).toHaveBeenCalledTimes(2);
    expect(first?.sequence).toBe(1);
    expect(first?.releaseId).toBe(releaseId);
    expect(second?.sequence).toBe(2);
    expect(second?.releaseId).toBe('rel_synthetic_qry_002');
    expect(first?.releaseId).not.toBe(second?.releaseId);
  });

  it('rejects malformed current state instead of inventing a release identity', async () => {
    const store = createReleaseStore(async () => ({
      ...snapshot(),
      content: { ...snapshot().content, indexHash: '' },
    }));

    await expect(store.current()).rejects.toMatchObject({
      code: 'RELEASE_SNAPSHOT_INVALID',
    });
  });
});
