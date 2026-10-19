import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSessionSubject, forgetJobSnapshot, jobForToken, readFeishuJobSnapshot, rememberJobSnapshot, subjectHash } from '../src/feishu-job-snapshot.js';

const openId = 'ou_abcdef';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function userFetch(title: string | null): typeof fetch {
  return (async (url: string) => {
    if (url.includes('job_titles')) throw new Error('the person read must not scan the company dictionary');
    if (url.includes('tenant_access_token')) return json({ code: 0, tenant_access_token: 'tenant-token' });
    if (url.includes('/users/')) return json({ code: 0, data: { user: title === null ? {} : { job_title: title } } });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

describe('feishu job snapshot', () => {
  afterEach(() => vi.useRealTimers());

  it('collects the person title as one enabled directory row', async () => {
    const snapshot = await readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, userFetch('AI赋能工程师'));
    expect(snapshot).toEqual({
      title: 'AI赋能工程师',
      directory: [{ name: 'AI赋能工程师', enabled: true }],
    });
  });

  it('returns null when the person has no job title', async () => {
    await expect(readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, userFetch(null))).resolves.toBeNull();
  });

  it('returns null when the tenant token is refused', async () => {
    const fetchImpl = (async () => json({ code: 999 }, 200)) as typeof fetch;
    await expect(readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, fetchImpl)).resolves.toBeNull();
  });

  it('finds the collected title for the session that hashed the same open id', () => {
    rememberJobSnapshot(openId, { title: '客服经理', directory: [{ name: '客服经理', enabled: true }] });
    const token = 'a'.repeat(43);
    bindSessionSubject(token, subjectHash(openId));
    expect(jobForToken(token)?.title).toBe('客服经理');
    expect(jobForToken('b'.repeat(43))).toBeNull();
    forgetJobSnapshot(openId);
    expect(jobForToken(token)).toBeNull();
  });

  it('expires the provider fact after the five-minute lease', () => {
    vi.useFakeTimers();
    rememberJobSnapshot(openId, { title: '客服经理', directory: [{ name: '客服经理', enabled: true }] });
    const token = 'c'.repeat(43);
    bindSessionSubject(token, subjectHash(openId));
    expect(jobForToken(token)?.title).toBe('客服经理');
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(jobForToken(token)).toBeNull();
  });
});
