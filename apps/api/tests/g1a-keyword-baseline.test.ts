import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { normalizeSearchText, unicodeBigramTokens } from './support/g1a-e0/keyword-baseline/search-text.js';
import { createSearchBackend } from './support/g1a-e0/keyword-baseline/search-service.js';

const root = new URL('./support/g1a-e0/keyword-baseline/', import.meta.url);
const pin = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

describe('frozen keyword baseline', () => {
  it('matches the merged historical source with only the declared import relocation', () => {
    for (const [name, value] of Object.entries(pin.files)) {
      const file = value as { source_path: string; original_sha256: string; vendored_sha256: string };
      const original = execFileSync('git', ['show', `${pin.source_commit}:${file.source_path}`], { encoding: 'utf8' });
      const vendored = readFileSync(new URL(name, root), 'utf8');
      expect(hash(original)).toBe(file.original_sha256);
      expect(hash(vendored)).toBe(file.vendored_sha256);
      expect(vendored).toBe(name === 'search-service.ts'
        ? original.replace("'./database-contract-errors.js'", "'../../../../src/database-contract-errors.js'") : original);
    }
  });
  it('retains historical normalization and repeated AND bigrams', async () => {
    expect(normalizeSearchText(' ＡＢ，测试！ ')).toBe('ab,测试!');
    expect(unicodeBigramTokens('哈哈哈')).toEqual(['哈哈', '哈哈']);
    let captured: unknown;
    const backend = createSearchBackend({ searchCandidates: async (request) => {
      captured = request;
      return { ok: true, releaseId: 'synthetic', sourceBindingHash: 'synthetic', candidates: [] };
    } });
    await backend.search({ normalizedQuery: '合成袋', platform: 'qianniu', productContextType: null, productContextRef: null, topK: 3 });
    expect(captured).toMatchObject({ bigramTsquery: '合成 & 成袋', escapedFallbackPattern: '%合成袋%', topK: 3 });
    expect(captured).not.toHaveProperty('suppressMatches');
  });
  it('escapes fallback wildcard input and preserves source rejection', async () => {
    let pattern = '';
    const backend = createSearchBackend({ searchCandidates: async (request) => {
      pattern = request.escapedFallbackPattern;
      return { ok: false, code: 'SOURCE_GATE_NOT_READY' };
    } });
    const result = await backend.search({ normalizedQuery: '%_', platform: 'qianniu', productContextType: null, productContextRef: null, topK: 3 });
    expect(pattern).toBe('%\\%\\_%');
    expect(result).toEqual({ ok: false, code: 'SOURCE_GATE_NOT_READY' });
  });
});
