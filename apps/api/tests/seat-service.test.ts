import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createMockAuthService } from '../src/auth-service.js';
import { contentIntakeSeatRoutes } from '../src/content-intake/seats-http.js';
import { createSeatService, SeatRefusal, type SeatService } from '../src/content-intake/seats.js';
import type { IntakePool } from '../src/content-intake/transaction.js';
import type { SeatPasswordFile } from '../src/content-intake/seat-password-file.js';

const HOME = { tenantId: 'tenant-menokin', appId: 'app-customer-agent', departmentId: 'dept-menokin' };

function harness(
  rows: readonly Record<string, unknown>[],
  allowed = true,
  passwordFailure?: Error,
  createFailure?: { code: string; constraint: string },
) {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const passwords: { username: string; bindingId: string; password: string }[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string, values: readonly unknown[] = []) {
          queries.push({ sql, values });
          if (sql.includes('seat_administration_allowed')) return { rows: [{ allowed }] };
          if (createFailure && sql.includes('backend_identity.create_seat')) throw createFailure;
          return { rows: sql.includes('list_seats') ? rows : [{ out_job_id: 'job-seat' }] };
        },
        release() {},
      };
    },
  } as unknown as IntakePool;
  const passwordFile: SeatPasswordFile = {
    async upsert(username, bindingId, password) {
      if (passwordFailure) throw passwordFailure;
      passwords.push({ username, bindingId, password });
    },
    async remove() { return false; },
  };
  return { service: createSeatService(pool, passwordFile, HOME), queries, passwords };
}

describe('seat service', () => {
  it('resets the seat named by the caller and writes that password', async () => {
    const { service, passwords } = harness([
      { out_username: 'alice', out_display_name: '合成客服', out_post: '客服', out_enabled: true },
    ]);
    await expect(service.reset('operator', { username: 'alice', password: 'correct horse' }))
      .resolves.toEqual({ username: 'alice' });
    expect(passwords).toEqual([
      { username: 'alice', bindingId: 'synthetic_seat_alice', password: 'correct horse' },
    ]);
  });

  it('refuses a reset for a seat the list does not contain', async () => {
    const { service, passwords } = harness([]);
    await expect(service.reset('operator', { username: 'alice', password: 'correct horse' }))
      .rejects.toBeInstanceOf(SeatRefusal);
    expect(passwords).toEqual([]);
  });

  it('refuses a reset body that carries a field other than the seat and the password', async () => {
    const { service } = harness([]);
    await expect(service.reset('operator', { username: 'alice', password: 'correct horse', post: '客服' }))
      .rejects.toMatchObject({ reason: 'SEAT_INPUT_INVALID' });
  });

  it('refuses every operation when the caller may not administer seats, and writes nothing', async () => {
    const { service, queries, passwords } = harness([], false);
    await expect(service.list('agent')).rejects.toMatchObject({ reason: 'SEAT_FORBIDDEN' });
    await expect(service.create('agent', {
      displayName: '合成客服', username: 'alice', password: 'correct horse', post: '客服',
    })).rejects.toMatchObject({ reason: 'SEAT_FORBIDDEN' });
    await expect(service.reset('agent', { username: 'alice', password: 'correct horse' }))
      .rejects.toMatchObject({ reason: 'SEAT_FORBIDDEN' });
    await expect(service.disable('agent', { username: 'alice' }))
      .rejects.toMatchObject({ reason: 'SEAT_FORBIDDEN' });
    expect(queries.every((query) => query.sql.includes('seat_administration_allowed'))).toBe(true);
    expect(passwords).toEqual([]);
  });

  it('projects account administration without performing a seat operation', async () => {
    const allowed = harness([], true);
    const denied = harness([], false);
    await expect(allowed.service.capabilities('director')).resolves.toEqual({ canManage: true });
    await expect(denied.service.capabilities('agent')).resolves.toEqual({ canManage: false });
    expect(allowed.queries).toHaveLength(1);
    expect(denied.queries).toHaveLength(1);
    expect(allowed.passwords).toEqual([]);
    expect(denied.passwords).toEqual([]);
  });

  it('reports a committed identity when the password file cannot be written', async () => {
    const { service, queries } = harness([], true, new Error('disk full'));
    await expect(service.create('operator', {
      displayName: '合成客服', username: 'alice', password: 'correct horse', post: '客服',
    })).rejects.toMatchObject({
      reason: 'SEAT_PASSWORD_NOT_WRITTEN',
      cause: expect.objectContaining({ message: 'disk full' }),
    });
    expect(queries.map((query) => query.sql)).toEqual([
      'SELECT content_intake.seat_administration_allowed($1) AS allowed',
      'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
    ]);
  });

  it.each([
    ['subject_bindings_pkey', 'SEAT_EXISTS'],
    ['subject_bindings_user_id_key', 'SEAT_EXISTS'],
    ['subject_bindings_provider_tenant_subject_key', 'SEAT_DISPLAY_NAME_TAKEN'],
  ] as const)('maps concurrent unique violation %s to %s', async (constraint, reason) => {
    const { service } = harness([], true, undefined, { code: '23505', constraint });
    await expect(service.create('operator', {
      displayName: '合成客服', username: 'alice', password: 'correct horse', post: '客服',
    })).rejects.toMatchObject({ reason });
  });
});

