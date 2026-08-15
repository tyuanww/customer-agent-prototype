import { MAX_QUERY_CHARS } from '@shared/contracts';
import { SYNTHETIC_SCRIPTS } from '../../data/synthetic-scripts';
import type {
  MatchKind,
  RankedScript,
  ScriptFixture,
  SearchOutcome,
} from './types';
import {
  matchSearchMetadata,
  understandQuery,
  type QueryUnderstanding,
} from './query-understanding';
import { isCurrentlyEffective, parseValidityRange } from './validity';

export const MIN_HIT_SCORE = 38;
export const MAX_RESULTS = 3;

const MIN_TOPIC_ASSISTED_LEXICAL_SCORE = MIN_HIT_SCORE - 4;

const STOP_TOKENS = new Set([
  '怎么',
  '如何',
  '什么',
  '请问',
  '可以',
  '是否',
  '一下',
  '帮我',
  '我想',
  '问下',
  '吗',
  '呢',
  '啊',
  '的',
  '了',
  '么',
]);

const SCRIPT_DOMAINS = new Set(['产品', '活动', '售前', '售后']);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const SEARCH_INTENTS = new Set([
  'usage',
  'safety',
  'compatibility',
  'promotion',
  'aftersales',
  'return_policy',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidScriptFixture(value: unknown): value is ScriptFixture {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isNonEmptyString(value.scriptId) ||
    !SCRIPT_DOMAINS.has(value.domain as string) ||
    !isNonEmptyString(value.answerText) ||
    !isNonEmptyString(value.platform) ||
    !isNonEmptyString(value.scopeLabel) ||
    !RISK_LEVELS.has(value.riskLevel as string) ||
    !isNonEmptyString(value.effectiveFrom) ||
    !isNonEmptyString(value.effectiveTo) ||
    !parseValidityRange(value.effectiveFrom, value.effectiveTo)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.questionVariants) ||
    value.questionVariants.length === 0 ||
    !value.questionVariants.every(isNonEmptyString)
  ) {
    return false;
  }
  if (!isRecord(value.search)) {
    return false;
  }
  const intents = value.search.intents;
  const anchors = value.search.anchors;
  if (
    !Array.isArray(intents) ||
    intents.length === 0 ||
    !intents.every((intent) => typeof intent === 'string' && SEARCH_INTENTS.has(intent)) ||
    !Array.isArray(anchors) ||
    anchors.length === 0
  ) {
    return false;
  }
  let hasEntityAnchor = false;
  for (const anchor of anchors) {
    if (
      !isRecord(anchor) ||
      (anchor.kind !== 'entity' && anchor.kind !== 'topic') ||
      !isNonEmptyString(anchor.label) ||
      !isNonEmptyString(anchor.canonical) ||
      !Array.isArray(anchor.aliases) ||
      !anchor.aliases.every(isNonEmptyString)
    ) {
      return false;
    }
    hasEntityAnchor ||= anchor.kind === 'entity';
  }
  return hasEntityAnchor;
}

function fixtureSignature(script: ScriptFixture): string {
  return JSON.stringify(script);
}

function rejectConflictingScriptIds(scripts: readonly ScriptFixture[]): ScriptFixture[] {
  const firstSignature = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const script of scripts) {
    const signature = fixtureSignature(script);
    const previous = firstSignature.get(script.scriptId);
    if (previous === undefined) {
      firstSignature.set(script.scriptId, signature);
    } else if (previous !== signature) {
      conflicts.add(script.scriptId);
    }
  }
  return scripts.filter((script) => !conflicts.has(script.scriptId));
}

type QueryFeatures = {
  normalized: string;
  coreOrNormalized: string;
  compact: string;
  compactLen: number;
  tokens: string[];
  bigrams: string[];
  trigrams: string[];
  understanding: QueryUnderstanding;
};

type ScriptScore = {
  score: number;
  lexicalScore: number;
  exact: boolean;
  matchKind: MatchKind;
  matchLabel: string;
};

export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStopTokens(text: string): string {
  // Only remove standalone space-delimited fillers. Replacing characters in a
  // continuous Chinese term can corrupt legitimate product/entity names.
  return text
    .split(' ')
    .filter((token) => token && !STOP_TOKENS.has(token))
    .join(' ')
    .trim();
}

function tokensOf(text: string): string[] {
  const parts = text.split(' ').filter((part) => part.length >= 2);
  return unique(parts);
}

