import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function expectReadableWording(query: Page): Promise<void> {
  const metrics = await query.getByTestId('script-card-1').evaluate(card => {
    const row = card.querySelector('.card-answer-row');
    const answer = card.querySelector('.answer-text');
    const actions = card.querySelector('.card-actions');
    const copy = card.querySelector('[data-testid="copy-button-1"]');
    const entry = card.querySelector('[data-testid^="sop-card-open-1-"]');
    const report = card.querySelector('[data-testid="report-inaccuracy-button-1"]');
    if (!(row instanceof HTMLElement) || !(answer instanceof HTMLElement) || !(actions instanceof HTMLElement) || !copy || !entry || !report) return null;
    return {
      rowWidth: row.getBoundingClientRect().width,
      answerWidth: answer.getBoundingClientRect().width,
      answerBottom: answer.getBoundingClientRect().bottom,
      actionsTop: actions.getBoundingClientRect().top,
      actionOverflow: actions.scrollWidth > actions.clientWidth,
      ordered: Boolean(copy.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(entry.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  if (!metrics) throw new Error('Missing synthetic wording and actions');
  expect(metrics.answerWidth).toBeGreaterThanOrEqual(metrics.rowWidth - 1);
  expect(metrics.actionsTop).toBeGreaterThanOrEqual(metrics.answerBottom - 1);
  expect(metrics.actionOverflow).toBe(false);
  expect(metrics.ordered).toBe(true);
  const cardsFit = await query.locator('.script-card').evaluateAll(cards => cards.every(card => {
    const row = card.querySelector('.card-answer-row');
    const answer = card.querySelector('.answer-text');
    const actions = card.querySelector('.card-actions');
    if (!row || !answer || !actions) return false;
    return answer.getBoundingClientRect().width >= row.getBoundingClientRect().width - 1
      && actions.getBoundingClientRect().top >= answer.getBoundingClientRect().bottom - 1;
  }));
  expect(cardsFit).toBe(true);
}

async function expectLongWordingFits(query: Page): Promise<void> {
  const fits = await query.getByTestId('script-card-1').evaluate(card => {
    const clone = card.cloneNode(true);
    if (!(clone instanceof HTMLElement) || !card.parentElement) return false;
    clone.style.position = 'fixed';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.width = `${card.getBoundingClientRect().width}px`;
    clone.style.visibility = 'hidden';
    clone.setAttribute('aria-hidden', 'true');
    card.parentElement.append(clone);
    try {
      const row = clone.querySelector('.card-answer-row');
      const answer = clone.querySelector('.answer-text');
      const actions = clone.querySelector('.card-actions');
      const title = clone.querySelector('.scene-label');
      const entry = clone.querySelector('.sop-card-entry');
      const button = entry?.querySelector('button');
      if (!(row instanceof HTMLElement) || !(answer instanceof HTMLElement) || !(actions instanceof HTMLElement)
        || !(title instanceof HTMLElement) || !(entry instanceof HTMLElement) || !(button instanceof HTMLElement)) return false;
      title.textContent = `合成超长话术标题${'场景名称'.repeat(30)}`;
      answer.textContent = `合成超长话术\nhttps://example.invalid/${'x'.repeat(180)}`;
      button.textContent = `进入${'合成超长流程名称'.repeat(12)}`;
      const error = document.createElement('span');
      error.className = 'ant-typography';
      error.textContent = `合成错误说明${'需要重新核对'.repeat(18)}`;
      entry.append(error);
      const bounds = row.getBoundingClientRect();
      const cardBounds = clone.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      const titleFits = titleBounds.left >= cardBounds.left && titleBounds.right <= cardBounds.right
        && title.scrollWidth <= title.clientWidth + 1 && titleBounds.bottom <= answer.getBoundingClientRect().top;
      return titleFits && [answer, actions, entry, button, error].every(item => {
        const rect = item.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && item.scrollWidth <= item.clientWidth + 1;
      });
    } finally {
      clone.remove();
    }
  });
  expect(fits).toBe(true);
}

test('an invalid SOP update returns to search with a visible recovery message', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-projection-error-e2e-'));
  let app: ElectronApplication | undefined;
  try {
    app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData });
    const running = app;
    await expect.poll(() => running.windows().length).toBeGreaterThanOrEqual(2);
    const fox = running.windows().find(page => page.url().includes('role=fox'));
    const query = running.windows().find(page => page.url().includes('role=query'));
    if (!fox || !query) throw new Error('Missing isolated synthetic windows');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await expect(query.getByTestId('question-input')).toBeEditable();
    await query.getByTestId('question-input').fill('过敏了怎么办');
    await query.getByTestId('question-input').press('Enter');
    const entry = query.getByTestId('sop-card-open-1-allergy-aftersale-demo');
    await expect(entry).toBeVisible();
    await expect.poll(() => query.evaluate(() => innerWidth)).toBe(600);
    for (const colorScheme of ['light', 'dark'] as const) {
      await query.emulateMedia({ colorScheme });
      await expectReadableWording(query);
    }
    await query.getByTestId('copy-button-1').focus();
    await query.keyboard.press('Tab');
    await expect(entry).toBeFocused();
    await query.keyboard.press('Tab');
    await expect(query.getByTestId('report-inaccuracy-button-1')).toBeFocused();
    await entry.click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    await query.evaluate(async () => {
      const api = window.customerAgent?.sopWindow;
      const current = await api?.current?.();
      if (!api?.windowIntent || current?.kind !== 'ready' || !current.projection) throw new Error('Missing active synthetic SOP');
      await api.windowIntent({ type: 'resize-start', taskId: current.projection.taskId, hostEpoch: current.access.kind === 'executable' ? current.access.hostEpoch : 0, gesture: 1001, edge: 'se' });
      await api.windowIntent({ type: 'resize', taskId: current.projection.taskId, hostEpoch: current.access.kind === 'executable' ? current.access.hostEpoch : 0, gesture: 1001, dx: -10000, dy: 0 });
      await api.windowIntent({ type: 'resize-end', taskId: current.projection.taskId, hostEpoch: current.access.kind === 'executable' ? current.access.hostEpoch : 0, gesture: 1001 });
    });
    await expect.poll(() => query.evaluate(() => innerWidth)).toBe(300);
    await running.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('role=query'));
      if (!target) throw new Error('Missing Query window');
      target.webContents.send('sop-window:projection', { malformed: true });
    });
    const error = query.getByRole('alert').filter({ hasText: '无法读取流程进度' });
    await expect(error).toBeVisible();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toHaveCount(0);
    await expect(query.getByTestId('question-input')).toHaveValue('过敏了怎么办');
    await expect(query.getByTestId('copy-button-1')).toBeEnabled();
    await query.evaluate(() => { window.dispatchEvent(new Event('focus')); });
    await query.waitForTimeout(150);
    await expect(query.getByTestId('sop-query-open-allergy-aftersale-demo')).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await query.emulateMedia({ colorScheme });
      await expect(error).toBeVisible();
      await expectReadableWording(query);
      expect(await error.evaluate(element => {
        const pane = element.closest('.glass-shell')?.getBoundingClientRect();
          const button = element.querySelector('button');
        if (!pane || !button) return false;
        return [element, button].every(item => {
          const box = item.getBoundingClientRect();
          return box.top >= pane.top && box.bottom <= pane.bottom && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
        });
      })).toBe(true);
    }
    await expectLongWordingFits(query);
    await query.getByTestId('question-input').fill('少件了，没收到全部');
    await expect(error).toBeVisible();
    await query.getByTestId('question-input').press('Enter');
    await error.getByRole('button', { name: '重新读取', exact: true }).click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    await expect(error).toHaveCount(0);
    await query.getByRole('button', { name: '更多操作' }).click();
    await query.getByRole('menuitem', { name: '结束流程' }).click();
    await query.getByRole('dialog').getByRole('button', { name: '结束流程', exact: true }).click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toHaveCount(0);
    await expect(error).toHaveCount(0);
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