describe('seat routes', () => {
  it('returns 403 on every seat route when the caller is refused, and does not pretend the write happened', async () => {
    const app = Fastify();
    const calls: string[] = [];
    const refuse = (name: string): never => {
      calls.push(name);
      throw new SeatRefusal('SEAT_FORBIDDEN');
    };
    const seats: SeatService = {
      async capabilities() { return { canManage: false }; },
      async list() { return refuse('list'); },
      async create() { return refuse('create'); },
      async reset() { return refuse('reset'); },
      async disable() { return refuse('disable'); },
    };
    await app.register(contentIntakeSeatRoutes, {
      auth: createMockAuthService(),
      seats,
    });
    const headers = { 'x-mock-user': 'user-agent', 'x-mock-role': 'agent' };
    const capability = await app.inject({ method: 'GET', url: '/v1/intake/seats/administration', headers });
    const listed = await app.inject({ method: 'GET', url: '/v1/intake/seats', headers });
    const created = await app.inject({
      method: 'POST', url: '/v1/intake/seats', headers: { ...headers, 'content-type': 'application/json' },
      payload: { displayName: '合成客服', username: 'alice', password: 'correct horse', post: '客服' },
    });
    const reset = await app.inject({
      method: 'POST', url: '/v1/intake/seats/alice/password', headers: { ...headers, 'content-type': 'application/json' },
      payload: { password: 'correct horse' },
    });
    const disabled = await app.inject({ method: 'DELETE', url: '/v1/intake/seats/alice', headers });
    expect(capability.statusCode).toBe(200);
    expect(capability.json()).toEqual({ canManage: false });
    for (const response of [listed, created, reset, disabled]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN', details: { reason: 'SEAT_FORBIDDEN' } } });
    }
    expect(calls).toEqual(['list', 'create', 'reset', 'disable']);
    await app.close();
  });

  it('returns an actionable 500 when the identity was created but its password was not written', async () => {
    const app = Fastify();
    const seats: SeatService = {
      async capabilities() { return { canManage: true }; },
      async list() { return []; },
      async create() { throw new SeatRefusal('SEAT_PASSWORD_NOT_WRITTEN'); },
      async reset() { throw new SeatRefusal('SEAT_PASSWORD_NOT_WRITTEN'); },
      async disable() { return { username: 'alice' }; },
    };
    await app.register(contentIntakeSeatRoutes, { auth: createMockAuthService(), seats });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/intake/seats',
      headers: { 'x-mock-user': 'user-agent', 'x-mock-role': 'agent', 'content-type': 'application/json' },
      payload: { displayName: '合成客服', username: 'alice', password: 'correct horse', post: '客服' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        details: { reason: 'SEAT_PASSWORD_NOT_WRITTEN' },
      },
    });
    await app.close();
  });
});
