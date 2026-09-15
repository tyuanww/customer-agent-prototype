// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMinimaxQuestionGenerator, parseGeneratedQuestions } from '../../src/main/doc2query-generate';
import { assertOffRepoIndexPath, enrichRetrievalIndex } from '../../src/main/retrieval-index-store';
import { mergeQuestions, normalizeQuestions } from '../../src/shared/doc2query';
import { rankScripts, type RetrievalScript } from '../../src/shared/hybrid-retrieve';
import {
  parseRetrievalIndex,
  scriptsOf,
  serializeRetrievalIndex,
  withQuestions,
} from '../../src/shared/retrieval-index';
import { loadSemanticRetriever } from '../../src/main/semantic-retrieve';
import { loadRetrievalPipeline } from '../../src/main/retrieval-pipeline';

const script = {
  title: '发货时效',
  questionText: '什么时候发货',
  answerText: '付款后四十八小时内发出，物流单号同步到订单页。',
};

describe('doc2query normalize', () => {
  it('keeps spoken paraphrases and drops title, shortcut, answer, and junk', () => {
    expect(normalizeQuestions([
      '几天能到货呀',
      '  几天能到货呀  ',
      '发货时效',
      '什么时候发货',
      '付款后四十八小时内发出，物流单号同步到订单页。',
      'x',
      'a'.repeat(81),
      12,
      '包裹还没动静',
    ], script)).toEqual(['几天能到货呀', '包裹还没动静']);
  });

  it('merges existing questions with generated ones up to the cap', () => {
    const merged = mergeQuestions(['几天能到货呀'], ['下单后多久寄出', '几天能到货呀'], script);
    expect(merged).toEqual(['几天能到货呀', '下单后多久寄出']);
  });
});

describe('retrieval index round-trip', () => {
  it('keeps envelope fields and category while adding questions', () => {
    const document = parseRetrievalIndex(JSON.stringify({
      version: 1,
      source: 'synthetic-fixture',
      extra: true,
      scripts: [
        {
          scriptId: 'ship',
          title: '发货时效',
          questionText: '什么时候发货',
          answerText: '四十八小时内发出',
          category: 'presale',
          note: 'keep-me',
        },
        { title: 'broken' },
      ],
    }));
    expect(document?.envelope).toMatchObject({ version: 1, source: 'synthetic-fixture', extra: true });
    expect(document?.rows).toHaveLength(2);
    expect(document?.rows[1]?.script).toBeNull();
    const updated = withQuestions(document!, new Map([['ship', ['几天能到货呀']]]));
    const parsed = JSON.parse(serializeRetrievalIndex(updated)) as {
      scripts: Array<Record<string, unknown>>;
    };
    expect(parsed.scripts[0]).toMatchObject({
      scriptId: 'ship',
      category: 'presale',
      note: 'keep-me',
      questions: ['几天能到货呀'],
    });
    expect(parsed.scripts[1]).toEqual({ title: 'broken' });
    expect(scriptsOf(updated)[0]?.questions).toEqual(['几天能到货呀']);
  });
});

describe('spoken questions retrieve a script titles would miss', () => {
  const corpus: readonly RetrievalScript[] = [
    {
      scriptId: 'addr',
      title: '改地址',
      questionText: '改地址',
      answerText: '未发货可改一次',
      questions: ['我写错收件信息了'],
    },
    {
      scriptId: 'ship',
      title: '发货时效',
      questionText: '发货时效',
      answerText: '四十八小时内发出',
    },
  ];

  it('ranks the address script from a paraphrase stored only in questions[]', () => {
    expect(rankScripts('我写错收件信息了', corpus)[0]?.scriptId).toBe('addr');
    const withoutQuestions = corpus.map((row) => ({ ...row, questions: undefined }));
    expect(rankScripts('我写错收件信息了', withoutQuestions)[0]?.scriptId).not.toBe('addr');
  });
});

