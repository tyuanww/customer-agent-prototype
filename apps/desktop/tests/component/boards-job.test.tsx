import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
import { observeSessionJob, UNRESOLVED_JOB_LABEL, type SessionJobView } from '../../src/shared/product-session';
import { CONTENT_PUBLISH_COPY } from '../../src/shared/dashboard-content';

afterEach(() => {
  cleanup();
  delete window.dashboardIntake;
  delete window.dashboardContent;
  delete window.dashboardPermissions;
});

function install(job: SessionJobView) {
  const fixture = intakePermissionsData();
  const owner = new ContentIntakePermissions(fixture.session);
  window.dashboardPermissions = {
    current: async () => ({ ok: true, view: owner.view() }),
    command: async (command) => ({ ok: true, view: await owner.command(command) }),
    onInvalidated: (fn) => owner.subscribe(fn),
  };
  window.dashboardIntake = {
    mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    onInvalidated: () => () => undefined,
  };
  window.dashboardContent = {
    session: async () => ({
      ok: true,
      enabled: true,
      signedIn: true,
      role: 'owner',
      displayName: '合成管理员',
      job,
    }),
    parseUpload: async () => ({ ok: false, code: 'UNAVAILABLE', message: '服务暂不可用，请重试' }),
    publishDraft: async () => ({ ok: false, code: 'UNAVAILABLE', message: '服务暂不可用，请重试' }),
    rollbackPrevious: async () => ({ ok: false, code: 'UNAVAILABLE', message: '服务暂不可用，请重试' }),
    cancelInFlight: async () => ({ ok: true }),
  };
  return owner;
}

it('keeps 权限 and 资料管理 reachable for a resolved job and an unresolved job', async () => {
  const user = userEvent.setup();
  const engineer = observeSessionJob({ title: 'AI赋能工程师', directory: [{ name: 'AI赋能工程师', enabled: true }] });
  const unresolved = observeSessionJob(null);
  for (const job of [engineer, unresolved]) {
    cleanup();
    delete window.dashboardIntake;
    delete window.dashboardContent;
    delete window.dashboardPermissions;
    const owner = install(job);
    try {
      render(<DashboardApp />);
      expect(screen.getByTestId('nav-permissions')).toHaveAccessibleName('权限');
      expect(screen.getByTestId('nav-materials')).toHaveAccessibleName('资料管理');
      await user.click(screen.getByTestId('nav-permissions'));
      expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'permissions');
      const grant = await screen.findByRole('button', { name: '新增授权' });
      if (job.status === 'resolved') {
        await waitFor(() => expect(grant).toBeEnabled());
        expect(screen.queryByText(UNRESOLVED_JOB_LABEL)).not.toBeInTheDocument();
      } else {
        await waitFor(() => {
          expect(grant).toBeDisabled();
          expect(screen.getByText(UNRESOLVED_JOB_LABEL)).toBeInTheDocument();
        });
      }
      await user.click(screen.getByTestId('nav-materials'));
      expect(await screen.findByRole('heading', { name: '资料管理' })).toBeInTheDocument();
      await user.click(screen.getByTestId('nav-publish'));
      expect(screen.getByRole('button', { name: '发布' })).toBeInTheDocument();
      expect(screen.queryByText(CONTENT_PUBLISH_COPY.ownerPublish)).not.toBeInTheDocument();
    } finally {
      owner.dispose();
    }
  }
});
