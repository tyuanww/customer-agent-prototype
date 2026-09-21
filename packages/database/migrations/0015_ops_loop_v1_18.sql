-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0015_ops_loop_v1_18; source schema.v1.18 lines 10739-11309
-- contract_set_id=cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534
-- source_git_sha=260ef224c5340a4d26e857bd02119044dd813f9a
-- source_schema_sha256=5713f80e9abfd72592ad49955efb83cd8498ce9cd6c7be52b96c57bcde836caa
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE SCHEMA ops_loop;
REVOKE ALL ON SCHEMA ops_loop FROM PUBLIC;

CREATE TABLE ops_loop.inaccuracy_reports (
  query_id TEXT NOT NULL REFERENCES public.query_events(query_id),
  script_id TEXT NOT NULL CHECK (pg_catalog.btrim(script_id) <> '' AND pg_catalog.length(script_id) <= 128),
  actor_user_id TEXT NOT NULL CHECK (pg_catalog.btrim(actor_user_id) <> ''),
  script_version INTEGER CHECK (script_version IS NULL OR script_version >= 1),
  rank INTEGER CHECK (rank IS NULL OR rank BETWEEN 1 AND 3),
  content_hash TEXT CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (query_id, script_id)
);
CREATE INDEX inaccuracy_reports_script_created
  ON ops_loop.inaccuracy_reports (script_id, created_at DESC);

CREATE TABLE ops_loop.sop_nodes (
  node_id TEXT PRIMARY KEY CHECK (pg_catalog.btrim(node_id) <> '' AND pg_catalog.length(node_id) <= 128),
  parent_node_id TEXT REFERENCES ops_loop.sop_nodes(node_id),
  product_session_id TEXT NOT NULL CHECK (pg_catalog.btrim(product_session_id) <> '' AND pg_catalog.length(product_session_id) <= 128),
  title TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 1 AND 256),
  body TEXT NOT NULL CHECK (pg_catalog.length(body) BETWEEN 1 AND 20000),
  sort_key INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sop_nodes_session_lifecycle
  ON ops_loop.sop_nodes (product_session_id, lifecycle, sort_key, node_id);

CREATE TABLE ops_loop.script_mutations (
  mutation_id TEXT PRIMARY KEY CHECK (pg_catalog.btrim(mutation_id) <> ''),
  script_id TEXT NOT NULL CHECK (pg_catalog.btrim(script_id) <> '' AND pg_catalog.length(script_id) <= 128),
  action TEXT NOT NULL CHECK (action IN ('patch', 'delete')),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  title TEXT,
  answer_text TEXT,
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  actor_user_id TEXT NOT NULL CHECK (pg_catalog.btrim(actor_user_id) <> ''),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  review_status TEXT NOT NULL CHECK (review_status = 'pending_review'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (
      action = 'patch'
      AND title IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 1 AND 256
      AND answer_text IS NOT NULL AND pg_catalog.length(answer_text) BETWEEN 1 AND 20000
      AND effective_from IS NOT NULL
      AND (effective_to IS NULL OR effective_from < effective_to)
    ) OR (
      action = 'delete'
      AND title IS NULL AND answer_text IS NULL
      AND effective_from IS NULL AND effective_to IS NULL
    )
  )
);

