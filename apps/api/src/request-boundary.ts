export const HTTP_JSON_BODY_MAX_BYTES = 32 * 1024;
export const SEARCH_QUERY_MAX_CODEPOINTS = 500;
export const REDACTION_POLICY_VERSION = 'phase1-redaction-v1';

const PHASE1_PII_PATTERN = /(?<![0-9])(?:[0-9]{17}[0-9Xx]|[0-9]{15}|(?:\+?86[\s-]?)?1[3-9][0-9](?:[\s-]?[0-9]){8})(?![0-9Xx])/g;

export type SearchTextBoundaryResult =
  | Readonly<{ ok: true; codePoints: number }>
  | Readonly<{ ok: false; codePoints: number }>;

export type RedactedQueryText = Readonly<{
  text: string;
  policyVersion: typeof REDACTION_POLICY_VERSION;
}>;

export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function validateSearchTextBoundary(value: string): SearchTextBoundaryResult {
  const codePoints = unicodeCodePointLength(value);
  return Object.freeze({
    ok: codePoints >= 1 && codePoints <= SEARCH_QUERY_MAX_CODEPOINTS,
    codePoints,
  });
}

/**
 * Phase 1 redaction is intentionally small and deterministic. NFKC happens
 * before matching so full-width digits cannot bypass the frozen phone/ID rules.
 * Callers must enforce the 1..500 code-point boundary before invoking this port.
 */
export function redactQueryText(value: string): RedactedQueryText {
  return Object.freeze({
    text: value.normalize('NFKC').replace(PHASE1_PII_PATTERN, '[REDACTED]'),
    policyVersion: REDACTION_POLICY_VERSION,
  });
}
