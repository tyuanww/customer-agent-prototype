// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { SOP_CANDIDATE_CONTRACT_SET_ID } from '@customer-agent/contracts/sop-candidates';
import { ContentIntakeQuery } from '../../src/main/content-intake-query';
import { ProductHttp, ProductHttpError } from '../../src/main/product-http';
import { SopUnifiedPort, type SopUnifiedSession } from '../../src/main/sop-unified-port';
import { SopUnifiedRuntime } from '../../src/main/sop-unified-runtime';
import type { OpenSopCandidate } from '../../src/main/sop-candidate-search';
import { SOP_RESOURCE_CONTRACT } from '../../src/shared/sop-unified';
import type { IntakeSopCandidatesEvent } from '../../src/shared/content-intake-query';
import { intakeQueryData } from '../fixtures/intake-query-data';
import { unifiedFixture } from '../support/sop-unified-fixture';

const discoverPath = '/v1/sop/candidate-queries';
const selectPath = '/v1/sop/candidate-selections';
const checkPath = '/v1/intake/sop/check';
const candidateRef = `sdc_${'a'.repeat(64)}`;
const otherCandidateRef = `sdc_${'b'.repeat(64)}`;
const oldContext = '11111111-1111-4111-8111-111111111111';
const newContext = '22222222-2222-4222-8222-222222222222';

