// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ProductSearch } from '../../src/main/product-search';
import { ProductSession } from '../../src/main/product-session';
import { ProductHttp } from '../../src/main/product-http';
import { isProductSearchRequest, isProductCopyRequest, type ProductCandidate, type ProductSearchRequest } from '../../src/shared/product-search';
const candidate: ProductCandidate = { rank: 1, release_id: 'rel-synthetic-001', script_id: 'script-synthetic-001', script_version: 1,
  content_hash: 'a'.repeat(64), title: '合成发货', category: 'presale', answer_text: '合成订单 {订单号}', platform_scope: ['qianniu'],
  product_scope_type: 'storewide', product_scope_refs: [], effective_from: '2026-01-01T00:00:00Z', effective_to: null,
  intent_taxonomy_version: 'itax_synthetic_v1', intent_id: 'intent_synthetic_shipping', risk_level: 'low', risk_categories: [], has_conflict: false, placeholder_keys: ['order_id'] };
async function fixture(options: { disabled?: boolean; eventFail?: boolean; candidate?: ProductCandidate; noHit?: boolean; openEntry?: () => boolean | Promise<boolean> } = {}) {
  const events: unknown[] = []; const write = vi.fn();
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    if (p.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
    if (p.endsWith('/logout')) return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body));
    if (p === '/v1/search') return Response.json({ query_id: body.query_id, hit_status: options.noHit ? 'no_hit' : 'hit', release_id: candidate.release_id,
      source_binding_hash: 'b'.repeat(64), telemetry_status: options.disabled ? 'collection_disabled' : 'recorded',
      candidates: options.noHit ? [] : [options.candidate ?? candidate] });
    events.push(body);
    if (p === '/v1/events/escalate') {
      return options.eventFail ? new Response(null, { status: 503 })
        : Response.json({ escalate_id: 'esc_synthetic_1', query_id: body.query_id, action: body.action });
    }
    if (p === '/v1/events/adoption' && body.outcome === 'adopted') expect(write).toHaveBeenCalledTimes(1);
    return options.eventFail ? new Response(null, { status: 503 }) : Response.json({ ok: true, query_id: body.query_id });
  });
  const session = new ProductSession(new ProductHttp('http://127.0.0.1:4100', transport as typeof fetch), {
    read: () => ({ access_token: 't'.repeat(43), expires_at: new Date(Date.now() + 899_000).toISOString() }), write: () => {}, clear: () => {},
  }, { open: async () => {} });
  await session.restore();
  const announce = { allows: (releaseId: string) => releaseId === (options.candidate ?? candidate).release_id, subscribe: () => () => {} };
  const help = { openEntry: options.openEntry ?? vi.fn(() => true) };
  const search = new ProductSearch(session, write, announce, help);
  const request: ProductSearchRequest = { sessionEpoch: session.view().sessionEpoch, generation: 1, queryText: '合成发货问题', platform: 'qianniu', platformSource: 'manual', productContextType: null, productContextRef: null, parentQueryId: null };
  const result = await search.search(1, request);
  if (!result.ok) throw Error(result.code);
  const copy = { sessionEpoch: request.sessionEpoch, generation: 1, queryId: result.queryId, rank: 1, scriptId: candidate.script_id,
    scriptVersion: 1, contentHash: candidate.content_hash, placeholderValues: { order_id: 'SYNTHETIC-001' } };
  return { search, session, request, copy, write, events, transport, announce, help, queryId: result.queryId };
}
describe('product query and native copy provenance', () => {
  it('copies cached original then records one terminal, without placeholder values in HTTP', async () => {
    const f = await fixture();
    expect(await f.search.copy(1, f.copy)).toMatchObject({ ok: true, copied: true, eventStatus: 'recorded' });
    expect(f.write).toHaveBeenCalledWith('合成订单 SYNTHETIC-001');
    expect(JSON.stringify(f.events)).not.toContain('SYNTHETIC-001');
    expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'CONFLICT' }); await f.session.logout();
  });
  it.each([{ disabled: true, status: 'disabled', count: 0 }, { eventFail: true, status: 'unrecorded', count: 1 }])('preserves copy when telemetry is $status', async options => {
    const f = await fixture(options); expect(await f.search.copy(1, f.copy)).toMatchObject({ copied: true, eventStatus: options.status });
    expect(f.events).toHaveLength(options.count); await f.session.logout();
  });
  it('rejects another sender, changed content hash and missing placeholder', async () => {
    const f = await fixture();
    expect(await f.search.copy(2, f.copy)).toMatchObject({ code: 'STALE' });
    expect(await f.search.copy(1, { ...f.copy, contentHash: 'b'.repeat(64) })).toMatchObject({ code: 'STALE' });
    expect(await f.search.copy(1, { ...f.copy, placeholderValues: {} })).toMatchObject({ code: 'VALIDATION' });
    expect(f.write).not.toHaveBeenCalled(); await f.session.logout();
  });
  it('blocks old generation and logout before native write', async () => {
    const f = await fixture(); f.search.cancel(1, { ...f.request, generation: 2 });
    expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'STALE' });
    expect(await f.search.search(1, f.request)).toMatchObject({ code: 'STALE' });
    await f.session.logout(); expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'STALE' }); expect(f.write).not.toHaveBeenCalled();
  });
  it('does not record an event after clipboard failure', async () => {
    const f = await fixture(); f.write.mockImplementation(() => { throw Error('synthetic clipboard failure'); });
    expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'CLIPBOARD_FAILED' }); expect(f.events).toHaveLength(0); await f.session.logout();
  });
  it('rejects platform/SKU mismatch and exclusive expiry', async () => {
    for (const change of [{ platform_scope: ['douyin'] }, { product_scope_type: 'sku', product_scope_refs: ['other'] }, { effective_to: new Date().toISOString() }]) {
      await expect(fixture({ candidate: { ...candidate, ...change } as ProductCandidate })).rejects.toThrow('VALIDATION');
    }
  });
  it('keeps the copy lock after rejecting a concurrent duplicate', async () => {
    const f = await fixture(); let finish!: () => void;
    vi.spyOn(f.session, 'status').mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(f.session.view()); }));
    const pending = f.search.copy(1, f.copy);
    expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'CONFLICT' });
    expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'CONFLICT' });
    finish(); expect(await pending).toMatchObject({ copied: true }); expect(f.write).toHaveBeenCalledTimes(1); await f.session.logout();
  });
  it('cancels copy while identity verification is pending', async () => {
    const f = await fixture(); let finish!: () => void;
    vi.spyOn(f.session, 'status').mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(f.session.view()); }));
    const pending = f.search.copy(1, f.copy); f.search.cancel(1, { ...f.request, generation: 2 }); finish();
    expect(await pending).toMatchObject({ code: 'STALE' }); expect(f.write).not.toHaveBeenCalled(); await f.session.logout();
  });
  it('counts Unicode code points and validates the closed input shape', async () => {
    const f = await fixture();
    expect(isProductSearchRequest({ ...f.request, queryText: '😀'.repeat(500) })).toBe(true);
    expect(isProductSearchRequest({ ...f.request, queryText: '😀'.repeat(501) })).toBe(false);
    expect(isProductSearchRequest({ ...f.request, productContextType: 'sku' })).toBe(false);
    expect(isProductCopyRequest({ ...f.copy, answerText: 'injected' })).toBe(false); await f.session.logout();
  });
  it('rejects copy after the announce gate stops the release', async () => {
    const f = await fixture(); f.announce.allows = () => false;
    expect(await f.search.copy(1, f.copy)).toMatchObject({ code: 'STALE' });
    expect(f.write).not.toHaveBeenCalled(); await f.session.logout();
  });
});

