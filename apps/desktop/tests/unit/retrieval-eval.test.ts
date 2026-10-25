/**
 * Offline retrieval evaluation (E1).
 *
 * Measures the desktop BM25 + RRF pipeline and its abstention gate against a purely
 * synthetic corpus and a hand-written query set. Run with:
 *
 *   pnpm --filter @customer-agent/desktop eval:retrieval
 *
 * Skipped in the normal suite: it is a measurement, not a behavioural assertion, and its
 * bars move when the corpus or the query set is revised by a human reviewer.
 *
 * What this does NOT measure:
 * - The dense (embedding) and rerank lanes. Those need MiniMax credentials; without them
 *   `rankScripts` falls back to the answer-text BM25 lane, which is the path measured here.
 * - The production script library. That index lives off-repo; see docs/how-to-verify-desktop.md.
 * - Platform-specific ranking. `evaluate` ranks the full corpus, then buckets positives
 *   by the gold script's platform. The qianniu and douyin rows are different case sets,
 *   so their rates are not required to match. Negatives use platform `any`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import corpusDocument from '../fixtures/retrieval-eval/corpus.json';
import casesDocument from '../fixtures/retrieval-eval/cases.json';
import { rankScriptsMulti, RETRIEVAL_POOL, type RetrievalScript } from '../../src/shared/hybrid-retrieve';
import { admitRetrieval } from '../../src/shared/retrieval-quality';

const RUN = process.env.CUSTOMER_AGENT_RETRIEVAL_EVAL === '1';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DEV_SHARE = 2; // out of 5: 40% of scripts are development, 60% held out.

type CorpusScript = RetrievalScript & { readonly category: string; readonly platform: string };
type Case = Readonly<{ id: string; query: string; expected: string | null; category: string; platform: string; split: Split }>;
type Split = 'dev' | 'test';

const corpus = (corpusDocument as { scripts: CorpusScript[] }).scripts;
const cases = (casesDocument as { positives: Record<string, string[]>; negatives: string[] });

const scriptIds = new Set(corpus.map((script) => script.scriptId));
const byId = new Map(corpus.map((script) => [script.scriptId, script]));

/**
 * The split is a property of the script, never of the query: a script whose title is in the
 * development half must not also contribute held-out queries, or comparing runs would leak.
 * The hash keeps it stable across corpus edits that add new scripts.
 */
function splitOf(scriptId: string): Split {
  const digest = createHash('sha256').update(scriptId).digest();
  return (digest[0]! % 5) < DEV_SHARE ? 'dev' : 'test';
}

function buildCases(): Case[] {
  const built: Case[] = [];
  for (const [scriptId, queries] of Object.entries(cases.positives)) {
    const script = byId.get(scriptId);
    if (!script) throw new Error(`cases.json names an unknown script: ${scriptId}`);
    for (const [offset, query] of queries.entries()) {
      built.push({
        id: `${scriptId}#${String(offset + 1)}`,
        query,
        expected: scriptId,
        category: script.category,
        platform: script.platform,
        split: splitOf(scriptId),
      });
    }
  }
  for (const [offset, query] of cases.negatives.entries()) {
    built.push({
      id: `negative#${String(offset + 1)}`,
      query,
      expected: null,
      category: 'negative',
      platform: 'any',
      // Negatives carry no script, so their split is fixed by position to keep the held-out
      // share stable without letting them be tuned per query.
      split: offset % 5 < DEV_SHARE ? 'dev' : 'test',
    });
  }
  return built;
}

type Tally = { positives: number; top3: number; reciprocalRank: number; negatives: number; abstained: number };

const emptyTally = (): Tally => ({ positives: 0, top3: 0, reciprocalRank: 0, negatives: 0, abstained: 0 });

function add(into: Tally, from: Tally): void {
  into.positives += from.positives;
  into.top3 += from.top3;
  into.reciprocalRank += from.reciprocalRank;
  into.negatives += from.negatives;
  into.abstained += from.abstained;
}

const percent = (numerator: number, denominator: number): string =>
  denominator === 0 ? '—' : `${(numerator / denominator * 100).toFixed(1)}%`;

