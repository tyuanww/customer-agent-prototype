/** Chromium and Node must not send 127.0.0.1 through a system HTTP/TUN proxy. */
export const LOOPBACK_PROXY_BYPASS = '127.0.0.1,localhost,::1,<local>';

export function ensureNoProxyLoopback(env: NodeJS.ProcessEnv = process.env): void {
  const extra = ['127.0.0.1', 'localhost', '::1'];
  const current = env.NO_PROXY ?? env.no_proxy ?? '';
  const parts = current.split(/[\s,;]+/).filter((part) => part.length > 0);
  const merged = [...parts];
  for (const host of extra) {
    if (!merged.includes(host)) merged.push(host);
  }
  const value = merged.join(',');
  env.NO_PROXY = value;
  env.no_proxy = value;
}

export function applyChromiumLoopbackProxyBypass(
  commandLine: { appendSwitch(name: string, value?: string): void },
): void {
  commandLine.appendSwitch('proxy-bypass-list', LOOPBACK_PROXY_BYPASS);
}

export async function applySessionLoopbackProxyBypass(
  target: { setProxy(config: { mode: 'system'; proxyBypassRules: string }): Promise<void> },
): Promise<void> {
  await target.setProxy({ mode: 'system', proxyBypassRules: LOOPBACK_PROXY_BYPASS });
}
