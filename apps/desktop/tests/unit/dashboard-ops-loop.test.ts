// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerDashboardOpsLoopIpc } from '../../src/main/dashboard-ops-loop-ipc';
import {
  dashboardRetrievalMetrics,
  dashboardScriptDelete,
  dashboardSoftwareCatalog,
  dashboardSopCatalog,
  dashboardSopImport,
  dashboardSopPatch,
} from '../../src/main/dashboard-ops-loop';
import { OPS_LOOP_COPY } from '../../src/shared/dashboard-ops-loop';
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

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/main/dashboard-ops-loop.ts',
);

const release = Object.freeze({
  version: '0.3.17',
  platform: 'mac-universal' as const,
  sha256: 'a'.repeat(64),
  download_url: 'https://example.com/app.dmg',
  created_at: '2026-09-21T00:00:00.000Z',
  signed: false,
});

const sopNode = Object.freeze({
  node_id: 'n1',
  parent_node_id: null,
  title: '停手',
  body: '先停手',
  sort_key: 0,
  version: 1,
  lifecycle: 'active' as const,
});

function fakeSession(
  role: 'agent' | 'coach' | 'owner' | null,
  signedIn = true,
  enabled = true,
): Pick<ProductSession, 'view' | 'request'> {
  return {
    view: () => ({
      ok: true,
      enabled,
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

function trustedDashboard() {
  const frame = { parent: null };
  const dashboard = {
    id: 10,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
    mainFrame: frame,
  } as unknown as WebContents;
  const query = { ...dashboard, id: 1 } as WebContents;
  const event = (sender: WebContents, senderFrame: unknown = frame) => (
    { sender, senderFrame } as IpcMainInvokeEvent
  );
  return { dashboard, query, event };
}

it('fail-closes unsigned dashboard senders and extra IPC args', async () => {
  const { dashboard, query, event } = trustedDashboard();
  const session = fakeSession('owner');
  registerDashboardOpsLoopIpc(session as ProductSession, () => dashboard, () => 'http://127.0.0.1:5173/');
  const catalog = handlers.get(IPC_CHANNELS.DASHBOARD_OPS_SOP_CATALOG)!;
  expect(await catalog(event(query))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await catalog(event(dashboard), { extra: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(session.request).not.toHaveBeenCalled();

  vi.mocked(session.request).mockResolvedValueOnce({
    status: 200,
    value: { product_session_id: 'default', items: [] },
  });
  const view = await catalog(event(dashboard));
  expect(view).toEqual({
    ok: true, productSessionId: 'default', items: [],
  });
  expect(JSON.stringify(view)).not.toContain('usr_synthetic');

  registerDashboardOpsLoopIpc(session as ProductSession, () => null, () => 'http://127.0.0.1:5173/');
  expect(await handlers.get(IPC_CHANNELS.DASHBOARD_OPS_SOP_CATALOG)!(event(dashboard)))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
});

it('blocks agent SOP writes and coach software before any product HTTP', async () => {
  const agent = fakeSession('agent');
  expect(await dashboardSopCatalog(agent)).toMatchObject({
    ok: false, code: 'FORBIDDEN', message: OPS_LOOP_COPY.forbidden,
  });
  expect(await dashboardSopImport(agent, 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停,0\n'))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(agent.request).not.toHaveBeenCalled();

  const coach = fakeSession('coach');
  expect(await dashboardSoftwareCatalog(coach)).toMatchObject({
    ok: false, code: 'FORBIDDEN', message: OPS_LOOP_COPY.forbidden,
  });
  expect(await dashboardScriptDelete(coach, { scriptId: 'script-1', expectedVersion: 1 }))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(coach.request).not.toHaveBeenCalled();

  expect(await dashboardSopCatalog(null)).toMatchObject({
    ok: false, code: 'UNAVAILABLE', message: OPS_LOOP_COPY.noProduct,
  });
  expect(await dashboardSopImport(fakeSession('owner'), '   ')).toMatchObject({
    ok: false, code: 'VALIDATION',
  });
  expect(await dashboardSopPatch(fakeSession('owner'), { nodeId: 'n1' })).toMatchObject({
    ok: false, code: 'VALIDATION',
  });
});

it('keeps GONE software current as empty current and never mentions latest.yml', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request)
    .mockResolvedValueOnce({ status: 200, value: { items: [release] } })
    .mockRejectedValueOnce(new ProductHttpError('GONE'));
  const catalog = await dashboardSoftwareCatalog(owner);
  expect(catalog).toMatchObject({
    ok: true,
    current: null,
    items: [{ version: '0.3.17', downloadUrl: 'https://example.com/app.dmg', signed: false }],
  });
  expect(vi.mocked(owner.request).mock.calls[0]?.[1]).toBe('/v1/software/releases');
  expect(vi.mocked(owner.request).mock.calls[1]?.[1]).toBe('/v1/software/releases/current');
  expect(JSON.stringify(catalog)).not.toContain('latest.yml');
  expect(readFileSync(sourcePath, 'utf8')).not.toContain('latest.yml');
});

it('imports SOP against default session and keeps script mutate in pending_review', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request)
    .mockResolvedValueOnce({
      status: 202,
      value: { ok: true, product_session_id: 'default', node_count: 1 },
    })
    .mockResolvedValueOnce({ status: 200, value: sopNode })
    .mockResolvedValueOnce({
      status: 200,
      value: {
        ok: true, script_id: 'script-1', mutation_id: 'smut_1', review_status: 'pending_review',
      },
    });
  expect(await dashboardSopImport(owner, 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\n'))
    .toEqual({ ok: true, productSessionId: 'default', nodeCount: 1 });
  expect(vi.mocked(owner.request).mock.calls[0]?.[1]).toBe('/v1/sop/import');
  expect(vi.mocked(owner.request).mock.calls[0]?.[2]?.headers?.['idempotency-key']).toEqual(expect.any(String));

  expect(await dashboardSopPatch(owner, { nodeId: 'n1', expectedVersion: 1, title: '停手' }))
    .toMatchObject({ nodeId: 'n1', version: 1, lifecycle: 'active' });
  expect(vi.mocked(owner.request).mock.calls[1]?.[1]).toBe('/v1/sop/nodes/n1');
  expect(vi.mocked(owner.request).mock.calls[1]?.[2]?.method).toBe('PATCH');

  const deleted = await dashboardScriptDelete(owner, { scriptId: 'script-1', expectedVersion: 1 });
  expect(deleted).toEqual({
    ok: true, scriptId: 'script-1', mutationId: 'smut_1', reviewStatus: 'pending_review',
  });
  expect(vi.mocked(owner.request).mock.calls[2]?.[1]).toBe('/v1/content/scripts/script-1');
  expect(vi.mocked(owner.request).mock.calls[2]?.[2]?.method).toBe('DELETE');
  expect(JSON.stringify(deleted)).not.toContain('answer_text');
});

it('requests last_7d retrieval metrics through product HTTP and IPC', async () => {
  const coach = fakeSession('coach');
  vi.mocked(coach.request).mockResolvedValueOnce({
    status: 200,
    value: {
      no_hit_rate: 0.25,
      copy_complete_rate: 0.5,
      open_task_count: 3,
      current_release_script_count: 12,
      window: 'last_7d',
      release_id: 'rel_7',
    },
  });
  expect(await dashboardRetrievalMetrics(coach, 'last_7d')).toEqual({
    ok: true,
    noHitRate: 0.25,
    copyCompleteRate: 0.5,
    openTaskCount: 3,
    currentReleaseScriptCount: 12,
    window: 'last_7d',
    releaseId: 'rel_7',
  });
  expect(vi.mocked(coach.request).mock.calls[0]?.[1]).toBe('/v1/metrics/retrieval?window=last_7d');

  const { dashboard, event } = trustedDashboard();
  const session = fakeSession('owner');
  registerDashboardOpsLoopIpc(session as ProductSession, () => dashboard, () => 'http://127.0.0.1:5173/');
  vi.mocked(session.request).mockResolvedValueOnce({
    status: 200,
    value: {
      no_hit_rate: 0.1,
      copy_complete_rate: 0.2,
      open_task_count: 1,
      current_release_script_count: 8,
      window: 'last_7d',
      release_id: null,
    },
  });
  const retrieval = handlers.get(IPC_CHANNELS.DASHBOARD_OPS_RETRIEVAL)!;
  expect(await retrieval(event(dashboard), 'last_7d')).toMatchObject({
    ok: true, window: 'last_7d', noHitRate: 0.1, releaseId: null,
  });
  expect(vi.mocked(session.request).mock.calls[0]?.[1]).toBe('/v1/metrics/retrieval?window=last_7d');
  expect(await retrieval(event(dashboard), 'all_time')).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(vi.mocked(session.request).mock.calls).toHaveLength(1);
});

it('maps software list 404 to NOT_FOUND for the whole catalog', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request).mockRejectedValue(new ProductHttpError('GONE'));
  const catalog = await dashboardSoftwareCatalog(owner);
  expect(catalog).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(vi.mocked(owner.request).mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(vi.mocked(owner.request).mock.calls[0]?.[1]).toBe('/v1/software/releases');
  expect(JSON.stringify(catalog)).not.toContain('latest.yml');
});
