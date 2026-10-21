-- Search reads the query source set at one clock, by domain.
--
-- The plan's first shape joined content_intake.release_lineage on
-- business_entry_id. That join cannot be built: public.release_items and
-- content_intake.release_lineage are written by two disjoint publishers.
-- publish_content_release writes release_items from staging_scripts and no
-- lineage row, while the intake direct publishers write lineage and only copy
-- release_items from the base release. Their keys differ as well,
-- (release_id, script_id) against (release_id, source_id, business_entry_id),
-- so every lineage-filtered read would return zero scripts for every release
-- published through the import door.
--
-- The operator chose to gate search at the granularity both doors actually
-- carry: a grant names a scope, a scope names a domain, and an item's domain
-- comes from its authoritative source version. Publish and import already
-- gate on exactly this value, so the four doors now agree.
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- The three-argument function stays as a signature because historical migrations verify their
-- own step against a signature list that names it. It must not remain a way to read scripts
-- without a source set, so its body is replaced with a refusal and the runtime loses EXECUTE.
CREATE OR REPLACE FUNCTION public.search_recommendable_scripts(
  p_platform TEXT,
  p_product_context_type TEXT DEFAULT NULL,
  p_product_context_ref TEXT DEFAULT NULL
) RETURNS TABLE(
  is_candidate BOOLEAN,
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
  -- No caller may read scripts through the signature that cannot name the caller. The gated
  -- four-argument form below is the only way in.
  RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
END;
$$;

REVOKE ALL ON FUNCTION public.search_recommendable_scripts(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_recommendable_scripts(TEXT, TEXT, TEXT) FROM app_runtime;
ALTER FUNCTION public.search_recommendable_scripts(TEXT, TEXT, TEXT) OWNER TO cs_ai_definer;

-- No defaults on the last two parameters: a three-argument call must resolve to the refusing
-- three-argument signature, never to this one with arguments filled in.
CREATE FUNCTION public.search_recommendable_scripts(
  p_actor_user_id TEXT,
  p_platform TEXT,
  p_product_context_type TEXT,
  p_product_context_ref TEXT
) RETURNS TABLE(
  is_candidate BOOLEAN,
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
DECLARE
  v_at TIMESTAMPTZ;
  v_principal TEXT;
  v_granted INTEGER;
  v_permitted TEXT[];
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

  -- One timestamp for the principal lookup, the facts window and the source set.
  v_at := pg_catalog.clock_timestamp();
  SELECT person.principal_id INTO v_principal
  FROM content_intake.principals person
  WHERE person.user_id = p_actor_user_id;
  IF v_principal IS NULL OR EXISTS (
    SELECT 1
    FROM content_intake.principals person
    JOIN content_intake.principal_facts facts
      ON facts.principal_id = person.principal_id
     AND facts.facts_version = person.current_facts_version
    WHERE person.principal_id = v_principal
      AND facts.checked_at <= v_at
      AND facts.valid_until <= v_at
  ) THEN
    -- A missing principal and a closed facts window are different refusals, and
    -- the plan gives them different sentences. A closed window is checked first
    -- so a known person sees why, instead of being told to ask for access.
    IF v_principal IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '资料资格过期了，请稍后重试。', DETAIL = 'FORBIDDEN';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.authorization_sources(v_principal, 'query', v_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;

  -- The permitted source versions are resolved once, not per candidate row: the pool is
  -- read every keystroke and a correlated EXISTS would repeat the whole grant expansion
  -- for each script. The array is built from the same timestamp as the gate above.
  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT source_version.source_version_id), ARRAY[]::text[])
  INTO v_permitted
  FROM public.authoritative_source_versions source_version
  WHERE source_version.domain IN (
    SELECT scope.domain
    FROM content_intake.authorization_sources(v_principal, 'query', v_at) allowed_source
    JOIN content_intake.scopes scope ON scope.scope_id = allowed_source.scope_id
  );

  RETURN QUERY
  WITH current_context AS MATERIALIZED (
    SELECT
      current_release.current_release_id AS release_id,
      source_gate.source_binding_hash
    FROM public.content_current current_release
    JOIN public.v_release_source_gate source_gate
      ON source_gate.release_id = current_release.current_release_id
     AND source_gate.source_gate_ready
  )
  SELECT
    candidate.script_id IS NOT NULL,
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
    current_context.release_id,
    current_context.source_binding_hash
  FROM current_context
  LEFT JOIN LATERAL (
    SELECT recommendable.*
    FROM public.v_scripts_recommendable recommendable
    WHERE public.content_scope_matches(
      recommendable.platform_scope,
      recommendable.product_scope_type,
      recommendable.product_scope_refs,
      p_platform,
      p_product_context_type,
      p_product_context_ref
    )
      -- The item's domain comes from its registered source version, not from the
      -- item's category: a grant is a scope, and a scope names a domain.
      AND recommendable.source_version_id = ANY(v_permitted)
  ) candidate ON TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.search_recommendable_scripts(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT, TEXT, TEXT, TEXT) TO app_runtime;
ALTER FUNCTION public.search_recommendable_scripts(TEXT, TEXT, TEXT, TEXT) OWNER TO cs_ai_definer;

-- The gate reads the source version's domain, and authorization_sources reads the
-- intake tables directly. Both run with the definer's rights.
GRANT SELECT ON public.authoritative_source_versions TO cs_ai_definer;
