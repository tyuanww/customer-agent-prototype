// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeQuality } from '../../src/main/content-intake-quality';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
const context = input ? JSON.parse(input) as { origin: string; token: string; expiresAt: string; qualityKey: components['schemas']['IntakeCandidateKey'] } : null;

it.skipIf(!context)('reviews actual PG samples through ProductSession and recovers a lost committed response', async () => {
  const { origin, token, expiresAt, qualityKey } = context!;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  let dropped = false, writes = 0;
  const session = new ProductSession(new ProductHttp(origin, async (url, options) => {
    const response = await fetch(url, options);
    if (options?.method === 'POST') writes++;
    if (!dropped && String(url).endsWith('/quality/freeze') && response.ok) {
      dropped = true; await response.arrayBuffer(); throw new TypeError('SYNTHETIC_LOST_RESPONSE');
    }
    return response;
  }), { read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined },
  { open: async () => { throw new Error('LOGIN_NOT_ALLOWED_IN_PROBE'); } });
  let main: ContentIntakeQuality | undefined;
  try {
    expect(await session.restore()).toMatchObject({ signedIn: true });
    main = new ContentIntakeQuality(session); main.select(qualityKey);
    expect((await main.refresh('initial')).status.state).toBe('not_frozen');
    await expect(main.freeze()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const original = main.unresolved()!;
    expect(await main.recover()).toMatchObject({ operationId: original.operationId, state: 'initial_required' });
    expect(writes).toBe(1); expect(main.current()).toBeNull();
    const view = await main.refresh('initial');
    expect(view.samples).toHaveLength(3);
    expect(view.samples.some(s => s.entry.answerText === '第一行。\n第二行。')).toBe(true);
    expect(view.samples.some(s => s.entry.internalNote === '合成内部说明')).toBe(true);
    await expect(main.submit()).rejects.toMatchObject({ code: 'VALIDATION' });
    for (const sample of view.samples) main.setCheck(sample.scriptId, false, '合成人工检查');
    expect(await main.submit()).toMatchObject({ state: 'passed', phase: 'initial', key: qualityKey });
    expect(writes).toBe(2); expect(main.current()).toBeNull();
    expect((await main.refresh('initial')).status.state).toBe('passed');
    console.log('INTAKE_QUALITY_HTTP_PASS');
  } finally { main?.dispose(); await session.shutdown(); }
}, 35_000);
