import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { parseContractSchema } from '@customer-agent/contracts/sop-resource-disable';
import { createSopV12NormalHost } from '../support/sop-v12-normal-host';
import { readSopV12Probe, readSopV12Projection, runSopV12BackendProbe, setSopV12CloseUnavailable, setSopV12MediaDelay, setSopV12QueryDelay, type SopBackendOpeningEvidence, type SopV12BackendProbe } from '../support/sop-v12-backend-probe';

const enabled = process.env.CUSTOMER_AGENT_SOP_V12_NORMAL === '1';
const evidenceDirectory = process.env.CUSTOMER_AGENT_SOP_V12_EVIDENCE
  ?? path.join(tmpdir(), `sop-v12-normal-${randomUUID()}`);
test.skip(!enabled, 'Requires explicitly owned normal PostgreSQL/HTTP/Electron fixture');
test.describe.configure({ mode: 'serial' });
let fixture: Awaited<ReturnType<typeof createSopV12NormalHost>> | undefined;
let published: Awaited<ReturnType<Awaited<ReturnType<typeof createSopV12NormalHost>>['publish']>>;
type Surface = Parameters<NonNullable<SopV12BackendProbe['afterCopy']>>[0];

async function exerciseGraph({ app, sop, evidence }: Surface) {
  expect(await sop.getByRole('checkbox').allTextContents()).toHaveLength(2);
  const projection = await readSopV12Projection(sop);
  expect(projection.node?.requirements.map(item => [item.ordinal, item.label])).toEqual([
    [1, '合成确认 confirm-a'], [2, '合成确认 confirm-b'],
  ]);
  const second = sop.locator('article').filter({ has: sop.getByText('合成对客原文 B', { exact: true }) });
  await second.getByRole('button', { name: '复制话术' }).click();
  await expect.poll(async () => (await readSopV12Probe(app)).copies).toEqual(['合成对客原文 A\n版本 1', '合成对客原文 B']);
  await expect(sop.getByText('已复制', { exact: true })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('合成对客原文 B');
  expect((await readSopV12Probe(app)).copies).toEqual(['合成对客原文 A\n版本 1', '合成对客原文 B']);
  await sop.getByRole('checkbox', { name: '2. 合成确认 confirm-b', exact: true }).click();
  await expect(sop.getByRole('checkbox', { name: '2. 合成确认 confirm-b', exact: true })).toBeChecked();
  await expect(sop.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true }).click();
  await expect(sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).toBeChecked();
  await sop.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(sop.getByRole('heading', { name: '合成任务 task-b' })).toBeVisible();
  await expect(sop.getByRole('img', { name: '合成 image-task', exact: true })).toBeVisible();
  await expect(sop.getByText('合成知识原文', { exact: true })).toHaveCount(0);
  const current = await readSopV12Projection(sop);
  expect(current.node?.media.map(item => item.owner).sort()).toEqual(['entry', 'task']);
  const reads = (await readSopV12Probe(app)).exchanges.filter(item => item.path.includes('/media/') && item.path.includes('ownerId=task-b'));
  expect(reads).toHaveLength(1);
  const previous = evidence.mediaReads.find(item => item.binding.graphTarget?.kind === 'task')!;
  const repeated = parseContractSchema('IntakeSopMediaPayload', reads[0]!.value);
  expect(repeated.objectId).toBe(previous.payload.objectId);
  expect(Buffer.from(repeated.base64, 'base64').equals(Buffer.from(previous.payload.base64, 'base64'))).toBe(true);
  await expect(sop.getByText('判断依据 合成依据 branch-unknown', { exact: true })).toBeVisible();
  await sop.getByRole('button', { name: '无法判断 / 无法判断', exact: true }).click();
  await expect(sop.getByText('流程已到最后一步，请人工确认处理结果。')).toBeVisible();
  expect((await readSopV12Projection(sop)).node?.kind).toBe('terminal');
}

