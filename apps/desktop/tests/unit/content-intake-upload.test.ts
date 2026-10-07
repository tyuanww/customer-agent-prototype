// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeUpload } from '../../src/main/content-intake-upload';
import type { IntakeAccess } from '../../src/main/content-intake-access';
import type { ProductSession } from '../../src/main/product-session';
import { ProductHttpError } from '../../src/main/product-http';
import { INTAKE_REPORT_MAX_BYTES, INTAKE_UPLOAD_MAX_BYTES, isIntakeUploadCommand } from '../../src/shared/content-intake-upload';
import { intakeManagementData } from '../fixtures/intake-management-data';

type C = components['schemas'];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const data = intakeManagementData(), bytes = Buffer.from('504b030401020304', 'hex');
  const validUntil = new Date(Date.now() + 60_000).toISOString();
  const source: C['IntakeSource'] = { scope: data.material.materialHeader.scope, version: 1, templateVersion: 'faq-p1.1',
    ruleVersion: 'intake-p1.1', mappingVersion: 'mapping-p1.1', structureDigest: 'a'.repeat(64), contentIntakeMode: 'v2-preview', modeVersion: 1 };
  const access: IntakeAccess = { validUntil, shops: ['shop-a'], sources: [source], capabilities: [{ scope: source.scope,
    actions: ['import', 'content-manage'], mayAllocate: [], mayDelegate: [], validUntil }] };
  const context: C['IntakeManagementContext'] = { sourceId: 'source-a', sourceVersion: 1, baseReleaseId: null,
    principalId: 'principal-a', factsVersion: 1, validUntil };
  const principals: C['IntakePrincipalPage'] = { items: [
    { principalId: 'principal-a', displayLabel: '合成整理人', enabled: true, factsVersion: 1, validUntil },
    { principalId: 'principal-b', displayLabel: '合成历史改稿人', enabled: false, factsVersion: 2, validUntil }], nextCursor: null };
  const object: C['IntakeObject'] = { sourceId: 'source-a', objectId: 'object-a', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const job: C['IntakeParseJob'] = { jobId: 'job-a', generation: 1, state: 'reading', candidateId: null, candidateVersion: null,
    issues: [], totalIssues: 0, excludedSheetCount: 0, excludedMediaCount: 0, reportObjectId: null };
  let epoch = 1, signedIn = true;
  const listeners = new Set<Parameters<ProductSession['subscribe']>[0]>();
  const view: ProductSession['view'] = () => signedIn ? { ok: true, enabled: true, signedIn: true, sessionEpoch: epoch,
    userId: 'user-not-principal-a', role: 'agent', authMode: 'mock', expiresAt: validUntil, displayName: '合成用户' }
    : { ok: true, enabled: true, signedIn: false, sessionEpoch: epoch, userId: null, role: null, authMode: null, expiresAt: null, displayName: null };
  const request = vi.fn(async (_epoch: number, path: string, _options: Parameters<ProductSession['request']>[2] = {}) => {
    const p = new URL(path, 'http://127.0.0.1').pathname;
    const value = p.endsWith('/management-context') ? context : p.endsWith('/principals') ? principals
      : p.endsWith('/objects') ? object : p.endsWith('/candidates') ? job : p.endsWith('/report') ? bytes
      : p.includes('/parse-jobs/') ? job : p.endsWith('/versions/1') ? data.candidate : undefined;
    if (value === undefined) throw new Error(`Unexpected fixture path ${p}`);
    return { status: 200, value: Buffer.isBuffer(value) ? Buffer.from(value) : structuredClone(value) };
  });
  const chooseWorkbook = vi.fn(async (): Promise<{ name: string; bytes: Buffer } | null> => ({ name: 'synthetic.xlsx', bytes }));
  const saveReport = vi.fn(async (_bytes: Buffer, _signal: AbortSignal) => true);
  const main = new ContentIntakeUpload({ view, request, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } }, { chooseWorkbook, saveReport });
  const select = () => main.command({ action: 'upload-source', selection: main.view(access).sources[0].selection }, access);
  const choose = async () => { await select(); await main.command({ action: 'upload-choose' }, access); };
  const submit = () => {
    const v = main.view(access); return main.command({ action: 'upload-submit', preparerSelection: v.principals[0].selection,
      editorSelections: v.principals.map(p => p.selection), confirmed: true }, access);
  };
  const logout = () => { signedIn = false; epoch++; listeners.forEach(f => f(view())); };
  return { main, request, access, context, principals, object, job, data, bytes, chooseWorkbook, saveReport, choose, select, submit, logout };
}

