import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { IntakeSopSource } from '../../src/renderer/features/dashboard/IntakeSopSource';

afterEach(() => { cleanup(); delete window.dashboardSopWorkbook; });

it('stays 未接入 and draws no flow when the opener is absent', () => {
  render(<IntakeSopSource />);
  expect(screen.getByText('还没有 SOP。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '打开原始 SOP 表' })).not.toBeInTheDocument();
  expect(screen.queryByText('索要凭证')).not.toBeInTheDocument();
});

it('keeps 未接入 when the operator cancels the file dialog', async () => {
  window.dashboardSopWorkbook = { open: async () => ({ ok: false, code: 'CANCELLED', message: '已取消' }) };
  render(<IntakeSopSource />);
  await userEvent.setup().click(screen.getByRole('button', { name: '打开原始 SOP 表' }));
  expect(await screen.findByText('还没有 SOP。')).toBeVisible();
  expect(screen.queryByText('未发布')).not.toBeInTheDocument();
});

it('shows the unpublished sheet text and does not store images', async () => {
  window.dashboardSopWorkbook = {
    open: async () => ({
      ok: true,
      published: false,
      fileName: 'SOP_原始下载_2026-10-03.xlsx',
      accepted: true,
      sheets: [{ name: '少错破SOP', lines: [{ row: 2, text: '索要凭证', images: 1 }] }],
      issues: [],
    }),
  };
  render(<IntakeSopSource />);
  await userEvent.setup().click(screen.getByRole('button', { name: '打开原始 SOP 表' }));
  expect(await screen.findByText('索要凭证')).toBeVisible();
  expect(screen.getByText(/原始资料，未发布/)).toBeVisible();
  expect(screen.getByText(/未入库/)).toBeVisible();
  expect(screen.queryByText('未接入')).not.toBeInTheDocument();
  expect(screen.queryByText('已接入')).not.toBeInTheDocument();
  expect(screen.queryByText('已发布')).not.toBeInTheDocument();
});

it('lists the check failure and hides partial rows', async () => {
  window.dashboardSopWorkbook = {
    open: async () => ({
      ok: true,
      published: false,
      fileName: '坏表.xlsx',
      accepted: false,
      sheets: [],
      issues: [{ code: 'MISSING_SHEET', sheet: '长痘痘SOP', row: 1, fix: '选择存在的 SOP 工作表' }],
    }),
  };
  render(<IntakeSopSource />);
  await userEvent.setup().click(screen.getByRole('button', { name: '打开原始 SOP 表' }));
  expect(await screen.findByText(/选择存在的 SOP 工作表/)).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
