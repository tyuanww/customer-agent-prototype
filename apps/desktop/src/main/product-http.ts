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
export class ProductHttp {
  readonly origin: string;
  constructor(origin: string, private readonly transport: typeof fetch = fetch) {
    this.origin = loopbackOrigin(origin);
  }
  /** Bounded response and deadline. No retries: mutations may have committed. */
  async request(path: string, options: { body?: unknown; token?: string; signal?: AbortSignal; method?: string } = {}) {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('://')) throw new ProductHttpError('VALIDATION');
    const deadline = AbortSignal.timeout(5_000);
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    try {
      const response = await this.transport(new URL(path, this.origin), {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        redirect: 'error', signal,
        headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      if (!response.ok) {
        const codes: Record<number, ProductErrorCode> = { 400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 409: 'CONFLICT', 410: 'GONE', 429: 'RATE_LIMITED', 503: 'OVERLOADED' };
        await response.body?.cancel();
        throw new ProductHttpError(codes[response.status] ?? 'UNAVAILABLE');
      }
      if (response.status === 204) return { status: 204, value: null };
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
      return { status: response.status, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
    } catch (error) {
      if (error instanceof ProductHttpError) throw error;
      throw new ProductHttpError(options.signal?.aborted ? 'CANCELLED' : 'UNAVAILABLE');
    }
  }
}
