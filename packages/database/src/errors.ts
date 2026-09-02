export type DatabaseMigrationErrorCode =
  | 'MIGRATION_CATALOGUE_INVALID'
  | 'MIGRATION_CLIENT_INVALID'
  | 'MIGRATION_CLIENT_BUSY'
  | 'MIGRATION_SERVER_UNSUPPORTED'
  | 'MIGRATION_STATUS_FAILED'
  | 'MIGRATION_UNTRACKED_SCHEMA'
  | 'MIGRATION_LEDGER_DRIFT'
  | 'MIGRATION_LOCK_TIMEOUT'
  | 'MIGRATION_LOCK_FAILED'
  | 'MIGRATION_APPLY_FAILED'
  | 'MIGRATION_COMMIT_UNKNOWN'
  | 'MIGRATION_ROLLBACK_FAILED'
  | 'MIGRATION_LOCK_RELEASE_FAILED'
  | 'MIGRATION_VERIFY_FAILED';

export class DatabaseMigrationError extends Error {
  readonly code: DatabaseMigrationErrorCode;
  readonly migrationId: string | undefined;
  readonly databaseCode: string | undefined;
  readonly databaseDetail: string | undefined;

  constructor(
    code: DatabaseMigrationErrorCode,
    message: string,
    options: Readonly<{
      cause?: unknown;
      migrationId?: string;
      databaseCode?: string;
      databaseDetail?: string;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DatabaseMigrationError';
    this.code = code;
    this.migrationId = options.migrationId;
    this.databaseCode = options.databaseCode;
    this.databaseDetail = options.databaseDetail;
  }
}

export function databaseDiagnostic(error: unknown): Readonly<{
  code: string | undefined;
  detail: string | undefined;
}> {
  if (!error || typeof error !== 'object') return Object.freeze({ code: undefined, detail: undefined });
  const candidate = error as Readonly<{ code?: unknown; detail?: unknown }>;
  const code = typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)
    ? candidate.code
    : undefined;
  const detail = typeof candidate.detail === 'string' && /^[A-Z0-9_]{1,96}$/.test(candidate.detail)
    ? candidate.detail
    : undefined;
  return Object.freeze({ code, detail });
}
