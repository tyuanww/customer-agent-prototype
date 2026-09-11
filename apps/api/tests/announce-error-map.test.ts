import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createAnnounceServiceForPool } from '../src/announce-service.js';

const LOG_HASH = Object.freeze({ version: 'hmac-log-v1', key: 'synthetic-t5-log-hash-material-00000001' });

describe('announce SQL error mapping', () => {
  it('maps ZA004 offline lease DETAIL to forbidden without a live database', async () => {
    const pool = {
      connect: async () => Object.freeze({
        query: async (text: string) => {
          if (String(text).includes('read_snapshot_page')) {
            throw Object.assign(new Error('offline lease token is invalid'), {
              code: 'ZA004',
              detail: 'OFFLINE_LEASE_INVALID',
            });
          }
          return { rows: [{}] };
        },
        release: () => undefined,
      }),
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
    const result = await service.snapshot({
      actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
      clientId: 'mac-cs-t5-001',
      leaseToken: `osl_${'ab'.repeat(32)}`,
      releaseId: 'rel-1',
      cursor: null,
      limit: 200,
    });
    expect(result).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      reason: 'OFFLINE_LEASE_INVALID',
    });
  });
});

describe('announce denial diagnostics', () => {
  it.each(['request_connect', 'connect', 'begin', 'write', 'commit', 'rollback'] as const)(
    'keeps %s failure observable without leaking driver data', async (stage) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const release = vi.fn();
      const fault = Object.assign(new Error('private driver message token=synthetic-secret'), { code: '08006' });
      let connections = 0;
      const pool = {
        connect: async () => {
          if (stage === 'request_connect') throw fault;
          if (++connections === 1) return {
            query: async () => { throw Object.assign(new Error('invalid lease'), { code: 'ZA004', detail: 'OFFLINE_LEASE_INVALID' }); },
            release: () => undefined,
          };
          if (stage === 'connect') throw fault;
          return {
            query: async (sql: string) => {
              if ((stage === 'begin' && sql === 'BEGIN')
                || ((stage === 'write' || stage === 'rollback') && sql.includes('record_runtime_source_denial_audit'))
                || (stage === 'commit' && sql === 'COMMIT')
                || (stage === 'rollback' && sql === 'ROLLBACK')) throw fault;
              return { rows: [] };
            },
            release,
          };
        },
        query: async () => ({ rows: [] }), end: async () => undefined,
      };
      try {
        const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
        expect(await service.snapshot({
          actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
          clientId: 'mac-cs-t5-001', leaseToken: `osl_${'ab'.repeat(32)}`,
          releaseId: 'rel-1', cursor: null, limit: 200,
        })).toEqual({ ok: false, code: 'OVERLOADED' });
        const messages = log.mock.calls.flat().join(' ');
        expect(messages).toContain(stage === 'request_connect'
          ? 'ANNOUNCE_CONNECT_FAILED' : `ANNOUNCE_AUDIT_${stage.toUpperCase()}_FAILED`);
        expect(messages).toContain('database_code=08006');
        expect(messages).not.toContain('synthetic-secret');
        expect(messages).not.toContain('private driver');
        if (stage === 'begin' || stage === 'rollback') expect(release).toHaveBeenCalledWith(true);
      } finally { log.mockRestore(); }
    },
  );

  it('releases the snapshot client before opening the audit connection', async () => {
    const events: string[] = [];
    const pool = {
      connect: async () => {
        events.push('connect');
        return {
          query: async (sql: string) => {
            if (String(sql).includes('read_snapshot_page')) {
              throw Object.assign(new Error('invalid lease'), {
                code: 'ZA004',
                detail: 'OFFLINE_LEASE_INVALID',
              });
            }
            return { rows: [] };
          },
          release: (broken?: boolean) => {
            events.push(`release:${String(Boolean(broken))}`);
          },
        };
      },
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
    await expect(service.snapshot({
      actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
      clientId: 'mac-cs-t5-001',
      leaseToken: `osl_${'ab'.repeat(32)}`,
      releaseId: 'rel-1',
      cursor: null,
      limit: 200,
    })).resolves.toEqual({
      ok: false,
      code: 'FORBIDDEN',
      reason: 'OFFLINE_LEASE_INVALID',
    });
    expect(events[0]).toBe('connect');
    const released = events.indexOf('release:false');
    const auditConnect = events.indexOf('connect', 1);
    expect(released).toBeGreaterThan(0);
    expect(auditConnect).toBeGreaterThan(released);
  });

  it('returns forbidden after a single audit BEGIN retry', async () => {
    let begins = 0;
    const release = vi.fn();
    const pool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (String(sql).includes('read_snapshot_page')) {
            throw Object.assign(new Error('invalid lease'), {
              code: 'ZA004',
              detail: 'OFFLINE_LEASE_INVALID',
            });
          }
          if (sql === 'BEGIN') {
            begins += 1;
            if (begins === 1) {
              throw Object.assign(new Error('private driver message token=synthetic-secret'), { code: '08006' });
            }
          }
          return { rows: [] };
        },
        release,
      }),
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
      await expect(service.snapshot({
        actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
        clientId: 'mac-cs-t5-001',
        leaseToken: `osl_${'ab'.repeat(32)}`,
        releaseId: 'rel-1',
        cursor: null,
        limit: 200,
      })).resolves.toEqual({
        ok: false,
        code: 'FORBIDDEN',
        reason: 'OFFLINE_LEASE_INVALID',
      });
      expect(begins).toBe(2);
      expect(release).toHaveBeenCalledWith(true);
      expect(log.mock.calls.flat().join(' ')).toContain('ANNOUNCE_AUDIT_BEGIN_FAILED');
    } finally {
      log.mockRestore();
    }
  });

  it('does not rewrite a connection error as an invalid lease', async () => {
    let connects = 0;
    const release = vi.fn();
    const pool = {
      connect: async () => {
        connects += 1;
        return {
          query: async (sql: string) => {
            if (String(sql).includes('read_snapshot_page')) {
              throw new Error('socket hang up');
            }
            return { rows: [] };
          },
          release,
        };
      },
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
      await expect(service.snapshot({
        actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
        clientId: 'mac-cs-t5-001',
        leaseToken: `osl_${'ab'.repeat(32)}`,
        releaseId: 'rel-1',
        cursor: null,
        limit: 200,
      })).resolves.toEqual({ ok: false, code: 'INTERNAL' });
      expect(connects).toBe(2);
      expect(release).toHaveBeenCalledWith(true);
      expect(log.mock.calls.flat().join(' ')).toContain('ANNOUNCE_FAILED');
      expect(log.mock.calls.flat().join(' ')).not.toContain('ANNOUNCE_AUDIT_');
    } finally {
      log.mockRestore();
    }
  });

  it('maps ZA004 even when a driver cause has no SQLSTATE', async () => {
    const pool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (String(sql).includes('read_snapshot_page')) {
            throw Object.assign(new Error('offline lease token is invalid'), {
              code: 'ZA004',
              detail: 'OFFLINE_LEASE_INVALID',
              cause: new Error('Query read timeout'),
            });
          }
          return { rows: [] };
        },
        release: () => undefined,
      }),
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
    await expect(service.snapshot({
      actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
      clientId: 'mac-cs-t5-001',
      leaseToken: `osl_${'ab'.repeat(32)}`,
      releaseId: 'rel-1',
      cursor: null,
      limit: 200,
    })).resolves.toEqual({
      ok: false,
      code: 'FORBIDDEN',
      reason: 'OFFLINE_LEASE_INVALID',
    });
  });

  it('retries a snapshot read timeout and then maps ZA004', async () => {
    let snapshotQueries = 0;
    const release = vi.fn();
    const pool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (String(sql).includes('read_snapshot_page')) {
            snapshotQueries += 1;
            if (snapshotQueries === 1) throw new Error('Query read timeout');
            throw Object.assign(new Error('offline lease token is invalid'), {
              code: 'ZA004',
              detail: 'OFFLINE_LEASE_INVALID',
            });
          }
          return { rows: [] };
        },
        release,
      }),
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = createAnnounceServiceForPool(pool as unknown as Pool, LOG_HASH, false);
      await expect(service.snapshot({
        actor: { user_id: 'usr_t5_owner', role: 'owner', auth_mode: 'mock' },
        clientId: 'mac-cs-t5-001',
        leaseToken: `osl_${'ab'.repeat(32)}`,
        releaseId: 'rel-1',
        cursor: null,
        limit: 200,
      })).resolves.toEqual({
        ok: false,
        code: 'FORBIDDEN',
        reason: 'OFFLINE_LEASE_INVALID',
      });
      expect(snapshotQueries).toBe(2);
      expect(release).toHaveBeenCalledWith(true);
      expect(log.mock.calls.flat().join(' ')).toContain('ANNOUNCE_FAILED');
    } finally {
      log.mockRestore();
    }
  });
});
