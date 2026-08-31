import type {
  MatchKind,
  SearchIntent,
  SearchMetadata,
} from './types';

export const SEARCH_INTENT_LABELS: Readonly<Record<SearchIntent, string>> = Object.freeze({
  usage: '使用方法',
  safety: '安全咨询',
  compatibility: '搭配顺序',
  promotion: '活动规则',
  aftersales: '售后处理',
  return_policy: '退换规则',
});

const INTENT_SIGNALS: Readonly<Record<SearchIntent, readonly string[]>> = Object.freeze({
  usage: Object.freeze(['怎么用', '如何用', '怎样用', '咋用', '咋使', '用法', '使用步骤', '使用频率', '补涂']),
  safety: Object.freeze(['能用吗', '可以用吗', '孕期', '怀孕', '敏感肌', '刺痛', '泛红', '红肿', '过敏', '不适']),
  compatibility: Object.freeze(['一起用', '同用', '叠加', '搭配', '先用', '后用', '顺序']),
  promotion: Object.freeze(['活动', '满赠', '买赠', '积分', '兑换', '优惠', '赠品']),
  aftersales: Object.freeze(['怎么办', '怎么处理', '售后', '投诉', '闷痘', '长痘', '过敏', '红肿']),
  return_policy: Object.freeze([
    '退货',
    '退款',
    '退换',
    '无理由',
    '拆封',
    '拆封后能不能退',
    '拆封了还能退吗',
  ]),
});

const GENERIC_FILLERS = Object.freeze([
  '请问',
  '可以',
  '是否',
  '一下',
  '帮我',
  '我想',
  '问下',
  '什么',
  '怎么',
  '如何',
  '吗',
  '呢',
  '啊',
  '的',
  '了',
]);

export type QueryUnderstanding = Readonly<{
  normalized: string;
  compact: string;
  intents: readonly SearchIntent[];
  genericOnly: boolean;
}>;

export type SemanticMatch = Readonly<{
  score: number;
  entityMatched: boolean;
  entityScopeMatched: boolean;
  entityContextClean: boolean;
  topicContextMatched: boolean;
  kind: Exclude<MatchKind, 'exact' | 'similar'> | null;
  label: string;
  matchedAnchors: readonly string[];
  matchedIntents: readonly SearchIntent[];
}>;

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function includesTerm(queryCompact: string, term: string): boolean {
  const normalizedTerm = compact(term.toLowerCase());
  return normalizedTerm.length > 0 && queryCompact.includes(normalizedTerm);
}

function entityScopeToken(canonical: string): string {
  return Array.from(compact(canonical.toLowerCase())).slice(0, 2).join('');
}

function entityCategoryContexts(metadata: SearchMetadata): ReadonlySet<string> {
  const contexts = new Set<string>();
  for (const anchor of metadata.anchors) {
    if (anchor.kind !== 'entity') {
      continue;
    }
    const scope = entityScopeToken(anchor.canonical);
    const scopeLength = Array.from(scope).length;
    for (const term of [anchor.canonical, ...anchor.aliases]) {
      const normalizedTerm = compact(term.toLowerCase());
      const characters = Array.from(normalizedTerm);
      if (scope && normalizedTerm.startsWith(scope) && characters.length > scopeLength) {
        contexts.add(characters.slice(scopeLength).join(''));
      }
    }
  }
  return contexts;
}

function stripMatchedEvidence(
  queryCompact: string,
  matchedTerms: readonly string[],
  intents: readonly SearchIntent[],
): string {
  const withoutKnownSignals = stripKnownSignals(queryCompact, intents);
  return [...matchedTerms]
    .sort((left, right) => right.length - left.length)
    .reduce(
      (remainder, term) => remainder.replaceAll(compact(term.toLowerCase()), ''),
      withoutKnownSignals,
    );
}

function stripKnownSignals(queryCompact: string, intents: readonly SearchIntent[]): string {
  const removable = [
    ...intents.flatMap((intent) => INTENT_SIGNALS[intent]),
    ...GENERIC_FILLERS,
  ].sort((left, right) => right.length - left.length);
  let remainder = queryCompact;
  for (const signal of removable) {
    remainder = remainder.replaceAll(compact(signal), '');
  }
  return remainder;
}

