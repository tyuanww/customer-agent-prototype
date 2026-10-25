// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { PageUseReader, sopUseFromCatalog } from '../../src/main/page-use';
import { ProductHttpError } from '../../src/main/product-http';
import type { ProductSession } from '../../src/main/product-session';
import { canGrant, canOpenPermissions, grantUse, isPageUseSnapshot, type PageUseSnapshot, type PermissionsUse, type SopUse } from '../../src/shared/page-use';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function ready(permissions: PermissionsUse, sop: SopUse): PageUseSnapshot {
  return { phase: 'ready', epoch: 1, permissions, sop };
}

it('rejects a closed catalog that still carries nodes', () => {
  expect(isPageUseSnapshot({
    phase: 'ready',
    epoch: 1,
    permissions: { state: 'closed', recovery: null },
    sop: { state: 'closed', nodes: [{ nodeId: 'n1' }] },
  })).toBe(false);
  expect(isPageUseSnapshot({
    phase: 'ready',
    epoch: 1,
    permissions: { state: 'closed', recovery: null },
    sop: { state: 'closed' },
  })).toBe(true);
});

const closedReady = {
  phase: 'ready',
  epoch: 1,
  permissions: { state: 'closed', recovery: null },
  sop: { state: 'closed' },
};

function preloadPageUseSnapshot(): (value: unknown) => boolean {
  const source = readFileSync(path.join(desktopRoot, 'src/preload/dashboard.ts'), 'utf8');
  const isRecord = source.slice(source.indexOf('function isRecord'), source.indexOf('function asSopOpen'));
  const pageUse = source.slice(source.indexOf('function pageUseSnapshot'), source.indexOf('const SIGNED_OUT'));
  const javascript = `${isRecord}\n${pageUse}`
    .replace(
      'function isRecord(value: unknown): value is Record<string, unknown>',
      'function isRecord(value)',
    )
    .replace(
      'function pageUseSnapshot(value: unknown): value is DashboardPageSnapshot',
      'function pageUseSnapshot(value)',
    );
  return new Function(`${javascript}\nreturn pageUseSnapshot;`)() as (value: unknown) => boolean;
}

it('rejects a closed page that still carries people, grants, seats, or step text', () => {
  const leaked = [
    { ...closedReady, permissions: { state: 'closed', recovery: null, people: [], grants: [], seats: [] } },
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

it('does not open the permissions page for review-only mayAllocate', () => {
  const closed = grantUse([{ mayAllocate: ['review'] }], null);
  const snapshot = ready(closed.state === 'open' ? { state: 'open', body: null } : closed, { state: 'pending' });
  expect(canOpenPermissions(snapshot)).toBe(false);
  expect(canGrant(snapshot)).toBe(canOpenPermissions(snapshot));
  expect(snapshot.phase === 'ready' && snapshot.permissions.state === 'open').toBe(false);
});

it('opens the permissions page when mayAllocate contains a grantable action', () => {
  for (const action of ['query', 'publish', 'rollback'] as const) {
    const opened = grantUse([{ mayAllocate: ['review', action] }], null);
    expect(opened.state).toBe('open');
    const snapshot = ready({ state: 'open', body: null }, { state: 'pending' });
    expect(canOpenPermissions(snapshot)).toBe(true);
    expect(canGrant(snapshot)).toBe(true);
  }
  const empty = grantUse([{ mayAllocate: [] }], null);
  expect(canOpenPermissions(ready(empty.state === 'open' ? { state: 'open', body: null } : empty, { state: 'pending' }))).toBe(false);
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
  let authorizationCount = 0;
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
      if (requestPath.startsWith('/v1/intake/authorization')) {
        authorizationCount += 1;
        if (authorizationCount >= 5) await hold;
      }
      return original(requestEpoch, requestPath, options);
    },
  };
  const permissions = new ContentIntakePermissions(session);
  const reader = new PageUseReader(session as unknown as ProductSession, permissions);
  try {
    await vi.waitFor(() => {
      const snap = reader.current();
      if (snap.phase !== 'ready' || snap.permissions.state === 'pending' || snap.sop.state === 'pending') {
        throw new Error('still warming');
      }
    });
    expect(reader.current()).toMatchObject({
      phase: 'ready',
      permissions: { state: 'open', body: null },
      sop: { state: 'closed' },
    });
    expect(Object.hasOwn(reader.current().phase === 'ready' ? reader.current() : {}, 'sop')).toBe(true);
    const warmed = reader.current();
    if (warmed.phase === 'ready') expect(Object.hasOwn(warmed.sop, 'nodes')).toBe(false);

    hold = new Promise((resolve) => { releaseHold = resolve; });
    const refresh = reader.refreshPermissions(epoch);
    await vi.waitFor(() => {
      expect(permissions.view().people.some((person) => person.label === '合成坐席')).toBe(true);
      expect(authorizationCount).toBeGreaterThanOrEqual(5);
    });
    epoch += 1;
    for (const listener of listeners) listener();
    releaseHold();
    await refresh;
    const snap = reader.current();
    expect(JSON.stringify(snap)).not.toContain('合成坐席');
    expect(snap.phase === 'ready' && snap.permissions.state === 'open' ? snap.permissions.body : null).toBeNull();
  } finally {
    releaseHold();
    reader.dispose();
  }
});
