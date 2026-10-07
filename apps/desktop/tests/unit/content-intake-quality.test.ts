// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeQuality } from '../../src/main/content-intake-quality';
import { ProductHttpError } from '../../src/main/product-http';
import type { ProductSession } from '../../src/main/product-session';

type C = components['schemas'];
const key: C['IntakeCandidateKey'] = { candidateId: 'candidate-a', version: 1, digest: 'a'.repeat(64) };
const id = (index: number) => `intake_${index.toString(16).padStart(64, '0')}`;
const check = (id: string): C['IntakeQualityCheck'] => ({ scriptId: id, contentHash: 'b'.repeat(64), defect: false, reason: '' });
function fixture(count = 2) {
  let epoch = 1;
  const listeners = new Set<Parameters<ProductSession['subscribe']>[0]>();
  const attribution = { principalId: 'reviewer', factsVersion: 1, recordedAt: '2026-01-01T00:00:00Z' };
  const status: C['IntakeQualityStatus'] = { key, viewHash: 'c'.repeat(64), state: 'initial_required', frozen: attribution, rounds: [],
    plan: { policyVersion: 'intake-quality-v1', ordinaryCount: count, mandatoryCount: 0, withdrawalCount: 0,
      initialTarget: count, expandedTarget: count, initialCount: count, expandedCount: count,
      seedHash: 'a'.repeat(64), populationManifestHash: 'b'.repeat(64), selectionManifestHash: 'c'.repeat(64) } };
  const samples: C['IntakeQualitySample'][] = Array.from({ length: count }, (_, i) => ({ scriptId: id(i), contentHash: 'b'.repeat(64), mandatory: false, check: null,
    entry: { businessEntryId: `entry-${i}`, scriptVersion: 1, operation: 'upsert', title: '合成标题', answerText: '第一行\n第二行',
      questions: [], productRefs: [], scenarioRefs: [], effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: null, applicabilityNote: '',
      familySourceId: null, familyBusinessEntryId: null, brandNonOverridable: false, category: '', internalNote: '合成内部说明', riskNote: '', attachmentNote: '' } }));
  const receipts = new Map<string, C['IntakeQualityReceipt']>();
  const respond = async (_epoch: number, path: string, options: Parameters<ProductSession['request']>[2] = {}) => {
    const url = new URL(path, 'http://127.0.0.1');
    let value: unknown;
    if (options.body) {
      const body = options.body as C['IntakeQualitySubmission'];
      const action = path.endsWith('/freeze') ? 'quality-freeze' : 'quality-check';
      const r: C['IntakeQualityReceipt'] = { operationId: body.operationId, key: body.key, action, phase: action === 'quality-freeze' ? null : body.phase,
        state: action === 'quality-freeze' ? 'initial_required' : 'passed' };
      receipts.set(body.operationId, r); value = r;
    } else if (path.includes('/operations/')) {
      value = receipts.get(url.pathname.split('/').at(-1)!);
      if (!value) throw new ProductHttpError('GONE', 'COMMIT_UNKNOWN');
    } else if (url.pathname.endsWith('/samples')) {
      const index = Number(url.searchParams.get('cursor') ?? 0);
      value = { key, viewHash: status.viewHash, phase: url.searchParams.get('phase'), selectionManifestHash: status.plan.selectionManifestHash,
        items: samples.slice(index, index + 1), nextCursor: index + 1 < samples.length ? String(index + 1) : null };
    } else value = status;
    return { status: 200, value: structuredClone(value) };
  };
  const request = vi.fn(respond);
  const session: Pick<ProductSession, 'view' | 'subscribe' | 'request'> = { request,
    view: () => ({ ok: true, enabled: true, signedIn: true, sessionEpoch: epoch, userId: 'synthetic-reviewer', role: 'coach', authMode: 'mock', expiresAt: '2099-01-01T00:00:00Z', displayName: '合成审核人' }),
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const main = new ContentIntakeQuality(session); main.select(key);
  const relogin = () => { epoch++; listeners.forEach(f => f(session.view())); };
  return { main, status, samples, receipts, request, respond, relogin, listeners };
}

describe('Main quality workflow', () => {
  it('assembles all samples, requires every human check and owns hashes/operation keys', async () => {
    const f = fixture();
    const view = await f.main.refresh('initial');
    expect(view.samples).toHaveLength(2); expect(view.samples[0].entry.answerText).toBe('第一行\n第二行');
    view.samples[0].contentHash = 'f'.repeat(64); view.status.key.digest = 'f'.repeat(64);
    await expect(f.main.submit()).rejects.toMatchObject({ code: 'VALIDATION' });
    f.main.setCheck(id(0), false, '😀'.repeat(1000)); f.main.setCheck(id(1), true, '人工记录问题');
    expect(() => f.main.setCheck(id(1), true, ' ')).toThrow();
    expect(() => f.main.setCheck(id(1), false, '\ud800')).toThrow();
    expect(() => f.main.setCheck(id(1), false, '😀'.repeat(1001))).toThrow();
    expect(await f.main.submit()).toMatchObject({ state: 'passed', key });
    const body = f.request.mock.calls.at(-1)![2]!.body as C['IntakeQualitySubmission'];
    expect(body.checks.map(c => c.contentHash)).toEqual(['b'.repeat(64), 'b'.repeat(64)]);
    expect(Object.keys(body).sort()).toEqual(['checks', 'key', 'operationId', 'phase']);
    expect(f.main.current()).toBeNull(); expect(f.main.unresolved()).toBeNull(); f.main.dispose();
  });

  it.each(['duplicate', 'missing', 'phase', 'manifest', 'key', 'check-hash', 'cycle', 'changed'])(
    'rejects %s reads without a partial view', async failure => {
      const f = fixture(); let reads = 0;
      f.request.mockImplementation(async (...args) => {
        const r = await f.respond(...args);
        if (args[1].includes('/samples?')) {
          const p = r.value as C['IntakeQualitySamplePage'];
          if (failure === 'duplicate' && p.items[0]?.scriptId === id(1)) p.items = [structuredClone(f.samples[0])];
          if (failure === 'missing') { p.items = []; p.nextCursor = null; }
          if (failure === 'phase') p.phase = 'expanded';
          if (failure === 'manifest') p.selectionManifestHash = 'd'.repeat(64);
          if (failure === 'key') p.key.version++;
          if (failure === 'check-hash') p.items[0].check = { ...check(p.items[0].scriptId), contentHash: 'd'.repeat(64) };
          if (failure === 'cycle') p.nextCursor = '1';
        } else if (++reads > 1 && failure === 'changed') (r.value as C['IntakeQualityStatus']).viewHash = 'd'.repeat(64);
        return r;
      });
      await expect(f.main.refresh('initial')).rejects.toMatchObject({ code: 'STALE' });
      expect(f.main.current()).toBeNull(); f.main.dispose();
    });

  it('retains immutable initial checks during expansion and handles an explicit empty round', async () => {
    const f = fixture(); f.status.state = 'expansion_required';
    f.status.rounds = [{ phase: 'initial', reviewer: f.status.frozen!, checkedCount: 2, defectCount: 2 }];
    f.samples[0].check = check(id(0));
    await f.main.refresh('expanded');
    expect(() => f.main.setCheck(id(0), true, 'cannot edit')).toThrow('操作');
    f.main.setCheck(id(1), false, '');
    expect(await f.main.submit()).toMatchObject({ phase: 'expanded' }); f.main.dispose();
    const empty = fixture(0); await empty.main.refresh('initial');
    expect(await empty.main.submit()).toMatchObject({ phase: 'initial' });
    expect((empty.request.mock.calls.at(-1)![2]!.body as C['IntakeQualitySubmission']).checks).toEqual([]); empty.main.dispose();
  });

  it('recovers a lost committed response without a new write or using historical state as current', async () => {
    const f = fixture();
    f.request.mockImplementationOnce(async (...args) => { await f.respond(...args); throw new ProductHttpError('UNAVAILABLE'); });
    await expect(f.main.freeze()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const pending = f.main.unresolved()!;
    await expect(f.main.freeze()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(() => f.main.select({ ...key, version: 2 })).toThrow();
    const receipt = await f.main.recover();
    expect(receipt.operationId).toBe(pending.operationId); expect(f.request.mock.calls.filter(c => c[2]?.body)).toHaveLength(1);
    expect(f.main.current()).toBeNull(); expect(f.main.unresolved()).toBeNull(); f.main.dispose();
  });

  it('keeps missing receipts unresolved and retries exact bytes even after a denied retry', async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new ProductHttpError('UNAVAILABLE'));
    await expect(f.main.freeze()).rejects.toThrow();
    const first = structuredClone(f.request.mock.calls[0][2]?.body), pending = f.main.unresolved();
    await expect(f.main.recover()).rejects.toMatchObject({ reason: 'COMMIT_UNKNOWN' });
    expect(f.main.unresolved()).toEqual(pending);
    f.request.mockRejectedValueOnce(new ProductHttpError('FORBIDDEN'));
    await expect(f.main.retry()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.main.unresolved()).toEqual(pending);
    await f.main.retry(); expect(f.request.mock.calls.at(-1)![2]?.body).toEqual(first); f.main.dispose();
  });

  it.each(['key', 'phase', 'operationId'] as const)('preserves recovery after a mismatched %s receipt', async field => {
    const f = fixture();
    f.request.mockImplementationOnce(async (...args) => {
      const r = await f.respond(...args), receipt = r.value as C['IntakeQualityReceipt'];
      if (field === 'key') receipt.key.version++;
      else if (field === 'phase') receipt.phase = 'initial';
      else receipt.operationId = 'another-operation';
      return r;
    });
    await expect(f.main.freeze()).rejects.toThrow(); expect(f.main.unresolved()).not.toBeNull();
    await f.main.recover(); expect(f.main.unresolved()).toBeNull(); f.main.dispose();
  });

  it('rejects a late prior identity response without erasing the new identity view', async () => {
    const f = fixture(); let release!: () => void;
    f.request.mockImplementationOnce(async (...args) => { await new Promise<void>(r => { release = r; }); return f.respond(...args); });
    const old = f.main.refresh('initial'); const failed = expect(old).rejects.toMatchObject({ code: 'STALE' });
    f.relogin(); f.main.select(key); await f.main.refresh('initial');
    release(); await failed; expect(f.main.current()?.samples).toHaveLength(2); f.main.dispose(); expect(f.listeners.size).toBe(0);
  });

  it('clears content after cancellation/denial and clears unresolved state after identity replacement', async () => {
    const f = fixture(); await f.main.refresh('initial');
    let release!: () => void;
    f.request.mockImplementationOnce(async (...args) => { await new Promise<void>(r => { release = r; }); return f.respond(...args); });
    const read = f.main.refresh('initial'); const failed = expect(read).rejects.toMatchObject({ code: 'STALE' });
    f.main.cancelRead(); release(); await failed; expect(f.main.current()).toBeNull();
    f.request.mockRejectedValueOnce(new ProductHttpError('GONE'));
    await expect(f.main.refresh('initial')).rejects.toMatchObject({ code: 'GONE' });
    f.request.mockRejectedValueOnce(new ProductHttpError('UNAVAILABLE'));
    await expect(f.main.freeze()).rejects.toThrow(); f.relogin(); expect(f.main.unresolved()).toBeNull();
    await expect(f.main.refresh('initial')).rejects.toMatchObject({ code: 'STALE' }); f.main.dispose();
  });

  it('allows correction after a definitive first rejection but never erases a new session operation', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new ProductHttpError('VALIDATION', 'FILE_LIMIT'));
    await expect(f.main.freeze()).rejects.toMatchObject({ reason: 'FILE_LIMIT' });
    expect(f.main.unresolved()).toBeNull();
    let release!: () => void;
    f.request.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r; }); throw new ProductHttpError('FORBIDDEN'); });
    const old = f.main.freeze(), failed = expect(old).rejects.toMatchObject({ code: 'STALE' });
    f.relogin(); f.main.select(key);
    f.request.mockRejectedValueOnce(new ProductHttpError('UNAVAILABLE'));
    await expect(f.main.freeze()).rejects.toThrow(); const next = f.main.unresolved();
    release(); await failed; expect(f.main.unresolved()).toEqual(next); f.main.dispose();
  });

  it('bounds total assembled sample bytes without handing out the early pages', async () => {
    const f = fixture(140);
    for (const s of f.samples) {
      s.entry.answerText = '合'.repeat(32767); s.entry.internalNote = '成'.repeat(32767); s.entry.riskNote = '例'.repeat(32767);
    }
    await expect(f.main.refresh('initial')).rejects.toMatchObject({ code: 'VALIDATION', reason: 'FILE_LIMIT' });
    expect(f.request.mock.calls.length).toBeLessThan(140); expect(f.main.current()).toBeNull(); f.main.dispose();
  });

  it('preserves human checks after a first atomic size rejection so only the long reason needs correction', async () => {
    const f = fixture(); await f.main.refresh('initial');
    f.main.setCheck(id(0), true, '需要修正的问题'); f.main.setCheck(id(1), false, '已完成逐字检查');
    f.request.mockRejectedValueOnce(new ProductHttpError('VALIDATION', 'FILE_LIMIT'));
    await expect(f.main.submit()).rejects.toMatchObject({ reason: 'FILE_LIMIT' });
    const rejected = f.request.mock.calls.at(-1)![2]!.body as C['IntakeQualitySubmission'];
    expect(f.main.unresolved()).toBeNull(); expect(f.main.current()?.samples).toHaveLength(2);
    f.main.setCheck(id(0), true, '缩短原因'); await f.main.submit();
    const corrected = f.request.mock.calls.at(-1)![2]!.body as C['IntakeQualitySubmission'];
    expect(corrected.operationId).not.toBe(rejected.operationId);
    expect(corrected.checks).toEqual([{ ...check(id(0)), defect: true, reason: '缩短原因' }, { ...check(id(1)), reason: '已完成逐字检查' }]);
    f.main.dispose();
  });
});
