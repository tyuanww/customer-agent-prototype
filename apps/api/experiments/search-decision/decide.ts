import { judgeSearch as productJudgeSearch } from '../../src/search-decision.js';
import { judgeDemand } from './demand-judge.js';
import { loadLabSearch } from './lab-search.js';
import type {
  DemandRole,
  DemandVerdict,
  JudgableCandidate,
  LayerResult,
  PipelineResult,
  SyntheticSource,
} from './types.js';

export function toJudgableOriginal(source: SyntheticSource): JudgableCandidate {
  return Object.freeze({
    scriptId: source.id,
    title: source.title,
    answerText: source.body,
    questionTexts: Object.freeze([...source.questions]),
    searchFallbackText: [source.title, ...source.questions].join(' '),
  });
}

export function toJudgableAlias(source: SyntheticSource): JudgableCandidate {
  const aliasFields = [...source.annotation.subjects, ...source.annotation.aliases];
  return Object.freeze({
    scriptId: source.id,
    title: source.title,
    answerText: source.body,
    questionTexts: Object.freeze([...source.questions, ...aliasFields]),
    searchFallbackText: [source.title, ...source.questions, ...aliasFields].join(' '),
  });
}

function asLayer(result: { decision: LayerResult['decision']; shownScriptIds: readonly string[] }): LayerResult {
  return Object.freeze({
    decision: result.decision,
    shownScriptIds: result.shownScriptIds,
  });
}

export function runOriginal(query: string, sources: readonly SyntheticSource[]): LayerResult {
  return asLayer(productJudgeSearch(query, sources.map(toJudgableOriginal)));
}

export function demandRole(verdict: DemandVerdict): DemandRole {
  if (verdict.reason === 'missing_annotation' || verdict.reason === 'conflict_annotation') return 'unusable';
  if (verdict.kind === 'answered') return 'complete';
  if (verdict.kind === 'subject_only') return 'insufficient';
  if (verdict.reason === 'unanswered_remainder' && verdict.subject !== undefined) return 'insufficient';
  return 'undetermined';
}

/**
 * Unique owner of show/reject/clarify for this experiment.
 * Compatibility is inspectSearch.conflict (existing candidateConflict combo).
 */
export async function decideSearch(
  query: string,
  sources: readonly SyntheticSource[],
): Promise<PipelineResult> {
  const lab = await loadLabSearch();
  const demand = sources.map((source) => judgeDemand(query, source));
  const speech = lab.inspectSearch(query, []);
  if (speech.decision === 'clarify_or_no_result') {
    return Object.freeze({
      decision: 'clarify_or_no_result',
      shownScriptIds: Object.freeze([]),
      demand: Object.freeze(demand),
      step: 'Q1_or_Q2',
    });
  }
  if (sources.length === 0) {
    return Object.freeze({
      decision: 'reject',
      shownScriptIds: Object.freeze([]),
      demand: Object.freeze(demand),
      step: 'Q3',
    });
  }

  const bySource = new Map(sources.map((source) => [source.id, source]));
  const available = sources.filter((source) => source.annotation.status === 'ok');
  const inspection = lab.inspectSearch(query, available.map(toJudgableAlias));
  const rows = new Map(inspection.candidates.map((row) => [row.scriptId, row]));

  const completeIds: string[] = [];
  const insufficientIds: string[] = [];
  for (const verdict of demand) {
    const source = bySource.get(verdict.sourceId);
    if (!source || source.annotation.status !== 'ok') continue;
    const role = demandRole(verdict);
    if (role === 'unusable' || role === 'undetermined') continue;
    const row = rows.get(source.id);
    if (row === undefined || row.conflict) continue;
    if (role === 'complete') completeIds.push(source.id);
    else if (role === 'insufficient') insufficientIds.push(source.id);
  }

  const completeSet = new Set(completeIds);
  if (completeIds.length > 0) {
    const before = inspection.shownBeforeAmbiguity.filter((id) => completeSet.has(id));
    const after = inspection.shownAfterAmbiguity.filter((id) => completeSet.has(id));
    if (after.length > 0) {
      return Object.freeze({
        decision: 'show',
        shownScriptIds: Object.freeze(after),
        demand: Object.freeze(demand),
        step: 'Q4a',
      });
    }
    if (before.length > 0 && after.length === 0) {
      return Object.freeze({
        decision: 'reject',
        shownScriptIds: Object.freeze([]),
        demand: Object.freeze(demand),
        step: 'Q4b',
      });
    }
  }

  if (insufficientIds.length > 0) {
    return Object.freeze({
      decision: 'clarify_or_no_result',
      shownScriptIds: Object.freeze([]),
      demand: Object.freeze(demand),
      step: 'Q5',
    });
  }

  return Object.freeze({
    decision: 'reject',
    shownScriptIds: Object.freeze([]),
    demand: Object.freeze(demand),
    step: 'Q6',
  });
}
