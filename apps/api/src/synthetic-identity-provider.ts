import { IdentityFailure, type SyntheticIdentityProvider } from './product-auth-service.js';

/** Local synthetic wire only. No real provider URL, credentials, redirects or fallback. */
export function createSyntheticIdentityProvider(origin: string, callbackUrl: string): SyntheticIdentityProvider {
  const target = new URL(origin);
  const callback = new URL(callbackUrl);
  for (const url of [target, callback]) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
      || url.search || url.hash || !url.port) throw new Error('Synthetic identity requires an exact loopback URL');
  }
  if (target.pathname !== '/' || callback.pathname !== '/v1/auth/callback') throw new Error('Invalid synthetic identity path');
  const pending = new Set<AbortController>();
  let closed = false;
  return Object.freeze({
    authorizeUrl(state: string) {
      const url = new URL('/authorize', target);
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', callback.href);
      return url.href;
    },
    async exchange(code: string) {
      if (closed) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const controller = new AbortController();
      pending.add(controller);
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(new URL('/exchange', target), {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
        });
        if (response.status === 400 || response.status === 401) throw new IdentityFailure('LOGIN_INVALID');
        if (!response.ok || !response.body) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 4096) {
              controller.abort();
              throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).sort().join(',') !== 'binding_id,provider'
          || Reflect.get(value, 'provider') !== 'synthetic'
          || typeof Reflect.get(value, 'binding_id') !== 'string'
          || !/^synthetic_[A-Za-z0-9_-]{1,100}$/.test(Reflect.get(value, 'binding_id'))) {
          throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        }
        return Reflect.get(value, 'binding_id') as string;
      } catch (error) {
        if (error instanceof IdentityFailure) throw error;
        throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      } finally {
        clearTimeout(timeout);
        controller.abort();
        pending.delete(controller);
      }
    },
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
      pending.clear();
    },
  });
}
