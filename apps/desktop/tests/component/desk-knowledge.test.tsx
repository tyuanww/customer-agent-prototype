import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { DeskKnowledge } from '../../src/renderer/features/dashboard/DeskKnowledge';
import { DeskKnowledgeStore } from '../../src/shared/desk-knowledge';

afterEach(() => { cleanup(); delete window.dashboardDesk; });

it('uploads a sheet and shows it as what the seat receives', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = {
    current: async () => desk.reply('operator', '合成经理'),
    command: async (command) => desk.command('operator', command, '合成经理'),
  };
  const user = userEvent.setup();
  render(<DeskKnowledge />);
  await user.click((await screen.findAllByRole('button', { name: '写下一条' }))[0]!);
  await user.type(screen.getByRole('textbox', { name: '问题' }), '退货时效');
  await user.selectOptions(screen.getByRole('combobox', { name: '分类' }), 'aftersale');
  await user.type(screen.getByRole('textbox', { name: '答案' }), '七天内可退');
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByRole('heading', { name: '退货时效' })).toBeInTheDocument();
  expect(screen.getByText('生效中')).toBeInTheDocument();
  expect(screen.getByText('坐席会收到 1 条。全店生效的知识会一起送到这个人设。')).toBeInTheDocument();
  const file = new File(['问题,标准话术,分类\n退货多久,七天内可退,售后\n'], '售后.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('导入 CSV'), file);
  expect(await screen.findByText('已导入 1 条，状态是未生效。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '售后客服' }));
  expect(await screen.findByRole('heading', { name: '退货多久' })).toBeInTheDocument();
  expect(screen.getByText('未生效')).toBeInTheDocument();
  expect(screen.getByText('坐席会收到 1 条。全店生效的知识会一起送到这个人设。')).toBeInTheDocument();
  expect(screen.queryByText('坐席会收到 2 条。全店生效的知识会一起送到这个人设。')).not.toBeInTheDocument();
});
