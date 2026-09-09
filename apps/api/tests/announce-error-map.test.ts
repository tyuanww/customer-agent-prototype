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
        if (stage === 'rollback') expect(release).toHaveBeenCalledWith(true);
      } finally { log.mockRestore(); }
    },
  );
});
