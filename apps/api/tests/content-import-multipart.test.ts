import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseContentImportMultipart, parseIntakeUploadMultipart } from '../src/content-import-multipart.js';

const BOUNDARY = '----test-boundary';

function form(parts: readonly Readonly<{
  name: string;
  filename?: string;
  type?: string;
  body: string | Buffer;
}>[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) header += `; filename="${part.filename}"`;
    header += '\r\n';
    if (part.type !== undefined) header += `Content-Type: ${part.type}\r\n`;
    header += '\r\n';
    chunks.push(Buffer.from(header), Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

async function collect(iterable: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('content import multipart', () => {
  it('reads file and source_bindings without using the client filename as a path', async () => {
    const parsed = await parseContentImportMultipart(
      Readable.from(form([
        {
          name: 'file',
          filename: '../../etc/passwd.csv',
          type: 'text/csv',
          body: 'a,b\n1,2\n',
        },
        {
          name: 'source_bindings',
          type: 'application/json',
          body: '[{"domain":"presale","source_version_id":"srcv_t2_presale_v1"}]',
        },
      ])),
      `multipart/form-data; boundary=${BOUNDARY}`,
    );
    expect(parsed.sourceType).toBe('csv');
    expect(parsed.sourceBindingsJson).toContain('srcv_t2_presale_v1');
    expect((await collect(parsed.file)).toString()).toBe('a,b\n1,2\n');
  });

  it('rejects extra parts, missing fields, and non-csv/xlsx types', async () => {
    await expect(parseContentImportMultipart(
      Readable.from(form([
        { name: 'file', type: 'text/csv', body: 'a' },
        { name: 'source_bindings', body: '[]' },
        { name: 'token', body: 'secret' },
      ])),
      `multipart/form-data; boundary=${BOUNDARY}`,
    )).rejects.toThrow('CONTENT_UPLOAD_MULTIPART');
    await expect(parseContentImportMultipart(
      Readable.from(form([{ name: 'file', type: 'application/pdf', body: '%PDF' }])),
      `multipart/form-data; boundary=${BOUNDARY}`,
    )).rejects.toThrow('CONTENT_UPLOAD_TYPE');
  });
});


describe('frozen intake upload multipart', () => {
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const parse = (body: Buffer, options = {}) => parseIntakeUploadMultipart(Readable.from(body), `multipart/form-data; boundary=${BOUNDARY}`, options);
  const parts = (bytes = Buffer.from('PK\x03\x04\r\n')) => [
    { name: 'operationId', body: 'synthetic-upload' }, { name: 'file', type, body: bytes },
  ];
  it('preserves all file bytes, including a trailing CRLF', async () => {
    const original = Buffer.from('PK\x03\x04\r\n');
    const result = await parse(form(parts(original)));
    expect(result.operationId).toBe('synthetic-upload');
    expect(await collect(result.file)).toEqual(original);
  });
  it('preserves CSV BOM and trailing CRLF while reporting the declared source type', async () => {
    const original = Buffer.from('\ufeff"标题","正文"\r\n"合成","第一行\r\n第二行"\r\n');
    const p = parts(original); p[1]!.type = 'text/csv';
    const result = await parse(form(p));
    expect(result.sourceType).toBe('csv'); expect(await collect(result.file)).toEqual(original);
  });
  it.each(['extra', 'duplicate', 'pdf', 'missing', 'unterminated', 'epilogue'])('rejects malformed or extra parts: %s', async mode => {
    const p = parts();
    if (mode === 'extra') p.push({ name: 'sha256', body: 'claimed' });
    if (mode === 'duplicate') p.push(p[0]!);
    if (mode === 'pdf') p[1]!.type = 'application/pdf';
    if (mode === 'missing') p.pop();
    let bytes = form(p);
    if (mode === 'unterminated') bytes = bytes.subarray(0, bytes.length - 6);
    if (mode === 'epilogue') bytes = Buffer.concat([bytes, Buffer.from('ignored-attacker-data')]);
    await expect(parse(bytes)).rejects.toThrow(/^CONTENT_UPLOAD_/);
  });
  it('enforces file and metadata budgets and aborts a stalled stream', async () => {
    await expect(parse(form(parts(Buffer.alloc(17))), { maxFileBytes: 16 })).rejects.toThrow('CONTENT_UPLOAD_TOO_LARGE');
    const p = parts(); p[0]!.body = 'x'.repeat(129);
    await expect(parse(form(p))).rejects.toThrow('CONTENT_UPLOAD_TOO_LARGE');
    const stalled = new Readable({ read() { /* synthetic client sends no body */ } });
    await expect(parseIntakeUploadMultipart(stalled, `multipart/form-data; boundary=${BOUNDARY}`, { timeoutMs: 10 })).rejects.toThrow('CONTENT_UPLOAD_TIMEOUT');
    expect(stalled.destroyed).toBe(true);
  });
});
