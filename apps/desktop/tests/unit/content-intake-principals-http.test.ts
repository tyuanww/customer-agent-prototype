// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
const context = input ? JSON.parse(input) as { origin: string; token: string; expiresAt: string; principals: boolean } : null;

it.skipIf(!context?.principals)('consumes the real scoped directory through ProductSession and rejects cancelled or logged-out reads', async () => {
  const { origin, token, expiresAt } = context!;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  let delayDirectory = false;
  let markReceived!: () => void, releaseResponse!: () => void;
  const received = new Promise<void>(resolve => { markReceived = resolve; });
  const released = new Promise<void>(resolve => { releaseResponse = resolve; });
  const session = new ProductSession(new ProductHttp(origin, async (url, options) => {
    const response = await fetch(url, options);
    if (delayDirectory && new URL(String(url)).pathname === '/v1/intake/principals') {
      markReceived(); await released;
    }
    return response;
  }), { read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined },
  { open: async () => { throw new Error('LOGIN_NOT_ALLOWED_IN_PROBE'); } });
  try {
    expect(await session.restore()).toMatchObject({ signedIn: true });
    const epoch = session.view().sessionEpoch;
    const read = (cursor?: string, changed: Record<string, string> = {}, signal?: AbortSignal) =>
      session.request(epoch, `/v1/intake/principals?${new URLSearchParams({ sourceId: 'source-a', purpose: 'contributor', limit: '1',
        ...(cursor ? { cursor } : {}), ...changed })}`, { signal, maxResponseBytes: 262_144 });
    const first = parseContractSchema('IntakePrincipalPage', (await read()).value);
    expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
    const changedBindings: Record<string, string>[] = [{ limit: '2' }, { sourceId: 'source-b' }, { purpose: 'grant-recipient' }];
    for (const changed of changedBindings) {
      await expect(read(first.nextCursor!, changed)).rejects.toBeInstanceOf(Error);
    }
    const rows: components['schemas']['IntakePrincipalPage']['items'] = [...first.items];
    const cursors = new Set<string>();
    let cursor = first.nextCursor;
    while (cursor) {
      expect(cursors.has(cursor)).toBe(false); expect(cursors.size).toBeLessThan(100);
      cursors.add(cursor);
      const page = parseContractSchema('IntakePrincipalPage', (await read(cursor)).value);
      expect(page.items.length).toBeLessThanOrEqual(1);
      rows.push(...page.items); cursor = page.nextCursor;
    }
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map(row => row.principalId)).size).toBe(rows.length);
    expect(rows.map(row => row.principalId)).toEqual(rows.map(row => row.principalId).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    expect(rows.every(row => row.displayLabel.trim().length > 0)).toBe(true);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(read(undefined, {}, cancelled.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    delayDirectory = true;
    const late = read();
    // Attach the rejection assertion before releasing the delayed response.
    const discarded = expect(late).rejects.toMatchObject({ code: 'STALE' });
    await Promise.race([received, late]);
    expect(await session.logout()).toMatchObject({ signedIn: false });
    releaseResponse(); await discarded;
    console.log('INTAKE_PRINCIPALS_HTTP_PASS');
  } finally { releaseResponse(); await session.shutdown(); }
}, 35_000);