it('uploads original bytes with opaque choices, permits disabled contributors, explicitly refreshes a validated candidate', async () => {
  const f = fixture();
  try {
    await f.choose(); expect(f.request.mock.calls.every(c => !c[2]?.body && !c[2]?.form)).toBe(true);
    const v = f.main.view(f.access); expect(v).toMatchObject({ phase: 'confirming', confirmed: false, canSubmit: true });
    expect(JSON.stringify(v)).not.toContain('principal-a'); expect(JSON.stringify(v)).not.toContain('user-not-principal-a');
    await f.submit(); expect(f.main.view(f.access)).toMatchObject({ phase: 'parsing', pending: null, job: { state: 'reading' } });
    const upload = f.request.mock.calls.find(c => c[1].endsWith('/objects'))![2]!.form!;
    expect(upload.get('operationId')).toMatch(/^[0-9a-f-]{36}$/);
    expect(Buffer.from(await (upload.get('file') as File).arrayBuffer())).toEqual(f.bytes);
    const body = f.request.mock.calls.find(c => c[1].endsWith('/candidates'))![2]!.body as C['IntakeReceive'];
    expect(body).toMatchObject({ sourceVersion: 1, baseReleaseId: null, expectedPriorKey: null,
      contributorDeclaration: { preparerPrincipalId: 'principal-a', editorPrincipalIds: ['principal-a','principal-b'], confirmed: true } });
    Object.assign(f.job, { state: 'validated', generation: 2, candidateId: 'candidate-a', candidateVersion: 1 });
    expect(await f.main.command({ action: 'upload-refresh' }, f.access)).toEqual(f.data.candidate);
    expect(f.main.view(f.access)).toMatchObject({ phase: 'validated', canOpen: true, canRefresh: false });
  } finally { f.main.dispose(); }
});

it('retains exact upload bytes and identity after lost response, then receives once on replay', async () => {
  const f = fixture();
  try {
    await f.choose(); const original = f.request.getMockImplementation()!; let lost = true;
    f.request.mockImplementation(async (...args) => { const value = await original(...args); if (args[1].endsWith('/objects') && lost) { lost = false; throw new ProductHttpError('UNAVAILABLE'); } return value; });
    await expect(f.submit()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.main.view(f.access)).toMatchObject({ phase: 'unknown', pending: 'upload', canRetry: true });
    expect(f.main.closeRisk()).toBe('pending');
    await expect(f.main.command({ action: 'upload-reset' }, f.access)).rejects.toMatchObject({ code: 'CONFLICT' });
    f.bytes.fill(9); // the port's mutable buffer cannot alter retained bytes
    await f.main.command({ action: 'upload-retry' }, f.access);
    const forms = f.request.mock.calls.filter(c => c[1].endsWith('/objects')).map(c => c[2]!.form!);
    expect(forms[0].get('operationId')).toBe(forms[1].get('operationId'));
    expect(await (forms[0].get('file') as File).arrayBuffer()).toEqual(await (forms[1].get('file') as File).arrayBuffer());
    expect(f.request.mock.calls.filter(c => c[1].endsWith('/candidates'))).toHaveLength(1);
  } finally { f.main.dispose(); }
});

