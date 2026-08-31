import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';

describe('App role switch', () => {
  it('renders the fox idle control when role=fox', () => {
    window.customerAgent = {
      copyText: vi.fn(),
      getWindowContext: vi.fn().mockResolvedValue({
        role: 'fox',
        phase: 'FOX_IDLE',
        platform: 'darwin',
        shortcut: { registered: true, accelerator: 'CommandOrControl+Shift+Space', message: '' },
        testHarness: false,
      }),
      openSearch: vi.fn(),
      openDashboard: vi.fn(),
      dismiss: vi.fn(),
      reportUiPhase: vi.fn(),
      moveFoxBy: vi.fn(),
      commitFoxDragSettle: vi.fn(),
      setFoxPeek: vi.fn(),
      onOverlayCommand: () => () => undefined,
    };
    render(<App role="fox" />);
    expect(screen.getByTestId('fox-button')).toBeInTheDocument();
  });

  it('renders the query capsule when role=query', () => {
    window.customerAgent = {
      copyText: vi.fn(),
      getWindowContext: vi.fn().mockResolvedValue({
        role: 'query',
        phase: 'SEARCH_INPUT',
        platform: 'darwin',
        shortcut: { registered: true, accelerator: 'CommandOrControl+Shift+Space', message: '' },
        testHarness: false,
      }),
      openSearch: vi.fn(),
      openDashboard: vi.fn(),
      dismiss: vi.fn(),
      reportUiPhase: vi.fn(),
      moveFoxBy: vi.fn(),
      commitFoxDragSettle: vi.fn(),
      setFoxPeek: vi.fn(),
      onOverlayCommand: () => () => undefined,
    };
    render(<App role="query" />);
    expect(screen.getByTestId('question-input')).toBeInTheDocument();
  });

  it('renders the dashboard workbench when role=dashboard and does not require customerAgent', () => {
    delete window.customerAgent;
    render(<App role="dashboard" />);
    expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
    expect(screen.getByTestId('module-overview')).toBeInTheDocument();
    expect(window.customerAgent).toBeUndefined();
  });
});
