import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { ProductHttpResult } from '../product-http';
import { ProductHttpError } from '../product-http';
import type { ProductSession } from '../product-session';

export const SOP_UNAVAILABLE_REASONS = [
  'SOP_UNAVAILABLE',
  'SOP_SEVERITY_ORDER_REQUIRED',
  'SOP_GATE_B_UNRESOLVED',
  'SOP_FLOW_CONTRACT_UNAVAILABLE',
] as const;

export type SopUnavailableReason = (typeof SOP_UNAVAILABLE_REASONS)[number];
export type OrdinarySearchResponse = components['schemas']['SearchResponse'];

export type DesktopQueryTransportResult =
  | Readonly<{
      kind: 'ordinary';
      response: OrdinarySearchResponse;
      retryAfterSeconds: number | null;
    }>
  | Readonly<{
      kind: 'sop-unavailable';
      reason: SopUnavailableReason;
      retryAfterSeconds: number | null;
    }>
  | Readonly<{
      kind: 'error';
      code: 'UNAVAILABLE';
      retryAfterSeconds: number | null;
    }>;

export type SearchTransportInput = Readonly<{
  status: number;
  body: unknown;
  retryAfter?: string | null;
}>;

function retryAfterSeconds(value: string | null | undefined): number | null {
  if (value === undefined || value === null || !/^\d{1,4}$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function isSopReason(value: unknown): value is SopUnavailableReason {
  return typeof value === 'string'
    && (SOP_UNAVAILABLE_REASONS as readonly string[]).includes(value);
}

/** Parse the real HTTP boundary before any ordinary-candidate mapping occurs. */
export function parseSearchTransport(input: SearchTransportInput): DesktopQueryTransportResult {
  const retryAfter = retryAfterSeconds(input.retryAfter);
  if (input.status === 200) {
    try {
      return { kind: 'ordinary', response: parseContractSchema('SearchResponse', input.body), retryAfterSeconds: retryAfter };
    } catch {
      return { kind: 'error', code: 'UNAVAILABLE', retryAfterSeconds: retryAfter };
    }
  }
  if (input.status !== 503) return { kind: 'error', code: 'UNAVAILABLE', retryAfterSeconds: retryAfter };
  try {
    const envelope = parseContractSchema('OverloadedErrorEnvelope', input.body);
    const details = envelope.error.details;
    if (details?.reason !== 'SOURCE_GATE_NOT_READY' || !isSopReason(details.sop_reason)) {
      return { kind: 'error', code: 'UNAVAILABLE', retryAfterSeconds: retryAfter };
    }
    const bodyRetryAfter = typeof details.retry_after_sec === 'number'
      && Number.isSafeInteger(details.retry_after_sec)
      && details.retry_after_sec >= 0
      ? details.retry_after_sec
      : retryAfter;
    return { kind: 'sop-unavailable', reason: details.sop_reason, retryAfterSeconds: bodyRetryAfter };
  } catch {
    return { kind: 'error', code: 'UNAVAILABLE', retryAfterSeconds: retryAfter };
  }
}

type QuerySessionAdapter = Pick<ProductSession, 'view' | 'subscribe' | 'status' | 'currentNotice' | 'request'>;

/**
 * Keeps ProductSession as the credential owner while giving ProductSearch a
 * typed query boundary. The search domain still owns ranking, provenance, and
 * copy; this adapter only validates transport and preserves fail-closed SOP.
 */
export function createQuerySessionAdapter(session: ProductSession): ProductSession {
  const adapter: QuerySessionAdapter = {
    view: () => session.view(),
    subscribe: (listener) => session.subscribe(listener),
    status: () => session.status(),
    currentNotice: () => session.currentNotice(),
    async request(epoch, path, options) {
      try {
        const result = await session.request(epoch, path, options);
        if (path !== '/v1/search') return result;
        const parsed = parseSearchTransport({ status: result.status, body: result.value });
        if (parsed.kind === 'ordinary') return { ...result, value: parsed.response };
        if (parsed.kind === 'sop-unavailable') {
          throw new ProductHttpError('SOURCE_GATE_NOT_READY', parsed.reason);
        }
        throw new ProductHttpError('UNAVAILABLE');
      } catch (error) {
        if (error instanceof ProductHttpError && error.code === 'SOURCE_GATE_NOT_READY'
          && error.reason !== undefined && !isSopReason(error.reason)) {
          throw new ProductHttpError('UNAVAILABLE');
        }
        throw error;
      }
    },
  };
  return adapter as ProductSession;
}

export function parseProductHttpSearchResult(
  result: ProductHttpResult,
  retryAfter?: string | null,
): DesktopQueryTransportResult {
  return parseSearchTransport({ status: result.status, body: result.value, retryAfter });
}