it('replays an unknown receive with its original body even after context changes; does not claim a job was cancelled', async () => {
  const f = fixture();
  try {
    await f.choose(); const original = f.request.getMockImplementation()!; let lost = true;
    f.request.mockImplementation(async (...args) => { const value = await original(...args); if (args[1].endsWith('/candidates') && lost) { lost = false; throw new ProductHttpError('UNAVAILABLE'); } return value; });
    await expect(f.submit()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const body = structuredClone(f.request.mock.calls.find(c => c[1].endsWith('/candidates'))![2]!.body);
    f.context.baseReleaseId = 'rel-changed'; f.context.sourceVersion++;
    f.main.invalidate(false); expect(f.main.view(null)).toMatchObject({ file: null, principals: [], job: null, pending: 'receive' });
    await f.main.command({ action: 'upload-retry' }, f.access);
    expect(f.request.mock.calls.filter(c => c[1].endsWith('/candidates'))[1][2]!.body).toEqual(body);
    await f.main.command({ action: 'upload-stop' }, f.access);
    expect(f.main.view(f.access).job!.state).toBe('reading');
    expect(f.request.mock.calls.some(c => c[1].endsWith('/cancel'))).toBe(false);
  } finally { f.main.dispose(); }
});

it.each(['sourceVersion','baseReleaseId','principalId','factsVersion'] as const)('requires new confirmation before upload if %s changed', async field => {
  const f = fixture();
  try {
    await f.choose(); const revision = f.main.view(f.access).draftRevision;
    if (field === 'baseReleaseId') f.context.baseReleaseId = 'rel-changed';
    else if (field === 'principalId') { f.context.principalId = 'principal-changed'; f.principals.items[0].principalId = f.context.principalId; }
    else if (field === 'factsVersion') { f.context.factsVersion++; f.principals.items[0].factsVersion++; }
    else f.context.sourceVersion++;
    expect(await f.submit()).toBeNull();
    expect(f.main.view(f.access)).toMatchObject({ phase: 'confirming', confirmed: false, pending: null });
    expect(f.main.view(f.access).draftRevision).toBeGreaterThan(revision);
    expect(f.request.mock.calls.some(c => c[2]?.form || c[2]?.body)).toBe(false);
  } finally { f.main.dispose(); }
});

it('rechecks the base after upload before receive and retains uploaded object for reconfirmation', async () => {
  const f = fixture();
  try {
    await f.choose(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => { const r = await original(...args); if (args[1].endsWith('/objects')) f.context.baseReleaseId = 'rel-new'; return r; });
    await f.submit(); expect(f.main.view(f.access)).toMatchObject({ phase: 'confirming', confirmed: false });
    expect(f.request.mock.calls.some(c => c[1].endsWith('/candidates'))).toBe(false);
    await f.submit();
    expect(f.request.mock.calls.filter(c => c[1].endsWith('/objects'))).toHaveLength(1);
    expect(f.request.mock.calls.find(c => c[1].endsWith('/candidates'))![2]!.body).toMatchObject({ baseReleaseId: 'rel-new' });
  } finally { f.main.dispose(); }
});

it('reads complete bounded principal pages including empty filtered pages without inventing labels', async () => {
  const f = fixture();
  try {
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => {
      if (!args[1].includes('/principals?')) return original(...args);
      const q = new URL(args[1], 'http://127.0.0.1').searchParams;
      expect(q.get('sourceId')).toBe('source-a'); expect(q.get('purpose')).toBe('contributor'); expect(q.get('limit')).toBe('100');
      const page = !q.has('cursor') ? { items: [], nextCursor: 'empty-cursor' }
        : q.get('cursor') === 'empty-cursor' ? { items: [f.principals.items[0]], nextCursor: 'last-cursor' }
        : { items: [f.principals.items[1]], nextCursor: null };
      return { status: 200, value: page };
    });
    await f.choose(); expect(f.main.view(f.access).principals.map(p => p.displayLabel)).toEqual(['合成整理人','合成历史改稿人']);
  } finally { f.main.dispose(); }
});

