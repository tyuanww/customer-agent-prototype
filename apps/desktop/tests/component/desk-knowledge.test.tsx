import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
  });
}
import { DeskKnowledge } from '../../src/renderer/features/dashboard/DeskKnowledge';
import { DeskKnowledgeStore, type DeskReply } from '../../src/shared/desk-knowledge';

afterEach(() => { cleanup(); delete window.dashboardDesk; delete window.dashboardContent; });

it('uploads a sheet and shows it as what the seat receives', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async (command) => desk.command('operator', command, '合成经理'),
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  await user.click(await screen.findByRole('button', { name: '添加话术' }));
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
  await user.type(screen.getByRole('textbox', { name: '问题' }), '退货时效');
  const category = screen.getByRole('combobox', { name: '分类' });
  expect(category.tagName).not.toBe('SELECT');
  expect(document.querySelector('select')).toBeNull();
  await user.click(category);
  await user.click(await screen.findByRole('option', { name: '售后服务' }));
  await user.type(screen.getByRole('textbox', { name: '答案' }), '七天内可退');
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('cell', { name: '退货时效' })).toBeInTheDocument();
  expect(screen.getByText('生效中')).toBeInTheDocument();
  expect(screen.queryByText(/坐席会收到/)).not.toBeInTheDocument();
  const file = new File(['问题,标准话术,分类\n退货多久,七天内可退,售后\n'], '售后.csv', { type: 'text/csv' });
  await user.click(screen.getByRole('button', { name: '改为上传文档' }));
  await user.upload(screen.getByLabelText('导入 CSV 或 Excel'), file);
  expect(await screen.findByText('退货多久')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '导入 1 条' }));
  expect(screen.getByText('将导入 1 条到本机知识库，状态为未生效，不会覆盖已有话术，也不会发布到查询。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '确认导入 1 条' }));
  expect(await screen.findByText('已导入 1 条，状态是未生效。')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '售后客服' }));
  expect(await screen.findByRole('cell', { name: '退货多久' })).toBeInTheDocument();
  expect(screen.getByText('未生效')).toBeInTheDocument();
  expect(screen.queryByText(/坐席会收到/)).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', { name: '退货时效' })).not.toBeInTheDocument();
});

it('keeps the knowledge columns and dismisses the add layer without saving', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  const commands: string[] = [];
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async (command) => { commands.push(command.action); return desk.command('operator', command, '合成经理'); },
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  const table = await screen.findByRole('table', { name: '当前人设知识' });
  for (const header of ['话术名称', '话术内容', '状态', '最后更新时间', '操作']) {
    expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
  }
  const add = screen.getByRole('button', { name: '添加话术' });
  for (let step = 0; step < 6 && document.activeElement !== add; step += 1) await user.tab();
  expect(add).toHaveFocus();
  await user.click(add);
  await user.tab();
  expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
  await user.type(screen.getByRole('textbox', { name: '问题' }), '不该保存');
  await user.type(screen.getByRole('textbox', { name: '答案' }), '不该写入');
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', { name: '不该保存' })).not.toBeInTheDocument();
  expect(commands).not.toContain('upload');
  await user.click(screen.getByRole('button', { name: '添加话术' }));
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
  await user.type(screen.getByRole('textbox', { name: '问题' }), '遮罩也不保存');
  const dialog = screen.getByRole('dialog', { name: '添加话术' });
  const wrap = dialog.closest('.ant-modal-wrap');
  if (!(wrap instanceof HTMLElement)) throw new Error('missing wrap');
  fireEvent.mouseDown(wrap);
  fireEvent.click(wrap);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(commands).not.toContain('upload');
  expect(screen.queryByText('读取资格已到期')).not.toBeInTheDocument();
});

it('shows skipped-row notices when the CSV filename has leading spaces', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async command => desk.command('operator', command, '合成经理'),
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  await user.click(await screen.findByRole('button', { name: '添加话术' }));
  await user.upload(screen.getByLabelText('导入 CSV 或 Excel'), new File([
    'scene,script\n合成正常问题,合成正常回答\n合成缺答问题,',
  ], ' 合成话术.csv', { type: 'text/csv' }));
  expect(await screen.findByText(/已跳过空白或不完整 1 行/)).toHaveTextContent('第 3 行');
});

