import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseContentImportMultipart } from '../src/content-import-multipart.js';

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
