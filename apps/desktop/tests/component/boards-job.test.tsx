import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
import { observeSessionJob, UNRESOLVED_JOB_LABEL, type SessionJobView } from '../../src/shared/product-session';
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

it('keeps 权限 and 资料 reachable for an engineer and a 客服坐席', async () => {
  const user = userEvent.setup();
  const engineer = observeSessionJob({
    title: 'AI赋能工程师',
    directory: [{ name: 'AI赋能工程师', enabled: true }],
    actions: { query: true, import: true, publish: true, rollback: true },
  });
  const supervisor = observeSessionJob({
    title: '客服主管',
    directory: [{ name: '客服主管', enabled: true }],
    actions: { query: true, import: true, publish: true, rollback: true },
  });
  const seat = observeSessionJob({ title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }] });
  for (const job of [engineer, supervisor, seat]) {
    cleanup();
    delete window.dashboardIntake;
    delete window.dashboardContent;
    delete window.dashboardPermissions;
    const owner = install(job);
    try {
      render(<DashboardApp />);
      expect(screen.getByTestId('nav-wording')).toHaveAccessibleName('话术库');
      expect(screen.getByTestId('nav-sop')).toHaveAccessibleName('SOP');
      if (job.status === 'resolved' && job.role === 'agent') {
        expect(await screen.findByText('你现在可以查话术。需要看数据或管内容，请联系客服主管。')).toBeInTheDocument();
        expect(screen.queryByTestId('nav-permissions')).not.toBeInTheDocument();
        expect(screen.queryByTestId('nav-materials')).not.toBeInTheDocument();
        expect(screen.queryByTestId('nav-overview')).not.toBeInTheDocument();
        continue;
      }
      expect(screen.getByTestId('nav-permissions')).toHaveAccessibleName('权限');
      expect(screen.getByTestId('nav-materials')).toHaveAccessibleName('资料');
      await user.click(screen.getByTestId('nav-permissions'));
      expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'permissions');
      const grant = job.rights.grant
        ? await screen.findByRole('button', { name: '新增授权' })
        : null;
      if (job.rights.grant && grant) {
        await waitFor(() => expect(grant).toBeEnabled());
        expect(screen.queryByText(UNRESOLVED_JOB_LABEL)).not.toBeInTheDocument();
      } else {
        await waitFor(() => {
          expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull();
          // A5: the block names what is missing and whom to ask, not a generic denial.
          expect(screen.getByTestId('workbench-no-access')).toHaveTextContent('你还不能给他人开通权限');
          expect(screen.getByTestId('workbench-no-access')).toHaveTextContent('请联系你的经理开通。');
        });
      }
      await user.click(screen.getByTestId('nav-materials'));
      expect(await screen.findByRole('heading', { name: '资料' })).toBeInTheDocument();
      expect(screen.queryByTestId('nav-publish')).not.toBeInTheDocument();
      expect(screen.queryByTestId('content-publish-denied')).not.toBeInTheDocument();
    } finally {
      owner.dispose();
    }
  }
});

it('keeps 权限 reachable when the job snapshot is missing and asks for a fresh login', async () => {
  const user = userEvent.setup();
  const owner = install(observeSessionJob(null));
  try {
    render(<DashboardApp />);
    expect(screen.getByTestId('nav-permissions')).toHaveAccessibleName('权限');
    await user.click(screen.getByTestId('nav-permissions'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull());
    expect(screen.getByTestId('workbench-no-access')).toHaveTextContent('请重新登录后再查看职务。');
  } finally {
    owner.dispose();
  }
});
