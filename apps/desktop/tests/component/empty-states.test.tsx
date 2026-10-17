import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { IntakeOverview } from '../../src/renderer/features/dashboard/IntakeOverview';
import { IntakeUsageLog } from '../../src/renderer/features/dashboard/IntakeUsageLog';
import { IntakePermissions } from '../../src/renderer/features/dashboard/IntakePermissions';
import { IntakeManagement } from '../../src/renderer/features/dashboard/IntakeManagement';
import { WordingLibraryModule } from '../../src/renderer/features/dashboard/WordingLibraryModule';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';
import { AnnounceModule } from '../../src/renderer/features/dashboard/AnnounceModule';
import { DeskKnowledge } from '../../src/renderer/features/dashboard/DeskKnowledge';
import { WORKBENCH_EMPTY } from '../../src/shared/workbench-empty';

afterEach(() => {
  cleanup();
  delete window.dashboardUsageLog;
  delete window.dashboardPermissions;
  delete window.dashboardIntake;
  delete window.dashboardWording;
  delete window.dashboardAnnounce;
  delete window.dashboardDesk;
});

it('splits an empty usage log from a failed usage read on 概览', async () => {
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findAllByText(WORKBENCH_EMPTY.usageFailed)).not.toHaveLength(0);
  expect(screen.queryByText(WORKBENCH_EMPTY.usageEmpty)).toBeNull();
  cleanup();
  window.dashboardUsageLog = {
    list: async () => ({ ok: true, rows: [], nextCursor: null, canExport: false }),
    previewExport: async () => ({ ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageFailed }),
    export: async () => ({ ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageFailed }),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findAllByText(WORKBENCH_EMPTY.usageEmpty)).not.toHaveLength(0);
  expect(screen.queryByText(WORKBENCH_EMPTY.usageFailed)).toBeNull();
  cleanup();
  window.dashboardUsageLog = {
    list: async () => ({ ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageUnmounted }),
    previewExport: async () => ({ ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageUnmounted }),
    export: async () => ({ ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageUnmounted }),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findAllByText(WORKBENCH_EMPTY.usageUnmounted)).not.toHaveLength(0);
  expect(screen.queryByText(WORKBENCH_EMPTY.usageFailed)).toBeNull();
  expect(screen.queryByText(WORKBENCH_EMPTY.usageEmpty)).toBeNull();
});

it('names a missing usage source on the usage log and an empty log separately', async () => {
  render(<IntakeUsageLog />);
  expect(screen.getByText(WORKBENCH_EMPTY.usageUnmounted)).toBeVisible();
  expect(screen.queryByText(WORKBENCH_EMPTY.usageFailed)).toBeNull();
  expect(screen.queryByText(WORKBENCH_EMPTY.usageEmpty)).toBeNull();
});

it('shows 资料还不能在这里改。请把表交给客服经理。 on 权限 and 资料管理 without accusing the operator', async () => {
  render(<IntakePermissions active />);
  expect(await screen.findByText(WORKBENCH_EMPTY.intakeUnmounted)).toBeVisible();
  expect(screen.queryByText(/没有可用的资料管理权限|权限配置尚未接入/)).toBeNull();
  expect(screen.getByRole('region', { name: '权限配置' })).toBeVisible();
  cleanup();
  render(<IntakeManagement />);
  expect(await screen.findByRole('heading', { name: '资料管理' })).toBeVisible();
  expect(screen.getByText(WORKBENCH_EMPTY.intakeUnmounted)).toBeVisible();
  expect(screen.queryByText('当前没有可用的资料管理权限，请确认登录身份与店铺授权。')).toBeNull();
});

it('keeps the locked empty sentences on 话术库, SOP, 系统同步 and 知识库', async () => {
  render(<WordingLibraryModule />);
  expect(await screen.findByText(WORKBENCH_EMPTY.wordingUnmounted)).toBeVisible();
  cleanup();
  render(<SopLibraryModule />);
  expect(await screen.findByText(WORKBENCH_EMPTY.sopEmpty)).toBeVisible();
  cleanup();
  render(<AnnounceModule />);
  expect(await screen.findByText(WORKBENCH_EMPTY.announceUnmounted)).toBeVisible();
  cleanup();
  window.dashboardDesk = {
    current: async () => ({
      ok: true,
      view: {
        signedIn: false,
        role: null,
        displayName: null,
        personas: [],
        selectedPersonaId: 'shop',
        items: [],
        delivered: [],
        tacit: [],
        revision: 0,
        notice: null,
        persistence: 'ok',
      },
    }),
    command: async () => ({ ok: false, code: 'UNAUTHORIZED', message: WORKBENCH_EMPTY.signedOut, view: null }),
  };
  render(<DeskKnowledge />);
  expect((await screen.findByText(/请先登录/)).textContent ?? '').toContain(WORKBENCH_EMPTY.signedOut);
});
