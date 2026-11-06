import { createServer, type Server } from 'node:net';
import { expect, it } from 'vitest';
import {
  requiresAccessEvaluatorOverlay,
  reserveAdjacentLoopbackPorts,
} from './support/intake-synthetic-host.ts';

function bind(server: Server, port: number): Promise<Error | undefined> {
  return new Promise(resolve => {
    const onError = (error: Error) => resolve(error);
    server.once('error', onError);
    server.once('listening', () => resolve(undefined));
    server.listen(port, '127.0.0.1');
  });
}

it('reserves the identity port immediately above the API port', async () => {
  const reservation = await reserveAdjacentLoopbackPorts();
  const apiProbe = createServer();
  const identityProbe = createServer();
  try {
    expect(reservation.identityPort).toBe(reservation.apiPort + 1);
    await expect(bind(apiProbe, reservation.apiPort)).resolves.toMatchObject({ code: 'EADDRINUSE' });
    await expect(bind(identityProbe, reservation.identityPort)).resolves.toMatchObject({ code: 'EADDRINUSE' });
  } finally {
    for (const server of [apiProbe, identityProbe]) {
      if (server.listening) await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
    await reservation.close();
  }
});

it('skips the ACL overlay when the unified migration ledger installed 0082', () => {
  expect(requiresAccessEvaluatorOverlay([
    { id: '0081_require_import_batch_principal' },
    { id: '0082_access_evaluator' },
    { id: '0083_sop_pipeline_projection' },
  ])).toBe(false);
});

it('keeps the ACL overlay path for an overlay-only migration chain', () => {
  expect(requiresAccessEvaluatorOverlay([
    { id: '0081_require_import_batch_principal' },
  ])).toBe(true);
});
