import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockAuthService } from '../src/auth-service.js';
import { NOTICE_VERSION_MAX_LENGTH, registerNoticeRoutes } from '../src/notice-routes.js';
import type { NoticeService } from '../src/notice-service.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(recordDecision: NoticeService['recordDecision']): FastifyInstance {
  const app = fastify({ logger: false, routerOptions: { maxParamLength: NOTICE_VERSION_MAX_LENGTH + 1 } });
  const service: NoticeService = {
    current: vi.fn().mockResolvedValue({ ok: false, code: 'NOT_FOUND' }),
    recordDecision,
    hasAcceptedCurrentNotice: vi.fn().mockResolvedValue(false),
    close: vi.fn().mockResolvedValue(undefined),
  };
  registerNoticeRoutes(app, createMockAuthService(), { service });
  openApps.push(app);
  return app;
}

const authHeaders = {
  'x-mock-user': 'usr_synthetic_agent_001',
  'x-mock-role': 'agent',
  'idempotency-key': 'notice-version-boundary-test',
};

describe('notice HTTP routes', () => {
  it('accepts the contract maximum notice version length and rejects the next byte', async () => {
    const recordDecision = vi.fn<NoticeService['recordDecision']>().mockResolvedValue({
      ok: true,
      response: {
        ok: true,
        version: 'v'.repeat(128),
        decision: 'accepted',
        decided_at: '2026-09-30T00:00:00.000Z',
      },
    });
    const app = appWith(recordDecision);
    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/notices/${'v'.repeat(128)}/decision`,
      headers: authHeaders,
      payload: { decision: 'accepted' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ version: 'v'.repeat(128) }));

    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/notices/${'v'.repeat(129)}/decision`,
      headers: authHeaders,
      payload: { decision: 'accepted' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(recordDecision).toHaveBeenCalledTimes(1);
  });
});
