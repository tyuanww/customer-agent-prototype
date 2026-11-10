import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { parseContractSchema, type components } from '@customer-agent/contracts/sop-resource-disable';
import { SOP_RESOURCE_CONTRACT, type SopUnifiedProjection } from '../../src/shared/sop-unified';
import type { IntakeQuerySelection } from '../../src/shared/content-intake-query';
import { developmentProductProfile } from '../../src/main/product-runtime-config';
import { closeOwnedElectron } from './owned-electron';

type C = components['schemas'];
export type SopWireExchange = {
  path: string;
  body: unknown;
  continuation: string | null;
  status: number;
  value: unknown;
};
type ProbeState = {
  exchanges: SopWireExchange[];
  requests: { origin: string; path: string; method: string }[];
  pending: Promise<void>[];
  copies: string[];
  closeUnavailable: boolean;
  mediaDelayMs: number;
  queryDelayMs: number;
};

export async function readSopV12Probe(app: ElectronApplication) {
  return app.evaluate(async () => {
    const state = (globalThis as typeof globalThis & { __sopV12Probe: ProbeState }).__sopV12Probe;
    await Promise.all(state.pending);
    return { exchanges: state.exchanges, requests: state.requests, copies: state.copies };
  });
}
export async function setSopV12CloseUnavailable(app: ElectronApplication, unavailable: boolean) {
  await app.evaluate((_, value) => {
    (globalThis as typeof globalThis & { __sopV12Probe: ProbeState }).__sopV12Probe.closeUnavailable = value;
  }, unavailable);
}
export async function setSopV12MediaDelay(app: ElectronApplication, delayMs: number) {
  await app.evaluate((_, value) => {
    (globalThis as typeof globalThis & { __sopV12Probe: ProbeState }).__sopV12Probe.mediaDelayMs = value;
  }, delayMs);
}
export async function setSopV12QueryDelay(app: ElectronApplication, delayMs: number) {
  await app.evaluate((_, value) => {
    (globalThis as typeof globalThis & { __sopV12Probe: ProbeState }).__sopV12Probe.queryDelayMs = value;
  }, delayMs);
}
export async function readSopV12Projection(page: Page): Promise<SopUnifiedProjection> {
  return page.evaluate(async () => {
    let unsubscribe: (() => void) | undefined;
    const projection = await new Promise<SopUnifiedProjection>(resolve => {
      unsubscribe = window.sopWindow!.onProjection(value => {
        if ('projectionVersion' in value && value.projectionVersion === 'sop-unified-v11') resolve(value);
      });
    });
    unsubscribe?.();
    return projection;
  });
}
export type SopBackendOpeningEvidence = {
  query: C['MenokinSopQuerySopQueryRequest'];
  ready: C['MenokinSopQuerySopReadyResponse'];
  opening: C['IntakeSopActionCheck'];
  receipt: C['IntakeSopContinuationReceipt'];
  queryLease: { id: string; requestId: string; releaseId: string; expiresAt: string };
  mediaReads: { binding: C['IntakeSopMedia']; payload: C['IntakeSopMediaPayload'] }[];
};
export type SopV12BackendProbe = {
  apiOrigin: string;
  identityOrigin: string;
  evidenceDirectory: string;
  shopId: string;
  selection: IntakeQuerySelection;
  group: C['MenokinSopQuerySopQueryRequest']['sop_group'];
  queryText: string;
  expectedMessage: string;
  mediaDelayMs?: number;
  queryDelayMs?: number;
  /** The normal B/C/D fixture reads its actual committed records and HTTP observations. */
  observeOpening(surface: { app: ElectronApplication; sop: Page; query: Page }): Promise<SopBackendOpeningEvidence>;
  recoverOpening?(surface: { app: ElectronApplication; sop: Page; query: Page }): Promise<void>;
  afterCopy?(surface: { app: ElectronApplication; sop: Page; query: Page; evidence: SopBackendOpeningEvidence }): Promise<void>;
};

