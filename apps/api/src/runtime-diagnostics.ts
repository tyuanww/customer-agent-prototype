export const API_RUNTIME_DIAGNOSTIC_CODES = Object.freeze([
  'API_REQUEST_FAILED',
  'DATABASE_IDLE_CLIENT_FAILED',
  'DATABASE_READINESS_DEADLINE_EXCEEDED',
  'DATABASE_READINESS_PROBE_FAILED',
  'EVENT_TRANSACTION_FAILED',
  'POLICY_ADMIN_IDLE_CLIENT_FAILED',
  'POLICY_ADMIN_WRITE_FAILED',
  'POLICY_READ_FAILED',
  'READINESS_REPOSITORY_CONTRACT_FAILED',
  'SOURCE_DENIAL_AUDIT_FAILED',
] as const);

export type ApiRuntimeDiagnosticCode = (typeof API_RUNTIME_DIAGNOSTIC_CODES)[number];

export type ApiRuntimeDiagnostic = Readonly<{
  code: ApiRuntimeDiagnosticCode;
  databaseCode?: string;
}>;

export type ApiRuntimeDiagnosticSink = (diagnostic: ApiRuntimeDiagnostic) => void;

const DATABASE_CODE_PATTERN = /^[0-9A-Z]{5}$/;

function databaseCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') {
    return undefined;
  }
  return DATABASE_CODE_PATTERN.test(error.code) ? error.code : undefined;
}

/**
 * Normalize runtime failures to a small secretless vocabulary. Raw driver
 * messages, SQL and connection values never cross this boundary.
 */
export function createApiRuntimeDiagnostic(
  code: ApiRuntimeDiagnosticCode,
  error?: unknown,
): ApiRuntimeDiagnostic {
  const safeDatabaseCode = databaseCode(error);
  return Object.freeze(safeDatabaseCode ? { code, databaseCode: safeDatabaseCode } : { code });
}

export const reportApiRuntimeDiagnostic: ApiRuntimeDiagnosticSink = (diagnostic) => {
  const databaseSuffix = diagnostic.databaseCode
    ? ` database_code=${diagnostic.databaseCode}`
    : '';
  console.error(`[api] diagnostic=${diagnostic.code}${databaseSuffix}`);
};
