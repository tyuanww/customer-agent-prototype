import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function luminance(color: string): number {
  const rgb = color.match(/[\d.]+/g)?.map(Number);
  if (!rgb || rgb.length !== 3) throw new Error(`Expected opaque RGB color, received ${color}`);
  const [red = 0, green = 0, blue = 0] = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

test('single-customer SOP stays in Query, preserves progress, and requires explicit navigation', async () => {
  const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? test.info().outputPath('sop');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'query-sop-e2e-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData });
  const original = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const fox = app.windows().find(page => page.url().includes('role=fox'))!;
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await expect(query.getByTestId('question-input')).toBeEditable();
    await query.getByTestId('question-input').fill('露芷面膜孕期能用吗');
    await query.getByTestId('question-input').press('Enter');
    await expect(query.getByTestId('script-card-1')).toContainText('孕期咨询');
    await expect(query.getByTestId('script-card-2')).toHaveCount(0);
    await expect(query.getByTestId('sop-query-entry')).toHaveCount(0);
    await query.getByTestId('question-input').fill('用了露芷面膜过敏了怎么办');
    await query.getByTestId('question-input').press('Enter');
    const copyButton = query.getByTestId('copy-button-1');
    const sopEntry = query.getByTestId('sop-card-open-1-allergy-aftersale-demo');
    await expect(copyButton).toHaveClass(/ant-btn-primary/);
    await expect(sopEntry).toHaveClass(/ant-btn-default/);
    await expect(query.getByRole('group', { name: '本次查询相关流程' })).toBeVisible();
    await expect(query.getByTestId('sop-card-entry-2')).toHaveCount(0);
    await expect(query.getByTestId('copy-button-2')).toHaveCount(0);
    fs.mkdirSync(evidenceDir, { recursive: true });
    for (const colorScheme of ['dark', 'light'] as const) {
      await query.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect.poll(() => sopEntry.evaluate(element => getComputedStyle(element).color))
        .toBe(colorScheme === 'dark' ? 'rgb(245, 245, 247)' : 'rgb(32, 36, 45)');
      const font = await query.evaluate(() => getComputedStyle(document.body).fontFamily);
      await expect.poll(() => copyButton.evaluate(element => getComputedStyle(element).fontFamily)).toBe(font);
      await query.mouse.move(1, 1);
      const restingBackground = await copyButton.evaluate(element => getComputedStyle(element).backgroundColor);
      for (const state of ['rest', 'hover']) {
        if (state === 'hover') {
          await copyButton.hover();
          await expect.poll(() => copyButton.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(restingBackground);
        }
        const colors = await copyButton.evaluate(element => {
          const style = getComputedStyle(element);
          return { foreground: style.color, background: style.backgroundColor };
        });
        const foreground = luminance(colors.foreground);
        const background = luminance(colors.background);
        expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), `${colorScheme} ${state} copy contrast`).toBeGreaterThanOrEqual(4.5);
      }
      await sopEntry.hover();
      await expect(sopEntry).toHaveCSS('color', colorScheme === 'dark' ? 'rgb(245, 245, 247)' : 'rgb(32, 36, 45)');
      await query.mouse.down();
      await expect(sopEntry).toHaveCSS('color', colorScheme === 'dark' ? 'rgb(245, 245, 247)' : 'rgb(32, 36, 45)');
      await query.mouse.move(1, 1);
      await query.mouse.up();
      await query.screenshot({ path: path.join(evidenceDir, `query-copy-${colorScheme}.png`) });
    }
    await copyButton.focus();
    await query.keyboard.press('Tab');
    await expect(sopEntry).toBeFocused();
    await query.screenshot({ path: path.join(evidenceDir, 'query-copy-actions.png') });
    await sopEntry.press('Enter');
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    expect(app.windows().some(page => page.url().includes('role=sop'))).toBe(false);
    await expect(query.getByTestId('question-input')).not.toBeVisible();
    await expect(query.getByText('合成流程验证')).toHaveCount(0);
    await expect(query.getByText('步骤 1', { exact: true })).toBeVisible();
    fs.mkdirSync(evidenceDir, { recursive: true });
    await query.screenshot({ path: path.join(evidenceDir, 'sop-query.png') });
    await query.evaluate(async () => {
      const api = window.customerAgent!.sopWindow!;
      const snapshot = await api.current!();
      if (snapshot.kind !== 'ready' || !snapshot.projection) throw new Error('Missing active SOP');
      const { taskId } = snapshot.projection, hostEpoch = snapshot.access.kind === 'executable' ? snapshot.access.hostEpoch : 0;
      await api.windowIntent!({ type: 'resize-start', taskId, hostEpoch, gesture: 1000, edge: 'se' });
      await api.windowIntent!({ type: 'resize', taskId, hostEpoch, gesture: 1000, dx: -10000, dy: -10000 });
      await api.windowIntent!({ type: 'resize-end', taskId, hostEpoch, gesture: 1000 });
    });
    await expect.poll(() => query.evaluate(() => [innerWidth, innerHeight])).toEqual([300, 320]);
    await expect.poll(() => query.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.query-sop-body')!;
      const footer = document.querySelector<HTMLElement>('.query-sop-footer')!;
      const header = document.querySelector<HTMLElement>('.query-sop-header')!;
      body.scrollTop = body.scrollHeight;
      return { footerVisible: footer.getBoundingClientRect().bottom <= innerHeight, headerTop: header.getBoundingClientRect().top,
        scrollable: body.scrollHeight > body.clientHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    })).toMatchObject({ headerTop: 0, scrollable: true, horizontalOverflow: false, footerVisible: true });
    await query.screenshot({ path: path.join(evidenceDir, 'sop-query-small.png') });
    await query.evaluate(async () => {
      const api = window.customerAgent!.sopWindow!;
      const snapshot = await api.current!();
      if (snapshot.kind !== 'ready' || !snapshot.projection) throw new Error('Missing active SOP');
      const { taskId } = snapshot.projection, hostEpoch = snapshot.access.kind === 'executable' ? snapshot.access.hostEpoch : 0;
      await api.windowIntent!({ type: 'resize-start', taskId, hostEpoch, gesture: 1001, edge: 'se' });
      await api.windowIntent!({ type: 'resize', taskId, hostEpoch, gesture: 1001, dx: 180, dy: 300 });
      await api.windowIntent!({ type: 'resize-end', taskId, hostEpoch, gesture: 1001 });
    });
    await expect.poll(() => query.evaluate(() => innerWidth)).toBeLessThanOrEqual(600);

    await query.getByRole('button', { name: '复制话术' }).click();
    await expect(query.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    await expect(query.getByText('步骤 1', { exact: true })).toBeVisible();
    // Native blur event exercises the controller policy, not real OS focus acceptance.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.emit('blur'));
    await query.waitForTimeout(1400);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.isVisible())).toBe(true);
    await expect(query.getByRole('textbox', { name: '客户当前情况' })).toHaveCount(0);
    await expect(query.getByText(/推荐 · 匹配/)).toHaveCount(0);
    await expect(query.getByText('步骤 1', { exact: true })).toBeVisible();
    const wording = query.getByRole('button', { name: '索取凭证', exact: true });
    const inlineCopy = query.getByRole('button', { name: '复制索取凭证', exact: true });
    await wording.click();
    await expect(wording).toHaveAttribute('aria-expanded', 'true');
    await expect(inlineCopy).toHaveText('复制');
    await query.getByRole('button', { name: '更多操作' }).click();
    await query.getByRole('menuitem', { name: '重新开始', exact: true }).click();
    await query.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(query.getByRole('dialog')).not.toBeVisible();
    await expect(query.getByRole('textbox', { name: '客户当前情况' })).toHaveCount(0);
    await expect(wording).toHaveAttribute('aria-expanded', 'true');
    await expect(inlineCopy).toHaveText('复制');
    await query.getByRole('button', { name: '更多操作' }).click();
    await query.getByRole('menuitem', { name: '重新开始', exact: true }).click();
    await query.getByRole('dialog').getByRole('button', { name: '重新开始', exact: true }).click();
    await expect(query.getByRole('dialog')).not.toBeVisible();
    await expect(query.getByRole('textbox', { name: '客户当前情况' })).toHaveCount(0);
    await expect(query.getByText(/推荐 · 匹配/)).toHaveCount(0);
    await expect(wording).toHaveAttribute('aria-expanded', 'false');
    await expect(inlineCopy).toHaveText('复制');
    expect(await query.evaluate(() => window.customerAgent!.sopWindow!.current!())).toMatchObject({ projection: { stepIndex: 1, copied: false } });
    await query.getByRole('button', { name: /^已给照片/ }).click();
    await expect(query.getByText('步骤 2', { exact: true })).toBeVisible();
    await expect(query.getByRole('textbox', { name: '客户当前情况' })).toHaveCount(0);
    await query.getByRole('region', { name: 'SOP 流程' }).focus();
    await query.keyboard.press('F8');
    await expect(query.getByText('步骤 2', { exact: true })).toBeVisible();
    await query.getByRole('button', { name: '返回搜索', exact: true }).click();
    await expect(query.getByTestId('copy-button-1')).toHaveCount(0);
    await query.getByTestId('search-button').click();
    await query.getByTestId('copy-button-1').click();
    await query.waitForTimeout(1400);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('copy-button-1')).toBeEnabled();
    await query.getByRole('button', { name: /过敏流程.*#1.*步骤 2/ }).click();
    await query.getByRole('button', { name: /^信息不足/ }).click();
    await expect(query.getByText('补充不适信息', { exact: true })).toBeVisible();
    await expect(query.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await query.getByRole('button', { name: '更多操作' }).click();
    await expect(query.getByRole('menuitem', { name: '等待客户' })).toBeInViewport();
    await query.getByRole('menuitem', { name: '等待客户' }).click();
    await expect(query.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await expect(query.getByRole('button', { name: '复制请求补充情况' })).toBeDisabled();
    await query.getByRole('button', { name: '继续处理', exact: true }).click();
    await query.getByRole('checkbox', { name: '已补充必要信息' }).click();
    await query.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(query.getByText('再次核实不适情况', { exact: true })).toBeVisible();
    await expect(query.getByRole('textbox', { name: '客户当前情况' })).toHaveCount(0);
    await query.getByRole('button', { name: /^客户描述明显不适/ }).click();
    await expect(query.getByText('记录明显不适', { exact: true })).toBeVisible();
    await expect(query.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
    await query.getByRole('region', { name: 'SOP 流程' }).focus();
    await query.keyboard.press('F8');
    await expect(query.getByText('确认后续跟进', { exact: true })).toBeVisible();
    await query.getByRole('checkbox', { name: '已确认后续跟进安排' }).click();
    await query.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(query.getByRole('button', { name: '结束流程', exact: true })).toBeVisible();
    await expect(query.getByRole('button', { name: '独立悬浮', exact: true })).toBeVisible();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.isAlwaysOnTop())).toBe(true);
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.getBounds());
    const resized = await query.evaluate(async () => {
      const api = window.customerAgent!.sopWindow!;
      const current = await api.current!();
      if (current.kind !== 'ready' || !current.projection) throw new Error('Missing active SOP');
      await api.windowIntent!({ type: 'resize-start', taskId: current.projection.taskId, hostEpoch: current.access.kind === 'executable' ? current.access.hostEpoch : 0, gesture: 2000, edge: 'se' });
      await api.windowIntent!({ type: 'resize', taskId: current.projection.taskId, hostEpoch: current.access.kind === 'executable' ? current.access.hostEpoch : 0, gesture: 2000, dx: -100, dy: -100 });
      return api.windowIntent!({ type: 'resize-end', taskId: current.projection.taskId, hostEpoch: current.access.kind === 'executable' ? current.access.hostEpoch : 0, gesture: 2000 });
    });
    expect(resized).toBe(true);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.getBounds());
    expect(after.width).toBe(before.width - 100);
    expect(after.height).toBe(before.height - 100);
    await query.getByRole('button', { name: '收起', exact: true }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: /^过敏流程 #1/ }).click();
    const floating = app.windows().find(page => page.url().includes('role=sop-floating'));
    if (!floating) throw new Error('Collapsed SOP floating window missing');
    await expect(floating.getByText('步骤 7', { exact: true })).toBeVisible();
    await floating.locator('.query-sop-header').getByRole('button', { name: '结束流程', exact: true }).click();
    await floating.getByRole('dialog').getByRole('button', { name: '结束流程', exact: true }).click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toHaveCount(0);
    expect(await query.evaluate(() => window.customerAgent!.sopWindow!.current!())).toMatchObject({ view: { kind: 'query-home' }, projection: null, tasks: [] });
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), original);
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('missing-item manual and execution share tasks without sharing progress', async () => {
  const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? test.info().outputPath('sop');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-sop-e2e-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData });
  const original = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const fox = app.windows().find(page => page.url().includes('role=fox'))!;
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByTestId('question-input').fill('少件了，没收到全部');
    await query.getByTestId('question-input').press('Enter');
    await query.screenshot({ path: path.join(evidenceDir, 'sop-ordinary-search.png') });
    await query.getByRole('button', { name: '进入少件处理', exact: true }).click();
    await expect(query.getByText('核对订单与实收数量', { exact: true })).toBeVisible();
    await expect(query.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await query.screenshot({ path: path.join(evidenceDir, 'sop-missing-collapsed.png') });
    await expect(query.getByText('方便告诉我这笔订单应收到和实际收到的数量，并提供包裹信息吗？我先帮您核对。', { exact: true })).not.toBeVisible();
    await app.evaluate(({ clipboard }) => clipboard.writeText('unchanged'));
    await query.keyboard.press('F6');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('unchanged');
    await query.getByRole('button', { name: '复制索取数量与包裹信息', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('方便告诉我这笔订单应收到和实际收到的数量，并提供包裹信息吗？我先帮您核对。');
    await expect(query.getByText('步骤 1', { exact: true })).toBeVisible();
    await query.getByRole('button', { name: '索取数量与包裹信息', exact: true }).click();
    await query.screenshot({ path: path.join(evidenceDir, 'sop-missing-expanded.png') });
    await query.getByRole('button', { name: '确认收到材料', exact: true }).click();
    await query.screenshot({ path: path.join(evidenceDir, 'sop-missing-all-expanded.png') });
    await query.getByRole('button', { name: '更多操作' }).click();
    await query.getByRole('menuitem', { name: '等待客户' }).click();
    await expect(query.getByRole('button', { name: '复制索取数量与包裹信息' })).toBeDisabled();
    await query.getByRole('button', { name: '继续处理', exact: true }).click();
    await query.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await expect(query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' })).toBeEnabled();
    await query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' })).toBeChecked();
    await expect(query.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
    await query.getByRole('button', { name: '下一步', exact: true }).click();
    await query.getByRole('button', { name: /^信息不足/ }).click();
    await expect(query.getByText('补充核实信息', { exact: true })).toBeVisible();
    await query.screenshot({ path: path.join(evidenceDir, 'sop-missing-insufficient.png') });
    const beforeManual = await query.evaluate(() => window.customerAgent!.sopWindow!.current!());
    await query.evaluate(() => window.customerAgent!.openDashboard());
    await expect.poll(() => app.windows().some(page => page.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(page => page.url().includes('role=dashboard'))!;
    await dashboard.getByTestId('nav-sop').click();
    await expect(dashboard.getByRole('region', { name: 'SOP 手册' })).toBeVisible();
    await dashboard.getByRole('combobox', { name: '选择流程' }).click();
    await dashboard.getByTitle('少件处理', { exact: true }).click();
    await expect(dashboard.getByRole('article', { name: '核对订单与实收数量' })).toBeVisible();
    await dashboard.getByRole('button', { name: '查看后续任务', exact: true }).click();
    await expect(dashboard.getByRole('article', { name: '确认数量差异原因' })).toBeVisible();
    await expect(dashboard.getByRole('combobox', { name: '选择流程' })).toHaveAttribute('aria-expanded', 'false');
    await dashboard.screenshot({ path: path.join(evidenceDir, 'sop-manual.png') });
    expect(await query.evaluate(() => window.customerAgent!.sopWindow!.current!())).toMatchObject({ kind: 'ready', tasks: beforeManual.kind === 'ready' ? beforeManual.tasks : [] });
    await dashboard.close();
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    expect(await query.evaluate(async () => { const state = await window.customerAgent!.sopWindow!.current!(); return state.kind === 'ready' ? state.projection : null; })).toEqual(beforeManual.kind === 'ready' ? beforeManual.projection : null);
    await query.getByRole('button', { name: '已走步骤' }).click();
    await query.getByRole('button', { name: '步骤 1 核对订单与实收数量', exact: true }).click();
    await query.getByRole('button', { name: '返回此步' }).first().click();
    await query.getByRole('dialog').getByRole('button', { name: '返回并清除后续进度' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).not.toBeChecked();
    await expect(query.getByRole('button', { name: '复制话术' })).toBeDisabled();
    await expect(query.getByRole('dialog')).not.toBeVisible();
    await query.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect.poll(() => query.getByRole('button', { name: '索取数量与包裹信息', exact: true }).evaluate(element => getComputedStyle(element).color)).toBe('rgb(245, 245, 247)');
    await query.screenshot({ path: path.join(evidenceDir, 'sop-missing-dark.png') });
    await query.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await expect(query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' })).toBeEnabled();
    await query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对实收数量和包裹信息' })).toBeChecked();
    await query.getByRole('button', { name: '下一步', exact: true }).click();
    await query.getByRole('button', { name: /^已核实数量不足/ }).click();
    await query.getByRole('checkbox', { name: '已提交材料并确认跟进人' }).click();
    await expect(query.getByRole('checkbox', { name: '已提交材料并确认跟进人' })).toBeChecked();
    await query.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(query.getByText('完成本次引导', { exact: true })).toBeVisible();
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), original);
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
