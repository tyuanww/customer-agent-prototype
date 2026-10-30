// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { loadIntakeAccess } from '../../src/main/content-intake-access';
import { parseContractSchema } from '@customer-agent/contracts';
import { ContentIntakeUsage, type IntakeUsageSession } from '../../src/main/content-intake-usage';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

// The real session is exercised without reading the developer's employee-name
// mapping or credential store. The API fixture owns all identities and tokens.
vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
const context = input ? JSON.parse(input) as { origin: string; token: string; expiresAt: string; releaseId: string; discoverySources?: number } : null;

it.skipIf(!context || context.discoverySources !== undefined)('consumes published PG material through actual ProductHttp and ProductSession', async () => {
  const { origin, token, expiresAt, releaseId } = context!;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  const session = new ProductSession(new ProductHttp(origin), {
    read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined,
  }, { open: async () => { throw new Error('LOGIN_WINDOW_NOT_ALLOWED_IN_PROBE'); } });
  const control = async (action: string) => {
    const response = await fetch(`${origin}/__synthetic__/${action}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('SYNTHETIC_CONTROL_FAILED');
    return response.json() as Promise<{ waiting?: boolean }>;
  };
  const copied: string[] = [];
  let main: ContentIntakeUsage | undefined;
  try {
    expect(await session.restore()).toMatchObject({ ok: true, signedIn: true });
    main = new ContentIntakeUsage(session, text => copied.push(text));
    const access = await loadIntakeAccess(session);
    expect(access.shops).toEqual(['shop-a']); expect(access.sources.map(s => s.scope.sourceId)).toEqual(['source-a']);
    expect(access.capabilities[0].actions).toEqual(['query']);
    main.select({ shopId: access.shops[0], productIds: [], scenarioIds: [] });
    await control('hold-next');
    const pending = main.refresh();
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'STALE' });
    await vi.waitFor(async () => expect((await control('gate')).waiting).toBe(true), { timeout: 5000, interval: 20 });
    main.select({ shopId: 'shop-a', productIds: [], scenarioIds: [] });
    await cancelled;
    expect(main.current()).toBeNull();
    await control('release-gate');

    const first = await main.refresh(), projection = first.read()!;
    expect(projection.releaseId).toBe(releaseId);
    expect(projection.faq).toHaveLength(101);
    expect(projection.faq[0].entry.answerText).toBe('第一行。\n第二行。');
    expect(projection.faq[100].entry.answerText).toBe('合成答复'.repeat(1000));
    expect('internalNote' in projection.faq[0].entry).toBe(false);
    expect('entitlementId' in projection).toBe(false);
    await first.copy(projection.faq[0].key); expect(copied).toEqual(['第一行。\n第二行。']);
    await control('expire-next');
    await expect(main.refresh()).rejects.toMatchObject({ code: 'EXPIRED' });
    expect(main.current()).toBe(first); await first.copy(projection.faq[0].key); expect(copied).toHaveLength(2);
    await control('next-release');
    const empty = await main.refresh(); expect(empty.read()!.faq).toEqual([]); expect(first.read()!.faq).toHaveLength(101);
    await control('revoke');
    await expect(first.copy(projection.faq[0].key)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(first.read()).toBeNull(); expect(empty.read()).toBeNull();
    await expect(first.copy(projection.faq[0].key)).rejects.toMatchObject({code:'STALE'}); expect(copied).toHaveLength(2);
    expect((await loadIntakeAccess(session)).shops).toEqual([]);
    const logout = await session.logout(); expect(logout.ok && !logout.signedIn).toBe(true);
    console.log('INTAKE_USAGE_HTTP_PASS');
  } finally { main?.dispose(); await session.shutdown(); }
}, 35_000);

it.skipIf(context?.discoverySources !== 5000)('discovers 5000 independently granted sources through the actual Main HTTP consumer', async () => {
  const { origin, token, expiresAt } = context!;
  const session = new ProductSession(new ProductHttp(origin), {
    read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined,
  }, { open: async () => { throw new Error('LOGIN_WINDOW_NOT_ALLOWED_IN_PROBE'); } });
  try {
    expect(await session.restore()).toMatchObject({ ok: true, signedIn: true });
    const access = await loadIntakeAccess(session);
    expect(access.shops).toEqual(['shop-a']);
    expect(access.sources).toHaveLength(5000); expect(access.capabilities).toHaveLength(5000);
    expect(new Set(access.sources.map(s => s.scope.sourceId)).size).toBe(5000);
    expect(access.capabilities.every(c => c.actions.length === 1 && c.actions[0] === 'query'
      && c.mayAllocate.length === 0 && c.mayDelegate.length === 0)).toBe(true);
    expect(Date.now()).toBeLessThan(Date.parse(access.validUntil));
    console.log('INTAKE_DISCOVERY_CAPACITY_PASS');
  } finally { await session.shutdown(); }
}, 100_000);

it.skipIf(process.env.CUSTOMER_AGENT_INTAKE_COPY_PG !== '1')('checks every Main copy through isolated HTTP and PG after revocation', async () => {
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const { createTemplate } = await import('@customer-agent/content-intake');
  const host = await createIntakeSyntheticHost({ profile: 'purpose-runtime', prepareCandidate: false });
  const copied: string[] = [], paths: string[] = [], events: string[] = [];
  let main: ContentIntakeUsage | undefined;
  const json = async (response: Response) => {
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(`Synthetic request failed: ${response.status} ${JSON.stringify(value)}`);
    return value;
  };
  const post = (path: string, body: unknown, identity: 'enabler' | 'reviewer' = 'enabler') => host.requestAs(identity, path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const rows = Array.from({ length: 101 }, (_, i) => [`faq-${String(i).padStart(3, '0')}`, '合成问题', `合成答复 ${i}`,
      '', '', '合成分类', '', '启用', '', '', '', '合成说明', '', '', 'false']);
    const bytes = await createTemplate({ sourceId:'source-a', brandId:'brand-a', scope:'shop-a', domain:'product', sheet:'FAQ', templateVersion:'faq-p1.1' }, rows);
    const form = new FormData(); form.set('operationId', 'copy-upload');
    form.set('file', new Blob([new Uint8Array(bytes)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-copy.xlsx');
    const object = parseContractSchema('IntakeObject', await json(await host.requestAs('enabler', '/v1/intake/sources/source-a/objects', { method:'POST', body:form })));
    let job = parseContractSchema('IntakeParseJob', await json(await post('/v1/intake/sources/source-a/candidates', {
      operationId:'copy-receive', objectId:object.objectId, sourceVersion:1, baseReleaseId:'rel_native_base',
      contributorDeclaration:{preparerPrincipalId:'enabler',editorPrincipalIds:['enabler'],confirmed:true}, expectedPriorKey:null,
    })));
    const deadline=Date.now()+20_000;
    while(job.state==='reading'||job.state==='parsing') {
      if(Date.now()>=deadline)throw new Error('Synthetic parser did not settle');
      await new Promise(resolve=>setTimeout(resolve,20));
      job=parseContractSchema('IntakeParseJob',await json(await host.requestAs('enabler',`/v1/intake/parse-jobs/${job.jobId}`)));
    }
    expect(job.state).toBe('validated');
    const candidate=parseContractSchema('IntakeCandidate',await json(await host.requestAs('enabler',`/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`)));
    const url = `/v1/intake/candidates/${candidate.key.candidateId}/versions/${candidate.key.version}`;
    await json(await post(`${url}/source-confirmation`, { operationId: 'copy-source', key: candidate.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-copy', acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成来源确认' }));
    await json(await post(`${url}/quality/freeze`, { operationId: 'copy-freeze', key: candidate.key }, 'reviewer'));
    const quality = parseContractSchema('IntakeQualityStatus', await json(await host.requestAs('reviewer', `${url}/quality?digest=${candidate.key.digest}`)));
    const samples = parseContractSchema('IntakeQualitySamplePage', await json(await host.requestAs('reviewer', `${url}/quality/samples?${new URLSearchParams({ digest: candidate.key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)));
    expect(samples.nextCursor).toBeNull(); expect(samples.items.length).toBeGreaterThan(0);
    await json(await post(`${url}/quality/checks`, { operationId: 'copy-checks', key: candidate.key, phase: 'initial',
      checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })) }, 'reviewer'));
    await json(await post(`${url}/publish`, { operationId: 'copy-publish', key: candidate.key, baseReleaseId: 'rel_native_base',
      sourceEvidenceVersion: 1, confirmed: true, title: '合成发布', summary: '合成复制核验' }));
    const session: IntakeUsageSession = {
      view: () => ({ signedIn: true, sessionEpoch: 1 }), subscribe: () => () => undefined,
      request: async (_epoch, path, options) => {
        paths.push(path);
        const init: RequestInit = { signal: options.signal };
        if (options.body !== undefined) {
          init.method = 'POST'; init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(options.body);
        }
        const response = await host.requestAs('agent', path, init), value: unknown = await response.json();
        if (!response.ok) {
          const failure = parseContractSchema('IntakeError', value);
          throw { code: response.status === 404 ? 'GONE' : failure.error.code, reason: failure.error.details?.reason };
        }
        return { value };
      },
    };
    main = new ContentIntakeUsage(session, text => copied.push(text)); main.subscribe(event => events.push(event));
    main.select({ shopId: 'shop-a', productIds: [], scenarioIds: [] });
    const catalog = await main.refresh(), projection = catalog.read()!;
    expect(projection.faq).toHaveLength(101);
    const row = projection.faq[100]!;
    const originalPage = paths.find(path => path.includes('/snapshot') && new URL(path, 'http://synthetic.invalid').searchParams.has('cursor'));
    expect(originalPage).toBeDefined();
    const pageCursor = new URL(originalPage!, 'http://synthetic.invalid').searchParams.get('cursor');
    expect(await catalog.copy(row.key)).toEqual({ copied: true }); expect(copied).toEqual([row.entry.answerText]);
    const verification = new URL(paths.at(-1)!, 'http://synthetic.invalid');
    expect(verification.searchParams.get('limit')).toBe('100'); expect(verification.searchParams.get('cursor')).toBe(pageCursor);
    expect(await host.revokeQueryFor('agent')).toBeGreaterThan(0);
    await expect(catalog.copy(row.key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(copied).toHaveLength(1); expect(events.at(-1)).toBe('invalidated');
  } finally { main?.dispose(); await host.close(); }
}, 60_000);
