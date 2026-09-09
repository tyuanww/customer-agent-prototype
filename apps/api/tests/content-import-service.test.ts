import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createContentImportService } from '../src/content-import-service.js';
import type { ContentImportRepository } from '../src/content-import-repository.js';
import type { ContentObjectStore, PersistedContentObject } from '../src/content-object-store.js';

const hmac = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({ 'hmac-idempotency-v1': 'synthetic-import-idempotency-material-01' }),
});
const logHash = Object.freeze({ version: 'hmac-log-v1', key: 'synthetic-import-log-hash-material-0001' });
const actor = Object.freeze({ user_id: 'usr_coach', role: 'coach' as const, auth_mode: 'mock' as const });
const persisted: PersistedContentObject = Object.freeze({
  objectId: `obj_${'ab'.repeat(32)}`,
  sha256: 'c'.repeat(64),
  sizeBytes: 8,
  sourceType: 'csv' as const,
});

function form(): Buffer {
  const boundary = '----svc';
  return Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.csv"\r\nContent-Type: text/csv\r\n\r\na,b\n\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="source_bindings"\r\n\r\n`,
    '[{"domain":"presale","source_version_id":"srcv_t2_presale_v1"},',
    '{"domain":"campaign","source_version_id":"srcv_t2_campaign_v1"},',
    '{"domain":"aftersale","source_version_id":"srcv_t2_aftersale_v1"},',
    '{"domain":"product","source_version_id":"srcv_t2_product_v1"}]\r\n',
    `--${boundary}--\r\n`,
  ].join(''));
}

describe('content import receive policy', () => {
  it('does not reclaim a persisted object when commit certainty is unknown', async () => {
    const reclaim = vi.fn(async () => 'reclaimed' as const);
    const store = {
      persist: async () => persisted,
      verify: async () => true,
      writeReceipt: async () => undefined,
      readReceipt: async () => null,
      reclaim,
      rootDirectory: '/tmp/unused',
    } satisfies ContentObjectStore;
    const repository = {
      enqueue: async () => Object.freeze({
        ok: false as const,
        code: 'OVERLOADED' as const,
        commit: 'unknown' as const,
      }),
      readStatus: async () => Object.freeze({ ok: false as const, code: 'OVERLOADED' as const, commit: 'rolled_back' as const }),
      cancel: async () => Object.freeze({ ok: false as const, code: 'OVERLOADED' as const, commit: 'rolled_back' as const }),
      readSourceRefs: async () => [],
    } satisfies ContentImportRepository;
    const service = createContentImportService(store, repository, hmac, logHash);
    const result = await service.acceptUpload({
      actor,
      idempotencyKey: 'idem-unknown-commit',
      contentType: 'multipart/form-data; boundary=----svc',
      body: Readable.from(form()),
    });
    expect(result.ok).toBe(false);
    expect(reclaim).not.toHaveBeenCalled();
  });

  it('does not reclaim after enqueue commit if receipt persistence fails', async () => {
    const reclaim = vi.fn(async () => 'reclaimed' as const);
    const store = {
      persist: async () => persisted,
      verify: async () => true,
      writeReceipt: async () => { throw new Error('disk full'); },
      readReceipt: async () => null,
      reclaim,
      rootDirectory: '/tmp/unused',
    } satisfies ContentObjectStore;
    const repository = {
      enqueue: async () => Object.freeze({
        ok: true as const,
        commit: 'committed' as const,
        response: {
          import_batch_id: 'imp_committedreceipt01',
          status: 'validating' as const,
          source_binding_hash: 'b'.repeat(64),
        },
      }),
      readStatus: async () => Object.freeze({ ok: false as const, code: 'OVERLOADED' as const, commit: 'rolled_back' as const }),
      cancel: async () => Object.freeze({ ok: false as const, code: 'OVERLOADED' as const, commit: 'rolled_back' as const }),
      readSourceRefs: async () => [],
    } satisfies ContentImportRepository;
    const service = createContentImportService(store, repository, hmac, logHash);
    const result = await service.acceptUpload({
      actor,
      idempotencyKey: 'idem-receipt-fail',
      contentType: 'multipart/form-data; boundary=----svc',
      body: Readable.from(form()),
    });
    expect(result.ok).toBe(false);
    expect(reclaim).not.toHaveBeenCalled();
  });

  it('reclaims only after a known rolled-back enqueue', async () => {
    const reclaim = vi.fn(async () => 'reclaimed' as const);
    const store = {
      persist: async () => persisted,
      verify: async () => true,
      writeReceipt: async () => undefined,
      readReceipt: async () => null,
      reclaim,
      rootDirectory: '/tmp/unused',
    } satisfies ContentObjectStore;
    const repository = {
      enqueue: async () => Object.freeze({
        ok: false as const,
        code: 'INTERNAL' as const,
        commit: 'rolled_back' as const,
      }),
      readStatus: async () => Object.freeze({ ok: false as const, code: 'OVERLOADED' as const, commit: 'rolled_back' as const }),
      cancel: async () => Object.freeze({ ok: false as const, code: 'OVERLOADED' as const, commit: 'rolled_back' as const }),
      readSourceRefs: async () => [],
    } satisfies ContentImportRepository;
    const service = createContentImportService(store, repository, hmac, logHash);
    await service.acceptUpload({
      actor,
      idempotencyKey: 'idem-rolled-back',
      contentType: 'multipart/form-data; boundary=----svc',
      body: Readable.from(form()),
    });
    expect(reclaim).toHaveBeenCalledWith(persisted.objectId);
  });
});
