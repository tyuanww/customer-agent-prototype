import { describe, expect, it } from 'vitest';
import {
  LIBRARY_DELTA_UNREADABLE,
  composeLibraryDelta,
  libraryDomainCounts,
  libraryDomainHashes,
  parseLibraryDelta,
  unreadDomains,
  type LibraryDomain,
} from '../../src/shared/library-delta';

describe('library delta', () => {
  it('writes only the bound domains as 已更新 and keeps the fixed 产品→活动→售前→售后 order', () => {
    const summary = composeLibraryDelta([{ domain: 'presale', count: 75 }]);
    expect(summary).toBe('产品沿用 · 活动沿用 · 售前已更新（75 条） · 售后沿用');
  });

  it('omits the parenthesised count when the number is unknown', () => {
    expect(composeLibraryDelta([{ domain: 'presale', count: null }]))
      .toBe('产品沿用 · 活动沿用 · 售前已更新 · 售后沿用');
  });

  it('round-trips through parse and marks exactly the updated domains', () => {
    const summary = composeLibraryDelta([{ domain: 'presale', count: 75 }]);
    const delta = parseLibraryDelta(summary);
    expect(delta).not.toBeNull();
    expect(delta?.presale).toBe('updated');
    expect(delta?.product).toBe('carried');
    expect(delta?.campaign).toBe('carried');
    expect(delta?.aftersale).toBe('carried');
  });

  it('accepts a permuted but complete delta from another writer', () => {
    const delta = parseLibraryDelta('活动沿用 · 产品沿用 · 售后沿用 · 售前已更新（75 条）');
    expect(delta?.presale).toBe('updated');
    expect(parseLibraryDelta(LIBRARY_DELTA_UNREADABLE)).toBeNull();
  });

  it('returns null for empty, garbled, duplicated, or partial summaries', () => {
    expect(parseLibraryDelta(null)).toBeNull();
    expect(parseLibraryDelta('')).toBeNull();
    expect(parseLibraryDelta('   ')).toBeNull();
    expect(parseLibraryDelta('售前已更新')).toBeNull();
    expect(parseLibraryDelta('产品沿用 · 活动沿用 · 售前沿用')).toBeNull();
    expect(parseLibraryDelta('产品沿用 · 产品沿用 · 售前沿用 · 售后沿用')).toBeNull();
    expect(parseLibraryDelta('售前替换（75条）· 活动沿用 · 产品沿用 · 售后沿用')).toBeNull();
  });

  it('counts and hashes domains from the in-memory snapshot, excluding releaseId from the hash', () => {
    const items = [
      { category: 'presale', script_id: 'a', content_hash: 'h1' },
      { category: 'presale', script_id: 'b', content_hash: 'h2' },
      { category: 'product', script_id: 'c', content_hash: 'h3' },
    ];
    expect(libraryDomainCounts(items)).toEqual({ product: 1, campaign: 0, presale: 2, aftersale: 0 });
    const hashes = libraryDomainHashes(items);
    // The hash must not vary with releaseId: same items give the same hash.
    expect(libraryDomainHashes(items)).toEqual(hashes);
    // Order of items must not matter.
    expect(libraryDomainHashes([...items].reverse())).toEqual(hashes);
  });

  it('reports unread only for domains whose hash moved, never without a baseline', () => {
    const base = libraryDomainHashes([{ category: 'presale', script_id: 'a', content_hash: 'h1' }]);
    expect(unreadDomains(base, null)).toEqual([]);
    expect(unreadDomains(base, base)).toEqual([]);
    const moved = libraryDomainHashes([{ category: 'presale', script_id: 'a', content_hash: 'h2' }]);
    const unread = unreadDomains(moved, base);
    expect(unread).toEqual(['presale']);
    expect(unread as readonly LibraryDomain[]).not.toContain('product');
  });
});
