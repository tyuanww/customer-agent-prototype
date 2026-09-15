// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerContentHash,
  cosine,
  matchingDenseRows,
  parseDenseCatalog,
  rankDense,
  serializeDenseCatalog,
} from '../../src/shared/dense-retrieve';
import { rankScripts, type RetrievalScript } from '../../src/shared/hybrid-retrieve';
import { analyzeQuery } from '../../src/shared/query-analyze';
import { parseEmbedVectors } from '../../src/main/minimax-embed';
import { embedRetrievalIndex } from '../../src/main/retrieval-embeddings-store';
import { assertOffRepoIndexPath } from '../../src/main/retrieval-index-store';
import { createRetrievalPipeline } from '../../src/main/retrieval-pipeline';

const ship: RetrievalScript = {
  scriptId: 'ship',
  title: '发货时效',
  questionText: '发货时效',
  answerText: '付款后四十八小时内发出',
};
const addr: RetrievalScript = {
  scriptId: 'addr',
  title: '改地址',
  questionText: '改地址',
  answerText: '未发货可改一次收货地址',
};

describe('dense cosine ranks', () => {
  it('ranks the nearer vector first and ignores zero overlap', () => {
    const query = [1, 0, 0];
    const ranks = rankDense(query, [
      { scriptId: 'addr', contentHash: 'a'.repeat(64), vector: [0, 1, 0] },
      { scriptId: 'ship', contentHash: 'b'.repeat(64), vector: [0.9, 0.1, 0] },
    ]);
    expect(ranks.map((row) => row.scriptId)).toEqual(['ship']);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('drops rows whose answer hash no longer matches', () => {
    const catalog = parseDenseCatalog(JSON.stringify({
      version: 1,
      model: 'embo-01',
      dim: 2,
      rows: [
        { scriptId: 'ship', contentHash: answerContentHash(ship.answerText), vector: [1, 0] },
        { scriptId: 'addr', contentHash: 'c'.repeat(64), vector: [0, 1] },
      ],
    }));
    expect(matchingDenseRows(catalog!, [ship, addr]).map((row) => row.scriptId)).toEqual(['ship']);
  });
});

describe('dense replaces the BM25 answer lane', () => {
  it('uses dense ranks in place of BM25(answer)', () => {
    const corpus = [ship, addr];
    const query = '四十八小时内发出';
    expect(rankScripts(query, corpus)[0]?.scriptId).toBe('ship');
    const dense = rankScripts(query, corpus, 3, analyzeQuery(query), [{ scriptId: 'addr', rank: 1 }]);
    expect(dense[0]?.scriptId).toBe('addr');
  });
});

describe('MiniMax embed parse', () => {
  it('accepts native vectors and rejects status errors', () => {
    const ok = parseEmbedVectors({ vectors: [[1, 0], [0, 1]], base_resp: { status_code: 0 } }, 2);
    expect(ok).toHaveLength(2);
    expect(parseEmbedVectors({ vectors: [[1, 0]], base_resp: { status_code: 2013 } }, 1)).toBeNull();
    expect(parseEmbedVectors({ vectors: [[1, 0]] }, 2)).toBeNull();
  });
});

describe('off-repo embedding catalog', () => {
  it('refuses a catalog path inside the git worktree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'embed-repo-'));
    expect(() => assertOffRepoIndexPath(join(repo, 'retrieval-embeddings.json'), repo)).toThrow(/outside the git worktree/);
  });

  it('writes hash-bound vectors and skips unchanged rows', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'embed-repo-'));
    const outside = mkdtempSync(join(tmpdir(), 'embed-off-'));
    const catalogPath = join(outside, 'retrieval-embeddings.json');
    const vector = Object.freeze([1, 0, 0]);
    const result = await embedRetrievalIndex({
      indexScripts: [ship, addr],
      catalogPath,
      repoRoot: repo,
      embed: async (texts) => texts.map(() => vector),
    });
    expect(result).toMatchObject({ targeted: 2, updated: 2, wrote: true, dim: 3 });
    const saved = parseDenseCatalog(readFileSync(catalogPath, 'utf8'));
    expect(saved?.rows).toHaveLength(2);
    expect(saved?.rows[0]?.contentHash).toBe(answerContentHash(ship.answerText));
    const skipped = await embedRetrievalIndex({
      indexScripts: [ship, addr],
      catalogPath,
      repoRoot: repo,
      embed: async () => { throw new Error('should skip existing hashes'); },
    });
    expect(skipped).toMatchObject({ targeted: 0, updated: 0, wrote: false });
  });

  it('keeps BM25 when query embedding fails', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const pipeline = createRetrievalPipeline([ship, addr], {
        dense: {
          rank: async () => null,
        },
        fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch,
      });
      const ranked = await pipeline.run('什么时候发货', false);
      expect(ranked[0]?.scriptId).toBe('ship');
    } finally {
      delete process.env.MINIMAX_API_KEY;
    }
  });
});

describe('dense catalog round-trip', () => {
  it('rejects invalid dim, hash, and empty rows', () => {
    expect(parseDenseCatalog(JSON.stringify({ version: 1, model: 'embo-01', dim: 2, rows: [] }))).toBeNull();
    expect(parseDenseCatalog(JSON.stringify({
      version: 1, model: 'embo-01', dim: 2,
      rows: [{ scriptId: 'ship', contentHash: 'nope', vector: [1, 0] }],
    }))).toBeNull();
    const ok = parseDenseCatalog(serializeDenseCatalog({
      version: 1,
      model: 'embo-01',
      dim: 2,
      rows: [{ scriptId: 'ship', contentHash: 'a'.repeat(64), vector: [1, 0] }],
    }));
    expect(ok?.dim).toBe(2);
  });
});
