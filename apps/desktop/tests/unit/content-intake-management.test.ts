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

const confirm = { action: 'confirm-source', versionKind: 'opaque', versionValue: 'synthetic-export-v1', reason: '已人工核对合成来源' } as const;
const publish = { action: 'publish', title: '合成 FAQ 更新', summary: '新增合成条目' } as const;
async function ready(f: ReturnType<typeof fixture>) {
  await f.select(); await f.main.command({ action: 'material', next: false });
  await f.main.command(confirm); await f.main.command({ action: 'request-review' });
  await f.main.command({ action: 'refresh-review' });
  await f.main.command({ action: 'freeze' }); await f.main.command({ action: 'quality', phase: 'initial' });
  for (const s of f.data.samples) await f.main.command({ action: 'check', scriptId: s.scriptId, defect: false, reason: '' });
  await f.main.command({ action: 'submit' }); await f.main.command({ action: 'refresh-candidate' });
}
it('composes source/review/publication only from the selected server key, material and evidence versions', async () => {
  const f = fixture();
  try {
    await ready(f);
    expect(f.main.view()).toMatchObject({ selected: { state: 'ready' }, review: { state: 'approved' } });
    const result = await f.main.command(publish);
    expect(result).toMatchObject({ pending: null, selected: { state: 'published', publishedReleaseId: 'rel_2' }, workflowResult: { action: 'publish', state: 'published', releaseId: 'rel_2' } });
    const writes = f.request.mock.calls.filter(c => c[2]?.body);
    expect(writes.find(c => c[1].endsWith('/source-confirmation'))![2]!.body).toMatchObject({ key: f.data.candidate.key, objectSha256: 'd'.repeat(64), acquisition: 'controlled-synthetic-export', expectedEvidenceVersion: 0 });
    expect(writes.find(c => c[1].endsWith('/publish'))![2]!.body).toMatchObject({ key: f.data.candidate.key, baseReleaseId: 'rel_1', sourceEvidenceVersion: 1, approvalEvidenceVersion: 1 });
    await expect(f.main.command(publish)).rejects.toMatchObject({ code: 'CONFLICT' });
  } finally { f.main.dispose(); }
});
it('source and publication permissions are distinct from quality-review permission', async () => {
  const f = fixture(); f.data.state.confirmer = false; f.data.state.publisher = false;
  try {
    expect(await f.select()).toMatchObject({ canReview: true, canConfirmSource: false, canPublish: false });
    await f.main.command({ action: 'material', next: false });
    await expect(f.main.command(confirm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.request.mock.calls.some(c => c[2]?.body)).toBe(false);
    f.data.state.confirmer = true; f.data.state.publisher = true; f.data.state.reviewer = false;
    await f.main.command({ action: 'list', next: false });
    const v = await f.select(); expect(v).toMatchObject({ canReview: false, canConfirmSource: true, canPublish: true });
    await f.main.command({ action: 'material', next: false });
    expect((await f.main.command(confirm)).selected?.sourceEvidenceVersion).toBe(1);
  } finally { f.main.dispose(); }
});
it('lost source confirmation replays its exact original body and never invents a receipt GET', async () => {
  const f = fixture();
  try {
    await f.select(); await f.main.command({ action: 'material', next: false });
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (...args) => { await original(...args); throw new ProductHttpError('UNAVAILABLE'); });
    await expect(f.main.command(confirm)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const pending = f.main.view().pending;
    expect(pending).toMatchObject({ action: 'source-confirm', recovery: 'retry' });
    expect(f.data.candidate.sourceEvidenceVersion).toBe(1);
    await expect(f.main.command({ action: 'recover' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.main.command({ action: 'freeze' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.main.command({ action: 'retry' });
    expect(f.main.view().pending).toBeNull();
    const writes = f.request.mock.calls.filter(c => c[2]?.body); expect(writes).toHaveLength(2);
    expect(writes[0][2]!.body).toEqual(writes[1][2]!.body);
    expect(f.data.candidate.sourceEvidenceVersion).toBe(1);
    expect(f.request.mock.calls.some(c => c[1].includes('/operations/'))).toBe(false);
  } finally { f.main.dispose(); }
});
it('creating approval keeps the original operation until the same request resolves, including partial-commit authority errors', async () => {
  const f = fixture(); f.data.state.creating = true;
  try {
    await f.select(); const initial = await f.main.command({ action: 'request-review' });
    expect(initial).toMatchObject({ pending: { action: 'review-request', recovery: 'retry' }, review: { state: 'creating' } });
    const pending = initial.pending;
    await expect(f.main.command({ action: 'request-review' })).rejects.toMatchObject({ code: 'CONFLICT' });
    f.request.mockImplementationOnce(async () => { throw new ProductHttpError('FORBIDDEN'); });
    await expect(f.main.command({ action: 'retry' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.main.view().pending).toEqual(pending);
    f.data.state.creating = false;
    await f.main.command({ action: 'retry' });
    expect(f.main.view().pending).toBeNull(); expect(f.data.candidate.approvalEvidenceVersion).toBe(1);
    const writes = f.request.mock.calls.filter(c => c[2]?.body);
    expect(writes.every(c => (c[2]!.body as { operationId: string }).operationId === pending!.operationId)).toBe(true);
  } finally { f.main.dispose(); }
});
it('even the first review request rejection can follow a committed package and cannot allocate a replacement', async () => {
  const f = fixture();
  try {
    await f.select(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (...args) => { await original(...args); throw new ProductHttpError('FORBIDDEN'); });
    await expect(f.main.command({ action: 'request-review' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.data.candidate.approvalEvidenceVersion).toBe(1);
    expect(f.main.view().pending?.action).toBe('review-request');
    await f.main.command({ action: 'retry' }); expect(f.main.view().pending).toBeNull();
  } finally { f.main.dispose(); }
});
it('publication recovers only a bound terminal receipt and retains the key after missing/wrong/nonterminal results', async () => {
  const f = fixture();
  try {
    await ready(f); const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (...args) => { await original(...args); throw new ProductHttpError('UNAVAILABLE'); });
    await expect(f.main.command(publish)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const pending = f.main.view().pending;
    expect(pending).toMatchObject({ action: 'publish', recovery: 'receipt' });
    f.request.mockImplementationOnce(async () => { throw new ProductHttpError('GONE', 'COMMIT_UNKNOWN'); });
    await expect(f.main.command({ action: 'recover' })).rejects.toMatchObject({ code: 'GONE' });
    expect(f.main.view().pending).toEqual(pending);
    f.request.mockImplementationOnce(async (...args) => { const r = await original(...args); (r.value as { operationId: string }).operationId = 'wrong'; return r; });
    await expect(f.main.command({ action: 'recover' })).rejects.toMatchObject({ code: 'STALE' });
    expect(f.main.view().pending).toEqual(pending);
    f.request.mockImplementationOnce(async (...args) => { const r = await original(...args); Object.assign(r.value as object, { state: 'unknown', releaseId: null, announcementId: null }); return r; });
    await f.main.command({ action: 'recover' }); expect(f.main.view().pending).toEqual(pending);
    await f.main.command({ action: 'recover' }); expect(f.main.view().pending).toBeNull();
    await f.main.command({ action: 'list', next: false });
    expect(f.main.view().workflowResult).toMatchObject({ action: 'publish', state: 'published', releaseId: 'rel_2' });
    expect(f.request.mock.calls.filter(c => c[1].endsWith('/publish'))).toHaveLength(1);
  } finally { f.main.dispose(); }
});
it('a failed follow-up status read does not turn a confirmed publication into an unknown write', async () => {
  const f = fixture();
  try {
    await ready(f); const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(original).mockImplementationOnce(async () => { throw new ProductHttpError('UNAVAILABLE'); });
    await expect(f.main.command(publish)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.main.view()).toMatchObject({ pending: null, selected: null });
    await f.main.command({ action: 'list', next: false });
    expect(f.main.view().workflowResult).toMatchObject({ state: 'published', releaseId: 'rel_2' });
  } finally { f.main.dispose(); }
});
it('logout during a workflow response clears the memory-only operation and ignores the old response', async () => {
  const f = fixture(); let release!: () => void;
  try {
    await f.select();
    f.request.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r; }); return { status: 202, value: {} }; });
    const ongoing = f.main.command({ action: 'request-review' });
    expect(f.main.closeRisk()).toBe('pending'); f.logout(); release();
    await expect(ongoing).rejects.toMatchObject({ code: 'STALE' });
    expect(f.main.view()).toMatchObject({ signedIn: false, pending: null, selected: null, review: null });
  } finally { f.main.dispose(); }
});
it('quality drafts block workflow mutations and narrow commands reject identity, keys and evidence from renderer', async () => {
  const f = fixture();
  try {
    await f.select(); await f.main.command({ action: 'freeze' }); await f.main.command({ action: 'quality', phase: 'initial' });
    await f.main.command({ action: 'check', scriptId: f.data.samples[0].scriptId, defect: false, reason: '' });
    for (const c of [confirm, publish, { action: 'request-review' } as const, { action: 'refresh-review' } as const]) await expect(f.main.command(c)).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const c of [{ ...confirm, objectSha256: 'f'.repeat(64) }, { ...publish, key: f.data.candidate.key }, { action: 'refresh-review', expectedEvidenceVersion: 99 },
      { ...confirm, versionKind: 'integer', versionValue: '001' }, { ...publish, title: ' ' }]) expect(isIntakeManagementCommand(c)).toBe(false);
  } finally { f.main.dispose(); }
});
