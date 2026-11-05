// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { PageUseReader, sopUseFromCatalog } from '../../src/main/page-use';
import { ProductHttpError } from '../../src/main/product-http';
import type { ProductSession } from '../../src/main/product-session';
import {
  canManageAccounts,
  canOpenSettings,
  canViewGrantSettings,
  grantUse,
  isPageUseSnapshot,
  type AccountsUse,
  type PageUseSnapshot,
  type PermissionsUse,
  type SopUse,
} from '../../src/shared/page-use';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function ready(grants: PermissionsUse, accounts: AccountsUse, sop: SopUse): PageUseSnapshot {
  return {
    phase: 'ready',
    epoch: 1,
    settings: { accessRevision: 1, expiresAt: '2026-11-05T11:00:00Z', grants, accounts },
    sop,
  };
}

it('rejects a closed catalog that still carries nodes', () => {
  expect(isPageUseSnapshot({
    phase: 'ready',
    epoch: 1,
    settings: {
      accessRevision: 1,
      expiresAt: '2026-11-05T11:00:00Z',
      grants: { state: 'closed', recovery: null },
      accounts: 'closed',
    },
    sop: { state: 'closed', nodes: [{ nodeId: 'n1' }] },
  })).toBe(false);
  expect(isPageUseSnapshot({
    phase: 'ready',
    epoch: 1,
    settings: {
      accessRevision: 1,
      expiresAt: '2026-11-05T11:00:00Z',
      grants: { state: 'closed', recovery: null },
      accounts: 'closed',
    },
    sop: { state: 'closed' },
  })).toBe(true);
});

const closedReady = {
  phase: 'ready',
  epoch: 1,
  settings: {
    accessRevision: 1,
    expiresAt: '2026-11-05T11:00:00Z',
    grants: { state: 'closed', recovery: null },
    accounts: 'closed',
  },
  sop: { state: 'closed' },
};

function preloadPageUseSnapshot(): (value: unknown) => boolean {
  const source = readFileSync(path.join(desktopRoot, 'src/preload/dashboard.ts'), 'utf8');
  const isRecord = source.slice(source.indexOf('function isRecord'), source.indexOf('function asSopOpen'));
  const pageUse = source.slice(source.indexOf('function onlyKeys'), source.indexOf('const SIGNED_OUT'));
  const javascript = `${isRecord}\n${pageUse}`
    .replace(
      'function isRecord(value: unknown): value is Record<string, unknown>',
      'function isRecord(value)',
    )
    .replace(
      'function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean',
      'function onlyKeys(value, allowed)',
    )
    .replace(
      'function grantsPayload(grants: Record<string, unknown>): boolean',
      'function grantsPayload(grants)',
    )
    .replace(
      'function accountsPayload(value: unknown): boolean',
      'function accountsPayload(value)',
    )
    .replace(
      'function settingsPayload(settings: Record<string, unknown>): boolean',
      'function settingsPayload(settings)',
    )
    .replace(
      'function sopPayload(sop: Record<string, unknown>): boolean',
      'function sopPayload(sop)',
    )
    .replace(
      'function pageUseSnapshot(value: unknown): value is DashboardPageSnapshot',
      'function pageUseSnapshot(value)',
    );
  return new Function(`${javascript}\nreturn pageUseSnapshot;`)() as (value: unknown) => boolean;
}

it('rejects a closed page that still carries settings, people, grants, seats, or step text', () => {
  const leaked = [
    { ...closedReady, settings: { ...closedReady.settings, people: [] } },
    { ...closedReady, settings: { ...closedReady.settings, grants: { state: 'closed', recovery: null, grants: [] } } },
    { ...closedReady, settings: { grants: { state: 'closed', recovery: null }, accounts: 'maybe' } },
    { ...closedReady, permissions: { state: 'closed', recovery: null } },
    { ...closedReady, sop: { state: 'closed', body: 'step text' } },
    { ...closedReady, body: 'step text' },
    { ...closedReady, people: [] },
  ];
  const accept = preloadPageUseSnapshot();
  for (const value of leaked) {
    expect(isPageUseSnapshot(value)).toBe(false);
    expect(accept(value)).toBe(false);
  }
  expect(isPageUseSnapshot(closedReady)).toBe(true);
  expect(accept(closedReady)).toBe(true);
});

it('keeps account administration independent from grantable actions', () => {
  const reviewOnly = ready(grantUse([{ mayAllocate: ['review'] }], null) as PermissionsUse, 'open', { state: 'pending' });
  expect(canOpenSettings(reviewOnly)).toBe(true);
  expect(canViewGrantSettings(reviewOnly)).toBe(false);
  expect(canManageAccounts(reviewOnly)).toBe(true);

  const grantOnly = ready({ state: 'open', body: null }, 'closed', { state: 'pending' });
  expect(canOpenSettings(grantOnly)).toBe(true);
  expect(canViewGrantSettings(grantOnly)).toBe(true);
  expect(canManageAccounts(grantOnly)).toBe(false);

  const neither = ready({ state: 'closed', recovery: null }, 'closed', { state: 'pending' });
  expect(canOpenSettings(neither)).toBe(false);
});