it.each(['repeated-cursor','duplicate-principal','too-many-pages'])('fails closed without partial directory on %s', async scenario => {
  const f = fixture();
  try {
    const original = f.request.getMockImplementation()!; let pages = 0;
    f.request.mockImplementation(async (...args) => {
      if (!args[1].includes('/principals?')) return original(...args);
      pages++;
      const item = { ...f.principals.items[0] };
      return { status: 200, value: { items: scenario === 'repeated-cursor' || scenario === 'too-many-pages' ? [] : [item],
        nextCursor: scenario === 'repeated-cursor' ? 'same' : `page-${pages}` } };
    });
    await expect(f.choose()).rejects.toBeInstanceOf(ProductHttpError);
    expect(f.main.view(f.access).principals).toEqual([]); expect(f.main.view(f.access).canSubmit).toBe(false);
    expect(pages).toBeLessThanOrEqual(50);
  } finally { f.main.dispose(); }
});

it('stops an in-flight receive, retains identity and ignores its late success until explicit replay', async () => {
  const f = fixture();
  try {
    await f.choose(); const original = f.request.getMockImplementation()!, arrived = deferred<void>(), release = deferred<void>();
    f.request.mockImplementation(async (...args) => { const r = await original(...args); if (args[1].endsWith('/candidates')) { arrived.resolve(); await release.promise; } return r; });
    const running = f.submit(), rejected = expect(running).rejects.toMatchObject({ code: 'STALE' });
    await arrived.promise; await f.main.command({ action: 'upload-stop' }, f.access);
    expect(f.main.view(f.access)).toMatchObject({ phase: 'unknown', pending: 'receive', busy: false, job: null });
    release.resolve(); await rejected;
    expect(f.main.view(f.access)).toMatchObject({ phase: 'unknown', pending: 'receive', job: null });
    await f.main.command({ action: 'upload-retry' }, f.access); expect(f.main.view(f.access).job?.state).toBe('reading');
  } finally { f.main.dispose(); }
});

it.each(['choose','upload','receive','report'] as const)('logout drops late %s and cannot restore material, pending operation or save dialog', async stage => {
  const f = fixture();
  try {
    const arrived = deferred<void>(), release = deferred<void>(); let running: Promise<unknown>;
    if (stage === 'choose') {
      await f.select(); f.chooseWorkbook.mockImplementation(async () => { arrived.resolve(); await release.promise; return { name: 'synthetic.xlsx', bytes: f.bytes }; });
      running = f.main.command({ action: 'upload-choose' }, f.access);
    } else {
      await f.choose();
      if (stage === 'report') { await f.submit(); Object.assign(f.job, { state: 'failed', generation: 2, reportObjectId: 'report-a' }); await f.main.command({ action: 'upload-refresh' }, f.access); }
      const original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (...args) => { const r = await original(...args);
        if (args[1].endsWith(stage === 'upload' ? '/objects' : stage === 'receive' ? '/candidates' : '/report')) { arrived.resolve(); await release.promise; } return r; });
      running = stage === 'report' ? f.main.command({ action: 'upload-save-report' }, f.access) : f.submit();
    }
    const rejection = expect(running).rejects.toMatchObject({ code: 'STALE' }); await arrived.promise; f.logout(); release.resolve(); await rejection;
    expect(f.main.view(f.access)).toMatchObject({ phase: 'idle', file: null, principals: [], pending: null, job: null });
    expect(f.main.closeRisk()).toBeNull(); expect(f.saveReport).not.toHaveBeenCalled();
  } finally { f.main.dispose(); }
});

it('same-name same-size reselection resets confirmation while dialog cancel keeps the draft revision', async () => {
  const f = fixture();
  try {
    await f.choose(); const first = f.main.view(f.access);
    f.chooseWorkbook.mockResolvedValueOnce(null); await f.main.command({ action: 'upload-choose' }, f.access);
    expect(f.main.view(f.access).draftRevision).toBe(first.draftRevision);
    const changed = Buffer.from(f.bytes); changed[4]++;
    f.chooseWorkbook.mockResolvedValueOnce({ name: 'synthetic.xlsx', bytes: changed }); await f.main.command({ action: 'upload-choose' }, f.access);
    expect(f.main.view(f.access).draftRevision).toBeGreaterThan(first.draftRevision);
    expect(f.main.view(f.access).principals[0].selection).not.toBe(first.principals[0].selection);
  } finally { f.main.dispose(); }
});

