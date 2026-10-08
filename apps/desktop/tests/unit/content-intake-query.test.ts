// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import * as retrieval from '@customer-agent/retrieval-core';
import { ContentIntakeQuery } from '../../src/main/content-intake-query';
import type { IntakeUsageSession } from '../../src/main/content-intake-usage';
import { intakeQueryData } from '../fixtures/intake-query-data';
function setup() {
  const wire = intakeQueryData(), callbacks = new Set<() => void>();
  const view = { signedIn: true, sessionEpoch: 1 };
  const session: IntakeUsageSession = { view: () => ({ ...view }), subscribe: fn => { callbacks.add(fn); return () => { callbacks.delete(fn); }; },
    request: vi.fn(async (_epoch, path, options) => ({ value: wire.respond(path, options.body) })) };
  const copy = vi.fn(), query = new ContentIntakeQuery(session, copy);
  return { ...wire, session, view, callbacks, copy, query };
}
afterEach(() => vi.useRealTimers());
it('uses authorized shops, deterministic Top 3 and only Main-owned original text; no-hit is empty', async () => {
  const f = setup();
  try {
    expect(await f.query.access()).toMatchObject({ shops: ['shop-a', 'shop-b'], shopId: null });
    await expect(f.query.search('洁面')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.query.access('not-authorized')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面');
    expect(rows.map(r => r.title)).toEqual(['洁面用法 0', '洁面用法 1', '洁面用法 2']);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
    rows[0].answerText = 'tampered';
    expect(f.query.copy(rows[0].key)).toEqual({ copied: true });
    expect(f.copy).toHaveBeenCalledWith(`shop-a ${f.entries[0].answerText}`);
    expect(() => f.query.copy('unknown')).toThrow('STALE');
    expect(await f.query.search('zzzz')).toEqual([]);
    expect(() => f.query.copy(rows[0].key)).toThrow('STALE');
  } finally { f.query.dispose(); }
});
it.each(['cancel', 'switch', 'conditions', 'logout', 'destroy'])('isolates late snapshot after %s', async action => {
  const f = setup();
  try {
    await f.query.access('shop-a');
    const original = f.session.request;
    let release!: () => void;
    const blocked = new Promise<void>(r => { release = r; });
    let paging = false;
    f.session.request = async (...args) => {
      const result = await original(...args);
      if (args[1].includes('/snapshot')) { paging = true; await blocked; }
      return result;
    };
    const pending = f.query.search('洁面');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'STALE' });
    await vi.waitUntil(() => paging);
    if (action === 'cancel') f.query.cancel();
    if (action === 'conditions') f.query.selectConditions({ productIds: [], scenarioIds: [] });
    if (action === 'switch') await f.query.access('shop-b');
    if (action === 'logout') { f.view.signedIn = false; f.view.sessionEpoch++; f.callbacks.forEach(fn => fn()); }
    if (action === 'destroy') f.query.dispose();
    release(); await rejected;
    expect(f.copy).not.toHaveBeenCalled();
  } finally { f.query.dispose(); }
});
it('withdraws expired rows, rejects revoked permissions, and recovers without treating a release as revocation', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); const f = setup(), events: string[] = [];
  f.query.subscribe(reason => events.push(reason));
  try {
    f.state.ttl = 1000; await f.query.access('shop-a');
    const rows = await f.query.search('洁面');
    f.state.release = 'release-synthetic-2';
    expect(f.query.copy(rows[0].key)).toEqual({ copied: true });
    await vi.advanceTimersByTimeAsync(1001);
    expect(events.at(-1)).toBe('expired'); expect(() => f.query.copy(rows[0].key)).toThrow('STALE');
    f.state.revoked = true;
    await expect(f.query.search('洁面')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.state.revoked = false;
    expect((await f.query.search('洁面'))[0].releaseId).toBe('release-synthetic-2');
    f.copy.mockImplementation(() => { throw new Error('OS clipboard failed'); });
    const fresh = await f.query.search('洁面');
    expect(() => f.query.copy(fresh[0].key)).toThrow('CLIPBOARD_FAILED');
  } finally { f.query.dispose(); }
});
it('returns zero shops and rechecks discovery after losing a scope', async () => {
  const f = setup();
  try { f.state.empty = true; expect(await f.query.access()).toMatchObject({ shops: [], shopId: null }); }
  finally { f.query.dispose(); }
});

