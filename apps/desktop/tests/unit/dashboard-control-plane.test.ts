// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindDashboardOperationSession,
  DashboardControlPlane,
  DashboardOperationStoreError,
  FileDashboardOperationStore,
  MemoryDashboardOperationStore,
  subscribeDashboardReleaseInvalidation,
  type DashboardAccessView,
  type DashboardControlPlaneSession,
  type DashboardDomainOutcome,
  type DashboardOperationContext,
  type DashboardStoredOperation,
} from '../../src/main/dashboard-control-plane';
import type { OperationId } from '../../../../packages/unified-contracts/src/index.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
  }));
});

type SessionView = ReturnType<DashboardControlPlaneSession['view']>;

function signedInView(epoch = 7, userId = 'user-owner'): SessionView {
  return {
    ok: true,
    enabled: true,
    signedIn: true,
    sessionEpoch: epoch,
    userId,
    role: 'owner',
    authMode: 'mock',
    expiresAt: '2026-11-06T00:00:00.000Z',
    displayName: 'Synthetic owner',
    job: null,
  } as SessionView;
}

function fakeSession(initial = signedInView()) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    view: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setView(next: SessionView) {
      current = next;
      for (const listener of listeners) listener();
    },
    request: vi.fn(),
  } satisfies DashboardControlPlaneSession & { setView(view: SessionView): void };
}

function access(overrides: Partial<DashboardAccessView> = {}): DashboardAccessView {
  return {
    sessionEpoch: 7,
    accessRevision: 11,
    expiresAt: '2026-11-05T12:00:00.000Z',
    grants: 'open',
    accounts: 'open',
    denyReason: null,
    ...overrides,
  };
}

function plane(
  session = fakeSession(),
  options: Partial<Omit<ConstructorParameters<typeof DashboardControlPlane>[0], 'session' | 'store'>> = {},
) {
  let sequence = 0;
  return new DashboardControlPlane({
    session,
    store: new MemoryDashboardOperationStore(),
    access: { read: vi.fn(async () => access()) },
    now: () => Date.parse('2026-11-05T08:00:00.000Z'),
    createOperationId: () => `operation-${++sequence}`,
    ...options,
  });
}

function committed(value: unknown, resultRef = 'result-1'): DashboardDomainOutcome<unknown> {
  return { kind: 'committed', result: value, resultRef };
}