it('closes the import confirmation with the add layer and does not import', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  const commands: string[] = [];
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async (command) => { commands.push(command.action); return desk.command('operator', command, '合成经理'); },
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  await user.click(await screen.findByRole('button', { name: '添加话术' }));
  const file = new File(['问题,标准话术,分类\n退货多久,七天内可退,售后\n'], '售后.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('导入 CSV 或 Excel'), file);
  await user.click(await screen.findByRole('button', { name: '导入 1 条' }));
  expect(screen.getByText('将导入 1 条到本机知识库，状态为未生效，不会覆盖已有话术，也不会发布到查询。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText(/将导入 1 条话术/)).not.toBeInTheDocument();
  expect(commands).not.toContain('import-csv');
});

it('does not ask the seat to log in when the knowledge store is absent', async () => {
  render(<DeskKnowledge />);
  expect(screen.getByRole('region', { name: '知识库' })).toHaveTextContent('知识库还不能在这里用。');
  expect(screen.queryByText('未接入')).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('region', { name: '知识库' })).toHaveTextContent('知识库还不能在这里用。');
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
});

it('stores a scheduled window as an instant and keeps that instant out of the fields', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async (command) => desk.command('operator', command, '合成经理'),
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  await user.click(await screen.findByRole('button', { name: '添加话术' }));
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
  const dialog = screen.getByRole('dialog', { name: '添加话术' });
  expect(within(dialog).getByRole('combobox', { name: '分类' }).tagName).not.toBe('SELECT');
  expect(dialog.querySelector('select')).toBeNull();
  expect(document.querySelector('select')).toBeNull();
  await user.type(screen.getByRole('textbox', { name: '问题' }), '限时退货');
  await user.type(screen.getByRole('textbox', { name: '答案' }), '窗口内可退');
  fireEvent.click(screen.getByRole('radio', { name: '定时生效' }));
  const start = screen.getByLabelText('开始');
  const end = screen.getByLabelText('结束');
  expect(start).toHaveAttribute('placeholder', '选择开始时间');
  expect(end).toHaveAttribute('placeholder', '选择结束时间');
  expect(start.getAttribute('placeholder')).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(end.getAttribute('placeholder')).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(start).toHaveValue('');
  expect(end).toHaveValue('');
  await user.click(start);
  await user.type(start, '2026-10-14 09:30{Enter}');
  await user.click(end);
  await user.type(end, '2026-10-20 18:00{Enter}');
  expect(start).toHaveValue('2026-10-14 09:30');
  expect(end).toHaveValue('2026-10-20 18:00');
  expect((start as HTMLInputElement).value).not.toMatch(/Z$/);
  expect((end as HTMLInputElement).value).not.toMatch(/Z$/);
  expect((start as HTMLInputElement).value).not.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  expect((end as HTMLInputElement).value).not.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('cell', { name: '限时退货' })).toBeInTheDocument();
  const view = desk.reply('operator', '合成经理').view;
  if (!view) throw new Error('missing knowledge view');
  const saved = view.items.find((item) => item.name === '限时退货');
  if (!saved?.validFrom || !saved.validUntil) throw new Error('missing scheduled instant');
  expect(saved.validity).toBe('scheduled');
  expect(saved.validFrom).toBe(new Date('2026-10-14T09:30').toISOString());
  expect(saved.validUntil).toBe(new Date('2026-10-20T18:00').toISOString());
  expect(saved.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(saved.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(screen.getByLabelText('开始')).toHaveValue('2026-10-14 09:30');
  expect(screen.getByLabelText('结束')).toHaveValue('2026-10-20 18:00');
  expect(screen.getByLabelText('开始')).not.toHaveValue(saved.validFrom);
  expect(document.body.textContent ?? '').not.toContain(saved.validFrom);
  expect(document.body.textContent ?? '').not.toContain(saved.validUntil);
  expect(screen.getByText('待生效')).toBeInTheDocument();
});

it('reloads an operator view after the query window signs in', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  let role: 'operator' | null = null;
  window.dashboardDesk = {
    current: async () => desk.reply(role, role ? '合成经理' : null),
    command: async (command) => desk.command(role, command, role ? '合成经理' : null),
  };
  let notify = () => {};
  window.dashboardContent = {
    onSessionChanged(listener: () => void) {
      notify = listener;
      return () => { notify = () => {}; };
    },
  } as unknown as Window['dashboardContent'];
  render(<DeskKnowledge />);
  expect(await screen.findByText('请先登录。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '全店' }));
  expect(await screen.findByText('请先在查询窗口登录。')).toBeInTheDocument();
  role = 'operator';
  notify();
  expect(await screen.findByRole('button', { name: '添加话术' })).toBeInTheDocument();
  expect(screen.queryByText('请先在查询窗口登录。')).not.toBeInTheDocument();
  expect(screen.queryByText('请先登录。')).not.toBeInTheDocument();
});

it('shows the reading skeleton until the knowledge read is ready', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  let resolveCurrent: (value: DeskReply) => void = () => undefined;
  window.dashboardDesk = {
    current: () => new Promise((resolve) => { resolveCurrent = resolve; }),
    command: async (command) => desk.command(null, command, null),
  };
  render(<DeskKnowledge />);
  expect(screen.getByRole('status', { name: '正在读取知识库' })).toBeInTheDocument();
  expect(screen.queryByText('请先登录。')).not.toBeInTheDocument();
  expect(screen.queryByText('还没有知识。')).not.toBeInTheDocument();
  await act(async () => { resolveCurrent(desk.reply(null, null)); });
  expect(await screen.findByText('请先登录。')).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
});

it('keeps the empty sentences for an operator and a seat', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async (command) => desk.command('operator', command, '合成经理'),
  };
  const operator = render(<DeskKnowledge />);
  expect(await screen.findByText('还没有知识。')).toBeInTheDocument();
  operator.unmount();
  window.dashboardDesk = {
    current: async () => desk.reply('seat', '合成坐席'),
    command: async (command) => desk.command('seat', command, '合成坐席'),
  };
  render(<DeskKnowledge />);
  expect(await screen.findByText('还没有生效知识。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '添加话术' })).not.toBeInTheDocument();
  expect(screen.queryByText('还没有知识。')).not.toBeInTheDocument();
});

it('keeps the persona list when a write fails', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '知识已更新，但没能写入本机。', view: null }),
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  await user.click(await screen.findByRole('tab', { name: '售后客服' }));
  expect(await screen.findByText('知识已更新，但没能写入本机。')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '全店' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '售前客服' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '售后客服' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '添加话术' })).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
});

