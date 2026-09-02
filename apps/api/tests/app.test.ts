import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiApp } from '../src/app.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { startApi, startApiWithFactory } from '../src/server.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function testConfig() {
  return parseApiRuntimeConfig({
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-w3-test',
  });
}

describe('Application API bootstrap', () => {
  it('serves only the contract-valid liveness response', async () => {
    const app = createApiApp(testConfig());
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'cs-ai-api',
      version: '0.2.0-w3-test',
    });
    expect(response.body).not.toContain('formal-dev');
    expect(response.body).not.toContain('contract_set_id');

    for (const method of ['HEAD', 'POST'] as const) {
      const methodResponse = await app.inject({ method, url: '/health' });
      expect(methodResponse.statusCode, method).toBe(404);
    }
  });

  it('does not register readiness, mock login, or business routes', async () => {
    const app = createApiApp(testConfig());
    openApps.push(app);

    for (const url of ['/ready', '/v1/auth/mock-login', '/v1/search']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('rejects configuration before constructing or listening on Fastify', async () => {
    const buildApp = vi.fn(() => {
      throw new Error('must not construct the host');
    });

    await expect(startApiWithFactory({ environment: {} }, buildApp)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect(buildApp).not.toHaveBeenCalled();
  });

  it('closes a partially initialized app without replacing the listen error', async () => {
    const listenError = new Error('listen failed');
    const close = vi.fn().mockRejectedValue(new Error('close failed'));
    const listen = vi.fn().mockRejectedValue(listenError);
    const app = { close, listen } as unknown as FastifyInstance;

    await expect(startApiWithFactory({
      environment: {
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        CUSTOMER_AGENT_API_PORT: '0',
      },
    }, () => app)).rejects.toBe(listenError);
    expect(listen).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('starts on an ephemeral loopback port and closes cleanly', async () => {
    const started = await startApi({
      environment: {
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        CUSTOMER_AGENT_API_PORT: '0',
        CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-w3-listen',
      },
    });
    try {
      expect(started.address).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]+$/);
      const response = await fetch(`${started.address}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: 'ok',
        service: 'cs-ai-api',
        version: '0.2.0-w3-listen',
      });
    } finally {
      await started.close();
    }
  });
});
