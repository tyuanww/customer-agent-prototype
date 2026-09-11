// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMinimaxReranker, parseRerankIds } from '../../src/main/minimax-rerank';

describe('minimax rerank parser', () => {
  it('keeps only allowed ids and drops extras', () => {
    const raw = 'here {"ids":["b","nope","a","b"]} thanks';
    expect(parseRerankIds(raw, ['a', 'b', 'c'])).toEqual(['b', 'a']);
  });

  it('returns empty on invalid payload', () => {
    expect(parseRerankIds('not json', ['a'])).toEqual([]);
    expect(parseRerankIds('{"ids":[1,2]}', ['1'])).toEqual([]);
  });

  it('reorders by model ids and ignores generated extras', async () => {
    const previous = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const ranked = [
        { scriptId: 'a', title: 'A', questionText: '', answerText: 'aa', score: 3 },
        { scriptId: 'b', title: 'B', questionText: '', answerText: 'bb', score: 2 },
        { scriptId: 'c', title: 'C', questionText: '', answerText: 'cc', score: 1 },
      ];
      const bodies: string[] = [];
      const reranker = loadMinimaxReranker({
        fetchImpl: (async (_url, init) => {
          bodies.push(String((init as RequestInit).body ?? ''));
          return new Response(JSON.stringify({
            choices: [{ message: { content: '{"ids":["c","a","invented"]}' } }],
          }), { status: 200 });
        }) as typeof fetch,
      });
      expect(reranker).not.toBeNull();
      const out = await reranker!.rerank('query', ranked);
      expect(out.map((row) => row.scriptId)).toEqual(['c', 'a', 'b']);
      expect(bodies.join('\n')).toContain('a | A');
      expect(bodies.join('\n')).not.toContain('aa');
      expect(bodies.join('\n')).not.toContain('answerText');
    } finally {
      if (previous === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = previous;
    }
  });

  it('stays null when unconfigured and keeps BM25 order when chat fails', async () => {
    const previous = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    expect(loadMinimaxReranker()).toBeNull();
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const ranked = [
        { scriptId: 'a', title: 'A', questionText: '', answerText: 'aa', score: 3 },
        { scriptId: 'b', title: 'B', questionText: '', answerText: 'bb', score: 2 },
      ];
      let calls = 0;
      const reranker = loadMinimaxReranker({
        fetchImpl: (async () => {
          calls += 1;
          throw new Error('timeout');
        }) as typeof fetch,
      });
      expect(await reranker!.rerank('query', ranked.slice(0, 1))).toEqual(ranked.slice(0, 1));
      expect(calls).toBe(0);
      expect(await reranker!.rerank('query', ranked)).toEqual(ranked);
      expect(calls).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = previous;
    }
  });
});