describe('MiniMax Doc2Query', () => {
  it('parses item ids and ignores unknown or duplicate rows', () => {
    const batch = [{ scriptId: 'ship', title: '发货时效', questionText: '什么时候发货' }];
    const parsed = parseGeneratedQuestions(
      'noise {"items":[{"id":"ship","questions":["几天能到货呀"]},{"id":"nope","questions":["x"]},{"scriptId":"ship","questions":["重复"]}]}',
      batch,
    );
    expect(parsed.get('ship')).toEqual(['几天能到货呀']);
    expect(parsed.has('nope')).toBe(false);
  });

  it('sends only id, title, and shortcut question to MiniMax', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    try {
      const prompts: string[] = [];
      const generate = createMinimaxQuestionGenerator({
        fetchImpl: (async (_url, init) => {
          const body = JSON.parse(String((init as RequestInit).body));
          prompts.push(String(body.messages?.map((row: { content: string }) => row.content).join('\n')));
          return new Response(JSON.stringify({
            choices: [{ message: { content: '{"items":[{"id":"ship","questions":["几天能到货呀"]}]}' } }],
          }), { status: 200 });
        }) as typeof fetch,
      });
      const result = await generate([
        { scriptId: 'ship', title: '发货时效', questionText: '什么时候发货' },
      ]);
      expect(result.get('ship')).toEqual(['几天能到货呀']);
      expect(prompts.join('\n')).toContain('标题=发货时效');
      expect(prompts.join('\n')).toContain('问法=什么时候发货');
      expect(prompts.join('\n')).not.toContain('四十八小时');
      expect(prompts.join('\n')).not.toContain('answer');
    } finally {
      delete process.env.MINIMAX_API_KEY;
    }
  });
});

describe('off-repo index enricher', () => {
  it('refuses to write an index inside the git worktree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'doc2query-repo-'));
    expect(() => assertOffRepoIndexPath(join(repo, 'retrieval-index.json'), repo)).toThrow(/outside the git worktree/);
  });

  it('fills questions atomically outside the repo and leaves existing rows intact', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'doc2query-repo-'));
    const outside = mkdtempSync(join(tmpdir(), 'doc2query-off-'));
    const indexPath = join(outside, 'retrieval-index.json');
    writeFileSync(indexPath, `${JSON.stringify({
      version: 1,
      source: 'synthetic-fixture',
      scripts: [
        { scriptId: 'ship', title: '发货时效', questionText: '什么时候发货', answerText: '四十八小时内发出' },
        { scriptId: 'addr', title: '改地址', questionText: '改地址', answerText: '未发货可改', questions: ['我写错收件信息了'] },
      ],
    })}\n`);
    const result = await enrichRetrievalIndex({
      indexPath,
      repoRoot: repo,
      generate: async (batch) => new Map(batch.map((item) => [item.scriptId, Object.freeze(['包裹卡在中转几天了'])])),
    });
    expect(result).toMatchObject({ targeted: 1, updated: 1, wrote: true });
    const saved = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      source: string;
      scripts: Array<{ scriptId: string; questions?: string[] }>;
    };
    expect(saved.source).toBe('synthetic-fixture');
    expect(saved.scripts.find((row) => row.scriptId === 'ship')?.questions).toEqual(['包裹卡在中转几天了']);
    expect(saved.scripts.find((row) => row.scriptId === 'addr')?.questions).toEqual(['我写错收件信息了']);
    expect((await loadRetrievalPipeline(indexPath).run('包裹卡在中转几天了', false)).ranked[0]?.scriptId).toBe('ship');
    expect(loadSemanticRetriever(indexPath).rank('我写错收件信息了')[0]?.scriptId).toBe('addr');
  });

  it('does not write on dry-run or empty generation', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'doc2query-repo-'));
    const outside = mkdtempSync(join(tmpdir(), 'doc2query-off-'));
    const indexPath = join(outside, 'retrieval-index.json');
    const original = `${JSON.stringify({
      scripts: [{ scriptId: 'ship', title: '发货时效', questionText: '发货', answerText: '四十八小时内发出' }],
    })}\n`;
    writeFileSync(indexPath, original);
    const dry = await enrichRetrievalIndex({
      indexPath,
      repoRoot: repo,
      dryRun: true,
      generate: async () => { throw new Error('dry-run must not generate'); },
    });
    expect(dry).toMatchObject({ targeted: 1, updated: 0, wrote: false });
    const failed = await enrichRetrievalIndex({
      indexPath,
      repoRoot: repo,
      generate: async () => new Map(),
    });
    expect(failed).toMatchObject({ targeted: 1, updated: 0, failed: 1, wrote: false });
    expect(readFileSync(indexPath, 'utf8')).toBe(original);
  });
});

describe('in-repo path helper', () => {
  it('accepts an index under a nested off-repo directory', () => {
    const repo = mkdtempSync(join(tmpdir(), 'doc2query-repo-'));
    const outside = mkdtempSync(join(tmpdir(), 'doc2query-off-'));
    mkdirSync(join(outside, 'nested'));
    expect(assertOffRepoIndexPath(join(outside, 'nested', 'retrieval-index.json'), repo)).toContain('nested');
  });
});
