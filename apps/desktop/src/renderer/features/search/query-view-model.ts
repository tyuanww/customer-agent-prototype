import {
  LIBRARY_DOMAIN_LABELS,
  LIBRARY_DOMAINS,
  isLibraryDomain,
  type LibraryDomain,
} from '@shared/library-delta';
import type { ProductCandidate } from '@shared/product-search';
import { PRODUCT_ERRORS } from '@shared/product-session';
import type { RankedScript, ScriptDomain } from './types';

const PRODUCT_DOMAIN_LABEL = {
  product: '产品',
  campaign: '活动',
  presale: '售前',
  aftersale: '售后',
} as const satisfies Record<string, ScriptDomain>;

export const ANNOUNCE_EXPIRED_MESSAGE = '当前版本已失效，请重新核验';
export const COPY_UNRECORDED_MESSAGE = '已复制；事件未记录，请勿重复复制';

const PRODUCT_MATCH_LABEL = '后端候选';
const PRODUCT_MATCH_LABEL_UNRECORDED = '后端候选 · 不记录事件';

export type ProductSearchTelemetry = 'recorded' | 'collection_disabled';

/** 多域固定顺序 产品→活动→售前→售后，一句指名更新了哪几库。 */
export function contentUpdatedBannerCopy(domains: readonly LibraryDomain[]): string {
  const ordered = LIBRARY_DOMAINS.filter((domain) => domains.includes(domain));
  return `${ordered.map((domain) => `${LIBRARY_DOMAIN_LABELS[domain]}话术`).join('、')}已更新`;
}

export function platformLabel(scope: readonly string[]): string {
  const hasQianniu = scope.includes('qianniu');
  const hasDouyin = scope.includes('douyin');
  if (hasQianniu && hasDouyin) {
    return '千牛 / 抖音';
  }
  if (hasDouyin) {
    return '抖音';
  }
  return '千牛';
}

export function rankedScriptsFromProductCandidates(input: {
  candidates: readonly ProductCandidate[];
  telemetryStatus: ProductSearchTelemetry;
  sessionEpoch: number;
  generation: number;
  queryId: string;
}): RankedScript[] {
  const matchLabel = input.telemetryStatus === 'collection_disabled'
    ? PRODUCT_MATCH_LABEL_UNRECORDED
    : PRODUCT_MATCH_LABEL;
  return input.candidates.map((candidate) => ({
    scriptId: candidate.script_id,
    domain: isLibraryDomain(candidate.category) ? PRODUCT_DOMAIN_LABEL[candidate.category] : '产品',
    questionVariants: [],
    answerText: candidate.answer_text,
    platform: platformLabel(candidate.platform_scope),
    scopeLabel: candidate.title,
    riskLevel: candidate.risk_level,
    effectiveFrom: candidate.effective_from,
    effectiveTo: candidate.effective_to ?? '',
    rank: candidate.rank as 1 | 2 | 3,
    score: 0,
    matchKind: 'exact',
    matchLabel,
    productCopy: {
      sessionEpoch: input.sessionEpoch,
      generation: input.generation,
      queryId: input.queryId,
      rank: candidate.rank,
      scriptId: candidate.script_id,
      scriptVersion: candidate.script_version,
      contentHash: candidate.content_hash,
    },
    placeholderKeys: candidate.placeholder_keys,
  }));
}

export function adoptedPlaceholderValues(
  keys: readonly ('order_id' | 'date')[] | undefined,
  values: Partial<Record<'order_id' | 'date', string>>,
): Partial<Record<'order_id' | 'date', string>> {
  return Object.fromEntries(
    (keys ?? []).filter((key) => values[key]).map((key) => [key, values[key]!]),
  );
}

/** Copy succeeded. An unrecorded event is still a copy, not a send. */
export function copySuccessErrorMessage(result: object): string {
  if ('eventStatus' in result && result.eventStatus === 'unrecorded') {
    return COPY_UNRECORDED_MESSAGE;
  }
  return '';
}

export type AnnounceInvalidationEffect = {
  announceInvalid: boolean;
  /** null leaves the current error text alone. */
  errorMessage: string | null;
  /** null leaves the current phase alone. */
  phase: 'SEARCH_INPUT' | 'ERROR' | null;
};

/**
 * Visible outcome after an announce invalidation has already cancelled the
 * in-flight search. `showingQueryContent` is the pre-cancel snapshot;
 * `searchInFlight` is the flag after that cancel.
 */
export function announceInvalidationEffect(input: {
  reason: string;
  sessionBusy: boolean;
  searchInFlight: boolean;
  showingQueryContent: boolean;
}): AnnounceInvalidationEffect {
  if (input.reason === 'signed_out' || input.reason === 'replaced' || input.sessionBusy) {
    return { announceInvalid: false, errorMessage: '', phase: 'SEARCH_INPUT' };
  }
  if (input.reason === 'source_gate' || input.reason === 'unavailable') {
    if (input.searchInFlight || input.showingQueryContent) {
      return {
        announceInvalid: false,
        errorMessage: input.reason === 'source_gate'
          ? PRODUCT_ERRORS.SOURCE_GATE_NOT_READY
          : PRODUCT_ERRORS.UNAVAILABLE,
        phase: 'ERROR',
      };
    }
    return { announceInvalid: false, errorMessage: '', phase: 'SEARCH_INPUT' };
  }
  if (input.reason !== 'expired') {
    if (!input.searchInFlight) {
      return { announceInvalid: false, errorMessage: '', phase: 'SEARCH_INPUT' };
    }
    return { announceInvalid: false, errorMessage: null, phase: null };
  }
  if (!input.showingQueryContent) {
    return { announceInvalid: true, errorMessage: '', phase: 'SEARCH_INPUT' };
  }
  return {
    announceInvalid: false,
    errorMessage: ANNOUNCE_EXPIRED_MESSAGE,
    phase: 'ERROR',
  };
}
