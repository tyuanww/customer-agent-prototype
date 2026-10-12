import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createSopPreviewReader } from '../experiments/sop-row-deletion/persistent-media.js';
import { createSopMediaLifecycle, sopSqlFailure } from '../experiments/sop-row-deletion/media-lifecycle.js';
import { mediaObjectId } from '../src/content-intake/linked-preview.js';
import { digest } from '../src/content-intake/material.js';
import type { createIntakeTransactions, IntakeTransaction, Principal } from '../src/content-intake/transaction.js';
import type { AuthenticatedUser } from '../src/auth-service.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const actor = { user_id: 'synthetic-user' } as AuthenticatedUser;
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'ca-media-lifecycle-')); roots.push(root);
  const store = createContentObjectStore(root);
  const reservation = { objectId: `obj_${'a'.repeat(64)}`, mediaObjectId: mediaObjectId('source-a', png),
    sourceId: 'source-a', sha256: digest(png), bytes: png.length, mime: 'image/png', state: 'reserved' };
  const commands: string[] = [];
  let inspect: ((sql: string) => Promise<void>) | undefined;
  const client = { query: async (sql: string) => {
    commands.push(sql);
    if (sql.includes('SELECT j.*')) return { rows: [{ source_id: 'source-a' }] };
    if (sql.includes('FROM content_intake.sources src')) return { rows: [{ scope_id: 'scope-a', tenant_id: 'tenant-a', app_id: 'app-a', brand_id: 'brand-a', shop_id: 'shop-a', domain: 'sop', current_mapping_version: '1' }] };
    if (sql.includes('clock_timestamp() AS time')) return { rows: [{ time: new Date() }] };
    if (sql.includes('authorization_deadline')) return { rows: [{ until: new Date(Date.now() + 60_000) }] };
    await inspect?.(sql);
    if (sql.includes('complete_sop_media_payload')) reservation.state = 'persisted';
    if (sql.includes('begin_sop_media_release')) reservation.state = 'releasing';
    if (sql.includes('complete_sop_media_release')) reservation.state = 'released';
    return { rows: [{ value: { ...reservation } }] };
  }, validUntil: vi.fn() } as unknown as IntakeTransaction;
  const run = (async (_actor: AuthenticatedUser, _purpose: string, _key: unknown, _digest: unknown,
    work: (client: IntakeTransaction, who: Principal) => Promise<unknown>) => ({ ok: true, value: await work(client, { id: 'principal-a', tenantId: 'tenant-a', appId: 'app-a', enabled: true, role: 'manager', checkedAt: Date.now() - 1000, validUntil: Date.now() + 60_000 } as Principal) })) as ReturnType<typeof createIntakeTransactions>;
  return { store, reservation, commands, run, inspect: (fn: typeof inspect) => { inspect = fn; } };
}
it('rechecks a fixed reservation under the same file lock and keeps it through completion, even without a database connection', async () => {
  const s = setup(), lifecycle = createSopMediaLifecycle(s.run, s.store), other = createContentObjectStore(s.store.rootDirectory);
  let reserves = 0;
  s.inspect(async sql => {
    if (sql.includes('reserve_sop_media_payload') && ++reserves === 1) return;
    // The mock has no PG session/connection lock. The actual filesystem lock is
    // independently held during both state recheck and database completion.
    await expect(other.reclaim(s.reservation.objectId)).rejects.toThrow('CONTENT_OBJECT_BUSY');
  });
  const result = await lifecycle.persist(actor, 'job-a', 'source-a', png, 'image/png');
  expect(result).toMatchObject({ ok: true, value: { state: 'persisted' } });
  expect(reserves).toBe(2);
  expect(await other.readAttachment({ objectId: s.reservation.objectId, sha256: digest(png), sizeBytes: png.length, mime: 'image/png' })).toEqual(png);
  s.inspect(async () => { await expect(other.reclaim(s.reservation.objectId)).rejects.toThrow('CONTENT_OBJECT_BUSY'); });
  expect(await lifecycle.release(actor, 'job-a', result.ok ? result.value : (() => { throw new Error('failed'); })())).toMatchObject({ ok: true, value: { state: 'released' } });
  expect(s.commands.at(-1)).toContain('complete_sop_media_release');
});
it('does not write after a release wins before the file lock state recheck', async () => {
  const s = setup(); let reserves = 0;
  s.inspect(async sql => { if (sql.includes('reserve_sop_media_payload') && ++reserves === 2) s.reservation.state = 'released'; });
  await expect(createSopMediaLifecycle(s.run, s.store).persist(actor, 'job-a', 'source-a', png, 'image/png')).rejects.toThrow('MATERIAL_CHANGED');
  await expect(s.store.readPayload(s.reservation.objectId)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(s.commands.some(sql => sql.includes('complete_sop_media_payload'))).toBe(false);
});
it('lists row metadata without opening bytes, then cold reads only the selected private payload', async () => {
  const s = setup();
  await s.store.persistAttachment({ objectId: s.reservation.objectId, sha256: digest(png), sizeBytes: png.length, mime: 'image/png' }, png);
  const read = vi.fn(createContentObjectStore(s.store.rootDirectory).readAttachment);
  const reader = createSopPreviewReader({ readAttachment: read });
  const row = { objectId: s.reservation.mediaObjectId, payloadObjectId: s.reservation.objectId,
    sha256: digest(png), bytes: png.length, mime: 'image/png', sourceId: 'source-a', rowId: 'sop:sheet:1',
    businessEntryId: 'sop1', productRefIds: [], scenarioRefIds: [], familySourceId: '', operation: 'upsert', effectiveFrom: null, effectiveTo: null };
  const query = vi.fn(async () => ({ rows: [{ value: { items: [row, { ...row, rowId: 'sop:sheet:2', businessEntryId: 'sop2' }] } }] }));
  const items = await reader.list({ query } as unknown as IntakeTransaction,
    { principalId: 'principal-a', entitlementHash: 'hash', sessionTokenHash: 'session', releaseId: 'release-a', sourceIds: new Set(['source-a']) });
  expect(items).toHaveLength(2); expect(read).not.toHaveBeenCalled();
  expect(await reader.read(items[1]!)).toEqual(png); expect(read).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]).toBeDefined();
});