function ngrams(text: string, size: number): string[] {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < size) {
    return compact.length > 0 ? [compact] : [];
  }
  const grams: string[] = [];
  for (let i = 0; i <= compact.length - size; i += 1) {
    grams.push(compact.slice(i, i + size));
  }
  return grams;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const left = new Set(a);
  const right = new Set(b);
  let inter = 0;
  for (const item of left) {
    if (right.has(item)) {
      inter += 1;
    }
  }
  return inter / (left.size + right.size - inter);
}

function recall(needles: string[], haystack: string[]): number {
  if (needles.length === 0) {
    return 0;
  }
  const pool = new Set(haystack);
  let hit = 0;
  for (const item of needles) {
    if (pool.has(item)) {
      hit += 1;
    }
  }
  return hit / needles.length;
}

function longestCommonSubstring(leftCompact: string, rightText: string): number {
  const right = rightText.replace(/\s+/g, '');
  if (!leftCompact || !right) {
    return 0;
  }
  const table: number[] = new Array(right.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= leftCompact.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const stored = table[j];
      if (leftCompact[i - 1] === right[j - 1]) {
        table[j] = prev + 1;
        if (table[j] > best) {
          best = table[j];
        }
      } else {
        table[j] = 0;
      }
      prev = stored;
    }
  }
  return best;
}

function buildQueryFeatures(normalizedQuery: string): QueryFeatures {
  const queryCore = stripStopTokens(normalizedQuery);
  const coreOrNormalized = queryCore || normalizedQuery;
  return {
    normalized: normalizedQuery,
    coreOrNormalized,
    compact: coreOrNormalized.replace(/\s+/g, ''),
    compactLen: Math.max(coreOrNormalized.replace(/\s+/g, '').length, 1),
    tokens: tokensOf(queryCore),
    bigrams: unique(ngrams(coreOrNormalized, 2).filter((gram) => !STOP_TOKENS.has(gram))),
    trigrams: unique(ngrams(coreOrNormalized, 3)),
    understanding: understandQuery(normalizedQuery),
  };
}

function scoreAgainstVariant(features: QueryFeatures, variant: string): number {
  const normalizedVariant = normalizeQuery(variant);
  if (!normalizedVariant) {
    return 0;
  }

  if (features.normalized === normalizedVariant) {
    return 100;
  }

  let substring = 0;
  if (features.normalized.length >= 4 && normalizedVariant.includes(features.normalized)) {
    substring = 70 + 25 * (features.normalized.length / normalizedVariant.length);
  } else if (
    normalizedVariant.length >= 4 &&
    features.normalized.includes(normalizedVariant)
  ) {
    substring = 62 + 20 * (normalizedVariant.length / features.normalized.length);
  }

  const variantCore = stripStopTokens(normalizedVariant);
  const variantCoreOrNormalized = variantCore || normalizedVariant;
  const variantBigrams = unique(ngrams(variantCoreOrNormalized, 2));
  const variantTrigrams = unique(ngrams(variantCoreOrNormalized, 3));

  const bigramRecall = recall(features.bigrams, variantBigrams);
  const trigramRecall = recall(features.trigrams, variantTrigrams);
  const tokenScore = jaccard(features.tokens, tokensOf(variantCore)) * 20;
  const lcs = longestCommonSubstring(features.compact, variantCoreOrNormalized);
  const lcsScore = Math.min(lcs / features.compactLen, 1) * 28;

  const fuzzy = bigramRecall * 32 + trigramRecall * 22 + tokenScore + lcsScore;
  const score = Math.max(substring, fuzzy);
  return Math.min(99, Math.round(score * 10) / 10);
}

