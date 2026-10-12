import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { canonicalJson, type CanonicalJsonValue } from '../src/idempotency.js';
import { createIntakePublication } from '../src/content-intake/publication.js';
import { createIntakeTransactions, type IntakePool } from '../src/content-intake/transaction.js';
import { discardPreviews, listPreviews, previewFromBytes, stagePreviews } from '../src/content-intake/linked-preview.js';

vi.mock('../src/content-intake/candidate.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/content-intake/candidate.js')>(),
  candidateContext: vi.fn(async () => ({ material: { entries: [], baseReleaseId: null },
    view: { sourceEvidenceVersion: 1, publicationPolicy: 'direct-v1' } })),
}));

type C = components['schemas'];
const actor = { user_id: 'synthetic-preview-user', role: 'owner', auth_mode: 'mock' } as const;
const key = { candidateId: 'synthetic-preview-candidate', version: 1, digest: 'a'.repeat(64) };
const request: C['IntakePublish'] = { operationId: 'synthetic-preview-operation', key,
  baseReleaseId: null, sourceEvidenceVersion: 1, title: 'Synthetic preview', summary: 'Synthetic summary', confirmed: true };
const published: C['IntakeReceipt'] = { operationId: request.operationId, key, state: 'published',
  releaseId: 'synthetic-preview-release', announcementId: 'synthetic-preview-announcement', reason: null, action: 'publish' };
const sources = new Set(['synthetic-preview-source']);
const images = () => listPreviews(published.releaseId!, sources);
const now = Date.parse('2026-10-11T00:00:00.000Z');

/** Deterministic connection double: the real transaction owner still controls
 * final authority, COMMIT certainty and receipt replay. This is not a PG probe. */
function harness(mode: 'commit' | 'expire' | 'unknown-committed' | 'unknown-absent' = 'commit') {
  const hash = `intake-request-v1:${createHash('sha256').update(canonicalJson(request as CanonicalJsonValue)).digest('hex')}`;
  let saved: { request_hash: string; response: C['IntakeOperationReceipt'] } | undefined;
  let pending: typeof saved;
  let publishing = false;
  let expire = false;
  let failReceiptCommit = false;
  let connectionCount = 0;
  let replayOnSecondConnection = false;
  const observations: number[] = [];
  const statements: string[] = [];
  const pool = { connect: async () => {
    connectionCount++;
    if (connectionCount === 2 && replayOnSecondConnection) saved = { request_hash: hash, response: published };
    return {
      async query(sql: string, values: unknown[] = []) {
        statements.push(sql);
        if (sql.startsWith('BEGIN')) { publishing = false; expire = false; pending = undefined; }
        if (sql.includes('clock_timestamp() AS time')) return { rows: [{ time: new Date(now) }] };
        if (sql.includes('SELECT p.*')) return { rows: [{ principal_id: 'synthetic-preview-principal', user_id: actor.user_id,
          tenant_id: 'synthetic', app_id: 'synthetic', identity_scope: 'synthetic', person_key: 'synthetic',
          current_facts_version: '1', revocation_generation: '1', enabled: true, checked_at: new Date(now - 1000),
          valid_until: new Date(expire ? now - 1 : now + 60_000), roles: ['manager'] }] };
        if (sql.startsWith('SELECT request_hash,response FROM backend_review.receipts') || sql.startsWith('SELECT response FROM backend_review.receipts')) {
          return { rows: saved && values[0] === actor.user_id && values[2] === request.operationId ? [saved] : [] };
        }
        if (sql.includes('SELECT content_intake.publish_candidate')) {
          publishing = true;
          return { rows: [{ value: { receipt: published, validUntil: new Date(now + 60_000).toISOString() } }] };
        }
        if (sql.includes('SELECT min(f.valid_until)')) return { rows: [{ until: null }] };
        if (sql.startsWith('INSERT INTO backend_review.receipts')) {
          pending = { request_hash: values[3] as string, response: JSON.parse(values[4] as string) };
          if (mode === 'expire') expire = true;
        }
        if (sql === 'ROLLBACK') pending = undefined;
        if (sql === 'COMMIT') {
          observations.push(images().length);
          if (publishing && mode === 'unknown-absent') throw new Error('Synthetic COMMIT response lost before durable receipt');
          if (pending) saved = pending;
          if ((publishing && mode === 'unknown-committed') || failReceiptCommit) throw new Error('Synthetic COMMIT response lost');
        }
        return { rows: [] };
      },
      release() {},
    };
  } } as unknown as IntakePool;
  stagePreviews(key.candidateId, [previewFromBytes(Buffer.from('synthetic-image'), 'image/png', [...sources][0]!, 'synthetic-row')]);
  return { service: createIntakePublication(createIntakeTransactions(pool)), observations, statements,
    seedReceipt(value: C['IntakeOperationReceipt'] = published) { saved = { request_hash: hash, response: value }; },
    failReceiptCommit() { failReceiptCommit = true; },
    replayOnSecondConnection() { replayOnSecondConnection = true; },
  };
}

