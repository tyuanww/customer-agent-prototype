// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ContentIntakeQuery } from '../../src/main/content-intake-query';
import { ContentIntakeUsage } from '../../src/main/content-intake-usage';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
const context = input ? JSON.parse(input) as { family?: boolean; origin: string; token: string;
  expiresAt: string; releaseId: string; cases: { shopId: string; answers: string[] }[] } : null;

it.skipIf(!context?.family)('consumes qualified family choices through HTTP, Main query and exact copy', async () => {
  const { origin, token, expiresAt, releaseId, cases } = context!;
  const session = new ProductSession(new ProductHttp(origin), {
    read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined,
  }, { open: async () => { throw new Error('LOGIN_WINDOW_NOT_ALLOWED_IN_PROBE'); } });
  const copied: string[] = [];
  const usage = new ContentIntakeUsage(session, text => copied.push(text));
  const query = new ContentIntakeQuery(session, text => copied.push(text));
  let oldKey: string | undefined;
  let oldCatalog: Awaited<ReturnType<ContentIntakeUsage['refresh']>> | undefined;
  try {
    expect(await session.restore()).toMatchObject({ ok: true, signedIn: true });
    for (const item of cases) {
      usage.select({ shopId: item.shopId, productIds: [], scenarioIds: [] });
      expect(oldCatalog?.read() ?? null).toBeNull();
      const catalog = await usage.refresh(), snapshot = catalog.read()!;
      expect(snapshot.releaseId).toBe(releaseId);
      expect(snapshot.faq.map(row => row.entry.answerText).sort()).toEqual([...item.answers].sort());
      expect(snapshot.faq.every(row => !('internalNote' in row.entry))).toBe(true);
      await query.access(item.shopId);
      if (oldKey) expect(() => query.copy(oldKey!)).toThrow('STALE');
      const results = await query.search('合成');
      expect(results.map(row => row.answerText).sort()).toEqual([...item.answers].sort());
      for (const result of results) {
        expect(result.releaseId).toBe(releaseId);
        expect(query.copy(result.key)).toEqual({ copied: true });
        expect(copied.at(-1)).toBe(result.answerText);
      }
      if (results[0]) oldKey = results[0].key;
      oldCatalog = catalog;
    }
    expect((await session.logout()).ok).toBe(true);
    expect(() => query.copy(oldKey!)).toThrow('STALE');
    console.log('INTAKE_FAMILY_HTTP_PASS');
  } finally { query.dispose(); usage.dispose(); await session.shutdown(); }
}, 35_000);
