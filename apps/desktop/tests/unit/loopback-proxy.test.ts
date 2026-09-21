import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LOOPBACK_PROXY_BYPASS,
  applyChromiumLoopbackProxyBypass,
  ensureNoProxyLoopback,
} from '../../src/main/loopback-proxy';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('loopback proxy bypass', () => {
  it('adds 127.0.0.1 to NO_PROXY without dropping existing entries', () => {
    const env: NodeJS.ProcessEnv = { NO_PROXY: 'example.com' };
    ensureNoProxyLoopback(env);
    expect(env.NO_PROXY?.split(',')).toEqual(expect.arrayContaining(['example.com', '127.0.0.1', 'localhost']));
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  it('registers Chromium proxy-bypass-list before app ready', () => {
    const switches: string[] = [];
    applyChromiumLoopbackProxyBypass({
      appendSwitch(name, value) {
        switches.push(`${name}=${value ?? ''}`);
      },
    });
    expect(switches).toEqual([`proxy-bypass-list=${LOOPBACK_PROXY_BYPASS}`]);
    const main = readFileSync(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    expect(main).toContain('ensureNoProxyLoopback()');
    expect(main).toContain('applyChromiumLoopbackProxyBypass(app.commandLine)');
    expect(main).toContain('applySessionLoopbackProxyBypass(session.defaultSession)');
  });
});