it('typing cancellation does not abort discovery, but replacement selection does', async () => {
  const f = setup();
  try {
    const original = f.session.request;
    let release!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    let delayed = false;
    f.session.request = async (...args) => { if (!delayed) { delayed = true; await waiting; } return original(...args); };
    const menu = f.query.access(); await vi.waitUntil(() => delayed);
    f.query.cancel(); release();
    expect(await menu).toMatchObject({ shops: ['shop-a', 'shop-b'], shopId: null });
    await f.query.access('shop-a');
    expect((await f.query.search('洁面'))[0].answerText).toContain('shop-a');
  } finally { f.query.dispose(); }
});
it('rechecks qualification after ranking and refuses an excessive index instead of truncating', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const f = setup(), original = retrieval.rankBm25;
  const rank = vi.spyOn(retrieval, 'rankBm25').mockImplementation((...args) => {
    const result = original(...args); vi.setSystemTime(Date.now() + 2000); return result;
  });
  try {
    f.state.ttl = 1000; await f.query.access('shop-a');
    await expect(f.query.search('洁面')).rejects.toMatchObject({ code: 'EXPIRED' });
    expect(f.copy).not.toHaveBeenCalled(); rank.mockRestore();
    const entry = f.entries[0];
    f.entries.splice(0, f.entries.length, ...Array.from({ length: 100 }, (_, i) => ({ ...entry, businessEntryId: `large-${i}`, answerText: '合'.repeat(10000), questions: [] })));
    await expect(f.query.search('洁面')).rejects.toMatchObject({ code: 'LIMIT' });
  } finally { rank.mockRestore(); f.query.dispose(); }
});

it('uses registered menu IDs in fresh qualifications, clears old copy keys and resets conditions on shop changes', async () => {
  const f = setup();
  for (const kind of ['product','scenario'] as const) f.vocabulary.push({ id: kind, kind, displayVersion: 1,
    displayName: `合成${kind}`, meaningDigest: 'a'.repeat(64), active: true,
    scope: { tenantId:'tenant',appId:'app',brandId:'brand',shopId:null,domain:'product',sourceId:null } });
  f.entries[0].productRefs = [{ id:'product',displayVersion:1 }];
  f.entries[0].scenarioRefs = [{ id:'scenario',displayVersion:1 }];
  try {
    expect((await f.query.access('shop-a')).products).toEqual([{id:'product',label:'合成product'}]);
    const generic = await f.query.search('洁面'); expect(generic.map(r=>r.title)).not.toContain('洁面用法 0');
    const selected = f.query.selectConditions({productIds:['product'],scenarioIds:['scenario']});
    expect(selected.productIds).toEqual(['product']); expect(() => f.query.copy(generic[0].key)).toThrow('STALE');
    expect((await f.query.search('洁面'))[0].title).toBe('洁面用法 0');
    expect(() => f.query.selectConditions({productIds:['scenario'],scenarioIds:[]})).toThrow('FORBIDDEN');
    expect(() => f.query.selectConditions({productIds:['unknown'],scenarioIds:[]})).toThrow('FORBIDDEN');
    expect((await f.query.access('shop-b')).productIds).toEqual([]);
    expect((await f.query.search('洁面')).map(r=>r.title)).not.toContain('洁面用法 0');
  } finally { f.query.dispose(); }
});
it('rejects foreign/duplicate menu pages and an expired menu before issuing qualification', async () => {
  const f = setup();
  try {
    f.vocabulary.push({ id:'foreign',kind:'product',displayVersion:1,displayName:'合成',meaningDigest:'a'.repeat(64),active:true,
      scope:{tenantId:'tenant',appId:'app',brandId:'other-brand',shopId:null,domain:'product',sourceId:null} });
    await expect(f.query.access('shop-a')).rejects.toMatchObject({code:'FORBIDDEN'});
    f.vocabulary[0].scope.brandId='brand'; f.vocabulary.push(structuredClone(f.vocabulary[0]));
    await expect(f.query.access('shop-a')).rejects.toMatchObject({code:'FORBIDDEN'});
    f.vocabulary.length=0; await f.query.access('shop-a');
    vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(Date.now()+600_001);
    expect(()=>f.query.selectConditions({productIds:[],scenarioIds:[]})).toThrow('EXPIRED');
    await expect(f.query.search('洁面')).rejects.toMatchObject({code:'EXPIRED'});
  } finally { f.query.dispose(); }
});
