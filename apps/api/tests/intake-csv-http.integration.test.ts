import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { createIntakeSyntheticCsv, createIntakeSyntheticHost, createIntakeSyntheticWorkbook,
  INTAKE_SYNTHETIC_FAQ, type IntakeSyntheticHost, type IntakeSyntheticDomain } from './support/intake-synthetic-host.js';

type C = components['schemas'];
type HttpHost = Omit<IntakeSyntheticHost, 'candidate' | 'object'>;
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const headers = { 'content-type': 'application/json' };
const hosts: HttpHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); });
async function host(domain: IntakeSyntheticDomain = 'product', inputFormat: 'csv' | 'xlsx' = 'csv') {
  const value = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', domain, inputFormat });
  hosts.push(value); return value;
}
async function json(response: Response) {
  const value: unknown = await response.json(); expect(response.ok, JSON.stringify(value)).toBe(true); return value;
}
function upload(h: HttpHost, bytes: Buffer, operationId: string, mime = 'text/csv', actor: 'enabler' | 'agent' = 'enabler', source = 'source-a') {
  const form = new FormData(); form.set('operationId', operationId);
  // The filename is deliberately unrelated: only declared type, original bytes
  // and the registered source tuple participate in admission.
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'ignored-client-name.bin');
  return h.requestAs(actor, `/v1/intake/sources/${source}/objects`, { method: 'POST', body: form });
}
async function receive(h: HttpHost, objectId: string, operationId: string) {
  const response = await h.requestAs('enabler', '/v1/intake/sources/source-a/candidates', { method: 'POST', headers, body: JSON.stringify({
    operationId, objectId, sourceVersion: 1, baseReleaseId: 'rel_native_base', expectedPriorKey: null,
    contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true },
  }) });
  let job = parseContractSchema('IntakeParseJob', await json(response));
  const deadline = Date.now() + 20_000;
  while (job.state === 'reading' || job.state === 'parsing') {
    if (Date.now() > deadline) throw new Error('Synthetic CSV parser did not settle');
    await new Promise(resolve => setTimeout(resolve, 20));
    job = parseContractSchema('IntakeParseJob', await json(await h.requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}`)));
  }
  return job;
}
async function reportRows(h: HttpHost, job: C['IntakeParseJob']) {
  const response = await h.requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}/report`);
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
  const bytes = Buffer.from(await response.arrayBuffer());
  const consumer = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import ExcelJS from 'exceljs'; import {readFileSync} from 'node:fs';
    const book=new ExcelJS.Workbook(); await book.xlsx.load(readFileSync(0));
    console.log(JSON.stringify({sheet:book.worksheets[0].name,rows:book.worksheets[0].getSheetValues()}));
  `], { cwd: fileURLToPath(new URL('../../../packages/content-intake/', import.meta.url)), input: bytes, timeout: 30_000 });
  const report = JSON.parse(consumer.toString()) as { sheet: string; rows: unknown[] };
  expect(report.sheet).toBe('校验问题'); expect(report.rows).toHaveLength(job.totalIssues + 2);
  return report;
}

describe.skipIf(!enabled)('native CSV through restricted HTTP/PG15 producers and consumers', () => {
  it.each(['product', 'campaign', 'presale', 'aftersale'] as const)('publishes %s original CSV bytes and another agent reads the same text', async domain => {
    const h = await host(domain);
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), createIntakeSyntheticCsv({ domain, answerSuffix: '\n合成逗号,与"引号"。' })]);
    const object = parseContractSchema('IntakeObject', await json(await upload(h, bytes, `${domain}-upload`)));
    expect(object).toMatchObject({ mime: 'text/csv', sha256: hash(bytes), bytes: bytes.length, sourceId: 'source-a' });
    const replay = parseContractSchema('IntakeObject', await json(await upload(h, bytes, `${domain}-upload`)));
    expect(replay).toEqual(object);
    const job = await receive(h, object.objectId, `${domain}-receive`);
    expect(job.state, JSON.stringify(job)).toBe('validated');
    const url = `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`;
    const candidate = parseContractSchema('IntakeCandidate', await json(await h.requestAs('enabler', url)));
    const material = parseContractSchema('IntakeCandidatePage', await json(await h.requestAs('enabler', `${url}/material?limit=100`)));
    expect(material.materialHeader).toMatchObject({ selectedSheets: ['CSV'], templateVersion: 'faq-csv-v1', ruleVersion: 'intake-csv-v1', mappingVersion: 'faq-csv-columns-v1', object });
    expect(material.materialHeader.sourceClaim.fileSha256).toBe(hash(bytes));
    const post = async (suffix: string, value: unknown) => json(await h.requestAs('enabler', `${url}/${suffix}`, { method: 'POST', headers, body: JSON.stringify(value) }));
    const key = candidate.key;
    await post('source-confirmation', { operationId: `${domain}-source`, key, expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque',
      confirmedVersionValue: 'synthetic-csv-export', acquisition: 'controlled-synthetic-export', objectSha256: object.sha256, reason: '合成 CSV 来源确认' });
    await post('quality/freeze', { operationId: `${domain}-freeze`, key });
    const quality = parseContractSchema('IntakeQualityStatus', await json(await h.requestAs('enabler', `${url}/quality?digest=${key.digest}`)));
    const samples = parseContractSchema('IntakeQualitySamplePage', await json(await h.requestAs('enabler', `${url}/quality/samples?${new URLSearchParams({ digest: key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)));
    expect(samples.items).toHaveLength(3); expect(samples.nextCursor).toBeNull();
    await post('quality/checks', { operationId: `${domain}-checks`, key, phase: 'initial', checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })) });
    const request = { operationId: `${domain}-publish`, key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1, confirmed: true, title: '合成 CSV 发布', summary: domain };
    const unconfirmed = await h.requestAs('enabler', `${url}/publish`, { method: 'POST', headers, body: JSON.stringify({ ...request, confirmed: false }) });
    expect(unconfirmed.ok).toBe(false); expect((await h.status()).publications).toBe(0);
    const receipt = parseContractSchema('IntakeReceipt', await post('publish', request));
    expect(receipt.state).toBe('published');
    const qualification = { shopId: 'shop-a', contextGeneration: 1, releaseId: receipt.releaseId, productIds: [], scenarioIds: [] };
    const entitlement = parseContractSchema('IntakeEntitlement', await json(await h.requestAs('agent', '/v1/intake/entitlements', { method: 'POST', headers, body: JSON.stringify(qualification) })));
    const rows: C['IntakeSnapshot']['faq'] = []; let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ entitlementId: entitlement.entitlementId, limit: '1', ...(cursor ? { cursor } : {}) });
      const page: C['IntakeSnapshot'] = parseContractSchema('IntakeSnapshot', await json(await h.requestAs('agent', `/v1/intake/snapshot?${query}`)));
      rows.push(...page.faq); cursor = page.nextCursor;
    } while (cursor);
    expect(rows.map(row => row.entry.answerText)).toEqual(INTAKE_SYNTHETIC_FAQ.map(faq => faq.answer + '\n合成逗号,与"引号"。'));
    expect(JSON.stringify({ rows, entitlement })).not.toContain('osl_');
    const copyCheck = parseContractSchema('IntakeEntitlement', await json(await h.requestAs('agent', '/v1/intake/entitlements', { method: 'POST', headers, body: JSON.stringify(qualification) })));
    expect(copyCheck.releaseId).toBe(receipt.releaseId);
    await h.revokeSyntheticQuery();
    expect((await h.requestAs('agent', '/v1/intake/entitlements', { method: 'POST', headers, body: JSON.stringify(qualification) })).ok).toBe(false);
    const status = await h.status(); expect(status.directPublications).toBe(1); expect(status.approvalFacts).toBe(0); expect(status.reviewBindings).toBe(0);
    for (const purpose of ['business', 'usage', 'organization']) expect(status.purposeQueries[purpose]).toBeGreaterThan(0);
  }, 60_000);

  it.each(['missing-answer', 'invalid-utf8', 'missing-expiry'] as const)('rejects %s as a whole batch and exports a real readable XLSX report', async failure => {
    const domain = failure === 'missing-expiry' ? 'campaign' : 'product'; const h = await host(domain);
    const bytes = failure === 'invalid-utf8' ? Buffer.from([0xc3, 0x28]) : createIntakeSyntheticCsv({ domain, missingAnswer: failure === 'missing-answer', missingExpiry: failure === 'missing-expiry' });
    const object = parseContractSchema('IntakeObject', await json(await upload(h, bytes, 'bad-upload')));
    const job = await receive(h, object.objectId, 'bad-receive');
    expect(job.state).toBe('failed'); expect(job.candidateId).toBeNull();
    const code = failure === 'missing-answer' ? 'REQUIRED' : failure === 'invalid-utf8' ? 'INVALID_UTF8' : 'EXPIRY_REQUIRED';
    expect(job.issues.some(issue => issue.code === code)).toBe(true);
    if (failure === 'missing-answer') expect(job.issues[0]?.location).toEqual({ sheet: 'CSV', row: 3, column: 8 });
    const report = await reportRows(h, job); expect(JSON.stringify(report)).toContain('CSV');
    expect(JSON.stringify(report)).not.toContain(INTAKE_SYNTHETIC_FAQ[0]!.answer);
    expect((await h.status()).publications).toBe(0);
    expect((await h.status()).purposeQueries.worker).toBeGreaterThan(0);
    // A rejected file leaves the worker reusable; a corrected upload is a new operation.
    const valid = parseContractSchema('IntakeObject', await json(await upload(h, createIntakeSyntheticCsv({ domain }), 'fixed-upload')));
    expect((await receive(h, valid.objectId, 'fixed-receive')).state).toBe('validated');
  }, 60_000);

  it('enforces registered format and existing actor/scope grants before CSV admission', async () => {
    const h = await host(); const csv = createIntakeSyntheticCsv(); const xlsx = await createIntakeSyntheticWorkbook();
    const wrong = await upload(h, xlsx, 'wrong-source-format', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(wrong.status).toBe(400); expect(parseContractSchema('IntakeError', await wrong.json()).error).toMatchObject({ code: 'VALIDATION', details: { reason: 'SOURCE_FORMAT_MISMATCH' } });
    expect((await upload(h, xlsx, 'disguised-xlsx', 'text/csv')).ok).toBe(false);
    expect((await upload(h, csv, 'agent-upload', 'text/csv', 'agent')).ok).toBe(false);
    expect((await upload(h, csv, 'other-shop-upload', 'text/csv', 'enabler', 'source-b')).ok).toBe(false);
    const other = await host('product', 'xlsx');
    const reverse = await upload(other, csv, 'csv-to-xlsx-source');
    expect(reverse.status).toBe(400); expect(parseContractSchema('IntakeError', await reverse.json()).error.details.reason).toBe('SOURCE_FORMAT_MISMATCH');
    expect((await h.status()).publications).toBe(0); expect((await other.status()).publications).toBe(0);
  }, 60_000);
});
