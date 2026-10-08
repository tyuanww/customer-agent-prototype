import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeishuOrganizationObserver, type OrganizationTransport } from '../experiments/intake-organization/feishu-observer.js';
import { nativeOrganizationFixture } from './support/intake-organization-native.js';

const scope = { tenantId: 'tenant-a', appId: 'app-a' };
const binding = { ...scope, principalId: 'agent', openId: 'synthetic-open-agent', expectedFactsVersion: 1 };
const started = Date.parse('2026-10-08T00:00:00.000Z');
function setup() {
  const fixture = nativeOrganizationFixture();
  const now = vi.fn().mockResolvedValue(started);
  return { ...fixture, now, observe: () => createFeishuOrganizationObserver(scope, fixture.transport, now)(binding) };
}
afterEach(() => vi.useRealTimers());
describe('offline native organization observation', () => {
  it('follows both full scans, returns only mapped facts and pins the deadline to observation start', async () => {
    const f = setup(); f.now.mockResolvedValueOnce(started).mockResolvedValueOnce(started + 120_000);
    const result = await f.observe();
    expect(result).toMatchObject({ ok: true, snapshot: { principalId: 'agent', expectedFactsVersion: 1,
      departmentIds: ['dept-a'], jobId: 'job-agent', enabled: true,
      checkedAt: new Date(started).toISOString(), validUntil: new Date(started + 300_000).toISOString() },
    provenance: { mappingVersion: 'feishu-contact-job-title-v1-experiment', observedUntil: new Date(started + 120_000).toISOString() } });
    expect(f.calls.map(call => [call.kind, call.key])).toEqual([
      ['user', binding.openId], ['jobs', undefined], ['jobs', 'second'], ['jobs', undefined], ['jobs', 'second'], ['user', binding.openId],
    ]);
    expect(JSON.stringify(result)).not.toContain('合成坐席甲');
    expect(f.calls.every(call => call.signal.aborted)).toBe(true);
  });
  it.each(['is_frozen', 'is_resigned', 'is_exited', 'is_unjoin'] as const)('maps %s to disabled without inventing a role', async flag => {
    const f = setup(); f.person.status[flag] = true;
    expect(await f.observe()).toMatchObject({ ok: true, snapshot: { enabled: false, jobId: 'job-agent' } });
  });
  it('maps unactivated users to disabled and rejects missing or non-boolean status', async () => {
    const f = setup(); f.person.status.is_activated = false;
    expect(await f.observe()).toMatchObject({ ok: true, snapshot: { enabled: false } });
    Reflect.deleteProperty(f.person.status, 'is_resigned');
    expect(await f.observe()).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
    Reflect.set(f.person.status, 'is_resigned', 'false');
    expect(await f.observe()).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
  });
  it('rejects wrong scope/version before I/O and a different returned user even with the same name', async () => {
    const f = setup(), observe = createFeishuOrganizationObserver(scope, f.transport, f.now);
    for (const delta of [{ appId: 'other' }, { tenantId: 'other' }, { expectedFactsVersion: 0 }]) {
      expect(await observe({ ...binding, ...delta })).toEqual({ ok: false, reason: 'INVALID_BINDING' });
    }
    expect(f.calls).toHaveLength(0); f.person.open_id = 'synthetic-other';
    expect(await f.observe()).toEqual({ ok: false, reason: 'IDENTITY_MISMATCH' });
  });
  it.each(['', ' 合成坐席', '合成坐席 ', '未登记岗位'])('does not normalize or guess job title %j', async title => {
    const f = setup(); f.person.job_title = title;
    expect(await f.observe()).toMatchObject({ ok: false });
  });
  it('rejects duplicate names and disabled titles, including the previously documented wrong enabled field', async () => {
    const f = setup(), row = f.pages.second!.items[0]!;
    f.pages.first!.items.push({ job_title_id: 'ambiguous', name: row.name, status: true });
    expect(await f.observe()).toEqual({ ok: false, reason: 'JOB_UNRESOLVED' });
    f.pages.first!.items.pop(); row.status = false;
    expect(await f.observe()).toEqual({ ok: false, reason: 'JOB_UNRESOLVED' });
    Reflect.deleteProperty(row, 'status'); Reflect.set(row, 'is_enabled', true);
    expect(await f.observe()).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
  });
  it('rejects repeated cursor/ID, missing pages, oversized pages and nonterminal final tokens', async () => {
    for (const mutate of [
      (f: ReturnType<typeof setup>) => { f.pages.second!.has_more = true; f.pages.second!.page_token = 'second'; },
      (f: ReturnType<typeof setup>) => { f.pages.second!.items.push(f.pages.first!.items[0]!); },
      (f: ReturnType<typeof setup>) => { delete f.pages.second; },
      (f: ReturnType<typeof setup>) => { f.pages.first!.items = Array.from({ length: 51 }, (_, i) => ({ job_title_id: `job-${i}`, name: 'unused', status: true })); },
      (f: ReturnType<typeof setup>) => { f.pages.second!.page_token = 'unexpected'; },
    ]) {
      const f = setup(); mutate(f); expect(await f.observe()).toMatchObject({ ok: false });
    }
  });
  it('accepts an empty intermediate page but fails a never-ending directory at its page budget', async () => {
    const f = setup(); f.pages.first!.items = [];
    expect(await f.observe()).toMatchObject({ ok: true });
    let calls = 0;
    f.transport.jobTitles = async () => JSON.stringify({ code: 0, data: { items: [], has_more: true, page_token: `page-${++calls}` } });
    expect(await f.observe()).toEqual({ ok: false, reason: 'INCOMPLETE_DIRECTORY' }); expect(calls).toBe(100);
  });
  it('rejects user/department or directory changes across reads', async () => {
    for (const changed of ['person', 'directory']) {
      const f = setup(), original = f.transport.jobTitles;
      let calls = 0;
      f.transport.jobTitles = async (...args) => {
        if (++calls === 3) {
          if (changed === 'person') f.person.department_ids = ['dept-other'];
          else f.pages.second!.items[0]!.job_title_id = 'job-other';
        }
        return original(...args);
      };
      expect(await f.observe()).toEqual({ ok: false, reason: 'OBSERVATION_CHANGED' });
    }
  });
  it('sorts departments but rejects empty and duplicate department facts', async () => {
    const f = setup(); f.person.department_ids = ['dept-b', 'dept-a'];
    expect(await f.observe()).toMatchObject({ ok: true, snapshot: { departmentIds: ['dept-a', 'dept-b'] } });
    for (const departments of [[], ['dept-a', 'dept-a']]) {
      f.person.department_ids = departments; expect(await f.observe()).toMatchObject({ ok: false });
    }
  });
  it('rejects expired/backward clocks and provider errors without reflecting messages or partial facts', async () => {
    for (const end of [started - 1, started + 300_000, NaN]) {
      const f = setup(); f.now.mockResolvedValueOnce(started).mockResolvedValueOnce(end);
      expect(await f.observe()).toEqual({ ok: false, reason: 'OBSERVATION_EXPIRED' });
    }
    for (const body of ['not json', JSON.stringify({ code: 999, msg: 'secret-message' }), 'x'.repeat(1_048_577)]) {
      const f = setup(); f.transport.jobTitles = async () => body;
      const result = await f.observe(); expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain('secret-message');
    }
  });
  it('does not start transport after cancellation while the initial clock is pending', async () => {
    const f = setup(), controller = new AbortController();
    let resume!: (value: number) => void;
    let entered!: () => void;
    const clockEntered = new Promise<void>(done => { entered = done; });
    const clock = () => { entered(); return new Promise<number>(done => { resume = done; }); };
    const pending = createFeishuOrganizationObserver(scope, f.transport, clock)(binding, controller.signal);
    await clockEntered; controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'DEPENDENCY_UNAVAILABLE' });
    resume(started);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.calls).toHaveLength(0);
  });
  it('cancels hung I/O, ignores late results and rejects an already-aborted call before I/O', async () => {
    vi.useFakeTimers();
    const f = setup(), controller = new AbortController();
    controller.abort();
    expect(await createFeishuOrganizationObserver(scope, f.transport, f.now)(binding, controller.signal)).toMatchObject({ ok: false });
    expect(f.calls).toHaveLength(0);
    let captured: AbortSignal | undefined;
    const hung: OrganizationTransport = { ...f.transport, user: async (_id, signal) => { captured = signal; return new Promise(() => undefined); } };
    const pending = createFeishuOrganizationObserver(scope, hung, f.now)(binding);
    await vi.advanceTimersByTimeAsync(180_001);
    expect(await pending).toEqual({ ok: false, reason: 'DEPENDENCY_UNAVAILABLE' }); expect(captured!.aborted).toBe(true);
    let resolve!: (body: string) => void;
    const late = { ...f.transport, user: async () => new Promise<string>(done => { resolve = done; }) };
    const c = new AbortController(), cancelled = createFeishuOrganizationObserver(scope, late, f.now)(binding, c.signal);
    await vi.advanceTimersByTimeAsync(0); c.abort();
    expect(await cancelled).toMatchObject({ ok: false }); resolve(JSON.stringify({ code: 0, data: { user: f.person } }));
    await vi.advanceTimersByTimeAsync(0); expect(f.calls).toHaveLength(0);
  });
});