function evaluate(selected: readonly Case[]) {
  const overall = emptyTally();
  const byCategory = new Map<string, Tally>();
  const byPlatform = new Map<string, Tally>();
  const misses: string[] = [];

  for (const item of selected) {
    const ranked = admitRetrieval(item.query, rankScriptsMulti([item.query], corpus, RETRIEVAL_POOL, null));
    const bucket = emptyTally();
    if (item.expected === null) {
      bucket.negatives = 1;
      if (ranked.length === 0) bucket.abstained = 1;
      else misses.push(`${item.id} 期望无命中，实际命中 ${ranked[0]!.scriptId}`);
    } else {
      bucket.positives = 1;
      const top3 = ranked.slice(0, 3);
      const position = top3.findIndex((row) => row.scriptId === item.expected);
      if (position >= 0) {
        bucket.top3 = 1;
        bucket.reciprocalRank = 1 / (position + 1);
      } else {
        misses.push(`${item.id} 期望 ${item.expected}，实际前3 ${top3.map((row) => row.scriptId).join(',') || '(空)'}`);
      }
    }
    add(overall, bucket);
    for (const key of [item.category]) {
      const tally = byCategory.get(key) ?? emptyTally();
      add(tally, bucket);
      byCategory.set(key, tally);
    }
    const platform = byPlatform.get(item.platform) ?? emptyTally();
    add(platform, bucket);
    byPlatform.set(item.platform, platform);
  }

  return { overall, byCategory, byPlatform, misses };
}

function renderRow(label: string, tally: Tally): string {
  const mrr = tally.positives === 0 ? '—' : (tally.reciprocalRank / tally.positives).toFixed(3);
  return `| ${label} | ${String(tally.positives)} | ${percent(tally.top3, tally.positives)} | ${mrr} | ${String(tally.negatives)} | ${percent(tally.abstained, tally.negatives)} |`;
}

function renderTable(title: string, sections: readonly [string, Tally][]): string {
  return [
    `### ${title}`,
    '',
    '| 分组 | 正例数 | Top-3 命中率 | MRR | 负例数 | 无命中正确率 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sections.map(([label, tally]) => renderRow(label, tally)),
  ].join('\n');
}

describe.skipIf(!RUN)('retrieval evaluation', () => {
  it('reports Top-3, MRR and no-answer accuracy on the held-out split', () => {
    const all = buildCases();
    const dev = all.filter((item) => item.split === 'dev');
    const test = all.filter((item) => item.split === 'test');
    const corpusCategories = [...new Set(corpus.map((script) => script.category))].sort();
    const corpusPlatforms = [...new Set(corpus.map((script) => script.platform))].sort();

    for (const scriptId of Object.keys(cases.positives)) {
      if (!scriptIds.has(scriptId)) throw new Error(`unknown script ${scriptId}`);
    }

    console.log(`corpus: ${String(corpus.length)} scripts (${corpusCategories.join(', ')})`);
    console.log(`cases: ${String(all.length)}  dev=${String(dev.length)}  test=${String(test.length)}`);

    for (const [name, split] of [['development', dev], ['held-out', test]] as const) {
      const result = evaluate(split);
      console.log('');
      console.log(`## ${name} (${String(split.length)} cases)`);
      console.log(renderTable(`${name} · 总体与分组`, [
        ['全部', result.overall],
        ...corpusCategories.map((category): [string, Tally] => [category, result.byCategory.get(category) ?? emptyTally()]),
        ...corpusPlatforms.map((platform): [string, Tally] => [`platform:${platform}`, result.byPlatform.get(platform) ?? emptyTally()]),
      ]));
      if (result.misses.length > 0) {
        console.log('');
        console.log(`未命中（${String(result.misses.length)}）：`);
        for (const miss of result.misses) console.log(`- ${miss}`);
      }
    }

    const heldOut = evaluate(test);
    // These are floors, not targets: they sit just under the 2026-10-24 baseline
    // (Top-3 67.6%, no-answer 33.3% on 170 positives and 30 negatives) so that a harness or
    // pipeline regression fails loudly. The no-answer floor is deliberately low because the
    // baseline itself is low; raising retrieval abstention is a separate change, and tuning it
    // against this file would defeat the held-out split.
    expect(heldOut.overall.positives).toBeGreaterThanOrEqual(150);
    expect(heldOut.overall.negatives).toBeGreaterThanOrEqual(25);
    expect(heldOut.overall.top3 / heldOut.overall.positives).toBeGreaterThan(0.6);
    expect(heldOut.overall.abstained / heldOut.overall.negatives).toBeGreaterThan(0.25);
  }, 120_000);
});

// Guard against a corpus/cases edit that leaves the fixtures unreadable even when the
// measurement run is skipped.
describe('retrieval evaluation fixtures', () => {
  it('keeps every positive case pointing at a script in the corpus', () => {
    const document = JSON.parse(readFileSync(path.join(HERE, '../fixtures/retrieval-eval/cases.json'), 'utf8')) as typeof cases;
    for (const scriptId of Object.keys(document.positives)) expect(scriptIds.has(scriptId)).toBe(true);
    expect(document.negatives.length).toBeGreaterThan(0);
  });

  it('does not use a script title or question verbatim as an evaluation query', () => {
    const indexed = new Set(corpus.flatMap((script) => [script.title, script.questionText]));
    const built = buildCases().filter((item) => item.expected !== null);
    const collisions = built.filter((item) => indexed.has(item.query));
    expect(collisions.map((item) => item.id)).toEqual([]);
  });
});
