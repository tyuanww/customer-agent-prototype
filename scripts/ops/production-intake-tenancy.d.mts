import type { Client } from 'pg';

export const REPORT_SCHEMA: 'customer-agent-production-intake-tenancy/v1';
export const READ_ONLY_SNAPSHOT_SQL: 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';

export type PreflightOptions =
  | Readonly<{ ok: false; error: string }>
  | Readonly<{ ok: true; help: true }>
  | Readonly<{ ok: true; help: false; stackRoot: string }>;

export type PreflightReport = Readonly<{
  schema: typeof REPORT_SCHEMA;
  ok: boolean;
  status: 'ready' | 'blocked';
  activeBatchCount: number;
  historicalDefaultBatchCount: number;
  blockers: readonly string[];
}>;

export function parseOptions(argv: readonly string[]): PreflightOptions;
export function readStackProfile(stackRoot: string): Readonly<{
  stackRoot: string;
  databaseName: string;
  pgSocketDirectory: string;
  pgPort: number;
}>;
export function normalizeSnapshot(raw: unknown): unknown;
export function evaluateSnapshot(input: unknown): PreflightReport;
export function collectSnapshot(client: Pick<Client, 'query'>): Promise<unknown>;