it('shows a failed knowledge read without a persona list', async () => {
  window.dashboardDesk = {
    current: async () => { throw new Error('down'); },
    command: async () => { throw new Error('down'); },
  };
  render(<DeskKnowledge />);
  expect(await screen.findByText('知识库暂时读不出来。')).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '全店' })).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
});

it('stores an unauthorized knowledge read as forbidden', async () => {
  window.dashboardDesk = {
    current: async () => ({ ok: false, code: 'UNAUTHORIZED', message: '请先在查询窗口登录。', view: null }),
    command: async () => ({ ok: false, code: 'UNAUTHORIZED', message: '请先在查询窗口登录。', view: null }),
  };
  render(<DeskKnowledge />);
  expect(await screen.findByText('请先在查询窗口登录。')).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '全店' })).not.toBeInTheDocument();
  expect(screen.queryByRole('table', { name: '当前人设知识' })).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
});

it('keeps a refused knowledge read on the workbench as an error', async () => {
  window.dashboardDesk = {
    current: async () => ({ ok: false, code: 'FORBIDDEN', message: '请求未完成或权限已改变。', view: null }),
    command: async () => ({ ok: false, code: 'FORBIDDEN', message: '请求未完成或权限已改变。', view: null }),
  };
  render(<DeskKnowledge />);
  expect(await screen.findByText('请求未完成或权限已改变。')).toBeInTheDocument();
  expect(screen.queryByText('知识库还不能在这里用。')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '知识库' })).toHaveClass('wb9');
});

it('keeps the persona list on screen while the next knowledge read is in flight', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  let reads = 0;
  let release: () => void = () => undefined;
  let gate = Promise.resolve();
  window.dashboardDesk = {
    current: () => {
      reads += 1;
      return gate.then(() => desk.reply('operator', '合成经理'));
    },
    command: async (command) => desk.command('operator', command, '合成经理'),
  };
  let notify = () => {};
  window.dashboardContent = {
    onSessionChanged(listener: () => void) {
      notify = listener;
      return () => { notify = () => {}; };
    },
  } as unknown as Window['dashboardContent'];
  render(<DeskKnowledge />);
  expect(await screen.findByRole('tab', { name: '全店' })).toBeInTheDocument();
  expect(reads).toBe(1);
  gate = new Promise((resolve) => { release = resolve; });
  await act(async () => { notify(); });
  expect(reads).toBe(2);
  expect(screen.getByRole('tab', { name: '全店' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '添加话术' })).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '正在读取知识库' })).not.toBeInTheDocument();
  await act(async () => { release(); });
  expect(await screen.findByRole('button', { name: '添加话术' })).toBeInTheDocument();
});
