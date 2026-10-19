import type { QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { projectRosterLogin, rosterPrincipalId } from '../src/project-roster-login.js';
import { feishuUserId } from '../src/feishu-admit.js';

const openId = 'ou_abcdef';

function result(rows: unknown[]): QueryResult {
  return { rows, command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] } as QueryResult;
}

function client(homes: { tenant_id: string; app_id: string }[], bound: 'bound' | 'missing' = 'bound') {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.startsWith('SELECT DISTINCT')) return result(homes);
      if (sql.includes('INSERT INTO content_intake.grants')) return result([]);
      if (sql.includes('subject_bindings')) return result([{ known: bound === 'bound', bound: bound === 'bound' }]);
      return result([]);
    }),
  };
}

describe('roster login projection', () => {
  it('does not write when the title is off the roster', async () => {
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId, '服务赋能师')).resolves.toBe('unmatched');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('skips when the library does not have exactly one tenant and app', async () => {
    const db = client([]);
    await expect(projectRosterLogin(db, openId, '客服坐席')).resolves.toBe('skipped');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('projects one principal and the content-shop query grants for a matched title', async () => {
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    await expect(projectRosterLogin(db, openId, '客服坐席')).resolves.toBe('projected');
    const bind = db.query.mock.calls[1]?.[1] as unknown[];
    expect(bind[0]).toBe(rosterPrincipalId(openId));
    expect(bind[1]).toBe(feishuUserId(openId));
    expect(bind[5]).toBe(openId);
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('content_intake.grants'))).toBe(true);
    await expect(projectRosterLogin(db, openId, '客服坐席')).resolves.toBe('projected');
    expect(rosterPrincipalId(openId)).toBe(rosterPrincipalId(openId));
  });

  it('stops before grants when the login binding is missing', async () => {
    const db = client([{ tenant_id: 'tenant-a', app_id: 'app-a' }], 'missing');
    await expect(projectRosterLogin(db, openId, '客服坐席')).resolves.toBe('missing-binding');
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO content_intake.grants'))).toBe(false);
  });
});