CREATE TABLE ops_loop.software_release_catalog (
  catalog_id TEXT PRIMARY KEY CHECK (pg_catalog.btrim(catalog_id) <> ''),
  version TEXT NOT NULL CHECK (pg_catalog.btrim(version) <> '' AND pg_catalog.length(version) <= 64),
  platform TEXT NOT NULL CHECK (platform IN ('mac-universal', 'win-x64', 'linux-x64')),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  download_url TEXT NOT NULL CHECK (download_url ~ '^https://'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed BOOLEAN NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX software_release_one_current
  ON ops_loop.software_release_catalog ((is_current)) WHERE is_current;

CREATE OR REPLACE FUNCTION ops_loop.evidence_hash(
  p_script_version INTEGER,
  p_rank INTEGER,
  p_content_hash TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT encode(
    public.digest(
      convert_to(
        coalesce(p_script_version::text, '') || E'\n'
        || coalesce(p_rank::text, '') || E'\n'
        || coalesce(p_content_hash, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;
REVOKE ALL ON FUNCTION ops_loop.evidence_hash(INTEGER, INTEGER, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.record_inaccuracy_report(
  p_query_id TEXT,
  p_script_id TEXT,
  p_script_version INTEGER,
  p_rank INTEGER,
  p_content_hash TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(ok BOOLEAN, query_id TEXT, script_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_owner TEXT;
  v_hash TEXT;
  v_existing TEXT;
  v_count_24h INTEGER;
  v_count_7d INTEGER;
BEGIN
  IF p_actor_role NOT IN ('agent', 'coach', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'inaccuracy role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_query_id IS NULL OR pg_catalog.btrim(p_query_id) = ''
     OR p_script_id IS NULL OR pg_catalog.btrim(p_script_id) = ''
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid inaccuracy report', DETAIL = 'VALIDATION';
  END IF;

  SELECT q.user_id INTO v_owner
  FROM public.query_events q
  WHERE q.query_id = p_query_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'query not found', DETAIL = 'NOT_FOUND';
  END IF;
  IF v_owner <> p_actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'query not found', DETAIL = 'NOT_FOUND';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.candidate_impressions c
    WHERE c.query_id = p_query_id AND c.script_id = p_script_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'script is not a candidate of this query', DETAIL = 'NOT_FOUND';
  END IF;

  v_hash := ops_loop.evidence_hash(p_script_version, p_rank, p_content_hash);
  SELECT r.evidence_hash INTO v_existing
  FROM ops_loop.inaccuracy_reports r
  WHERE r.query_id = p_query_id AND r.script_id = p_script_id;
  IF v_existing IS NOT NULL THEN
    IF v_existing <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'inaccuracy evidence conflict', DETAIL = 'CONFLICT';
    END IF;
    ok := true;
    query_id := p_query_id;
    script_id := p_script_id;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO ops_loop.inaccuracy_reports (
    query_id, script_id, actor_user_id, script_version, rank, content_hash, evidence_hash
  ) VALUES (
    p_query_id, p_script_id, p_actor_user_id, p_script_version, p_rank, p_content_hash, v_hash
  );

  SELECT count(*)::integer INTO v_count_24h
  FROM ops_loop.inaccuracy_reports r
  WHERE r.script_id = p_script_id AND r.created_at >= now() - interval '24 hours';
  SELECT count(*)::integer INTO v_count_7d
  FROM ops_loop.inaccuracy_reports r
  WHERE r.script_id = p_script_id AND r.created_at >= now() - interval '7 days';

  IF (v_count_24h >= 3 OR v_count_7d >= 10)
     AND NOT EXISTS (
       SELECT 1 FROM public.iteration_tasks t
       WHERE t.cluster_key = p_script_id AND t.status IN ('open', 'in_progress')
     ) THEN
    INSERT INTO public.iteration_tasks (
      task_id, signal_id, cluster_key, sample_query_ids, suspected_cause,
      suggested_script_ids, status, version
    ) VALUES (
      'itask_' || encode(public.gen_random_bytes(12), 'hex'),
      'inaccuracy:' || p_script_id,
      p_script_id,
      ARRAY[p_query_id],
      'mixed',
      ARRAY[p_script_id],
      'open',
      1
    );
  END IF;

  ok := true;
  query_id := p_query_id;
  script_id := p_script_id;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.record_inaccuracy_report(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.read_sop_catalog(
  p_product_session_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(
  node_id TEXT,
  parent_node_id TEXT,
  title TEXT,
  body TEXT,
  sort_key INTEGER,
  version INTEGER,
  lifecycle TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_actor_role NOT IN ('coach', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'sop catalog role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_product_session_id IS NULL OR pg_catalog.btrim(p_product_session_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid product session', DETAIL = 'VALIDATION';
  END IF;
  RETURN QUERY
  SELECT n.node_id, n.parent_node_id, n.title, n.body, n.sort_key, n.version, n.lifecycle
  FROM ops_loop.sop_nodes n
  WHERE n.product_session_id = p_product_session_id
  ORDER BY n.sort_key, n.node_id;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.read_sop_catalog(TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.import_sop_catalog(
  p_product_session_id TEXT,
  p_nodes JSONB,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(ok BOOLEAN, product_session_id TEXT, node_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
  v_node JSONB;
BEGIN
  IF p_actor_role NOT IN ('coach', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'sop import role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_product_session_id IS NULL OR pg_catalog.btrim(p_product_session_id) = ''
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = ''
     OR p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid sop import', DETAIL = 'VALIDATION';
  END IF;

  UPDATE ops_loop.sop_nodes n
  SET parent_node_id = NULL
  WHERE n.product_session_id = p_product_session_id;
  DELETE FROM ops_loop.sop_nodes n WHERE n.product_session_id = p_product_session_id;

  FOR v_node IN SELECT value FROM jsonb_array_elements(p_nodes)
  LOOP
    INSERT INTO ops_loop.sop_nodes (
      node_id, parent_node_id, product_session_id, title, body, sort_key, version, lifecycle
    ) VALUES (
      v_node->>'node_id',
      NULL,
      p_product_session_id,
      v_node->>'title',
      v_node->>'body',
      coalesce((v_node->>'sort_key')::integer, 0),
      1,
      'active'
    );
    v_count := v_count + 1;
  END LOOP;
  FOR v_node IN SELECT value FROM jsonb_array_elements(p_nodes)
  LOOP
    IF NULLIF(v_node->>'parent_node_id', '') IS NOT NULL THEN
      UPDATE ops_loop.sop_nodes
      SET parent_node_id = v_node->>'parent_node_id'
      WHERE node_id = v_node->>'node_id'
        AND product_session_id = p_product_session_id;
    END IF;
  END LOOP;

  ok := true;
  product_session_id := p_product_session_id;
  node_count := v_count;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.import_sop_catalog(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.patch_sop_node(
  p_node_id TEXT,
  p_expected_version INTEGER,
  p_title TEXT,
  p_body TEXT,
  p_sort_key INTEGER,
  p_actor_role TEXT
) RETURNS ops_loop.sop_nodes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result ops_loop.sop_nodes;
BEGIN
  IF p_actor_role NOT IN ('coach', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'sop patch role denied', DETAIL = 'FORBIDDEN';
  END IF;
  UPDATE ops_loop.sop_nodes
  SET title = coalesce(p_title, title),
      body = coalesce(p_body, body),
      sort_key = coalesce(p_sort_key, sort_key),
      version = version + 1,
      updated_at = now()
  WHERE node_id = p_node_id
    AND lifecycle = 'active'
    AND version = p_expected_version
  RETURNING * INTO result;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM ops_loop.sop_nodes WHERE node_id = p_node_id AND lifecycle = 'active') THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'sop node not found', DETAIL = 'NOT_FOUND';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'sop node version conflict', DETAIL = 'VERSION_OR_STATUS_CONFLICT';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.patch_sop_node(TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.delete_sop_node(
  p_node_id TEXT,
  p_expected_version INTEGER,
  p_actor_role TEXT
) RETURNS ops_loop.sop_nodes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result ops_loop.sop_nodes;
BEGIN
  IF p_actor_role <> 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'sop delete role denied', DETAIL = 'FORBIDDEN';
  END IF;
  UPDATE ops_loop.sop_nodes
  SET lifecycle = 'deleted',
      version = version + 1,
      updated_at = now()
  WHERE node_id = p_node_id
    AND lifecycle = 'active'
    AND version = p_expected_version
  RETURNING * INTO result;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM ops_loop.sop_nodes WHERE node_id = p_node_id AND lifecycle = 'active') THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'sop node not found', DETAIL = 'NOT_FOUND';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'sop node version conflict', DETAIL = 'VERSION_OR_STATUS_CONFLICT';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.delete_sop_node(TEXT, INTEGER, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.mutate_script(
  p_script_id TEXT,
  p_action TEXT,
  p_expected_version INTEGER,
  p_title TEXT,
  p_answer_text TEXT,
  p_effective_from TIMESTAMPTZ,
  p_effective_to TIMESTAMPTZ,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(ok BOOLEAN, script_id TEXT, mutation_id TEXT, review_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_version INTEGER;
  v_mutation TEXT;
BEGIN
  IF p_actor_role <> 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'script mutate role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_action NOT IN ('patch', 'delete')
     OR p_script_id IS NULL OR pg_catalog.btrim(p_script_id) = ''
     OR p_expected_version IS NULL
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid script mutation', DETAIL = 'VALIDATION';
  END IF;

  SELECT s.version INTO v_version
  FROM public.scripts s
  JOIN public.release_items ri ON ri.script_id = s.script_id
  JOIN public.content_current cc ON cc.current_release_id = ri.release_id
  WHERE s.script_id = p_script_id;
  IF v_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'script not in current release', DETAIL = 'NOT_FOUND';
  END IF;
  IF v_version <> p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'script version conflict', DETAIL = 'VERSION_OR_STATUS_CONFLICT';
  END IF;

  v_mutation := 'smut_' || encode(public.gen_random_bytes(12), 'hex');
  INSERT INTO ops_loop.script_mutations (
    mutation_id, script_id, action, expected_version, title, answer_text,
    effective_from, effective_to, actor_user_id, review_status
  ) VALUES (
    v_mutation,
    p_script_id,
    p_action,
    p_expected_version,
    CASE WHEN p_action = 'patch' THEN p_title END,
    CASE WHEN p_action = 'patch' THEN p_answer_text END,
    CASE WHEN p_action = 'patch' THEN p_effective_from END,
    CASE WHEN p_action = 'patch' THEN p_effective_to END,
    p_actor_user_id,
    'pending_review'
  );

  ok := true;
  script_id := p_script_id;
  mutation_id := v_mutation;
  review_status := 'pending_review';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.mutate_script(TEXT, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.read_retrieval_metrics(
  p_window TEXT,
  p_actor_role TEXT
) RETURNS TABLE(
  no_hit_rate NUMERIC,
  copy_complete_rate NUMERIC,
  open_task_count INTEGER,
  current_release_script_count INTEGER,
  metric_window TEXT,
  release_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_release TEXT;
  v_queries NUMERIC;
  v_no_hit NUMERIC;
  v_copied NUMERIC;
BEGIN
  IF p_actor_role NOT IN ('coach', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'retrieval metrics role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_window NOT IN ('current_release', 'last_7d') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid retrieval window', DETAIL = 'VALIDATION';
  END IF;

  SELECT cc.current_release_id INTO v_release FROM public.content_current cc WHERE cc.id = 1;

  SELECT count(*)::numeric,
         count(*) FILTER (WHERE q.hit_status = 'no_hit')::numeric
  INTO v_queries, v_no_hit
  FROM public.query_events q
  WHERE (p_window = 'last_7d' AND q.created_at >= now() - interval '7 days')
     OR (p_window = 'current_release' AND v_release IS NOT NULL AND q.release_id = v_release);

  SELECT count(*)::numeric INTO v_copied
  FROM public.adoption_events a
  JOIN public.query_events q ON q.query_id = a.query_id
  WHERE a.outcome = 'adopted'
    AND (
      (p_window = 'last_7d' AND a.created_at >= now() - interval '7 days')
      OR (p_window = 'current_release' AND v_release IS NOT NULL AND q.release_id = v_release)
    );

  no_hit_rate := CASE WHEN v_queries > 0 THEN round(v_no_hit / v_queries, 6) ELSE 0 END;
  copy_complete_rate := CASE WHEN v_queries > 0 THEN round(v_copied / v_queries, 6) ELSE 0 END;
  SELECT count(*)::integer INTO open_task_count
  FROM public.iteration_tasks t
  WHERE t.status IN ('open', 'in_progress');
  SELECT count(*)::integer INTO current_release_script_count
  FROM public.release_items ri
  WHERE v_release IS NOT NULL AND ri.release_id = v_release;
  metric_window := p_window;
  release_id := v_release;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.read_retrieval_metrics(TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.list_software_releases(p_actor_role TEXT)
RETURNS TABLE(
  version TEXT,
  platform TEXT,
  sha256 TEXT,
  download_url TEXT,
  created_at TIMESTAMPTZ,
  signed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_actor_role <> 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'software catalog role denied', DETAIL = 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT c.version, c.platform, c.sha256, c.download_url, c.created_at, c.signed
  FROM ops_loop.software_release_catalog c
  ORDER BY c.created_at DESC, c.version DESC;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.list_software_releases(TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_loop.current_software_release(p_actor_role TEXT)
RETURNS ops_loop.software_release_catalog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result ops_loop.software_release_catalog;
BEGIN
  IF p_actor_role <> 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'software catalog role denied', DETAIL = 'FORBIDDEN';
  END IF;
  SELECT * INTO result FROM ops_loop.software_release_catalog c WHERE c.is_current LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'no current software release', DETAIL = 'NOT_FOUND';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION ops_loop.current_software_release(TEXT) FROM PUBLIC;

GRANT CREATE ON SCHEMA ops_loop TO cs_ai_definer;
ALTER FUNCTION ops_loop.evidence_hash(INTEGER, INTEGER, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.record_inaccuracy_report(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.read_sop_catalog(TEXT, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.import_sop_catalog(TEXT, JSONB, TEXT, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.patch_sop_node(TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.delete_sop_node(TEXT, INTEGER, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.mutate_script(TEXT, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.read_retrieval_metrics(TEXT, TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.list_software_releases(TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION ops_loop.current_software_release(TEXT) OWNER TO cs_ai_definer;
ALTER TABLE ops_loop.inaccuracy_reports OWNER TO cs_ai_definer;
ALTER TABLE ops_loop.sop_nodes OWNER TO cs_ai_definer;
ALTER TABLE ops_loop.script_mutations OWNER TO cs_ai_definer;
ALTER TABLE ops_loop.software_release_catalog OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA ops_loop FROM cs_ai_definer;

REVOKE ALL ON ALL TABLES IN SCHEMA ops_loop FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops_loop FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
GRANT USAGE ON SCHEMA ops_loop TO cs_ai_definer, app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ops_loop TO cs_ai_definer;
GRANT INSERT ON public.iteration_tasks TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION ops_loop.record_inaccuracy_report(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.read_sop_catalog(TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.import_sop_catalog(TEXT, JSONB, TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.patch_sop_node(TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.delete_sop_node(TEXT, INTEGER, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.mutate_script(TEXT, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.read_retrieval_metrics(TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.list_software_releases(TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION ops_loop.current_software_release(TEXT) TO app_runtime;
COMMENT ON SCHEMA ops_loop IS 'CS-AI-C11 schema.v1.18 ops-loop; app_runtime has no backing-table SELECT; runtime_activated remains false';
