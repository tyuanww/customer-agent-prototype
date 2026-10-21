import type { QueryResult } from 'pg';
import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockAuthService } from '../src/auth-service.js';
import { registerAuthRoutes } from '../src/auth-routes.js';
import { bindSessionSubject, forgetJobSnapshot, rememberJobSnapshot, subjectHash } from '../src/feishu-job-snapshot.js';
import { feishuUserId } from '../src/feishu-admit.js';
import { composeRosterJob, NO_AUTHORIZATION_ACTIONS, projectRosterLogin, readStoredRosterPermission, rosterHomeFromEnv, rosterPermissionState, rosterPreparation, rosterPrincipalId, ROSTER_DENIAL_MESSAGE } from '../src/project-roster-login.js';
import { FACTS_EXPIRED_MESSAGE, ROSTER_PENDING_MESSAGE } from '@customer-agent/job-roster';
import { JOB_ROSTER } from '@customer-agent/job-roster';

const openId = 'ou_abcdef';

function result(rows: unknown[]): QueryResult {
  return { rows, command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] } as QueryResult;
}

function remember(title: string, extra: { departmentIds?: string[]; departed?: boolean } = {}) {
  rememberJobSnapshot(openId, {
    title,
    directory: [{ name: title, enabled: extra.departed !== true }],
    ...(extra.departmentIds ? { departmentIds: extra.departmentIds } : { departmentIds: ['dept-a'] }),
    ...(extra.departed ? { departed: true } : {}),
  });
}

function client(
  homes: { tenant_id: string; app_id: string }[],
  status = 'projected',
  permission: string | null = null,
) {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (sql.includes('roster_permission_for_user')) return result([{ state: permission }]);
      if (sql.includes('FROM content_intake.principals') && sql.includes('policy_versions')) return result(homes);
      if (sql.includes('project_feishu_roster')) {
        const registration = status === 'projected' || status === 'registered' ? 'registered' : status;
        return result([{ status: registration }]);
      }
      if (sql.includes('issue_roster_query')) return result([{ status }]);
      if (sql.includes('withdraw_roster_query')) return result([{ status: 'revoked' }]);
      return result([]);
    }),
  };
}

afterEach(() => forgetJobSnapshot(openId));

