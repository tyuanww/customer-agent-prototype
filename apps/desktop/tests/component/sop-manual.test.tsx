import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SopManual } from '../../src/renderer/features/sop/SopManual';
import { MISSING_ITEM_SOP_TREE } from '../../src/shared/synthetic-sops';
import { projectSopManualImages } from '../../src/shared/sop-model';
import { IntakeAntdTheme } from '../../src/renderer/features/dashboard/intake-antd';

const previous = window.dashboardWorkbench;
afterEach(() => { window.dashboardWorkbench = previous; });

function pendingImages() {
  let resolve: (value: unknown) => void = () => { throw new Error('Image read not initialized'); };
  const promise = new Promise<unknown>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('SOP manual', () => {
  it('reads the shared scene, exposes requirements, and folds customer text', () => {
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    expect(screen.getByText('已核对订单应收数量')).toBeVisible();
    expect(screen.queryByText('方便告诉我这笔订单应收到和实际收到的数量，并提供包裹信息吗？我先帮您核对。')).toBeNull();
    expect(screen.getByText('少件与分包发货')).toBeVisible();
    fireEvent.click(screen.getByText('索取数量与包裹信息'));
    expect(screen.getByText('方便告诉我这笔订单应收到和实际收到的数量，并提供包裹信息吗？我先帮您核对。')).toBeVisible();
  });
  it('navigates knowledge without execution or copy controls', () => {
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '确认数量差异原因' }));
    expect(screen.getByText('未能核实包裹状态或数量')).toBeVisible();
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '补充核实信息' }));
    expect(screen.getByRole('article', { name: '补充核实信息' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '下一步' })).toBeNull();
    expect(screen.queryByRole('button', { name: '复制话术' })).toBeNull();
  });
  it('does not disclose manager notes', () => {
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '提交少件复核' }));
    expect(screen.getByText('整理数量差异和包裹材料，提交主管确认处理方案。')).toBeVisible();
    expect(screen.queryByText(/处理方案需按当前有效规则确认/)).toBeNull();
  });
  it('filters the directory by task knowledge', () => {
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    fireEvent.change(screen.getByRole('textbox', { name: '查找步骤和知识' }), { target: { value: '分包发货' } });
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('button', { name: '核对订单与实收数量' })).toBeVisible();
    expect(within(nav).queryByRole('button', { name: '提交少件复核' })).toBeNull();
  });
  it('shows the Main projection for the same task and reveals wording images only when expanded', async () => {
    const projections = projectSopManualImages([MISSING_ITEM_SOP_TREE]);
    const sopImages = vi.fn().mockResolvedValue(projections);
    window.dashboardWorkbench = { mode: vi.fn(), sopImages };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    const task = await screen.findByRole('img', { name: '合成示例：订单三件，实收两件' });
    expect(task).toHaveAttribute('src', projections[0]?.images[0]?.dataUrl);
    expect(screen.getByRole('img', { name: '合成示例：订单分为已送达和在途两个包裹' })).toBeVisible();
    expect(screen.queryByRole('img', { name: '合成示例：包裹外观与包裹信息' })).toBeNull();
    fireEvent.click(screen.getByText('索取数量与包裹信息'));
    expect(screen.getByRole('img', { name: '合成示例：包裹外观与包裹信息' })).toBeVisible();
    expect(sopImages).toHaveBeenCalledWith();
    expect(screen.queryByRole('button', { name: '下一步' })).toBeNull();
  });
  it('retries a failed read once without losing the search or expanded wording', async () => {
    const pending = pendingImages();
    const projections = projectSopManualImages([MISSING_ITEM_SOP_TREE]);
    const sopImages = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockReturnValueOnce(pending.promise);
    window.dashboardWorkbench = { mode: vi.fn(), sopImages };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    const retry = await screen.findByRole('button', { name: '重新读取图片' });
    expect(screen.getByRole('status')).toHaveTextContent('图片读取失败');
    const search = screen.getByRole('textbox', { name: '查找步骤和知识' });
    fireEvent.change(search, { target: { value: '订单' } });
    fireEvent.click(screen.getByText('索取数量与包裹信息'));
    retry.focus();
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(sopImages).toHaveBeenCalledTimes(2));
    expect(retry).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在重新读取图片');
    expect(screen.getByRole('article', { name: '核对订单与实收数量' })).toBeVisible();
    expect(search).toHaveValue('订单');
    expect(screen.getByText('方便告诉我这笔订单应收到和实际收到的数量，并提供包裹信息吗？我先帮您核对。')).toBeVisible();
    expect(screen.queryByRole('img', { name: '合成示例：订单三件，实收两件' })).toBeNull();

    await act(async () => pending.resolve(projections));
    expect(await screen.findByRole('img', { name: '合成示例：包裹外观与包裹信息' })).toBeVisible();
    expect(search).toHaveValue('订单');
    expect(screen.queryByRole('button', { name: '重新读取图片' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: '复制话术' })).toBeNull();
    expect(sopImages.mock.calls).toEqual([[], []]);
  });
  it('allows another manual retry after a second read failure and catches synchronous read errors', async () => {
    const sopImages = vi.fn()
      .mockImplementationOnce(() => { throw new Error('bridge read failed'); })
      .mockRejectedValueOnce(new Error('read failed again'))
      .mockResolvedValueOnce(projectSopManualImages([MISSING_ITEM_SOP_TREE]));
    window.dashboardWorkbench = { mode: vi.fn(), sopImages };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    fireEvent.click(await screen.findByRole('button', { name: '重新读取图片' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '重新读取图片' })).toBeEnabled());
    expect(sopImages).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '重新读取图片' }));
    expect(await screen.findByRole('img', { name: '合成示例：订单三件，实收两件' })).toBeVisible();
    expect(sopImages).toHaveBeenCalledTimes(3);
  });
  it('keeps the selected task when a pending retry finishes', async () => {
    const pending = pendingImages();
    const sopImages = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockReturnValueOnce(pending.promise);
    window.dashboardWorkbench = { mode: vi.fn(), sopImages };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    fireEvent.click(await screen.findByRole('button', { name: '重新读取图片' }));
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '确认数量差异原因' }));
    await act(async () => pending.resolve(projectSopManualImages([MISSING_ITEM_SOP_TREE])));
    expect(screen.getByRole('article', { name: '确认数量差异原因' })).toBeVisible();
    expect(screen.queryByRole('img', { name: '合成示例：订单三件，实收两件' })).toBeNull();
    expect(screen.queryByText('图片暂时无法显示')).toBeNull();
  });
  it('does not apply a late read from an unmounted manual to a new instance', async () => {
    const pending = pendingImages();
    window.dashboardWorkbench = { mode: vi.fn(), sopImages: vi.fn().mockReturnValue(pending.promise) };
    const first = render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    first.unmount();
    window.dashboardWorkbench = { mode: vi.fn(), sopImages: vi.fn().mockResolvedValue(null) };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('图片暂时无法显示'));
    await act(async () => pending.resolve(projectSopManualImages([MISSING_ITEM_SOP_TREE])));
    expect(screen.getByRole('status')).toHaveTextContent('图片暂时无法显示');
    expect(screen.queryByRole('img', { name: /^合成示例：/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新读取图片' })).toBeNull();
  });
  it.each([undefined, null, { images: [] }])('does not retry an unavailable or invalid image source: %s', async value => {
    window.dashboardWorkbench = value === undefined ? { mode: vi.fn() } : { mode: vi.fn(), sopImages: vi.fn().mockResolvedValue(value) };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('图片暂时无法显示'));
    expect(screen.queryByRole('button', { name: '重新读取图片' })).toBeNull();
    expect(screen.queryByRole('img', { name: /^合成示例：/ })).toBeNull();
  });
  it('does not display malformed or differently owned image projections', async () => {
    const projections = projectSopManualImages([MISSING_ITEM_SOP_TREE]);
    window.dashboardWorkbench = { mode: vi.fn(), sopImages: vi.fn().mockResolvedValue([{ ...projections[0], nodeId: 'other' }]) };
    const view = render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('图片暂时无法显示'));
    expect(screen.queryByRole('img', { name: '合成示例：订单三件，实收两件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新读取图片' })).toBeNull();
    view.unmount();
    window.dashboardWorkbench = { mode: vi.fn(), sopImages: vi.fn().mockResolvedValue([{ ...projections[0], images: [{ alt: '图片', dataUrl: 'https://example.com' }] }]) };
    render(<IntakeAntdTheme><SopManual trees={[MISSING_ITEM_SOP_TREE]} /></IntakeAntdTheme>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('图片暂时无法显示'));
    expect(screen.queryByRole('img', { name: '图片' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新读取图片' })).toBeNull();
  });
});
