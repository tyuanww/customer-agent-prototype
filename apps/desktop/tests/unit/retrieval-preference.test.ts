// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRetrievalPreferenceStore } from '../../src/main/retrieval-preference-store';
import { DEFAULT_RETRIEVAL_PREFERENCE, parseRetrievalPreference } from '../../src/shared/retrieval-preference';

describe('retrieval preference', () => {
  it('rejects invalid payloads instead of coercing them to ON', () => {
    expect(parseRetrievalPreference(null)).toBeNull();
    expect(parseRetrievalPreference({})).toBeNull();
    expect(parseRetrievalPreference({ smartEnabled: 'yes' })).toBeNull();
    expect(parseRetrievalPreference({ smartEnabled: false })).toEqual({ smartEnabled: false });
  });

  it('does not persist invalid writes', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'retrieval-pref-')), 'preference.json');
    writeFileSync(filePath, `${JSON.stringify({ smartEnabled: false })}\n`);
    const store = loadRetrievalPreferenceStore(filePath);
    expect(store.read()).toEqual({ smartEnabled: false });
    expect(parseRetrievalPreference({ smartEnabled: 1 })).toBeNull();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ smartEnabled: false });
  });

  it('defaults ON when the file is missing or unreadable, and persists writes', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'retrieval-pref-')), 'preference.json');
    const missing = loadRetrievalPreferenceStore(filePath);
    expect(missing.read()).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
    expect(missing.write({ smartEnabled: false })).toEqual({ smartEnabled: false });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ smartEnabled: false });
    writeFileSync(filePath, '{not json');
    expect(loadRetrievalPreferenceStore(filePath).read()).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
    writeFileSync(filePath, `${JSON.stringify(['nope'])}\n`);
    expect(loadRetrievalPreferenceStore(filePath).read()).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
  });

  it('keeps the last good OFF value when the file later goes corrupt', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'retrieval-pref-')), 'preference.json');
    const store = loadRetrievalPreferenceStore(filePath);
    expect(store.write({ smartEnabled: false })).toEqual({ smartEnabled: false });
    writeFileSync(filePath, '{not json');
    expect(store.read()).toEqual({ smartEnabled: false });
  });
});
