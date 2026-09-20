import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';

describe('SopLibraryModule', () => {
  beforeEach(() => {
    delete window.dashboardContent;
  });

  afterEach(() => {
    delete window.dashboardContent;
  });

  it('renders fail-closed SOP writes without a synthetic catalog', () => {
    render(<SopLibraryModule />);
    const module = screen.getByTestId('module-sop');
    expect(screen.getByRole('heading', { level: 1, name: 'SOP' })).toBeInTheDocument();
    expect(module).toHaveTextContent('写库未接入');
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('未接入 SOP 库');
    expect(screen.queryByTestId('sop-library-list')).not.toBeInTheDocument();
    expect(screen.queryByText('过敏凭证')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument();
  });

  it('refuses upload, update, delete, export, and custom steps', async () => {
    const user = userEvent.setup();
    render(<SopLibraryModule />);
    expect(screen.getByRole('button', { name: '上传' })).toBeInTheDocument();
    const file = new File(['scene,script\n过敏,先停用\n'], 'sop.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('sop-upload-input'), file);
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('sop-update'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('sop-delete'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('contracts:intake');
    await user.click(screen.getByTestId('sop-export'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('没有写库命令');
    await user.click(screen.getByTestId('sop-custom-step'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
  });
});
