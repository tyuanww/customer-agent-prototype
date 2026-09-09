import { PRODUCT_ERRORS, type ProductErrorCode } from '../shared/product-session';

export class ProductHttpError extends Error {
  constructor(readonly code: ProductErrorCode) { super(PRODUCT_ERRORS[code]); }
}
/** Only configured loopback origins; no userinfo, path, fragment, query or implicit ports. */
export function loopbackOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProductHttpError('VALIDATION'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ProductHttpError('VALIDATION');
  }
  return url.origin;
}
const EXTRA_HEADERS = ['x-client-id', 'x-snapshot-lease', 'if-none-match'] as const;
export type ProductHttpResult = {
  status: number; value: unknown;
  etag?: string; leaseToken?: string; leaseExpiresAt?: string;
};
export class ProductHttp {
  readonly origin: string;
  constructor(origin: string, private readonly transport: typeof fetch = fetch) {
    this.origin = loopbackOrigin(origin);
  }
  /** Bounded response and deadline. No retries: mutations may have committed. */
  async request(path: string, options: {
    body?: unknown; token?: string; signal?: AbortSignal; method?: string;
    headers?: Partial<Record<(typeof EXTRA_HEADERS)[number], string>>;
  } = {}): Promise<ProductHttpResult> {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('://') || path.includes('\\')) throw new ProductHttpError('VALIDATION');
    const extra = options.headers ?? {};
    if (Object.keys(extra).some(name => !(EXTRA_HEADERS as readonly string[]).includes(name))) throw new ProductHttpError('VALIDATION');
    const deadline = AbortSignal.timeout(5_000);
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    try {
      const response = await this.transport(new URL(path, this.origin), {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        redirect: 'error', signal,
        headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const meta = {
        ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
        ...(response.headers.get('x-snapshot-lease') ? { leaseToken: response.headers.get('x-snapshot-lease')! } : {}),
        ...(response.headers.get('x-snapshot-lease-expires') ? { leaseExpiresAt: response.headers.get('x-snapshot-lease-expires')! } : {}),
      };
      if (response.status === 304) { await response.body?.cancel(); return { status: 304, value: null, ...meta }; }
      if (!response.ok) throw new ProductHttpError(await mapFailure(response));
      if (response.status === 204) return { status: 204, value: null, ...meta };
      return { status: response.status, value: JSON.parse(await readBounded(response)), ...meta };
    } catch (error) {
      if (error instanceof ProductHttpError) throw error;
      throw new ProductHttpError(options.signal?.aborted ? 'CANCELLED' : 'UNAVAILABLE');
    }
  }
}
async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new ProductHttpError('UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_048_576) { await reader.cancel(); throw new ProductHttpError('UNAVAILABLE'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
async function mapFailure(response: Response): Promise<ProductErrorCode> {
  const codes: Record<number, ProductErrorCode> = { 400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'GONE', 409: 'CONFLICT', 410: 'GONE', 429: 'RATE_LIMITED', 503: 'OVERLOADED' };
  let mapped = codes[response.status] ?? 'UNAVAILABLE';
  try {
    const parsed = JSON.parse(await readBounded(response)) as { error?: { details?: { reason?: unknown } } };
    if (parsed?.error?.details?.reason === 'SOURCE_GATE_NOT_READY') mapped = 'SOURCE_GATE_NOT_READY';
  } catch { await response.body?.cancel().catch(() => undefined); }
  return mapped;
}
