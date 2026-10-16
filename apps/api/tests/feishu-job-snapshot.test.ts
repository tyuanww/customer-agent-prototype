import { describe, expect, it } from 'vitest';
import { bindSessionSubject, forgetJobSnapshot, jobForToken, readFeishuJobSnapshot, rememberJobSnapshot, subjectHash } from '../src/feishu-job-snapshot.js';

const openId = 'ou_abcdef';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('feishu job snapshot', () => {
  it('keeps a resolved title only after the directory is read', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('tenant_access_token')) return json({ code: 0, tenant_access_token: 'tenant-token' });
      if (url.includes('/users/')) return json({ code: 0, data: { user: { job_title: '客服总监' } } });
      return json({ code: 0, data: { items: [{ name: '客服总监', status: true }, { name: '停用', status: false }], has_more: false } });
    }) as typeof fetch;
    const snapshot = await readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, fetchImpl);
    expect(snapshot).toEqual({
      title: '客服总监',
      directory: [{ name: '客服总监', enabled: true }, { name: '停用', enabled: false }],
    });
  });

  it('returns null when the tenant token is refused', async () => {
    const fetchImpl = (async () => json({ code: 999 }, 200)) as typeof fetch;
    await expect(readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, fetchImpl)).resolves.toBeNull();
  });

  it('returns null when another page of job titles is still unread', async () => {
    let jobs = 0;
    const fetchImpl = (async (url: string) => {
      if (url.includes('tenant_access_token')) return json({ code: 0, tenant_access_token: 'tenant-token' });
      if (url.includes('/users/')) return json({ code: 0, data: { user: { job_title: '客服总监' } } });
      jobs += 1;
      return json({ code: 0, data: { items: [{ name: '客服总监', status: true }], has_more: true, page_token: `page-${jobs}` } });
    }) as typeof fetch;
    await expect(readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, fetchImpl)).resolves.toBeNull();
  });

  it('keeps a later duplicate so the desktop can refuse it', async () => {
    let jobs = 0;
    const fetchImpl = (async (url: string) => {
      if (url.includes('tenant_access_token')) return json({ code: 0, tenant_access_token: 'tenant-token' });
      if (url.includes('/users/')) return json({ code: 0, data: { user: { job_title: '客服总监' } } });
      jobs += 1;
      if (jobs === 1) {
        return json({ code: 0, data: { items: [{ name: '客服总监', status: true }], has_more: true, page_token: 'next' } });
      }
      return json({ code: 0, data: { items: [{ name: '客服总监', status: true }], has_more: false } });
    }) as typeof fetch;
    const snapshot = await readFeishuJobSnapshot(openId, { clientId: 'cli_abc', clientSecret: 'secret' }, fetchImpl);
    expect(snapshot?.directory).toEqual([
      { name: '客服总监', enabled: true },
      { name: '客服总监', enabled: true },
    ]);
  });

  it('finds the snapshot for the session that hashed the same open id', () => {
    rememberJobSnapshot(openId, { title: '客服经理', directory: [{ name: '客服经理', enabled: true }] });
    const token = 'a'.repeat(43);
    bindSessionSubject(token, subjectHash(openId));
    expect(jobForToken(token)?.title).toBe('客服经理');
    expect(jobForToken('b'.repeat(43))).toBeNull();
    forgetJobSnapshot(openId);
    expect(jobForToken(token)).toBeNull();
  });
});
