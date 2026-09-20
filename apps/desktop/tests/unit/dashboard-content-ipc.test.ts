// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerDashboardContentIpc } from '../../src/main/dashboard-content-ipc';
import { dashboardContentImport, dashboardContentPublish, dashboardContentSession } from '../../src/main/dashboard-content';
import { CONTENT_PUBLISH_COPY } from '../../src/shared/dashboard-content';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { ProductHttpError } from '../../src/main/product-http';
import type { ProductSession } from '../../src/main/product-session';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      handlers.set(name, callback);
    },
  },
}));

const csv = 'scene,script,domain\n洁面用量确认,先确认产品版本,product\n';
const aftersaleCsv = 'scene,script,domain\n过敏安抚,先停用并观察,aftersale\n';
const productBinding = { domain: 'product' as const, source_version_id: 'srcv_product_v1' };

function fakeSession(role: 'agent' | 'coach' | 'owner' | null, signedIn = true): Pick<ProductSession, 'view' | 'request'> {
  return {
    view: () => ({
      ok: true,
      enabled: true,
      signedIn,
      sessionEpoch: 1,
      userId: signedIn ? 'usr_synthetic' : null,
      role,
      authMode: signedIn ? 'mock' : null,
      expiresAt: signedIn ? new Date(Date.now() + 60_000).toISOString() : null,
      displayName: signedIn ? 'synthetic' : null,
    }),
    request: vi.fn(),
  };
}

function publishPayload(csvText = csv, bindings: typeof productBinding[] = []) {
  return {
    sourceName: 'draft.csv',
    csvText,
    rows: csvText.includes('aftersale')
      ? [{ scene: '过敏安抚', script: '先停用并观察', domain: 'aftersale' as const }]
      : [{ scene: '洁面用量确认', script: '先确认产品版本', domain: 'product' as const }],
    title: '工作台草稿',
    summary: null,
    sourceBindings: bindings,
  };
}

it('projects session without credentials and fail-closes unsigned dashboard senders', async () => {
  const frame = { parent: null };
  const dashboard = {
    id: 10,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
    mainFrame: frame,
  } as unknown as WebContents;
  const query = { ...dashboard, id: 1 } as WebContents;
  const session = fakeSession('owner');
  registerDashboardContentIpc(session as ProductSession, () => dashboard, () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  const status = handlers.get(IPC_CHANNELS.DASHBOARD_CONTENT_SESSION)!;
  expect(await status(event(query))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await status(event(dashboard), { extra: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
  const view = await status(event(dashboard));
  expect(view).toEqual({ ok: true, enabled: true, signedIn: true, role: 'owner' });
  expect(JSON.stringify(view)).not.toContain('usr_synthetic');
  expect(JSON.stringify(view)).not.toContain('access_token');
});

it('blocks agent publish and coach aftersale before any product HTTP', async () => {
  const agent = fakeSession('agent');
  const coach = fakeSession('coach');
  expect(await dashboardContentPublish(agent, publishPayload())).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
    message: CONTENT_PUBLISH_COPY.agent,
  });
  expect(agent.request).not.toHaveBeenCalled();
  expect(await dashboardContentPublish(coach, publishPayload(aftersaleCsv))).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
    message: CONTENT_PUBLISH_COPY.sensitive,
  });
  expect(coach.request).not.toHaveBeenCalled();
  expect(await dashboardContentPublish(null, publishPayload())).toMatchObject({
    ok: false,
    code: 'UNAVAILABLE',
    message: CONTENT_PUBLISH_COPY.noProduct,
  });
});

it('does not invent source bindings and never returns a fake success', async () => {
  const owner = fakeSession('owner');
  expect(dashboardContentSession(null)).toEqual({
    ok: true, enabled: false, signedIn: false, role: null,
  });
  expect(await dashboardContentImport(owner, {
    sourceName: 'draft.csv',
    csvText: csv,
    sourceBindings: [],
  })).toMatchObject({
    ok: false,
    code: 'VALIDATION',
    message: CONTENT_PUBLISH_COPY.missingBindings,
  });
  expect(owner.request).not.toHaveBeenCalled();
  expect(await dashboardContentPublish(owner, publishPayload(csv, []))).toMatchObject({
    ok: false,
    code: 'VALIDATION',
    message: CONTENT_PUBLISH_COPY.missingBindings,
  });
  expect(owner.request).not.toHaveBeenCalled();
});