describe('product no-hit escalate and terminal', () => {
  it('copies synthetic contact then records escalate without a terminal', async () => {
    const f = await fixture({ noHit: true });
    const identity = { sessionEpoch: f.request.sessionEpoch, generation: 1, queryId: f.queryId };
    expect(await f.search.escalate(1, { ...identity, action: 'copy_contact' })).toMatchObject({
      ok: true, opened: true, action: 'copy_contact', eventStatus: 'recorded',
    });
    expect(f.write).toHaveBeenCalledWith(expect.stringContaining('合成话术师'));
    expect(f.events).toEqual([expect.objectContaining({ query_id: f.queryId, action: 'copy_contact' })]);
    expect(JSON.stringify(f.events)).not.toMatch(/已转交成功|转交完成/);
    const headers = new Headers(f.transport.mock.calls.find(call => String(call[0]).includes('/v1/events/escalate'))?.[1]?.headers);
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await f.search.recordTerminal(1, { ...identity, outcome: 'no_hit_exit' })).toMatchObject({ ok: true, recorded: true });
    expect(f.events[1]).toMatchObject({ query_id: f.queryId, outcome: 'no_hit_exit', chosen_rank: null });
    await f.session.logout();
  });
  it('opens the isolated entry without claiming a transfer, and keeps escalate off hit queries', async () => {
    const f = await fixture({ noHit: true });
    const identity = { sessionEpoch: f.request.sessionEpoch, generation: 1, queryId: f.queryId };
    expect(await f.search.escalate(1, { ...identity, action: 'open_feishu' })).toMatchObject({ opened: true, eventStatus: 'recorded' });
    expect(f.help.openEntry).toHaveBeenCalledTimes(1);
    expect(await f.search.recordTerminal(1, { ...identity, outcome: 'dismissed' })).toMatchObject({ code: 'VALIDATION' });
    const hit = await fixture();
    expect(await hit.search.escalate(1, { sessionEpoch: hit.request.sessionEpoch, generation: 1, queryId: hit.queryId, action: 'copy_contact' }))
      .toMatchObject({ code: 'STALE' });
    expect(await hit.search.recordTerminal(1, { sessionEpoch: hit.request.sessionEpoch, generation: 1, queryId: hit.queryId, outcome: 'no_hit_exit' }))
      .toMatchObject({ code: 'VALIDATION' });
    await f.session.logout(); await hit.session.logout();
  });
  it('records no_hit_exit after cancel, and does not fake a transfer when the entry fails', async () => {
    const f = await fixture({ noHit: true, openEntry: async () => false });
    const identity = { sessionEpoch: f.request.sessionEpoch, generation: 1, queryId: f.queryId };
    expect(await f.search.escalate(1, { ...identity, action: 'open_feishu' })).toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.events).toHaveLength(0);
    f.search.cancel(1, { sessionEpoch: f.request.sessionEpoch, generation: 2 });
    expect(await f.search.recordTerminal(1, { ...identity, outcome: 'no_hit_exit' })).toMatchObject({ ok: true, recorded: true });
    expect(f.events[0]).toMatchObject({ outcome: 'no_hit_exit' });
    await f.session.logout();
  });
  it.each([{ disabled: true, status: 'disabled', count: 0 }, { eventFail: true, status: 'unrecorded', count: 1 }])(
    'keeps the native help action when telemetry is $status',
    async options => {
      const f = await fixture({ noHit: true, ...options });
      expect(await f.search.escalate(1, {
        sessionEpoch: f.request.sessionEpoch, generation: 1, queryId: f.queryId, action: 'copy_contact',
      })).toMatchObject({ opened: true, eventStatus: options.status });
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(f.events).toHaveLength(options.count);
      await f.session.logout();
    },
  );
});
