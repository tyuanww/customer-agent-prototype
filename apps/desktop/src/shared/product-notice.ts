import type { components } from '@customer-agent/contracts';
import { exactKeys, PRODUCT_ERRORS, productFailure, type ProductFailure } from './product-session';

export type ProductNotice = components['schemas']['PrivacyNotice'];
export type NoticeDecision = components['schemas']['NoticeDecision'];

export type ProductNoticeResult =
  | ({ ok: true; sessionEpoch: number } & components['schemas']['CurrentNoticeResponse'])
  | ProductFailure;

export type ProductNoticeDecisionResult =
  | ({ ok: true; sessionEpoch: number } & components['schemas']['NoticeDecisionResponse'])
  | ProductFailure;

export type ProductNoticeDecisionRequest = Readonly<{
  version: string;
  decision: NoticeDecision;
}>;

export function isNoticeDecision(value: unknown): value is NoticeDecision {
  return value === 'accepted' || value === 'declined';
}

export function isProductNoticeDecisionRequest(value: unknown): value is ProductNoticeDecisionRequest {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && exactKeys(value, ['version', 'decision'])
    && typeof (value as ProductNoticeDecisionRequest).version === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test((value as ProductNoticeDecisionRequest).version)
    && isNoticeDecision((value as ProductNoticeDecisionRequest).decision);
}

export function noticeFailure(code: ProductFailure['code'], sessionEpoch = 0): ProductFailure {
  return productFailure(code, sessionEpoch);
}

export function isProductNoticeResult(value: unknown): value is ProductNoticeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return exactKeys(record, ['ok', 'code', 'sessionEpoch', 'message'])
      && Number.isSafeInteger(record.sessionEpoch) && (record.sessionEpoch as number) >= 0
      && typeof record.code === 'string' && Object.hasOwn(PRODUCT_ERRORS, record.code)
      && record.message === PRODUCT_ERRORS[record.code as keyof typeof PRODUCT_ERRORS];
  }
  if (!exactKeys(record, ['ok', 'sessionEpoch', 'notice', 'decision', 'decided_at'])
    || record.ok !== true || !Number.isSafeInteger(record.sessionEpoch)
    || (record.sessionEpoch as number) < 0 || !record.notice || typeof record.notice !== 'object'
    || Array.isArray(record.notice)) return false;
  const notice = record.notice as Record<string, unknown>;
  return exactKeys(notice, ['version', 'content', 'content_hash', 'published_at'])
    && typeof notice.version === 'string' && notice.version.length >= 1 && notice.version.length <= 128
    && typeof notice.content === 'string' && notice.content.length >= 1 && notice.content.length <= 10_000
    && typeof notice.content_hash === 'string' && /^[a-f0-9]{64}$/.test(notice.content_hash)
    && typeof notice.published_at === 'string' && Number.isFinite(Date.parse(notice.published_at))
    && (record.decision === null || isNoticeDecision(record.decision))
    && (record.decided_at === null || (typeof record.decided_at === 'string' && Number.isFinite(Date.parse(record.decided_at))));
}

export function isProductNoticeDecisionResult(value: unknown): value is ProductNoticeDecisionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return exactKeys(record, ['ok', 'code', 'sessionEpoch', 'message'])
      && Number.isSafeInteger(record.sessionEpoch) && (record.sessionEpoch as number) >= 0
      && typeof record.code === 'string' && Object.hasOwn(PRODUCT_ERRORS, record.code)
      && record.message === PRODUCT_ERRORS[record.code as keyof typeof PRODUCT_ERRORS];
  }
  return exactKeys(record, ['ok', 'sessionEpoch', 'version', 'decision', 'decided_at'])
    && record.ok === true && Number.isSafeInteger(record.sessionEpoch)
    && (record.sessionEpoch as number) >= 0
    && typeof record.version === 'string' && record.version.length >= 1 && record.version.length <= 128
    && isNoticeDecision(record.decision)
    && typeof record.decided_at === 'string' && Number.isFinite(Date.parse(record.decided_at));
}
