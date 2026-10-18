export type RunningPoint = 'hangzhou' | 'local' | 'offline' | 'unknown';

export type RunningIdentity = Readonly<{
  productVersion: string;
  gitSha: string;
  point: RunningPoint;
}>;

export function runningPointFromProfile(mode: string | undefined, apiOrigin: string | undefined): RunningPoint {
  if (mode === 'synthetic-offline') return 'offline';
  let hostname = '';
  try {
    hostname = apiOrigin === undefined ? '' : new URL(apiOrigin).hostname;
  } catch {
    hostname = '';
  }
  if (hostname === 'agent-auth.jianghua.site') return 'hangzhou';
  if (hostname === '127.0.0.1') return 'local';
  return 'unknown';
}

export function formatRunningIdentity(identity: RunningIdentity): string {
  const sha = identity.gitSha.trim().slice(0, 7);
  const point = identity.point === 'hangzhou'
    ? '杭州'
    : identity.point === 'local'
      ? '本机'
      : identity.point === 'offline'
        ? '离线'
        : '未知指向';
  return `${identity.productVersion} · ${sha.length > 0 ? sha : '未知提交'} · ${point}`;
}
