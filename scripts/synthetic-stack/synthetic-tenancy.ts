export const SYNTHETIC_STACK_TENANT = 'tenant-menokin';

type Queryable = {
  query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: readonly T[] }>;
};

export async function assertSyntheticSourceTenants(
  client: Queryable,
  sourceVersionIds: readonly string[],
): Promise<void> {
  const result = await client.query<{ source_version_id: string; tenant_id: string }>(`
    SELECT source_version_id, tenant_id
    FROM public.authoritative_source_versions
    WHERE source_version_id = ANY($1::text[])
  `, [sourceVersionIds]);
  const tenants = new Map(result.rows.map(row => [row.source_version_id, row.tenant_id]));
  for (const sourceVersionId of sourceVersionIds) {
    const tenantId = tenants.get(sourceVersionId);
    if (tenantId !== SYNTHETIC_STACK_TENANT) {
      throw new Error(
        `Synthetic source ${sourceVersionId} has tenant ${tenantId ?? 'missing'}; expected ${SYNTHETIC_STACK_TENANT}. Destroy and rebuild the synthetic stack.`,
      );
    }
  }
}
