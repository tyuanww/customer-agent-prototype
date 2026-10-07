import type { Client } from 'pg';

export type FamilyEntry = {
  source: string; id: string; shop?: string | null; brand?: string; domain?: string; tenant?: string; app?: string;
  familySourceId?: string | null; familyBusinessEntryId?: string | null; operation?: string;
  brandNonOverridable?: boolean; products?: string[]; scenarios?: string[]; from?: string; to?: string | null;
};

/** Seeds otherwise unreachable historical corruption for the complete-catalog guard.
 * Only this transaction's FK/immutability triggers are suspended; the guard itself
 * runs normally against real PG relations. Public writer tests live with the API.
 */
export async function familyCatalog(client: Client, entries: FamilyEntry[]): Promise<void> {
  await client.query('SET LOCAL session_replication_role=replica');
  await client.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ('family-release','intake-v2.1')");
  const sources = new Map<string, FamilyEntry[]>();
  for (const entry of entries) sources.set(entry.source, [...sources.get(entry.source) ?? [], entry]);
  for (const [source, rows] of sources) {
    const first = rows[0]!;
    const { tenant='family-tenant',app='family-app',brand='family-brand',shop=null,domain='presale' } = first;
    const scope = [tenant,app,brand,shop ?? 'all',domain].join(':');
    await client.query(`INSERT INTO content_intake.scopes VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [scope,tenant,app,brand,shop,domain]);
    await client.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version) VALUES($1,$2,1)`,[source,scope]);
    const material = {
      canonicalEncodingVersion:'candidate-p1.1',scope:{sourceId:source},object:{objectId:source,sha256:'a'.repeat(64)},
      sourceClaim:{fileSha256:'a'.repeat(64)},contributors:['family-actor'],baseReleaseId:null,risk:{level:'routine',explicitDisableCount:0},
      entries:rows.map(e=>({businessEntryId:e.id,scriptVersion:1,operation:e.operation ?? 'upsert',title:'相似标题不推导关联',
        familySourceId:e.familySourceId ?? null,familyBusinessEntryId:e.familyBusinessEntryId ?? null,
        brandNonOverridable:e.brandNonOverridable ?? false,productRefs:(e.products ?? []).map(id=>({id})),
        scenarioRefs:(e.scenarios ?? []).map(id=>({id})),effectiveFrom:e.from ?? '2026-01-01T00:00:00Z',effectiveTo:e.to ?? null})),
    };
    await client.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,
      file_sha256,actor_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,created_at,updated_at)
      VALUES($1,1,$1,$2,1,$1,$3,'family-actor','candidate-p1.1',$4::text,$4::text::jsonb,'routine',0,now(),now())`,
    [source,scope,'a'.repeat(64),JSON.stringify(material)]);
    await client.query(`INSERT INTO content_intake.release_lineage SELECT 'family-release',$1,id,1,$1,1,'family-review','infinity'
      FROM unnest($2::text[]) id`,[source,rows.map(e=>e.id)]);
  }
  await client.query('SET LOCAL session_replication_role=origin');
}
