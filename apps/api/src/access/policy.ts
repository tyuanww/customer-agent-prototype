export const ACCESS_ACTIONS = [
  'query',
  'content-manage',
  'import',
  'source-confirm',
  'review',
  'publish',
  'candidate-cancel',
  'rollback',
  'grants-manage',
  'accounts-manage',
] as const;

export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type AccessProfile = 'mock' | 'product';
export type RoutePolicy =
  | Readonly<{ kind: 'token' }>
  | Readonly<{ kind: 'session' }>
  | Readonly<{ kind: 'requires'; anyOf: readonly AccessAction[] }>;

export const ACCESS_PUBLIC_ROUTES = Object.freeze({
  mock: Object.freeze([
    'GET /health',
    'GET /ready',
    'POST /v1/auth/mock-login',
  ]),
  product: Object.freeze([
    'GET /health',
    'GET /ready',
    'POST /v1/auth/login-requests',
    'POST /v1/auth/login-requests/:login_id/exchange',
    'GET /v1/auth/callback',
  ]),
} satisfies Record<AccessProfile, readonly string[]>);

const management = Object.freeze([
  'content-manage',
  'import',
  'source-confirm',
  'review',
  'publish',
  'candidate-cancel',
  'rollback',
] as const);
const managementRead = Object.freeze([
  'content-manage',
  'review',
  'publish',
  'candidate-cancel',
  'rollback',
] as const);
const grantOrImport = Object.freeze(['import', 'grants-manage'] as const);
const intakeRead = Object.freeze(['query', ...management, 'grants-manage'] as const);

const requires = (...anyOf: readonly AccessAction[]): RoutePolicy => Object.freeze({
  kind: 'requires',
  anyOf: Object.freeze([...anyOf]),
});
const session = (): RoutePolicy => Object.freeze({ kind: 'session' });

type RouteEntry = readonly [route: string, policy: RoutePolicy];

export function createRoutePolicyRegistry(entries: readonly RouteEntry[]): ReadonlyMap<string, RoutePolicy> {
  const result = new Map<string, RoutePolicy>();
  for (const [route, policy] of entries) {
    if (result.has(route)) throw new Error(`ACCESS_ROUTE_POLICY_DUPLICATE: ${route}`);
    result.set(route, policy);
  }
  return result;
}

