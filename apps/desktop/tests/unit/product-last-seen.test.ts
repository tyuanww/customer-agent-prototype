// @vitest-environment node
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createLastSeenStore,
  lastSeenFileName,
  NO_LAST_SEEN,
} from '../../src/main/product-last-seen';

const HASHES = { product: 'p1', campaign: 'c1', presale: 's1', aftersale: 'a1' } as const;

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'last-seen-'));
}

describe('last seen store', () => {
  it('keeps a per-user, per-domain baseline and never lights without one', () => {
    const dir = tempDir();
    const store = createLastSeenStore(dir, 'http://127.0.0.1:43100');
    expect(store.baseline('usr_a')).toBeNull();
    store.establish('usr_a', HASHES);
    expect(store.baseline('usr_a')).toEqual(HASHES);
    // A different user has no baseline until its own first full snapshot.
    expect(store.baseline('usr_b')).toBeNull();
  });

  it('only advances the listed domains to read', () => {
    const dir = tempDir();
    const store = createLastSeenStore(dir, 'http://127.0.0.1:43100');
    store.establish('usr_a', HASHES);
    store.markRead('usr_a', ['presale'], { ...HASHES, presale: 's2' });
    expect(store.baseline('usr_a')).toEqual({ ...HASHES, presale: 's2' });
  });

  it('does not overwrite an existing baseline on a later establish', () => {
    const dir = tempDir();
    const store = createLastSeenStore(dir, 'http://127.0.0.1:43100');
    store.establish('usr_a', HASHES);
    store.markRead('usr_a', ['presale'], { ...HASHES, presale: 's2' });
    store.establish('usr_a', HASHES);
    expect(store.baseline('usr_a')?.presale).toBe('s2');
  });

  it('writes 0o600 and keeps a per-origin filename', () => {
    const dir = tempDir();
    const store = createLastSeenStore(dir, 'http://127.0.0.1:43100');
    store.establish('usr_a', HASHES);
    const file = path.join(dir, lastSeenFileName('http://127.0.0.1:43100'));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toContain('usr_a');
    // A second origin is a different file; its user is independent.
    const other = createLastSeenStore(dir, 'https://remote.example');
    expect(lastSeenFileName('https://remote.example')).not.toBe(lastSeenFileName('http://127.0.0.1:43100'));
    expect(other.baseline('usr_a')).toBeNull();
  });

  it('fail-closes and no-ops without a userId', () => {
    expect(NO_LAST_SEEN.baseline('usr_a')).toBeNull();
    NO_LAST_SEEN.establish('usr_a', HASHES);
    NO_LAST_SEEN.markRead('usr_a', ['presale'], HASHES);
    expect(NO_LAST_SEEN.baseline('usr_a')).toBeNull();
    const dir = tempDir();
    const store = createLastSeenStore(dir, 'http://127.0.0.1:43100');
    store.establish('', HASHES);
    store.markRead('', ['presale'], HASHES);
    expect(store.baseline('')).toBeNull();
  });
});
