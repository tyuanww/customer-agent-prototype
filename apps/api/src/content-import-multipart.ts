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
    if (start !== offset) throw new Error('CONTENT_UPLOAD_MULTIPART');
    const contentStart = start + boundary.length;
    if (body.subarray(contentStart, contentStart + 2).equals(Buffer.from('--'))) {
      const tail = body.subarray(contentStart + 2);
      if (tail.length !== 0 && !tail.equals(Buffer.from('\r\n'))) throw new Error('CONTENT_UPLOAD_MULTIPART');
      return parts;
    }
    if (!body.subarray(contentStart, contentStart + 2).equals(Buffer.from('\r\n'))) {
      throw new Error('CONTENT_UPLOAD_MULTIPART');
    }
    const next = body.indexOf(boundary, contentStart);
    if (next < 0) throw new Error('CONTENT_UPLOAD_MULTIPART');
    // The delimiter already owns its leading CRLF. Any CRLF before that is
    // file content and must participate in the original-byte digest.
    const part = body.subarray(contentStart + 2, next);
    parts.push(part);
    offset = next;
  }
  throw new Error('CONTENT_UPLOAD_MULTIPART');
}

/**
 * Bounded multipart reader for the frozen FileImportRequest shape. Extra parts,
 * filenames-as-paths, and Feishu JSON are rejected here so the store only sees
 * a typed byte stream and a small bindings document.
 */
async function parseMultipart(
  stream: Readable,
  contentTypeHeader: string,
  field: { name: string; maxBytes: number; excelOnly: boolean },
  options: Readonly<{ maxFileBytes?: number; timeoutMs?: number }> = {},
): Promise<{ file: AsyncIterable<Buffer>; sourceType: ContentSourceType; metadata: string }> {
  const boundary = parseBoundary(contentTypeHeader);
  if (!boundary) throw new Error('CONTENT_UPLOAD_MULTIPART');
  const maxFileBytes = options.maxFileBytes ?? CONTENT_UPLOAD_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? CONTENT_UPLOAD_TIMEOUT_MS;
  const maxTotal = maxFileBytes + field.maxBytes + 8 * 1024;
  const body = await readAll(stream, maxTotal, timeoutMs);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const framed = Buffer.concat([Buffer.from('\r\n'), body]);
  const parts = splitPart(framed, delimiter);
  let file: Buffer | undefined;
  let sourceType: ContentSourceType | undefined;
  let metadata: string | undefined;
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0 || headerEnd > 8 * 1024) throw new Error('CONTENT_UPLOAD_MULTIPART');
    const headers = part.subarray(0, headerEnd).toString('latin1');
    const content = part.subarray(headerEnd + 4);
    const disposition = headerValue(headers, 'content-disposition');
    const name = disposition ? dispositionParam(disposition, 'name') : undefined;
    if (headerValue(headers, 'content-transfer-encoding')) throw new Error('CONTENT_UPLOAD_MULTIPART');
    if (name === 'file') {
      if (file !== undefined) throw new Error('CONTENT_UPLOAD_MULTIPART');
      const type = declaredSourceType(headerValue(headers, 'content-type'));
      if (type === null || (field.excelOnly && type !== 'excel')) throw new Error('CONTENT_UPLOAD_TYPE');
      if (content.length > maxFileBytes) throw new Error('CONTENT_UPLOAD_TOO_LARGE');
      file = content;
      sourceType = type;
    } else if (name === field.name) {
      if (metadata !== undefined) throw new Error('CONTENT_UPLOAD_MULTIPART');
      if (content.length > field.maxBytes) throw new Error('CONTENT_UPLOAD_TOO_LARGE');
      metadata = content.toString('utf8');
    } else {
      throw new Error('CONTENT_UPLOAD_MULTIPART');
    }
  }
  if (file === undefined || sourceType === undefined || metadata === undefined) {
    throw new Error('CONTENT_UPLOAD_MULTIPART');
  }
  const payload = file;
  return Object.freeze({
    file: (async function* persistable() { yield payload; }()),
    sourceType,
    metadata,
  });
}

export async function parseContentImportMultipart(stream: Readable, contentTypeHeader: string,
  options: Readonly<{ maxFileBytes?: number; timeoutMs?: number }> = {}): Promise<ParsedContentImportForm> {
  const parsed = await parseMultipart(stream, contentTypeHeader,
    { name: 'source_bindings', maxBytes: SOURCE_BINDINGS_MAX_BYTES, excelOnly: false }, options);
  return { file: parsed.file, sourceType: parsed.sourceType, sourceBindingsJson: parsed.metadata };
}

/** The frozen intake upload accepts exactly an operation ID and one XLSX file.
 * Client filenames and hashes never participate in storage or authorization. */
export async function parseIntakeUploadMultipart(stream: Readable, contentTypeHeader: string,
  options: Readonly<{ maxFileBytes?: number; timeoutMs?: number }> = {}) {
  const parsed = await parseMultipart(stream, contentTypeHeader,
    { name: 'operationId', maxBytes: 128, excelOnly: true }, options);
  return { file: parsed.file, operationId: parsed.metadata };
}
