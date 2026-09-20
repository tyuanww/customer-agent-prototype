// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ProductHttp } from '../../src/main/product-http';

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
