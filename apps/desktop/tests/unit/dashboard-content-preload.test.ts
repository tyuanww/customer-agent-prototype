// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import type { DashboardContentApi } from '../../src/shared/dashboard-content';
import type { DashboardOpsApi } from '../../src/shared/dashboard-ops-loop';

const expose = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { invoke },
}));

const unavailable = {
  ok: false as const,
  code: 'UNAVAILABLE' as const,
  message: '服务暂不可用，请重试',
};

beforeAll(async () => {
  await import('../../src/preload/dashboard');
});

function contentApi(): DashboardContentApi {
  const call = expose.mock.calls.find((entry) => entry[0] === 'dashboardContent');
  return call?.[1] as DashboardContentApi;
}

it('accepts xlsx parse success and parser codes, and fail-closes malformed IPC', async () => {
  const api = contentApi();
  const request = { sourceName: 'faq.xlsx', bytes: new ArrayBuffer(4) };
  const success = {
    ok: true as const,
    sourceName: 'faq.xlsx',
    rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' as const }],
    csvText: 'scene,script,domain\n面膜紫适用人群,亲亲这是话术,product',
  };

  invoke.mockResolvedValueOnce(success);
  await expect(api.parseUpload(request)).resolves.toEqual(success);
  expect(invoke).toHaveBeenCalledWith('dashboard:content-parse', request);

  invoke.mockResolvedValueOnce({
    ok: false,
    code: 'binary-workbook',
    message: 'Excel 未能解析。未连接飞书或 Wiki。',
  });
  await expect(api.parseUpload(request)).resolves.toMatchObject({ ok: false, code: 'binary-workbook' });

  invoke.mockResolvedValueOnce({ ok: false, code: 'too-large', message: '文件超过 10MiB。' });
  await expect(api.parseUpload(request)).resolves.toMatchObject({ ok: false, code: 'too-large' });

  invoke.mockResolvedValueOnce({ ok: false, code: 'empty', message: '没有可预览的数据行。' });
  await expect(api.parseUpload(request)).resolves.toMatchObject({ ok: false, code: 'empty' });

  invoke.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: '当前身份不能执行此操作' });
  await expect(api.parseUpload(request)).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' });

  invoke.mockResolvedValueOnce({ ok: true, sourceName: 'faq.xlsx', csvText: 'x' });
  await expect(api.parseUpload(request)).resolves.toEqual(unavailable);

  invoke.mockRejectedValueOnce(new Error('ipc down'));
  await expect(api.parseUpload(request)).resolves.toEqual(unavailable);
});

it('fail-closes dashboardOps invoke throws and non-string SOP import args', async () => {
  const call = expose.mock.calls.find((entry) => entry[0] === 'dashboardOps');
  const api = call?.[1] as DashboardOpsApi;
  invoke.mockResolvedValueOnce({
    ok: true,
    noHitRate: 0.1,
    copyCompleteRate: 0.2,
    openTaskCount: 1,
    currentReleaseScriptCount: 8,
    window: 'current_release',
    releaseId: null,
  });
  await expect(api.retrieval('current_release')).resolves.toMatchObject({
    ok: true, window: 'current_release', noHitRate: 0.1,
  });
  expect(invoke).toHaveBeenCalledWith('dashboard:ops-retrieval', 'current_release');

  invoke.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: '当前身份不能执行此操作' });
  await expect(api.softwareCatalog()).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' });

  invoke.mockResolvedValueOnce(null);
  await expect(api.sopCatalog()).resolves.toEqual(unavailable);

  invoke.mockRejectedValueOnce(new Error('ipc down'));
  await expect(api.scriptDelete({ scriptId: 'script-1', expectedVersion: 1 })).resolves.toEqual(unavailable);

  invoke.mockResolvedValueOnce({ ok: true, productSessionId: 'default', nodeCount: 0 });
  await expect(api.sopImport(12 as unknown as string)).resolves.toEqual({
    ok: true, productSessionId: 'default', nodeCount: 0,
  });
  expect(invoke).toHaveBeenCalledWith('dashboard:ops-sop-import', '');
});