function setup(active = true, multipleCandidates = false) {
  const wire = intakeQueryData(), fixture = unifiedFixture();
  fixture.result.media = [];
  const published: IntakeSopCandidatesEvent[] = [];
  const runtimeList: SopUnifiedRuntime[] = [];
  const faults = { faq: false, c: false, d: false, openingExpired: false, revoked: false, ambiguous: false, discoveryTimeout: false, discoveryStale: false };
  let selectionFailure: { status: number; code: string } | null = null;
  const stalledHttp = new ProductHttp('http://127.0.0.1:43110', (_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal;
    if (!signal) { reject(new Error('missing transport deadline')); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  let heldDiscovery: Promise<void> | null = null;
  let heldSelection: Promise<void> | null = null;
  let discoveryCount = 0;
  const entitlements = new Map<string, typeof fixture.entitlement>();
  const request = vi.fn<SopUnifiedSession['request']>(async (_epoch, path, options) => {
    const body = options?.body;
    const header = options?.headers?.['x-intake-contract-set'];
    if (path === '/v1/intake/entitlements' && header === SOP_RESOURCE_CONTRACT) {
      const ordinary = wire.respond(path, body) as typeof fixture.entitlement;
      const entitlement = { ...ordinary, scopes: [{ ...fixture.entitlement.scopes[0]!, shopId: ordinary.shopId }] };
      entitlements.set(entitlement.entitlementId, entitlement);
      return { status: 200, value: entitlement };
    }
    if (path.startsWith('/v1/intake/snapshot?') && faults.faq) throw new ProductHttpError('FORBIDDEN');
    if (path === discoverPath || path === selectPath) {
      expect(header).toBe(SOP_CANDIDATE_CONTRACT_SET_ID);
      if (!body || typeof body !== 'object' || !('request_id' in body) || !('entitlement_id' in body)) {
        throw new Error('missing candidate binding');
      }
      const entitlement = entitlements.get(String(body.entitlement_id));
      if (!entitlement) throw new Error('W5 requires the ordinary SOP entitlement');
      if (path === discoverPath) {
        discoveryCount++;
        if (heldDiscovery) await heldDiscovery;
        if (faults.discoveryTimeout) return stalledHttp.request(path, { ...options, timeoutMs: 50 });
        if (faults.discoveryStale) return { status: 200, value: { status: 'stale', request_id: body.request_id } };
        if (faults.ambiguous) return { status: 200, value: { status: 'ambiguous', request_id: body.request_id } };
        return { status: 200, value: { status: 'candidates', request_id: body.request_id,
          release_id: entitlement.releaseId, expires_at: entitlement.validUntil,
          candidates: [{ label: '合成核对候选', candidate_ref: candidateRef },
            ...(multipleCandidates ? [{ label: '合成退换候选', candidate_ref: otherCandidateRef }] : [])] } };
      }
      if (heldSelection) await heldSelection;
      if (faults.revoked) throw new ProductHttpError('FORBIDDEN');
      if (selectionFailure && 'candidate_ref' in body && body.candidate_ref === candidateRef) {
        const { status, code } = selectionFailure;
        const http = new ProductHttp('http://127.0.0.1:43110', async () => Response.json({ code }, { status }));
        return http.request(path, options);
      }
      if (faults.c) throw new ProductHttpError('UNAVAILABLE');
      return { status: 200, value: { status: 'ready', request_id: body.request_id, release_id: entitlement.releaseId,
        lease_expires_at: entitlement.validUntil, result: fixture.result, reasons: [] } };
    }
    if (path === checkPath) {
      expect(header).toBe(SOP_RESOURCE_CONTRACT);
      const input = body as { continuationId: string; entitlementId: string; action: string };
      if (input.action !== 'open') return { status: 204, value: null };
      if (faults.openingExpired) throw new ProductHttpError('CONFLICT', 'LEASE_EXPIRED');
      if (faults.d) throw new ProductHttpError('UNAVAILABLE');
      const entitlement = entitlements.get(input.entitlementId);
      if (!entitlement) throw new Error('missing original SOP entitlement');
      return { status: 200, value: { continuationId: input.continuationId, entitlement } };
    }
    if (path === '/v1/intake/sop/continuations/close') return { status: 204, value: null };
    return { status: 200, value: wire.respond(path, body) };
  });
  const session: SopUnifiedSession = {
    view: () => ({ ok: true, enabled: true, signedIn: true, sessionEpoch: 1, userId: 'synthetic-user',
      role: 'agent', authMode: 'mock', expiresAt: fixture.entitlement.validUntil, displayName: '合成坐席', job: null }),
    subscribe: () => () => {}, onExplicitLogout: () => () => {}, request,
  };
  const open = vi.fn<OpenSopCandidate>(async candidate => {
    const runtime = new SopUnifiedRuntime(new SopUnifiedPort(session, () => false, 'v12'), vi.fn(), undefined, candidate);
    runtimeList.push(runtime);
    await runtime.open(1);
    return runtime.hasInstance() ? 'opened' : 'unavailable';
  });
  const query = new ContentIntakeQuery(session, vi.fn(), true, active ? { publish: event => published.push(event), open } : undefined);
  const bodies = (path: string) => request.mock.calls.filter(([, url]) => url === path).map(([, , options]) => options?.body);
  return {
    query, published, runtimeList, faults, open, bodies, get discoveryCount() { return discoveryCount; },
    rejectFirstCandidate(status: number, code: string) { selectionFailure = { status, code }; },
    holdDiscovery(promise: Promise<void> | null) { heldDiscovery = promise; },
    holdSelection(promise: Promise<void>) { heldSelection = promise; },
    async dispose() { query.dispose(); await Promise.all(runtimeList.map(runtime => runtime.dispose())); },
  };
}

function hold() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

function candidateKey(events: IntakeSopCandidatesEvent[], id: string, index = 0) {
  for (const event of events) {
    const candidate = event.contextId === id && 'candidates' in event ? event.candidates[index] : undefined;
    if (candidate) return candidate.key;
  }
  throw new Error('missing candidate projection');
}

it('projects only an opaque name and key, then replays the exact C and D after losing both receipts', async () => {
  const h = setup();
  try {
    await h.query.access('shop-a');
    const rows = await h.query.search('如何洁面', oldContext);
    expect(rows[0]?.answerText).toContain('合成正文');
    const key = candidateKey(h.published, oldContext);
    expect(h.published).toEqual([{ contextId: oldContext, status: 'searching' }, { contextId: oldContext, candidates: [{ key, label: '合成核对候选' }] }]);
    expect(key).not.toBe(candidateRef);
    expect(h.bodies(selectPath)).toEqual([]);
    expect(h.bodies(checkPath)).toEqual([]);
    expect(h.open).not.toHaveBeenCalled();

    h.faults.c = true;
    const denied = await Promise.all([h.query.openSopCandidate(key), h.query.openSopCandidate(key)]);
    expect(denied).toMatchObject([{ code: 'UNAVAILABLE' }, { code: 'UNAVAILABLE' }]);
    expect(h.bodies(selectPath)).toHaveLength(1);
    expect(h.open).not.toHaveBeenCalled();

    h.faults.c = false; h.faults.d = true;
    await expect(h.query.openSopCandidate(key)).resolves.toEqual({ ok: true, opened: true });
    const [firstC, secondC] = h.bodies(selectPath);
    expect(secondC).toEqual(firstC);
    expect(firstC).toEqual({
      request_id: expect.any(String), candidate_query_id: Reflect.get(h.bodies(discoverPath)[0] as object, 'request_id'),
      candidate_ref: candidateRef, entitlement_id: Reflect.get(h.bodies(discoverPath)[0] as object, 'entitlement_id'),
    });
    const runtime = h.runtimeList[0]!;
    expect(runtime.projection()).toMatchObject({ state: 'paused', entry: 'candidate', node: null });
    const [firstD] = h.bodies(checkPath);
    expect(firstD).toMatchObject({ queryRequestId: Reflect.get(firstC as object, 'request_id'),
      entitlementId: Reflect.get(firstC as object, 'entitlement_id'), action: 'open' });

    await h.query.search('下一问', newContext);
    await expect(h.query.openSopCandidate(key)).resolves.toMatchObject({ code: 'STALE' });
    h.faults.d = false;
    await expect(runtime.command({ kind: 'refresh' })).resolves.toEqual({ ok: true });
    expect(h.bodies(checkPath)).toEqual([firstD, firstD]);
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(runtime.projection()).toMatchObject({ state: 'ready', instanceName: '合成完整任务图' });
  } finally { await h.dispose(); }
});

it.each([[422, 'SOP_BLOCKED'], [409, 'SOP_STALE'], [409, 'IDEMPOTENCY_CONFLICT']] as const)(
  'keeps the other candidate and FAQ available after a %i %s selection denial',
  async (status, code) => {
    const h = setup(true, true);
    try {
      await h.query.access('shop-a');
      const [faq] = await h.query.search('如何洁面', oldContext);
      if (!faq) throw new Error('Expected a FAQ result');
      const first = candidateKey(h.published, oldContext);
      const second = candidateKey(h.published, oldContext, 1);
      h.rejectFirstCandidate(status, code);

      await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'SOP_CANDIDATE_UNAVAILABLE' });
      await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'SOP_CANDIDATE_UNAVAILABLE' });
      expect(h.bodies(selectPath)).toHaveLength(1);
      expect(h.open).not.toHaveBeenCalled();
      expect(h.published.at(-1)).toMatchObject({ candidates: [{ key: first }, { key: second }] });
      const discoveries = h.bodies(discoverPath);
      expect(discoveries).toHaveLength(code === 'SOP_STALE' ? 2 : 1);
      if (code === 'SOP_STALE') expect(discoveries[1]).toEqual(discoveries[0]);
      await expect(h.query.openSopCandidate(second)).resolves.toEqual({ ok: true, opened: true });
      expect(h.runtimeList[0]?.projection()).toMatchObject({ state: 'ready' });
      expect(h.bodies(checkPath)).toHaveLength(1);
      await expect(h.query.copy(faq.key)).resolves.toEqual({ copied: true });
    } finally { await h.dispose(); }
  },
);

