import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/product-auth-service.js', () => ({ authenticatedProductSession: () => 'c'.repeat(64) }));
import { parseContractSchema as parse, type components } from '@customer-agent/contracts/sop-unified';
import { knowledgeFlow, faqEntry } from '../../../packages/contracts/tests/sop-unified.fixtures.js';
import { createContentObjectStore, type ReservedAttachment } from '../src/content-object-store.js';
import { digest } from '../src/content-intake/material.js';
import { graphDigest, validateGraph, type Graph } from '../src/content-intake/sop-graph.js';
import { withIntakeView } from '../src/content-intake/contract-view.js';
import { createSopContinuationService } from '../src/sop-continuation.js';
import { sopContinuationHash } from '../src/sop-continuation-action.js';

type C = components['schemas'];
const actor = { user_id: 'synthetic-user', role: 'agent', auth_mode: 'mock' } as const;
const handle = `sct_${'d'.repeat(64)}`, at = Date.parse('2026-11-10T06:00:00Z');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function fixture(noFaq = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sop-continuation-flow-')); directories.push(root);
  const store = createContentObjectStore(root), definition = structuredClone(knowledgeFlow), key = definition.header.key;
  const applicability = { productRefs: [{ id: 'synthetic-product', displayVersion: 1 }], scenarioRefs: [] };
  definition.header.applicability = applicability;
  const ref = { sourceId: key.sourceId, businessEntryId: faqEntry.businessEntryId, scriptVersion: 1 };
  if (!noFaq) definition.nodes[0]!.body.scripts = [{ entry: ref, relation: 'independent', condition: 'synthetic explicit condition' }];
  const descriptor: ReservedAttachment = { objectId: `obj_${'a'.repeat(64)}`, sha256: digest(png), mime: 'image/png', sizeBytes: png.length };
  await store.persistAttachment(descriptor, png);
  const media = (kind: 'task' | 'knowledge', id: string, required: boolean): C['IntakeSopMedia'] => ({
    flowKey: key, graphTarget: { kind, id }, resourceId: 'synthetic-shared-resource', objectId: 'synthetic-media',
    sha256: descriptor.sha256, mime: descriptor.mime, bytes: png.length, ordinal: 1, alt: 'synthetic shared image', required,
    audience: 'agent', applicability,
  });
  const graph: Graph = { definition, entries: noFaq ? [] : [{ sourceId: key.sourceId, entry: { ...structuredClone(faqEntry), ...applicability } }],
    media: [media('task', 'task-a', true), media('task', 'task-end', true), media('knowledge', 'knowledge-a', false)] };
  validateGraph(graph);
  const originalDigest = graphDigest(graph), events: { sql: string; values: readonly unknown[] }[] = [], entitlements = new Map<string, number>();
  const source = { tenantId: 'synthetic-tenant', appId: 'synthetic-app', brandId: 'synthetic-brand', shopId: 'synthetic-shop', domain: 'sop', sourceId: key.sourceId };
  const controls = { opened: false, closed: false, current: 'synthetic-R1', unavailable: false, denied: false, blockFacts: false,
    loseCommit: false, denyAfterRead: false, reads: 0 };
  const publicationFacts = { publicationReleaseId: 'synthetic-R1', materialDigest: 'b'.repeat(64), sourceVersion: 1,
    mappingDigest: 'e'.repeat(64), mappingSha256: 'f'.repeat(64),
    sourceClaim: { versionKind: 'unknown', versionValue: null, acquisition: 'controlled-synthetic-export', fileSha256: 'b'.repeat(64) },
    risk: { policyVersion: 'risk-p1.1', level: 'critical', reasons: ['SYNTHETIC_EXPLICIT_CHANGE'], explicitDisableCount: 0,
      sameSourceDisabledLast24Hours: 0, evaluatedAt: new Date(at).toISOString() },
    confirmation: { evidenceVersion: 1, versionKind: 'opaque', versionValue: 'synthetic-explicit-source', acquisition: 'controlled-synthetic-export', objectSha256: 'b'.repeat(64) } };
  const query = async (sql: string, values: readonly unknown[] = []) => {
    events.push({ sql, values });
    if (sql === 'SELECT clock_timestamp() AS time') return { rows: [{ time: new Date(at) }] };
    if (sql === 'SELECT clock_timestamp()::text AS at') return { rows: [{ at: new Date(at).toISOString() }] };
    if (sql.includes('intake_runtime.lock_product_session')) return { rows: [{ expires_at: new Date(at + 600_000) }] };
    if (sql.includes('FROM content_intake.principals')) return { rows: [{ principal_id: 'synthetic-principal', user_id: actor.user_id,
      tenant_id: source.tenantId, app_id: source.appId, identity_scope: 'synthetic', person_key: 'synthetic-person',
      current_facts_version: '1', revocation_generation: '0', enabled: true, checked_at: new Date(at - 1000), valid_until: new Date(at + 600_000), roles: ['agent'] }] };
    if (sql.includes('authorize_sop_continuation_resource') && controls.denied) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'ZA002' });
    if (sql.includes('SELECT src.source_id,src.revocation_generation')) return { rows: [{ source_id: source.sourceId, scope: source, generation: '2', mode_version: '1', mode: 'v2-preview', until: new Date(at + 600_000) }] };
    if (sql.includes('SELECT count(*) FROM jsonb_to_recordset')) return { rows: [{ count: '1' }] };
    if (sql.includes('prepare_sop_action')) {
      const opening = values[3] ? JSON.parse(String(values[3])) as Record<string, unknown> : null;
      if (controls.closed) return { rows: [{ value: { kind: 'closed' } }] };
      if (opening && !controls.opened && controls.current !== 'synthetic-R1') throw Object.assign(new Error('SOP_RELEASE_CHANGED'), { code: 'ZA003' });
      if (!opening && !controls.opened) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'ZA002' });
      if (!opening && values[4] && entitlements.get(String(values[4])) !== values[5]) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'ZA002' });
      return { rows: [{ value: { kind: controls.opened ? 'active' : 'opening',
        binding: { release_id: 'synthetic-R1', source_id: key.sourceId, flow_id: key.flowId, flow_version: key.flowVersion, graph_digest: originalDigest },
        selection: { shopId: source.shopId, productIds: ['synthetic-product'], scenarioIds: [] } } }] };
    }
    if (sql.includes('read_sop_action_bundle')) return { rows: [{ value: { kind: 'bundle',
      bundle: { validUntil: new Date(at + 240_000).toISOString(), graphs: [{ payload: graph, graphDigest: originalDigest, selectedMedia: graph.media,
        facts: { candidateId: 'synthetic-candidate', candidateVersion: 1, version: 1, sopGroup: '税收相关规则', publicationFacts,
          permissions: noFaq ? [] : [{ entry: ref, risk_level: controls.blockFacts ? 'unclassified' : 'low', copy_allowed: true,
            source_ref: 'synthetic-continuation-facts@1#entry-a' }] } }] },
      media: graph.media.map(binding => ({ binding, descriptor: { objectId: descriptor.objectId } })) } }] };
    if (sql.includes('open_sop_active_use')) { controls.opened = true; return { rows: [{ value: { kind: 'active' } }] }; }
    if (sql.includes('issue_sop_continuation_lease')) return { rows: [{ value: { kind: 'issued', leaseHash: 'a'.repeat(64), releaseId: 'synthetic-R1', validUntil: new Date(at + 240_000).toISOString() } }] };
    if (sql.startsWith('INSERT INTO content_intake.entitlements(')) entitlements.set(String(values[0]), Number(values[6]));
    if (sql === 'COMMIT' && controls.loseCommit && controls.opened) { controls.loseCommit = false; throw new Error('synthetic COMMIT acknowledgement lost'); }
    return { rows: [] };
  };
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const service = createSopContinuationService({ connect: async () => client }, () => undefined, { async readAttachment(expected) {
    events.push({ sql: 'OBJECT_IO', values: [] }); controls.reads++;
    if (controls.denyAfterRead) controls.denied = true;
    if (controls.unavailable) throw new Error('synthetic missing bytes');
    return store.readAttachment(expected);
  } });
  const request = (changes: Partial<C['IntakeSopActionCheck']> = {}) => parse('IntakeSopActionCheck', {
    entitlementId: 'synthetic-opening-entitlement', releaseId: 'synthetic-R1', contextGeneration: 1, key, graphDigest: originalDigest,
    nodeId: 'task-a', action: 'open', edgeId: null, entry: null, continuationId: handle, ...changes });
  return { controls, get timeline() { return events.map(event => event.sql); }, get sqlValues() { return events.map(event => event.values); }, request, ref,
    check: (body: unknown) => withIntakeView('graph', () => service.check(actor, body)),
    renew: (body: unknown) => withIntakeView('graph', () => service.renew(actor, body)) };
}

