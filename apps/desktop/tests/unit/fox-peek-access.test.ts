import { describe, expect, it } from 'vitest';
import {
  canRequestFoxPeek,
  isFoxPeekEpoch,
  isFoxPeekIntent,
} from '../../src/shared/overlay-events';

describe('fox peek IPC access', () => {
  it('accepts only the typed enum from a trusted fox renderer', () => {
    expect(isFoxPeekIntent('peek')).toBe(true);
    expect(isFoxPeekIntent('retract')).toBe(true);
    expect(isFoxPeekIntent('show')).toBe(false);
    expect(canRequestFoxPeek(true, 'fox', 'peek')).toBe(true);
    expect(canRequestFoxPeek(true, 'fox', 'retract')).toBe(true);
    expect(isFoxPeekEpoch(0)).toBe(true);
    expect(isFoxPeekEpoch(42)).toBe(true);
  });

  it('rejects query renderers, untrusted senders, and arbitrary payloads', () => {
    expect(canRequestFoxPeek(true, 'query', 'peek')).toBe(false);
    expect(canRequestFoxPeek(false, 'fox', 'peek')).toBe(false);
    expect(canRequestFoxPeek(true, 'fox', { intent: 'peek' })).toBe(false);
    expect(isFoxPeekEpoch(-1)).toBe(false);
    expect(isFoxPeekEpoch(1.5)).toBe(false);
    expect(isFoxPeekEpoch('1')).toBe(false);
  });
});
