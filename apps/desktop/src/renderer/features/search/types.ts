import type { ProductCopyRequest } from '../../../shared/product-search';
export type RiskLevel = 'low' | 'medium' | 'high';

export type ScriptDomain = '产品' | '活动' | '售前' | '售后';

export type SearchIntent =
  | 'usage'
  | 'safety'
  | 'compatibility'
  | 'promotion'
  | 'aftersales'
  | 'return_policy';

export type SearchAnchor = Readonly<{
  kind: 'entity' | 'topic';
  label: string;
  canonical: string;
  aliases: readonly string[];
}>;

export type SearchMetadata = Readonly<{
  intents: readonly SearchIntent[];
  anchors: readonly SearchAnchor[];
}>;

export type ScriptFixture = Readonly<{
  scriptId: string;
  domain: ScriptDomain;
  questionVariants: readonly string[];
  answerText: string;
  platform: string;
  scopeLabel: string;
  riskLevel: RiskLevel;
  effectiveFrom: string;
  effectiveTo: string;
  search: SearchMetadata;
}>;

export type MatchKind = 'exact' | 'alias' | 'semantic' | 'similar';

export type RankedScript = Omit<ScriptFixture, 'search'> & {
  rank: 1 | 2 | 3;
  score: number;
  productCopy?: Omit<ProductCopyRequest, 'placeholderValues'>;
  placeholderKeys?: ('order_id' | 'date')[];
  matchKind: MatchKind;
  matchLabel: string;
};

export type SearchOutcome =
  | { status: 'hit'; results: RankedScript[] }
  | { status: 'no-hit' }
  | { status: 'invalid'; reason: 'too-long' };
