// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeManagement } from '../../src/main/content-intake-management';
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
  let main: ContentIntakeManagement | undefined;
  try {
    expect(await session.restore()).toMatchObject({ signedIn: true });
    main = new ContentIntakeManagement(session);
    const menu = await main.command({ action: 'list', next: false });
    const selection = menu.candidates.find(c => c.candidate.key.candidateId === qualityKey.candidateId)!;
    await main.command({ action: 'select', selection: selection.selection });
    const material = await main.command({ action: 'material', next: false });
    expect(material.material?.entries).toHaveLength(3);
    expect((await main.command({ action: 'quality', phase: 'initial' })).quality?.status.state).toBe('not_frozen');
    await expect(main.command({ action: 'freeze' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const original = main.view().pending!;
    await main.command({ action: 'recover' });
    expect(writes).toBe(1); expect(main.view().quality).toBeNull();
    await main.command({ action: 'list', next: false });
    expect(main.view().receipt?.operationId).toBe(original.operationId);
    const view = (await main.command({ action: 'quality', phase: 'initial' })).quality!;
    expect(view.samples).toHaveLength(3);
    expect(view.samples.some(s => s.entry.answerText === '第一行。\n第二行。')).toBe(true);
    expect(view.samples.some(s => s.entry.internalNote === '合成内部说明')).toBe(true);
    await expect(main.command({ action: 'submit' })).rejects.toMatchObject({ code: 'VALIDATION' });
    for (const sample of view.samples) await main.command({ action: 'check', scriptId: sample.scriptId, defect: false, reason: '合成人工检查' });
    expect((await main.command({ action: 'submit' })).receipt).toMatchObject({ state: 'passed', phase: 'initial', key: qualityKey });
    expect(writes).toBe(2); expect(main.view().quality).toBeNull();
    expect((await main.command({ action: 'quality', phase: 'initial' })).quality?.status.state).toBe('passed');
    console.log('INTAKE_QUALITY_HTTP_PASS');
  } finally { main?.dispose(); await session.shutdown(); }
}, 35_000);
