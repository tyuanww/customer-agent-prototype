import { describe, expect, it } from 'vitest';
import {
  MAX_COPY_CHARS,
  resolveClipboardWrite,
} from '../../src/shared/clipboard-write';

describe('resolveClipboardWrite', () => {
  it('keeps trailing spaces and newlines on the original payload', () => {
    const text = '合成话术原文  \n\n';
    const resolved = resolveClipboardWrite(text);
    expect(resolved).toEqual({ ok: true, payload: text });
    if (!resolved.ok) {
      return;
    }
    expect(resolved.payload).toBe(text);
    expect(resolved.payload.endsWith('  \n\n')).toBe(true);
    expect(resolved.payload).not.toBe(text.trimEnd());
  });

  it('rejects blank text using trim only for the empty check', () => {
    expect(resolveClipboardWrite('   \n')).toEqual({
      ok: false,
      message: '没有可复制的话术内容',
    });
  });

  it('uses the original length for the upper bound', () => {
    const tooLong = `${'a'.repeat(MAX_COPY_CHARS)} `;
    expect(resolveClipboardWrite(tooLong).ok).toBe(false);
    const exact = 'b'.repeat(MAX_COPY_CHARS);
    expect(resolveClipboardWrite(exact)).toEqual({ ok: true, payload: exact });
  });
});