describe('roster login projection', () => {
  it('does not write when the title is off the roster', async () => {
    remember('服务赋能师');
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId)).resolves.toBe('unmatched');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not write when login collected no title', async () => {
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId)).resolves.toBe('unmatched');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('skips when the library does not have exactly one tenant and app', async () => {
    remember('客服坐席');
    const db = client([]);
    await expect(projectRosterLogin(db, openId)).resolves.toBe('skipped');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('uses the trusted home when the library has no tenant yet', async () => {
    remember('客服坐席');
    const trusted = { tenantId: 'tenant-menokin', appId: 'app-customer-agent' };
    const db = client([]);
    await expect(projectRosterLogin(db, openId, trusted)).resolves.toBe('projected');
    const params = db.query.mock.calls[1]?.[1] as unknown[];
    expect(params[2]).toBe('tenant-menokin');
    expect(params[3]).toBe('app-customer-agent');
    expect(rosterHomeFromEnv({ ROSTER_TENANT_ID: 'tenant-menokin', ROSTER_APP_ID: 'app-customer-agent' })).toEqual(trusted);
    expect(rosterHomeFromEnv({})).toBeNull();
  });

  it('skips when the library home disagrees with the trusted home', async () => {
    remember('客服坐席');
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId, { tenantId: 'tenant-menokin', appId: 'app-customer-agent' })).resolves.toBe('skipped');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('projects both seat and director with query only', async () => {
    remember('客服坐席');
    const seat = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(seat, openId)).resolves.toBe('projected');
    const seatParams = seat.query.mock.calls[1]?.[1] as unknown[];
    expect(seatParams[0]).toBe(rosterPrincipalId(openId));
    expect(seatParams[1]).toBe(feishuUserId(openId));
    expect(seatParams[5]).toBe(openId);
    expect(seatParams[7]).toBe('job-customer-service-seat');
    expect(seatParams[8]).toBe('agent');
    expect(seatParams[9]).toEqual(['query']);
    forgetJobSnapshot(openId);
    remember('客服总监');
    const director = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(director, openId)).resolves.toBe('projected');
    const directorParams = director.query.mock.calls[1]?.[1] as unknown[];
    expect(directorParams[7]).toBe('job-customer-service-director');
    expect(directorParams[9]).toEqual(['query']);
    expect(rosterPrincipalId(openId)).toBe(seatParams[0]);
  });

  it('reports registration when no contentful current release is available', async () => {
    remember('客服坐席');
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }], 'registered');
    await expect(projectRosterLogin(db, openId)).resolves.toBe('registered');
  });

  it('gives each refusal the sentence its cause needs', () => {
    // These three are not interchangeable. A missing grant needs a person. An expired
    // facts window needs a refresh. An empty tenant needs someone to publish, and no
    // amount of granting or refreshing changes that.
    expect(rosterPreparation('projected')).toEqual({ state: 'ready', reason: 'projected', message: null });
    expect(rosterPreparation('registered')).toEqual({
      state: 'pending', reason: 'registered', message: ROSTER_PENDING_MESSAGE,
    });
    expect(rosterPreparation('unmatched')).toEqual({
      state: 'denied', reason: 'unmatched', message: ROSTER_DENIAL_MESSAGE,
    });
    expect(rosterPreparation('expired')).toEqual({
      state: 'expired', reason: 'expired', message: FACTS_EXPIRED_MESSAGE,
    });
    expect(rosterPreparation('revoked')).toEqual({
      state: 'revoked', reason: 'revoked', message: ROSTER_DENIAL_MESSAGE,
    });
    expect(new Set([ROSTER_PENDING_MESSAGE, ROSTER_DENIAL_MESSAGE, FACTS_EXPIRED_MESSAGE]).size).toBe(3);
  });

  it('does not invent a department when the provider omits one', async () => {
    rememberJobSnapshot(openId, { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }] });
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId)).resolves.toBe('denied');
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('project_feishu_roster'))).toBe(false);
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('withdraw_roster_query'))).toBe(true);
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('roster_permission_for_user'))).toBe(true);
    expect(rosterPermissionState('denied')).toBe('denied');
    expect(rosterPreparation('denied').message).toBe(ROSTER_DENIAL_MESSAGE);
  });

  it('returns the stored permission after a department is missing', async () => {
    rememberJobSnapshot(openId, { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }] });
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }], 'projected', 'pending');
    await expect(projectRosterLogin(db, openId)).resolves.toBe('pending');
  });

  it('withdraws query access when the provider says the person has left', async () => {
    remember('客服坐席', { departed: true });
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }], 'projected', 'revoked');
    await expect(projectRosterLogin(db, openId)).resolves.toBe('revoked');
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('project_feishu_roster'))).toBe(false);
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('roster_permission_for_user'))).toBe(true);
  });

  it('returns unmatched when a departed person has no stored permission', async () => {
    remember('客服坐席', { departed: true });
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId)).resolves.toBe('unmatched');
  });

  it('reads permission from the database function and ignores a ready memory snapshot', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(result([{ state: 'revoked' }]))
        .mockResolvedValueOnce(result([{ job_id: 'job-customer-service-seat' }])),
    };
    await expect(readStoredRosterPermission(db, 'usr_ou_abcdef')).resolves.toEqual({
      title: '客服坐席', state: 'revoked',
    });
    expect(String(db.query.mock.calls[0]?.[0])).toContain('roster_permission_for_user');
    expect(String(db.query.mock.calls[0]?.[0])).not.toContain('query_open');
    expect(db.query.mock.calls[0]?.[1]).toEqual(['usr_ou_abcdef']);
    expect(String(db.query.mock.calls[1]?.[0])).toContain('facts.job_id');
    const seat = JOB_ROSTER.find((row) => row.jobId === 'job-customer-service-seat');
    expect(seat?.rights.search).toBe(true);
    expect(seat?.rights.publish).toBe(false);
    expect(composeRosterJob(
      { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], permissionState: 'ready' },
      { title: '客服坐席', state: 'revoked' },
      true,
    )).toEqual({
      title: '客服坐席',
      directory: [{ name: '客服坐席', enabled: true }],
      permission_state: 'revoked',
      message: ROSTER_DENIAL_MESSAGE,
      actions: NO_AUTHORIZATION_ACTIONS,
    });
    expect(composeRosterJob(
      { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], permissionState: 'ready' },
      null,
      true,
    )?.permission_state).toBe('denied');
    expect(composeRosterJob(
      { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], permissionState: 'ready' },
      null,
      false,
    )).toMatchObject({ permission_state: 'ready', message: null });
    expect(composeRosterJob(
      { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], permissionState: 'unknown' },
      null,
      false,
    )).toMatchObject({ permission_state: 'unknown', message: null });
  });

  it('denies an unknown job id with the snapshot title and never the raw id', async () => {
    rememberJobSnapshot(openId, { title: '服务赋能师', directory: [{ name: '服务赋能师', enabled: true }] });
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(result([{ state: 'ready' }]))
        .mockResolvedValueOnce(result([{ job_id: 'job-not-in-roster' }])),
    };
    await expect(readStoredRosterPermission(db, 'usr_ou_abcdef')).resolves.toEqual({
      title: '服务赋能师', state: 'denied',
    });
  });

  it('returns null when an unknown job id has no snapshot title', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(result([{ state: 'ready' }]))
        .mockResolvedValueOnce(result([{ job_id: 'job-not-in-roster' }])),
    };
    await expect(readStoredRosterPermission(db, 'usr_ou_abcdef')).resolves.toBeNull();
  });

  it('stops when the login binding is missing', async () => {
    remember('客服坐席');
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }], 'missing');
    await expect(projectRosterLogin(db, openId)).resolves.toBe('missing-binding');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe('GET /v1/auth/job', () => {
  async function appWithPermission(
    readPermission?: (userId: string) => Promise<{ title: string; state: 'pending' | 'ready' | 'expired' | 'revoked' | 'denied' } | null>,
    readActions?: (userId: string) => Promise<{ query: boolean; import: boolean; publish: boolean; rollback: boolean }>,
  ) {
    const auth = createMockAuthService(() => 'tok_' + 'a'.repeat(40));
    const app = fastify();
    registerAuthRoutes(app, auth, readPermission, readActions);
    await app.ready();
    return app;
  }

  afterEach(() => forgetJobSnapshot(openId));

  // Value: protects=auth job route 404 and DB-backed denial; fails_when=snapshot-only ready leaks without roster_permission_for_user; why_new=composeRosterJob had unit tests only; seam=none; no_claim=full intake wiring
  it('returns 404 without a snapshot and prefers stored permission over memory', async () => {
    const readPermission = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ title: '客服坐席', state: 'revoked' });
    const app = await appWithPermission(readPermission);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/mock-login',
        payload: { user_id: 'usr_ou_abcdef', role: 'agent' },
      });
      const token = login.json<{ token: string }>().token;
      const missing = await app.inject({
        method: 'GET',
        url: '/v1/auth/job',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: '职务未识别' } });

      remember('客服坐席');
      bindSessionSubject(token, subjectHash(openId));
      const denied = await app.inject({
        method: 'GET',
        url: '/v1/auth/job',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(denied.statusCode).toBe(200);
      expect(denied.json()).toEqual({
        title: '客服坐席',
        directory: [{ name: '客服坐席', enabled: true }],
        permission_state: 'revoked',
        message: ROSTER_DENIAL_MESSAGE,
        actions: NO_AUTHORIZATION_ACTIONS,
      });
    } finally {
      await app.close();
    }
  });

  // Value: protects=unknown permission when business reader absent; fails_when=mock profile invents denied without SQL; why_new=no intake pool in unit app; seam=none; no_claim=product session remote path
  it('denies a known title when the permission read fails', async () => {
    const readPermission = vi.fn().mockRejectedValue(new Error('db down'));
    const app = await appWithPermission(readPermission);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/mock-login',
        payload: { user_id: 'usr_ou_abcdef', role: 'agent' },
      });
      const token = login.json<{ token: string }>().token;
      const unread = await app.inject({
        method: 'GET',
        url: '/v1/auth/job',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(unread.statusCode).toBe(404);
      expect(unread.json()).toEqual({ error: { code: 'NOT_FOUND', message: '职务未识别' } });

      remember('客服坐席');
      bindSessionSubject(token, subjectHash(openId));
      const denied = await app.inject({
        method: 'GET',
        url: '/v1/auth/job',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(denied.statusCode).toBe(200);
      expect(denied.json()).toEqual({
        title: '客服坐席',
        directory: [{ name: '客服坐席', enabled: true }],
        permission_state: 'denied',
        message: ROSTER_DENIAL_MESSAGE,
        actions: NO_AUTHORIZATION_ACTIONS,
      });
    } finally {
      await app.close();
    }
  });

  it('keeps unknown permission when the business reader is not wired', async () => {
    const app = await appWithPermission();
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/mock-login',
        payload: { user_id: 'usr_ou_abcdef', role: 'agent' },
      });
      const token = login.json<{ token: string }>().token;
      remember('客服坐席');
      bindSessionSubject(token, subjectHash(openId));
      const job = await app.inject({
        method: 'GET',
        url: '/v1/auth/job',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(job.statusCode).toBe(200);
      expect(job.json()).toMatchObject({
        permission_state: 'unknown',
        message: null,
        actions: NO_AUTHORIZATION_ACTIONS,
      });
    } finally {
      await app.close();
    }
  });

  it('returns query, import, publish, and rollback from authorization_sources', async () => {
    const readPermission = vi.fn().mockResolvedValue({ title: '客服总监', state: 'ready' });
    const readActions = vi.fn().mockResolvedValue({
      query: true, import: false, publish: true, rollback: false,
    });
    const app = await appWithPermission(readPermission, readActions);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/mock-login',
        payload: { user_id: 'usr_ou_abcdef', role: 'owner' },
      });
      const token = login.json<{ token: string }>().token;
      remember('客服总监');
      bindSessionSubject(token, subjectHash(openId));
      const job = await app.inject({
        method: 'GET',
        url: '/v1/auth/job',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(job.statusCode).toBe(200);
      expect(job.json()).toMatchObject({
        permission_state: 'ready',
        message: null,
        actions: { query: true, import: false, publish: true, rollback: false },
      });
      expect(readActions).toHaveBeenCalledWith('usr_ou_abcdef');
    } finally {
      await app.close();
    }
  });
});
