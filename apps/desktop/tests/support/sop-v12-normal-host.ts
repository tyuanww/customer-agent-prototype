import { randomUUID, createHash } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts/sop-resource-disable';
import { SOP_RESOURCE_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import type { Client } from 'pg';
import { createIntakeSyntheticHost, type DesktopSyntheticIdentity } from '../../../api/tests/support/intake-synthetic-host';
import { graphFor } from '../../../api/src/content-intake/sop-graph';
import { canonical } from '../../../api/src/content-intake/material';
import { parseContractSchema as parseMaterial, withIntakeView } from '../../../api/src/content-intake/contract-view';
import type { IntakePool } from '../../../api/src/content-intake/transaction';
import { syntheticGraphMapping, syntheticTaskGraphWorkbook, syntheticResourceDisableWorkbook, graphImageFixtures } from '../../../../packages/content-intake/tests/support/sop-task-graph-workbook';
import { SOP_RESOURCE_CONTRACT } from '../../src/shared/sop-unified';
import { unifiedFixture } from './sop-unified-fixture';

type C = components['schemas'];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const candidatePath = (key: C['IntakeCandidateKey']) => `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;

/** Normal PostgreSQL/auth/B/C/D host. Only invented authorization and source configuration is seeded. */
export async function createSopV12NormalHost() {
  let database: Client | undefined;
  let lostResponse: 'query' | 'open' | null = null;
  const diagnostics: string[] = [];
  const faultAfterCommit = (pool: IntakePool): IntakePool => ({
    connect: async () => {
      const client = await pool.connect();
      let completed = false;
      return new Proxy(client, {
        get(target, key) {
          if (key === 'query') return async (sql: string, values?: unknown[]) => {
            const result = await target.query(sql, values);
            if (lostResponse === 'query' && sql.startsWith('SELECT content_intake.complete_sop_unified_query')) completed = true;
            if (lostResponse === 'open' && sql.startsWith('SELECT content_intake.open_sop_active_use')) completed = true;
            if (sql === 'COMMIT' && completed && lostResponse !== null) {
              lostResponse = null;
              throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_REAL_COMMIT');
            }
            return result;
          };
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  });
  const host = await createIntakeSyntheticHost({
    prepareCandidate: false, profile: 'purpose-runtime', includeSopQuery: true, includeSopContinuation: true,
    includeLegacySearch: true,
    wrapBusinessPool: faultAfterCommit, wrapUsagePool: faultAfterCommit,
    observeError: error => {
      diagnostics.push(error instanceof Error ? `${error.stack}\n${JSON.stringify({
        issues: Reflect.get(error, 'issues'), code: Reflect.get(error, 'code'), detail: Reflect.get(error, 'detail'),
      })}` : String(error));
    },
    configureDatabase: async client => {
      database = client;
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO content_intake.scopes SELECT (jsonb_populate_record(NULL::content_intake.scopes,
          to_jsonb(s)||jsonb_build_object('scope_id','scope-resource','domain','sop'))).* FROM content_intake.scopes s WHERE scope_id='scope-a'`);
        for (const [id, kind] of [['product-graph', 'product'], ['product-extra', 'product'], ['scenario-graph', 'scenario']]) {
          await client.query('INSERT INTO content_intake.vocabulary VALUES($1,$2,$3,$4,true)', [id, 'scope-resource', kind, hash(id!)]);
          await client.query('INSERT INTO content_intake.vocabulary_displays VALUES($1,1,$2)', [id, `合成词项 ${id}`]);
        }
        for (const [sourceId, solo, optional] of [['source-resource', false, false], ['source-optional', false, true], ['source-solo', true, false]] as const) {
          const mapping = syntheticGraphMapping(solo, solo);
          if (optional) for (const image of Object.values(mapping.images)) image.required = false;
          await client.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES($1,'scope-resource',2,'v2-preview')", [sourceId]);
          await client.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
            VALUES($1,2,$2,$3,$4,$5,$6::jsonb)`, [sourceId, SOP_RESOURCE_FORMAT.templateVersion, SOP_RESOURCE_FORMAT.ruleVersion,
            SOP_RESOURCE_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(mapping)]);
          await client.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
            to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-'||$1::text,'scope_id','scope-resource',
            'source_id',CASE WHEN source_id IS NULL THEN NULL ELSE $1::text END,
            'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'-'||$1::text END))).*
            FROM content_intake.grants g WHERE scope_id='scope-a'
            ORDER BY CASE kind WHEN 'allocation' THEN 0 WHEN 'delegation' THEN 1 ELSE 2 END`, [sourceId]);
          await client.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
            SELECT tenant_id,app_id,version,'scope-resource',$1,content_valid_until FROM content_intake.store_set_members WHERE source_id='source-a'`, [sourceId]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  });
  if (!database) { await host.close(); throw new Error('Normal fixture database unavailable'); }
  const admin = database;
  host.selectIdentity('agent');
  const request = (actor: DesktopSyntheticIdentity, url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-intake-contract-set', SOP_RESOURCE_CONTRACT);
    return host.requestAs(actor, url, { ...init, headers });
  };
  const post = (actor: DesktopSyntheticIdentity, url: string, body: unknown) => request(actor, url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  async function parsed<Name extends keyof C & Parameters<typeof parseContractSchema>[0]>(response: Response, schema: Name): Promise<C[Name]> {
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Normal fixture ${response.status}: ${JSON.stringify(body)}`);
    return parseContractSchema(schema, body);
  }
  async function publish(options: { sourceId?: string; revision?: number; validImages?: boolean; disable?: string[] } = {}) {
    const sourceId = options.sourceId ?? 'source-resource';
    const old = graphImageFixtures.get('image-entry');
    let bytes: Buffer;
    try {
      if (options.validImages) graphImageFixtures.set('image-entry', { bytes: unifiedFixture().image, extension: 'png' });
      bytes = options.disable ? await syntheticResourceDisableWorkbook(options.disable)
        : await syntheticTaskGraphWorkbook({ sharedTaskImage: true, solo: sourceId === 'source-solo',
          shopWide: sourceId === 'source-solo', revision: options.revision ?? 1 });
    } finally {
      if (old) graphImageFixtures.set('image-entry', old);
    }
    const current = await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1');
    const baseReleaseId: string = current.rows[0].current_release_id;
    const form = new FormData();
    form.set('operationId', randomUUID());
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-desktop-sop.xlsx');
    const object = await parsed(await request('enabler', `/v1/intake/sources/${sourceId}/objects`, { method: 'POST', body: form }), 'IntakeObject');
    let job = await parsed(await post('enabler', `/v1/intake/sources/${sourceId}/candidates`, {
      operationId: randomUUID(), objectId: object.objectId, sourceVersion: 2, baseReleaseId, expectedPriorKey: null,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true },
    }), 'IntakeParseJob');
    const until = Date.now() + 25_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() > until) throw new Error('Normal parser did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
      job = await parsed(await request('enabler', `/v1/intake/parse-jobs/${job.jobId}`), 'IntakeParseJob');
    }
    if (job.state !== 'validated') throw new Error(`Normal parser state ${JSON.stringify(job)}`);
    const candidate = await parsed(await request('enabler', `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'IntakeCandidate');
    const key = candidate.key, pages: C['IntakeCandidatePage'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeCandidatePage'] = await parsed(await request('enabler', `${candidatePath(key)}/material?limit=100${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeCandidatePage');
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    const material = withIntakeView('resource-disable', () => parseMaterial('IntakeMaterial', { ...pages[0]!.materialHeader,
      entries: pages.flatMap(page => page.entries), differences: pages.flatMap(page => page.differences),
      sopFlows: pages.flatMap(page => page.sopFlows ?? []), sopDifferences: pages.flatMap(page => page.sopDifferences ?? []),
      resourceDisables: pages.flatMap(page => page.resourceDisables) }));
    if (material.canonicalEncodingVersion !== 'candidate-sop-resource-disable-v1') throw new Error('Normal v12 material required');
    const confirmed = await parsed(await post('enabler', `${candidatePath(key)}/source-confirmation`, {
      operationId: randomUUID(), key, expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque',
      confirmedVersionValue: `synthetic-desktop-${options.revision ?? 1}`, acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成资料及资源逐项确认', resourceDisableSetDigest: material.resourceDisableSetDigest,
    }), 'IntakeCandidate');
    await parsed(await post('reviewer', `${candidatePath(key)}/quality/freeze`, { operationId: randomUUID(), key }), 'IntakeQualityReceipt');
    const quality = await parsed(await request('reviewer', `${candidatePath(key)}/quality?digest=${key.digest}`), 'IntakeQualityStatus');
    const samples: C['IntakeQualitySamplePage'][] = []; cursor = null;
    do {
      const page: C['IntakeQualitySamplePage'] = await parsed(await request('reviewer', `${candidatePath(key)}/quality/samples?digest=${key.digest}&viewHash=${quality.viewHash}&phase=initial&limit=100${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeQualitySamplePage');
      samples.push(page); cursor = page.nextCursor;
    } while (cursor);
    await parsed(await post('reviewer', `${candidatePath(key)}/quality/checks`, {
      operationId: randomUUID(), key, materialDigest: key.digest, phase: 'initial',
      checks: samples.flatMap(page => page.items).map(sample => ({ scriptId: sample.scriptId, contentHash: sample.contentHash, defect: false, reason: '' })),
      sopChecks: samples.flatMap(page => page.sopItems ?? []).map(sample => ({ ...sample.target, defect: false, reason: '' })),
      resourceDisableChecks: samples.flatMap(page => page.resourceDisableItems).map(sample => ({ target: sample.target, defect: false, reason: '' })),
    }), 'IntakeQualityReceipt');
    const receipt = await parsed(await post('director', `${candidatePath(key)}/publish`, {
      operationId: randomUUID(), key, baseReleaseId, sourceEvidenceVersion: confirmed.sourceEvidenceVersion,
      title: '合成桌面完整流程', summary: '正常B/C/D桌面联验', confirmed: true,
    }), 'IntakeReceipt');
    if (!receipt.releaseId) throw new Error('Normal publication returned no release');
    return { key, material: { ...material, object }, releaseId: receipt.releaseId };
  }
  async function facts(item: Awaited<ReturnType<typeof publish>>, group: C['MenokinSopQuerySopQueryRequest']['sop_group'], expectedVersion = 0) {
    const flow = item.material.sopFlows[0];
    if (!flow) throw new Error('No flow to register');
    const graph = graphFor(item.material, flow);
    const ref = `synthetic:desktop-${item.key.candidateId}`;
    const document = { candidateId: item.key.candidateId, candidateVersion: item.key.version,
      sourceId: flow.header.key.sourceId, flowId: flow.header.key.flowId, graphDigest: hash(canonical(graph)), sopGroup: group,
      permissions: graph.entries.map(entry => ({ entry: { sourceId: entry.sourceId, businessEntryId: entry.entry.businessEntryId, scriptVersion: entry.entry.scriptVersion },
        risk_level: 'low', copy_allowed: true, source_ref: `${ref}@${expectedVersion + 1}#${entry.entry.businessEntryId}` })) };
    const result = await host.writeSopQueryFacts('enabler', { operationId: randomUUID(), expectedVersion,
      source: { ref, version: String(expectedVersion + 1), bytes: Buffer.from(JSON.stringify(document)) } });
    if (!result.ok) throw new Error(`Normal facts writer ${JSON.stringify(result)}`);
    return graph;
  }
  return { host, admin, request, post, publish, facts, diagnostics,
    loseNextResponse: (operation: 'query' | 'open') => { lostResponse = operation; },
  };
}
