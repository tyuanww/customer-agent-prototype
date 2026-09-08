import type { JudgableCandidate } from '../../src/search-decision.js';

export type { JudgableCandidate };

export type DemandKind = 'answered' | 'subject_only' | 'conflicting' | 'unknown';

export type AnnotationStatus = 'ok' | 'missing' | 'conflict';

export type SourceAnnotation = Readonly<{
  producer: string;
  subjects: readonly string[];
  aliases: readonly string[];
  answerable_needs: readonly string[];
  constraints: readonly string[];
  overview_showable: boolean;
  status: AnnotationStatus;
}>;

export type SyntheticSource = Readonly<{
  id: string;
  kind: 'SYNTHETIC';
  title: string;
  body: string;
  questions: readonly string[];
  annotation: SourceAnnotation;
}>;

export type DemandVerdict = Readonly<{
  sourceId: string;
  kind: DemandKind;
  reason: string;
  subject?: string;
  remainder?: string;
  matchedNeeds: readonly string[];
}>;

export type DisplayDecision = 'show' | 'reject' | 'clarify_or_no_result';

export type LayerResult = Readonly<{
  decision: DisplayDecision;
  shownScriptIds: readonly string[];
}>;

export type DemandRole = 'complete' | 'insufficient' | 'undetermined' | 'unusable';

export type PipelineResult = Readonly<{
  decision: DisplayDecision;
  shownScriptIds: readonly string[];
  demand: readonly DemandVerdict[];
  step: string;
}>;

export type RelationPolarFact = Readonly<{
  polarity: 'pos' | 'neg';
  relation: string;
  argument: string;
  marker: '不' | null;
}>;

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
  decision: DisplayDecision;
  shownScriptIds: readonly string[];
  act: 'confirmation' | 'assertion' | 'info_question' | 'quoted' | 'underspecified';
  shownBeforeAmbiguity: readonly string[];
  shownAfterAmbiguity: readonly string[];
  ambiguityEmptied: boolean;
  candidates: readonly CandidateInspection[];
}>;

export type LabSearchModule = Readonly<{
  inspectSearch: (query: string, candidates: readonly JudgableCandidate[]) => SearchInspection;
  judgeSearch: (query: string, candidates: readonly JudgableCandidate[]) => LayerResult;
}>;

export type CaseSpec = Readonly<{
  id: string;
  family: 'regression' | 'synthetic-new';
  seen: boolean;
  bucket: string;
  query: string;
  pool: readonly string[];
  expected: Readonly<{
    decision: DisplayDecision;
    shownScriptIds: readonly string[];
  }>;
  note: string;
}>;
