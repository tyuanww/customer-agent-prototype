import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IntakeOverview } from '../../src/renderer/features/dashboard/IntakeOverview';
import type { DashboardIterationTask } from '../../src/shared/dashboard-iteration';

function task(status: DashboardIterationTask['status']): DashboardIterationTask {
  return {
    taskId: 'task-1', signalId: 'inaccuracy:script-a', clusterKey: 'script-a',
    sampleQueryIds: ['q1', 'q2', 'q3'], suspectedCause: 'content_gap', suggestedScriptIds: ['script-a'],
    status, assigneeRole: 'coach', resolution: null, resolutionNote: null, version: 1,
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', resolvedAt: null,
  };
}

afterEach(() => { cleanup(); delete window.dashboardIteration; });

it('lists only open iteration tasks and does not invent a rate', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open'), { ...task('resolved'), taskId: 'task-2', status: 'resolved' as const, resolution: 'resolved' as const }], nextCursor: null })),
    start: vi.fn(async () => ({ ok: true as const, task: task('in_progress') })),
    close: vi.fn(),
  };
  const onOpen = vi.fn();
  render(<IntakeOverview canOpenPermissions={false} onOpen={onOpen} />);
  expect(await screen.findByText('话术不准 · script-a')).toBeInTheDocument();
  expect(screen.queryByText('task-2')).not.toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '去知识库' }));
  expect(onOpen).toHaveBeenCalledWith('content');
});

it('stays empty when the iteration service is not connected', async () => {
  render(<IntakeOverview canOpenPermissions={false} onOpen={() => undefined} />);
  expect(await screen.findByText('未接入')).toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});