it('clears the round after the discovery replay confirms it is stale', async () => {
  const h = setup(true, true);
  try {
    await h.query.access('shop-a');
    await h.query.search('如何洁面', oldContext);
    const first = candidateKey(h.published, oldContext);
    const second = candidateKey(h.published, oldContext, 1);
    h.rejectFirstCandidate(409, 'SOP_STALE');
    h.faults.discoveryStale = true;

    await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'STALE' });
    expect(h.published.at(-1)).toEqual({ contextId: oldContext, status: 'stale' });
    await expect(h.query.openSopCandidate(second)).resolves.toMatchObject({ code: 'STALE' });
    expect(h.bodies(discoverPath)).toHaveLength(2);
    expect(h.bodies(selectPath)).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('leaves both candidates actionable on an unknown conflict and retries only the failed selection', async () => {
  const h = setup(true, true);
  try {
    await h.query.access('shop-a');
    await h.query.search('如何洁面', oldContext);
    const first = candidateKey(h.published, oldContext);
    const second = candidateKey(h.published, oldContext, 1);
    h.rejectFirstCandidate(409, 'UNRECOGNIZED_CONFLICT');

    await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'UNAVAILABLE' });
    const [firstAttempt, retry] = h.bodies(selectPath);
    expect(retry).toEqual(firstAttempt);
    expect(h.discoveryCount).toBe(1);
    await expect(h.query.openSopCandidate(second)).resolves.toEqual({ ok: true, opened: true });
  } finally { await h.dispose(); }
});