describe('DashboardControlPlane lifecycle', () => {
  it('binds domain requests to the operation signal and commit boundary', async () => {
    const source = fakeSession();
    source.request.mockResolvedValue({ value: { ok: true } });
    const controller = new AbortController();
    const beginCommit = vi.fn();
    const client = bindDashboardOperationSession(source, {
      operationId: 'operation-bound' as OperationId,
      signal: controller.signal,
      beginCommit,
      noteDomainRef: vi.fn(),
    });

    await expect(client.request(7, '/v1/sop/import', { method: 'POST' })).resolves.toEqual({
      value: { ok: true },
    });
    expect(beginCommit).toHaveBeenCalledOnce();
    expect(source.request).toHaveBeenCalledWith(7, '/v1/sop/import', {
      method: 'POST',
      signal: controller.signal,
    });

    controller.abort();
    await expect(client.request(7, '/v1/sop/import', { method: 'POST' }))
      .rejects.toBeDefined();
    expect(source.request).toHaveBeenCalledOnce();
  });

  it('projects accepted, running, committed, failed, cancelled, unknown, and expired without actor identity', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const control = plane(fakeSession(), { createOperationId: () => 'operation-running' });
    const running = control.submit({
      domain: 'release',
      command: 'publish',
      expectedVersion: 3,
      intent: { title: 'draft' },
      execute: async () => {
        await gate;
        return committed({ releaseId: 'rel-9' }, 'rel-9');
      },
    });
    await vi.waitFor(() => {
      expect(control.currentSync()[0]?.state).toBe('running');
    });
    const runningView = control.currentSync()[0]!;
    expect(runningView).toMatchObject({
      domain: 'release',
      operationId: 'operation-running',
      command: 'publish',
      state: 'running',
      canCancel: true,
      canRecover: false,
      releaseInvalidationPending: false,
    });
    expect(JSON.stringify(runningView)).not.toContain('user-owner');
    expect(JSON.stringify(runningView)).not.toContain('sessionEpoch');
    finish();
    await expect(running).resolves.toMatchObject({
      reused: false,
      view: { state: 'committed', canCancel: false, canRecover: false },
    });

    const failedPlane = plane();
    const failed = await failedPlane.submit({
      domain: 'permissions',
      command: 'grants-manage',
      intent: { grant: 'grant-1' },
      execute: async () => ({ kind: 'failed', failureCode: 'FORBIDDEN' }),
    });
    expect(failed.view).toMatchObject({ state: 'failed', canCancel: false, canRecover: false });

    const unknownPlane = plane();
    const unknown = await unknownPlane.submit({
      domain: 'accounts',
      command: 'accounts-manage',
      intent: { username: 'seat-a' },
      execute: async () => ({ kind: 'unknown' }),
    });
    expect(unknown.view).toMatchObject({ state: 'unknown', canRecover: true });

    const cancelledPlane = plane();
    const cancelled = await cancelledPlane.submit({
      domain: 'materials',
      command: 'import',
      intent: { file: 'synthetic.csv' },
      execute: async () => ({ kind: 'cancelled' }),
    });
    expect(cancelled.view.state).toBe('cancelled');

    let currentTime = Date.parse('2026-11-05T08:00:00.000Z');
    const expired = new DashboardControlPlane({
      session: fakeSession(),
      store: new MemoryDashboardOperationStore(),
      access: { read: vi.fn(async () => access()) },
      now: () => currentTime,
      createOperationId: () => 'operation-expired',
    });
    await expired.submit({
      domain: 'ops-loop',
      command: 'content-manage',
      recoveryDeadline: '2026-11-05T08:10:00.000Z',
      intent: { task: 'synthetic-1' },
      execute: async () => ({ kind: 'unknown' }),
    });
    expired.registerRecovery('ops-loop', async () => ({ kind: 'not-found' }));
    currentTime = Date.parse('2026-11-05T08:11:00.000Z');
    await expect(expired.recover('ops-loop')).resolves.toMatchObject({ state: 'expired' });
  });

  it('replays an identical submit with the original receipt and runs one effect', async () => {
    let count = 0;
    const control = plane();
    const input = {
      domain: 'release' as const,
      command: 'publish' as const,
      expectedVersion: 2,
      intent: { title: 'same' },
      execute: async () => {
        count += 1;
        return committed({ releaseId: 'rel-2' }, 'rel-2');
      },
    };
    const first = await control.submit(input);
    const second = await control.submit(input);
    expect(count).toBe(1);
    expect(second.reused).toBe(true);
    expect(second.view.operationId).toBe(first.view.operationId);
    expect(second.view.state).toBe('committed');
  });

  it('replays after a permission revision change but rejects the same intent after capability loss', async () => {
    let revision = 11;
    let grants: 'open' | 'closed' = 'open';
    let effects = 0;
    const control = new DashboardControlPlane({
      session: fakeSession(),
      store: new MemoryDashboardOperationStore(),
      access: {
        read: async () => access({ accessRevision: revision, grants }),
      },
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
      createOperationId: () => 'operation-revision',
    });
    const input = {
      domain: 'permissions' as const,
      command: 'grants-manage' as const,
      authorize: (view: DashboardAccessView) => view.grants === 'open',
      intent: { grant: 'same-grant' },
      execute: async () => {
        effects += 1;
        return committed({ grant: 'same-grant' });
      },
    };
    await control.submit(input);
    revision = 12;
    await expect(control.submit(input)).resolves.toMatchObject({
      reused: true,
      view: { state: 'committed' },
    });
    expect(effects).toBe(1);
    grants = 'closed';
    await expect(control.submit(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(effects).toBe(1);
  });

  it('keeps identical visible intents distinct when Main-owned domain scope changes', async () => {
    let effects = 0;
    const control = plane();
    const submit = (candidateVersion: number) => control.submit({
      domain: 'materials',
      command: 'review',
      scope: { candidateId: 'candidate-1', version: candidateVersion },
      intent: { action: 'freeze' },
      execute: async () => {
        effects += 1;
        return committed({ version: candidateVersion });
      },
    });
    const first = await submit(1);
    const second = await submit(2);
    expect(effects).toBe(2);
    expect(second.view.operationId).not.toBe(first.view.operationId);
  });

  it('allows an explicit retry after a user-cancelled attempt without creating a duplicate effect', async () => {
    let effects = 0;
    const control = plane();
    const input = {
      domain: 'release' as const,
      command: 'publish' as const,
      intent: { title: 'same publish' },
      execute: async (context: DashboardOperationContext) => {
        effects += 1;
        if (effects === 1) return { kind: 'cancelled' as const };
        context.beginCommit();
        return committed({ releaseId: 'rel-retry' }, 'rel-retry');
      },
    };
    const cancelled = await control.submit(input);
    expect(cancelled.view.state).toBe('cancelled');
    const committedAttempt = await control.submit(input);
    expect(committedAttempt.view.state).toBe('committed');
    expect(committedAttempt.view.operationId).not.toBe(cancelled.view.operationId);
    expect(effects).toBe(2);
  });

  it('keeps a thrown mutation unknown until a durable lookup proves the result', async () => {
    const control = plane();
    const submitted = await control.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'network lost' },
      execute: async () => {
        throw new Error('socket closed after request');
      },
    });
    expect(submitted.view.state).toBe('unknown');
    expect(submitted.view.canRecover).toBe(true);

    control.registerRecovery('release', async () => ({ kind: 'unknown' }));
    await expect(control.recover('release')).resolves.toMatchObject({ state: 'unknown' });

    control.registerRecovery('release', async () => ({
      kind: 'committed',
      resultRef: 'rel-3',
      releaseId: 'rel-3',
    }));
    await expect(control.recover('release')).resolves.toMatchObject({
      state: 'committed',
      canRecover: false,
    });
  });

  it('does not invent success on restart and preserves an unknown durable receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-operation-store-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'operations.json');
    const first = new DashboardControlPlane({
      session: fakeSession(),
      store: new FileDashboardOperationStore(path),
      access: { read: vi.fn(async () => access()) },
      createOperationId: () => 'operation-restart',
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
    });
    await first.submit({
      domain: 'materials',
      command: 'publish',
      intent: { candidate: 'candidate-1' },
      execute: async () => ({ kind: 'unknown' }),
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const second = new DashboardControlPlane({
      session: fakeSession(),
      store: new FileDashboardOperationStore(path),
      access: { read: vi.fn(async () => access()) },
      now: () => Date.parse('2026-11-05T08:01:00.000Z'),
    });
    await second.ready();
    expect(second.currentSync()).toMatchObject([{
      domain: 'materials',
      state: 'unknown',
      canRecover: true,
    }]);
    expect(JSON.parse(await readFile(path, 'utf8')).records[0].status.state).toBe('unknown');
  });

  it('reconciles a running operation left by process death to unknown, not success or failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-operation-running-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'operations.json');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const first = new DashboardControlPlane({
      session: fakeSession(),
      store: new FileDashboardOperationStore(path),
      access: { read: vi.fn(async () => access()) },
      createOperationId: () => 'operation-interrupted',
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
    });
    const running = first.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'interrupted' },
      execute: async () => {
        await gate;
        return committed({ releaseId: 'rel-interrupted' }, 'rel-interrupted');
      },
    });
    await vi.waitFor(() => expect(first.currentSync()[0]?.state).toBe('running'));
    const restarted = new DashboardControlPlane({
      session: fakeSession(),
      store: new FileDashboardOperationStore(path),
      access: { read: vi.fn(async () => access()) },
      now: () => Date.parse('2026-11-05T08:01:00.000Z'),
    });
    await restarted.ready();
    expect(restarted.currentSync()).toMatchObject([{ state: 'unknown', canRecover: true }]);
    finish();
    await running;
    first.dispose();
  });

  it('fails closed when a stored operation is malformed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-operation-bad-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'operations.json');
    await writeFile(path, JSON.stringify({
      version: 1,
      records: [{ envelope: {}, status: {}, domain: 'release', invalidation: 'none' }],
    }));
    const control = new DashboardControlPlane({
      session: fakeSession(),
      store: new FileDashboardOperationStore(path),
      access: { read: vi.fn(async () => access()) },
    });
    await expect(control.ready()).rejects.toBeInstanceOf(DashboardOperationStoreError);
  });

  it('rejects command reuse with a different request, actor, or session epoch', async () => {
    const session = fakeSession();
    const control = new DashboardControlPlane({
      session,
      store: new MemoryDashboardOperationStore(),
      access: {
        read: vi.fn(async () => access({
          sessionEpoch: session.view().sessionEpoch,
        })),
      },
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
      createOperationId: () => 'operation-conflict',
    });
    await control.submit({
      domain: 'release',
      operationId: 'operation-conflict' as OperationId,
      command: 'publish',
      intent: { title: 'one' },
      execute: async () => committed({ releaseId: 'rel-1' }, 'rel-1'),
    });
    await expect(control.submit({
      domain: 'release',
      operationId: 'operation-conflict' as OperationId,
      command: 'publish',
      intent: { title: 'two' },
      execute: async () => committed({ releaseId: 'rel-2' }, 'rel-2'),
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    session.setView(signedInView(8));
    await expect(control.submit({
      domain: 'release',
      operationId: 'operation-conflict' as OperationId,
      command: 'publish',
      intent: { title: 'one' },
      execute: async () => committed({ releaseId: 'rel-3' }, 'rel-3'),
    })).rejects.toMatchObject({ code: 'STALE' });

    session.setView(signedInView(8, 'user-other'));
    await expect(control.submit({
      domain: 'release',
      operationId: 'operation-conflict' as OperationId,
      command: 'publish',
      intent: { title: 'one' },
      execute: async () => committed({ releaseId: 'rel-4' }, 'rel-4'),
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects the same unresolved intent after reconnect instead of starting a second write', async () => {
    const session = fakeSession();
    let accessEpoch = 7;
    let effects = 0;
    const control = new DashboardControlPlane({
      session,
      store: new MemoryDashboardOperationStore(),
      access: {
        read: async () => access({ sessionEpoch: accessEpoch }),
      },
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
      createOperationId: () => `operation-reconnect-${effects + 1}`,
    });
    const input = {
      domain: 'release' as const,
      command: 'publish' as const,
      intent: { title: 'same after reconnect' },
      execute: async () => {
        effects += 1;
        return { kind: 'unknown' as const };
      },
    };
    const first = await control.submit(input);
    expect(first.view.state).toBe('unknown');

    session.setView(signedInView(8));
    accessEpoch = 8;
    await expect(control.submit(input)).rejects.toMatchObject({ code: 'STALE' });
    expect(effects).toBe(1);

    control.registerRecovery('release', async () => ({
      kind: 'committed',
      resultRef: 'rel-reconnected',
      releaseId: 'rel-reconnected',
    }));
    await expect(control.recover('release')).resolves.toMatchObject({
      operationId: first.view.operationId,
      state: 'committed',
    });
    expect(effects).toBe(1);
  });

  it('closes new writes after revocation while an accepted operation can finish', async () => {
    const session = fakeSession();
    let permission: DashboardAccessView = access();
    const control = new DashboardControlPlane({
      session,
      store: new MemoryDashboardOperationStore(),
      access: { read: vi.fn(async () => permission) },
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
      createOperationId: () => 'operation-revoke',
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const accepted = control.submit({
      domain: 'permissions',
      command: 'grants-manage',
      intent: { grant: 'g-1' },
      authorize: (view) => view.grants === 'open',
      execute: async () => {
        await gate;
        return committed({ grant: 'g-1' }, 'g-1');
      },
    });
    await vi.waitFor(() => expect(control.currentSync()[0]?.state).toBe('running'));
    permission = access({ accessRevision: 12, grants: 'closed', accounts: 'closed' });
    await expect(control.submit({
      domain: 'permissions',
      command: 'grants-manage',
      intent: { grant: 'g-2' },
      authorize: (view) => view.grants === 'open',
      execute: async () => committed({ grant: 'g-2' }, 'g-2'),
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    release();
    await expect(accepted).resolves.toMatchObject({ view: { state: 'committed' } });
  });

  it('cancels queued work before commit and cannot rewrite a committed receipt', async () => {
    const control = plane();
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
    const first = control.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'first' },
      execute: async () => {
        await firstGate;
        return committed({ releaseId: 'rel-1' }, 'rel-1');
      },
    });
    await vi.waitFor(() => expect(control.currentSync()[0]?.state).toBe('running'));

    const secondEffect = vi.fn();
    const second = control.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'second' },
      execute: async () => {
        secondEffect();
        return committed({ releaseId: 'rel-2' }, 'rel-2');
      },
    });
    await vi.waitFor(() => expect(control.currentSync().some((view) => view.state === 'accepted')).toBe(true));
    await control.cancel('release');
    finishFirst();
    await first;
    await expect(second).resolves.toMatchObject({ view: { state: 'cancelled' } });
    expect(secondEffect).not.toHaveBeenCalled();

    const third = await control.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'third' },
      execute: async (context) => {
        context.beginCommit();
        await control.cancel('release');
        return committed({ releaseId: 'rel-3' }, 'rel-3');
      },
    });
    expect(third.view.state).toBe('committed');
  });

  it('can cancel while the running transition is still being persisted', async () => {
    const memory = new MemoryDashboardOperationStore();
    let releaseRunningWrite!: () => void;
    let noteRunningWrite!: () => void;
    const runningWrite = new Promise<void>((resolve) => { noteRunningWrite = resolve; });
    const runningWriteGate = new Promise<void>((resolve) => { releaseRunningWrite = resolve; });
    let writes = 0;
    const store = {
      read: memory.read.bind(memory),
      async write(records: readonly DashboardStoredOperation[]) {
        writes += 1;
        if (writes === 2) {
          noteRunningWrite();
          await runningWriteGate;
        }
        await memory.write(records);
      },
    };
    const control = new DashboardControlPlane({
      session: fakeSession(),
      store,
      access: { read: vi.fn(async () => access()) },
      createOperationId: () => 'operation-running-persist',
      now: () => Date.parse('2026-11-05T08:00:00.000Z'),
    });
    const effect = vi.fn();
    const submitted = control.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'cancel while persisting' },
      execute: async (context) => {
        if (context.signal.aborted) return { kind: 'cancelled' as const };
        effect();
        return committed({ releaseId: 'rel-should-not-exist' }, 'rel-should-not-exist');
      },
    });

    await runningWrite;
    await control.cancel('release');
    releaseRunningWrite();
    await expect(submitted).resolves.toMatchObject({ view: { state: 'cancelled' } });
    expect(effect).not.toHaveBeenCalled();
  });

  it('emits one release invalidation and retries a failed invalidation without re-running the mutation', async () => {
    let attempts = 0;
    let effects = 0;
    const releaseInvalidation = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    });
    const control = plane(fakeSession(), {
      releaseInvalidation,
      createOperationId: () => 'operation-publish',
    });
    const submitted = await control.submit({
      domain: 'release',
      command: 'publish',
      intent: { title: 'network publish' },
      execute: async () => {
        effects += 1;
        return {
          kind: 'committed',
          result: { releaseId: 'rel-7' },
          resultRef: 'rel-7',
          releaseId: 'rel-7',
        };
      },
    });
    expect(submitted.view).toMatchObject({
      state: 'committed',
      releaseInvalidationPending: true,
    });
    await control.retryReleaseInvalidation('operation-publish');
    expect(releaseInvalidation).toHaveBeenCalledTimes(2);
    expect(effects).toBe(1);
    expect(control.currentSync()[0]).toMatchObject({
      state: 'committed',
      releaseInvalidationPending: false,
    });
    await control.retryReleaseInvalidation('operation-publish');
    expect(releaseInvalidation).toHaveBeenCalledTimes(2);
  });

  it('notifies the release-invalidation event once even without a legacy announcer', async () => {
    const listener = vi.fn();
    const stop = subscribeDashboardReleaseInvalidation(listener);
    try {
      const control = plane(fakeSession(), { createOperationId: () => 'operation-event-release' });
      await control.submit({
        domain: 'materials',
        command: 'publish',
        intent: { candidate: 'candidate-event' },
        execute: async () => ({
          kind: 'committed',
          resultRef: 'rel-event',
          releaseId: 'rel-event',
        }),
      });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        domain: 'materials',
        releaseId: 'rel-event',
        sessionEpoch: 7,
      }));
      await control.retryReleaseInvalidation('operation-event-release');
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });
});
