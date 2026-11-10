import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/product-auth-service.js', () => ({ authenticatedProductSession: () => 'c'.repeat(64) }));
import { createContentObjectStore, type ReservedAttachment } from '../src/content-object-store.js';
import { withIntakeView } from '../src/content-intake/contract-view.js';
import { digest } from '../src/content-intake/material.js';
import { createSopContinuationService } from '../src/sop-continuation.js';
import type { SopMediaResource } from '../src/sop-continuation-routes.js';

const actor = { user_id: 'synthetic-user', role: 'agent', auth_mode: 'mock' } as const;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sop-continuation-media-')); directories.push(root);
  const store = createContentObjectStore(root);
  const descriptor: ReservedAttachment = { objectId: `obj_${'a'.repeat(64)}`, sha256: digest(png), sizeBytes: png.length, mime: 'image/png' };
  await store.persistAttachment(descriptor, png);
  const timeline: string[] = [], values: (readonly unknown[])[] = [];
  const source = { tenantId: 'synthetic-tenant', appId: 'synthetic-app', brandId: 'synthetic-brand', shopId: 'synthetic-shop', domain: 'sop', sourceId: 'synthetic-source' };
  let reads = 0, selections = 0, transactionOpen = false;
  const controls = { deniedAfterRead: false, closed: false, expired: false, closeAfterRead: false,
    lateRead: false, loseReadCommit: false, changeBinding: false, wrongBytes: false, wrongMime: false };
  const query = async (sql: string, params: readonly unknown[] = []) => {
    timeline.push(sql); values.push([...params]);
    if (sql.startsWith('BEGIN')) transactionOpen = true;
    if (sql === 'COMMIT' || sql === 'ROLLBACK') transactionOpen = false;
    if (sql === 'COMMIT' && reads && controls.loseReadCommit) { controls.loseReadCommit = false; throw new Error('synthetic read COMMIT acknowledgement lost'); }
    if (sql === 'SELECT clock_timestamp() AS time') return { rows: [{ time: new Date(1000) }] };
    if (sql === 'SELECT clock_timestamp()::text AS at') return { rows: [{ at: new Date(1000).toISOString() }] };
    if (sql.includes('intake_runtime.lock_product_session')) return { rows: [{ expires_at: new Date(20000) }] };
    if (sql.includes('FROM content_intake.principals')) return { rows: [{ principal_id: 'synthetic-principal', user_id: actor.user_id,
      tenant_id: source.tenantId, app_id: source.appId, identity_scope: 'synthetic', person_key: 'synthetic-person',
      current_facts_version: '1', revocation_generation: '0', enabled: true, checked_at: new Date(0), valid_until: new Date(20000), roles: ['agent'] }] };
    if (sql.includes('authorize_sop_continuation_resource') && controls.deniedAfterRead && reads) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'ZA002' });
    if (sql.includes('sop_media_usage_context')) return { rows: [{ value: { shopId: source.shopId, contextGeneration: 8, productIds: ['synthetic-product'], scenarioIds: ['synthetic-scenario'] } }] };
    if (sql.includes('SELECT src.source_id,src.revocation_generation')) return { rows: [{ source_id: source.sourceId, scope: source, generation: '2', mode_version: '1', mode: 'v2-preview', until: new Date(20000) }] };
    if (sql.includes('SELECT count(*) FROM jsonb_to_recordset')) return { rows: [{ count: '2' }] };
    if (sql.includes('read_sop_continuation_media')) {
      selections++;
      if (controls.closed || controls.expired) return { rows: [{ value: { kind: controls.closed ? 'closed' : 'expired' } }] };
      return { rows: [{ value: { kind: 'selected', validUntil: new Date(20000).toISOString(), descriptor: { objectId: descriptor.objectId },
        binding: { flowKey: { sourceId: source.sourceId, flowId: 'synthetic-flow', flowVersion: 1 }, objectId: 'synthetic-media', resourceId: 'synthetic-resource',
          graphTarget: { kind: 'task', id: controls.changeBinding && selections > 1 ? 'changed-task' : 'synthetic-task' },
          sha256: descriptor.sha256, bytes: descriptor.sizeBytes, mime: controls.wrongMime ? 'image/jpeg' : descriptor.mime,
          ordinal: 1, required: true, alt: 'synthetic image', audience: 'agent', applicability: { productRefs: [], scenarioRefs: [] } } } }] };
    }
    return { rows: [] };
  };
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const reader = { async readAttachment(expected: ReservedAttachment) {
    expect(transactionOpen).toBe(false); timeline.push('OBJECT_IO'); reads++;
    if (controls.closeAfterRead) controls.closed = true;
    if (controls.lateRead) vi.advanceTimersByTime(5000);
    return controls.wrongBytes ? Buffer.from('synthetic-corruption') : store.readAttachment(expected);
  } };
  const service = createSopContinuationService({ connect: async () => client }, () => undefined, reader);
  const resource: SopMediaResource = { kind: 'media', releaseId: 'synthetic-release', objectId: 'synthetic-media', continuationHeaders: [],
    query: { entitlementId: 'synthetic-entitlement', sourceId: source.sourceId, flowId: 'synthetic-flow', ownerKind: 'task', ownerId: 'synthetic-task', resourceId: 'synthetic-resource' } };
  return { run: () => withIntakeView('graph', () => service.media(actor, resource)), resource, controls, timeline, values, reads: () => reads };
}

