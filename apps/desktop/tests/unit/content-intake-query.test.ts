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
it('refuses a displayed copy when the server revoked permission without a refresh', async () => {
  const f = setup(), events: string[] = [];
  f.query.subscribe(event => events.push(event.reason));
  try {
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面');
    f.state.revoked = true;
    await expect(Promise.resolve().then(() => f.query.copy(rows[0].key))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.copy).not.toHaveBeenCalled();
    expect(events.at(-1)).toBe('invalidated');
  } finally { f.query.dispose(); }
});
it('uses authorized shops, deterministic Top 3 and only Main-owned original text; no-hit is empty', async () => {
  const f = setup();
  try {
    expect(await f.query.access()).toMatchObject({ shops: ['shop-a', 'shop-b'], shopId: null });
    await expect(f.query.search('洁面')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.query.access('not-authorized')).rejects.toMatchObject({ code: 'NO_GRANT' });
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面');
    expect(rows.map(r => r.title)).toEqual(['洁面用法 0', '洁面用法 1', '洁面用法 2']);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
    rows[0].answerText = 'tampered';
    expect(await f.query.copy(rows[0].key)).toEqual({ copied: true });
    expect(f.copy).toHaveBeenCalledWith(`shop-a ${f.entries[0].answerText}`);
    await expect(f.query.copy('unknown')).rejects.toMatchObject({ code: 'STALE' });
    expect(await f.query.search('zzzz')).toEqual([]);
    await expect(f.query.copy(rows[0].key)).rejects.toMatchObject({ code: 'STALE' });
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
it.each(['cancel', 'switch', 'conditions', 'logout', 'destroy', 'search'])('never copies a late verification after %s', async action => {
  const f = setup();
  let release!: () => void;
  try {
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面'), original = f.session.request;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let checking = false;
    f.session.request = async (...args) => {
      const result = await original(...args);
      if (!checking && args[1].includes('/snapshot')) { checking = true; await blocked; }
      return result;
    };
    const pending = f.query.copy(rows[0].key);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'STALE' });
    await vi.waitUntil(() => checking);
    if (action === 'cancel') f.query.cancel();
    if (action === 'conditions') f.query.selectConditions({ productIds: [], scenarioIds: [] });
    if (action === 'switch') await f.query.access('shop-b');
    if (action === 'logout') { f.view.signedIn = false; f.view.sessionEpoch++; f.callbacks.forEach(fn => fn()); }
    if (action === 'destroy') f.query.dispose();
    if (action === 'search') await f.query.search('洁面');
    await rejected;
    release(); await Promise.resolve();
    expect(f.copy).not.toHaveBeenCalled();
  } finally { release?.(); f.query.dispose(); }
});
it('times out a verification that ignores abort and never copies its late response', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const f = setup(); let release!: () => void;
  try {
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面'), original = f.session.request;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    f.session.request = async (...args) => { const result = await original(...args); await blocked; return result; };
    const rejected = expect(f.query.copy(rows[0].key)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(5_001); await rejected;
    release(); await Promise.resolve();
    expect(f.copy).not.toHaveBeenCalled();
  } finally { release?.(); f.query.dispose(); }
});
it('does not let a late denial invalidate the result of a newer search', async () => {
  const f = setup(), events: string[] = []; let release!: () => void;
  f.query.subscribe(event => events.push(event.reason));
  try {
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面'), original = f.session.request;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let checking = false;
    f.session.request = async (...args) => {
      if (!checking && args[1].includes('/snapshot')) {
        checking = true; await blocked; throw { code: 'FORBIDDEN', reason: 'PERMISSION_CHANGED' };
      }
      return original(...args);
    };
    const rejected = expect(f.query.copy(rows[0].key)).rejects.toMatchObject({ code: 'STALE' });
    await vi.waitUntil(() => checking);
    const newer = await f.query.search('洁面'); await rejected;
    const count = events.length;
    release(); await Promise.resolve(); await Promise.resolve();
    expect(events).toHaveLength(count);
    expect(await f.query.copy(newer[0].key)).toEqual({ copied: true });
    expect(f.copy).toHaveBeenCalledTimes(1);
  } finally { release?.(); f.query.dispose(); }
});
it('does not attribute an old catalog expiry to a replacement search in progress', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const f = setup(), events: string[] = [];
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.query.subscribe(event => events.push(event.reason));
  try {
    f.state.ttl = 1_000; await f.query.access('shop-a');
    await f.query.search('洁面');
    f.state.ttl = 60_000;
    const original = f.session.request;
    f.session.request = async (...args) => {
      const result = await original(...args);
      if (args[1].includes('/snapshot')) { entered(); await gate; }
      return result;
    };
    const pending = f.query.search('洁面');
    await started; await vi.advanceTimersByTimeAsync(1_001);
    expect(events).toEqual([]);
    release(); const fresh = await pending;
    expect(await f.query.copy(fresh[0].key)).toEqual({ copied: true });
  } finally { release(); f.query.dispose(); }
});
it('supersedes an in-flight copy with a newer copy', async () => {
  const f = setup(); let release!: () => void;
  try {
    await f.query.access('shop-a');
    const rows = await f.query.search('洁面'), original = f.session.request;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let checking = false;
    f.session.request = async (...args) => {
      const result = await original(...args);
      if (!checking && args[1].includes('/snapshot')) {
        checking = true; await blocked;
      }
      return result;
    };
    const rejected = expect(f.query.copy(rows[0].key)).rejects.toMatchObject({ code: 'STALE' });
    await vi.waitUntil(() => checking);
    expect(await f.query.copy(rows[1].key)).toEqual({ copied: true }); await rejected;
    release(); await Promise.resolve();
    expect(f.copy).toHaveBeenCalledTimes(1);
    expect(f.copy).toHaveBeenCalledWith(`shop-a ${f.entries[1].answerText}`);
  } finally { release?.(); f.query.dispose(); }
});
it('withdraws expired rows, rejects revoked permissions, and recovers without treating a release as revocation', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); const f = setup(), events: string[] = [];
  f.query.subscribe(event => events.push(event.reason));
  try {
    f.state.ttl = 1000; await f.query.access('shop-a');
    const rows = await f.query.search('洁面');
    f.state.release = 'release-synthetic-2';
    expect(await f.query.copy(rows[0].key)).toEqual({ copied: true });
    await vi.advanceTimersByTimeAsync(1001);
    expect(events.at(-1)).toBe('expired'); await expect(f.query.copy(rows[0].key)).rejects.toMatchObject({ code: 'STALE' });
    f.state.revoked = true;
    await expect(f.query.search('洁面')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.state.revoked = false;
    expect((await f.query.search('洁面'))[0].releaseId).toBe('release-synthetic-2');
    f.copy.mockImplementation(() => { throw new Error('OS clipboard failed'); });
    const fresh = await f.query.search('洁面');
    await expect(f.query.copy(fresh[0].key)).rejects.toMatchObject({ code: 'CLIPBOARD_FAILED' });
  } finally { f.query.dispose(); }
});
it('returns zero shops and rechecks discovery after losing a scope', async () => {
  const f = setup();
  try {
    f.state.empty = true;
    await expect(f.query.access()).rejects.toMatchObject({ code: 'NO_GRANT' });
  }
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
    expect(selected.productIds).toEqual(['product']); await expect(f.query.copy(generic[0].key)).rejects.toMatchObject({ code: 'STALE' });
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
