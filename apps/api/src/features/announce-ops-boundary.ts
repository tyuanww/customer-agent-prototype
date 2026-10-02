/**
 * Announcement and ops-loop privilege boundary for the runtime role.
 *
 * HTTP handlers stay in announce-service and ops-loop-repository. This module
 * hides the functions and the client_sync_state grant those handlers need, and
 * the schema.v1.17 comment fallback: a public comment from that generation is
 * acceptable only when the ops_loop comment still names the current database
 * version.
 *
 * Stays in apps/api. The signatures and the v1.17 exception are this
 * product's database contract, not a reusable announce framework.
 */
import type { RuntimeFunctionGrant, RuntimeRelationGrant } from '../ports/runtime-grants.js';

export const ANNOUNCE_RELATION_GRANTS = Object.freeze([
  ['client_sync_state', 'SELECT'],
] as const satisfies readonly RuntimeRelationGrant[]);

export const ANNOUNCE_FUNCTION_GRANTS = Object.freeze([
  'public.issue_snapshot_offline_lease(text,text,integer)',
  'public.validate_snapshot_offline_lease(text,text,text,text)',
  'public.read_current_announcement_with_lease(text,text,integer)',
  'public.read_snapshot_page(text,text,text,text,text,integer)',
  'public.ack_client_release(text,text,text,bigint,text)',
] as const satisfies readonly RuntimeFunctionGrant[]);

export const OPS_FUNCTION_GRANTS = Object.freeze([
  'ops_loop.record_inaccuracy_report(text,text,integer,integer,text,text,text)',
  'ops_loop.read_sop_catalog(text,text)',
  'ops_loop.import_sop_catalog(text,jsonb,text,text)',
  'ops_loop.patch_sop_node(text,integer,text,text,integer,text)',
  'ops_loop.delete_sop_node(text,integer,text)',
  'ops_loop.mutate_script(text,text,integer,text,text,timestamp with time zone,timestamp with time zone,text,text)',
  'ops_loop.read_retrieval_metrics(text,text)',
  'ops_loop.list_software_releases(text)',
  'ops_loop.current_software_release(text)',
] as const satisfies readonly RuntimeFunctionGrant[]);

/** Public schema comment left by the v1.17 generation, before ops_loop carried the version. */
export const LEGACY_PUBLIC_SCHEMA_V17_PREFIX = 'CS-AI-C11 schema.v1.17;';

export function opsLoopCommentCarriesDatabaseVersion(
  opsLoopComment: string,
  databaseVersion: string,
): boolean {
  return opsLoopComment.includes(databaseVersion);
}
