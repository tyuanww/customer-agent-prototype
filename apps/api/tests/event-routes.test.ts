import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/app.js';
import type { EventRepository } from '../src/event-repository.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import type { ServiceRepository } from '../src/service-repository.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

const authHeaders = {
  'x-mock-user': 'usr_synthetic_agent_001',
  'x-mock-role': 'agent',
};

const keyRing = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({
    'hmac-idempotency-v1': 'synthetic-event-route-idempotency-key-01',
  }),
});

function serviceRepository(): ServiceRepository {
  return {
    readiness: async () => ({
      database: 'ok', schema: 'ok', auth: 'ok', storage: 'not_ready', content: 'not_ready',
    }),
    readPolicyFlags: async () => null,
    searchCandidates: async () => ({ ok: false, code: 'SOURCE_GATE_NOT_READY' }),
    executeSearch: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordAdoption: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordEscalation: async () => ({ ok: false, code: 'OVERLOADED' }),
    contentImport: unavailableContentImportRepository(),
    close: async () => undefined,
  };
}

function appWith(repository: Pick<EventRepository, 'recordAdoption' | 'recordEscalation'>): FastifyInstance {
  const app = createApiApp(
    parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-events-test',
    }),
    serviceRepository(),
    undefined,
    undefined,
    undefined,
    undefined,
    { repository, idempotencyHmac: keyRing },
  );
  openApps.push(app);
  return app;
}

function eventRepository(): Pick<EventRepository, 'recordAdoption' | 'recordEscalation'> {
  return {
    recordAdoption: vi.fn<EventRepository['recordAdoption']>().mockResolvedValue({
      ok: true,
      response: { ok: true, query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f' },
    }),
    recordEscalation: vi.fn<EventRepository['recordEscalation']>().mockResolvedValue({
      ok: true,
      response: {
        escalate_id: 'esc_synthetic_001',
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
        action: 'open_feishu',
      },
    }),
  };
}

describe('event HTTP routes', () => {
  it('validates adoption, requires an idempotency key and passes only digests to the operation', async () => {
    const repository = eventRepository();
    const app = appWith(repository);
    const payload = {
      query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
      outcome: 'adopted',
      chosen_rank: 1,
      chosen_script_id: 'script_synthetic_001',
      push_method: 'clipboard',
    };

    const missingKey = await app.inject({
      method: 'POST', url: '/v1/events/adoption', headers: authHeaders, payload,
    });
    expect(missingKey.statusCode).toBe(400);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events/adoption',
      headers: { ...authHeaders, 'idempotency-key': 'idem-synthetic-adoption-001' },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ ok: true, query_id: payload.query_id });
    const prepared = vi.mocked(repository.recordAdoption).mock.calls[0]?.[0];
    expect(prepared?.requestHashes.hashes['hmac-idempotency-v1']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(prepared?.requestHashes)).not.toContain('script_synthetic_001');
  });

  it('validates escalation and maps repository failures to stable contracts', async () => {
    const repository = eventRepository();
    const app = appWith(repository);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events/escalate',
      headers: { ...authHeaders, 'idempotency-key': 'idem-synthetic-escalate-001' },
      payload: {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
        action: 'open_feishu',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      escalate_id: 'esc_synthetic_001',
      query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
      action: 'open_feishu',
    });

    vi.mocked(repository.recordEscalation).mockResolvedValueOnce({ ok: false, code: 'CONFLICT' });
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/events/escalate',
      headers: { ...authHeaders, 'idempotency-key': 'idem-synthetic-escalate-002' },
      payload: {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
        action: 'copy_contact',
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('rejects missing auth, unknown fields and invalid terminal shapes before repository access', async () => {
    const repository = eventRepository();
    const app = appWith(repository);
    const cases = [
      [{ 'idempotency-key': 'idem-1' }, {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f', action: 'open_feishu',
      }, '/v1/events/escalate', 401],
      [{ ...authHeaders, 'idempotency-key': 'idem-2' }, {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f', action: 'open_feishu', extra: true,
      }, '/v1/events/escalate', 400],
      [{ ...authHeaders, 'idempotency-key': 'idem-3' }, {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f', outcome: 'dismissed',
        chosen_rank: 1, chosen_script_id: 'script_synthetic_001', push_method: null,
      }, '/v1/events/adoption', 400],
    ] as const;
    for (const [headers, payload, url, statusCode] of cases) {
      const response = await app.inject({ method: 'POST', url, headers, payload });
      expect(response.statusCode).toBe(statusCode);
    }
    expect(repository.recordAdoption).not.toHaveBeenCalled();
    expect(repository.recordEscalation).not.toHaveBeenCalled();
  });
});