it('keeps recovery copy in the closed model without making Settings reachable', () => {
  expect(canOpenSettings(ready(
    { state: 'closed', recovery: '没有权限，请找人开通。' },
    'closed',
    { state: 'closed' },
  ))).toBe(false);
  expect(canOpenSettings(ready(
    { state: 'closed', recovery: null },
    'closed',
    { state: 'closed' },
  ))).toBe(false);
});

it('opens grant settings when mayAllocate contains a supported grant action', () => {
  for (const action of ['query', 'publish', 'rollback'] as const) {
    const opened = grantUse([{ mayAllocate: ['review', action] }], null);
    expect(opened.state).toBe('open');
    const snapshot = ready({ state: 'open', body: null }, 'closed', { state: 'pending' });
    expect(canOpenSettings(snapshot)).toBe(true);
    expect(canViewGrantSettings(snapshot)).toBe(true);
  }
  const empty = grantUse([{ mayAllocate: [] }], null);
  expect(canOpenSettings(ready(
    empty.state === 'open' ? { state: 'open', body: null } : empty,
    'closed',
    { state: 'pending' },
  ))).toBe(false);
});

it('cannot read nodes from a FORBIDDEN catalog outcome', () => {
  const closed = sopUseFromCatalog({ kind: 'forbidden' });
  expect(closed).toEqual({ state: 'closed' });
  expect(Object.hasOwn(closed, 'nodes')).toBe(false);

  const opened = sopUseFromCatalog({
    kind: 'ok',
    value: {
      product_session_id: 'default',
      items: [{
        node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手',
        sort_key: 0, version: 1, lifecycle: 'active',
      }],
    },
  });
  expect(opened).toMatchObject({ state: 'open', nodes: [{ nodeId: 'n1', title: '停手' }] });
  expect(sopUseFromCatalog({ kind: 'ok', value: { items: 'nope' } })).toEqual({ state: 'unavailable' });
});

it('keeps page-use channel literals identical in main and the dashboard preload', () => {
  const main = readFileSync(path.join(desktopRoot, 'src/main/page-use.ts'), 'utf8');
  const preload = readFileSync(path.join(desktopRoot, 'src/preload/dashboard.ts'), 'utf8');
  expect(main).toContain("'dashboard:page-use-current'");
  expect(preload).toContain("'dashboard:page-use-current'");
  expect(main).toContain("'dashboard:page-use-changed'");
  expect(preload).toContain("'dashboard:page-use-changed'");
  expect(preload).not.toContain('ipc-channels');
});

