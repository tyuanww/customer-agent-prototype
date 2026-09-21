/**
 * Chromium TLS and proxy for desktop HTTPS.
 *
 * ProductHttp, login identity POSTs, and MiniMax must share this path.
 * Node `fetch` (Homebrew CA / HTTP_PROXY) is only the test fallback.
 * Certificate pinning is out of scope.
 */
import { createRequire } from 'node:module';

export function electronNetFetch(): typeof fetch | null {
  try {
    const electron = createRequire(import.meta.url)('electron') as { net?: { fetch?: typeof fetch } };
    return typeof electron.net?.fetch === 'function' ? electron.net.fetch.bind(electron.net) : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

function isLoopbackUrl(url: URL): boolean {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
}

/** Loopback uses Node fetch so Clash/system HTTP_PROXY cannot intercept 127.0.0.1. */
export function desktopFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    if (isLoopbackUrl(requestUrl(input))) return fetch(input, init);
  } catch {
    // Invalid URL: fall through to the default transport.
  }
  return (electronNetFetch() ?? fetch)(input, init);
}
