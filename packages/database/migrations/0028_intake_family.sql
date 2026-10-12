-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0028_intake_family; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8
-- source_git_sha=240ae98a47d8b9432559c298f60af6fdc9ba8c4e
-- source_schema_sha256=5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013
-- Explicit family roots and deterministic applicability belong to the complete
-- catalog. Both native writers call this after constructing their whole lineage,
-- under the existing content lock/current transaction. Readers call it before
-- issuing use qualifications; it neither selects nor changes a second current.
SET LOCAL search_path = public, pg_catalog, pg_temp;
CREATE FUNCTION content_intake.assert_family_catalog(p_release TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE invalid BOOLEAN;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM content_intake.release_catalogs WHERE release_id=p_release) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT DISTINCT candidate_id,candidate_version FROM content_intake.release_lineage WHERE release_id=p_release
  ), expanded AS MATERIALIZED (
    -- Expand each candidate once even when its source contains 5,000 entries.
    SELECT c.source_id,c.candidate_id,c.version,e FROM candidates used JOIN content_intake.candidate_versions c
      ON c.candidate_id=used.candidate_id AND c.version=used.candidate_version
      CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
  ), entries AS MATERIALIZED (
    SELECT l.source_id,l.business_entry_id,k.tenant_id,k.app_id,k.brand_id,k.shop_id,k.domain,
      e->>'operation' operation,e->>'familySourceId' family_source,e->>'familyBusinessEntryId' family_entry,
      coalesce((e->>'brandNonOverridable')::boolean,false) non_overridable,
      ARRAY(SELECT ref->>'id' FROM jsonb_array_elements(e->'productRefs') ref) products,
      ARRAY(SELECT ref->>'id' FROM jsonb_array_elements(e->'scenarioRefs') ref) scenarios,
      tstzrange((e->>'effectiveFrom')::timestamptz,(e->>'effectiveTo')::timestamptz,'[)') validity
    FROM content_intake.release_lineage l JOIN expanded x ON x.source_id=l.source_id
      AND x.candidate_id=l.candidate_id AND x.version=l.candidate_version AND x.e->>'businessEntryId'=l.business_entry_id
      JOIN content_intake.sources s ON s.source_id=l.source_id JOIN content_intake.scopes k ON k.scope_id=s.scope_id
    WHERE l.release_id=p_release
  ), roots AS MATERIALIZED (
    SELECT * FROM entries WHERE shop_id IS NULL
  ), overrides AS MATERIALIZED (
    SELECT *,row_number() OVER(ORDER BY source_id,business_entry_id) item_id,
      dense_rank() OVER(ORDER BY family_source,family_entry,shop_id) family_id
    FROM entries WHERE operation='upsert' AND family_source IS NOT NULL
  ), ordered AS (
    -- Running maximum, not lag(end): a long A interval may bridge short B/C.
    SELECT *,max(coalesce(upper(validity),'infinity'::timestamptz)) OVER(
      PARTITION BY family_id ORDER BY lower(validity),item_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end
    FROM overrides
  ), components AS MATERIALIZED (
    -- Touching endpoints belong to different half-open overlap components.
    SELECT *,sum(CASE WHEN prior_end IS NULL OR prior_end<=lower(validity) THEN 1 ELSE 0 END)
      OVER(PARTITION BY family_id ORDER BY lower(validity),item_id) component
    FROM ordered
  ), group_sizes AS (
    SELECT family_id,component,count(*) n,count(*) FILTER(WHERE cardinality(products)=0) product_wildcards,
      count(*) FILTER(WHERE cardinality(scenarios)=0) scenario_wildcards
    FROM components GROUP BY family_id,component HAVING count(*)>1
  ), term_counts AS (
    SELECT family_id,component,true products_axis,term,count(*) n
      FROM components CROSS JOIN LATERAL unnest(products) term GROUP BY family_id,component,term
    UNION ALL
    SELECT family_id,component,false products_axis,term,count(*) n
      FROM components CROSS JOIN LATERAL unnest(scenarios) term GROUP BY family_id,component,term
  ), term_costs AS (
    SELECT family_id,component,products_axis,sum(n*(n-1)/2) cost FROM term_counts GROUP BY family_id,component,products_axis
  ), choices AS (
    -- Pick the lower estimated candidate-pair count, including unrestricted rows.
    -- Neither axis is always selective: all products may share disjoint scenarios.
    SELECT g.family_id,g.component,
      coalesce(p.cost,0)+g.product_wildcards*(g.n-g.product_wildcards)+g.product_wildcards*(g.product_wildcards-1)/2
      <=coalesce(s.cost,0)+g.scenario_wildcards*(g.n-g.scenario_wildcards)+g.scenario_wildcards*(g.scenario_wildcards-1)/2 products_axis
    FROM group_sizes g LEFT JOIN term_costs p ON p.family_id=g.family_id AND p.component=g.component AND p.products_axis
      LEFT JOIN term_costs s ON s.family_id=g.family_id AND s.component=g.component AND NOT s.products_axis
  ), candidates_by_component AS MATERIALIZED (
    SELECT c.*,CASE WHEN products_axis THEN products ELSE scenarios END selected_terms
    FROM components c JOIN choices USING(family_id,component)
  ), indexed_terms AS MATERIALIZED (
    SELECT c.*,term FROM candidates_by_component c CROSS JOIN LATERAL unnest(selected_terms) term
  ) SELECT EXISTS(
    SELECT 1 FROM entries child
    WHERE (child.shop_id IS NOT NULL AND child.non_overridable)
      OR ((child.family_source IS NULL)<>(child.family_entry IS NULL))
    UNION ALL
    -- Keep per-row checks separate so unassociated rows never scan candidate
    -- roots. This guard also runs for every usage page of ordinary catalogs.
    SELECT 1 FROM entries child LEFT JOIN roots root
      ON root.source_id=child.family_source AND root.business_entry_id=child.family_entry
    WHERE child.family_source IS NOT NULL AND (child.shop_id IS NULL OR root.source_id IS NULL
      OR root.family_source IS NOT NULL OR root.family_entry IS NOT NULL
      OR (child.operation='upsert' AND root.operation<>'upsert')
      OR (root.tenant_id,root.app_id,root.brand_id,root.domain) IS DISTINCT FROM (child.tenant_id,child.app_id,child.brand_id,child.domain))
    UNION ALL
    SELECT 1 FROM overrides child JOIN roots root
      ON root.source_id=child.family_source AND root.business_entry_id=child.family_entry
    WHERE root.non_overridable AND root.operation='upsert' AND root.validity && child.validity
      AND (cardinality(root.products)=0 OR cardinality(child.products)=0 OR root.products && child.products)
      AND (cardinality(root.scenarios)=0 OR cardinality(child.scenarios)=0 OR root.scenarios && child.scenarios)
    UNION ALL
    -- Equality on the selective term permits a hash/merge join instead of a
    -- dense family's quadratic array-overlap scan. Actual windows still decide.
    SELECT 1 FROM indexed_terms a JOIN indexed_terms b USING(family_id,component,term)
    WHERE a.item_id<b.item_id AND a.validity && b.validity
      AND (cardinality(a.products)=0 OR cardinality(b.products)=0 OR a.products && b.products)
      AND (cardinality(a.scenarios)=0 OR cardinality(b.scenarios)=0 OR a.scenarios && b.scenarios)
    UNION ALL
    -- Empty sets mean unrestricted; they must also meet nonempty term buckets.
    -- Emit wildcard/wildcard pairs only once, but keep either ID order for mixed.
    SELECT 1 FROM candidates_by_component a JOIN candidates_by_component b USING(family_id,component)
    WHERE cardinality(a.selected_terms)=0 AND (cardinality(b.selected_terms)>0 OR a.item_id<b.item_id)
      AND a.validity && b.validity
      AND (cardinality(a.products)=0 OR cardinality(b.products)=0 OR a.products && b.products)
      AND (cardinality(a.scenarios)=0 OR cardinality(b.scenarios)=0 OR a.scenarios && b.scenarios)
  ) OR (SELECT count(*) FROM entries)<>(SELECT count(*) FROM content_intake.release_lineage WHERE release_id=p_release)
  INTO invalid;
  IF invalid THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
END $$;

CREATE FUNCTION content_intake.publication_family_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  PERFORM content_intake.assert_family_catalog(NEW.release_id);
  RETURN NULL;
END $$;
CREATE TRIGGER publication_family_guard AFTER INSERT ON content_intake.publications
  FOR EACH ROW EXECUTE FUNCTION content_intake.publication_family_guard();
REVOKE ALL ON FUNCTION content_intake.assert_family_catalog(TEXT),content_intake.publication_family_guard() FROM PUBLIC;

-- Legacy publication can copy a native catalog, but it has no family validation
-- owner. Refuse family inheritance rather than silently dropping its relationship.
-- This read is confined to the existing non-login definer; no application ACL opens.
GRANT SELECT ON content_intake.candidate_versions TO cs_ai_definer;
DO $$
DECLARE old_body TEXT; definition TEXT; anchor TEXT;
BEGIN
  SELECT prosrc,pg_get_functiondef(oid) INTO STRICT old_body,definition FROM pg_proc
    WHERE oid='content_intake.publish_candidate(text,jsonb,jsonb)'::regprocedure;
  anchor:=$anchor$
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(c.material->'entries') e
      WHERE e->>'familySourceId' IS NOT NULL OR e->>'familyBusinessEntryId' IS NOT NULL)$anchor$;
  IF encode(public.digest(old_body,'sha256'),'hex')<>'889c551ef66f7a28b6e82f8051f3568893298bf2da0b3364148dad7381bf1950'
    OR cardinality(string_to_array(old_body,anchor))<>2 THEN RAISE EXCEPTION 'family publisher predecessor drift'; END IF;
  EXECUTE replace(definition,old_body,replace(old_body,anchor,''));

  SELECT prosrc,pg_get_functiondef(oid) INTO STRICT old_body,definition FROM pg_proc
    WHERE oid='content_intake.inherit_legacy_catalog(text,text)'::regprocedure;
  anchor:='  -- Called within the publishing transaction, under the guard''s content lock.';
  IF encode(public.digest(old_body,'sha256'),'hex')<>'162a4677d6a8ff313b451af298cc9f34dc08acffc4790954df9b52a928062775'
    OR cardinality(string_to_array(old_body,anchor))<>2 THEN RAISE EXCEPTION 'family legacy predecessor drift'; END IF;
  EXECUTE replace(definition,old_body,replace(old_body,anchor,$guard$
  IF EXISTS(SELECT 1 FROM content_intake.candidate_versions c WHERE EXISTS (
      SELECT 1 FROM content_intake.release_lineage l WHERE l.release_id=p_previous
        AND l.candidate_id=c.candidate_id AND l.candidate_version=c.version)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'entries') e
        WHERE e->>'familySourceId' IS NOT NULL OR e->>'familyBusinessEntryId' IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='legacy publisher cannot inherit explicit family',DETAIL='CONFLICT';
  END IF;
$guard$ || anchor));
END $$;
