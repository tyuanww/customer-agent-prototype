import assert from 'node:assert/strict';
import test from 'node:test';
import { startApi } from '@customer-agent/api';

test('compiled API package serves its contract-valid health and readiness routes', async () => {
  const started = await startApi({
    environment: {
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-m1-package',
      DATABASE_URL: 'postgresql://w5_package@127.0.0.1:1/w5_package',
      CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin@127.0.0.1:1/w5_package',
      IDEMPOTENCY_HMAC_KEYS: JSON.stringify({
        'hmac-idempotency-v1': 'synthetic-idempotency-material-package',
      }),
      IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
      LOG_HASH_KEY: 'synthetic-log-hash-material-package',
      LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      DB_CONNECTION_TIMEOUT_MS: '100',
    },
  });
  try {
    const response = await fetch(`${started.address}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      service: 'cs-ai-api',
      version: '0.3.0-m1-package',
    });

    const readiness = await fetch(`${started.address}/ready`);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), {
      status: 'not_ready',
      checks: {
        database: 'not_ready',
        schema: 'not_ready',
        auth: 'ok',
        storage: 'not_ready',
        content: 'not_ready',
      },
    });
  } finally {
    await started.close();
  }
});
