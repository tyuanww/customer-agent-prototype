import type { Readable } from 'node:stream';
import {
  CONTENT_UPLOAD_MAX_BYTES,
  CONTENT_UPLOAD_TIMEOUT_MS,
  type ContentSourceType,
} from './content-object-store.js';

export const SOURCE_BINDINGS_MAX_BYTES = 16 * 1024;

export type ParsedContentImportForm = Readonly<{
  file: AsyncIterable<Buffer>;
  sourceType: ContentSourceType;
  sourceBindingsJson: string;
}>;

const CSV_TYPE = 'text/csv';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function headerValue(headers: string, name: string): string | undefined {
  const match = headers.match(new RegExp(`(?:^|\\r\\n)${name}\\s*:\\s*([^\\r\\n]+)`, 'i'));
  return match?.[1]?.trim();
}

function dispositionParam(disposition: string, name: string): string | undefined {
  const match = disposition.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*"?([^";]+)"?`, 'i'));
  return match?.[1]?.trim();
}

function declaredSourceType(contentType: string | undefined): ContentSourceType | null {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === CSV_TYPE) return 'csv';
  if (type === XLSX_TYPE) return 'excel';
  return null;
}

function parseBoundary(contentType: string): string | null {
  const match = contentType.match(/;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] ?? match?.[2]?.trim();
  if (!boundary || boundary.length < 1 || boundary.length > 70 || /[\r\n]/.test(boundary)) {
    return null;
  }
  return boundary;
}

async function readAll(stream: Readable, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => {
    stream.destroy(new Error('CONTENT_UPLOAD_TIMEOUT'));
  }, timeoutMs);
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) throw new Error('CONTENT_UPLOAD_TOO_LARGE');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
  }
}

function splitPart(body: Buffer, boundary: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const start = body.indexOf(boundary, offset);
    if (start < 0) break;
    const contentStart = start + boundary.length;
    if (body.subarray(contentStart, contentStart + 2).equals(Buffer.from('--'))) break;
    if (!body.subarray(contentStart, contentStart + 2).equals(Buffer.from('\r\n'))) {
      throw new Error('CONTENT_UPLOAD_MULTIPART');
    }
    const next = body.indexOf(boundary, contentStart);
    if (next < 0) throw new Error('CONTENT_UPLOAD_MULTIPART');
    let part = body.subarray(contentStart + 2, next);
    if (part.length >= 2 && part.subarray(part.length - 2).equals(Buffer.from('\r\n'))) {
      part = part.subarray(0, part.length - 2);
    }
    parts.push(part);
    offset = next;
  }
  return parts;
}

/**
 * Bounded multipart reader for the frozen FileImportRequest shape. Extra parts,
 * filenames-as-paths, and Feishu JSON are rejected here so the store only sees
 * a typed byte stream and a small bindings document.
 */
export async function parseContentImportMultipart(
  stream: Readable,
  contentTypeHeader: string,
  options: Readonly<{ maxFileBytes?: number; timeoutMs?: number }> = {},
): Promise<ParsedContentImportForm> {
  const boundary = parseBoundary(contentTypeHeader);
  if (!boundary) throw new Error('CONTENT_UPLOAD_MULTIPART');
  const maxFileBytes = options.maxFileBytes ?? CONTENT_UPLOAD_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? CONTENT_UPLOAD_TIMEOUT_MS;
  const maxTotal = maxFileBytes + SOURCE_BINDINGS_MAX_BYTES + 8 * 1024;
  const body = await readAll(stream, maxTotal, timeoutMs);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const framed = Buffer.concat([Buffer.from('\r\n'), body]);
  const parts = splitPart(framed, delimiter);
  let file: Buffer | undefined;
  let sourceType: ContentSourceType | undefined;
  let sourceBindingsJson: string | undefined;
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) throw new Error('CONTENT_UPLOAD_MULTIPART');
    const headers = part.subarray(0, headerEnd).toString('latin1');
    const content = part.subarray(headerEnd + 4);
    const disposition = headerValue(headers, 'content-disposition');
    const name = disposition ? dispositionParam(disposition, 'name') : undefined;
    if (headerValue(headers, 'content-transfer-encoding')) throw new Error('CONTENT_UPLOAD_MULTIPART');
    if (name === 'file') {
      if (file !== undefined) throw new Error('CONTENT_UPLOAD_MULTIPART');
      const type = declaredSourceType(headerValue(headers, 'content-type'));
      if (type === null) throw new Error('CONTENT_UPLOAD_TYPE');
      if (content.length > maxFileBytes) throw new Error('CONTENT_UPLOAD_TOO_LARGE');
      file = content;
      sourceType = type;
    } else if (name === 'source_bindings') {
      if (sourceBindingsJson !== undefined) throw new Error('CONTENT_UPLOAD_MULTIPART');
      if (content.length > SOURCE_BINDINGS_MAX_BYTES) throw new Error('CONTENT_UPLOAD_TOO_LARGE');
      sourceBindingsJson = content.toString('utf8');
    } else {
      throw new Error('CONTENT_UPLOAD_MULTIPART');
    }
  }
  if (file === undefined || sourceType === undefined || sourceBindingsJson === undefined) {
    throw new Error('CONTENT_UPLOAD_MULTIPART');
  }
  const payload = file;
  return Object.freeze({
    file: (async function* persistable() { yield payload; }()),
    sourceType,
    sourceBindingsJson,
  });
}
