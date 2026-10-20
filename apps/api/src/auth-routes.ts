import type { FastifyInstance } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import {
  authenticateRequestHeaders,
  bearerToken,
  type AuthService,
} from './auth-service.js';
import {
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';
import { jobForToken } from './feishu-job-snapshot.js';
import { composeRosterJob, type RosterJobResponse, type StoredRosterPermission } from './project-roster-login.js';

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  readPermission?: (userId: string) => Promise<StoredRosterPermission | null>,
): void {
  if (authService.kind === 'mock') app.post('/v1/auth/mock-login', async (request, reply) => {
    if (!hasExactKeys(request.body, ['user_id', 'role'])) return sendValidationError(reply);
    const requestContract = validateContractSchema('MockLoginRequest', request.body);
    if (!requestContract.ok) return sendValidationError(reply);

    const session = authService.createMockSession(requestContract.value);
    const payload = parseContractSchema('MockLoginResponse', {
      token: session.token,
      user: {
        user_id: session.user.user_id,
        role: session.user.role,
      },
    });
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.get('/v1/auth/me', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const user = await authenticateRequestHeaders(authService, request.headers);
    if (user === null) return sendUnauthorized(reply);

    const payload = parseContractSchema('CurrentUserResponse', {
      user_id: user.user_id,
      role: user.role,
      auth_mode: user.auth_mode,
    });
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.get('/v1/auth/job', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const user = await authenticateRequestHeaders(authService, request.headers);
    if (user === null) return sendUnauthorized(reply);
    const token = bearerToken(request.headers.authorization);
    const snapshot = token ? jobForToken(token) : null;
    let stored: StoredRosterPermission | null = null;
    if (readPermission) {
      try {
        stored = await readPermission(user.user_id);
      } catch {
        request.log.warn('[api] roster permission read failed');
        stored = snapshot ? { title: snapshot.title, state: 'denied' } : null;
      }
    }
    const job: RosterJobResponse | null = composeRosterJob(snapshot, stored, readPermission !== undefined);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '职务未识别' } });
    return job;
  });
}