/** Exact method and Fastify route URL. No prefix or wildcard declaration is accepted. */
export const PROTECTED_ROUTE_POLICIES = createRoutePolicyRegistry([
  ['GET /v1/auth/me', session()],
  ['GET /v1/auth/job', session()],
  ['POST /v1/auth/logout', Object.freeze({ kind: 'token' })],
  ['GET /v1/access/query', session()],
  ['GET /v1/access/settings', session()],
  ['GET /v1/access/admin', requires('grants-manage', 'accounts-manage')],

  ['GET /v1/policy', session()],
  ['POST /v1/policy/flags', session()],
  ['POST /v1/search', requires('query')],
  ['POST /v1/events/adoption', requires('query')],
  ['POST /v1/events/escalate', requires('query')],
  ['GET /v1/announce/current', requires('query')],
  ['GET /v1/announce/snapshot', requires('query')],
  ['POST /v1/announce/ack', requires('query')],
  ['GET /v1/notices/current', requires('query')],
  ['POST /v1/notices/:version/decision', requires('query')],

  ['POST /v1/content/import', requires('import')],
  ['GET /v1/content/import/:import_batch_id', requires('import')],
  ['POST /v1/content/import/:import_batch_id/cancel', requires('import')],
  ['GET /v1/admin/content/reviews', requires('review')],
  ['GET /v1/admin/content/reviews/:batch_id', requires('review')],
  ['POST /v1/admin/content/reviews/:batch_id/decisions', requires('review')],
  ['POST /v1/admin/content/reviews/:batch_id/quality-evidence', requires('review')],
  ['POST /v1/admin/content/reviews/:batch_id/resume', requires('review')],
  ['POST /v1/admin/content/reviews/:batch_id/cancel', requires('review')],
  ['POST /v1/content/publish', requires('publish')],
  ['POST /v1/content/rollback', requires('rollback')],
  ['POST /v1/content/rollback-previous', requires('rollback')],

  ['GET /v1/metrics/iteration-tasks', requires(...managementRead)],
  ['POST /v1/events/iteration-tasks/:task_id/start', requires(...managementRead)],
  ['POST /v1/events/iteration-tasks/:task_id/close', requires(...managementRead)],
  ['GET /v1/metrics/inaccuracy-outcomes', requires(...managementRead)],
  ['POST /v1/inaccuracy-reports', requires('query')],
  ['GET /v1/sop/catalog', requires(...managementRead)],
  ['POST /v1/sop/import', requires('content-manage')],
  ['PATCH /v1/sop/nodes/:node_id', requires('content-manage')],
  ['DELETE /v1/sop/nodes/:node_id', requires('content-manage')],
  ['PATCH /v1/content/scripts/:script_id', requires('content-manage')],
  ['DELETE /v1/content/scripts/:script_id', requires('content-manage')],
  ['GET /v1/metrics/retrieval', requires(...managementRead)],
  ['GET /v1/metrics/question', requires(...managementRead)],
  ['GET /v1/events/usage', requires(...managementRead)],
  ['GET /v1/software/releases', requires(...managementRead)],
  ['GET /v1/software/releases/current', requires(...managementRead)],

  ['GET /v1/intake/sources/:sourceId/vocabulary', requires('query')],
  ['GET /v1/intake/preview', requires('query')],
  ['POST /v1/intake/entitlements', requires('query')],
  ['GET /v1/intake/shop-directory', requires('query')],
  ['GET /v1/intake/snapshot', requires('query')],
  ['GET /v1/intake/authorization', requires(...intakeRead)],
  ['GET /v1/intake/sources', requires(...intakeRead)],

  ['GET /v1/intake/sources/:sourceId/management-context', requires('import')],
  ['GET /v1/intake/principals', requires(...grantOrImport)],
  ['GET /v1/intake/candidates', requires(...managementRead)],
  ['POST /v1/intake/sources/:sourceId/objects', requires('import')],
  ['POST /v1/intake/sources/:sourceId/candidates', requires('import')],
  ['GET /v1/intake/parse-jobs/:jobId', requires('import')],
  ['GET /v1/intake/parse-jobs/:jobId/report', requires('import')],
  ['DELETE /v1/intake/sop/candidates/:candidateId/versions/:version/rows/:rowId', requires('content-manage')],
  ['GET /v1/intake/candidates/:candidateId/versions/:version', requires(...managementRead)],
  ['GET /v1/intake/candidates/:candidateId/versions/:version/material', requires(...managementRead)],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/source-confirmation', requires('source-confirm')],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/review', requires('review')],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/review/refresh', requires('review')],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/publish', requires('publish')],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/cancel', requires('candidate-cancel')],
  ['GET /v1/intake/candidates/:candidateId/versions/:version/review', requires('review')],
  ['GET /v1/intake/candidates/:candidateId/versions/:version/quality', requires('review')],
  ['GET /v1/intake/candidates/:candidateId/versions/:version/quality/samples', requires('review')],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/quality/freeze', requires('review')],
  ['POST /v1/intake/candidates/:candidateId/versions/:version/quality/checks', requires('review')],
  ['GET /v1/intake/quality/operations/:operationId', requires('review')],
  ['POST /v1/intake/rollback/preview', requires('rollback')],
  ['POST /v1/intake/rollback', requires('rollback')],
  ['POST /v1/intake/rollback/:rollbackPlanId/review', requires('review')],
  ['POST /v1/intake/rollback/:rollbackPlanId/review/refresh', requires('review')],
  ['GET /v1/intake/rollback/:rollbackPlanId/review', requires('review')],
  ['GET /v1/intake/operations/:operationId', requires(...management)],

  ['GET /v1/intake/grants', requires('grants-manage')],
  ['POST /v1/intake/grants/preview', requires('grants-manage')],
  ['POST /v1/intake/grants', requires('grants-manage')],
  ['PATCH /v1/intake/grants/:grantId', requires('grants-manage')],
  ['GET /v1/intake/seats/administration', requires('accounts-manage')],
  ['GET /v1/intake/seats', requires('accounts-manage')],
  ['POST /v1/intake/seats', requires('accounts-manage')],
  ['POST /v1/intake/seats/:username/password', requires('accounts-manage')],
  ['DELETE /v1/intake/seats/:username', requires('accounts-manage')],
]);

export const ACCESS_AUTHENTICATED_PROJECTION_ROUTES = new Set([
  'GET /v1/access/settings',
  'GET /v1/access/query',
  'GET /v1/access/admin',
]);

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function policyForRoute(method: string, path: string, profile: AccessProfile): RoutePolicy {
  const key = routeKey(method, path);
  if (ACCESS_PUBLIC_ROUTES[profile].includes(key)) return Object.freeze({ kind: 'session' });
  const policy = PROTECTED_ROUTE_POLICIES.get(key);
  if (!policy) throw new Error(`ACCESS_ROUTE_POLICY_MISSING: ${key}`);
  if (policy.kind === 'requires' && policy.anyOf.length === 0) {
    throw new Error(`ACCESS_ROUTE_POLICY_EMPTY: ${key}`);
  }
  return policy;
}

export function assertRouteCoverage(
  routes: readonly Readonly<{ method: string; path: string }>[],
  profile: AccessProfile,
): void {
  const publicRoutes = new Set(ACCESS_PUBLIC_ROUTES[profile]);
  const registered = new Set<string>();
  for (const route of routes) {
    const key = routeKey(route.method, route.path);
    if (registered.has(key)) throw new Error(`ACCESS_ROUTE_REGISTRATION_DUPLICATE: ${key}`);
    registered.add(key);
    if (!publicRoutes.has(key)) policyForRoute(route.method, route.path, profile);
  }
  const stalePublic = [...publicRoutes].filter((entry) => !registered.has(entry));
  if (stalePublic.length > 0) throw new Error(`ACCESS_PUBLIC_ROUTE_STALE: ${stalePublic.join(',')}`);
}
