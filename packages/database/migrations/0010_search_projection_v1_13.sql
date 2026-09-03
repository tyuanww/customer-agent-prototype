-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0010_search_projection_v1_13; source schema.v1.13 lines 6871-6961, 7508-7508, 7624-7624, 7666-7667
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.13-dcd50383b458
-- source_git_sha=dcd50383b458775219e1681ad9e767de7cf18517
-- source_schema_sha256=de8b7d9bdcac4ecad844025a47228ba339dad47d61861d261c492cb16a1aea02
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- The only app_runtime-readable search boundary. Scope is a mandatory function argument, so a caller
-- cannot accidentally omit a WHERE clause and broaden platform/category/SKU visibility. app_runtime
-- has neither SELECT on this backing view nor on release_items/content_current. The function exposes
-- only the public question projection plus precomputed search evidence required by SearchBackend;
-- reviewer/source lineage and the original questions_json remain behind the DEFINER boundary.
DROP FUNCTION IF EXISTS search_recommendable_scripts(TEXT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION search_recommendable_scripts(
  p_platform TEXT,
  p_product_context_type TEXT DEFAULT NULL,
  p_product_context_ref TEXT DEFAULT NULL
) RETURNS TABLE(
  script_id TEXT,
  script_version INTEGER,
  content_hash TEXT,
  title TEXT,
  category TEXT,
  answer_text TEXT,
  platform_scope TEXT[],
  product_scope_type TEXT,
  product_scope_refs TEXT[],
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  intent_taxonomy_version TEXT,
  intent_id TEXT,
  risk_level TEXT,
  risk_categories TEXT[],
  has_conflict BOOLEAN,
  placeholder_keys TEXT[],
  questions JSONB,
  search_document TSVECTOR,
  search_fallback_text TEXT,
  release_id TEXT,
  source_binding_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_platform IS NULL OR p_platform NOT IN ('qianniu','douyin') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'a confirmed platform is required for search', DETAIL = 'SEARCH_SCOPE_INVALID';
  END IF;
  IF NOT (
    (p_product_context_type IS NULL AND p_product_context_ref IS NULL)
    OR (
      p_product_context_type IN ('category','sku')
      AND p_product_context_ref IS NOT NULL
      AND pg_catalog.btrim(p_product_context_ref) <> ''
      AND pg_catalog.length(p_product_context_ref) <= 128
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'product context type and ref must be supplied together', DETAIL = 'SEARCH_SCOPE_INVALID';
  END IF;

  RETURN QUERY
  SELECT
    candidate.script_id,
    candidate.version,
    candidate.content_hash,
    candidate.title,
    candidate.category,
    candidate.answer_text,
    candidate.platform_scope,
    candidate.product_scope_type,
    candidate.product_scope_refs,
    candidate.effective_from,
    candidate.effective_to,
    candidate.intent_taxonomy_version,
    candidate.intent_id,
    candidate.risk_level,
    candidate.risk_categories,
    candidate.has_conflict,
    candidate.placeholder_keys,
    public.content_public_questions(candidate.questions_json),
    candidate.search_document,
    candidate.search_fallback_text,
    candidate.release_id,
    candidate.source_binding_hash
  FROM public.v_scripts_recommendable candidate
  WHERE public.content_scope_matches(
    candidate.platform_scope,
    candidate.product_scope_type,
    candidate.product_scope_refs,
    p_platform,
    p_product_context_type,
    p_product_context_ref
  );
END;
$$;
REVOKE ALL ON FUNCTION search_recommendable_scripts(TEXT,TEXT,TEXT) FROM PUBLIC;
ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT) TO app_runtime;
COMMENT ON SCHEMA public IS
  'CS-AI-C11 schema.v1.13; CR-004 immutable four-domain authoritative-source gate; DEC-042 search-runtime projection closure for scoped reads, public questions, precomputed ranking evidence, question identity/tombstone, dual review and population-bound quality evidence; reference DDL local-preflight status is recorded only by external EVD (not this DDL); immutable migration/N/N-1/application runtime/managed PostgreSQL/backup-restore/concurrency/production remain NOT_CERTIFIED; Phase1 rewrite/auto_send/training hard-off';