it('does not write the previous person lists after the session epoch changes', async () => {
  const fixture = intakePermissionsData(['query']);
  let epoch = 1;
  const signedIn = true;
  let settingsCount = 0;
  let releaseHold: () => void = () => undefined;
  let hold = Promise.resolve();
  const listeners = new Set<() => void>();
  const original = fixture.session.request.bind(fixture.session);
  const session = {
    view: () => ({ signedIn, sessionEpoch: epoch }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    request: async (requestEpoch: number, requestPath: string, options: { body?: unknown; signal: AbortSignal; maxResponseBytes?: number }) => {
      if (requestPath.startsWith('/v1/sop/catalog')) throw new ProductHttpError('FORBIDDEN');
      if (requestPath === '/v1/access/settings') {
        settingsCount += 1;
        if (settingsCount >= 3) await hold;
      }
      return original(requestEpoch, requestPath, options);
    },
  };
  const permissions = new ContentIntakePermissions(session);
  const reader = new PageUseReader(session as unknown as ProductSession, permissions);
  try {
    await vi.waitFor(() => {
      const snap = reader.current();
      if (snap.phase !== 'ready'
        || snap.settings.grants.state === 'pending'
        || snap.settings.accounts === 'pending'
        || snap.sop.state === 'pending') {
        throw new Error('still warming');
      }
    });
    expect(reader.current()).toMatchObject({
      phase: 'ready',
      settings: {
        grants: { state: 'open', body: null },
        accounts: 'closed',
      },
      sop: { state: 'closed' },
    });
    expect(Object.hasOwn(reader.current().phase === 'ready' ? reader.current() : {}, 'sop')).toBe(true);
    const warmed = reader.current();
    if (warmed.phase === 'ready') expect(Object.hasOwn(warmed.sop, 'nodes')).toBe(false);

    hold = new Promise((resolve) => { releaseHold = resolve; });
    const refresh = reader.refreshPermissions(epoch);
    await vi.waitFor(() => {
      expect(permissions.view().people.some((person) => person.label === '合成坐席')).toBe(true);
      expect(settingsCount).toBeGreaterThanOrEqual(3);
    });
    epoch += 1;
    for (const listener of listeners) listener();
    releaseHold();
    await refresh;
    const snap = reader.current();
    expect(JSON.stringify(snap)).not.toContain('合成坐席');
    expect(snap.phase === 'ready' && snap.settings.grants.state === 'open'
      ? snap.settings.grants.body
      : null).toBeNull();
  } finally {
    releaseHold();
    reader.dispose();
  }
});

it('opens account-only settings for a server-confirmed seat administrator without loading grant lists', async () => {
  const fixture = intakePermissionsData([], { canManageSeats: true });
  const permissions = new ContentIntakePermissions(fixture.session);
  const reader = new PageUseReader(fixture.session as unknown as ProductSession, permissions);
  try {
    await vi.waitFor(() => {
      const current = reader.current();
      if (current.phase !== 'ready'
        || current.settings.grants.state === 'pending'
        || current.settings.accounts === 'pending') {
        throw new Error('still warming');
      }
    });
    const current = reader.current();
    expect(current).toMatchObject({
      phase: 'ready',
      settings: {
        grants: { state: 'closed', recovery: null },
        accounts: 'open',
      },
    });
    expect(canOpenSettings(current)).toBe(true);
    expect(canViewGrantSettings(current)).toBe(false);
    expect(canManageAccounts(current)).toBe(true);
    expect(fixture.requests.map((request) => request.path)).toContain('/v1/access/settings');
    expect(fixture.requests.some((request) => request.path.startsWith('/v1/intake/sources?'))).toBe(false);
    expect(fixture.requests.some((request) => request.path.startsWith('/v1/intake/principals?'))).toBe(false);
  } finally {
    reader.dispose();
  }
});

it('drops loaded grant lists when a second settings read advances access revision', async () => {
  const fixture = intakePermissionsData(['query']);
  let revision = 1;
  const original = fixture.session.request.bind(fixture.session);
  const session = {
    ...fixture.session,
    request: async (epoch: number, requestPath: string, options: Parameters<typeof original>[2]) => {
      const response = await original(epoch, requestPath, options);
      if (requestPath !== '/v1/access/settings') return response;
      revision += 1;
      return {
        ...response,
        value: { ...(response.value as Record<string, unknown>), accessRevision: revision },
      };
    },
  };
  const permissions = new ContentIntakePermissions(session);
  const reader = new PageUseReader(session as unknown as ProductSession, permissions);
  try {
    await vi.waitFor(() => {
      const current = reader.current();
      if (current.phase !== 'ready' || current.settings.grants.state === 'pending') {
        throw new Error('still warming');
      }
    });
    const result = await reader.refreshPermissions(1);
    expect(result.grants).toEqual({ state: 'open', body: null });
    expect(result.accessRevision).toBe(4);
    expect(permissions.view().people).toEqual([]);
  } finally {
    reader.dispose();
  }
});

it('closes an expired settings projection before refreshing it', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
  const fixture = intakePermissionsData(['query']);
  let settingsReads = 0;
  const original = fixture.session.request.bind(fixture.session);
  const session = {
    ...fixture.session,
    request: async (epoch: number, requestPath: string, options: Parameters<typeof original>[2]) => {
      const response = await original(epoch, requestPath, options);
      if (requestPath !== '/v1/access/settings') return response;
      settingsReads += 1;
      return {
        ...response,
        value: {
          ...(response.value as Record<string, unknown>),
          expiresAt: new Date(Date.now() + (settingsReads === 1 ? 1_000 : 60_000)).toISOString(),
        },
      };
    },
  };
  const permissions = new ContentIntakePermissions(session);
  const reader = new PageUseReader(session as unknown as ProductSession, permissions);
  const snapshots: PageUseSnapshot[] = [];
  const unsubscribe = reader.subscribe((snapshot) => snapshots.push(snapshot));
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.current()).toMatchObject({
      phase: 'ready',
      settings: {
        grants: { state: 'open', body: null },
        accounts: 'closed',
      },
    });

    await vi.advanceTimersByTimeAsync(1_001);
    expect(settingsReads).toBeGreaterThanOrEqual(2);
    expect(snapshots.some((snapshot) =>
      snapshot.phase === 'ready'
      && snapshot.settings.grants.state === 'closed'
      && snapshot.settings.grants.recovery === '权限已到期，请重新读取。'
      && snapshot.settings.accounts === 'closed')).toBe(true);
  } finally {
    unsubscribe();
    reader.dispose();
    vi.useRealTimers();
  }
});
