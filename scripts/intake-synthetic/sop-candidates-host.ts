import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createSopCandidateDesktopFixture } from '../../apps/desktop/tests/support/sop-v12-normal-host.ts';

const { values } = parseArgs({ options: { identity: { type: 'string', multiple: true } } });
const [identity = 'agent', ...extraIdentities] = values.identity ?? [];
if (extraIdentities.length > 0 || (identity !== 'agent' && identity !== 'roster-nogrant')) {
  throw new Error('Specify --identity=agent or --identity=roster-nogrant at most once');
}

const stop = new AbortController();
const shutdown = () => stop.abort();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
const fixture = await createSopCandidateDesktopFixture();
let expiry: ReturnType<typeof setTimeout> | undefined;
try {
  if (!stop.signal.aborted) {
    fixture.host.selectIdentity(identity);
    const userData = mkdtempSync(path.join(tmpdir(), 'sop-candidate-desktop-'));
    const profile = path.join(userData, 'synthetic-stack.json');
    writeFileSync(profile, JSON.stringify(fixture.desktopProfile, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.info(JSON.stringify({ status: 'READY_SYNTHETIC_ONLY', userData, profile, identity,
      shop: 'shop-a', question: '合成入口', expiresAt: fixture.host.expiresAt }));
    expiry = setTimeout(shutdown, Math.max(0, Date.parse(fixture.host.expiresAt) - Date.now()));
    await new Promise<void>(resolve => stop.signal.addEventListener('abort', () => resolve(), { once: true }));
  }
} finally {
  clearTimeout(expiry);
  await fixture.host.close();
  process.off('SIGINT', shutdown);
  process.off('SIGTERM', shutdown);
  console.info('临时数据库已关闭。桌面配置目录由本次验收保留。');
}
