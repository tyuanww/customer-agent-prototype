import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

type OperationView = {
  domain: string;
  operationId: string;
  state: string;
  canCancel: boolean;
  canRecover: boolean;
  releaseInvalidationPending: boolean;
};

test('real preload IPC projects running, unknown, committed, failed, cancelled, reopened and stale-session operation states', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const { parseContractSchema } = await import('../../../../packages/contracts/dist/index.js');
  const host = await createIntakeSyntheticHost({ profile: 'purpose-runtime', inputFormat: 'csv' });
  if (!host.candidate || !host.object) throw new Error('Synthetic publication fixture was not prepared');
  const key = host.candidate.key;
  const contentUrl = `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  const post = async (suffix: string, body: unknown) => {
    const response = await host.requestAs('enabler', `${contentUrl}/${suffix}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const value: unknown = await response.json();
    expect(response.ok, JSON.stringify(value)).toBe(true);
    return value;
  };
  await post('source-confirmation', {
    operationId: 'operation-source-confirmation', key, expectedEvidenceVersion: 0,
    confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-operation-export',
    acquisition: 'controlled-synthetic-export', objectSha256: host.object.sha256,
    reason: '合成 operation release fixture',
  });
  await post('quality/freeze', { operationId: 'operation-quality-freeze', key });
  const quality = parseContractSchema('IntakeQualityStatus', await (await host.requestAs('enabler', `${contentUrl}/quality?digest=${key.digest}`)).json());
  const samples = parseContractSchema('IntakeQualitySamplePage', await (await host.requestAs('enabler', `${contentUrl}/quality/samples?${new URLSearchParams({ digest: key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)).json());
  await post('quality/checks', {
    operationId: 'operation-quality-checks', key, phase: 'initial',
    checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })),
  });
  const receipt = parseContractSchema('IntakeReceipt', await post('publish', {
    operationId: 'operation-publish', key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1, confirmed: true,
    title: '合成 operation release', summary: 'release invalidation',
  }));
  expect(receipt.state).toBe('published');
  host.selectIdentity('agent');
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-operation-electron-'));
  const evidence = path.resolve(desktopRoot, '../../.gstack/dashboard-operation-control', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    app = await launchIntakeElectron({
      desktopRoot,
      userDataDirectory: directory,
      apiOrigin: host.apiOrigin,
      identityOrigin: host.identityOrigin,
      evidenceDirectory: evidence,
    });
    await expect.poll(() => app!.windows().some(page => page.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent));
    async function openQuery() {
      await app!.evaluate(({ app }) => app.focus({ steal: true }));
      await query.evaluate(() => window.customerAgent!.openSearch());
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
      await query.bringToFront();
    }
    async function login() {
      await openQuery();
      if (await query.getByRole('button', { name: '登录', exact: true }).count()) {
        await query.getByRole('button', { name: '登录', exact: true }).click();
        await expect.poll(() => app!.windows().some(page => page.url().includes('role=login'))).toBe(true);
        const loginWindow = app!.windows().find(page => page.url().includes('role=login'))!;
        await loginWindow.getByRole('button', { name: '飞书登录' }).click();
      }
      await expect.poll(async () => query.evaluate(async () => {
        const session = await window.customerAgent!.product!.sessionStatus();
        return session.ok && session.signedIn;
      })).toBe(true);
    }
    async function dashboardPage(): Promise<Page> {
      let dashboard = app!.windows().find(page => page.url().includes('role=dashboard'));
      if (!dashboard) {
        expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
        await expect.poll(() => app!.windows().some(page => page.url().includes('role=dashboard'))).toBe(true);
        dashboard = app!.windows().find(page => page.url().includes('role=dashboard'));
      }
      await dashboard!.waitForFunction(() => Boolean((window as unknown as {
        dashboardOperations?: unknown;
      }).dashboardOperations));
      return dashboard!;
    }
    async function current(dashboard: Page): Promise<OperationView[]> {
      const reply = await dashboard.evaluate(async () => (window as unknown as {
        dashboardOperations: { current(): Promise<{ views: OperationView[] }> };
      }).dashboardOperations.current());
      return reply.views;
    }
    await login();
    async function searchCurrentContent() {
      await openQuery();
      const filters = query.getByRole('button', { name: '筛选', exact: true });
      if (await filters.count()) {
        await filters.click();
        const shops = query.getByRole('combobox', { name: '当前店铺' });
        await expect(shops).toBeVisible();
        await shops.selectOption('shop-a');
      }
      await query.getByTestId('question-input').fill('洁面');
      await query.getByTestId('search-button').click();
      await expect(query.getByTestId('answer-text-1')).toBeVisible();
    }

    await searchCurrentContent();
    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: { plane: { submit(input: Record<string, unknown>): Promise<unknown> } };
      }).__dashboardOperationTest.plane;
      await plane.submit({
        domain: 'release',
        command: 'publish',
        capability: 'release:publish',
        intent: { case: 'release-invalidation-content' },
        execute: async () => ({ kind: 'committed', resultRef: 'rel-content', releaseId: 'rel-content' }),
      });
    });
    await expect(query.locator('[data-testid^="answer-text-"]')).toHaveCount(0);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-phase', 'SEARCH_INPUT');
    await query.evaluate(() => window.customerAgent!.dismiss());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await openQuery();
    await expect(query.locator('[data-testid^="answer-text-"]')).toHaveCount(0);
    await searchCurrentContent();
    let dashboard = await dashboardPage();
    expect((await current(dashboard)).some(view => view.domain === 'release' && view.state === 'committed')).toBe(true);
    const security = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .map(window => {
        const role = new URL(window.webContents.getURL()).searchParams.get('role');
        const preferences = (window.webContents as unknown as {
          getLastWebPreferences(): { sandbox: boolean; nodeIntegration: boolean; contextIsolation: boolean };
        }).getLastWebPreferences();
        return { role, sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation };
      })
      .filter((window): window is { role: string; sandbox: boolean; nodeIntegration: boolean; contextIsolation: boolean } => window.role !== null)
      .sort((left, right) => left.role.localeCompare(right.role)));
    expect(security).toEqual([
      { role: 'dashboard', sandbox: true, nodeIntegration: false, contextIsolation: true },
      { role: 'fox', sandbox: true, nodeIntegration: false, contextIsolation: true },
      { role: 'query', sandbox: true, nodeIntegration: false, contextIsolation: true },
    ]);

    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: {
            registerRecovery(domain: string, handler: () => Promise<unknown>): void;
            submit(input: Record<string, unknown>): Promise<unknown>;
          };
        };
      }).__dashboardOperationTest.plane;
      plane.registerRecovery('accounts', async () => ({ kind: 'unknown' }));
      await plane.submit({
        domain: 'accounts',
        command: 'accounts-manage',
        capability: 'accounts:reset',
        intent: { case: 'unknown' },
        execute: async () => ({ kind: 'unknown' }),
      });
    });
    await expect(dashboard.getByText('账号修改结果还未确认。请按原请求确认结果。')).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidence, 'operation-unknown.png') });
    await dashboard.getByRole('button', { name: '确认结果' }).click();
    await expect(dashboard.getByText('账号修改结果还未确认。请按原请求确认结果。')).toBeVisible();

    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: {
            registerRecovery(domain: string, handler: () => Promise<unknown>): void;
          };
        };
      }).__dashboardOperationTest.plane;
      plane.registerRecovery('accounts', async () => ({
        kind: 'committed',
        resultRef: 'seat-a',
      }));
    });
    await dashboard.getByRole('button', { name: '确认结果' }).click();
    await expect(dashboard.getByTestId('dashboard-operation-status')).toHaveCount(0);

    await app.evaluate(async () => {
      const global = globalThis as unknown as {
        __dashboardOperationTest: {
          plane: {
            submit(input: Record<string, unknown>): Promise<unknown>;
            currentSync(): OperationView[];
          };
        };
      };
      void global.__dashboardOperationTest.plane.submit({
        domain: 'permissions',
        command: 'grants-manage',
        capability: 'permissions:grant',
        intent: { case: 'running' },
        execute: async (context: { signal: AbortSignal }) => {
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { kind: 'cancelled' };
        },
      }).catch(() => undefined);
      const deadline = performance.now() + 2_000;
      while (performance.now() < deadline
        && !global.__dashboardOperationTest.plane['currentSync']().some((view: OperationView) => view.state === 'running')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    await expect(dashboard.getByText('权限修改正在处理，可以停止等待。')).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidence, 'operation-running.png') });
    await dashboard.getByRole('button', { name: '停止等待' }).click();
    await expect.poll(async () => (await current(dashboard)).some(view => (
      view.domain === 'permissions' && view.state === 'cancelled'
    ))).toBe(true);

    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: { plane: { submit(input: Record<string, unknown>): Promise<unknown> } };
      }).__dashboardOperationTest.plane;
      await plane.submit({
        domain: 'materials',
        command: 'import',
        capability: 'materials:import',
        intent: { case: 'failed' },
        execute: async () => ({ kind: 'failed', failureCode: 'VALIDATION' }),
      });
      await plane.submit({
        domain: 'ops-loop',
        command: 'content-manage',
        capability: 'ops-loop:content-manage',
        intent: { case: 'committed' },
        execute: async () => ({ kind: 'committed', resultRef: 'task-1' }),
      });
    });
    const terminal = await current(dashboard);
    expect(terminal.some(view => view.domain === 'materials' && view.state === 'failed')).toBe(true);
    expect(terminal.some(view => view.domain === 'ops-loop' && view.state === 'committed')).toBe(true);

    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: {
            setReleaseInvalidation(handler: (() => Promise<void>) | undefined): void;
            submit(input: Record<string, unknown>): Promise<unknown>;
          };
        };
      }).__dashboardOperationTest.plane;
      plane.setReleaseInvalidation(async () => { throw new Error('offline'); });
      await plane.submit({
        domain: 'release',
        command: 'publish',
        capability: 'release:publish',
        intent: { case: 'release-update' },
        execute: async () => ({
          kind: 'committed',
          resultRef: 'rel-synthetic',
          releaseId: 'rel-synthetic',
        }),
      });
    });
    await expect(dashboard.getByText('内容发布已保存，正在更新当前内容。')).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidence, 'operation-release-pending.png') });
    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: { setReleaseInvalidation(handler: (() => Promise<void>) | undefined): void };
        };
      }).__dashboardOperationTest.plane;
      plane.setReleaseInvalidation(async () => undefined);
    });
    await dashboard.getByRole('button', { name: '刷新查看' }).click();
    await expect(dashboard.getByTestId('dashboard-operation-status')).toHaveCount(0);
    await dashboard.screenshot({ path: path.join(evidence, 'operation-states.png') });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window =>
        window.webContents.getURL().includes('role=dashboard'))!.close();
    });
    await expect.poll(() => app!.windows().some(page => page.url().includes('role=dashboard'))).toBe(false);
    dashboard = await dashboardPage();
    expect((await current(dashboard)).some(view => (
      view.domain === 'release' && view.state === 'committed'
    ))).toBe(true);

    await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: { submit(input: Record<string, unknown>): Promise<unknown> };
        };
      }).__dashboardOperationTest.plane;
      await plane.submit({
        domain: 'ops-loop',
        operationId: 'operation-stale-session',
        command: 'content-manage',
        capability: 'ops-loop:content-manage',
        intent: { case: 'same-intent' },
        execute: async () => ({ kind: 'committed', resultRef: 'first' }),
      });
    });
    await dashboard.evaluate(async () => {
      const result = await window.dashboardContent?.logout?.();
      if (!result?.ok) throw new Error('synthetic logout failed');
    });
    await expect.poll(async () => query.evaluate(async () => {
      const session = await window.customerAgent!.product!.sessionStatus();
      return session.ok && !session.signedIn;
    })).toBe(true);
    await login();
    const stale = await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: {
            submit(input: Record<string, unknown>): Promise<unknown>;
          };
        };
      }).__dashboardOperationTest.plane;
      try {
        await plane.submit({
          domain: 'ops-loop',
          operationId: 'operation-stale-session',
          command: 'content-manage',
          capability: 'ops-loop:content-manage',
          intent: { case: 'same-intent' },
          execute: async () => ({ kind: 'committed', resultRef: 'second' }),
        });
        return { code: 'REPLAYED', message: 'identical request replayed' };
      } catch (error) {
        return error && typeof error === 'object'
          ? {
              code: 'code' in error ? error.code : 'UNKNOWN',
              message: 'message' in error ? error.message : null,
            }
          : { code: 'UNKNOWN', message: String(error) };
      }
    });
    expect(['STALE', 'FORBIDDEN']).toContain(stale.code);
    await dashboard.evaluate(async () => {
      const result = await window.dashboardContent?.logout?.();
      if (!result?.ok) throw new Error('synthetic logout failed');
    });
    host.selectIdentity('roster-nogrant');
    await login();
    const unauthorized = await app.evaluate(async () => {
      const plane = (globalThis as unknown as {
        __dashboardOperationTest: {
          plane: { submit(input: Record<string, unknown>): Promise<unknown> };
        };
      }).__dashboardOperationTest.plane;
      try {
        await plane.submit({
          domain: 'permissions',
          command: 'grants-manage',
          capability: 'permissions:grant',
          intent: { case: 'no-grant' },
          authorize: (view: { grants: string }) => view.grants === 'open',
          execute: async () => ({ kind: 'committed', resultRef: 'must-not-run' }),
        });
        return 'allowed';
      } catch (error) {
        return error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN';
      }
    });
    expect(unauthorized).toBe('FORBIDDEN');
  } finally {
    try {
      if (app) await closeOwnedElectron(app);
    } finally {
      await host.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