describe('continuation service with real C graph parsing and real synthetic object bytes', () => {
  it('opens after byte verification, shares bytes across owners, and emits a full bound qualification', async () => {
    const f = await fixture(), result = await f.check(f.request());
    expect(result).toMatchObject({ ok: true, value: { kind: 'opened', receipt: { continuationId: handle,
      entitlement: { releaseId: 'synthetic-R1', shopId: 'synthetic-shop', contextGeneration: 1 } } } });
    expect(f.controls.reads).toBe(1);
    expect(f.timeline.indexOf('OBJECT_IO')).toBeLessThan(f.timeline.findIndex(sql => sql.includes('SELECT content_intake.open_sop_active_use')));
    expect(JSON.stringify(f.sqlValues)).not.toContain(handle);
    const registration = f.timeline.findIndex(sql => sql.startsWith('INSERT INTO content_intake.entitlements('));
    expect(f.sqlValues[registration]![9]).toBe(sopContinuationHash(handle));
    expect(f.timeline.some(sql => sql.includes('INSERT INTO backend_review.receipts'))).toBe(false);
  });

  it('checks exact copy/edge and renews the old pin after publication using the original selection and fresh generation', async () => {
    const f = await fixture(), opened = await f.check(f.request());
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('synthetic open failed');
    const entitlement = opened.value.receipt.entitlement;
    f.controls.current = 'synthetic-R2';
    expect(await f.check(f.request({ action: 'copy', entry: f.ref, entitlementId: entitlement.entitlementId }))).toEqual({ ok: true, value: { kind: 'checked' } });
    expect(await f.check(f.request({ action: 'next', edgeId: 'edge-a', entitlementId: entitlement.entitlementId }))).toEqual({ ok: true, value: { kind: 'checked' } });
    const renewed = await f.renew({ continuationId: handle, contextGeneration: 9 });
    expect(renewed).toMatchObject({ ok: true, value: { continuationId: handle, entitlement: { releaseId: 'synthetic-R1', contextGeneration: 9, scopes: [{ sourceId: 'synthetic-sop' }] } } });
    const contexts = f.timeline.map((sql, index) => sql.startsWith('INSERT INTO content_intake.entitlement_contexts') ? f.sqlValues[index] : null).filter(value => value !== null);
    expect(contexts.at(-1)?.slice(1)).toEqual(['c'.repeat(64), ['synthetic-product'], []]);
    expect(f.timeline.some(sql => sql.includes('content_current') || sql.includes('public.issue_snapshot_offline_lease('))).toBe(false);
  });

  it('keeps graph-only empty FAQ closure valid when explicit C facts contain an exact empty permission set', async () => {
    const f = await fixture(true);
    expect(await f.check(f.request())).toMatchObject({ ok: true, value: { kind: 'opened' } });
  });

  it('blocks first creation on unavailable required bytes or unresolved explicit entry facts', async () => {
    const missing = await fixture(); missing.controls.unavailable = true;
    expect(await missing.check(missing.request())).toMatchObject({ ok: false, reason: 'SOP_MEDIA_UNAVAILABLE' });
    expect(missing.controls.opened).toBe(false);
    const blocked = await fixture(); blocked.controls.blockFacts = true;
    expect(await blocked.check(blocked.request())).toMatchObject({ ok: false, reason: 'SOP_SNAPSHOT_INVALID' });
    expect(blocked.controls.opened).toBe(false); expect(blocked.controls.reads).toBe(0);
  });

  it('rechecks live authority after I/O and withholds the opening state change on revocation', async () => {
    const f = await fixture(); f.controls.denyAfterRead = true;
    expect(await f.check(f.request())).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' });
    expect(f.controls.opened).toBe(false); expect(f.controls.reads).toBe(1);
  });

  it('recovers a lost open COMMIT on the same handle after a new publication', async () => {
    const f = await fixture(); f.controls.loseCommit = true;
    expect(await f.check(f.request())).toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
    expect(f.controls.opened).toBe(true); f.controls.current = 'synthetic-R2';
    expect(await f.check(f.request())).toMatchObject({ ok: true, value: { kind: 'opened', receipt: { continuationId: handle, entitlement: { releaseId: 'synthetic-R1' } } } });
    expect(new Set(f.sqlValues.filter((_, index) => f.timeline[index]!.includes('open_sop_active_use')).map(values => values[2]))).toEqual(new Set([sopContinuationHash(handle)]));
  });

  it('rejects a new first open after publication and a foreign tuple before reading protected graph bytes', async () => {
    const f = await fixture(); f.controls.current = 'synthetic-R2';
    expect(await f.check(f.request())).toMatchObject({ ok: false, reason: 'SOP_RELEASE_CHANGED' });
    const foreign = await fixture();
    expect(await foreign.check(foreign.request({ graphDigest: '9'.repeat(64) }))).toMatchObject({ ok: false, reason: 'SOP_SNAPSHOT_INVALID' });
    expect(foreign.controls.reads).toBe(0);
  });
});