it('keeps validated parse outcome if candidate reading fails, then recovers it without a new POST', async () => {
  const f = fixture();
  try {
    await f.choose(); await f.submit(); Object.assign(f.job, { state: 'validated', generation: 2, candidateId: 'candidate-a', candidateVersion: 1 });
    const original = f.request.getMockImplementation()!; let lost = true;
    f.request.mockImplementation(async (...args) => { if (args[1].includes('/versions/') && lost) { lost = false; throw new ProductHttpError('UNAVAILABLE'); } return original(...args); });
    await expect(f.main.command({ action: 'upload-refresh' }, f.access)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.main.view(f.access)).toMatchObject({ pending: null, canOpen: true, canRefresh: false, phase: 'validated' });
    expect(await f.main.command({ action: 'upload-open' }, f.access)).toEqual(f.data.candidate);
    expect(f.request.mock.calls.filter(c => c[1].endsWith('/candidates'))).toHaveLength(1);
  } finally { f.main.dispose(); }
});

it('projects report coordinates and saves only a bounded XLSX through the native port', async () => {
  const f = fixture();
  try {
    await f.choose(); await f.submit(); Object.assign(f.job, { state: 'failed', generation: 2, reportObjectId: 'report-a', totalIssues: 120,
      excludedSheetCount: 2, excludedMediaCount: 3, issues: [{ code: 'ANSWER_REQUIRED', message: '合成错误', location: { sheet: 'FAQ话术', row: 2, column: 4 } }] });
    await f.main.command({ action: 'upload-refresh' }, f.access);
    expect(f.main.view(f.access)).toMatchObject({ phase: 'failed', canSaveReport: true, canChoose: true, job: { totalIssues: 120, excludedSheetCount: 2, excludedMediaCount: 3 } });
    await f.main.command({ action: 'upload-save-report' }, f.access);
    expect(f.request.mock.calls.at(-1)![2]).toMatchObject({ responseType: 'xlsx', maxResponseBytes: INTAKE_REPORT_MAX_BYTES });
    expect(f.saveReport).toHaveBeenCalledWith(f.bytes, expect.any(AbortSignal));
    expect(f.main.view(f.access).notice).toBe('完整校验报告已保存。');
  } finally { f.main.dispose(); }
});

