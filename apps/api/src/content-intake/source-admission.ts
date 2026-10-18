import type { QueryResult, QueryResultRow } from 'pg';

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export const ADMITTED_WORDING_DOMAINS = ['aftersale', 'campaign', 'presale', 'product'] as const;

/** One mode_version step satisfies source_scope_guard. */
export async function admitLegacyWordingSources(
  client: Queryable,
  scope: { tenantId: string; appId: string },
  sourceIds?: readonly string[],
): Promise<string[]> {
  if (sourceIds?.some(id => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) throw new Error('SOURCE_ID_INVALID');
  const { rows } = await client.query<{ source_id: string }>(`
    UPDATE content_intake.sources AS src
    SET mode = 'v2-preview', mode_version = src.mode_version + 1
    WHERE src.mode = 'legacy'
      AND ($4::text[] IS NULL OR src.source_id = ANY($4::text[]))
      AND EXISTS (
        SELECT 1 FROM content_intake.scopes AS registered
        WHERE registered.scope_id = src.scope_id
          AND registered.tenant_id = $1
          AND registered.app_id = $2
          AND registered.domain = ANY($3::text[])
      )
    RETURNING src.source_id
  `, [scope.tenantId, scope.appId, [...ADMITTED_WORDING_DOMAINS], sourceIds ? [...sourceIds] : null]);
  return rows.map(row => row.source_id).sort();
}