async function exerciseLogout({ app, sop, query, evidence }: Surface, owned: NonNullable<typeof fixture>) {
  const old = await readSopV12Projection(sop);
  const key = old.node!.scripts[0]!.key;
  await query.evaluate(() => window.customerAgent!.product!.logout());
  await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'idle');
  const closed = await owned.admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
    [createHash('sha256').update(evidence.opening.continuationId).digest('hex')]);
  expect(closed.rows[0].closed_at).not.toBeNull();
  expect(await sop.evaluate(value => window.sopWindow!.unifiedCommand!({ kind: 'copy', key: value }), key)).toMatchObject({ ok: false });
  expect(await sop.evaluate(() => window.sopWindow!.unifiedCommand!({ kind: 'refresh' }))).toMatchObject({ ok: false });
  expect((await readSopV12Projection(sop)).node).toBeNull();
  expect((await readSopV12Probe(app)).copies).toHaveLength(1);
}

async function exerciseNaturalExpiry(surface: Surface, owned: NonNullable<typeof fixture>) {
  const { app, sop, query, evidence } = surface;
  await sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true }).click();
  await expect(sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).toBeChecked();
  const hash = createHash('sha256').update(evidence.opening.continuationId).digest('hex');
  await owned.admin.query(`UPDATE backend_identity.sessions SET expires_at=clock_timestamp()-interval '1 millisecond'
    WHERE token_hash=(SELECT session_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1)`, [hash]);
  await sop.getByRole('button', { name: '复制话术', exact: true }).first().click();
  await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'paused');
  expect((await readSopV12Probe(app)).copies).toHaveLength(1);
  await query.evaluate(() => window.customerAgent!.openSearch());
  const opened = app.waitForEvent('window');
  await query.getByRole('button', { name: '登录', exact: true }).click();
  const login = await opened;
  await expect.poll(() => login.url()).toContain('role=login');
  await login.getByRole('button', { name: '飞书登录', exact: true }).click();
  await expect.poll(() => query.evaluate(async () => {
    const state = await window.customerAgent!.product!.sessionStatus();
    return state.ok && state.signedIn;
  })).toBe(true);
  await sop.getByRole('button', { name: '重新确认并继续', exact: true }).click();
  await expect(sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).toBeChecked();
  const observed = await readSopV12Probe(app);
  const renewal = observed.exchanges.find(item => item.path.endsWith('/continuations/renew') && item.status === 200);
  if (!renewal) throw new Error('Natural session renewal missing');
  const renewed = parseContractSchema('IntakeSopContinuationReceipt', renewal.value);
  expect(renewed.continuationId).toBe(evidence.opening.continuationId);
  expect(renewed.entitlement.entitlementId).not.toBe(evidence.receipt.entitlement.entitlementId);
  expect(renewed.entitlement.releaseId).toBe(evidence.ready.release_id);
  expect(observed.copies).toHaveLength(1);
}