function scoreScriptWithFeatures(features: QueryFeatures, script: ScriptFixture): ScriptScore {
  let best = 0;
  for (const variant of script.questionVariants) {
    const next = scoreAgainstVariant(features, variant);
    if (next > best) {
      best = next;
    }
    if (best === 100) {
      break;
    }
  }
  if (best === 100) {
    return {
      score: 100,
      lexicalScore: 100,
      exact: true,
      matchKind: 'exact',
      matchLabel: '精确问法',
    };
  }

  const semantic = matchSearchMetadata(features.understanding, script.search);
  if (!semantic.entityMatched) {
    if (
      semantic.topicContextMatched &&
      best >= MIN_TOPIC_ASSISTED_LEXICAL_SCORE
    ) {
      return {
        score: Math.max(best, MIN_HIT_SCORE),
        lexicalScore: best,
        exact: false,
        matchKind: 'similar',
        matchLabel: '品类问题 · 相似问法',
      };
    }
    return {
      score: 0,
      lexicalScore: best,
      exact: false,
      matchKind: 'similar',
      matchLabel: '相似问法',
    };
  }

  // Some aliases deliberately omit the synthetic brand so users can ask by
  // category. After removing that alias and supported intent wording, no
  // unknown text may remain; otherwise an unrelated brand prefix could borrow
  // the generic alias and cross-match this fixture.
  if (
    !semantic.entityScopeMatched &&
    !semantic.entityContextClean
  ) {
    return {
      score: 0,
      lexicalScore: best,
      exact: false,
      matchKind: 'similar',
      matchLabel: '相似问法',
    };
  }
  const score = Math.min(99, Math.max(best, semantic.score));
  if (semantic.score >= best && semantic.kind) {
    return {
      score,
      lexicalScore: best,
      exact: false,
      matchKind: semantic.kind,
      matchLabel: semantic.label,
    };
  }
  return {
    score,
    lexicalScore: best,
    exact: false,
    matchKind: 'similar',
    matchLabel: '相似问法',
  };
}

export function scoreScript(query: string, script: ScriptFixture): number {
  if (query.length > MAX_QUERY_CHARS) {
    return 0;
  }
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return 0;
  }
  if (!isValidScriptFixture(script)) {
    return 0;
  }
  const features = buildQueryFeatures(normalizedQuery);
  if (features.understanding.genericOnly) {
    return 0;
  }
  return scoreScriptWithFeatures(features, script).score;
}

function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function dedupeCandidates<T extends { script: ScriptFixture }>(candidates: readonly T[]): T[] {
  const ids = new Set<string>();
  const answers = new Set<string>();
  const uniqueCandidates: T[] = [];
  for (const candidate of candidates) {
    const answerKey = normalizeQuery(candidate.script.answerText);
    if (ids.has(candidate.script.scriptId) || answers.has(answerKey)) {
      continue;
    }
    ids.add(candidate.script.scriptId);
    answers.add(answerKey);
    uniqueCandidates.push(candidate);
  }
  return uniqueCandidates;
}

export function searchScripts(
  query: string,
  scripts: readonly ScriptFixture[] = SYNTHETIC_SCRIPTS,
  now: Date = new Date(),
): SearchOutcome {
  if (query.length > MAX_QUERY_CHARS) {
    return { status: 'invalid', reason: 'too-long' };
  }

  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return { status: 'no-hit' };
  }

  const features = buildQueryFeatures(normalizedQuery);
  if (features.understanding.genericOnly) {
    return { status: 'no-hit' };
  }

  const validScripts = rejectConflictingScriptIds(scripts.filter(isValidScriptFixture));
  const candidates = validScripts
    .filter((script) =>
      isCurrentlyEffective(script.effectiveFrom, script.effectiveTo, now),
    )
    .map((script) => ({
      script,
      ...scoreScriptWithFeatures(features, script),
    }))
    .filter((item) => item.score >= MIN_HIT_SCORE)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.exact !== b.exact) {
        return a.exact ? -1 : 1;
      }
      if (b.lexicalScore !== a.lexicalScore) {
        return b.lexicalScore - a.lexicalScore;
      }
      return compareAscii(a.script.scriptId, b.script.scriptId);
    });
  const ranked = dedupeCandidates(candidates).slice(0, MAX_RESULTS);

  if (ranked.length === 0) {
    return { status: 'no-hit' };
  }

  const results: RankedScript[] = ranked.map((item, index) => ({
    scriptId: item.script.scriptId,
    domain: item.script.domain,
    questionVariants: item.script.questionVariants,
    answerText: item.script.answerText,
    platform: item.script.platform,
    scopeLabel: item.script.scopeLabel,
    riskLevel: item.script.riskLevel,
    effectiveFrom: item.script.effectiveFrom,
    effectiveTo: item.script.effectiveTo,
    rank: (index + 1) as 1 | 2 | 3,
    score: item.score,
    matchKind: item.matchKind,
    matchLabel: item.matchLabel,
  }));

  return { status: 'hit', results };
}
