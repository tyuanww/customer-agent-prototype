// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { parseContractSchema } from '@customer-agent/contracts';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';

vi.mock('../../src/main/operator-display-names', () => ({ readOperatorDisplayName: () => null }));
const input = process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
delete process.env.CUSTOMER_AGENT_INTAKE_HTTP_PROBE;
const context = input ? JSON.parse(input) as {
  origin: string; token: string; expiresAt: string; managementContext: boolean; objectId: string;
} : null;

it.skipIf(!context?.managementContext)('uses real management context to receive and parse a candidate, rejecting cancelled and logged-out reads', async () => {
  const { origin, token, expiresAt, objectId } = context!;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  let delayContext = false;
  let markReceived!: () => void, releaseResponse!: () => void;
  const received = new Promise<void>(resolve => { markReceived = resolve; });
  const released = new Promise<void>(resolve => { releaseResponse = resolve; });
  const session = new ProductSession(new ProductHttp(origin, async (url, options) => {
    const response = await fetch(url, options);
    if (delayContext && new URL(String(url)).pathname.endsWith('/management-context')) {
      markReceived(); await released;
    }
    return response;
  }), { read: () => ({ access_token: token, expires_at: expiresAt }), write: () => undefined, clear: () => undefined },
  { open: async () => { throw new Error('LOGIN_NOT_ALLOWED_IN_PROBE'); } });
  try {
    expect(await session.restore()).toMatchObject({ signedIn: true });
    const epoch = session.view().sessionEpoch, sourceId = 'source-a';
    const read = (signal?: AbortSignal) => session.request(epoch,
      `/v1/intake/sources/${sourceId}/management-context`, { signal, maxResponseBytes: 65_536 });
    const current = parseContractSchema('IntakeManagementContext', (await read()).value);
    expect(current).toMatchObject({ sourceId, principalId: 'enabler', factsVersion: 1, sourceVersion: 1 });
    expect(current.principalId).not.toBe('user-enabler');
    expect(Date.parse(current.validUntil)).toBeGreaterThan(Date.now());
    // Main consumes the service's facts as-is; no identity or empty-base guess.
    const request = parseContractSchema('IntakeReceive', {
      operationId: 'context-main-receive', objectId, sourceVersion: current.sourceVersion, baseReleaseId: current.baseReleaseId,
      contributorDeclaration: { preparerPrincipalId: current.principalId, editorPrincipalIds: [current.principalId], confirmed: true },
      expectedPriorKey: null,
    });
    let job = parseContractSchema('IntakeParseJob', (await session.request(epoch,
      `/v1/intake/sources/${sourceId}/candidates`, { body: request })).value);
    const deadline = Date.now() + 10_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() >= deadline) throw new Error('CONTEXT_RECEIVE_PARSE_TIMEOUT');
      await new Promise(resolve => setTimeout(resolve, 25));
      job = parseContractSchema('IntakeParseJob', (await session.request(epoch,
        `/v1/intake/parse-jobs/${encodeURIComponent(job.jobId)}`)).value);
    }
    expect(job.state).toBe('validated'); expect(job.totalIssues).toBe(0);
    expect(job.candidateId).not.toBeNull(); expect(job.candidateVersion).toBe(1);
    const candidate = parseContractSchema('IntakeCandidate', (await session.request(epoch,
      `/v1/intake/candidates/${encodeURIComponent(job.candidateId!)}/versions/${job.candidateVersion}`)).value);
    expect(candidate).toMatchObject({ sourceId, key: { candidateId: job.candidateId, version: 1 }, state: 'awaiting-evidence' });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(read(cancelled.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    delayContext = true;
    const late = read();
    const discarded = expect(late).rejects.toMatchObject({ code: 'STALE' });
    await Promise.race([received, late]);
    expect(await session.logout()).toMatchObject({ signedIn: false });
    releaseResponse(); await discarded;
    console.log('INTAKE_MANAGEMENT_CONTEXT_HTTP_PASS');
  } finally { releaseResponse(); await session.shutdown(); }
}, 35_000);
