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
        expect(screen.queryByTestId('module-overview')).not.toBeInTheDocument();
        expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
        expect(screen.queryByTestId('nav-permissions')).not.toBeInTheDocument();
        expect(screen.queryByTestId('nav-materials')).not.toBeInTheDocument();
        expect(screen.queryByTestId('nav-overview')).not.toBeInTheDocument();
        continue;
      }
      expect(await screen.findByTestId('nav-permissions')).toHaveAccessibleName('权限');
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
          expect(screen.getByTestId('workbench-no-access')).toHaveTextContent('你还不能给他人开通权限');
          expect(screen.getByTestId('workbench-no-access')).toHaveTextContent('没有权限，请找人开通。');
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

it('shows only 话术库 and SOP until a non-seat job resolves', async () => {
  let resolveSession: (job: SessionJobView) => void = () => undefined;
  const owner = install(observeSessionJob(null));
  window.dashboardContent = {
    ...window.dashboardContent!,
    session: () => new Promise((resolve) => {
      resolveSession = (job) => resolve({
        ok: true,
        enabled: true,
        signedIn: true,
        role: 'owner',
        displayName: '合成管理员',
        job,
      });
    }),
  };
  try {
    render(<DashboardApp />);
    expect(screen.getByTestId('nav-wording')).toBeInTheDocument();
    expect(screen.getByTestId('nav-sop')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-materials')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-permissions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-overview')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-job-pending')).toHaveTextContent('正在确认你的职务……');
    expect(screen.getByText('正在确认')).toBeInTheDocument();

    const seat = observeSessionJob({ title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }] });
    resolveSession(seat);
    expect(await screen.findByText('你现在可以查话术。需要看数据或管内容，请联系客服主管。')).toBeInTheDocument();
    expect(screen.queryByTestId('module-overview')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
    expect(screen.queryByTestId('nav-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-materials')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-permissions')).not.toBeInTheDocument();
  } finally {
    owner.dispose();
    cleanup();
  }

  const supervisor = observeSessionJob({
    title: '客服主管',
    directory: [{ name: '客服主管', enabled: true }],
    actions: { query: true, import: true, publish: true, rollback: true },
  });
  const again = install(supervisor);
  try {
    render(<DashboardApp />);
    expect(await screen.findByTestId('nav-content')).toBeInTheDocument();
    expect(screen.getByTestId('nav-materials')).toBeInTheDocument();
    expect(screen.getByTestId('nav-permissions')).toBeInTheDocument();
    expect(screen.getByTestId('nav-wording')).toBeInTheDocument();
    expect(screen.getByTestId('nav-sop')).toBeInTheDocument();
    expect(screen.queryByText('你现在可以查话术。需要看数据或管内容，请联系客服主管。')).not.toBeInTheDocument();
  } finally {
    again.dispose();
  }
});

it('says please sign in after the session returns logged out', async () => {
  const owner = install(observeSessionJob(null));
  window.dashboardContent = {
    ...window.dashboardContent!,
    session: async () => ({
      ok: true,
      enabled: true,
      signedIn: false,
      role: null,
      displayName: null,
      job: null,
    }),
  };
  try {
    render(<DashboardApp />);
    expect(await screen.findByTestId('module-signed-out')).toHaveTextContent('请先登录。');
    expect(screen.queryByText('正在确认你的职务……')).not.toBeInTheDocument();
    expect(screen.getByText('请先登录')).toBeInTheDocument();
  } finally {
    owner.dispose();
  }
});

it('keeps 权限 reachable when the job snapshot is missing and asks for a fresh login', async () => {
  const user = userEvent.setup();
  const owner = install(observeSessionJob(null));
  try {
    render(<DashboardApp />);
    expect(await screen.findByTestId('nav-permissions')).toHaveAccessibleName('权限');
    await user.click(screen.getByTestId('nav-permissions'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull());
    expect(screen.getByTestId('workbench-no-access')).toHaveTextContent('请重新登录后再查看职务。');
  } finally {
    owner.dispose();
  }
});