export function understandQuery(normalized: string): QueryUnderstanding {
  const queryCompact = compact(normalized);
  const intents = (Object.keys(INTENT_SIGNALS) as SearchIntent[]).filter((intent) =>
    INTENT_SIGNALS[intent].some((signal) => includesTerm(queryCompact, signal)),
  );
  return Object.freeze({
    normalized,
    compact: queryCompact,
    intents: Object.freeze(intents),
    genericOnly: intents.length > 0 && stripKnownSignals(queryCompact, intents).length === 0,
  });
}

export function matchSearchMetadata(
  query: QueryUnderstanding,
  metadata: SearchMetadata,
): SemanticMatch {
  const matchedAnchors: string[] = [];
  const matchedTerms: string[] = [];
  let entityMatched = false;
  let entityScopeMatched = false;
  let aliasMatched = false;
  let topicMatched = false;

  for (const anchor of metadata.anchors) {
    if (includesTerm(query.compact, anchor.canonical)) {
      matchedAnchors.push(anchor.label);
      matchedTerms.push(anchor.canonical);
      entityMatched ||= anchor.kind === 'entity';
      topicMatched ||= anchor.kind === 'topic';
      if (anchor.kind === 'entity') {
        entityScopeMatched ||= includesTerm(query.compact, entityScopeToken(anchor.canonical));
      }
      continue;
    }
    const matchedAlias = anchor.aliases.find((alias) => includesTerm(query.compact, alias));
    if (matchedAlias) {
      matchedAnchors.push(anchor.label);
      matchedTerms.push(matchedAlias);
      aliasMatched = true;
      entityMatched ||= anchor.kind === 'entity';
      topicMatched ||= anchor.kind === 'topic';
      if (anchor.kind === 'entity') {
        entityScopeMatched ||= includesTerm(query.compact, entityScopeToken(anchor.canonical));
      }
    }
  }

  if (matchedAnchors.length === 0) {
    return Object.freeze({
      score: 0,
      entityMatched: false,
      entityScopeMatched: false,
      entityContextClean: false,
      topicContextMatched: false,
      kind: null,
      label: '',
      matchedAnchors: Object.freeze([]),
      matchedIntents: Object.freeze([]),
    });
  }

  const matchedIntents = metadata.intents.filter((intent) => query.intents.includes(intent));
  const entityContextClean =
    entityMatched &&
    query.intents.every((intent) => metadata.intents.includes(intent)) &&
    stripMatchedEvidence(query.compact, matchedTerms, query.intents).length === 0;

  // Topic words such as “清洁” or “过敏” are useful only after the product,
  // campaign, or combined business entity is identified, or when the query also
  // carries separate category text plus a matching business intent. The latter
  // is only a signal for the lexical ranker; topic words never score by themselves.
  if (!entityMatched) {
    const contextRemainder = stripMatchedEvidence(query.compact, matchedTerms, matchedIntents);
    const categoryContexts = entityCategoryContexts(metadata);
    return Object.freeze({
      score: 0,
      entityMatched: false,
      entityScopeMatched: false,
      entityContextClean: false,
      topicContextMatched:
        topicMatched && matchedIntents.length > 0 && categoryContexts.has(contextRemainder),
      kind: null,
      label: '',
      matchedAnchors: Object.freeze(matchedAnchors),
      matchedIntents: Object.freeze([...matchedIntents]),
    });
  }

  // This is an independently chosen Demo heuristic, not a migrated production
  // weight. An entity anchor is mandatory, so generic phrases cannot manufacture
  // a hit on their own.
  const score = Math.min(
    76,
    24 + Math.min(matchedAnchors.length, 2) * 10 + Math.min(matchedIntents.length, 2) * 7 + (aliasMatched ? 4 : 0),
  );
  const anchorLabel = matchedAnchors.slice(0, 2).join(' / ');
  const intentLabel = matchedIntents[0] ? SEARCH_INTENT_LABELS[matchedIntents[0]] : '';

  return Object.freeze({
    score,
    entityMatched: true,
    entityScopeMatched,
    entityContextClean,
    topicContextMatched: false,
    kind: aliasMatched ? 'alias' : 'semantic',
    label: aliasMatched
      ? `同义表达 · ${anchorLabel}`
      : intentLabel
        ? `${anchorLabel} · ${intentLabel}`
        : `主题命中 · ${anchorLabel}`,
    matchedAnchors: Object.freeze(matchedAnchors),
    matchedIntents: Object.freeze([...matchedIntents]),
  });
}
