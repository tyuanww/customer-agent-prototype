// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ContentIntakeManagement } from '../../src/main/content-intake-management';
import { ContentIntakeUpload } from '../../src/main/content-intake-upload';
import type { ProductSession } from '../../src/main/product-session';
import { ProductHttpError } from '../../src/main/product-http';
import { isIntakeManagementCommand } from '../../src/shared/content-intake-management';
import { intakeManagementData } from '../fixtures/intake-management-data';
function fixture(count = 2, files?: ConstructorParameters<typeof ContentIntakeManagement>[1]) {
  const data = intakeManagementData(count); let epoch = 1, signedIn = true;
  const listeners = new Set<Parameters<ProductSession['subscribe']>[0]>();
  const view: ProductSession['view'] = () => signedIn ? { ok: true, enabled: true, signedIn, sessionEpoch: epoch, userId: 'synthetic', role: 'agent', authMode: 'mock', expiresAt: '2099-01-01T00:00:00Z', displayName: '合成管理人' } : { ok: true, enabled: true, signedIn: false, sessionEpoch: epoch, userId: null, role: null, authMode: null, expiresAt: null, displayName: null };
  const request = vi.fn(async (_epoch: number, path: string, options: Parameters<ProductSession['request']>[2] = {}) => ({ status: 200, value: structuredClone(data.respond(path, options.body)) }));
  const main = new ContentIntakeManagement({ view, request, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } }, files);
  const select = async () => { const listed = await main.command({ action: 'list', next: false }); return main.command({ action: 'select', selection: listed.candidates[0].selection }); };
  return { data, main, request, select, logout: () => { signedIn = false; epoch++; listeners.forEach(f => f(view())); } };
}
it.each(['lost', 'stop-late'] as const)('recovers an uncertain upload across the manager boundary (%s), retaining original identity', async kind => {
  const bytes = Buffer.from('504b030401020304', 'hex');
  const f = fixture(2, { chooseWorkbook: async () => ({ name: 'synthetic.xlsx', bytes }), saveReport: async () => true });
  const original = f.request.getMockImplementation()!;
  const validUntil = new Date(Date.now() + 60_000).toISOString();
  const job = { jobId: 'job-a', generation: 1, state: 'reading', candidateId: null, candidateVersion: null,
    issues: [], totalIssues: 0, excludedSheetCount: 0, excludedMediaCount: 0, reportObjectId: null };
  let attempts = 0, late!: () => void;
  const operations: FormData[] = [];
  f.request.mockImplementation(async (...args) => {
    const path = args[1];
    if (path.endsWith('/management-context')) return { status: 200, value: { sourceId: 'source-a', sourceVersion: 1,
      baseReleaseId: 'rel_1', principalId: 'principal-a', factsVersion: 1, validUntil } };
    if (path.includes('/principals?')) return { status: 200, value: { items: [{ principalId: 'principal-a', displayLabel: '合成整理人', enabled: true, factsVersion: 1, validUntil }], nextCursor: null } };
    if (path.endsWith('/objects')) {
      operations.push(args[2]!.form!);
      if (++attempts === 1) {
        if (kind === 'stop-late') await new Promise<void>(resolve => { late = resolve; });
        throw new ProductHttpError('UNAVAILABLE');
      }
      return { status: 201, value: { sourceId: 'source-a', objectId: 'object-a', bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } };
    }
    if (path === '/v1/intake/sources/source-a/candidates') return { status: 202, value: job };
    const result = await original(...args);
    if (path.includes('/authorization?')) {
      const value = result.value as { capabilities: { actions: string[] }[] };
      value.capabilities.forEach(c => c.actions.push('import'));
    }
    return result;
  });
  try {
    const listed = await f.main.command({ action: 'list', next: false });
    await f.main.command({ action: 'upload-source', selection: listed.upload.sources[0].selection });
    const chosen = await f.main.command({ action: 'upload-choose' });
    const person = chosen.upload.principals[0].selection;
    const pending = f.main.command({ action: 'upload-submit', preparerSelection: person, editorSelections: [person], confirmed: true });
    const failed = expect(pending).rejects.toMatchObject({ code: kind === 'stop-late' ? 'STALE' : 'UNAVAILABLE' });
    await vi.waitFor(() => expect(attempts).toBe(1));
    if (kind === 'stop-late') await f.main.command({ action: 'upload-stop' }); else await failed;
    expect(f.main.view().upload).toMatchObject({ pending: 'upload', canRetry: true });
    await expect(f.main.command({ action: 'upload-reset' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.main.command({ action: 'select', selection: listed.candidates[0].selection })).rejects.toMatchObject({ code: 'CONFLICT' });
    const recovered = await f.main.command({ action: 'upload-retry' });
    expect(recovered.upload).toMatchObject({ phase: 'parsing', pending: null });
    await expect(f.main.command({ action: 'upload-reset' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(operations[1].get('operationId')).toEqual(operations[0].get('operationId'));
    if (kind === 'stop-late') { late(); await failed; }
    expect(f.main.view()).toMatchObject({ authorized: true, upload: { phase: 'parsing', pending: null, job: { state: 'reading' } } });
    expect(f.request.mock.calls.filter(c => c[1] === '/v1/intake/sources/source-a/candidates')).toHaveLength(1);
  } finally { f.main.dispose(); }
});
it('does not replace an opened candidate when an older upload refresh returns another candidate', async () => {
  const f = fixture();
  const other = structuredClone(f.data.candidate); other.key.candidateId = 'other-upload-candidate';
  const upload = vi.spyOn(ContentIntakeUpload.prototype, 'command').mockResolvedValue(other);
  try {
    await f.select();
    await expect(f.main.command({ action: 'upload-refresh' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.main.view().selected?.key).toEqual(f.data.candidate.key);
  } finally { upload.mockRestore(); f.main.dispose(); }
});
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

it('starts an explicit revision without accepting a renderer key or retaining old candidate evidence', async () => {
  const f = fixture(); f.data.state.importer = true;
  try {
    await f.select(); await f.main.command({ action: 'material', next: false });
    expect(isIntakeManagementCommand({ action: 'revise', expectedPriorKey: f.data.candidate.key })).toBe(false);
    const v = await f.main.command({ action: 'revise' });
    expect(v).toMatchObject({ selected: null, material: null, quality: null, review: null, candidates: [], upload: { revisionOf: { candidateId: 'candidate-a', version: 1 }, file: null } });
    expect(f.main.closeRisk()).toBe('editing');
    const listed = await f.main.command({ action: 'list', next: false });
    await expect(f.main.command({ action: 'select', selection: listed.candidates[0].selection })).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.main.command({ action: 'upload-reset' });
    expect((await f.select()).selected?.key).toEqual(f.data.candidate.key);
    expect(f.request.mock.calls.some(c => c[1].endsWith('/cancel'))).toBe(false);
  } finally { f.main.dispose(); }
});

it.each(['recover','retry'] as const)('recovers cancellation via %s with the original key and operation after response loss', async recovery => {
  const f = fixture(); f.data.state.canceller = true;
  try {
    await f.select(); await f.main.command({ action: 'material', next: false });
    const original = f.request.getMockImplementation()!; let lost = true;
    f.request.mockImplementation(async (...args) => {
      const r = await original(...args);
      if (args[1].endsWith('/cancel') && lost) { lost = false; throw new ProductHttpError('UNAVAILABLE'); }
      return r;
    });
    await expect(f.main.command({ action: 'cancel-candidate' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const pending = f.main.view().pending!;
    expect(pending).toMatchObject({ action: 'cancel', recovery: 'receipt' });
    await expect(f.main.command({ action: 'discard' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const result = await f.main.command({ action: recovery });
    expect(result.pending).toBeNull();
    await f.main.command({ action: 'list', next: false });
    const current = f.main.view();
    expect(current).toMatchObject({ selected: { state: 'cancelled' }, material: null, quality: null, review: null, canCancel: false, canRevise: false, workflowResult: { action: 'cancel', state: 'cancelled', operationId: pending.operationId } });
    expect(f.data.workflowReceipts.size).toBe(1);
    const sent = f.request.mock.calls.filter(c => c[1].endsWith('/cancel')).map(c => c[2]!.body);
    expect(sent[0]).toEqual({ operationId: pending.operationId, key: f.data.candidate.key });
    if (recovery === 'retry') expect(sent[1]).toEqual(sent[0]);
    else expect(f.request.mock.calls.some(c => c[1].endsWith(`${pending.operationId}?action=cancel`))).toBe(true);
  } finally { f.main.dispose(); }
});

it.each(['published','publishing','cancelled','invalidated'] as const)('does not offer or transmit cancellation/revision for %s', async state => {
  const f = fixture(); f.data.state.canceller = true; f.data.state.importer = true; f.data.candidate.state = state;
  try {
    expect(await f.select()).toMatchObject({ canRevise: false, canCancel: false });
    await expect(f.main.command({ action: 'cancel-candidate' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.main.command({ action: 'revise' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.request.mock.calls.some(c => c[2]?.body)).toBe(false);
  } finally { f.main.dispose(); }
});

it('rejects cancellation without scoped authority and retains an uncertain cancellation on receipt mismatch', async () => {
  const f = fixture();
  try {
    await f.select();
    await expect(f.main.command({ action: 'cancel-candidate' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.data.state.canceller = true; await f.select();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => {
      const r = await original(...args);
      if (args[1].endsWith('/cancel')) (r.value as { action: string }).action = 'publish';
      return r;
    });
    await expect(f.main.command({ action: 'cancel-candidate' })).rejects.toMatchObject({ code: 'STALE' });
    expect(f.main.view().pending).toMatchObject({ action: 'cancel' });
    f.logout(); expect(f.main.view().pending).toBeNull();
  } finally { f.main.dispose(); }
});

it('keeps a hidden revision fenced after import revocation but permits explicit local discard', async () => {
  const f = fixture(); f.data.state.importer = true;
  try {
    await f.select(); await f.main.command({ action: 'revise' });
    f.data.state.importer = false;
    const listed = await f.main.command({ action: 'list', next: false });
    expect(listed.upload.revisionOf).toBeNull();
    await expect(f.main.command({ action: 'select', selection: listed.candidates[0].selection })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.main.view().upload.canReset).toBe(true);
    await f.main.command({ action: 'upload-reset' });
    expect((await f.select()).selected).not.toBeNull();
  } finally { f.main.dispose(); }
});

it('clears local revision preparation offline after its access projection expires', async () => {
  const f = fixture(); f.data.state.importer = true;
  const clock = vi.spyOn(Date, 'now');
  try {
    await f.select(); await f.main.command({ action: 'revise' });
    clock.mockReturnValue(Date.now() + 120_000);
    expect(f.main.view()).toMatchObject({ authorized: false, upload: { canReset: true, revisionOf: null } });
    expect(f.main.closeRisk()).toBe('editing');
    f.request.mockClear(); f.request.mockRejectedValue(new ProductHttpError('UNAVAILABLE'));
    await expect(f.main.command({ action: 'upload-reset' })).resolves.toMatchObject({ upload: { pending: null, file: null, revisionOf: null } });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.main.closeRisk()).toBeNull();
  } finally { clock.mockRestore(); f.main.dispose(); }
});
it('keeps rollback recovery isolated from candidate writes, clears readable plans on failure and forgets operations on logout', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  const plan = { rollbackPlanId: 'rollback-a', impactDigest: 'a'.repeat(64), baseReleaseId: 'rel_2', targetReleaseId: 'rel_1',
    scopes: [f.data.material.materialHeader.scope], requiresCorrectiveCandidate: false, approvalEvidenceVersion: 0 };
  f.request.mockImplementation(async (...args) => {
    if (args[1].endsWith('/rollback/preview')) return { status: 200, value: plan };
    if (args[1].endsWith('/rollback/rollback-a/review')) throw new ProductHttpError('UNAVAILABLE');
    const reply = await original(...args);
    if (args[1].includes('/authorization?')) (reply.value as { capabilities: { actions: string[] }[] }).capabilities.forEach(c => c.actions.push('rollback'));
    return reply;
  });
  try {
    await f.select(); await f.main.command({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' });
    await expect(f.main.command({ action: 'rollback-request-review' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.main.view().rollback).toMatchObject({ impact: null, review: null, pending: { action: 'review-request', recovery: 'retry' } });
    expect(f.main.closeRisk()).toBe('pending');
    for (const action of ['request-review','discard','cancel-candidate'] as const) await expect(f.main.command({ action })).rejects.toMatchObject({ code: 'CONFLICT' });
    f.logout(); expect(f.main.view().rollback.pending).toBeNull(); expect(f.main.closeRisk()).toBeNull();
  } finally { f.main.dispose(); }
});
it('returns a corrective-only rollback to the existing upload path by closing the selected candidate', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (...args) => {
    if (args[1].endsWith('/rollback/preview')) return { status: 200, value: { rollbackPlanId: 'rollback-a', impactDigest: 'a'.repeat(64), baseReleaseId: 'rel_2', targetReleaseId: 'rel_1', scopes: [], requiresCorrectiveCandidate: true, approvalEvidenceVersion: 0 } };
    const reply = await original(...args);
    if (args[1].includes('/authorization?')) (reply.value as { capabilities: { actions: string[] }[] }).capabilities.forEach(c => c.actions.push('rollback'));
    return reply;
  });
  try {
    await f.select(); await f.main.command({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' });
    const result = await f.main.command({ action: 'rollback-correct' });
    expect(result.selected).toBeNull(); expect(result.rollback.impact).toBeNull();
  } finally { f.main.dispose(); }
});
