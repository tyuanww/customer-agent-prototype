import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { desktopFetch, electronNetFetch } from '../../src/main/desktop-fetch';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function source(relative: string): string {
  return readFileSync(path.join(desktopRoot, relative), 'utf8');
}

describe('desktop fetch', () => {
  it('falls back to global fetch when Electron net.fetch is absent', async () => {
    expect(electronNetFetch()).toBeNull();
    const previous = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const response = await desktopFetch('https://example.invalid/health');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('is the default transport for ProductHttp, login identity, and MiniMax', () => {
    const http = source('src/main/product-http.ts');
    const login = source('src/main/product-login-window.ts');
    const chat = source('src/main/minimax-chat.ts');
    const embed = source('src/main/minimax-embed.ts');
    expect(http).toContain('transport: typeof fetch = desktopFetch');
    expect(login).toContain('host.fetch ?? desktopFetch');
    expect(login).toContain('applySessionSecurity(isolated)');
    expect(login).not.toContain('isolated.setPermissionRequestHandler');
    expect(chat).toContain('electronNetFetch()');
    expect(chat).not.toContain('createRequire');
    expect(embed).toContain('electronNetFetch()');
    expect(embed).not.toContain('createRequire');
  });
});
