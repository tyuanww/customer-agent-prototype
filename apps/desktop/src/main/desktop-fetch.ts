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

export function desktopFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (electronNetFetch() ?? fetch)(input, init);
}
