import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { SOP_UNIFIED_CONTRACT } from '../../src/shared/sop-unified';
import { intakeQueryData } from '../fixtures/intake-query-data';
import { startUnifiedHost } from '../support/sop-unified-host';
import { closeOwnedElectron } from '../support/owned-electron';

/** Shipped Main, sandbox preload, native window and native clipboard over loopback synthetic HTTP. */
test('v11 complete graph, native-window destruction and clipboard keep protected SOP progress fenced', async () => {
  const host = await startUnifiedHost(), legacy = intakeQueryData(), token = 's'.repeat(43);
  // Exercise the GIF decoder without requiring a PostgreSQL fixture.
  host.fixture.image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  for (const media of host.fixture.result.media) {
    media.binding.mime = 'image/gif';
    media.binding.bytes = host.fixture.image.length;
    media.binding.sha256 = createHash('sha256').update(host.fixture.image).digest('hex');
  }
  const reused = structuredClone(host.fixture.result.media[0]!);
  reused.binding.graphTarget = { kind: 'task', id: 'decision' };
  reused.binding.alt = '合成复用资源判断图';
  host.fixture.result.media.push(reused);
  const evidence = process.env.CUSTOMER_AGENT_SOP_UNIFIED_EVIDENCE
    ?? mkdtempSync(path.join(tmpdir(), 'customer-agent-sop-unified-evidence-'));
  mkdirSync(evidence, { recursive: true });
  let authorized = false, apiOrigin = '', identityOrigin = '';
  const api = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://synthetic.invalid');
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks), input = bytes.length ? JSON.parse(bytes.toString()) : {};
    const send = (value: unknown, status = 200) => { res.setHeader('content-type', 'application/json'); res.statusCode = status; res.end(status === 204 ? undefined : JSON.stringify(value)); };
    if (url.pathname === '/v1/auth/login-requests') return send({ login_id: `login_${'l'.repeat(43)}`, authorize_url: `${identityOrigin}/authorize?state=synthetic`, expires_at: new Date(Date.now() + 300_000).toISOString() }, 201);
    if (url.pathname === '/v1/auth/callback') { authorized = true; return send({ ok: true }); }
    if (url.pathname.endsWith('/exchange')) return send(authorized ? { access_token: token, token_type: 'Bearer', expires_at: new Date(Date.now() + 899_000).toISOString() } : { status: 'pending', retry_after_seconds: 1 }, authorized ? 200 : 202);
    if (!authorized || req.headers.authorization !== `Bearer ${token}`) return send({}, 401);
    if (url.pathname === '/v1/auth/me') return send({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
    if (url.pathname === '/v1/auth/logout') { authorized = false; return send(null, 204); }
    if (url.pathname === '/v1/notices/current') return send({}, 410);
    if (req.headers['x-intake-contract-set'] === SOP_UNIFIED_CONTRACT) {
      try {
        const response = await fetch(`${host.origin}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json', 'x-intake-contract-set': SOP_UNIFIED_CONTRACT,
          ...(typeof req.headers['x-sop-continuation'] === 'string' ? { 'x-sop-continuation': req.headers['x-sop-continuation'] } : {}) }, ...(bytes.length ? { body: bytes } : {}) });
        res.writeHead(response.status, Object.fromEntries(response.headers.entries())); res.end(Buffer.from(await response.arrayBuffer())); return;
      } catch { return send({}, 503); }
    }
    if (url.pathname.startsWith('/v1/intake/')) { try { return send(legacy.respond(req.url!, input)); } catch { return send({}, 403); } }
    return send({}, 404);
  });
  const identity = createServer((req, res) => {
    if (req.url?.startsWith('/authorize')) { res.writeHead(302, { location: `${apiOrigin}/v1/auth/callback?state=synthetic&code=synthetic` }); res.end(); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const port = (api.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => { identity.once('error', reject); identity.listen(port + 1, '127.0.0.1', resolve); });
  apiOrigin = `http://127.0.0.1:${port}`; identityOrigin = `http://127.0.0.1:${port + 1}`;
  const directory = mkdtempSync(path.join(evidence, 'electron-user-data-'));
  let app: ElectronApplication | undefined;
  try {
    const executablePath = process.env.SOP_ELECTRON_EXECUTABLE ?? createRequire(import.meta.url)('electron') as string;
    app = await electron.launch({ executablePath, cwd: fileURLToPath(new URL('../..', import.meta.url)),
      args: [`--user-data-dir=${directory}`, ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []), 'out/main/index.js', '--demo-e2e'],
      env: { ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: apiOrigin, CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: identityOrigin,
        CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2', CUSTOMER_AGENT_DESKTOP_SOP_QUERY: 'menokin-sop-unified-v11', CUSTOMER_AGENT_DESKTOP_SOP_CONTRACT_SET: SOP_UNIFIED_CONTRACT } });
    const storage = await app.evaluate(({ safeStorage }) => ({ available: safeStorage.isEncryptionAvailable(), backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'native' }));
    expect(storage.available).toBe(true); expect(storage.backend).not.toBe('basic_text');
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(window => window.url().includes('role=query'))!;
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    const loginOpened = app.waitForEvent('window'); await query.getByRole('button', { name: '登录', exact: true }).click();
    const login = await loginOpened; await expect.poll(() => login.url()).toContain('role=login');
    await login.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => { const value = await window.customerAgent!.product!.sessionStatus(); return value.ok && value.signedIn; })).toBe(true);
    await query.getByRole('button', { name: '打开 SOP 流程' }).click();
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=sop'))).toBe(true);
    const sop = app.windows().find(window => window.url().includes('role=sop'))!;
    await expect(sop.getByText('synthetic-shop', { exact: true })).toBeVisible();
    host.state.mediaDelayMs = 2000;
    await sop.getByRole('textbox', { name: '问题' }).fill('合成完整流程');
    await sop.getByRole('button', { name: '查询流程' }).click();
    await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
    await expect(sop.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await expect(sop.getByText('图片正在读取。', { exact: true })).toHaveCount(3);
    await expect(sop.getByRole('button', { name: '复制话术', exact: true }).first()).toBeDisabled();
    for (const label of ['1. 先核对合成型号', '2. 再核对合成数量']) {
      await sop.getByRole('checkbox', { name: label }).click();
      await expect(sop.getByRole('checkbox', { name: label })).toBeChecked();
    }
    await expect(sop.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await expect(sop.getByRole('img', { name: '合成图片1' })).toBeVisible();
    await expect(sop.locator('figure img')).toHaveCount(3);
    await expect.poll(() => sop.locator('figure img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    await sop.screenshot({ path: path.join(evidence, 'electron-action.png') });
    for (let index = 0; index < 2; index++) {
      await sop.getByRole('button', { name: '复制话术', exact: true }).nth(index).click();
      await expect(sop.getByText('已复制', { exact: true })).toBeVisible();
      await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-busy', 'false');
      const expectedText = host.fixture.result.entries[index]!.entry.answerText;
      expect(await app.evaluate(({ clipboard }, text) => clipboard.readText() === text, expectedText)).toBe(true);
    }
    await expect(sop.getByRole('checkbox', { name: '1. 先核对合成型号' })).toBeChecked();
    await expect(sop.getByRole('checkbox', { name: '2. 再核对合成数量' })).toBeChecked();
    await query.evaluate(() => window.customerAgent!.intakeQuery!.access());
    await expect(sop.getByRole('checkbox', { name: '1. 先核对合成型号' })).toBeChecked();
    const oldContinuation = [...host.continuations.keys()][0]!;
    host.state.releaseId = 'synthetic-release-2';
    host.state.authorized = false;
    await sop.getByRole('button', { name: '复制话术', exact: true }).first().click();
    await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'paused');
    await expect(sop.getByText(host.fixture.result.flow.nodes[0]!.body.knowledge[0]!.body, { exact: true })).toHaveCount(0);
    host.state.authorized = true;
    await sop.getByRole('button', { name: '重新确认并继续' }).click();
    await expect(sop.getByRole('checkbox', { name: '1. 先核对合成型号' })).toBeChecked();
    expect(host.continuations.get(oldContinuation)?.releaseId).toBe('synthetic-release-1');
    await sop.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(sop.getByText('判断依据 合成记录明确包含标记')).toBeVisible();
    await expect(sop.getByRole('img', { name: '合成复用资源判断图' })).toBeVisible();
    await expect(sop.locator('figure')).toHaveCount(1);
    await expect(sop.getByRole('img', { name: '合成图片1', exact: true })).toHaveCount(0);
    await expect(sop.getByRole('button', { name: '证据不足 / 无法判断' })).toBeVisible();
    await sop.screenshot({ path: path.join(evidence, 'electron-decision.png') });
    await sop.getByRole('button', { name: '证据不足 / 无法判断' }).click();
    await expect(sop.getByText('流程已到最后一步，请人工确认处理结果。')).toBeVisible();
    const isolation = await sop.evaluate(() => ({ require: typeof Reflect.get(window, 'require'), customerAgent: typeof window.customerAgent,
      api: Object.keys(window.sopWindow!), body: document.body.textContent }));
    expect(isolation.require).toBe('undefined'); expect(isolation.customerAgent).toBe('undefined');
    expect(isolation.api).not.toContain('invoke'); expect(isolation.body).not.toMatch(/sct_|entitlementId|preview_handle/);
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('role=sop')).map(window => ({ bounds: window.getBounds() })));
    expect(windows[0]!.bounds.width).toBe(600); expect(windows[0]!.bounds.height).toBeLessThanOrEqual(620);
    await sop.getByRole('button', { name: '结束并清除进度' }).click();
    await expect.poll(() => host.continuations.get(oldContinuation)?.dead).toBe(true);
    for (const media of host.fixture.result.media) media.binding.required = false;
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: '打开 SOP 流程' }).click();
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=sop'))).toBe(true);
    const optional = app.windows().find(window => window.url().includes('role=sop'))!;
    await expect(optional.getByText('synthetic-shop', { exact: true })).toBeVisible();
    await optional.getByRole('textbox', { name: '问题' }).fill('合成完整流程');
    await optional.getByRole('button', { name: '查询流程' }).click();
    await expect(optional.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
    await expect(optional.getByText('图片正在读取。', { exact: true })).toHaveCount(3);
    await expect(optional.locator('figure img')).toHaveCount(0);
    await optional.getByRole('button', { name: '复制话术', exact: true }).first().click();
    await expect(optional.getByText('已复制', { exact: true })).toBeVisible();
    await expect(optional.getByTestId('sop-unified-shell')).toHaveAttribute('data-busy', 'false');
    expect(await app.evaluate(({ clipboard }, text) => clipboard.readText() === text, host.fixture.result.entries[0]!.entry.answerText)).toBe(true);
    for (const label of ['1. 先核对合成型号', '2. 再核对合成数量']) {
      await optional.getByRole('checkbox', { name: label }).click();
      await expect(optional.getByRole('checkbox', { name: label })).toBeChecked();
    }
    await expect(optional.getByText('图片正在读取。', { exact: true })).toHaveCount(3);
    await optional.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(optional.getByText('判断依据 合成记录明确包含标记')).toBeVisible();
    await expect(optional.locator('figure')).toHaveCount(1);
    await expect(optional.locator('figure figcaption')).toContainText('合成复用资源判断图');
    await expect(optional.getByRole('img', { name: '合成图片1', exact: true })).toHaveCount(0);
    const optionalContinuation = [...host.continuations.keys()].find(id => id !== oldContinuation)!;
    await optional.getByRole('button', { name: '结束并清除进度' }).click();
    await expect.poll(() => host.continuations.get(optionalContinuation)?.dead).toBe(true);
    for (const unavailable of [false, true]) {
      await query.evaluate(() => window.customerAgent!.openSearch());
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
      await query.getByRole('button', { name: '打开 SOP 流程' }).click();
      await expect.poll(() => app!.windows().some(window => window.url().includes('role=sop'))).toBe(true);
      const destroyed = app.windows().find(window => window.url().includes('role=sop'))!;
      await expect(destroyed.getByText('synthetic-shop', { exact: true })).toBeVisible();
      const before = new Set(host.continuations.keys());
      await destroyed.getByRole('textbox', { name: '问题' }).fill('合成完整流程');
      await destroyed.getByRole('button', { name: '查询流程' }).click();
      await expect(destroyed.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
      const requirement = destroyed.getByRole('checkbox', { name: '1. 先核对合成型号' });
      await requirement.click(); await expect(requirement).toBeChecked();
      const old = [...host.continuations.keys()].find(id => !before.has(id))!;
      host.state.closeUnavailable = unavailable;
      const closeCount = host.requests.filter(request => request.path.endsWith('/continuations/close')).length;
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('role=sop'));
        if (!window) throw new Error('Expected owned SOP native window');
        window.destroy();
      });
      await expect.poll(() => destroyed.isClosed()).toBe(true);
      await expect.poll(() => host.requests.filter(request => request.path.endsWith('/continuations/close')).length).toBe(closeCount + 1);
      if (!unavailable) await expect.poll(() => host.continuations.get(old)?.dead).toBe(true);
      else expect(host.continuations.get(old)?.dead).toBe(false);
      host.state.closeUnavailable = false;
      await query.evaluate(() => window.customerAgent!.openSearch());
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
      await query.getByRole('button', { name: '打开 SOP 流程' }).click();
      await expect.poll(() => app!.windows().some(window => window.url().includes('role=sop'))).toBe(true);
      const reopened = app.windows().find(window => window.url().includes('role=sop'))!;
      await expect(reopened.getByText('synthetic-shop', { exact: true })).toBeVisible();
      await expect(reopened.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'idle');
      await expect(reopened.getByRole('checkbox')).toHaveCount(0);
      await expect(reopened.getByRole('button', { name: '重新确认并继续' })).toHaveCount(0);
      await reopened.getByRole('textbox', { name: '问题' }).fill('合成完整流程');
      await reopened.getByRole('button', { name: '查询流程' }).click();
      await expect(reopened.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
      await expect(reopened.getByRole('checkbox', { name: '1. 先核对合成型号' })).not.toBeChecked();
      await expect.poll(() => host.continuations.size).toBe(before.size + 2);
      const fresh = [...host.continuations.keys()].find(id => !before.has(id) && id !== old)!;
      expect(fresh).not.toBe(old);
      await reopened.getByRole('button', { name: '结束并清除进度' }).click();
      await expect.poll(() => host.continuations.get(fresh)?.dead).toBe(true);
    }
    writeFileSync(path.join(evidence, 'electron-result.json'), JSON.stringify({ synthetic: true, postgres: false, nativeClipboardAfterCopy: true, scriptsCopied: 3, requiredProgressiveMedia: true, optionalCopyAndAdvanceWhileLoading: true, reusedResourceOwnerIsolation: true, nativeDestructionDiscardCases: 2, offlineDestroyedRemoteClose: 'unconfirmed',
      retainedRelease: 'synthetic-release-1', currentRelease: host.state.releaseId, closed: true, window: windows[0]!.bounds,
      operations: host.requests.map(request => request.path) }, null, 2));
  } finally {
    if (app) await closeOwnedElectron(app);
    api.closeAllConnections(); identity.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => api.close(() => resolve())), new Promise<void>(resolve => identity.close(() => resolve())), host.close()]);
    rmSync(directory, { recursive: true, force: true });
  }
});