it('permission loss blocks reads and upload, hides file and people, and does not grant from a legacy owner role', async () => {
  const f = fixture();
  try {
    await f.choose(); f.access.capabilities[0].actions = ['query']; const count = f.request.mock.calls.length;
    expect(f.main.view(f.access)).toMatchObject({ authorized: false, file: null, principals: [], job: null, canSubmit: false });
    await expect(f.main.command({ action: 'upload-refresh' }, f.access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.request.mock.calls).toHaveLength(count);
  } finally { f.main.dispose(); }
});

it('rejects file paths, oversized or non-XLSX payloads and untrusted command identity/body fields', async () => {
  const f = fixture();
  try {
    await f.select();
    for (const file of [{ name: '/private/synthetic.xlsx', bytes: f.bytes }, { name: 'synthetic.xlsx', bytes: Buffer.alloc(INTAKE_UPLOAD_MAX_BYTES + 1) }, { name: 'synthetic.xlsx', bytes: Buffer.from('not-a-zip') }]) {
      f.chooseWorkbook.mockResolvedValueOnce(file);
      await expect(f.main.command({ action: 'upload-choose' }, f.access)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect(f.request).not.toHaveBeenCalled();
    for (const raw of [{ action: 'upload-submit', preparerSelection: 'p', editorSelections: ['p'], confirmed: false },
      { action: 'upload-submit', preparerSelection: 'p', editorSelections: ['p','p'], confirmed: true },
      { action: 'upload-choose', path: '/private/x.xlsx' }, { action: 'upload-retry', operationId: 'forged' }]) expect(isIntakeUploadCommand(raw)).toBe(false);
  } finally { f.main.dispose(); }
});

it('allows an uncertain-write recovery intent while access is hidden, but command still requires refreshed import access', async () => {
  const f = fixture();
  try {
    await f.choose(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => { if (args[1].endsWith('/candidates')) throw new ProductHttpError('UNAVAILABLE'); return original(...args); });
    await expect(f.submit()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    f.main.invalidate(false);
    expect(f.main.view(null)).toMatchObject({ pending: 'receive', canRetry: true, file: null, principals: [] });
    const count = f.request.mock.calls.length;
    await expect(f.main.command({ action: 'upload-retry' }, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.request.mock.calls).toHaveLength(count);
    f.request.mockImplementation(original); await f.main.command({ action: 'upload-retry' }, f.access);
    expect(f.main.view(f.access)).toMatchObject({ pending: null, job: { state: 'reading' } });
  } finally { f.main.dispose(); }
});

it('an import-only principal completes parsing without requesting candidate material', async () => {
  const f = fixture(); f.access.capabilities[0].actions = ['import'];
  try {
    await f.choose(); await f.submit(); Object.assign(f.job, { state: 'validated', generation: 2, candidateId: 'candidate-a', candidateVersion: 1 });
    expect(await f.main.command({ action: 'upload-refresh' }, f.access)).toBeNull();
    expect(f.main.view(f.access)).toMatchObject({ phase: 'validated', canOpen: false }); expect(f.main.closeRisk()).toBeNull();
    await f.main.command({ action: 'upload-stop' }, f.access); expect(f.main.closeRisk()).toBeNull();
    await expect(f.main.command({ action: 'upload-open' }, f.access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.request.mock.calls.some(c => c[1].includes('/versions/'))).toBe(false);
  } finally { f.main.dispose(); }
});

it('does not clear an uncertain stopped operation after a late definitive rejection', async () => {
  const f = fixture();
  try {
    await f.choose(); const original = f.request.getMockImplementation()!, arrived = deferred<void>(), release = deferred<void>();
    f.request.mockImplementation(async (...args) => { if (args[1].endsWith('/candidates')) { arrived.resolve(); await release.promise; throw new ProductHttpError('VALIDATION', 'BASE_CHANGED'); } return original(...args); });
    const running = f.submit(), rejected = expect(running).rejects.toMatchObject({ code: 'STALE' });
    await arrived.promise; await f.main.command({ action: 'upload-stop' }, f.access); release.resolve(); await rejected;
    expect(f.main.view(f.access)).toMatchObject({ phase: 'unknown', pending: 'receive' });
  } finally { f.main.dispose(); }
});

it('keeps an uncertain replay identity when permission is denied later, and rejects a different-source object', async () => {
  const f = fixture();
  try {
    await f.choose(); f.object.sourceId = 'source-b';
    await expect(f.submit()).rejects.toMatchObject({ code: 'STALE' });
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => { if (args[1].endsWith('/objects')) throw new ProductHttpError('FORBIDDEN'); return original(...args); });
    await expect(f.main.command({ action: 'upload-retry' }, f.access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.main.view(f.access)).toMatchObject({ pending: 'upload', canRetry: true });
  } finally { f.main.dispose(); }
});

it('expires declaration choices before submit and refreshes them without sending a write', async () => {
  const f = fixture();
  try {
    await f.choose(); const command = { action: 'upload-submit' as const, preparerSelection: f.main.view(f.access).principals[0].selection,
      editorSelections: [f.main.view(f.access).principals[0].selection], confirmed: true as const };
    const time = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      expect(f.main.view(f.access)).toMatchObject({ file: null, principals: [], canSubmit: false });
      await expect(f.main.command(command, f.access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(f.request.mock.calls.some(c => c[2]?.form || c[2]?.body)).toBe(false);
    } finally { time.mockRestore(); }
  } finally { f.main.dispose(); }
});

it('rejects decreasing job generations and a cross-candidate response while retaining its accepted job', async () => {
  const f = fixture();
  try {
    await f.choose(); await f.submit(); Object.assign(f.job, { state: 'parsing', generation: 3 }); await f.main.command({ action: 'upload-refresh' }, f.access);
    Object.assign(f.job, { generation: 2 }); await expect(f.main.command({ action: 'upload-refresh' }, f.access)).rejects.toMatchObject({ code: 'STALE' });
    expect(f.main.view(f.access).job!.state).toBe('parsing');
    Object.assign(f.job, { state: 'validated', generation: 4, candidateId: 'candidate-a', candidateVersion: 1 }); f.data.candidate.sourceId = 'source-b';
    await expect(f.main.command({ action: 'upload-refresh' }, f.access)).rejects.toMatchObject({ code: 'STALE' });
    expect(f.main.view(f.access)).toMatchObject({ phase: 'validated', pending: null });
  } finally { f.main.dispose(); }
});

it('accepts all 100 legal maximum-length issues within an explicit job JSON budget', async () => {
  const f = fixture();
  try {
    await f.choose(); await f.submit();
    Object.assign(f.job, { state: 'failed', generation: 2, totalIssues: 100, reportObjectId: 'report-a',
      issues: Array.from({ length: 100 }, () => ({ code: '\u0001'.repeat(64), message: '\u0001'.repeat(512),
        location: { sheet: '\u0001'.repeat(64), row: 5002, column: 32 } })) });
    const bytes = Buffer.byteLength(JSON.stringify(f.job)); expect(bytes).toBeGreaterThan(65_536);
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (...args) => {
      const r = await original(...args);
      if (args[1].includes('/parse-jobs/')) expect(args[2]!.maxResponseBytes).toBeGreaterThanOrEqual(bytes);
      return r;
    });
    await f.main.command({ action: 'upload-refresh' }, f.access);
    expect(f.main.view(f.access).job!.issues).toHaveLength(100);
  } finally { f.main.dispose(); }
});


it('declares a disabled historical contributor whose target facts expired without treating those facts as upload authority', async () => {
  const f = fixture();
  try {
    f.principals.items[1].validUntil = '2000-01-01T00:00:00Z';
    await f.choose();
    const v = f.main.view(f.access), historical = v.principals[1];
    expect(historical).toMatchObject({ displayLabel: '合成历史改稿人', enabled: false });
    expect(v).toMatchObject({ canSubmit: true, validUntil: f.context.validUntil });
    await f.main.command({ action: 'upload-submit', preparerSelection: historical.selection,
      editorSelections: v.principals.map(p => p.selection), confirmed: true }, f.access);
    expect(f.request.mock.calls.find(c => c[1].endsWith('/candidates'))![2]!.body).toMatchObject({
      contributorDeclaration: { preparerPrincipalId: 'principal-b', editorPrincipalIds: ['principal-a', 'principal-b'], confirmed: true },
    });
    expect(f.main.view(f.access)).toMatchObject({ phase: 'parsing', pending: null });
  } finally { f.main.dispose(); }
});

it('still rejects an expired current-caller context and a directory whose self mapping version differs', async () => {
  for (const scenario of ['caller-expired', 'self-version']) {
    const f = fixture();
    try {
      f.principals.items[1].validUntil = '2000-01-01T00:00:00Z';
      if (scenario === 'caller-expired') f.context.validUntil = '2000-01-01T00:00:00Z';
      else f.principals.items[0].factsVersion++;
      await expect(f.choose()).rejects.toMatchObject({ code: 'STALE' });
      expect(f.main.view(f.access)).toMatchObject({ canSubmit: false, principals: [] });
      expect(f.request.mock.calls.some(c => c[2]?.form || c[2]?.body)).toBe(false);
    } finally { f.main.dispose(); }
  }
});
