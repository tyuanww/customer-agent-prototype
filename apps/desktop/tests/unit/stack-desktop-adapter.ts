/**
 * Drive the desktop main adapter against the running synthetic stack.
 * Loaded by Vitest so TypeScript parameter properties compile; Node strip-types cannot.
 */
import { ProductAnnounce } from '../../src/main/product-announce';
import { ProductHttp } from '../../src/main/product-http';
import { ProductSearch } from '../../src/main/product-search';
import { ProductSession } from '../../src/main/product-session';

export type DesktopAdapter = {
  session: ProductSession;
  announce: ProductAnnounce;
  search: ProductSearch;
  clipboard: string[];
  epoch: () => number;
};

export async function connectDesktopAdapter(apiOrigin: string, bindingId: string, clientId: string): Promise<DesktopAdapter> {
  let stored: { access_token: string; expires_at: string } | null = null;
  const session = new ProductSession(new ProductHttp(apiOrigin), {
    read: () => stored,
    write: (value: { access_token: string; expires_at: string }) => { stored = value; },
    clear: () => { stored = null; },
  }, {
    async open(url: string, signal: AbortSignal) {
      if (signal.aborted) throw new Error('synthetic login aborted');
      const authorize = new URL(url);
      const redirect = authorize.searchParams.get('redirect_uri');
      const state = authorize.searchParams.get('state');
      if (!redirect || !state) throw new Error('synthetic login window missing callback');
      const callback = await fetch(`${redirect}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(bindingId)}`, { signal });
      if (!callback.ok) throw new Error(`synthetic callback ${String(callback.status)}`);
    },
  });
  const login = await session.login();
  if (!login.ok || !login.signedIn) throw new Error(`desktop adapter login failed: ${JSON.stringify(login)}`);
  const announce = new ProductAnnounce(session, clientId);
  const clipboard: string[] = [];
  const search = new ProductSearch(session, (text: string) => { clipboard.push(text); }, announce);
  const refreshed = await announce.refresh({ sessionEpoch: session.view().sessionEpoch, generation: 0 });
  if (!refreshed.ok) throw new Error(`desktop adapter announce failed: ${JSON.stringify(refreshed)}`);
  return {
    session, announce, search, clipboard,
    epoch: () => session.view().sessionEpoch,
  };
}