it('imports and publishes with the product token when the role gate and bindings pass', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request)
    .mockResolvedValueOnce({
      status: 202,
      value: { import_batch_id: 'imp_owner_1', status: 'validating', source_binding_hash: 'a'.repeat(64) },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: { import_batch_id: 'imp_owner_1', status: 'staged' },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: { release_id: 'rel_1', release_seq: 2, announcement_id: 'ann_1', source_binding_hash: 'a'.repeat(64) },
    });
  const published = await dashboardContentPublish(owner, publishPayload(csv, [productBinding]));
  expect(published).toEqual({ ok: true, releaseId: 'rel_1', releaseSeq: 2 });
  expect(owner.request).toHaveBeenCalledTimes(3);
  expect(vi.mocked(owner.request).mock.calls[0]?.[1]).toBe('/v1/content/import');
  expect(vi.mocked(owner.request).mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 30_000 });
  expect(vi.mocked(owner.request).mock.calls[0]?.[2]?.form).toBeInstanceOf(FormData);
  expect(vi.mocked(owner.request).mock.calls[1]?.[1]).toBe('/v1/content/import/imp_owner_1');
  expect(vi.mocked(owner.request).mock.calls[2]?.[1]).toBe('/v1/content/publish');
  expect(vi.mocked(owner.request).mock.calls[2]?.[2]?.body).toMatchObject({
    import_batch_id: 'imp_owner_1',
    title: '工作台草稿',
    summary: null,
  });
  expect(JSON.stringify(published)).not.toContain('Bearer');
});

it('still returns the release when post-publish hydrate refresh throws', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request)
    .mockResolvedValueOnce({
      status: 202,
      value: { import_batch_id: 'imp_owner_2', status: 'validating', source_binding_hash: 'a'.repeat(64) },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: { import_batch_id: 'imp_owner_2', status: 'staged' },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: { release_id: 'rel_2', release_seq: 3, announcement_id: 'ann_2', source_binding_hash: 'a'.repeat(64) },
    });
  const afterPublish = vi.fn(async () => {
    throw new Error('announce down');
  });
  const published = await dashboardContentPublish(owner, publishPayload(csv, [productBinding]), afterPublish);
  expect(published).toEqual({ ok: true, releaseId: 'rel_2', releaseSeq: 3 });
  expect(afterPublish).toHaveBeenCalledWith(1);
});

it('lets coach import then surfaces owner-only FORBIDDEN without faking a release', async () => {
  const coach = fakeSession('coach');
  vi.mocked(coach.request)
    .mockResolvedValueOnce({
      status: 202,
      value: { import_batch_id: 'imp_coach_1', status: 'validating', source_binding_hash: 'a'.repeat(64) },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: { import_batch_id: 'imp_coach_1', status: 'staged' },
    })
    .mockRejectedValueOnce(new ProductHttpError('FORBIDDEN'));
  const result = await dashboardContentPublish(coach, publishPayload(csv, [productBinding]));
  expect(result).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
    message: CONTENT_PUBLISH_COPY.ownerPublish,
  });
  expect(coach.request).toHaveBeenCalledTimes(3);
});

it('does not publish when import validation fails', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request)
    .mockResolvedValueOnce({
      status: 202,
      value: { import_batch_id: 'imp_owner_fail', status: 'validating', source_binding_hash: 'a'.repeat(64) },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: { import_batch_id: 'imp_owner_fail', status: 'failed' },
    });
  const result = await dashboardContentPublish(owner, publishPayload(csv, [productBinding]));
  expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(owner.request).toHaveBeenCalledTimes(2);
  expect(vi.mocked(owner.request).mock.calls.some((call) => call[1] === '/v1/content/publish')).toBe(false);
});
