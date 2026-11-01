import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('synthetic task, knowledge and wording images decode in the shared execution and manual views', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-images-e2e-'));
  const archive = process.env.SOP_IMAGES_E2E_ASAR;
  let app: ElectronApplication | undefined;
  try {
    app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData, archive });
    const running = app;
    await expect.poll(() => running.windows().length).toBeGreaterThanOrEqual(2);
    const fox = running.windows().find(page => page.url().includes('role=fox'))!;
    const query = running.windows().find(page => page.url().includes('role=query'))!;
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByTestId('question-input').fill('少件了，没收到全部');
    await query.getByTestId('question-input').press('Enter');
    await query.getByRole('button', { name: '进入少件处理', exact: true }).click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    const before = await query.evaluate(async () => { const snapshot = await window.customerAgent!.sopWindow!.current!(); return snapshot.kind === 'ready' ? snapshot.projection : null; });

    const taskAlt = '合成示例：订单三件，实收两件';
    const scriptAlt = '合成示例：包裹外观与包裹信息';
    const knowledgeAlt = '合成示例：订单分为已送达和在途两个包裹';
    await expect(query.getByRole('img', { name: taskAlt })).toBeVisible();
    await expect(query.getByRole('img', { name: scriptAlt })).toHaveCount(0);
    await query.getByRole('button', { name: '索取数量与包裹信息', exact: true }).click();
    await query.getByText('少件与分包发货', { exact: true }).click();
    for (const alt of [taskAlt, scriptAlt, knowledgeAlt]) {
      const image = query.getByRole('img', { name: alt });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      const accessibleFigure = await query.locator('figure').filter({ has: image }).ariaSnapshot();
      expect(accessibleFigure.split(alt)).toHaveLength(2);
    }
    expect(await query.evaluate(async () => { const snapshot = await window.customerAgent!.sopWindow!.current!(); return snapshot.kind === 'ready' ? snapshot.projection : null; })).toEqual(before);
    const querySources = await Promise.all([taskAlt, scriptAlt, knowledgeAlt].map(alt => query.getByRole('img', { name: alt }).getAttribute('src')));

    await query.evaluate(async () => {
      const api = window.customerAgent!.sopWindow!;
      const snapshot = await api.current!();
      if (snapshot.kind !== 'ready' || !snapshot.projection) throw new Error('Missing active SOP');
      const { taskId } = snapshot.projection, hostEpoch = snapshot.access.kind === 'executable' ? snapshot.access.hostEpoch : 0;
      await api.windowIntent!({ type: 'resize-start', taskId, hostEpoch, gesture: 1, edge: 'se' });
      await api.windowIntent!({ type: 'resize', taskId, hostEpoch, gesture: 1, dx: -10000, dy: -10000 });
      await api.windowIntent!({ type: 'resize-end', taskId, hostEpoch, gesture: 1 });
    });
    await expect.poll(() => query.evaluate(() => [innerWidth, innerHeight])).toEqual([300, 320]);
    await expect.poll(() => query.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.query-sop-body')!;
      const footer = document.querySelector<HTMLElement>('.query-sop-footer')!;
      return { scrollable: body.scrollHeight > body.clientHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        footerVisible: footer.getBoundingClientRect().bottom <= innerHeight };
    })).toMatchObject({ scrollable: true, horizontalOverflow: false, footerVisible: true });
    await query.getByRole('button', { name: '返回搜索' }).click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toHaveCount(0);
    await expect(query.getByRole('img', { name: taskAlt })).toHaveCount(0);
    expect(await query.evaluate(() => window.customerAgent!.sopWindow!.current!())).toMatchObject({ view: { kind: 'query-home' }, projection: null, tasks: [{ taskId: before?.taskId, stepIndex: before?.stepIndex }] });
    await query.getByRole('button', { name: /少件处理.*#1.*步骤 1/ }).click();
    await expect(query.getByRole('img', { name: taskAlt })).toBeVisible();

    await query.evaluate(() => window.customerAgent!.openDashboard());
    await expect.poll(() => running.windows().some(page => page.url().includes('role=dashboard'))).toBe(true);
    const dashboard = running.windows().find(page => page.url().includes('role=dashboard'))!;
    await dashboard.getByTestId('nav-sop').click();
    await dashboard.getByRole('combobox', { name: '选择流程' }).click();
    await dashboard.getByTitle('少件处理', { exact: true }).click();
    await expect(dashboard.getByRole('img', { name: taskAlt })).toBeVisible();
    await expect(dashboard.getByRole('img', { name: knowledgeAlt })).toBeVisible();
    await expect(dashboard.getByRole('img', { name: scriptAlt })).toHaveCount(0);
    await dashboard.getByText('索取数量与包裹信息', { exact: true }).click();
    for (const [index, alt] of [taskAlt, scriptAlt, knowledgeAlt].entries()) {
      const image = dashboard.getByRole('img', { name: alt });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      expect(await image.getAttribute('src')).toBe(querySources[index]);
    }
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(async task => { const api = window.customerAgent!.sopWindow!, state = await api.current!(); if (state.kind === 'ready' && task) await api.navigate!({ type: 'restore', taskId: task.taskId, revision: task.revision, viewEpoch: state.viewEpoch }); }, before);
    expect(await query.evaluate(async () => { const snapshot = await window.customerAgent!.sopWindow!.current!(); return snapshot.kind === 'ready' ? snapshot.projection : null; })).toEqual(before);
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('image decoding failures and a rejected manual image read preserve the active SOP', async () => {
  const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? test.info().outputPath('sop');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-images-recovery-e2e-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    const query = app.windows().find(page => page.url().includes('role=query'));
    if (!fox || !query) throw new Error('SOP windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByTestId('question-input').fill('少件了，没收到全部');
    await query.getByTestId('question-input').press('Enter');
    await query.getByRole('button', { name: '进入少件处理', exact: true }).click();
    await query.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' })).toBeChecked();
    const before = await query.evaluate(() => window.customerAgent?.sopWindow?.current?.());
    if (before?.kind !== 'ready') throw new Error('SOP snapshot missing');
    expect(before.projection?.canNext).toBe(true);
    const unchangedBusiness = { kind: before.kind, projection: before.projection, tasks: before.tasks,
      view: before.view };
    const copy = query.getByRole('button', { name: '复制索取数量与包裹信息', exact: true });
    await expect(copy).toBeEnabled();
    const taskAlt = '合成示例：订单三件，实收两件';
    await query.getByRole('img', { name: taskAlt }).evaluate((element: HTMLImageElement) => {
      element.src = 'data:image/png;base64,broken';
    });
    await expect(query.getByRole('status')).toHaveText('图片无法显示');
    await expect(query.getByText(taskAlt, { exact: true })).toBeVisible();
    expect(await query.locator('figure').filter({ has: query.getByRole('status') }).ariaSnapshot()).toContain(taskAlt);
    await expect(query.getByRole('button', { name: '重新读取图片' })).toHaveCount(0);
    await expect(query.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
    await expect(copy).toBeEnabled();
    expect(await query.evaluate(() => window.customerAgent?.sopWindow?.current?.())).toMatchObject(unchangedBusiness);
    fs.mkdirSync(evidenceDir, { recursive: true });
    await query.screenshot({ animations: 'disabled', path: path.join(evidenceDir, 'sop-image-decode-failure.png') });

    await query.evaluate(() => window.customerAgent?.openDashboard());
    await expect.poll(() => app.windows().some(page => page.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(page => page.url().includes('role=dashboard'));
    if (!dashboard) throw new Error('Dashboard missing');
    const images = await dashboard.evaluate(() => window.dashboardWorkbench?.sopImages?.());
    expect(Array.isArray(images)).toBe(true);
    // Fault injection is confined to this isolated app; recovery uses its original Main projection.
    await app.evaluate(({ ipcMain }, projections) => {
      let firstRead = true;
      ipcMain.removeHandler('dashboard:sop-manual-images');
      ipcMain.handle('dashboard:sop-manual-images', async () => {
        if (firstRead) { firstRead = false; throw new Error('Injected image read failure'); }
        await new Promise(resolve => setTimeout(resolve, 800));
        return projections;
      });
    }, images);
    await dashboard.getByTestId('nav-sop').click();
    await expect(dashboard.getByRole('status')).toHaveText('图片读取失败');
    await dashboard.getByRole('combobox', { name: '选择流程' }).click();
    await dashboard.getByTitle('少件处理', { exact: true }).click();
    await dashboard.getByRole('textbox', { name: '查找步骤和知识' }).fill('核对');
    await dashboard.getByText('索取数量与包裹信息', { exact: true }).click();
    await dashboard.screenshot({ animations: 'disabled', path: path.join(evidenceDir, 'sop-image-read-failure.png') });
    const retry = dashboard.getByRole('button', { name: '重新读取图片' });
    await retry.focus();
    await retry.press('Enter');
    await expect(retry).toBeDisabled();
    await expect(dashboard.getByRole('img', { name: taskAlt })).toBeVisible();
    await expect.poll(() => dashboard.getByRole('img', { name: taskAlt }).evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await expect(dashboard.getByRole('img', { name: '合成示例：包裹外观与包裹信息' })).toBeVisible();
    await expect(dashboard.getByRole('textbox', { name: '查找步骤和知识' })).toHaveValue('核对');
    await expect(dashboard.getByRole('article', { name: '核对订单与实收数量' })).toBeVisible();
    await expect(dashboard.getByText('图片读取失败', { exact: true })).toHaveCount(0);
    await expect(dashboard.getByText(/Injected image read failure/)).toHaveCount(0);
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(async () => { const api = window.customerAgent!.sopWindow!, state = await api.current!(); const task = state.kind === 'ready' ? state.tasks[0] : null; if (state.kind === 'ready' && task) await api.navigate!({ type: 'restore', taskId: task.taskId, revision: task.revision, viewEpoch: state.viewEpoch }); });
    expect(await query.evaluate(() => window.customerAgent?.sopWindow?.current?.())).toMatchObject(unchangedBusiness);
    await dashboard.screenshot({ animations: 'disabled', path: path.join(evidenceDir, 'sop-image-read-recovered.png') });
    await dashboard.keyboard.press('Tab');
    await expect(dashboard.getByRole('button', { name: '索取数量与包裹信息', exact: true })).toBeFocused();
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
