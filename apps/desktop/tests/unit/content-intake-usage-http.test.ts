// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { loadIntakeAccess } from '../../src/main/content-intake-access';
import { ContentIntakeUsage } from '../../src/main/content-intake-usage';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

// The real session is exercised without reading the developer's employee-name
// mapping or credential store. The API fixture owns all identities and tokens.
vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
const context = input ? JSON.parse(input) as { origin: string; token: string; expiresAt: string; releaseId: string; discoverySources?: number } : null;

it.skipIf(!context || context.discoverySources !== undefined)('consumes published PG material through actual ProductHttp and ProductSession', async () => {
  const { origin, token, expiresAt, releaseId } = context!;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  const session = new ProductSession(new ProductHttp(origin), {
    read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined,
  }, { open: async () => { throw new Error('LOGIN_WINDOW_NOT_ALLOWED_IN_PROBE'); } });
  const control = async (action: string) => {
    const response = await fetch(`${origin}/__synthetic__/${action}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('SYNTHETIC_CONTROL_FAILED');
    return response.json() as Promise<{ waiting?: boolean }>;
  };
  const copied: string[] = [];
  let main: ContentIntakeUsage | undefined;
  try {
    expect(await session.restore()).toMatchObject({ ok: true, signedIn: true });
    main = new ContentIntakeUsage(session, text => copied.push(text));
    const access = await loadIntakeAccess(session);
    expect(access.shops).toEqual(['shop-a']); expect(access.sources.map(s => s.scope.sourceId)).toEqual(['source-a']);
    expect(access.capabilities[0].actions).toEqual(['query']);
    main.select({ shopId: access.shops[0], productIds: [], scenarioIds: [] });
    await control('hold-next');
    const pending = main.refresh();
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'STALE' });
    await vi.waitFor(async () => expect((await control('gate')).waiting).toBe(true), { timeout: 5000, interval: 20 });
    main.select({ shopId: 'shop-a', productIds: [], scenarioIds: [] });
    await cancelled;
    expect(main.current()).toBeNull();
    await control('release-gate');

    const first = await main.refresh(), projection = first.read()!;
    expect(projection.releaseId).toBe(releaseId);
    expect(projection.faq).toHaveLength(101);
    expect(projection.faq[0].entry.answerText).toBe('第一行。\n第二行。');
    expect(projection.faq[100].entry.answerText).toBe('合成答复'.repeat(1000));
    expect('internalNote' in projection.faq[0].entry).toBe(false);
    expect('entitlementId' in projection).toBe(false);
    first.copy(projection.faq[0].key); expect(copied).toEqual(['第一行。\n第二行。']);
    await control('expire-next');
    await expect(main.refresh()).rejects.toMatchObject({ code: 'EXPIRED' });
    expect(main.current()).toBe(first); first.copy(projection.faq[0].key); expect(copied).toHaveLength(2);
    await control('next-release');
    const empty = await main.refresh(); expect(empty.read()!.faq).toEqual([]); expect(first.read()!.faq).toHaveLength(101);
    await control('revoke');
    await expect(main.refresh()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(first.read()).toBeNull(); expect(empty.read()).toBeNull();
    expect(() => first.copy(projection.faq[0].key)).toThrow('STALE'); expect(copied).toHaveLength(2);
    expect((await loadIntakeAccess(session)).shops).toEqual([]);
    const logout = await session.logout(); expect(logout.ok && !logout.signedIn).toBe(true);
    console.log('INTAKE_USAGE_HTTP_PASS');
  } finally { main?.dispose(); await session.shutdown(); }
}, 35_000);

it.skipIf(context?.discoverySources !== 5000)('discovers 5000 independently granted sources through the actual Main HTTP consumer', async () => {
  const { origin, token, expiresAt } = context!;
  const session = new ProductSession(new ProductHttp(origin), {
    read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined,
  }, { open: async () => { throw new Error('LOGIN_WINDOW_NOT_ALLOWED_IN_PROBE'); } });
  try {
    expect(await session.restore()).toMatchObject({ ok: true, signedIn: true });
    const access = await loadIntakeAccess(session);
    expect(access.shops).toEqual(['shop-a']);
    expect(access.sources).toHaveLength(5000); expect(access.capabilities).toHaveLength(5000);
    expect(new Set(access.sources.map(s => s.scope.sourceId)).size).toBe(5000);
    expect(access.capabilities.every(c => c.actions.length === 1 && c.actions[0] === 'query'
      && c.mayAllocate.length === 0 && c.mayDelegate.length === 0)).toBe(true);
    expect(Date.now()).toBeLessThan(Date.parse(access.validUntil));
    console.log('INTAKE_DISCOVERY_CAPACITY_PASS');
  } finally { await session.shutdown(); }
}, 100_000);
