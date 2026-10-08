import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../src/auth-service.js';
import { assessIntakeRuntimeAssembly, createIntakeRuntimeAssembly } from '../experiments/intake-runtime/assembly.js';
import { createPurposePrivilegeProbe } from '../experiments/intake-runtime/purpose-boundary.js';
import type { IntakePool } from '../src/content-intake/transaction.js';

const SENTINEL = 'SENTINEL_CLAIM_LIST_MUST_NOT_BE_QUERIED';

function client(answer: (sql: string) => Record<string, unknown>) {
  const sqls: string[] = [];
  return {
    sqls,
    async query(sql: string, params?: readonly unknown[]) {
      const text = `${sql} ${JSON.stringify(params ?? [])}`;
      if (text.includes(SENTINEL)) throw new Error('SENTINEL_REACHED_SQL');
      sqls.push(text);
      return { rows: [answer(sql)] };
    },
  };
}

function readyAnswer(sql: string): Record<string, unknown> {
  if (sql.includes('purpose_gap')) return { gap: [] };
  if (sql.includes('content_intake.sources')) return { preview: 1, other: 0 };
  if (sql.includes('pg_roles')) return { rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false };
  if (sql.includes('content_intake.objects')) return { objects: 0 };
  throw new Error(`unexpected sql ${sql}`);
}

function request(overrides: Record<string, unknown> = {}, answer = readyAnswer) {
  const usage = client(answer);
  const business = client(answer);
  const worker = client(answer);
  const organization = client(answer);
  const catalog = client(answer);
  let refreshed = false;
  return {
    usage, business, worker, organization, catalog,
    input: {
      claimManifest: null,
      connections: { usage, business, worker, organization },
      parser: { probe: async () => true },
      organization: { refresh: async () => { refreshed = true; throw new Error('REFRESH_CALLED'); } },
      catalog,
      ...overrides,
    },
    refreshed: () => refreshed,
  };
}

describe('intake runtime assembly candidate without a database', () => {
  it('keeps the existing absent-manifest refusal and does not query a non-null list', async () => {
    const catalog = client(readyAnswer);
    await expect(assessIntakeRuntimeAssembly(catalog, { claimManifest: SENTINEL })).rejects.toMatchObject({ reason: 'CLAIM_LIST_UNUSABLE' });
    expect(catalog.sqls).toEqual([]);
    expect(() => createIntakeRuntimeAssembly({ claimManifest: SENTINEL, approvalTransport: { enabled: true } })).toThrow(/APPROVAL_TRANSPORT_REJECTED/);
    expect(() => createIntakeRuntimeAssembly({ claimManifest: { id: SENTINEL }, connections: {}, parser: {}, organization: {}, catalog })).toThrow(/CLAIM_LIST_UNUSABLE/);
    expect(catalog.sqls).toEqual([]);
  });

  it('refuses a missing parser, organization dependency, failed probe, cancel and close before adoption', async () => {
    const base = request();
    expect(() => createIntakeRuntimeAssembly({ ...base.input, parser: {} })).toThrow(/PARSER_UNAVAILABLE/);
    expect(() => createIntakeRuntimeAssembly({ ...base.input, organization: {} })).toThrow(/ORGANIZATION_DEPENDENCY_MISSING/);
    const idle = createIntakeRuntimeAssembly({ ...base.input, parser: { probe: async () => false } });
    await expect(idle.start()).rejects.toMatchObject({ reason: 'PARSER_UNAVAILABLE' });
    expect(base.refreshed()).toBe(false);
    let opened: () => void = () => undefined;
    const openedGate = new Promise<void>(resolve => { opened = resolve; });
    const waiting = createIntakeRuntimeAssembly({
      ...base.input,
      parser: { probe: (signal: AbortSignal) => new Promise((_resolve, reject) => {
        opened();
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }) },
    });
    const pending = waiting.start();
    await openedGate;
    waiting.cancel();
    await expect(pending).rejects.toMatchObject({ reason: 'CANCELLED' });
    waiting.close();
    await expect(waiting.start()).rejects.toMatchObject({ reason: 'CLOSED' });
    expect(() => waiting.adoptLegacy()).toThrow(/LEGACY_ADOPTION_REFUSED/);
    expect(base.usage.sqls).toEqual([]);
  });

  it('starts only when every purpose gap is empty and an empty catalog is not adoption', async () => {
    const fixture = request();
    const assembly = createIntakeRuntimeAssembly(fixture.input);
    await expect(assembly.start()).resolves.toEqual({
      state: 'checked-not-activated', ready: false, legacyAdopted: false, reason: 'CLAIM_MANIFEST_ABSENT', catalogObjects: 0, claimManifest: null,
    });
    expect(fixture.refreshed()).toBe(false);
    expect(() => assembly.adoptLegacy()).toThrow(/LEGACY_ADOPTION_REFUSED/);
    const legacy = request({}, sql => sql.includes('content_intake.sources') ? { preview: 0, other: 1 } : readyAnswer(sql));
    await expect(createIntakeRuntimeAssembly(legacy.input).start()).rejects.toMatchObject({ reason: 'SOURCE_MODE_UNUSABLE' });
    const gap = request({}, sql => sql.includes('purpose_gap') ? { gap: ['session_lock'] } : readyAnswer(sql));
    await expect(createIntakeRuntimeAssembly(gap.input).start()).rejects.toMatchObject({ reason: 'PURPOSE_PRIVILEGE_MISSING', gaps: ['session_lock'] });
  });

  it.each(['cancel', 'close'] as const)('refuses %s while a database check is pending', async action => {
    const fixture = request();
    let entered!: () => void;
    let resume!: () => void;
    const checking = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const delayedUsage = { query: async (sql: string, params?: readonly unknown[]) => {
      entered();
      await gate;
      return fixture.usage.query(sql, params);
    } };
    const assembly = createIntakeRuntimeAssembly({ ...fixture.input,
      connections: { ...fixture.input.connections, usage: delayedUsage } });
    const pending = assembly.start();
    await checking;
    assembly[action]();
    resume();
    await expect(pending).rejects.toMatchObject({ reason: action === 'close' ? 'CLOSED' : 'CANCELLED' });
    expect(fixture.business.sqls).toEqual([]);
    if (action === 'cancel') await expect(assembly.start()).resolves.toMatchObject({ state: 'checked-not-activated', ready: false });
    else await expect(assembly.start()).rejects.toMatchObject({ reason: 'CLOSED' });
  });

  it('reserves the startup attempt before awaiting the parser', async () => {
    const fixture = request();
    let resume!: (value: boolean) => void;
    const gate = new Promise<boolean>(resolve => { resume = resolve; });
    const assembly = createIntakeRuntimeAssembly({ ...fixture.input, parser: { probe: () => gate } });
    const pending = assembly.start();
    const duplicate = assembly.start();
    resume(true);
    await expect(duplicate).rejects.toMatchObject({ reason: 'ALREADY_RUNNING' });
    await expect(pending).resolves.toMatchObject({ state: 'checked-not-activated', ready: false });
  });

  it('does not open a connection for an actor without a private session', async () => {
    let connected = false;
    const pool = { connect: async () => { connected = true; throw new Error('CONNECTED'); } } as IntakePool;
    const result = await createPurposePrivilegeProbe(pool).run({ user_id: 'user-agent' } as AuthenticatedUser, async () => true);
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHORIZED', reason: 'SCOPE_DENIED', commit: 'rolled_back' });
    expect(connected).toBe(false);
  });
});
