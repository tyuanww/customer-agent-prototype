import assert from 'node:assert/strict';
import test from 'node:test';
import { startApi } from '@customer-agent/api';

test('compiled API package serves its contract-valid health route', async () => {
  const started = await startApi({
    environment: {
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-w3-package',
    },
  });
  try {
    const response = await fetch(`${started.address}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      service: 'cs-ai-api',
      version: '0.2.0-w3-package',
    });
  } finally {
    await started.close();
  }
});
