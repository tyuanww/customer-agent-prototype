// @vitest-environment node
/**
 * Real-stack proof that copy of a superseded release is STALE at ProductSearch.copy.
 * Skipped in ordinary `pnpm test`. `anomaly-check.ts` sets CUSTOMER_AGENT_STACK_ANOMALY=1.
 */
import { expect, it } from 'vitest';
import { connectDesktopAdapter } from './stack-desktop-adapter';

const enabled = process.env.CUSTOMER_AGENT_STACK_ANOMALY === '1';

it.skipIf(!enabled)('refuses copy of a rolled-back release through the desktop adapter', async () => {
  const { readProfile } = await import(
    new URL('../../../../scripts/synthetic-stack/profile.ts', import.meta.url).href
  ) as { readProfile: () => { apiOrigin: string; clientId: string } | undefined };
  const { loginAs, seedContent } = await import(
    new URL('../../../../scripts/synthetic-stack/seed.ts', import.meta.url).href
  ) as {
    loginAs: (apiOrigin: string, bindingId: string) => Promise<string>;
    seedContent: (apiOrigin: string, options?: { log?: (message: string) => void }) => Promise<unknown>;
  };
  const profile = readProfile();
  if (!profile) throw new Error('no running stack; start it before CUSTOMER_AGENT_STACK_ANOMALY=1');
  const desktop = await connectDesktopAdapter(profile.apiOrigin, 'synthetic_agent', profile.clientId);
  try {
    const firstSearch = await desktop.search.search(1, {
      sessionEpoch: desktop.epoch(), generation: 1, queryText: '什么时候发货', platform: 'qianniu',
      platformSource: 'manual', productContextType: null, productContextRef: null, productUnscoped: false, parentQueryId: null,
    });
    expect(firstSearch).toMatchObject({ ok: true, hitStatus: 'hit' });
    if (!firstSearch.ok || !firstSearch.candidates[0]) throw new Error('expected a hit');
    const candidate = firstSearch.candidates[0];
    const placeholders: Partial<Record<'order_id' | 'date', string>> = {};
    for (const key of candidate.placeholder_keys) {
      placeholders[key] = key === 'order_id' ? 'SYNTHETIC-001' : '2026-09-10';
    }
    const firstCopy = {
      sessionEpoch: desktop.epoch(), generation: 1, queryId: firstSearch.queryId, rank: candidate.rank,
      scriptId: candidate.script_id, scriptVersion: candidate.script_version,
      contentHash: candidate.content_hash, placeholderValues: placeholders,
    };
    expect(await desktop.search.copy(1, firstCopy)).toMatchObject({ ok: true, copied: true });
    const owner = await loginAs(profile.apiOrigin, 'synthetic_owner');
    await seedContent(profile.apiOrigin, { log: () => undefined });
    const rollback = await fetch(`${profile.apiOrigin}/v1/content/rollback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': `anomaly-rb-${String(Date.now())}`, 'content-type': 'application/json' },
      body: JSON.stringify({ target_release_id: firstSearch.releaseId, title: 'anomaly rollback', summary: 'synthetic anomaly rollback' }),
    });
    expect(rollback.status).toBe(200);
    const rolled = await rollback.json() as { release_id: string };
    expect(rolled.release_id).not.toBe(firstSearch.releaseId);
    const refreshed = await desktop.announce.refresh({ sessionEpoch: desktop.epoch(), generation: 2 });
    expect(refreshed).toMatchObject({ ok: true, releaseId: rolled.release_id });
    expect(await desktop.search.copy(1, firstCopy)).toMatchObject({ code: 'STALE' });
    expect(desktop.clipboard).toHaveLength(1);
    const current = await desktop.search.search(1, {
      sessionEpoch: desktop.epoch(), generation: 3, queryText: '什么时候发货', platform: 'qianniu',
      platformSource: 'manual', productContextType: null, productContextRef: null, productUnscoped: false, parentQueryId: null,
    });
    expect(current).toMatchObject({ ok: true, hitStatus: 'hit', releaseId: rolled.release_id });
  } finally {
    await desktop.session.logout();
  }
}, 180_000);
