import type { FastifyInstance } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import {
  authenticateRequestHeaders,
  type AuthService,
} from './auth-service.js';
import {
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';

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
): void {
  app.post('/v1/auth/mock-login', async (request, reply) => {
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
    const user = authenticateRequestHeaders(authService, request.headers);
    if (user === null) return sendUnauthorized(reply);

    const payload = parseContractSchema('CurrentUserResponse', {
      user_id: user.user_id,
      role: user.role,
      auth_mode: user.auth_mode,
    });
    reply.header('cache-control', 'no-store');
    return payload;
  });
}
