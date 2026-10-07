#!/usr/bin/env node
import { createInterface, type Interface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createIntakeSyntheticHost } from '../../apps/api/tests/support/intake-synthetic-host.ts';

/** Foreground, ephemeral and synthetic only. No stack env files or arbitrary
 * paths/SQL/URLs are accepted. stdin commands are a local test control surface. */
if (process.argv.length !== 2) throw new Error('Usage: node scripts/intake-synthetic/run.ts');
// The separately launched Electron owns this path. It must not sit below the
// host's temporary root, which can be removed while Electron is still running.
const desktopProfile = path.join(tmpdir(), `intake-synthetic-desktop-${randomUUID()}`);
let host: Awaited<ReturnType<typeof createIntakeSyntheticHost>> | undefined = undefined;
let input: Interface | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined, warning: ReturnType<typeof setTimeout> | undefined;
let stopRequested: string | null = null;
let stopped = false;
async function stop(reason: string) {
  stopRequested ??= reason;
  // Startup owns any partially created resources until its promise settles.
  // Record signals now; do not race a partial close against initialization.
  if (!host || stopped) return;
  stopped = true; clearTimeout(expiry); clearTimeout(warning); input?.close();
  try { await host.close(); console.info(JSON.stringify({ status: 'STOPPED', reason: stopRequested, hostDataRemoved: true, desktopProfileRetained: desktopProfile })); }
  catch (error) { console.error('临时宿主清理失败', error); process.exitCode = 1; }
}
// Register before PG starts. Keep handlers installed through cleanup so a second
// signal cannot restore the default immediate exit and strand owned resources.
process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });
// createIntakeSyntheticHost cleans its partial resources before rejecting.
host = await createIntakeSyntheticHost();
if (stopRequested) {
  await stop(stopRequested);
} else {
  const readyHost = host;
  input = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  let tasks = Promise.resolve();
  const help = () => console.info('固定命令：status | identity enabler | identity reviewer | identity agent | approve | quit');
  console.info(JSON.stringify({ status: 'READY_SYNTHETIC_ONLY', apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin,
    candidate: host.candidate.key, expiresAt: host.expiresAt, hostDirectory: host.root, desktopProfile,
    persistent: false, approval: 'manual-synthetic-transport' }));
  console.info('当前身份：enabler。先在工作台查看材料、确认来源并发起审批，再在此输入 approve，回到工作台刷新审批结果、完成人工质量检查并发布。');
  console.info('输入 identity agent 后在桌面退出并重新登录，可检索刚发布的通用 FAQ。该命令只选择下一次合成登录，不改变已有会话。');
  console.info('数据、身份和审批均为临时合成内容。约5分钟后事实资格到期并清理宿主PG/对象；需要更长验证时退出桌面并重新启动此入口，不延长生产TTL。');
  console.info(`桌面启动（需先构建）：CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE=faq-v2 CUSTOMER_AGENT_DESKTOP_API_ORIGIN=${host.apiOrigin} CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN=${host.identityOrigin} pnpm --filter @customer-agent/desktop exec electron --user-data-dir='${desktopProfile}' out/main/index.js`);
  console.info(`桌面目录由另起的Electron持有，本宿主不删除。退出Electron后请手动清理：${desktopProfile}`);
  help();
  const remaining = Math.max(0, Date.parse(host.expiresAt) - Date.now());
  warning = setTimeout(() => console.info('资格即将在30秒内到期，请退出桌面；宿主会自动停止并删除PG/对象，桌面目录仍保留。'), Math.max(0, remaining - 30_000));
  expiry = setTimeout(() => { void stop('synthetic-facts-expired'); }, remaining);
  input.on('line', line => {
    tasks = tasks.then(async () => {
      if (stopped) return;
      const command = line.trim();
      if (command === 'quit') { await stop('requested'); return; }
      if (command === 'status') { console.info(JSON.stringify(await readyHost.status())); return; }
      if (command === 'approve') { console.info(JSON.stringify(readyHost.approveReview())); return; }
      const match = /^identity (enabler|reviewer|agent)$/.exec(command);
      if (match) { readyHost.selectIdentity(match[1] as 'enabler' | 'reviewer' | 'agent'); console.info(`下一次合成登录：${match[1]}`); return; }
      help();
    }).catch(error => { console.error(error instanceof Error ? error.message : '合成命令失败'); });
  });
  // EOF may arrive in the same tick as several complete lines. Drain those fixed
  // commands before cleanup, otherwise piped status/identity/quit never execute.
  input.on('close', () => { void tasks.then(() => stop('stdin-closed')); });
  input.on('SIGINT', () => { void stop('SIGINT'); });
}
