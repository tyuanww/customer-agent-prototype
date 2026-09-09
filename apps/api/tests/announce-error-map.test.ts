import { describe, expect, it } from 'vitest';
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
