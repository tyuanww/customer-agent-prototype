import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseContractSchema as parse,
  CONTRACT_PROVENANCE as GRAPH_PROVENANCE,
  type ContractSchemaName,
  type components as GraphComponents,
} from '@customer-agent/contracts/sop-unified';
import {
  parseContractSchema as parseResource,
  CONTRACT_PROVENANCE as RESOURCE_PROVENANCE,
  type components,
} from '@customer-agent/contracts/sop-resource-disable';
import { SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import {
  graphImageFixtures,
  syntheticGraphMapping,
  syntheticTaskGraphWorkbook,
} from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import { graphFor, type GraphMaterial } from '../src/content-intake/sop-graph.js';
import { digest } from '../src/content-intake/material.js';
import { startApi, type StartedApi } from '../src/server.js';
import { sopGraphDigest } from '../src/sop-unified-query-validation.js';
import {
  createIntakeSyntheticHost,
  type IntakeSyntheticHost,
  type IntakeSyntheticIdentity,
} from './support/intake-synthetic-host.js';

type G = GraphComponents['schemas'];
type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe.skipIf(!enabled).sequential('complete SOP publication through actual intake-compat startApi HTTP', () => {
  let host: Omit<IntakeSyntheticHost, 'candidate' | 'object'>;
  let admin: Client;
  let started: StartedApi | undefined;
  let authorization = '';
  let publication: Awaited<ReturnType<typeof publish>>;
  let factsVersion = 0;
  let sequence = 0;
  let contextGeneration = 0;
  const diagnostics: string[] = [];
  const operation = (label: string) => `runtime-sop-${label}-${++sequence}`;
  const candidatePath = (key: G['IntakeCandidateKey']) =>
    `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;

  async function json(response: Response): Promise<unknown> {
    const body: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(body)}\n${diagnostics.slice(-3).join('\n')}`).toBe(true);
    return body;
  }

  async function checked<Name extends ContractSchemaName>(response: Response, name: Name): Promise<G[Name]> {
    return parse(name, await json(response));
  }

  function seedRequest(actor: IntakeSyntheticIdentity, url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-intake-contract-set', GRAPH_PROVENANCE.contract_set_id);
    return host.requestAs(actor, url, { ...init, headers });
  }

  function seedPost(actor: IntakeSyntheticIdentity, url: string, body: unknown) {
    return seedRequest(actor, url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  function request(url: string, init: RequestInit = {}) {
    if (!started) throw new Error('Actual startApi HTTP server is unavailable');
    const headers = new Headers(init.headers);
    headers.set('authorization', authorization);
    headers.set('x-intake-contract-set', RESOURCE_PROVENANCE.contract_set_id);
    return fetch(`${started.address}${url}`, {
      ...init, headers, signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
  }

  function post(url: string, body: unknown) {
    return request(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  async function publish(baseReleaseId: string, revision: number) {
    const form = new FormData();
    form.set('operationId', operation('upload'));
    const bytes = await syntheticTaskGraphWorkbook({ shopWide: true, sharedTaskImage: true, revision });
    form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'synthetic-runtime-sop.xlsx');
    const object = await checked(await seedRequest('enabler', '/v1/intake/sources/source-a/objects', {
      method: 'POST', body: form,
    }), 'IntakeObject');
    let job = await checked(await seedPost('enabler', '/v1/intake/sources/source-a/candidates', {
      operationId: operation('receive'), objectId: object.objectId, sourceVersion: 2, baseReleaseId,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true },
      expectedPriorKey: null,
    }), 'IntakeParseJob');
    const deadline = Date.now() + 25_000;
    let lastFailure: G['IntakeError'] | null = null;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() >= deadline) {
        throw new Error(`Synthetic native SOP graph parser did not settle: ${JSON.stringify(lastFailure)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      const diagnosticStart = diagnostics.length;
      const response = await seedRequest('enabler', `/v1/intake/parse-jobs/${job.jobId}`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))),
      });
      // The known job's read and parser freeze share the content lock. A GET can recover after that writer commits.
      if (response.status === 500 || response.status === 503) {
        lastFailure = parse('IntakeError', await response.json());
        const observed = diagnostics.slice(diagnosticStart);
        console.warn(JSON.stringify({ event: 'synthetic-job-get-retry', jobId: job.jobId,
          status: response.status, failure: lastFailure, diagnostics: observed }));
        expect(lastFailure.error).toMatchObject({ code: response.status === 503 ? 'OVERLOADED' : 'INTERNAL_ERROR',
          details: { reason: 'COMMIT_UNKNOWN' } });
        expect(observed.some(message => message.includes('canceling statement due to lock timeout'))).toBe(true);
        continue;
      }
      job = await checked(response, 'IntakeParseJob');
    }
    expect(job.state).toBe('validated');
    const candidate = await checked(await seedRequest('enabler',
      `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'IntakeCandidate');
    const key = candidate.key;
    const pages: G['IntakeCandidatePage'][] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: '1', ...(cursor ? { cursor } : {}) });
      const page: G['IntakeCandidatePage'] = await checked(await seedRequest('enabler',
        `${candidatePath(key)}/material?${query}`), 'IntakeCandidatePage');
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor);
    const material = parse('IntakeMaterial', {
      ...pages[0]?.materialHeader, entries: pages.flatMap(page => page.entries),
      differences: pages.flatMap(page => page.differences), sopFlows: pages.flatMap(page => page.sopFlows ?? []),
      sopDifferences: pages.flatMap(page => page.sopDifferences ?? []),
    });
    if (material.canonicalEncodingVersion !== 'candidate-sop-task-graph-v2'
      || !material.sopFlows || !material.sopDifferences || !material.mappingDigest) {
      throw new Error('Normal intake publication did not produce native complete SOP material');
    }
    const graphMaterial: GraphMaterial = {
      ...material, canonicalEncodingVersion: 'candidate-sop-task-graph-v2',
      sopFlows: material.sopFlows, sopDifferences: material.sopDifferences, mappingDigest: material.mappingDigest,
    };
    const flow = graphMaterial.sopFlows[0];
    if (!flow) throw new Error('Synthetic native SOP flow is missing');
    const graph = graphFor(graphMaterial, flow);
    const confirmed = await checked(await seedPost('enabler', `${candidatePath(key)}/source-confirmation`, {
      operationId: operation('confirm'), key, expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque',
      confirmedVersionValue: `synthetic-runtime-sop-${revision}`, acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成六表来源版本与原文件已显式核对',
    }), 'IntakeCandidate');
    await checked(await seedPost('reviewer', `${candidatePath(key)}/quality/freeze`, {
      operationId: operation('freeze'), key,
    }), 'IntakeQualityReceipt');
    const status = await checked(await seedRequest('reviewer',
      `${candidatePath(key)}/quality?digest=${key.digest}`), 'IntakeQualityStatus');
    const faq: G['IntakeQualitySample'][] = [];
    const sop: G['IntakeSopSopQualitySample'][] = [];
    cursor = null;
    do {
      const query = new URLSearchParams({ digest: key.digest, viewHash: status.viewHash,
        phase: 'initial', limit: '1', ...(cursor ? { cursor } : {}) });
      const page: G['IntakeQualitySamplePage'] = await checked(await seedRequest('reviewer',
        `${candidatePath(key)}/quality/samples?${query}`), 'IntakeQualitySamplePage');
      faq.push(...page.items);
      sop.push(...page.sopItems ?? []);
      cursor = page.nextCursor;
    } while (cursor);
    expect(faq.length).toBeGreaterThan(0);
    expect(sop.length).toBeGreaterThan(0);
    const quality = await checked(await seedPost('reviewer', `${candidatePath(key)}/quality/checks`, {
      operationId: operation('checks'), key, phase: 'initial', materialDigest: key.digest,
      checks: faq.map(item => ({ scriptId: item.scriptId, contentHash: item.contentHash, defect: false, reason: '' })),
      sopChecks: sop.map(item => ({ ...item.target, defect: false, reason: '' })),
    }), 'IntakeQualityReceipt');
    expect(quality.state).toBe('passed');
    const receipt = await checked(await seedPost('director', `${candidatePath(key)}/publish`, {
      operationId: operation('publish'), key, baseReleaseId, sourceEvidenceVersion: confirmed.sourceEvidenceVersion,
      title: '合成完整 SOP 发布', summary: '正常六表导入、人工质量检查和确认发布', confirmed: true,
    }), 'IntakeReceipt');
    if (!receipt.releaseId) throw new Error('Normal SOP publication has no release');
    return { key, graph, releaseId: receipt.releaseId };
  }

  async function registerFacts(input: Awaited<ReturnType<typeof publish>>, options: {
    expectedVersion: number; risk: 'low' | 'unclassified'; copy: boolean | null;
  }) {
    const ref = `synthetic:runtime-sop-${input.key.candidateId}`;
    const version = String(options.expectedVersion + 1);
    const document = {
      candidateId: input.key.candidateId, candidateVersion: input.key.version,
      sourceId: input.graph.definition.header.key.sourceId, flowId: input.graph.definition.header.key.flowId,
      graphDigest: sopGraphDigest(input.graph), sopGroup: '税收相关规则',
      permissions: input.graph.entries.map(dep => ({
        entry: { sourceId: dep.sourceId, businessEntryId: dep.entry.businessEntryId, scriptVersion: dep.entry.scriptVersion },
        risk_level: options.risk, copy_allowed: options.copy,
        source_ref: `${ref}@${version}#${dep.entry.businessEntryId}`,
      })),
    };
    const result = await host.writeSopQueryFacts('enabler', {
      operationId: operation('facts'), expectedVersion: options.expectedVersion,
      source: { ref, version, bytes: Buffer.from(JSON.stringify(document)) },
    });
    expect(result, JSON.stringify(result)).toEqual({ ok: true, value: options.expectedVersion + 1 });
    return options.expectedVersion + 1;
  }

  async function createQuery() {
    const generation = ++contextGeneration;
    const entitlement = parseResource('IntakeEntitlement', await json(await post('/v1/intake/entitlements', {
      shopId: 'shop-a', contextGeneration: generation, releaseId: publication.releaseId, productIds: [], scenarioIds: [],
    })));
    const body = parseResource('MenokinSopQuerySopQueryRequest', {
      sop_group: '税收相关规则', shop_id: 'shop-a', query_text: '合成入口',
      context_generation: String(generation), request_id: randomUUID(), entitlement_id: entitlement.entitlementId,
    });
    return { entitlement, body };
  }

  async function readQuery(body: C['MenokinSopQuerySopQueryRequest']) {
    const response = await post('/v1/sop/query', body);
    const value = await json(response);
    expect(response.headers.get('x-intake-contract-set')).toBe(RESOURCE_PROVENANCE.contract_set_id);
    const parsed = parseResource('MenokinSopQuerySopQueryResponse', value);
    expect(parsed.request_id).toBe(body.request_id);
    return parsed;
  }

  beforeAll(async () => {
    host = await createIntakeSyntheticHost({
      prepareCandidate: false, profile: 'purpose-runtime', includeSopQuery: true, includeLegacySearch: false,
      observeSyntheticRequest: (actor, headers) => {
        if (actor === 'agent') authorization = headers.get('authorization') ?? '';
      },
      observeError: error => diagnostics.push(error instanceof Error ? error.stack ?? error.message : String(error)),
      configureDatabase: async client => {
        admin = client;
        await admin.query(`INSERT INTO content_intake.source_mappings(
          source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
          VALUES('source-a',2,$1,$2,$3,$4,$5::jsonb)`, [
          SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion, SOP_TASK_FORMAT.mappingVersion,
          SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping(false, true)),
        ]);
        await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
      },
    });
    publication = await publish('rel_native_base', 1);
    factsVersion = await registerFacts(publication, { expectedVersion: 0, risk: 'low', copy: true });
    await json(await host.requestAs('agent', '/v1/auth/me'));
    expect(authorization).toMatch(/^Bearer \S+$/);
    await admin.query(`CREATE ROLE sop_compatibility_runtime LOGIN; GRANT app_runtime TO sop_compatibility_runtime;
      CREATE ROLE sop_compatibility_admin LOGIN; GRANT app_content_admin TO sop_compatibility_admin`);
    const databasePort = (await admin.query<{ port: string }>('SHOW port')).rows[0]?.port;
    const databaseName = (await admin.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name;
    if (!databasePort || !databaseName) throw new Error('Missing isolated PG15 connection coordinates');
    const connection = (user: string) => `postgresql://${user}@localhost/${databaseName}?${new URLSearchParams({
      host: path.join(host.root, 'socket'), port: databasePort,
    })}`;
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const address = reservation.address();
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    if (!address || typeof address === 'string') throw new Error('Missing actual API loopback port');
    started = await startApi({ environment: {
      CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
      CUSTOMER_AGENT_QUERY_MODE: 'intake-compat', CUSTOMER_AGENT_API_PORT: String(address.port),
      SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: host.identityOrigin,
      DATABASE_URL: connection('sop_compatibility_runtime'), CONTENT_ADMIN_DATABASE_URL: connection('sop_compatibility_admin'),
      AUTH_DATABASE_URL: connection('stack_backend_auth'), INTAKE_BUSINESS_DATABASE_URL: connection('synthetic_business'),
      INTAKE_USAGE_DATABASE_URL: connection('synthetic_usage'), INTAKE_WORKER_DATABASE_URL: connection('synthetic_worker'),
      CONTENT_OBJECT_STORE_DIR: path.join(host.root, 'objects'),
      IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-runtime-sop-idempotency-0001' }),
      IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
      LOG_HASH_KEY: 'synthetic-runtime-sop-log-hash-0001', LOG_HASH_KEY_VERSION: 'hmac-log-v1',
    } });
  }, 120_000);

  afterAll(async () => {
    try { await started?.close(); }
    finally { await host?.close(); }
  });

  it('serves ready complete graph, copy-authorized original text and required media through current handles', async () => {
    const readyResponse = await request('/ready');
    expect(readyResponse.headers.get('x-customer-agent-query-mode')).toBe('intake-compat');
    parseResource('ReadyResponse', await json(readyResponse));
    const { entitlement, body } = await createQuery();
    const ready = await readQuery(body);
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('Actual intake-compat SOP query did not become ready');
    expect(ready.release_id).toBe(publication.releaseId);
    expect(ready.result.graph_digest).toBe(sopGraphDigest(publication.graph));
    expect(ready.result.flow).toEqual(publication.graph.definition);
    expect(ready.result.entries).toEqual(publication.graph.entries);
    expect(ready.result.entries.map(dep => dep.entry.answerText)).toEqual(['合成对客原文 A\n版本 1', '合成对客原文 B']);
    expect(ready.result.permissions).toHaveLength(2);
    for (const permission of ready.result.permissions) {
      expect(permission).toMatchObject({ risk_level: 'low', copy_allowed: true });
      expect(permission.source_ref).toMatch(/^synthetic:runtime-sop-/);
    }
    expect(ready.result.media).toHaveLength(4);
    expect(ready.result.media.map(item => item.binding)).toEqual(publication.graph.media);
    expect(ready.result.media.every(item => item.binding.required)).toBe(true);
    expect(new Set(ready.result.media.map(item => item.preview_handle)).size).toBe(4);
    const opening = parseResource('IntakeSopActionCheck', {
      entitlementId: entitlement.entitlementId, releaseId: publication.releaseId,
      contextGeneration: entitlement.contextGeneration, key: ready.result.flow.header.key,
      graphDigest: ready.result.graph_digest, nodeId: ready.result.flow.header.startNodeId,
      action: 'open', edgeId: null, entry: null, continuationId: `sct_${randomBytes(32).toString('hex')}`,
      queryRequestId: body.request_id,
    });
    const opened = parseResource('IntakeSopContinuationReceipt', await json(await post('/v1/intake/sop/check', opening)));
    for (const dep of ready.result.entries) {
      const node = ready.result.flow.nodes.find(item => item.body.scripts.some(script =>
        script.entry.sourceId === dep.sourceId && script.entry.businessEntryId === dep.entry.businessEntryId
        && script.entry.scriptVersion === dep.entry.scriptVersion));
      if (!node) throw new Error('Ready original text has no task reference');
      const response = await post('/v1/intake/sop/check', {
        ...opening, entitlementId: opened.entitlement.entitlementId, queryRequestId: null,
        action: 'copy', nodeId: node.id,
        entry: { sourceId: dep.sourceId, businessEntryId: dep.entry.businessEntryId, scriptVersion: dep.entry.scriptVersion },
      });
      expect(response.status, await response.text()).toBe(204);
    }
    const owners = new Set<string>();
    for (const { binding } of ready.result.media) {
      const ownerKind = binding.entry ? 'entry' : binding.graphTarget?.kind;
      const ownerId = binding.entry?.businessEntryId ?? binding.graphTarget?.id;
      if (!ownerKind || !ownerId) throw new Error('Required media has no authorized owner');
      owners.add(ownerKind);
      const query = new URLSearchParams({
        entitlementId: opened.entitlement.entitlementId, sourceId: binding.flowKey.sourceId,
        flowId: binding.flowKey.flowId, ownerKind, ownerId, resourceId: binding.resourceId,
      });
      const url = `/v1/intake/sop/releases/${publication.releaseId}/media/${binding.objectId}?${query}`;
      const response = await request(url, { headers: { 'x-sop-continuation': opening.continuationId } });
      const payload = parseResource('IntakeSopMediaPayload', await json(response));
      expect(payload.mime).toBe(binding.mime);
      const bytes = Buffer.from(payload.base64, 'base64');
      expect(digest(bytes)).toBe(binding.sha256);
      expect(bytes).toEqual(graphImageFixtures.get(binding.resourceId)?.bytes);
      const missingHandle = await request(url);
      expect(missingHandle.status).toBe(404);
      expect(parseResource('IntakeError', await missingHandle.json()).error.details.reason).toBe('SCOPE_DENIED');
    }
    expect([...owners].sort()).toEqual(['entry', 'knowledge', 'task']);
  }, 60_000);

  it.each([
    { label: 'unclassified original risk', risk: 'unclassified', copy: true },
    { label: 'unknown original copy permission', risk: 'low', copy: null },
  ] satisfies { label: string; risk: 'low' | 'unclassified'; copy: boolean | null }[])(
    'blocks $label without returning protected graph or text', async ({ risk, copy }) => {
      factsVersion = await registerFacts(publication, { expectedVersion: factsVersion, risk, copy });
      const { body } = await createQuery();
      const blocked = await readQuery(body);
      expect(blocked.status).toBe('blocked');
      expect(blocked.result).toBeNull();
      expect(blocked.reasons).toEqual([{ code: 'SAFETY_REVIEW_REQUIRED' }]);
      expect(await readQuery(body)).toEqual(blocked);
    },
  );

  it('invalidates the old query after normal republication and serves the new original text', async () => {
    factsVersion = await registerFacts(publication, { expectedVersion: factsVersion, risk: 'low', copy: true });
    const previous = await createQuery();
    expect((await readQuery(previous.body)).status).toBe('ready');
    publication = await publish(publication.releaseId, 2);
    factsVersion = await registerFacts(publication, { expectedVersion: 0, risk: 'low', copy: true });
    const stale = await readQuery(previous.body);
    expect(stale.status).toBe('stale');
    expect(stale.result).toBeNull();
    expect(stale.reasons).toEqual([{ code: 'STALE_RELEASE' }]);
    const current = await readQuery((await createQuery()).body);
    expect(current.status).toBe('ready');
    if (current.status !== 'ready') throw new Error('Republished SOP query did not become ready');
    expect(current.release_id).toBe(publication.releaseId);
    expect(current.result.entries.map(dep => dep.entry.answerText)).toEqual(['合成对客原文 A\n版本 2', '合成对客原文 B']);
  }, 60_000);

  it('rejects the old query and a fresh query after parent query authority is revoked', async () => {
    const previous = await createQuery();
    expect((await readQuery(previous.body)).status).toBe('ready');
    const revoked = await admin.query(`UPDATE content_intake.grants
      SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成父查询授权撤销'
      WHERE kind='allocation' AND action='query' AND parent_grant_id IS NULL AND scope_id='scope-a'
      RETURNING grant_id`);
    expect(revoked.rowCount).toBeGreaterThan(0);
    for (const body of [previous.body, { ...previous.body, request_id: randomUUID() }]) {
      const response = await post('/v1/sop/query', body);
      expect(response.status, await response.clone().text()).toBe(403);
      expect(parseResource('ForbiddenOrPolicyDeniedErrorEnvelope', await response.json()).error.code).toBe('FORBIDDEN');
    }
  });
});
