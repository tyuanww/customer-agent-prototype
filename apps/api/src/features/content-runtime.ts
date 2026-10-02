/**
 * Content-import capability on the shared runtime pool.
 *
 * Hides the content-import repository wiring and the relation, column, and
 * function grants that import, preview, and work-order reads require. The
 * composition entry only sees the ContentImportRepository surface.
 *
 * Stays in apps/api. These grants name this product's content functions and
 * authoritative-source columns. They are not a generic object-store port.
 */
import type { Pool } from 'pg';
import {
  createContentImportRepository,
  type ContentImportRepository,
} from '../content-import-repository.js';
import type { ApiRuntimeDiagnosticSink } from '../runtime-diagnostics.js';
import type {
  RuntimeColumnGrant,
  RuntimeFunctionGrant,
  RuntimeRelationGrant,
} from '../ports/runtime-grants.js';

type ContentPool = Pick<Pool, 'connect'>;

export const CONTENT_RELATION_GRANTS = Object.freeze([
  ['work_order_import_batches', 'SELECT'],
  ['work_order_records', 'SELECT'],
  ['work_order_export_audits', 'SELECT'],
] as const satisfies readonly RuntimeRelationGrant[]);

export const CONTENT_COLUMN_GRANTS = Object.freeze([
  ['authoritative_source_versions', 'tenant_id', 'SELECT'],
  ['authoritative_source_versions', 'source_version_id', 'SELECT'],
  ['authoritative_source_versions', 'source_ref', 'SELECT'],
  ['authoritative_source_versions', 'domain', 'SELECT'],
  ['authoritative_source_versions', 'snapshot_sha256', 'SELECT'],
  ['authoritative_source_versions', 'use_class', 'SELECT'],
  ['authoritative_source_suspensions', 'source_version_id', 'SELECT'],
  ['authoritative_source_suspensions', 'reason_code', 'SELECT'],
  ['authoritative_source_suspensions', 'suspended_at', 'SELECT'],
] as const satisfies readonly RuntimeColumnGrant[]);

export const CONTENT_FUNCTION_GRANTS = Object.freeze([
  'public.enqueue_content_import(text,text,text,text,bigint,jsonb,text,text)',
  'public.enqueue_work_order_import(text,text,text,text,text,text,bigint,text,timestamptz,timestamptz,text,text)',
  'public.cancel_content_import(text,text,text,text)',
  'public.advance_source_snapshots(jsonb,text,text,text)',
  'public.assert_no_in_flight_content_import(text)',
  'public.cancel_actor_in_flight_imports(text,text)',
  'public.record_work_order_export(text,text,text,text,text[],integer,text,text)',
  'public.read_content_import_status(text,text,text)',
  'public.read_content_import_preview(text,text,text,text,integer)',
] as const satisfies readonly RuntimeFunctionGrant[]);

export function createContentRuntime(
  pool: ContentPool,
  diagnosticSink: ApiRuntimeDiagnosticSink,
): ContentImportRepository {
  return createContentImportRepository(pool, diagnosticSink);
}