it('keeps the other candidate actionable when discovery revalidation times out', async () => {
  const h = setup(true, true);
  try {
    await h.query.access('shop-a');
    await h.query.search('如何洁面', oldContext);
    const first = candidateKey(h.published, oldContext);
    const second = candidateKey(h.published, oldContext, 1);
    h.rejectFirstCandidate(409, 'SOP_STALE');
    h.faults.discoveryTimeout = true;

    await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'SOP_CANDIDATE_UNAVAILABLE' });
    expect(h.published.at(-1)).toMatchObject({ candidates: [{ key: first }, { key: second }] });
    await expect(h.query.openSopCandidate(second)).resolves.toEqual({ ok: true, opened: true });
    expect(h.discoveryCount).toBe(2);
  } finally { await h.dispose(); }
});

it('does not replay discovery for a stale selection reply after a replacement search', async () => {
  const h = setup();
  const gate = hold();
  try {
    await h.query.access('shop-a');
    await h.query.search('如何洁面', oldContext);
    const first = candidateKey(h.published, oldContext);
    h.rejectFirstCandidate(409, 'SOP_STALE');
    h.holdSelection(gate.promise);
    const opening = h.query.openSopCandidate(first);
    await h.query.search('下一问', newContext);
    gate.release();
    await expect(opening).resolves.toMatchObject({ code: 'STALE' });
    expect(h.bodies(discoverPath)).toHaveLength(2);
    expect(h.published.at(-1)).toMatchObject({ contextId: newContext, candidates: expect.any(Array) });
  } finally { gate.release(); await h.dispose(); }
});

it('reports an expired first opening as unavailable while leaving the other candidate actionable', async () => {
  const h = setup(true, true);
  try {
    await h.query.access('shop-a');
    await h.query.search('如何洁面', oldContext);
    const first = candidateKey(h.published, oldContext);
    const second = candidateKey(h.published, oldContext, 1);
    h.faults.openingExpired = true;
    await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'SOP_CANDIDATE_UNAVAILABLE' });
    expect(h.runtimeList[0]?.projection()).toMatchObject({ state: 'ended', node: null });

    h.faults.openingExpired = false;
    await expect(h.query.openSopCandidate(first)).resolves.toMatchObject({ code: 'SOP_CANDIDATE_UNAVAILABLE' });
    expect(h.bodies(checkPath)).toHaveLength(1);
    await expect(h.query.openSopCandidate(second)).resolves.toEqual({ ok: true, opened: true });
    expect(h.runtimeList[1]?.projection()).toMatchObject({ state: 'ready' });
  } finally { await h.dispose(); }
});