it('releases its fixed unadopted reservation after a definite file verification failure', async () => {
  const s = setup();
  writeFileSync(path.join(s.store.rootDirectory, 'objects', s.reservation.objectId), Buffer.alloc(png.length));
  await expect(createSopMediaLifecycle(s.run, s.store).persist(actor, 'job-a', 'source-a', png, 'image/png')).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
  expect(s.reservation.state).toBe('released');
  await expect(s.store.readPayload(s.reservation.objectId)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(s.commands.filter(sql => sql.includes('begin_sop_media_release'))).toHaveLength(1);
});
it('preserves both write and cleanup diagnostics, with the reservation charged when cleanup fails', async () => {
  const s = setup();
  writeFileSync(path.join(s.store.rootDirectory, 'objects', s.reservation.objectId), Buffer.alloc(png.length));
  s.inspect(async sql => { if (sql.includes('begin_sop_media_release')) throw new Error('synthetic-release-unavailable'); });
  const failure = await createSopMediaLifecycle(s.run, s.store).persist(actor, 'job-a', 'source-a', png, 'image/png').catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.message).toBe('SOP_MEDIA_WRITE_AND_RELEASE_FAILED');
  expect(failure.errors.map((error: Error) => error.message)).toEqual(['CONTENT_ATTACHMENT_INVALID', 'synthetic-release-unavailable']);
  expect(s.reservation.state).toBe('reserved');
  expect(await s.store.readPayload(s.reservation.objectId)).toEqual(Buffer.alloc(png.length));
});

it('maps the SQL quota error shape to a capacity failure rather than unknown commit', () => {
  const error = Object.assign(new Error('QUOTA_EXCEEDED'), { code: 'ZA003' });
  try { sopSqlFailure(error); } catch (failure) {
    expect(failure).toMatchObject({ reason: 'QUOTA_EXCEEDED', code: 'RATE_LIMITED' });
    return;
  }
  throw new Error('expected rejection');
});
