import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function zipLocal(name: string, payload: Buffer): Buffer {
  const nameBytes = Buffer.from(name, 'utf8'); const body = deflateRawSync(payload); const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(8, 8); header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(payload.length, 22); header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, body]);
}
const rels = (items: [string, string][]) => Buffer.from(`<Relationships>${items.map(([id, target]) => `<Relationship Id="${id}" Type="t" Target="${target}"/>`).join('')}</Relationships>`);
function syntheticWorkbook(): Buffer {
  const strings = ['快捷短语', '产品话术', '合成问题一', '第一行\n第二行', '合成问题二', '这一行带图'];
  const shared = Buffer.from(`<sst>${strings.map(s => `<si><t xml:space="preserve">${s}</t></si>`).join('')}</sst>`);
  const sheet = Buffer.from('<worksheet xmlns:r="r"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row>'
    + '</sheetData><drawing r:id="rId1"/><picture r:id="rId2"/></worksheet>');
  const drawing = Buffer.from('<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:r="r"><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>2</xdr:row></xdr:from>'
    + '<xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>');
  return Buffer.concat([
    zipLocal('xl/sharedStrings.xml', shared), zipLocal('xl/worksheets/sheet1.xml', sheet),
    zipLocal('xl/workbook.xml', Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="s" r:id="rId1"/></sheets></workbook>')),
    zipLocal('xl/_rels/workbook.xml.rels', rels([['rId1', 'worksheets/sheet1.xml']])),
    zipLocal('xl/worksheets/_rels/sheet1.xml.rels', rels([['rId1', '../drawings/drawing1.xml'], ['rId2', '../media/bg.png']])),
    zipLocal('xl/drawings/drawing1.xml', drawing), zipLocal('xl/drawings/_rels/drawing1.xml.rels', rels([['rId1', '../media/image1.png']])),
    zipLocal('xl/media/image1.png', PNG), zipLocal('xl/media/bg.png', PNG),
  ]);
}

test('dashboard handoff: date presets, collapsed filters, xlsx with picture, account logout across windows', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit synthetic PG15/Electron gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-handoff-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/dashboard-handoff', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(evidence, { recursive: true });
  const userData = path.join(directory, 'user');
  mkdirSync(userData);
  const workbookPath = path.join(directory, '【售前】合成话术.xlsx');
  writeFileSync(workbookPath, syntheticWorkbook());
  let app: ElectronApplication | undefined;
  try {
    app = await launchIntakeElectron({ desktopRoot, userDataDirectory: userData, apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.intakeQuery));
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
    await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => { const v = await window.customerAgent!.product!.sessionStatus(); return v.ok && v.signedIn; })).toBe(true);

    await query.getByRole('textbox').first().fill('洁面');
    await query.getByRole('button', { name: '查询', exact: true }).click();
    const filters = query.getByTestId('intake-query-filters');
    await expect(filters).toHaveAttribute('data-open', 'false');
    await expect(query.getByRole('combobox', { name: '当前店铺' })).toHaveCount(0);
    await query.screenshot({ path: path.join(evidence, 'query-filters-collapsed.png') });
    await filters.getByRole('button', { name: '筛选', exact: true }).click();
    await expect(query.getByRole('combobox', { name: '当前店铺' })).toBeEnabled();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true');
    const fits = await query.evaluate(() => { const b = document.querySelector('.intake-filter-body')!.getBoundingClientRect(); return b.bottom <= innerHeight; });
    expect(fits).toBe(true);
    await query.screenshot({ path: path.join(evidence, 'query-filters-open.png') });

    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;

    await dashboard.getByTestId('nav-overview').click();
    await dashboard.getByRole('textbox', { name: '时间范围' }).first().click();
    const presets = dashboard.locator('.overview-range-popup .ant-picker-presets li');
    await expect(presets).toHaveCount(2);
    const tops = await presets.evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)));
    expect(tops[0]).toBe(tops[1]);
    await dashboard.screenshot({ path: path.join(evidence, 'date-presets.png') });
    for (const [label, days] of [['近 7 天', 7], ['近 30 天', 30]] as const) {
      await dashboard.locator('.overview-range-popup .ant-picker-presets li', { hasText: label }).click();
      await expect.poll(async () => {
        const values = await dashboard.getByRole('textbox', { name: '时间范围' }).evaluateAll(inputs => inputs.map(i => (i as HTMLInputElement).value));
        return (Date.parse(values.at(-1)!) - Date.parse(values[0]!)) / 86_400_000 + 1;
      }, { message: label }).toBe(days);
      await dashboard.getByRole('textbox', { name: '时间范围' }).first().click();
    }
    await dashboard.keyboard.press('Escape');

    await dashboard.getByTestId('nav-content').click();
    await dashboard.getByRole('button', { name: '添加话术' }).click();
    await dashboard.locator('input[type=file]').setInputFiles(workbookPath);
    await expect(dashboard.getByText('包含 1 张图片，将随对应话术保存。')).toBeVisible();
    await expect(dashboard.getByRole('list', { name: '未导入的内容' })).toContainText('工作表背景图不属于任何话术，未导入。');
    await dashboard.screenshot({ path: path.join(evidence, 'xlsx-preview.png') });
    await dashboard.getByRole('button', { name: '导入 2 条' }).click();
    await expect(dashboard.getByText('将导入 2 条到本机知识库，状态为未生效，不会覆盖已有话术，也不会发布到查询。')).toBeVisible();
    await dashboard.getByRole('button', { name: '确认导入 2 条' }).click();
    await expect(dashboard.getByText('已导入 2 条，状态是未生效。')).toBeVisible();
    await dashboard.getByRole('tab', { name: '售前客服' }).click();
    await expect(dashboard.getByRole('img', { name: '合成问题二的图片 1' })).toBeVisible();
    await expect(dashboard.getByRole('img', { name: /合成问题一的图片/ })).toHaveCount(0);
    await dashboard.screenshot({ path: path.join(evidence, 'xlsx-imported.png') });

    const before = (await host.status()).requests.filter(p => p === '/v1/auth/logout').length;
    const account = dashboard.getByRole('button', { name: '账号信息' });
    await expect(account).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidence, 'account.png') });
    await account.click();
    await dashboard.getByRole('menuitem', { name: /退出登录/ }).click();
    await expect(dashboard.getByText('未登录')).toBeVisible();
    await expect.poll(async () => (await host.status()).requests.filter(p => p === '/v1/auth/logout').length).toBe(before + 1);
    await expect.poll(() => query.evaluate(async () => { const v = await window.customerAgent!.product!.sessionStatus(); return v.ok && v.signedIn; })).toBe(false);
    const hasToken = await dashboard.evaluate(() => JSON.stringify(Object.keys(window.dashboardContent ?? {})));
    expect(hasToken).not.toMatch(/token|invoke|send/i);
    await dashboard.screenshot({ path: path.join(evidence, 'signed-out.png') });
    console.info(JSON.stringify({ status: 'PASS', screenshots: evidence }));
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