async function exerciseRevocation({ app, sop, evidence }: Surface, owned: NonNullable<typeof fixture>) {
  const projection = await readSopV12Projection(sop);
  const copyKey = projection.node!.scripts[0]!.key;
  const mediaKey = projection.node!.media[0]!.key;
  const grants = (await owned.admin.query(`SELECT grant_id,version,source_id FROM content_intake.grants
    WHERE recipient_id='agent' AND scope_id='scope-resource' AND action='query' AND revoked_at IS NULL`)).rows;
  expect(grants.length).toBeGreaterThan(0);
  for (const grant of grants) {
    const response = await owned.request('director', `/v1/intake/grants/${grant.grant_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        operationId: randomUUID(), expectedVersion: Number(grant.version), change: 'revoke',
        stewardPrincipalId: null, reason: '合成桌面撤权验证',
      }),
    });
    expect(response.status, await response.text()).toBe(200);
  }
  await sop.getByRole('button', { name: '复制话术', exact: true }).first().click();
  await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'paused');
  expect(await sop.evaluate(() => window.sopWindow!.unifiedCommand!({ kind: 'refresh' }))).toMatchObject({ ok: false });
  for (const intent of [{ kind: 'copy', key: copyKey }, { kind: 'media', key: mediaKey }] as const) {
    expect(await sop.evaluate(command => window.sopWindow!.unifiedCommand!(command), intent)).toMatchObject({ ok: false });
  }
  expect((await readSopV12Probe(app)).copies).toHaveLength(1);
  expect((await readSopV12Projection(sop)).node).toBeNull();
  const policy = (await owned.admin.query("SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'")).rows[0];
  const principals = (await owned.admin.query("SELECT principal_id,current_facts_version FROM content_intake.principals WHERE principal_id IN ('roster-director','agent')")).rows;
  const versions = new Map(principals.map(row => [row.principal_id, Number(row.current_facts_version)]));
  for (const sourceId of new Set(grants.map(grant => grant.source_id))) {
    const response = await owned.post('roster-director', '/v1/intake/grants', {
      operationId: randomUUID(), issuerFactsVersion: versions.get('roster-director'), policyVersion: Number(policy.version),
      items: [{ kind: 'business', recipientPrincipalId: 'agent', recipientFactsVersion: versions.get('agent'), action: 'query',
        scope: { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'sop', sourceId },
        startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(), reason: '合成桌面恢复授权' }],
    });
    expect(response.status, await response.text()).toBe(200);
  }
  await sop.getByRole('button', { name: '重新确认并继续', exact: true }).click();
  await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
  expect((await readSopV12Probe(app)).copies).toHaveLength(1);
  const active = await owned.admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
    [createHash('sha256').update(evidence.opening.continuationId).digest('hex')]);
  expect(active.rows[0].closed_at).toBeNull();
}

async function exercisePublication({ app, sop, evidence }: Surface, owned: NonNullable<typeof fixture>) {
  await sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true }).click();
  await expect(sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).toBeChecked();
  const replacement = await owned.publish({ revision: 2, validImages: true });
  expect(replacement.releaseId).not.toBe(evidence.ready.release_id);
  expect(await sop.evaluate(() => window.sopWindow!.unifiedCommand!({ kind: 'refresh' }))).toMatchObject({ ok: true });
  await expect(sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).toBeChecked();
  await expect(sop.getByText('合成对客原文 A\n版本 1', { exact: true })).toBeVisible();
  const old = await readSopV12Projection(sop);
  const disabled = await owned.publish({ disable: ['image-task'], validImages: true });
  expect(await sop.evaluate(() => window.sopWindow!.unifiedCommand!({ kind: 'refresh' }))).toMatchObject({ ok: false });
  await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ended');
  const row = await owned.admin.query('SELECT closed_at,termination_reason FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
    [createHash('sha256').update(evidence.opening.continuationId).digest('hex')]);
  expect(row.rows[0].termination_reason).toBe('content-disabled');
  const preview = await owned.post('director', '/v1/intake/rollback/preview', {
    baseReleaseId: disabled.releaseId, targetReleaseId: replacement.releaseId,
  });
  const previewBody: unknown = await preview.json();
  writeFileSync(path.join(evidenceDirectory, 'publication-rollback-preview.json'), JSON.stringify({ status: preview.status, body: previewBody }, null, 2));
  expect(preview.status, JSON.stringify(previewBody)).toBe(200);
  const impact = parseContractSchema('IntakeRollbackImpact', previewBody);
  const response = await owned.post('director', '/v1/intake/rollback', {
    operationId: randomUUID(), rollbackPlanId: impact.rollbackPlanId, baseReleaseId: impact.baseReleaseId,
    targetReleaseId: impact.targetReleaseId, impactDigest: impact.impactDigest,
    retainedResourceDisableEventsDigest: impact.retainedResourceDisableEventsDigest, confirmed: true,
  });
  const rollback = parseContractSchema('IntakeRollbackReceipt', await response.json());
  expect(response.status).toBe(202);
  expect(rollback.state).toBe('published');
  expect(rollback.retainedResourceDisableEventsDigest).toBe(impact.retainedResourceDisableEventsDigest);
  expect(await sop.evaluate(key => window.sopWindow!.unifiedCommand!({ kind: 'copy', key }), old.node!.scripts[0]!.key)).toMatchObject({ ok: false });
  expect(await sop.evaluate(() => window.sopWindow!.unifiedCommand!({ kind: 'refresh' }))).toMatchObject({ ok: false });
  expect((await readSopV12Probe(app)).copies).toHaveLength(1);
}

async function exerciseOptional({ app, sop }: Surface) {
  const previous = await readSopV12Projection(sop);
  expect(previous.node!.media.some(item => item.state === 'loading')).toBe(true);
  expect(previous.node!.media.every(item => !item.required)).toBe(true);
  const oldKey = previous.node!.media[0]!.key;
  for (const label of ['1. 合成确认 confirm-a', '2. 合成确认 confirm-b']) {
    await sop.getByRole('checkbox', { name: label, exact: true }).click();
    await expect(sop.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  }
  await sop.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(sop.getByRole('heading', { name: '合成任务 task-b' })).toBeVisible();
  expect(await sop.evaluate(key => window.sopWindow!.unifiedCommand!({ kind: 'media-failed', key }), oldKey)).toMatchObject({ ok: false });
  await setSopV12MediaDelay(app, 0);
  await expect(sop.getByRole('img', { name: '合成 image-task', exact: true })).toBeVisible();
  await expect(sop.getByText('合成知识原文', { exact: true })).toHaveCount(0);
  expect((await readSopV12Projection(sop)).node!.media.every(item => item.owner !== 'knowledge')).toBe(true);
}

async function exerciseBlocked({ app, sop }: Surface, owned: NonNullable<typeof fixture>) {
  const previous = await readSopV12Projection(sop);
  await owned.publish({ revision: 2, validImages: true });
  const result = await sop.evaluate(shopKey => window.sopWindow!.unifiedCommand!({
    kind: 'query', shopKey, group: '品质售后SOP', text: '合成入口',
  }), previous.shops[0]!.key);
  expect(result).toMatchObject({ ok: true });
  await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'blocked');
  const projection = await readSopV12Projection(sop);
  expect(projection.node).toBeNull();
  await expect(sop.getByText('合成知识原文', { exact: true })).toHaveCount(0);
  await expect(sop.locator('figure img')).toHaveCount(0);
  expect(await sop.evaluate(key => window.sopWindow!.unifiedCommand!({ kind: 'copy', key }), previous.node!.scripts[0]!.key)).toMatchObject({ ok: false });
  const observed = await readSopV12Probe(app);
  expect(observed.copies).toHaveLength(1);
  const query = observed.exchanges.filter(item => item.path === '/v1/sop/query').at(-1)!;
  expect(parseContractSchema('MenokinSopQuerySopQueryResponse', query.value)).toMatchObject({ status: 'blocked', result: null });
  expect(observed.exchanges.filter(item => item.path === '/v1/intake/sop/check' && item.status === 200)).toHaveLength(1);
  writeFileSync(path.join(evidenceDirectory, 'blocked-outcome.json'), JSON.stringify({ response: query.value,
    projection, nativeWrites: observed.copies.length, successfulOpens: 1 }, null, 2));
  const restored = await owned.publish({ revision: 1, validImages: true });
  await owned.facts(restored, '品质售后SOP');
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  fixture = await createSopV12NormalHost();
  published = await fixture.publish({ validImages: true });
  await fixture.facts(published, '品质售后SOP');
});
test.afterAll(async () => {
  if (fixture) writeFileSync(path.join(evidenceDirectory, 'backend-diagnostics.json'), JSON.stringify(fixture.diagnostics, null, 2));
  await fixture?.host.close();
});

for (const scenario of ['ordinary', 'blocked', 'lost-query', 'lost-open', 'destroy-online', 'destroy-offline', 'graph', 'required-slow', 'natural-expiry', 'logout', 'revocation', 'late-query', 'optional-slow', 'publication'] as const) {
  test(`normal88 complete selection, owner media and native clipboard ${scenario}`, async () => {
    if (!fixture) throw new Error('Normal fixture missing');
    const owned = fixture;
    if (scenario === 'optional-slow') {
      const optional = await owned.publish({ sourceId: 'source-optional', validImages: true });
      await owned.facts(optional, '少错破SOP');
    }
    const lostResponse = scenario === 'lost-query' ? 'query' : scenario === 'lost-open' ? 'open' : null;
    if (lostResponse) owned.loseNextResponse(lostResponse);
    const result = await runSopV12BackendProbe({ apiOrigin: owned.host.apiOrigin, identityOrigin: owned.host.identityOrigin,
      evidenceDirectory: path.join(evidenceDirectory, scenario),
      shopId: 'shop-a', selection: { productIds: ['product-extra', 'product-graph'], scenarioIds: ['scenario-graph'] },
      group: scenario === 'optional-slow' ? '少错破SOP' : '品质售后SOP', queryText: '合成入口', expectedMessage: '合成对客原文 A\n版本 1',
      mediaDelayMs: scenario === 'required-slow' || scenario === 'optional-slow' ? 3000 : undefined,
      queryDelayMs: scenario === 'late-query' ? 2000 : undefined,
      recoverOpening: lostResponse ? async ({ sop }) => {
        await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'paused');
        await sop.getByRole('button', { name: '重新确认并继续', exact: true }).click();
      } : scenario === 'late-query' ? async ({ app, sop, query }) => {
        await expect.poll(async () => (await readSopV12Probe(app)).exchanges.filter(item => item.path === '/v1/sop/query').length).toBe(1);
        const option = query.getByTitle('product-extra', { exact: true }).getByRole('checkbox');
        await option.uncheck();
        await expect(option).not.toBeChecked();
        await setSopV12QueryDelay(app, 0);
        await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'blocked');
        expect((await readSopV12Projection(sop)).node).toBeNull();
        expect((await readSopV12Probe(app)).exchanges.filter(item => item.path === '/v1/intake/sop/check')).toHaveLength(0);
        await option.check();
        await expect(option).toBeChecked();
        await sop.getByRole('button', { name: '查询流程', exact: true }).click();
      } : undefined,
      observeOpening: async ({ app }): Promise<SopBackendOpeningEvidence> => {
        const observed = await readSopV12Probe(app);
        expect(observed.requests.every(request => request.origin === owned.host.apiOrigin)).toBe(true);
        expect(observed.requests.some(request => request.path === '/v1/search')).toBe(false);
        const openCall = observed.exchanges.find(item => item.path === '/v1/intake/sop/check' && item.status === 200);
        if (!openCall) throw new Error('Real Main open observation missing');
        const opening = parseContractSchema('IntakeSopActionCheck', openCall.body);
        const queryCall = observed.exchanges.find(item => item.path === '/v1/sop/query' && item.status === 200
          && parseContractSchema('MenokinSopQuerySopQueryRequest', item.body).request_id === opening.queryRequestId);
        if (!queryCall) throw new Error('Real Main query observation missing');
        const query = parseContractSchema('MenokinSopQuerySopQueryRequest', queryCall.body);
        const ready = parseContractSchema('MenokinSopQuerySopReadyResponse', queryCall.value);
        const receipt = parseContractSchema('IntakeSopContinuationReceipt', openCall.value);
        if (lostResponse) {
          const attempts = observed.exchanges.filter(item => item.path === (lostResponse === 'query' ? '/v1/sop/query' : '/v1/intake/sop/check'));
          expect(attempts).toHaveLength(2);
          expect(attempts.map(item => item.status)).toEqual([503, 200]);
          expect(attempts[0].body).toEqual(attempts[1].body);
        }
        const rows = await owned.admin.query(`SELECT l.lease_id,l.request_id,l.release_id,l.expires_at,b.entitlement_hash,
          ctx.product_ids,ctx.scenario_ids FROM content_intake.sop_query_leases l
          JOIN content_intake.sop_unified_query_bindings b USING(lease_id)
          JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash) WHERE l.request_id=$1`, [query.request_id]);
        expect(rows.rows).toHaveLength(1);
        const lease = rows.rows[0];
        expect(lease.entitlement_hash).toBe(createHash('sha256').update(query.entitlement_id).digest('hex'));
        expect(lease.product_ids).toEqual(['product-extra', 'product-graph']);
        expect(lease.scenario_ids).toEqual(['scenario-graph']);
        const active = await owned.admin.query('SELECT opening_query_request_id,opening_query_proof_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
          [createHash('sha256').update(opening.continuationId).digest('hex')]);
        expect(active.rows[0].opening_query_request_id).toBe(query.request_id);
        const mediaReads = observed.exchanges.filter(item => item.path.includes('/media/') && item.status === 200).map(item => {
          const url = new URL(item.path, owned.host.apiOrigin);
          const binding = ready.result.media.find(media => media.binding.objectId === url.pathname.split('/').at(-1)
            && media.binding.resourceId === url.searchParams.get('resourceId')
            && (media.binding.entry?.businessEntryId ?? media.binding.graphTarget?.id) === url.searchParams.get('ownerId'))?.binding;
          if (!binding) throw new Error('Normal media read missing full binding');
          return { binding, payload: parseContractSchema('IntakeSopMediaPayload', item.value) };
        });
        if (scenario !== 'optional-slow') {
          expect(new Set(mediaReads.map(item => item.binding.entry ? 'entry' : item.binding.graphTarget!.kind))).toEqual(new Set(['entry', 'task', 'knowledge']));
        }
        if (scenario === 'late-query') {
          const queries = observed.exchanges.filter(item => item.path === '/v1/sop/query').map(item => parseContractSchema('MenokinSopQuerySopQueryRequest', item.body));
          expect(queries).toHaveLength(2);
          expect(queries[0]!.request_id).not.toBe(queries[1]!.request_id);
          expect(queries[0]!.entitlement_id).not.toBe(queries[1]!.entitlement_id);
          expect(opening.queryRequestId).toBe(queries[1]!.request_id);
        }
        return { query, ready, opening, receipt, mediaReads,
          queryLease: { id: lease.lease_id, requestId: lease.request_id, releaseId: lease.release_id, expiresAt: lease.expires_at.toISOString() } };
      },
      afterCopy: async surface => {
        const { app, sop, query, evidence } = surface;
        const observed = await readSopV12Probe(app);
        expect(observed.copies).toEqual(['合成对客原文 A\n版本 1']);
        if (scenario === 'graph') return exerciseGraph(surface);
        if (scenario === 'natural-expiry') return exerciseNaturalExpiry(surface, owned);
        if (scenario === 'logout') return exerciseLogout(surface, owned);
        if (scenario === 'revocation') return exerciseRevocation(surface, owned);
        if (scenario === 'publication') return exercisePublication(surface, owned);
        if (scenario === 'optional-slow') return exerciseOptional(surface);
        if (scenario === 'blocked') return exerciseBlocked(surface, owned);
        if (scenario !== 'destroy-online' && scenario !== 'destroy-offline') return;
        await sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true }).click();
        await expect(sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).toBeChecked();
        const previous = await readSopV12Projection(sop);
        const oldCopy = previous.node?.scripts[0]?.key;
        if (!oldCopy) throw new Error('Normal old copy handle missing');
        await setSopV12CloseUnavailable(app, scenario === 'destroy-offline');
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=sop'));
          if (!window) throw new Error('Normal SOP window missing');
          window.destroy();
        });
        const oldHash = createHash('sha256').update(evidence.opening.continuationId).digest('hex');
        if (scenario === 'destroy-online') await expect.poll(async () => {
          return (await owned.admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [oldHash])).rows[0].closed_at !== null;
        }).toBe(true);
        await query.evaluate(() => window.customerAgent!.openSearch());
        await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
        await query.getByRole('button', { name: '打开 SOP 流程', exact: true }).click();
        await expect.poll(() => app.windows().some(page => page.url().includes('role=sop'))).toBe(true);
        const reopened = app.windows().find(page => page.url().includes('role=sop'))!;
        await expect(reopened.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'idle');
        expect((await readSopV12Projection(reopened)).node).toBeNull();
        expect(await reopened.evaluate(key => window.sopWindow!.unifiedCommand!({ kind: 'copy', key }), oldCopy)).toMatchObject({ ok: false });
        expect((await readSopV12Probe(app)).copies).toEqual(observed.copies);
        if (scenario === 'destroy-offline') {
          const row = (await owned.admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [oldHash])).rows[0];
          expect(row.closed_at).toBeNull();
        }
        await setSopV12CloseUnavailable(app, false);
        await reopened.getByRole('combobox', { name: '流程', exact: true }).click();
        await reopened.getByText('品质售后SOP', { exact: true }).last().click();
        await reopened.getByRole('textbox', { name: '问题', exact: true }).fill('合成入口');
        await reopened.getByRole('button', { name: '查询流程', exact: true }).click();
        await expect(reopened.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
        await expect(reopened.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true })).not.toBeChecked();
        const openings = (await readSopV12Probe(app)).exchanges.filter(item => item.path === '/v1/intake/sop/check' && item.status === 200);
        const latest = parseContractSchema('IntakeSopActionCheck', openings.at(-1)!.body);
        expect(latest.continuationId).not.toBe(evidence.opening.continuationId);
      },
    });
    writeFileSync(path.join(evidenceDirectory, `normal-opening-${scenario}.json`), JSON.stringify(result, null, 2));
  });
}
