// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRetrievalPipeline, loadRetrievalPipeline } from '../../src/main/retrieval-pipeline';
import { RETRIEVAL_POOL } from '../../src/shared/hybrid-retrieve';
import type { RetrievalScript } from '../../src/shared/hybrid-retrieve';

const scripts: RetrievalScript[] = [
  { scriptId: 'ship', title: '发货时效', questionText: '什么时候发货', answerText: '48小时内发出', questions: ['几天能到'] },
  { scriptId: 'nudge', title: '催发货', questionText: '怎么还不发', answerText: '仓库正在处理' },
  { scriptId: 'addr', title: '改地址', questionText: '地址填错了', answerText: '未发货可改' },
];

describe('retrieval pipeline', () => {
  it('skips MiniMax when smart retrieval is off', async () => {
    let planned = 0;
    const pipeline = createRetrievalPipeline(scripts, {
      fetchImpl: (async () => {
        planned += 1;
        return new Response('{}', { status: 500 });
      }) as typeof fetch,
    });
    const ranked = await pipeline.run('什么时候发货', false);
    expect(planned).toBe(0);
    expect(ranked[0]?.title).toMatch(/发货|时效/);
  });

  it('uses planned queries then reranks ids only', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const prompts: string[] = [];
      const pipeline = createRetrievalPipeline(scripts, {
        fetchImpl: (async (_url, init) => {
          const body = JSON.parse(String((init as RequestInit).body));
          const prompt = String(body.messages?.[1]?.content ?? '');
          prompts.push(prompt);
          if (prompt.includes('顾客问句：什么时候发货') && !prompt.includes('候选：')) {
            return new Response(JSON.stringify({
              choices: [{ message: { content: '{"intent":"shipping","queries":["发货时效"]}' } }],
            }), { status: 200 });
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: '{"ids":["ship","addr"]}' } }],
          }), { status: 200 });
        }) as typeof fetch,
      });
      const ranked = await pipeline.run('什么时候发货', true);
      expect(ranked.map((row) => row.scriptId)[0]).toBe('ship');
      expect(prompts.join('\n')).not.toContain('48小时内发出');
      expect(prompts.join('\n')).not.toContain('仓库正在处理');
    } finally {
      delete process.env.MINIMAX_API_KEY;
    }
  });

  it('returns empty for missing index, invalid JSON, and blank queries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retrieval-pipeline-'));
    expect((await loadRetrievalPipeline('').run('发货', true))).toEqual([]);
    expect((await loadRetrievalPipeline(join(dir, 'missing.json')).run('发货', true))).toEqual([]);
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, '{not json');
    expect((await loadRetrievalPipeline(invalid).run('发货', true))).toEqual([]);
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, `${JSON.stringify({ scripts: [{ scriptId: '', title: '' }] })}\n`);
    expect((await loadRetrievalPipeline(empty).run('发货', true))).toEqual([]);
    const mixed = join(dir, 'mixed.json');
    writeFileSync(mixed, `${JSON.stringify({
      scripts: [
        { scriptId: 'bad' },
        { scriptId: 'ship', title: '发货时效', questionText: '什么时候发货', answerText: '48小时内发出', questions: ['几天能到'] },
      ],
    })}\n`);
    const loaded = loadRetrievalPipeline(mixed);
    expect((await loaded.run('   ', false))).toEqual([]);
    expect((await loaded.run('什么时候发货', false))[0]?.scriptId).toBe('ship');
  });

  it('uses planned queries to recover a script the original sentence would miss', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const corpus: RetrievalScript[] = [
        { scriptId: 'coupon', title: '优惠券怎么用', questionText: '优惠券', answerText: '结算页勾选即可' },
        { scriptId: 'ship', title: '发货时效', questionText: '发货时效', answerText: '48小时内发出' },
      ];
      const pipeline = createRetrievalPipeline(corpus, {
        rerank: { rerank: async (_query, rows) => rows },
        fetchImpl: (async () => new Response(JSON.stringify({
          choices: [{ message: { content: '{"intent":"shipping","queries":["发货时效","什么时候发货"]}' } }],
        }), { status: 200 })) as typeof fetch,
      });
      expect((await pipeline.run('优惠券到期了', false))[0]?.scriptId).toBe('coupon');
      expect((await pipeline.run('优惠券到期了', true))[0]?.scriptId).toBe('ship');
    } finally {
      delete process.env.MINIMAX_API_KEY;
    }
  });

  it('pools 24 BM25 hits and only sends the first 8 ids to MiniMax', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const corpus = Array.from({ length: 30 }, (_, index) => ({
        scriptId: `s${index}`,
        title: `发货${index}`,
        questionText: '发货',
        answerText: `正文${index}`,
      }));
      const bodies: string[] = [];
      const pipeline = createRetrievalPipeline(corpus, {
        fetchImpl: (async (_url, init) => {
          bodies.push(String((init as RequestInit).body ?? ''));
          return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
        }) as typeof fetch,
      });
      const ranked = await pipeline.run('发货', true);
      expect(ranked).toHaveLength(RETRIEVAL_POOL);
      const rerankBody = bodies.find((body) => body.includes('候选：')) ?? '';
      expect(rerankBody.match(/s\d+ \|/g)).toHaveLength(8);
      expect(rerankBody).not.toMatch(/正文\d/);
    } finally {
      delete process.env.MINIMAX_API_KEY;
    }
  });

  it('keeps BM25 order when MiniMax plan or rerank fail-open', async () => {
    const previous = process.env.MINIMAX_API_KEY;
    try {
      delete process.env.MINIMAX_API_KEY;
      let planned = 0;
      const offline = createRetrievalPipeline(scripts, {
        fetchImpl: (async () => {
          planned += 1;
          return new Response('{}', { status: 500 });
        }) as typeof fetch,
      });
      expect((await offline.run('什么时候发货', true))[0]?.scriptId).toBe('ship');
      expect(planned).toBe(0);

      process.env.MINIMAX_API_KEY = 'test-key';
      const failing = createRetrievalPipeline(scripts, {
        fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch,
      });
      expect((await failing.run('什么时候发货', true))[0]?.scriptId).toBe('ship');
    } finally {
      if (previous === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = previous;
    }
  });
});
