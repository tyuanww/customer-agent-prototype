// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ContentIntakeUsage } from '../../src/main/content-intake-usage';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

// The real session is exercised without reading the developer's employee-name
// mapping or credential store. The API fixture owns all identities and tokens.
vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;

it.skipIf(!input)('consumes published PG material through actual ProductHttp and ProductSession', async () => {
  const { origin, token, expiresAt, releaseId } = JSON.parse(input!) as Record<string, string>;
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
    main.select({ shopId: 'shop-a', productIds: [], scenarioIds: [] });
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
    const logout = await session.logout(); expect(logout.ok && !logout.signedIn).toBe(true);
    console.log('INTAKE_USAGE_HTTP_PASS');
  } finally { main?.dispose(); await session.shutdown(); }
}, 35_000);
