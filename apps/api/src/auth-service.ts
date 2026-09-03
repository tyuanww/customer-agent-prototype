import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { validateContractSchema } from '@customer-agent/contracts';
import type { components } from '@customer-agent/contracts/generated';

type UserClaims = components['schemas']['UserClaims'];
type MockLoginResponse = components['schemas']['MockLoginResponse'];
export type AuthenticatedUser = components['schemas']['CurrentUserResponse'];

export type AuthReadiness = 'ok' | 'not_ready';

export type AuthService = Readonly<{
  createMockSession: (claims: UserClaims) => MockLoginResponse;
  authenticate: (credentials: MockCredentials) => AuthenticatedUser | null;
  readiness: () => AuthReadiness;
  close: () => void;
}>;

export type MockCredentials = Readonly<{
  authorization?: string | readonly string[];
  mockUser?: string | readonly string[];
  mockRole?: string | readonly string[];
}>;

type TokenFactory = () => string;

function frozenClaims(claims: UserClaims): UserClaims {
  return Object.freeze({ user_id: claims.user_id, role: claims.role });
}

class InMemoryMockAuthService implements AuthService {
  private readonly sessions = new Map<string, UserClaims>();
  private closed = false;

  constructor(private readonly tokenFactory: TokenFactory) {}

  createMockSession(claims: UserClaims): MockLoginResponse {
    if (this.closed) {
      throw new Error('Mock auth service is closed');
    }
    const user = frozenClaims(claims);
    let token: string;
    do {
      // The opaque token deliberately carries no user, role, timestamp or
      // environment information. It is process-local and never persisted.
      token = `mock_${this.tokenFactory().replaceAll('-', '')}`;
    } while (this.sessions.has(token));
    this.sessions.set(token, user);
    return Object.freeze({ token, user });
  }

  authenticate(credentials: MockCredentials): AuthenticatedUser | null {
    if (this.closed) return null;
    const hasBearer = credentials.authorization !== undefined;
    const hasMockHeaders = credentials.mockUser !== undefined || credentials.mockRole !== undefined;
    if (hasBearer === hasMockHeaders) return null;

    if (hasBearer) {
      if (typeof credentials.authorization !== 'string') return null;
      const token = bearerToken(credentials.authorization);
      if (token === null) return null;
      const user = this.sessions.get(token);
      if (!user) return null;
      return Object.freeze({ ...user, auth_mode: 'mock' });
    }

    if (typeof credentials.mockUser !== 'string' || typeof credentials.mockRole !== 'string') {
      return null;
    }
    const claims = validateContractSchema('UserClaims', {
      user_id: credentials.mockUser,
      role: credentials.mockRole,
    });
    if (!claims.ok) return null;
    return Object.freeze({ ...claims.value, auth_mode: 'mock' });
  }

  readiness(): AuthReadiness {
    return this.closed ? 'not_ready' : 'ok';
  }

  close(): void {
    this.closed = true;
    this.sessions.clear();
  }
}

export function createMockAuthService(
  tokenFactory: TokenFactory = randomUUID,
): AuthService {
  return new InMemoryMockAuthService(tokenFactory);
}

export function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export function authenticateRequestHeaders(
  authService: AuthService,
  headers: IncomingHttpHeaders,
): AuthenticatedUser | null {
  return authService.authenticate({
    ...(headers.authorization === undefined ? {} : { authorization: headers.authorization }),
    ...(headers['x-mock-user'] === undefined ? {} : { mockUser: headers['x-mock-user'] }),
    ...(headers['x-mock-role'] === undefined ? {} : { mockRole: headers['x-mock-role'] }),
  });
}
