import { describe, expect, it } from 'vitest';
import {
  formatRunningIdentity,
  runningPointFromProfile,
  runningPointFromResolvedSession,
} from '../../src/shared/running-identity';

describe('running identity', () => {
  it('names the product version, the build commit, and where the app points', () => {
    expect(formatRunningIdentity({
      productVersion: '0.3.26',
      gitSha: 'cd3879aa99e129c1affb0f673e7bc12ed1443172',
      point: 'hangzhou',
    })).toBe('0.3.26 · cd3879a · 杭州');
    expect(runningPointFromProfile('product-remote', 'https://agent-auth.jianghua.site')).toBe('hangzhou');
    expect(runningPointFromProfile('synthetic-local', 'http://127.0.0.1:43100')).toBe('local');
    expect(runningPointFromProfile('synthetic-offline', undefined)).toBe('offline');
    expect(runningPointFromResolvedSession(
      { apiOrigin: 'https://agent-auth.jianghua.site' },
      false,
    )).toBe('hangzhou');
    expect(runningPointFromResolvedSession(undefined, true)).toBe('offline');
    expect(runningPointFromResolvedSession(undefined, false)).toBe('unknown');
  });
});
