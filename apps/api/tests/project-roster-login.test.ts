import type { QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { feishuUserId } from '../src/feishu-admit.js';
import { projectRosterLogin, rosterPreparation, rosterPrincipalId, ROSTER_DENIAL_MESSAGE } from '../src/project-roster-login.js';

const openId = 'ou_abcdef';

function result(rows: unknown[]): QueryResult {
  return { rows, command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] } as QueryResult;
}

function remember(title: string) {
  rememberJobSnapshot(openId, { title, directory: [{ name: title, enabled: true }] });
}

function client(homes: { tenant_id: string; app_id: string }[], status = 'projected') {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (sql.includes('FROM content_intake.principals') && sql.includes('policy_versions')) return result(homes);
      if (sql.includes('project_feishu_roster')) {
        const registration = status === 'projected' || status === 'registered' ? 'registered' : status;
        return result([{ status: registration }]);
      }
      if (sql.includes('issue_roster_query')) return result([{ status }]);
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

  it('keeps the fixed denial sentence and the internal reason apart', () => {
    expect(rosterPreparation('projected')).toEqual({ state: 'ready', reason: 'projected', message: null });
    expect(rosterPreparation('registered')).toEqual({
      state: 'pending', reason: 'registered', message: ROSTER_DENIAL_MESSAGE,
    });
    expect(rosterPreparation('unmatched')).toEqual({
      state: 'denied', reason: 'unmatched', message: ROSTER_DENIAL_MESSAGE,
    });
  });

  it('stops when the login binding is missing', async () => {
    remember('客服坐席');
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }], 'missing');
    await expect(projectRosterLogin(db, openId)).resolves.toBe('missing-binding');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
