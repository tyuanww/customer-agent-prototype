// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductHttp } from '../../src/main/product-http';

afterEach(() => vi.restoreAllMocks());

describe('authenticated bounded XLSX report reads', () => {
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);
  it('keeps binary bytes exact and still uses the authenticated HTTP boundary', async () => {
    const transport = vi.fn(async () => new Response(bytes, { headers: { 'content-type': mime } }));
    const result = await new ProductHttp('http://127.0.0.1:4100', transport).request('/v1/intake/parse-jobs/job/report', {
      responseType: 'xlsx', token: 'synthetic-token', maxResponseBytes: bytes.length,
    });
    expect(result.value).toEqual(Buffer.from(bytes));
    expect(transport).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      redirect: 'error', headers: { authorization: 'Bearer synthetic-token' },
    }));
  });
  it('rejects MIME mismatch, non-archive content and over-budget streaming responses', async () => {
    for (const response of [new Response(bytes, { headers: { 'content-type': 'text/html' } }),
      new Response('not an archive', { headers: { 'content-type': mime } }), new Response(bytes, { headers: { 'content-type': mime } })]) {
      await expect(new ProductHttp('http://127.0.0.1:4100', async () => response).request('/v1/intake/parse-jobs/job/report', {
        responseType: 'xlsx', maxResponseBytes: 5,
      })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });
  it('stops a stalled body when cancelled and never returns late binary data', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const http = new ProductHttp('http://127.0.0.1:4100', async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(bytes); }, cancel,
    }), { headers: { 'content-type': mime } }));
    const result = http.request('/v1/intake/parse-jobs/job/report', { responseType: 'xlsx', signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    await Promise.resolve(); await Promise.resolve(); controller.abort(); await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('decodes a JSON authority rejection on a binary request', async () => {
    const http = new ProductHttp('http://127.0.0.1:4100', async () => Response.json({ error: { details: { reason: 'SCOPE_DENIED' } } }, { status: 403 }));
    await expect(http.request('/v1/intake/parse-jobs/job/report', { responseType: 'xlsx' })).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'SCOPE_DENIED' });
  });
});

describe('product HTTP form upload', () => {
  it('sends multipart without JSON-encoding the body', async () => {
    const transport = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(
      { import_batch_id: 'imp_1', status: 'validating', source_binding_hash: 'a'.repeat(64) },
      { status: 202 },
    ));
    const http = new ProductHttp('http://127.0.0.1:4100', transport as unknown as typeof fetch);
    const form = new FormData();
    form.set('file', new Blob(['scene,script\n洁面,先确认\n'], { type: 'text/csv' }), 'draft.csv');
    form.set('source_bindings', JSON.stringify([{ domain: 'product', source_version_id: 'srcv_product_v1' }]));
    const result = await http.request('/v1/content/import', {
      form,
      token: 't'.repeat(43),
      timeoutMs: 30_000,
      headers: { 'idempotency-key': 'idem-1' },
    });
    expect(result.status).toBe(202);
    const init = transport.mock.calls[0]?.[1];
    if (!init) throw new Error('missing request init');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    const headers = new Headers(init.headers);
    expect(headers.get('content-type') ?? '').not.toContain('application/json');
    expect(headers.get('authorization')).toBe(`Bearer ${'t'.repeat(43)}`);
    expect(headers.get('idempotency-key')).toBe('idem-1');
  });

  it('rejects JSON and form payloads together', async () => {
    const http = new ProductHttp('http://127.0.0.1:4100', vi.fn() as unknown as typeof fetch);
    await expect(http.request('/v1/content/import', {
      body: { nope: true },
      form: new FormData(),
    })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('product HTTP qualification boundary', () => {
  it('maps a rejected quality payload to correctable validation rather than uncertain transport', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const http = new ProductHttp('http://127.0.0.1:4100', async () => Response.json({
      error: { code: 'VALIDATION', details: { reason: 'FILE_LIMIT' } },
    }, { status: 413 }));
    await expect(http.request('/v1/intake/candidates/c/versions/1/quality/checks', { body: {} }))
      .rejects.toMatchObject({ code: 'VALIDATION', reason: 'FILE_LIMIT' });
  });
  it('preserves the formal reason but never logs path, query or response text', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const http = new ProductHttp('http://127.0.0.1:4100', async () => Response.json({
      error: { code: 'UNAUTHORIZED', message: 'private-body', details: { reason: 'LEASE_EXPIRED', diagnosticId: 'private-diagnostic' } },
    }, { status: 403 }));
    await expect(http.request('/v1/intake/private-path?entitlementId=private-id&cursor=private-cursor', {
      body: { value: 'private-input' }, token: 'private-token',
    })).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'LEASE_EXPIRED' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/^\[desktop\] product-http 403 FORBIDDEN \d+ms$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  });

  it('keeps only known transport names and errno, never provider cause text', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const http = new ProductHttp('http://127.0.0.1:4100', async () => {
      const error = new Error('private-message', { cause: { code: 'private-code', message: 'private-credential' } });
      error.name = 'private-name'; throw error;
    });
    await expect(http.request('/v1/auth/login-requests/private-login/exchange')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
    const refused = new ProductHttp('http://127.0.0.1:4100', async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED', message: 'private-url' } });
    });
    await expect(refused.request('/v1/intake/snapshot?cursor=private-cursor')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(log.mock.calls[1][0]).toContain('TypeError ECONNREFUSED');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  });

  it('requires an explicit Main budget for responses larger than the legacy 1 MiB limit', async () => {
    const body = { answerText: '合成'.repeat(200_000) };
    const http = new ProductHttp('http://127.0.0.1:4100', async () => Response.json(body));
    await expect(http.request('/v1/intake/snapshot')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await http.request('/v1/intake/snapshot', { maxResponseBytes: 1_300_000 })).value).toEqual(body);
  });

  it('cancels the body as soon as its byte budget is exceeded', async () => {
    const cancel = vi.fn();
    const http = new ProductHttp('http://127.0.0.1:4100', async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(257)); }, cancel,
    })));
    await expect(http.request('/v1/intake/snapshot', { maxResponseBytes: 256 })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 32 * 1024 * 1024 + 1])('rejects invalid response budget %s before transport', async budget => {
    const transport = vi.fn();
    await expect(new ProductHttp('http://127.0.0.1:4100', transport).request('/v1/intake/snapshot', {
      maxResponseBytes: budget,
    })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(transport).not.toHaveBeenCalled();
  });
});
