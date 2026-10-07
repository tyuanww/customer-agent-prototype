// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ContentIntakeManagement } from '../../src/main/content-intake-management';
import type { ProductSession } from '../../src/main/product-session';
import { ProductHttpError } from '../../src/main/product-http';
import { isIntakeManagementCommand } from '../../src/shared/content-intake-management';
import { intakeManagementData } from '../fixtures/intake-management-data';
function fixture(count = 2) {
  const data = intakeManagementData(count); let epoch = 1, signedIn = true;
  const listeners = new Set<Parameters<ProductSession['subscribe']>[0]>();
  const view: ProductSession['view'] = () => signedIn ? { ok: true, enabled: true, signedIn, sessionEpoch: epoch, userId: 'synthetic', role: 'agent', authMode: 'mock', expiresAt: '2099-01-01T00:00:00Z', displayName: '合成管理人' } : { ok: true, enabled: true, signedIn: false, sessionEpoch: epoch, userId: null, role: null, authMode: null, expiresAt: null, displayName: null };
  const request = vi.fn(async (_epoch: number, path: string, options: Parameters<ProductSession['request']>[2] = {}) => ({ status: 200, value: structuredClone(data.respond(path, options.body)) }));
  const main = new ContentIntakeManagement({ view, request, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } });
  const select = async () => { const listed = await main.command({ action: 'list', next: false }); return main.command({ action: 'select', selection: listed.candidates[0].selection }); };
  return { data, main, request, select, logout: () => { signedIn = false; epoch++; listeners.forEach(f => f(view())); } };
}
it('uses scoped capabilities instead of legacy role; freezes, preserves per-page human drafts and submits', async () => {
  const f = fixture(21);
  try {
    expect((await f.select()).canReview).toBe(true); // the legacy role deliberately says agent
    expect((await f.main.command({ action: 'quality', phase: 'initial' })).quality?.samples).toHaveLength(20);
    await f.main.command({ action: 'freeze' });
    await f.main.command({ action: 'quality', phase: 'initial' });
    await expect(f.main.command({ action: 'submit' })).rejects.toMatchObject({ code: 'VALIDATION' });
    for (const s of f.data.samples) await f.main.command({ action: 'check', scriptId: s.scriptId, defect: false, reason: '人工检查' });
    expect((await f.main.command({ action: 'quality-page', offset: 20 })).quality).toMatchObject({ checked: 21, total: 21, offset: 20 });
    expect(f.main.view().quality!.samples[0].draft?.reason).toBe('人工检查');
    await expect(f.main.command({ action: 'quality', phase: 'initial' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.main.command({ action: 'submit' })).receipt?.state).toBe('passed');
    expect(f.main.view().quality).toBeNull();
  } finally { f.main.dispose(); }
});
it('hides candidate materials from read-only seats and validates intent fields', async () => {
  const f = fixture(); f.data.state.allowed = false;
  try {
    const v = await f.main.command({ action: 'list', next: false });
    expect(v).toMatchObject({ authorized: false, candidates: [], selected: null });
    expect(f.request.mock.calls.some(c => c[1].startsWith('/v1/intake/candidates'))).toBe(false);
    await expect(f.main.command({ action: 'select', selection: 'forged' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const value of [{ action: 'freeze', key: f.data.candidate.key }, { action: 'check', scriptId: 'x', defect: false, reason: '', userId: 'fake' }, { action: 'list', next: 'true' }]) expect(isIntakeManagementCommand(value)).toBe(false);
  } finally { f.main.dispose(); }
});
it('preserves unknown writes after a lost response, blocks selection and replays original receipt', async () => {
  const f = fixture();
  try {
    await f.select(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (...args) => { await original(...args); throw new ProductHttpError('UNAVAILABLE'); });
    await expect(f.main.command({ action: 'freeze' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const pending = f.main.view().pending; expect(pending).not.toBeNull(); expect(f.main.closeRisk()).toBe('pending');
    await expect(f.main.command({ action: 'discard' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.main.command({ action: 'recover' }); expect(f.main.view().pending).toBeNull();
    expect(f.request.mock.calls.filter(c => c[2]?.body)).toHaveLength(1);
    await f.main.command({ action: 'list', next: false }); expect(f.main.view().receipt?.operationId).toBe(pending?.operationId);
  } finally { f.main.dispose(); }
});
it('expires readable content, and a logout invalidates both material and pending work', async () => {
  const f = fixture(); f.data.expireAt(80);
  try {
    await f.select(); await f.main.command({ action: 'quality', phase: 'initial' });
    await new Promise(r => setTimeout(r, 90)); expect(f.main.view()).toMatchObject({ authorized: false, quality: null, material: null });
    f.logout(); expect(f.main.view()).toMatchObject({ signedIn: false, selected: null, pending: null });
  } finally { f.main.dispose(); }
});
it('rejects a candidate response for another key without exposing its materials', async () => {
  const f = fixture();
  try {
    const v = await f.main.command({ action: 'list', next: false }); const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (...args) => { const r = await original(...args); const c = r.value as typeof f.data.candidate; c.key.digest = 'd'.repeat(64); return r; });
    await expect(f.main.command({ action: 'select', selection: v.candidates[0].selection })).rejects.toMatchObject({ code: 'STALE' });
    expect(f.main.view().selected).toBeNull();
  } finally { f.main.dispose(); }
});
it('removes a selected source when refresh revokes it but another managed source remains', async () => {
  const f = fixture();
  try {
    await f.select(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => {
      const r = await original(...args);
      if (args[1].includes('/authorization?') || args[1].includes('/sources?')) r.value = JSON.parse(JSON.stringify(r.value).replaceAll('source-a','source-b'));
      if (args[1].startsWith('/v1/intake/candidates?')) r.value = { items: [], nextCursor: null };
      return r;
    });
    const view = await f.main.command({ action: 'list', next: false });
    expect(view.authorized).toBe(true); expect(view.selected).toBeNull(); expect(view.material).toBeNull();
  } finally { f.main.dispose(); }
});
it('future-phase samples cannot accumulate a draft that traps the reviewer away from the required round', async () => {
  const f = fixture();
  try {
    await f.select(); await f.main.command({ action: 'freeze' });
    await f.main.command({ action: 'quality', phase: 'expanded' });
    await expect(f.main.command({ action: 'check', scriptId: f.data.samples[0].scriptId, defect: false, reason: '' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.main.view().hasDraft).toBe(false);
    expect((await f.main.command({ action: 'quality', phase: 'initial' })).quality?.phase).toBe('initial');
  } finally { f.main.dispose(); }
});
it('does not expose revoked candidate rows while the next page is in flight', async () => {
  const f = fixture(); const original = f.request.getMockImplementation()!;
  let changed = false, release!: () => void, arrived!: () => void;
  const started = new Promise<void>(r => { arrived = r; });
  const blocked = new Promise<void>(r => { release = r; });
  f.request.mockImplementation(async (...args) => {
    const r = await original(...args);
    if (args[1].startsWith('/v1/intake/candidates?')) {
      if (changed) { arrived(); await blocked; r.value = { items: [], nextCursor: null }; }
      else (r.value as { nextCursor: string | null }).nextCursor = 'next';
    } else if (changed && (args[1].includes('/authorization?') || args[1].includes('/sources?'))) {
      r.value = JSON.parse(JSON.stringify(r.value).replaceAll('source-a','source-b'));
    }
    return r;
  });
  let next: Promise<unknown> | undefined;
  try {
    await f.main.command({ action: 'list', next: false }); changed = true;
    next = f.main.command({ action: 'list', next: true }); await started;
    expect(f.main.view()).toMatchObject({ candidates: [], moreCandidates: false });
  } finally { release(); await next; f.main.dispose(); }
});
