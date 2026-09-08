import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_ROOT,
  BASELINE_PATH,
  PRODUCT_SEARCH_DECISION,
  PRODUCT_SEARCH_TEXT,
  fixtureRoot,
} from './paths.js';

export type LabBaseline = Readonly<{
  kind: string;
  status: string;
  product_commit: string;
  files: Readonly<Record<string, string>>;
  fixtures: Readonly<Record<string, string>>;
  n_cases: Readonly<{
    ids: readonly string[];
    known_unresolved: readonly string[];
    unresolved_reasons: Readonly<Record<string, string>>;
  }>;
}>;

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function replaceOnce(source: string, find: string, replacement: string, label: string): string {
  const count = source.split(find).length - 1;
  if (count !== 1) {
    throw new Error(`SEARCH_DECISION_LAB_PATCH_${label}: expected 1 occurrence, found ${count}`);
  }
  return source.replace(find, replacement);
}

export function loadBaseline(): LabBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as LabBaseline;
}

export function assertPinnedHashes(): LabBaseline {
  const baseline = loadBaseline();
  const errors: string[] = [];
  const productFiles: Readonly<Record<string, string>> = {
    'apps/api/src/search-decision.ts': PRODUCT_SEARCH_DECISION,
    'apps/api/src/search-text.ts': PRODUCT_SEARCH_TEXT,
  };
  for (const [rel, expected] of Object.entries(baseline.files)) {
    const path = productFiles[rel];
    if (path === undefined) {
      errors.push(`unknown pin ${rel}`);
      continue;
    }
    const actual = sha256(readFileSync(path));
    if (actual !== expected) {
      errors.push(`${rel} drifted: ${actual} != ${expected} (pinned ${baseline.product_commit})`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`SEARCH_DECISION_LAB_BASELINE_DRIFT: ${errors.join('; ')}`);
  }
  return baseline;
}

export function assertFixtureHashes(): LabBaseline {
  const baseline = loadBaseline();
  const errors: string[] = [];
  const fixtures = fixtureRoot();
  for (const [rel, expected] of Object.entries(baseline.fixtures)) {
    const actual = sha256(readFileSync(join(fixtures, rel.slice('fixtures/'.length))));
    if (actual !== expected) {
      errors.push(`${rel} drifted: ${actual} != ${expected}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`SEARCH_DECISION_LAB_FIXTURE_DRIFT: ${errors.join('; ')}`);
  }
  return baseline;
}

export function testUnfrozenFixturesAllowed(): boolean {
  return process.env.SEARCH_DECISION_LAB_TEST_UNFROZEN === '1';
}

export function requireFrozenFixtures(): LabBaseline {
  if (testUnfrozenFixturesAllowed()) return loadBaseline();
  return assertFixtureHashes();
}

const IMPORT_FIND = "import { normalizeSearchText } from './search-text.js';";
const IMPORT_REPLACE = `import { normalizeSearchText } from '../../../src/search-text.js';
import {
  extractBodyRelationPolar,
  extractQueryRelationPolar,
  relationPolarConflict,
  sameRelationArgument,
  type RelationPolarFact,
} from '../relation-polar.js';`;

const JUDGED_FIND = `export type JudgedSearch = Readonly<{
  decision: SearchDisplayDecision;
  shownScriptIds: readonly string[];
}>;`;

const JUDGED_REPLACE = `export type JudgedSearch = Readonly<{
  decision: SearchDisplayDecision;
  shownScriptIds: readonly string[];
}>;

export type { RelationPolarFact } from '../relation-polar.js';

export type CandidateInspection = Readonly<{
  scriptId: string;
  relevant: boolean;
  conflict: boolean;
  showBeforeAmbiguity: boolean;
  overlap: number;
  queryFacts: readonly RelationPolarFact[];
  sourceFacts: readonly RelationPolarFact[];
  sameRelArg: boolean;
  polarConflict: boolean;
  leftoverHit: boolean;
  exceptionEligible: boolean;
  waivedLeftover: boolean;
}>;

export type SearchInspection = Readonly<{
  decision: SearchDisplayDecision;
  shownScriptIds: readonly string[];
  act: 'confirmation' | 'assertion' | 'info_question' | 'quoted' | 'underspecified';
  shownBeforeAmbiguity: readonly string[];
  shownAfterAmbiguity: readonly string[];
  ambiguityEmptied: boolean;
  candidates: readonly CandidateInspection[];
}>;`;

const VERDICT_FIND = `type CandidateVerdict = Readonly<{
  scriptId: string;
  show: boolean;
  exactQuestion: boolean;
  exactTitle: boolean;
  originalExact: boolean;
  repairedCompact: string;
  phraseQuestion: boolean;
  phraseTitle: boolean;
  overlap: number;
  conflict: boolean;
}>;`;

const VERDICT_REPLACE = `type CandidateVerdict = Readonly<{
  scriptId: string;
  show: boolean;
  relevant: boolean;
  exactQuestion: boolean;
  exactTitle: boolean;
  originalExact: boolean;
  repairedCompact: string;
  phraseQuestion: boolean;
  phraseTitle: boolean;
  overlap: number;
  conflict: boolean;
  analysis: ConflictAnalysis;
}>;`;

const CONFLICT_FIND = `function candidateConflict(
  intent: QueryIntent,
  queryText: string,
  candidate: JudgableCandidate,
  pool: readonly JudgableCandidate[],
  repairedCompact: string,
): boolean {
  const sourceText = corpusOf(candidate);
  const sourceCompact = compactCorpus(candidate);
  const queryCompact = compactSearchText(queryText);
  const queryFacts = factsOf(queryText);
  const sourceFacts = factsOf(sourceText);
  const inverted = directedConflict(queryFacts.directed, sourceFacts.directed)
    && !directedAligned(queryFacts.directed, sourceFacts.directed);
  const qty = quantityConflict(queryFacts.quantity, sourceFacts.quantity);
  const polar = polarConflict(queryFacts.polar, sourceFacts.polar);
  const time = timeConflict(queryFacts.time, sourceFacts.time);
  const duration = durationConflict(queryFacts.duration, sourceFacts.duration);
  const ops = operationMismatch(queryFacts.operations, sourceFacts.operations, sourceCompact);
  const missing = askedObjectMissing(queryText, sourceCompact);
  const product = productSubjectMismatch(queryText, candidate);
  const extraCondition = extraQueryCondition(queryCompact, sourceCompact);
  const override = differentIntentOverride(queryText);
  const politeProduct = unseparatedPoliteProduct(queryCompact, matchCorpus(candidate));
  const negated = negationMismatch(queryCompact, compactCorpus(candidate));
  const sibling = siblingVariantMismatch(queryCompact, candidate, pool);
  const prefix = sharedNounPrefixMismatch(queryCompact, compactSearchText(candidate.title));
  const packaging = missingPackagingVariant(queryCompact, matchCorpus(candidate));
  const leftoverQuery = repairedCompact.length >= 4 ? repairedCompact : queryCompact;
  const leftoverHit = leftoverUnsupported(queryCompact, candidate)
    || leftoverUnsupported(leftoverQuery, candidate);
  const leftover = leftoverHit && !(
    intent.act === 'confirmation'
    && (inverted || qty || polar || time || duration)
  );
  const swappedObject = substitutedObjectToken(queryCompact, compactSearchText(candidate.title));
  const ignoredBan = intent.act === 'assertion' && sourceBanIgnored(queryCompact, sourceCompact);

  if (ops || missing || product || override || extraCondition || politeProduct || negated || sibling || prefix || packaging || leftover || swappedObject || ignoredBan) {
    return true;
  }
  if (intent.act === 'assertion' || intent.hasConflictingAssertionShape) {
    return inverted || qty || polar || time || duration;
  }
  return false;
}`;

const CONFLICT_REPLACE = `type ConflictAnalysis = Readonly<{
  conflict: boolean;
  leftoverHit: boolean;
  polarConflict: boolean;
  sameRelArg: boolean;
  queryFacts: readonly RelationPolarFact[];
  sourceFacts: readonly RelationPolarFact[];
  exceptionEligible: boolean;
  waivedLeftover: boolean;
}>;

function analyzeConflict(
  intent: QueryIntent,
  queryText: string,
  rawQuery: string,
  candidate: JudgableCandidate,
  pool: readonly JudgableCandidate[],
  repairedCompact: string,
): ConflictAnalysis {
  const sourceText = corpusOf(candidate);
  const sourceCompact = compactCorpus(candidate);
  const queryCompact = compactSearchText(queryText);
  const queryFacts = factsOf(queryText);
  const sourceFacts = factsOf(sourceText);
  const queryRel = extractQueryRelationPolar(rawQuery);
  const sourceRel = extractBodyRelationPolar(candidate.answerText);
  const sameRelArg = sameRelationArgument(queryRel, sourceRel);
  const relationPolar = relationPolarConflict(queryRel, sourceRel);
  const inverted = directedConflict(queryFacts.directed, sourceFacts.directed)
    && !directedAligned(queryFacts.directed, sourceFacts.directed);
  const qty = quantityConflict(queryFacts.quantity, sourceFacts.quantity);
  const polar = polarConflict(queryFacts.polar, sourceFacts.polar) || relationPolar;
  const time = timeConflict(queryFacts.time, sourceFacts.time);
  const duration = durationConflict(queryFacts.duration, sourceFacts.duration);
  const ops = operationMismatch(queryFacts.operations, sourceFacts.operations, sourceCompact);
  const missing = askedObjectMissing(queryText, sourceCompact);
  const product = productSubjectMismatch(queryText, candidate);
  const extraCondition = extraQueryCondition(queryCompact, sourceCompact);
  const override = differentIntentOverride(queryText);
  const politeProduct = unseparatedPoliteProduct(queryCompact, matchCorpus(candidate));
  const negated = negationMismatch(queryCompact, compactCorpus(candidate));
  const sibling = siblingVariantMismatch(queryCompact, candidate, pool);
  const prefix = sharedNounPrefixMismatch(queryCompact, compactSearchText(candidate.title));
  const packaging = missingPackagingVariant(queryCompact, matchCorpus(candidate));
  const leftoverQuery = repairedCompact.length >= 4 ? repairedCompact : queryCompact;
  const leftoverHit = leftoverUnsupported(queryCompact, candidate)
    || leftoverUnsupported(leftoverQuery, candidate);
  const leftover = leftoverHit && !(
    intent.act === 'confirmation'
    && (inverted || qty || polar || time || duration)
  );
  const swappedObject = substitutedObjectToken(queryCompact, compactSearchText(candidate.title));
  const ignoredBan = intent.act === 'assertion' && sourceBanIgnored(queryCompact, sourceCompact);
  const early = ops || missing || product || override || extraCondition || politeProduct || negated || sibling || prefix || packaging || leftover || swappedObject || ignoredBan;
  const assertionPolar = (intent.act === 'assertion' || intent.hasConflictingAssertionShape)
    && (inverted || qty || polar || time || duration);
  const exceptionEligible = intent.act === 'confirmation' && relationPolar;
  return Object.freeze({
    conflict: Boolean(early || assertionPolar),
    leftoverHit,
    polarConflict: relationPolar,
    sameRelArg,
    queryFacts: queryRel,
    sourceFacts: sourceRel,
    exceptionEligible,
    waivedLeftover: leftoverHit && exceptionEligible,
  });
}

function candidateConflict(
  intent: QueryIntent,
  queryText: string,
  candidate: JudgableCandidate,
  pool: readonly JudgableCandidate[],
  repairedCompact: string,
): boolean {
  return analyzeConflict(intent, queryText, queryText, candidate, pool, repairedCompact).conflict;
}`;

const JUDGE_FIND = `export function judgeSearch(
  rawQuery: string,
  candidates: readonly JudgableCandidate[],
): JudgedSearch {
  const normalized = normalizeSearchText(rawQuery);
  const intent = interpretQuery(rawQuery);
  if (intent.act === 'underspecified' || intent.act === 'quoted') {
    return Object.freeze({ decision: 'clarify_or_no_result', shownScriptIds: Object.freeze([]) });
  }
  if (candidates.length === 0) {
    return Object.freeze({ decision: 'reject', shownScriptIds: Object.freeze([]) });
  }

  const originalCompact = compactSearchText(rawQuery);
  if (originalCompact.length > 0 && originalCompact.length < 3) {
    const exact = candidates.some((candidate) => (
      isExactQuestion(normalized, candidate) || isExactTitle(normalized, candidate)
    ));
    if (!exact) {
      return Object.freeze({ decision: 'clarify_or_no_result', shownScriptIds: Object.freeze([]) });
    }
  }
  const queryForFacts = intent.clauses.join('，');
  const distinctive = distinctiveGrams(candidates);

  const verdicts: CandidateVerdict[] = candidates.map((candidate) => {
    const titleCompact = compactSearchText(candidate.title);
    const repairedCompact = substitutedObjectToken(originalCompact, titleCompact)
      ? originalCompact
      : repairUnambiguousTypos(originalCompact, repairVocabulary([candidate]));
    const repairedNormalized = repairedCompact.length > 0 ? repairedCompact : normalized;
    const sourceCompact = matchCorpus(candidate);
    const overlap = overlapScore(repairedCompact, sourceCompact);
    const exactQuestion = isExactQuestion(normalized, candidate) || isExactQuestion(repairedNormalized, candidate);
    const exactTitle = isExactTitle(normalized, candidate) || isExactTitle(repairedNormalized, candidate);
    const originalExact = isExactQuestion(normalized, candidate) || isExactTitle(normalized, candidate);
    const phraseQuestion = candidate.questionTexts.some((question) => (
      compactSearchText(question).includes(repairedCompact)
    ));
    const phraseTitle = compactSearchText(candidate.title).includes(repairedCompact);
    const relevant = isRelevant(repairedCompact, normalized, candidate, distinctive)
      || isRelevant(repairedCompact, repairedNormalized, candidate, distinctive);
    const conflict = candidateConflict(intent, queryForFacts, candidate, candidates, repairedCompact);
    return Object.freeze({
      scriptId: candidate.scriptId,
      show: relevant && !conflict,
      exactQuestion,
      exactTitle,
      originalExact,
      repairedCompact,
      phraseQuestion,
      phraseTitle,
      overlap,
      conflict,
    });
  });

  const shown = dropAmbiguousVariants(
    verdicts.filter((verdict) => verdict.show).sort(compareVerdicts),
    normalized,
    originalCompact,
    candidates,
  );
  if (shown.length > 0) {
    return Object.freeze({
      decision: 'show',
      shownScriptIds: Object.freeze(shown.map((verdict) => verdict.scriptId)),
    });
  }
  return Object.freeze({ decision: 'reject', shownScriptIds: Object.freeze([]) });
}`;

const JUDGE_REPLACE = `function emptyInspection(
  decision: SearchDisplayDecision,
  act: SearchInspection['act'],
): SearchInspection {
  return Object.freeze({
    decision,
    shownScriptIds: Object.freeze([]),
    act,
    shownBeforeAmbiguity: Object.freeze([]),
    shownAfterAmbiguity: Object.freeze([]),
    ambiguityEmptied: false,
    candidates: Object.freeze([]),
  });
}

/**
 * Diagnostic export of the existing owner. Not a public API.
 * Exposes per-source candidateConflict and pre/post ambiguity lists.
 * judgeSearch remains the three-value wrapper over this inspection.
 */
export function inspectSearch(
  rawQuery: string,
  candidates: readonly JudgableCandidate[],
): SearchInspection {
  const normalized = normalizeSearchText(rawQuery);
  const intent = interpretQuery(rawQuery);
  if (intent.act === 'underspecified' || intent.act === 'quoted') {
    return emptyInspection('clarify_or_no_result', intent.act);
  }
  if (candidates.length === 0) {
    return emptyInspection('reject', intent.act);
  }

  const originalCompact = compactSearchText(rawQuery);
  if (originalCompact.length > 0 && originalCompact.length < 3) {
    const exact = candidates.some((candidate) => (
      isExactQuestion(normalized, candidate) || isExactTitle(normalized, candidate)
    ));
    if (!exact) {
      return emptyInspection('clarify_or_no_result', intent.act);
    }
  }
  const queryForFacts = intent.clauses.join('，');
  const distinctive = distinctiveGrams(candidates);

  const verdicts: CandidateVerdict[] = candidates.map((candidate) => {
    const titleCompact = compactSearchText(candidate.title);
    const repairedCompact = substitutedObjectToken(originalCompact, titleCompact)
      ? originalCompact
      : repairUnambiguousTypos(originalCompact, repairVocabulary([candidate]));
    const repairedNormalized = repairedCompact.length > 0 ? repairedCompact : normalized;
    const overlap = overlapScore(repairedCompact, matchCorpus(candidate));
    const exactQuestion = isExactQuestion(normalized, candidate) || isExactQuestion(repairedNormalized, candidate);
    const exactTitle = isExactTitle(normalized, candidate) || isExactTitle(repairedNormalized, candidate);
    const originalExact = isExactQuestion(normalized, candidate) || isExactTitle(normalized, candidate);
    const phraseQuestion = candidate.questionTexts.some((question) => (
      compactSearchText(question).includes(repairedCompact)
    ));
    const phraseTitle = compactSearchText(candidate.title).includes(repairedCompact);
    const relevant = isRelevant(repairedCompact, normalized, candidate, distinctive)
      || isRelevant(repairedCompact, repairedNormalized, candidate, distinctive);
    const analysis = analyzeConflict(intent, queryForFacts, rawQuery, candidate, candidates, repairedCompact);
    const conflict = analysis.conflict;
    return Object.freeze({
      scriptId: candidate.scriptId,
      show: relevant && !conflict,
      relevant,
      exactQuestion,
      exactTitle,
      originalExact,
      repairedCompact,
      phraseQuestion,
      phraseTitle,
      overlap,
      conflict,
      analysis,
    });
  });

  const shownBefore = verdicts.filter((verdict) => verdict.show).sort(compareVerdicts);
  const shownAfter = dropAmbiguousVariants(
    shownBefore,
    normalized,
    originalCompact,
    candidates,
  );
  const decision: SearchDisplayDecision = shownAfter.length > 0 ? 'show' : 'reject';
  return Object.freeze({
    decision,
    shownScriptIds: Object.freeze(shownAfter.map((verdict) => verdict.scriptId)),
    act: intent.act,
    shownBeforeAmbiguity: Object.freeze(shownBefore.map((verdict) => verdict.scriptId)),
    shownAfterAmbiguity: Object.freeze(shownAfter.map((verdict) => verdict.scriptId)),
    ambiguityEmptied: shownBefore.length > 0 && shownAfter.length === 0,
    candidates: Object.freeze(verdicts.map((verdict) => Object.freeze({
      scriptId: verdict.scriptId,
      relevant: verdict.relevant,
      conflict: verdict.conflict,
      showBeforeAmbiguity: verdict.show,
      overlap: verdict.overlap,
      queryFacts: verdict.analysis.queryFacts,
      sourceFacts: verdict.analysis.sourceFacts,
      sameRelArg: verdict.analysis.sameRelArg,
      polarConflict: verdict.analysis.polarConflict,
      leftoverHit: verdict.analysis.leftoverHit,
      exceptionEligible: verdict.analysis.exceptionEligible,
      waivedLeftover: verdict.analysis.waivedLeftover,
    }))),
  });
}

export function judgeSearch(
  rawQuery: string,
  candidates: readonly JudgableCandidate[],
): JudgedSearch {
  const inspected = inspectSearch(rawQuery, candidates);
  return Object.freeze({
    decision: inspected.decision,
    shownScriptIds: inspected.shownScriptIds,
  });
}`;

export function applyLabInstrumentation(source: string): string {
  let next = source;
  next = replaceOnce(next, IMPORT_FIND, IMPORT_REPLACE, 'IMPORT');
  next = replaceOnce(next, JUDGED_FIND, JUDGED_REPLACE, 'TYPES');
  next = replaceOnce(next, VERDICT_FIND, VERDICT_REPLACE, 'VERDICT');
  next = replaceOnce(next, CONFLICT_FIND, CONFLICT_REPLACE, 'CONFLICT');
  next = replaceOnce(next, JUDGE_FIND, JUDGE_REPLACE, 'JUDGE');
  if (!next.includes('extractBodyRelationPolar')) {
    throw new Error('SEARCH_DECISION_LAB_PATCH_MISSING_RELATION');
  }
  if (next.includes(API_ROOT) || next.includes('/Users/')) {
    throw new Error('SEARCH_DECISION_LAB_PATCH_ABSOLUTE_PATH');
  }
  return next;
}