/** Uses a caller-owned normal backend. This probe supplies no HTTP responses or database rows. */
export async function runSopV12BackendProbe(input: SopV12BackendProbe) {
  const env = { ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: input.apiOrigin,
    CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: input.identityOrigin, CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2',
    CUSTOMER_AGENT_DESKTOP_SOP_QUERY: 'menokin-sop-unified-v12', CUSTOMER_AGENT_DESKTOP_SOP_CONTRACT_SET: SOP_RESOURCE_CONTRACT };
  const profile = developmentProductProfile(env);
  expect(profile).toMatchObject({ mode: 'synthetic-local', sopContractSet: SOP_RESOURCE_CONTRACT });
  mkdirSync(input.evidenceDirectory, { recursive: true });
  const directory = mkdtempSync(path.join(input.evidenceDirectory, 'v12-user-data-'));
  writeFileSync(path.join(directory, 'synthetic-stack.json'), JSON.stringify(profile));
  let app: ElectronApplication | undefined;
  try {
    const executablePath: unknown = process.env.SOP_ELECTRON_EXECUTABLE ?? createRequire(import.meta.url)('electron');
    if (typeof executablePath !== 'string') throw new Error('Workspace Electron executable is unavailable');
    const packaged = process.env.CUSTOMER_AGENT_SOP_PACKAGED === '1';
    if (packaged && !process.env.SOP_ELECTRON_EXECUTABLE) throw new Error('Packaged SOP test requires an explicit artifact executable');
    const launchEnvironment = packaged ? { ...env,
      CUSTOMER_AGENT_DESKTOP_API_ORIGIN: 'http://127.0.0.1:1',
      CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: 'http://127.0.0.1:2',
    } : env;
    app = await electron.launch({ executablePath, cwd: fileURLToPath(new URL('../..', import.meta.url)),
      args: [`--user-data-dir=${directory}`, ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []), 'out/main/index.js', '--demo-e2e'], env: launchEnvironment });
    const runtime = await app.evaluate(({ app: nativeApp }) => ({
      packaged: nativeApp.isPackaged, userData: nativeApp.getPath('userData'), appPath: nativeApp.getAppPath(),
    }));
    expect(runtime.packaged).toBe(packaged);
    expect(realpathSync(runtime.userData)).toBe(realpathSync(directory));
    writeFileSync(path.join(input.evidenceDirectory, 'launch.json'), JSON.stringify({ executablePath, ...runtime,
      environmentOriginsDifferFromProfile: packaged, profile }, null, 2));
    await expect.poll(() => app!.windows().some(page => page.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    await app.evaluate(({ app: nativeApp }) => nativeApp.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    const opened = app.waitForEvent('window');
    await query.getByRole('button', { name: '登录', exact: true }).click();
    const login = await opened;
    await expect.poll(() => login.url()).toContain('role=login');
    await login.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => {
      const status = await window.customerAgent!.product!.sessionStatus();
      return status.ok && status.signedIn;
    })).toBe(true);
    await app.evaluate(({ clipboard }, origin) => {
      const state: ProbeState = { exchanges: [], requests: [], pending: [], copies: [], closeUnavailable: false,
        mediaDelayMs: 0, queryDelayMs: 0 };
      Object.defineProperty(globalThis, '__sopV12Probe', { value: state, configurable: true });
      const actualFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        state.requests.push({ origin: url.origin, path: url.pathname, method: init?.method ?? 'GET' });
        if (state.closeUnavailable && url.pathname === '/v1/intake/sop/continuations/close') {
          throw new Error('SYNTHETIC_LOOPBACK_CLOSE_OFFLINE');
        }
        const response = await actualFetch(input, init);
        if (url.origin === origin && (url.pathname === '/v1/sop/query'
          || url.pathname === '/v1/intake/entitlements' || url.pathname === '/v1/intake/authorization'
          || url.pathname === '/v1/intake/sources' || url.pathname.endsWith('/vocabulary')
          || url.pathname.startsWith('/v1/intake/sop/'))) {
          const exchange: SopWireExchange = { path: url.pathname + url.search,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
            continuation: new Headers(init?.headers).get('x-sop-continuation'), status: response.status, value: null };
          state.exchanges.push(exchange);
          state.pending.push(response.clone().text().then(text => {
            exchange.value = text ? JSON.parse(text) : null;
          }).catch(error => {
            exchange.value = { captureError: error instanceof Error ? error.message : String(error) };
          }));
        }
        if (url.pathname.includes('/media/') && state.mediaDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, state.mediaDelayMs));
        }
        if (url.pathname === '/v1/sop/query' && state.queryDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, state.queryDelayMs));
        }
        return response;
      };
      const actualWrite = clipboard.writeText.bind(clipboard);
      clipboard.writeText = (text, type) => { actualWrite(text, type); state.copies.push(text); };
    }, input.apiOrigin);
    try {
      await query.getByRole('button', { name: '筛选', exact: true }).click();
      const shop = query.getByRole('combobox', { name: '当前店铺', exact: true });
      await expect(shop).toBeEnabled();
      await shop.selectOption(input.shopId);
      for (const [label, ids] of [['商品', input.selection.productIds], ['场景', input.selection.scenarioIds]] as const) {
        await query.locator('summary').filter({ hasText: label }).click();
        for (const id of ids) {
          const option = query.getByTitle(id, { exact: true }).getByRole('checkbox');
          await option.check();
          await expect(option).toBeChecked();
          await expect(option).toBeEnabled();
        }
      }
    } catch (error) {
      writeFileSync(path.join(input.evidenceDirectory, 'selection-failure.json'), JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        alerts: await query.locator('[role=alert]').allTextContents(), observed: await readSopV12Probe(app),
      }, null, 2));
      throw error;
    }
    await query.getByRole('button', { name: '打开 SOP 流程' }).click();
    await expect.poll(() => app!.windows().some(page => page.url().includes('role=sop'))).toBe(true);
    const sop = app.windows().find(page => page.url().includes('role=sop'))!;
    if (input.mediaDelayMs) await setSopV12MediaDelay(app, input.mediaDelayMs);
    if (input.queryDelayMs) await setSopV12QueryDelay(app, input.queryDelayMs);
    await sop.getByRole('combobox', { name: '店铺', exact: true }).click();
    await sop.getByText(input.shopId, { exact: true }).last().click();
    await sop.getByRole('combobox', { name: '流程', exact: true }).click();
    await sop.getByText(input.group, { exact: true }).last().click();
    await sop.getByRole('textbox', { name: '问题', exact: true }).fill(input.queryText);
    await sop.getByRole('button', { name: '查询流程', exact: true }).click();
    await input.recoverOpening?.({ app, sop, query });
    await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
    const card = sop.locator('article').filter({ has: sop.getByText(input.expectedMessage, { exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: '复制话术' })).toBeEnabled({ timeout: input.mediaDelayMs ? 10_000 : 5000 });
    const evidence = await input.observeOpening({ app, sop, query });
    const request = parseContractSchema('MenokinSopQuerySopQueryRequest', evidence.query);
    const ready = parseContractSchema('MenokinSopQuerySopReadyResponse', evidence.ready);
    const opening = parseContractSchema('IntakeSopActionCheck', evidence.opening);
    const receipt = parseContractSchema('IntakeSopContinuationReceipt', evidence.receipt);
    expect(evidence.queryLease.id.length).toBeGreaterThan(0);
    expect(evidence.queryLease).toMatchObject({ requestId: request.request_id, releaseId: ready.release_id });
    expect(Date.parse(evidence.queryLease.expiresAt)).toBe(Date.parse(ready.lease_expires_at));
    expect(request.request_id).toBe(ready.request_id);
    expect(opening).toMatchObject({ action: 'open', queryRequestId: request.request_id,
      entitlementId: request.entitlement_id, releaseId: ready.release_id,
      graphDigest: ready.result.graph_digest, key: ready.result.flow.header.key });
    expect(receipt.continuationId).toBe(opening.continuationId);
    expect(receipt.entitlement.releaseId).toBe(ready.release_id);
    expect(receipt.entitlement.shopId).toBe(input.shopId);
    expect(receipt.entitlement.contextGeneration).toBe(opening.contextGeneration);
    const projection = await readSopV12Projection(sop);
    const serializedProjection = JSON.stringify(projection);
    for (const secret of [opening.continuationId, request.entitlement_id, receipt.entitlement.entitlementId,
      request.request_id, request.context_generation, evidence.queryLease.id]) {
      expect(serializedProjection).not.toContain(secret);
    }
    await sop.screenshot({ path: path.join(input.evidenceDirectory, 'normal-sop-window.png') });
    writeFileSync(path.join(input.evidenceDirectory, 'renderer-projection.json'), JSON.stringify(projection, null, 2));
    const shown = await sop.locator('figure.sop-unified-media').evaluateAll(figures => figures.flatMap(figure => {
      const image = figure.querySelector('img');
      return image ? [{ src: image.getAttribute('src'), alt: image.alt, caption: figure.querySelector('figcaption')?.textContent }] : [];
    }));
    for (const { src, alt, caption } of shown) {
      expect(src).toMatch(/^data:image\/(png|jpeg|gif);base64,/);
      if (src === null) throw new Error('Displayed media source is missing');
      const bytes = Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const read = evidence.mediaReads.find(item => {
        const owner = item.binding.entry ? '话术资料' : item.binding.graphTarget?.kind === 'task' ? '任务资料' : '知识资料';
        return item.payload.sha256 === sha256 && item.binding.alt === alt && caption?.startsWith(owner);
      });
      expect(read).toBeDefined();
      if (!read) throw new Error('Displayed media has no actual backend read');
      const payload = parseContractSchema('IntakeSopMediaPayload', read.payload);
      const binding = parseContractSchema('IntakeSopMedia', read.binding);
      expect(binding.flowKey).toEqual(opening.key);
      expect(payload).toMatchObject({ releaseId: ready.release_id, entitlementId: receipt.entitlement.entitlementId,
        objectId: read.binding.objectId, sha256: read.binding.sha256, mime: read.binding.mime, bytes: bytes.length });
      expect(Buffer.from(payload.base64, 'base64').equals(bytes)).toBe(true);
    }
    await card.getByRole('button', { name: '复制话术' }).click();
    await expect(sop.getByText('已复制', { exact: true })).toBeVisible();
    await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-busy', 'false');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(input.expectedMessage);
    await input.afterCopy?.({ app, sop, query, evidence });
    return evidence;
  } catch (error) {
    if (app) {
      try {
        const sop = app.windows().find(page => page.url().includes('role=sop'));
        writeFileSync(path.join(input.evidenceDirectory, 'failure.json'), JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          probe: await readSopV12Probe(app),
          projection: sop ? await readSopV12Projection(sop) : null,
          body: sop ? await sop.locator('body').innerText() : null,
        }, null, 2));
        if (sop) await sop.screenshot({ path: path.join(input.evidenceDirectory, 'failure.png') });
      } catch (captureError) {
        writeFileSync(path.join(input.evidenceDirectory, 'capture-failure.txt'), String(captureError));
      }
    }
    throw error;
  } finally {
    if (app) await closeOwnedElectron(app);
    rmSync(directory, { recursive: true, force: true });
  }
}
