import { describe, expect, it } from 'vitest';
import {
  HTTP_JSON_BODY_MAX_BYTES,
  REDACTION_POLICY_VERSION,
  redactQueryText,
  unicodeCodePointLength,
  validateSearchTextBoundary,
} from '../src/request-boundary.js';

describe('DEV-M1 request and redaction boundary', () => {
  it('counts Unicode code points instead of UTF-16 code units at 499/500/501', () => {
    const emoji = '🦊';
    expect(emoji.length).toBe(2);
    expect(unicodeCodePointLength(emoji.repeat(500))).toBe(500);
    expect(validateSearchTextBoundary(emoji.repeat(499))).toEqual({ ok: true, codePoints: 499 });
    expect(validateSearchTextBoundary(emoji.repeat(500))).toEqual({ ok: true, codePoints: 500 });
    expect(validateSearchTextBoundary(emoji.repeat(501))).toEqual({ ok: false, codePoints: 501 });
    expect(validateSearchTextBoundary('')).toEqual({ ok: false, codePoints: 0 });
  });

  it('normalizes full-width digits before redacting frozen phone and identity shapes', () => {
    const input = '手机１３８００１３８０００，证件11010519491231002X，旧证件130503670401001。';
    const result = redactQueryText(input);

    expect(result).toEqual({
      text: '手机[REDACTED],证件[REDACTED],旧证件[REDACTED]。',
      policyVersion: REDACTION_POLICY_VERSION,
    });
    expect(input).toContain('１３８００１３８０００');
  });

  it('does not partially redact longer digit runs or ordinary short numbers', () => {
    expect(redactQueryText('批次123456789012，编号1234567890').text)
      .toBe('批次123456789012,编号1234567890');
  });

  it('redacts common mainland phone formatting without swallowing adjacent text', () => {
    expect(redactQueryText('电话+86 138-0013-8000，备用138 0013 8000。').text)
      .toBe('电话[REDACTED],备用[REDACTED]。');
  });

  it('keeps the frozen pre-decode JSON byte limit explicit', () => {
    expect(HTTP_JSON_BODY_MAX_BYTES).toBe(32_768);
  });
});