afterEach(() => discardPreviews(key.candidateId));

describe('published preview projection follows confirmed transaction receipts', () => {
  it('keeps release preview absent through COMMIT and projects after success', async () => {
    const h = harness();
    expect(await h.service.publish(actor, request)).toEqual({ ok: true, value: published });
    expect(h.observations).toEqual([0, 0]);
    expect(images()).toHaveLength(1);
  });
  it('does not adopt when the final authority check rolls back', async () => {
    const h = harness('expire');
    expect(await h.service.publish(actor, request)).toMatchObject({ ok: false, commit: 'rolled_back' });
    expect(h.statements).toContain('ROLLBACK');
    expect(images()).toHaveLength(0);
    expect(listPreviews(key.candidateId, sources)).toHaveLength(1);
  });
  it('keeps unknown absent commits unprojected, including unsuccessful receipt recovery', async () => {
    const h = harness('unknown-absent');
    expect(await h.service.publish(actor, request)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(images()).toHaveLength(0);
    expect(await h.service.operationReceipt(actor, request.operationId, 'publish')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(images()).toHaveLength(0);
  });
  it.each(['publish replay', 'operation receipt'] as const)('restores a committed unknown result through %s', async recovery => {
    const h = harness('unknown-committed');
    expect(await h.service.publish(actor, request)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(images()).toHaveLength(0);
    const recovered = recovery === 'publish replay' ? await h.service.publish(actor, request)
      : await h.service.operationReceipt(actor, request.operationId, 'publish');
    expect(recovered).toEqual({ ok: true, value: published });
    expect(h.observations.every(count => count === 0)).toBe(true);
    expect(images()).toHaveLength(1);
    expect(h.statements.filter(sql => sql.includes('SELECT content_intake.publish_candidate'))).toHaveLength(1);
  });
  it('projects a receipt won by another transaction between prepare and publish', async () => {
    const h = harness(); h.replayOnSecondConnection();
    expect(await h.service.publish(actor, request)).toEqual({ ok: true, value: published });
    expect(h.statements.some(sql => sql.includes('SELECT content_intake.publish_candidate'))).toBe(false);
    expect(images()).toHaveLength(1);
  });
  it('does not project when recovery itself has an unknown COMMIT', async () => {
    const h = harness(); h.seedReceipt(); h.failReceiptCommit();
    expect(await h.service.operationReceipt(actor, request.operationId, 'publish')).toMatchObject({ ok: false, commit: 'unknown' });
    expect(images()).toHaveLength(0);
  });
  it.each(['pending', 'unknown', 'failed'] as const)('does not treat a %s receipt as publication', async state => {
    const h = harness(); h.seedReceipt({ ...published, state });
    expect(await h.service.operationReceipt(actor, request.operationId, 'publish')).toMatchObject({ ok: true, value: { state } });
    expect(images()).toHaveLength(0);
  });
});