it('allows SOP discovery after FAQ denial and drops the candidate when C observes revocation', async () => {
  const h = setup();
  const gate = hold();
  try {
    await h.query.access('shop-a');
    h.holdDiscovery(gate.promise);
    h.faults.faq = true;
    await expect(h.query.search('合成问题', oldContext)).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(h.published).toEqual([{ contextId: oldContext, status: 'searching' }]);
    gate.release();
    await vi.waitUntil(() => h.published.length > 1);
    const key = candidateKey(h.published, oldContext);
    h.faults.revoked = true;
    await expect(h.query.openSopCandidate(key)).resolves.toMatchObject({ code: 'STALE' });
    expect(h.published.at(-1)).toEqual({ contextId: oldContext, status: 'stale' });
    expect(h.bodies(checkPath)).toEqual([]);
    expect(h.open).not.toHaveBeenCalled();
  } finally { gate.release(); await h.dispose(); }
});

it('returns copyable FAQ while the SOP discovery transport times out', async () => {
  const h = setup();
  const gate = hold();
  try {
    await h.query.access('shop-a');
    h.holdDiscovery(gate.promise);
    h.faults.discoveryTimeout = true;
    const rows = await h.query.search('如何洁面', oldContext);
    expect(rows).toHaveLength(3);
    expect(h.discoveryCount).toBe(1);
    expect(h.published).toEqual([{ contextId: oldContext, status: 'searching' }]);
    gate.release();
    await vi.waitUntil(() => h.published.length > 1);
    expect(h.published.at(-1)).toEqual({ contextId: oldContext, status: 'unavailable' });
    await expect(h.query.copy(rows[0]!.key)).resolves.toEqual({ copied: true });
    expect(h.open).not.toHaveBeenCalled();
  } finally { gate.release(); await h.dispose(); }
});

it('keeps FAQ results on ambiguity and ignores SOP results from a shop that has been replaced', async () => {
  const h = setup();
  const gate = hold();
  try {
    await h.query.access('shop-a');
    h.holdDiscovery(gate.promise);
    await expect(h.query.search('如何洁面', oldContext)).resolves.toHaveLength(3);
    expect(h.discoveryCount).toBe(1);
    await h.query.access('shop-b');
    h.holdDiscovery(null);
    h.faults.ambiguous = true;
    const rows = await h.query.search('如何洁面', newContext);
    expect(rows[0]?.answerText).toMatch(/^shop-b/);
    expect(h.discoveryCount).toBe(2);
    h.faults.ambiguous = false;
    gate.release();
    await new Promise(resolve => setImmediate(resolve));
    expect(h.published).toEqual([
      { contextId: oldContext, status: 'searching' }, { contextId: oldContext, candidates: [] },
      { contextId: newContext, status: 'searching' }, { contextId: newContext, candidates: [] },
    ]);
    expect(h.open).not.toHaveBeenCalled();
  } finally { gate.release(); await h.dispose(); }
});

it.each(['new question', 'new shop'] as const)('does not create an instance for a C reply after a %s', async replacement => {
  const h = setup();
  const gate = hold();
  try {
    await h.query.access('shop-a');
    await h.query.search('原问句', oldContext);
    const key = candidateKey(h.published, oldContext);
    h.holdSelection(gate.promise);
    const opening = h.query.openSopCandidate(key);
    expect(h.bodies(selectPath)).toHaveLength(1);
    if (replacement === 'new shop') await h.query.access('shop-b');
    else await h.query.search('新问句', newContext);
    gate.release();
    await expect(opening).resolves.toMatchObject({ code: 'STALE' });
    expect(h.bodies(checkPath)).toEqual([]);
    expect(h.open).not.toHaveBeenCalled();
  } finally { gate.release(); await h.dispose(); }
});

it('keeps legacy v12 Query on the existing network paths unless W5 is enabled', async () => {
  const h = setup(false);
  try {
    await h.query.access('shop-a');
    await expect(h.query.search('如何洁面', oldContext)).resolves.toHaveLength(3);
    expect(h.bodies(discoverPath)).toEqual([]);
    expect(() => h.query.openSopCandidate(oldContext)).toThrow('UNAVAILABLE');
  } finally { await h.dispose(); }
});
