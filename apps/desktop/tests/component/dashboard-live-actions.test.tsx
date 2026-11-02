import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';

describe('dashboard live actions', () => {
  afterEach(() => {
    delete window.dashboardOps;
  });

  it('does not render the frozen-snapshot caption on overview', () => {
    render(<DashboardApp />);
    expect(screen.getByTestId('module-overview')).not.toHaveTextContent('固定周期合成演示数据');
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
  });

  it('does not offer legacy SOP writes on the business page', () => {
    render(<SopLibraryModule sop={{ state: 'not-published' }} />);
    expect(screen.getByTestId('module-sop')).toHaveTextContent('SOP 流程发布后会显示在这里');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
