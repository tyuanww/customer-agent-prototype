// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerContentHash, parseDenseCatalog } from '../../src/shared/dense-retrieve';
import {
  deliverRetrievalEmbeddingsFromEnv,
  loadDenseCatalog,
} from '../../src/main/retrieval-embeddings-store';

const snapshotItem = {
  script_id: 'script-synthetic-001',
  title: '合成发货',
  answer_text: '合成订单 {订单号}',
  category: 'presale',
  questions: [{ question_text: '什么时候发货' }],
};

describe('login embedding delivery', () => {
  it('skips when MiniMax is not configured and no embed function is injected', async () => {
    const previousKey = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
      expect(await deliverRetrievalEmbeddingsFromEnv([snapshotItem])).toBeNull();
    } finally {
      if (previousKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = previousKey;
    }
  });

  it('writes missing vectors off-repo and skips a second pass when hashes match', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'embed-repo-'));
    const outside = mkdtempSync(join(tmpdir(), 'embed-outside-'));
    const catalogPath = join(outside, 'retrieval-embeddings.json');
    const previous = process.env.CUSTOMER_AGENT_EMBEDDING_INDEX;
    process.env.CUSTOMER_AGENT_EMBEDDING_INDEX = catalogPath;
    const vector = Object.freeze([1, 0, 0, 0]);
    try {
      const first = await deliverRetrievalEmbeddingsFromEnv([snapshotItem], {
        repoRoot: repo,
        embed: async (texts) => texts.map(() => vector),
      });
      expect(first).toMatchObject({ wrote: true, updated: 1, failed: 0, dim: 4 });
      const catalog = parseDenseCatalog(readFileSync(catalogPath, 'utf8'));
      expect(catalog?.rows).toEqual([
        expect.objectContaining({
          scriptId: 'script-synthetic-001',
          contentHash: answerContentHash('合成订单 {订单号}'),
        }),
      ]);
      expect(loadDenseCatalog(catalogPath)?.dim).toBe(4);
      const second = await deliverRetrievalEmbeddingsFromEnv([snapshotItem], {
        repoRoot: repo,
        embed: async () => {
          throw new Error('should not embed aligned hashes');
        },
      });
      expect(second).toMatchObject({ wrote: false, updated: 0, skipped: 1 });
    } finally {
      if (previous === undefined) delete process.env.CUSTOMER_AGENT_EMBEDDING_INDEX;
      else process.env.CUSTOMER_AGENT_EMBEDDING_INDEX = previous;
    }
  });
});
