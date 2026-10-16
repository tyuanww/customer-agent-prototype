import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { DeskKnowledge } from '../../src/renderer/features/dashboard/DeskKnowledge';
import { DeskKnowledgeStore } from '../../src/shared/desk-knowledge';

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
  await user.selectOptions(screen.getByRole('combobox', { name: '分类' }), 'aftersale');
  await user.type(screen.getByRole('textbox', { name: '答案' }), '七天内可退');
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('cell', { name: '退货时效' })).toBeInTheDocument();
  expect(screen.getByText('生效中')).toBeInTheDocument();
  expect(screen.queryByText(/坐席会收到/)).not.toBeInTheDocument();
  const file = new File(['问题,标准话术,分类\n退货多久,七天内可退,售后\n'], '售后.csv', { type: 'text/csv' });
  await user.click(screen.getByRole('button', { name: '改为上传文档' }));
  await user.upload(screen.getByLabelText('导入 CSV'), file);
  expect(await screen.findByText('退货多久')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '导入 1 条' }));
  expect(screen.getByRole('alertdialog', { name: '确认导入？' })).toHaveTextContent('将导入 1 条话术');
  await user.click(screen.getByRole('button', { name: '确认导入 1 条' }));
  expect(await screen.findByText('已导入 1 条，状态是未生效。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '售后客服' }));
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
  const close = screen.getByRole('button', { name: '关闭' });
  expect(close).toHaveFocus();
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
  await user.type(screen.getByRole('textbox', { name: '问题' }), '不该保存');
  await user.type(screen.getByRole('textbox', { name: '答案' }), '不该写入');
  await user.click(close);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', { name: '不该保存' })).not.toBeInTheDocument();
  expect(commands).not.toContain('upload');
  await user.click(screen.getByRole('button', { name: '添加话术' }));
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
  await user.type(screen.getByRole('textbox', { name: '问题' }), '遮罩也不保存');
  const dialog = screen.getByRole('dialog', { name: '添加话术' });
  fireEvent.click(dialog.parentElement!);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(commands).not.toContain('upload');
  expect(screen.queryByText('读取资格已到期')).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: '全店' }));
  expect(await screen.findByText('请先在查询窗口登录。')).toBeInTheDocument();
  role = 'operator';
  notify();
  expect(await screen.findByRole('button', { name: '添加话术' })).toBeInTheDocument();
  expect(screen.queryByText('请先在查询窗口登录。')).not.toBeInTheDocument();
  expect(screen.queryByText('请先登录。')).not.toBeInTheDocument();
});