describe('release media transaction and real object-store boundary', () => {
  it('reads real bytes between two committed authorizations and restores the registered selection', async () => {
    const f = await fixture(), result = await f.run();
    expect(result).toMatchObject({ ok: true, value: { bytes: png.length, sha256: digest(png), mime: 'image/png' } });
    if (!result.ok) throw new Error('synthetic media read failed');
    expect(Buffer.from(result.value.base64, 'base64')).toEqual(png);
    const io = f.timeline.indexOf('OBJECT_IO');
    expect(f.timeline.slice(0, io)).toContain('COMMIT');
    expect(f.timeline.slice(io + 1).some(sql => sql.includes('read_sop_continuation_media'))).toBe(true);
    expect(f.timeline.at(-1)).toBe('COMMIT');
    const selection = f.timeline.findIndex(sql => sql.includes('SELECT count(*) FROM jsonb_to_recordset'));
    expect(JSON.parse(String(f.values[selection]![0]))).toEqual([{ id: 'synthetic-product', kind: 'product' }, { id: 'synthetic-scenario', kind: 'scenario' }]);
  });

  it('returns no bytes when authority changes during object I/O', async () => {
    const f = await fixture(); f.controls.deniedAfterRead = true;
    expect(await f.run()).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED', commit: 'rolled_back' });
    expect(f.reads()).toBe(1); expect(f.timeline.at(-1)).toBe('ROLLBACK');
  });

  it('commits a permanent close before returning its public refusal and skips object I/O', async () => {
    const f = await fixture(); f.controls.closed = true;
    expect(await f.run()).toMatchObject({ ok: false, reason: 'SOP_RELEASE_CHANGED', commit: 'committed' });
    expect(f.reads()).toBe(0); expect(f.timeline.at(-1)).toBe('COMMIT');
    f.controls.closed = false; f.controls.expired = true;
    expect(await f.run()).toMatchObject({ ok: false, reason: 'LEASE_EXPIRED', commit: 'committed' });
    expect(f.reads()).toBe(0);
  });

  it('rejects a changed owner binding and corrupt or MIME-mismatched bytes', async () => {
    const f = await fixture(); f.controls.changeBinding = true;
    expect(await f.run()).toMatchObject({ ok: false, reason: 'SOP_SNAPSHOT_INVALID' });
    for (const control of ['wrongBytes', 'wrongMime'] as const) {
      const invalid = await fixture(); invalid.controls[control] = true;
      expect(await invalid.run()).toMatchObject({ ok: false, reason: 'SOP_MEDIA_UNAVAILABLE' });
      expect(invalid.timeline.at(-1)).toBe('ROLLBACK');
    }
  });

  it('withholds bytes after a closing event or an uncertain final COMMIT and recovers by reauthorization', async () => {
    const closed = await fixture(); closed.controls.closeAfterRead = true;
    expect(await closed.run()).toMatchObject({ ok: false, reason: 'SOP_RELEASE_CHANGED', commit: 'committed' });
    expect(closed.reads()).toBe(1); expect(closed.timeline.at(-1)).toBe('COMMIT');
    const uncertain = await fixture(); uncertain.controls.loseReadCommit = true;
    expect(await uncertain.run()).toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
    expect(await uncertain.run()).toMatchObject({ ok: true, value: { base64: png.toString('base64') } });
    expect(uncertain.reads()).toBe(2);
  });

  it('includes lock-free object I/O in the five-second authorization window', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['performance'] }); f.controls.lateRead = true;
    expect(await f.run()).toMatchObject({ ok: false, code: 'OVERLOADED', reason: 'PERMISSION_CHANGED', commit: 'rolled_back' });
    expect(f.reads()).toBe(1); expect(f.timeline.at(-1)).toBe('ROLLBACK');
    const closed = await fixture(); closed.controls.lateRead = true; closed.controls.closeAfterRead = true;
    expect(await closed.run()).toMatchObject({ ok: false, reason: 'SOP_RELEASE_CHANGED', commit: 'committed' });
    expect(closed.timeline.at(-1)).toBe('COMMIT');
  });

  it('rejects duplicate/empty continuation headers and unknown or duplicate tuple fields before I/O', async () => {
    for (const headers of [['sct_' + 'd'.repeat(64), 'sct_' + 'd'.repeat(64)], ['']]) {
      const f = await fixture(); f.resource.continuationHeaders = headers;
      expect(await f.run()).toMatchObject({ ok: false, code: 'VALIDATION' }); expect(f.reads()).toBe(0);
    }
    for (const extra of [{ ownerKind: ['task', 'task'] }, { url: 'https://synthetic.invalid' }]) {
      const f = await fixture(); f.resource.query = { ...f.resource.query as object, ...extra };
      expect(await f.run()).toMatchObject({ ok: false, code: 'VALIDATION' }); expect(f.reads()).toBe(0);
    }
  });
});
