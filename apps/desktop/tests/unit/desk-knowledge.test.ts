import { expect, it } from 'vitest';
import { DeskKnowledgeStore, statusLabel } from '../../src/shared/desk-knowledge';

function store(saved: { raw: string | null } = { raw: null }) {
  const clock = { now: () => '2026-10-13T00:00:00.000Z', load: () => saved.raw, save: (raw: string) => { saved.raw = raw; } };
  return { saved, desk: new DeskKnowledgeStore(clock) };
}

it('publishes an effective row to the seat and keeps a future window pending', () => {
  const { desk } = store();
  desk.command('operator', { action: 'select-persona', personaId: 'presale' }, '经理');
  const uploaded = desk.command('operator', {
    action: 'upload', personaId: 'presale', name: '退货时效', category: 'aftersale', fileName: '售后.csv', text: '问,答', validity: 'always',
  }, '经理');
  expect(uploaded.ok).toBe(true);
  if (!uploaded.ok) return;
  expect(uploaded.view.delivered.map((item) => item.name)).toEqual(['退货时效']);
  const scheduled = desk.command('operator', {
    action: 'upload', personaId: 'shop', name: '活动价', category: 'product', fileName: '商品.csv', text: '价格', validity: 'scheduled',
    validFrom: '2026-10-20T00:00:00.000Z', validUntil: '2026-10-21T00:00:00.000Z',
  }, '经理');
  expect(scheduled.ok).toBe(true);
  if (!scheduled.ok) return;
  desk.command('operator', { action: 'select-persona', personaId: 'presale' }, '经理');
  const seat = desk.reply('seat', '坐席');
  if (!seat.ok) throw new Error(seat.message);
  expect(seat.view.delivered.map((item) => item.name)).toEqual(['退货时效']);
  expect(seat.view.items.map((item) => item.name)).toEqual(['退货时效']);
  const shop = desk.command('operator', { action: 'select-persona', personaId: 'shop' }, '经理');
  expect(shop.ok).toBe(true);
  if (!shop.ok) return;
  expect(shop.view.items.map((item) => item.statusLabel)).toEqual(['待生效']);
  expect(shop.view.delivered).toEqual([]);
  const seatShop = desk.reply('seat', '坐席');
  if (!seatShop.ok) throw new Error(seatShop.message);
  expect(seatShop.view.items).toEqual([]);
  expect(statusLabel(shop.view.items[0]!, '2026-10-20T12:00:00.000Z')).toBe('生效中');
});

it('refuses a seat write and keeps a promoted note inactive', () => {
  const { desk } = store();
  const denied = desk.command('seat', {
    action: 'upload', personaId: 'shop', name: '坐席自建', category: 'product', fileName: 'a.csv', text: '正文', validity: 'always',
  }, '坐席');
  expect(denied.ok).toBe(false);
  if (denied.ok) return;
  expect(denied.code).toBe('FORBIDDEN');
  expect(denied.message).toBe('当前账号暂无使用权限，可向主账号发起权限申请。');
  expect(denied.view?.items).toEqual([]);
  const noted = desk.command('seat', { action: 'add-tacit', personaId: 'shop', kind: 'insight', text: '客户说起过敏要先停手再确认' }, '坐席');
  expect(noted.ok).toBe(true);
  const promoted = desk.command('operator', { action: 'promote', noteId: 't1' }, '经理');
  expect(promoted.ok).toBe(true);
  if (!promoted.ok) return;
  expect(promoted.view.items.map((item) => item.statusLabel)).toEqual(['未生效']);
  expect(promoted.view.delivered).toEqual([]);
  const again = desk.command('operator', { action: 'promote', noteId: 't1' }, '经理');
  expect(again.ok).toBe(false);
});

it('imports the original csv as inactive questions on each persona', () => {
  const { desk } = store();
  const imported = desk.command('operator', {
    action: 'import-csv', personaId: 'shop', fileName: '话术.csv', category: 'product',
    csvText: '问题,标准话术,分类\n退货多久,七天内可退,售后\n怎么洁面,先湿脸,售前\n',
  }, '经理');
  expect(imported.ok).toBe(true);
  if (!imported.ok) return;
  expect(imported.view.notice).toBe('已导入 2 条，状态是未生效。');
  expect(imported.view.delivered).toEqual([]);
  const aftersale = desk.command('operator', { action: 'select-persona', personaId: 'aftersale' }, '经理');
  expect(aftersale.ok && aftersale.view.items.map((item) => item.name)).toEqual(['退货多久']);
  const presale = desk.command('operator', { action: 'select-persona', personaId: 'presale' }, '经理');
  expect(presale.ok && presale.view.items.map((item) => item.statusLabel)).toEqual(['未生效']);
  const denied = desk.command('seat', {
    action: 'import-csv', personaId: 'shop', fileName: '话术.csv', category: 'product', csvText: '问题,标准话术\n坐席自建,不行\n',
  }, '坐席');
  expect(denied.ok).toBe(false);
});

it('refuses an empty answer and leaves the library unchanged', () => {
  const saved = { raw: null as string | null };
  const first = store(saved);
  const failed = first.desk.command('operator', {
    action: 'upload', personaId: 'shop', name: '空答案', category: 'product', fileName: '问答.txt', text: '   ', validity: 'always',
  }, '经理');
  expect(failed.ok).toBe(false);
  if (failed.ok) return;
  expect(failed.message).toBe('请填写答案。');
  expect(failed.view?.items).toEqual([]);
  expect(saved.raw).toBeNull();
});
