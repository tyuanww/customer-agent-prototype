import { randomBytes, randomUUID } from 'node:crypto';
import { parseContractSchema as parseResource, CONTRACT_PROVENANCE as RESOURCE_PROVENANCE } from '@customer-agent/contracts/sop-resource-disable';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type ContractSchemaName, type components } from '@customer-agent/contracts/sop-unified';
import { SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import { syntheticGraphMapping, syntheticTaskGraphWorkbook } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import { createIntakeSyntheticHost, type IntakeSyntheticHost, type IntakeSyntheticIdentity } from './support/intake-synthetic-host.js';
import { graphFor, type GraphMaterial } from '../src/content-intake/sop-graph.js';
import { digest, canonical } from '../src/content-intake/material.js';
import { SOP_UNIFIED_QUERY_CONTRACT_SET_ID, type UnifiedSopQueryRequest } from '../src/sop-unified-query-model.js';
import { parseUnifiedSopQueryResponse, sopGraphDigest } from '../src/sop-unified-query-validation.js';
import { parseOwnerReviewedSopFacts } from '../src/sop-owner-reviewed-query-facts.js';
import type { IntakePool } from '../src/content-intake/transaction.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_SOP_QUERY_PG15_INTEGRATION === '1';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
describe.skipIf(!enabled).sequential('owner-reviewed file facts through the existing SOP query consumer', () => {
  let host: Pick<IntakeSyntheticHost, 'requestAs' | 'close' | 'writeSopQueryFacts' | 'writeOwnerReviewedSopQueryFacts' | 'root'>;
  let admin: Client;
  let sequence = 0;
  let loseCommit = false;
  let delayAfterFacts = 0;
  let directorToken = '';
  let databaseTarget: { host: string; port: string; database: string } | undefined;
  let published: Awaited<ReturnType<typeof publish>>;
  const diagnostics: string[] = [];
  const operation = (kind: string) => `owner-facts-${kind}-${++sequence}`;
  const candidatePath = (key: C['IntakeCandidateKey']) => `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  const request = (actor: IntakeSyntheticIdentity, pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set('x-intake-contract-set', SOP_UNIFIED_QUERY_CONTRACT_SET_ID);
    return host.requestAs(actor, pathname, { ...init, headers });
  };
  const post = (actor: IntakeSyntheticIdentity, pathname: string, body: unknown) => request(actor, pathname,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function checked<Name extends ContractSchemaName>(response: Response, name: Name): Promise<C[Name]> {
    const value: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(value)} ${diagnostics.slice(-2)}`).toBe(true);
    return parse(name, value);
  }
  function uncertain(pool: IntakePool): IntakePool {
    return { connect: async () => {
      const client = await pool.connect(); let committed = false;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (loseCommit && sql.startsWith('SELECT to_jsonb(content_intake.write_owner_reviewed_sop_query_facts')) committed = true;
          if (delayAfterFacts && sql.startsWith('SELECT to_jsonb(content_intake.write_owner_reviewed_sop_query_facts')) {
            const delay = delayAfterFacts; delayAfterFacts = 0; await new Promise(resolve => setTimeout(resolve, delay));
          }
          if (committed && sql === 'COMMIT') { loseCommit = false; throw new Error('SYNTHETIC_COMMIT_ACKNOWLEDGEMENT_LOST'); }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
  }
  beforeAll(async () => {
    host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', includeSopQuery: true,
      includeSopContinuation: true, includeLegacySearch: false, wrapBusinessPool: uncertain,
      observeError: error => diagnostics.push(String(error)),
      observeSyntheticRequest: (actor, headers) => { if (actor === 'director') directorToken = headers.get('authorization')?.replace(/^Bearer /, '') ?? ''; },
      configureDatabase: async client => {
        admin = client;
        databaseTarget = (await admin.query<{ host: string; port: string; database: string }>(
          "SELECT current_setting('unix_socket_directories') AS host,current_setting('port') AS port,current_database() AS database")).rows[0];
        await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
          VALUES('source-a',2,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion,
          SOP_TASK_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping(false, true))]);
        await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
      } });
    published = await publish('source-a', 'rel_native_base');
  }, 120_000);
  afterAll(async () => { await host?.close(); });
  async function publish(sourceId: string, base: string, revision = 1, effectiveTo?: string) {
    const form = new FormData(); form.set('operationId', operation('upload'));
    const artifactBytes = await syntheticTaskGraphWorkbook({ shopWide: true, revision, queryBudgetProbe: sourceId === 'source-query-large', sharedTaskImage: sourceId === 'source-a', narrowKnowledgeImage: sourceId === 'source-query-b', ...(effectiveTo ? { effectiveTo } : {}) });
    form.set('file', new Blob([new Uint8Array(artifactBytes)], { type: mime }), 'synthetic-query.xlsx');
    const object = await checked(await request('enabler', `/v1/intake/sources/${sourceId}/objects`, { method: 'POST', body: form }), 'IntakeObject');
    let job = await checked(await post('enabler', `/v1/intake/sources/${sourceId}/candidates`, {
      operationId: operation('receive'), objectId: object.objectId, sourceVersion: sourceId === 'source-a' ? 2 : 1, baseReleaseId: base,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
    }), 'IntakeParseJob');
    const deadline = Date.now() + 25_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() >= deadline) throw new Error('Synthetic query graph parser did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
      job = await checked(await request('enabler', `/v1/intake/parse-jobs/${job.jobId}`), 'IntakeParseJob');
    }
    expect(job.state).toBe('validated');
    const candidate = await checked(await request('enabler', `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'IntakeCandidate');
    const key = candidate.key, pages: C['IntakeCandidatePage'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeCandidatePage'] = await checked(await request('enabler', `${candidatePath(key)}/material?limit=1${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeCandidatePage');
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    const material = parse('IntakeMaterial', { ...pages[0]!.materialHeader, entries: pages.flatMap(page => page.entries),
      differences: pages.flatMap(page => page.differences), sopFlows: pages.flatMap(page => page.sopFlows ?? []),
      sopDifferences: pages.flatMap(page => page.sopDifferences ?? []) });
    if (material.canonicalEncodingVersion !== 'candidate-sop-task-graph-v2' || !material.sopFlows || !material.sopDifferences || !material.mappingDigest) throw new Error('Missing frozen graph material');
    const graphMaterial: GraphMaterial = { ...material, canonicalEncodingVersion: 'candidate-sop-task-graph-v2',
      sopFlows: material.sopFlows, sopDifferences: material.sopDifferences, mappingDigest: material.mappingDigest };
    const graph = graphFor(graphMaterial, graphMaterial.sopFlows[0]!);
    const confirmed = await checked(await post('enabler', `${candidatePath(key)}/source-confirmation`, {
      operationId: operation('confirm'), key, expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque',
      confirmedVersionValue: `synthetic-query-source-${revision}`, acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成来源版本与原文件已显式核对',
    }), 'IntakeCandidate');
    await checked(await post('reviewer', `${candidatePath(key)}/quality/freeze`, { operationId: operation('freeze'), key }), 'IntakeQualityReceipt');
    const qualityStatus = await checked(await request('reviewer', `${candidatePath(key)}/quality?digest=${key.digest}`), 'IntakeQualityStatus');
    const faq: C['IntakeQualitySample'][] = [], sop: C['IntakeSopSopQualitySample'][] = [];
    cursor = null;
    do {
      const page: C['IntakeQualitySamplePage'] = await checked(await request('reviewer', `${candidatePath(key)}/quality/samples?digest=${key.digest}&viewHash=${qualityStatus.viewHash}&phase=initial&limit=1${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeQualitySamplePage');
      faq.push(...page.items); sop.push(...page.sopItems ?? []); cursor = page.nextCursor;
    } while (cursor);
    const quality = await checked(await post('reviewer', `${candidatePath(key)}/quality/checks`, { operationId: operation('check'), key,
      phase: 'initial', materialDigest: key.digest, checks: faq.map(item => ({ scriptId: item.scriptId, contentHash: item.contentHash, defect: false, reason: '' })),
      sopChecks: sop.map(item => ({ ...item.target, defect: false, reason: '' })) }), 'IntakeQualityReceipt');
    expect(quality.state).toBe('passed');
    const receipt = await checked(await post('director', `${candidatePath(key)}/publish`, { operationId: operation('publish'), key,
      baseReleaseId: base, sourceEvidenceVersion: confirmed.sourceEvidenceVersion, title: '合成查询图发布', summary: '完整正常HTTP写链', confirmed: true }), 'IntakeReceipt');
    return { key, graph, artifactBytes, artifactSha256: object.sha256, releaseId: receipt.releaseId! };
  }

  function command(expectedVersion: number, risk: 'low' | 'unclassified' = 'low', copy: boolean | null = true) {
    const version = `review-${randomUUID()}`;
    const originalSha256 = digest('explicit synthetic original workbook');
    const ref = `owner-reviewed-file:${originalSha256}`;
    const source = { kind: 'owner-reviewed-file', originalSha256,
      artifactSha256: published.artifactSha256, reviewedByPrincipalId: 'director',
      document: { candidateId: published.key.candidateId, candidateVersion: published.key.version, sourceId: 'source-a',
        flowId: published.graph.definition.header.key.flowId, graphDigest: sopGraphDigest(published.graph), sopGroup: '品质售后SOP',
        permissions: published.graph.entries.map(dep => ({
          entry: { sourceId: dep.sourceId, businessEntryId: dep.entry.businessEntryId, scriptVersion: dep.entry.scriptVersion },
          risk_level: risk, copy_allowed: copy, source_ref: `${ref}@${version}#${dep.entry.businessEntryId}`,
        })) } };
    return { operationId: operation('register'), expectedVersion, source: { version, bytes: Buffer.from(JSON.stringify(source)) } };
  }
  function runCli(input: ReturnType<typeof command>) {
    const folder = host.root;
    const configPath = path.join(folder, 'owner-facts-config.json');
    const tokenPath = path.join(folder, 'owner-facts-token.txt');
    const documentPath = path.join(folder, 'owner-facts-document.json');
    const originalPath = path.join(folder, 'owner-facts-original.xlsx');
    const artifactPath = path.join(folder, 'owner-facts-artifact.xlsx');
    if (!databaseTarget) throw new Error('Missing isolated database target');
    const target = databaseTarget;
    const databaseUrl = (login: string) => `postgresql://${login}@localhost/${target.database}?${new URLSearchParams({ host: target.host, port: target.port })}`;
    writeFileSync(configPath, JSON.stringify({ authMode: 'mock', authDatabase: databaseUrl('stack_backend_auth'),
      businessDatabase: databaseUrl('synthetic_business') }), { mode: 0o600 });
    writeFileSync(tokenPath, directorToken, { mode: 0o600 });
    writeFileSync(documentPath, input.source.bytes, { mode: 0o600 });
    writeFileSync(originalPath, 'explicit synthetic original workbook', { mode: 0o600 });
    writeFileSync(artifactPath, published.artifactBytes, { mode: 0o600 });
    const cli = fileURLToPath(new URL('../../../scripts/ops/register-owner-reviewed-sop-facts.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '--config', configPath, '--token-file', tokenPath,
      '--document', documentPath, '--original', originalPath, '--artifact', artifactPath,
      '--source-version', input.source.version, '--expected-version', String(input.expectedVersion),
      '--operation-id', input.operationId, '--apply'], { encoding: 'utf8', timeout: 30_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  async function query() {
    const body: UnifiedSopQueryRequest = { sop_group: '品质售后SOP', shop_id: 'shop-a', query_text: '合成入口',
      context_generation: 'owner-file-fixture', request_id: randomUUID() };
    const response = await post('agent', '/v1/sop/query', body);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    return parseUnifiedSopQueryResponse(await response.json(), body.request_id);
  }
  it('preserves explicit unknown declarations and consumes owner-confirmed facts through normal query', async () => {
    expect(await host.writeOwnerReviewedSopQueryFacts('director', command(0, 'unclassified', null))).toEqual({ ok: true, value: 1 });
    const blocked = await query();
    expect(blocked.status).toBe('blocked'); expect(blocked.reasons).toEqual([{ code: 'SAFETY_REVIEW_REQUIRED' }]);
    const input = command(1);
    expect(runCli(input).status).toBe('APPLIED');
    expect(runCli(input).factVersion).toBe(2);
    const ready = await query(); expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('Expected owner-reviewed query result');
    expect(ready.result.permissions.every(p => p.source_ref.startsWith('owner-reviewed-file:'))).toBe(true);
    expect(ready.result.graph_digest).toBe(sopGraphDigest(published.graph));
    expect(ready.result.media.length).toBeGreaterThan(0);
    const headers = { 'x-intake-contract-set': RESOURCE_PROVENANCE.contract_set_id, 'content-type': 'application/json' };
    const resourcePost = (url: string, body: unknown) => host.requestAs('agent', url,
      { method: 'POST', headers, body: JSON.stringify(body) });
    const entitlementResponse = await resourcePost('/v1/intake/entitlements', { shopId: 'shop-a', contextGeneration: 100,
      releaseId: null, productIds: [], scenarioIds: [] });
    const entitlement = parseResource('IntakeEntitlement', await entitlementResponse.json());
    const queryRequest = { sop_group: '品质售后SOP', shop_id: 'shop-a', query_text: '合成入口',
      context_generation: 'owner-reviewed-media', request_id: randomUUID(), entitlement_id: entitlement.entitlementId };
    const resourceResponse = await resourcePost('/v1/sop/query', queryRequest);
    const resourceReady = parseResource('MenokinSopQuerySopQueryResponse', await resourceResponse.json());
    expect(resourceReady.status).toBe('ready');
    if (resourceReady.status !== 'ready') throw new Error('Expected owner-reviewed resource query');
    const opening = { entitlementId: entitlement.entitlementId, releaseId: published.releaseId, contextGeneration: 100,
      key: resourceReady.result.flow.header.key, graphDigest: resourceReady.result.graph_digest,
      nodeId: resourceReady.result.flow.header.startNodeId, action: 'open', edgeId: null, entry: null,
      continuationId: `sct_${randomBytes(32).toString('hex')}`, queryRequestId: queryRequest.request_id };
    const openedResponse = await resourcePost('/v1/intake/sop/check', opening);
    expect(openedResponse.status).toBe(200);
    const opened = parseResource('IntakeSopContinuationReceipt', await openedResponse.json());
    const scripted = resourceReady.result.flow.nodes.find(node => node.body.scripts.length);
    if (!scripted?.body.scripts[0]) throw new Error('Expected a published copyable entry');
    expect((await resourcePost('/v1/intake/sop/check', { ...opening, entitlementId: opened.entitlement.entitlementId,
      queryRequestId: null, action: 'copy', nodeId: scripted.id, entry: scripted.body.scripts[0].entry })).status).toBe(204);
    for (const media of resourceReady.result.media) {
      const binding = media.binding;
      const ownerKind = binding.entry ? 'entry' : binding.graphTarget!.kind;
      const search = new URLSearchParams({ entitlementId: opened.entitlement.entitlementId, sourceId: binding.flowKey.sourceId,
        flowId: binding.flowKey.flowId, ownerKind, ownerId: binding.entry?.businessEntryId ?? binding.graphTarget!.id,
        resourceId: binding.resourceId });
      const response = await host.requestAs('agent', `/v1/intake/sop/releases/${published.releaseId}/media/${binding.objectId}?${search}`,
        { headers: { ...headers, 'x-sop-continuation': opening.continuationId } });
      expect(response.status, await response.clone().text()).toBe(200);
      const payload = parseResource('IntakeSopMediaPayload', await response.json());
      expect(digest(Buffer.from(payload.base64, 'base64'))).toBe(binding.sha256);
    }
    const row = (await admin.query('SELECT original_sha256,artifact_sha256,reviewed_by,source_text FROM content_intake.sop_query_owner_reviews WHERE facts_version=2')).rows[0];
    expect(row.reviewed_by).toBe('director'); expect(digest(row.source_text)).toBe(parseOwnerReviewedSopFacts(input.source).sourceSha256);
  });
  it('rejects mismatched publication bytes, reviewer identity, graph, permissions and source text hashes', async () => {
    const base = command(2);
    const value = JSON.parse(base.source.bytes.toString('utf8'));
    for (const changed of [{ ...value, artifactSha256: 'f'.repeat(64) }, { ...value, reviewedByPrincipalId: 'enabler' },
      { ...value, document: { ...value.document, graphDigest: 'e'.repeat(64) } },
      { ...value, document: { ...value.document, permissions: [] } }]) {
      const result = await host.writeOwnerReviewedSopQueryFacts('director', { ...base, operationId: operation('invalid'),
        source: { ...base.source, bytes: Buffer.from(JSON.stringify(changed)) } });
      expect(result.ok).toBe(false);
    }
    expect((await host.writeOwnerReviewedSopQueryFacts('enabler', base)).ok).toBe(false);
    const parsed = parseOwnerReviewedSopFacts(base.source);
    await expect(admin.query('SELECT content_intake.write_owner_reviewed_sop_query_facts($1,$2,$3::jsonb)',
      ['director', operation('hash'), canonical({ sourceText: parsed.sourceText, sourceVersion: parsed.sourceVersion,
        sourceSha256: '0'.repeat(64), expectedVersion: 2 })])).rejects.toThrow('FILE_INVALID');
    expect((await admin.query('SELECT count(*)::int AS n FROM content_intake.sop_query_owner_reviews')).rows[0].n).toBe(2);
  });
  it('serializes version CAS and recovers a lost commit receipt without duplicating facts', async () => {
    const input = command(2); loseCommit = true;
    expect(await host.writeOwnerReviewedSopQueryFacts('director', input)).toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN' });
    expect(await host.writeOwnerReviewedSopQueryFacts('director', input)).toEqual({ ok: true, value: 3 });
    const conflict = { ...input, source: command(2).source };
    expect(await host.writeOwnerReviewedSopQueryFacts('director', conflict)).toMatchObject({ ok: false, reason: 'IDEMPOTENCY_CONFLICT' });
    const outcomes = await Promise.all([command(3), command(3)].map(x => host.writeOwnerReviewedSopQueryFacts('director', x)));
    expect(outcomes.filter(x => x.ok)).toEqual([{ ok: true, value: 4 }]);
    expect(outcomes.filter(x => !x.ok)).toEqual([expect.objectContaining({ reason: 'MATERIAL_CHANGED' })]);
  });
  it('keeps the synthetic writer compatible and checks authorization before recovering a receipt', async () => {
    const input = command(4); expect(await host.writeOwnerReviewedSopQueryFacts('director', input)).toEqual({ ok: true, value: 5 });
    const parsed = parseOwnerReviewedSopFacts(input.source);
    const ref = 'synthetic:retained-writer', version = 'fixture-v1';
    const document = { ...parsed.document, permissions: parsed.document.permissions.map(p => ({ ...p,
      source_ref: `${ref}@${version}#${p.entry.businessEntryId}` })) };
    expect(await host.writeSopQueryFacts('enabler', { operationId: operation('synthetic'), expectedVersion: 5,
      source: { ref, version, bytes: Buffer.from(JSON.stringify(document)) } })).toEqual({ ok: true, value: 6 });
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='synthetic source permission revoked' WHERE recipient_id='director' AND kind='business' AND action='import'");
    expect(await host.writeOwnerReviewedSopQueryFacts('director', input)).toMatchObject({ ok: false, reason: 'SCOPE_DENIED' });
  });
  it('rolls back a registration whose source permission expires after the SQL write and before commit', async () => {
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES('short-owner-import','business','reviewer','director','tenant-a','app-a','scope-a','source-a','import',
        clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 second','synthetic bounded owner import','reviewer','alloc-reviewer-import')`);
    delayAfterFacts = 1500;
    expect(await host.writeOwnerReviewedSopQueryFacts('director', command(6))).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED', commit: 'rolled_back' });
    expect((await admin.query('SELECT count(*)::int AS n FROM content_intake.sop_query_owner_reviews')).rows[0].n).toBe(5);
  });

});
