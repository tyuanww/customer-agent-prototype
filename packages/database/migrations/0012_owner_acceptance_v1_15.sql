-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0012_owner_acceptance_v1_15; source schema.v1.15 lines 7701-8015, 8027-8071, 8081-8164, 8175-8381, 8392-9100, 9111-10164, 10171-10171
-- contract_set_id=cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701
-- source_git_sha=2c75d8e7670134e6aa95a4780ff09fe0422a65e8
-- source_schema_sha256=859c4a4757d87e642e797ad8a26cfb334c49ae7f8f263966099eb89e6750b38b
SET LOCAL search_path = public, pg_catalog, pg_temp;

DO $install$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
     OR pg_catalog.to_regclass('public.authoritative_source_versions') IS NULL
     OR pg_catalog.to_regprocedure('public.jsonb_jcs(jsonb)') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'OWNER_ACCEPTANCE_INSTALL_DENIED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_owner_acceptance_registrar') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'OWNER_ACCEPTANCE_ROLE_ALREADY_EXISTS';
  END IF;
  CREATE ROLE app_owner_acceptance_registrar NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END
$install$;

CREATE TABLE public.owner_acceptance_records (
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  record_sha256 TEXT NOT NULL CHECK (record_sha256 ~ '^[0-9a-f]{64}$'),
  owner_subject_hash TEXT NOT NULL CHECK (owner_subject_hash ~ '^[0-9a-f]{64}$'),
  record JSONB NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, record_sha256)
);
CREATE TABLE public.owner_acceptance_revocations (
  tenant_id TEXT NOT NULL,
  record_sha256 TEXT NOT NULL,
  evidence_id TEXT NOT NULL CHECK (evidence_id ~ '^EVD-[A-Z0-9-]{6,127}$'),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, record_sha256),
  FOREIGN KEY (tenant_id, record_sha256) REFERENCES public.owner_acceptance_records
);

CREATE FUNCTION public.owner_acceptance_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'OWNER_ACCEPTANCE_IMMUTABLE';
END;
$$;
CREATE TRIGGER owner_acceptance_records_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.owner_acceptance_records FOR EACH STATEMENT EXECUTE FUNCTION public.owner_acceptance_immutable();
CREATE TRIGGER owner_acceptance_revocations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.owner_acceptance_revocations FOR EACH STATEMENT EXECUTE FUNCTION public.owner_acceptance_immutable();

-- Closed JSON shapes mirror owner-acceptance.v1.schema.json at the DB trust boundary.
-- Differential synthetic tests must accompany any schema evolution.
CREATE FUNCTION public.owner_acceptance_keys(p_value JSONB, p_keys TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object'
    THEN p_value ?& p_keys AND p_value - p_keys = '{}'::jsonb ELSE FALSE END
$$;
-- Input MUST be the normalized output of content_governance_snapshot, derived from
-- actual candidate content. Removing only review metadata avoids a circular hash.
-- Closed key set deliberately fails if the upstream snapshot gains business fields.
CREATE FUNCTION public.owner_acceptance_review_input_sha256(p_snapshot JSONB, p_script_version INTEGER)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_script_version IS NULL OR p_script_version < 1
     OR NOT public.owner_acceptance_keys(p_snapshot, ARRAY[
       'answer_text','category','effective_from','effective_to','has_conflict','intent_id',
       'intent_taxonomy_version','owner_role','placeholder_keys','platform_scope',
       'primary_reviewer_id','primary_reviewer_role','primary_review_evd','product_scope_refs',
       'product_scope_type','questions','review_due_at','review_mode','risk_categories',
       'risk_level','script_id','secondary_reviewer_id','secondary_reviewer_role',
       'secondary_review_evd','source_ref','source_version_id','title'
     ]) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_INPUT_INVALID';
  END IF;
  RETURN encode(public.digest(convert_to(public.jsonb_jcs(
    (p_snapshot - ARRAY['review_mode','primary_reviewer_id','primary_reviewer_role','primary_review_evd',
      'secondary_reviewer_id','secondary_reviewer_role','secondary_review_evd'])
    || jsonb_build_object('projection_version','customer-agent/owner-acceptance-input/v1','script_version',p_script_version)
  ), 'UTF8'), 'sha256'), 'hex');
END;
$$;
CREATE FUNCTION public.owner_acceptance_instant(p_value JSONB) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_text TEXT := p_value #>> '{}'; v_time TIMESTAMPTZ;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string'
     OR v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_TIME_INVALID';
  END IF;
  v_time := v_text::timestamptz;
  IF to_char(v_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> v_text THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_TIME_INVALID';
  END IF;
  RETURN v_time;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_TIME_INVALID';
END;
$$;
CREATE FUNCTION public.owner_acceptance_validate_record(p_record JSONB) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_scope JSONB := p_record -> 'scope'; v_binding JSONB; v_item JSONB;
  v_prev TEXT := ''; v_risk JSONB; v_previous_risk TEXT;
  v_domains TEXT[] := ARRAY[]::text[]; v_versions TEXT[] := ARRAY[]::text[];
  v_accepted TIMESTAMPTZ; v_expires TIMESTAMPTZ;
BEGIN
  IF NOT public.owner_acceptance_keys(p_record, ARRAY['schema','review_mode','purpose','owner_subject_hash','approval_evidence_id','accepted_at','expires_at','scope'])
     OR p_record -> 'schema' IS DISTINCT FROM '"customer-agent/owner-acceptance/v1"'::jsonb
     OR p_record -> 'review_mode' IS DISTINCT FROM '"owner_acceptance"'::jsonb
     OR p_record -> 'purpose' IS DISTINCT FROM '"g1a_offline_only"'::jsonb
     OR jsonb_typeof(p_record -> 'owner_subject_hash') IS DISTINCT FROM 'string'
     OR (p_record ->> 'owner_subject_hash') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_record -> 'approval_evidence_id') IS DISTINCT FROM 'string'
     OR (p_record ->> 'approval_evidence_id') !~ '^EVD-[A-Z0-9-]{6,127}$'
     OR NOT public.owner_acceptance_keys(v_scope, ARRAY['source_bindings','items'])
     OR jsonb_typeof(v_scope -> 'source_bindings') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_scope -> 'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RECORD_INVALID';
  END IF;
  IF jsonb_array_length(v_scope -> 'source_bindings') <> 4
     OR jsonb_array_length(v_scope -> 'items') NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_SCOPE_INVALID';
  END IF;
  v_accepted := public.owner_acceptance_instant(p_record -> 'accepted_at');
  v_expires := public.owner_acceptance_instant(p_record -> 'expires_at');
  IF v_accepted >= v_expires THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_TIME_INVALID';
  END IF;
  FOR v_binding IN SELECT value FROM jsonb_array_elements(v_scope -> 'source_bindings') LOOP
    IF NOT public.owner_acceptance_keys(v_binding, ARRAY['domain','source_version_id','snapshot_sha256','review_due_at'])
       OR (v_binding ->> 'domain') NOT IN ('aftersale','campaign','presale','product')
       OR jsonb_typeof(v_binding -> 'domain') IS DISTINCT FROM 'string'
       OR (v_binding ->> 'domain') COLLATE "C" <= v_prev COLLATE "C"
       OR jsonb_typeof(v_binding -> 'source_version_id') IS DISTINCT FROM 'string'
       OR (v_binding ->> 'source_version_id') !~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$'
       OR (v_binding ->> 'source_version_id') = ANY(v_versions)
       OR jsonb_typeof(v_binding -> 'snapshot_sha256') IS DISTINCT FROM 'string'
       OR (v_binding ->> 'snapshot_sha256') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_SCOPE_INVALID';
    END IF;
    IF v_expires > public.owner_acceptance_instant(v_binding -> 'review_due_at') THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_TIME_INVALID';
    END IF;
    v_prev := v_binding ->> 'domain';
    v_domains := array_append(v_domains, v_prev);
    v_versions := array_append(v_versions, v_binding ->> 'source_version_id');
  END LOOP;
  v_prev := '';
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_scope -> 'items') LOOP
    IF NOT public.owner_acceptance_keys(v_item, ARRAY['script_id','script_version','domain','source_version_id','review_input_sha256','risk_level','risk_categories','has_conflict'])
       OR jsonb_typeof(v_item -> 'script_id') IS DISTINCT FROM 'string'
       OR (v_item ->> 'script_id') !~ '^[a-z][a-z0-9_-]{7,127}$'
       OR (v_item ->> 'script_id') COLLATE "C" <= v_prev COLLATE "C"
       OR jsonb_typeof(v_item -> 'script_version') IS DISTINCT FROM 'number'
       OR (v_item ->> 'script_version') !~ '^[1-9][0-9]{0,9}$'
       OR jsonb_typeof(v_item -> 'domain') IS DISTINCT FROM 'string'
       OR array_position(v_domains, v_item ->> 'domain') IS NULL
       OR v_item -> 'source_version_id' IS DISTINCT FROM to_jsonb(v_versions[array_position(v_domains, v_item ->> 'domain')])
       OR jsonb_typeof(v_item -> 'review_input_sha256') IS DISTINCT FROM 'string'
       OR (v_item ->> 'review_input_sha256') !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(v_item -> 'risk_level') IS DISTINCT FROM 'string'
       OR (v_item ->> 'risk_level') NOT IN ('low','medium','high')
       OR jsonb_typeof(v_item -> 'risk_categories') IS DISTINCT FROM 'array'
       OR v_item -> 'has_conflict' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_SCOPE_INVALID';
    END IF;
    IF (v_item ->> 'script_version')::bigint > 2147483647
       OR jsonb_array_length(v_item -> 'risk_categories') > 7
       OR ((v_item ->> 'risk_level') = 'high') <> (jsonb_array_length(v_item -> 'risk_categories') > 0) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RISK_INVALID';
    END IF;
    v_previous_risk := '';
    FOR v_risk IN SELECT value FROM jsonb_array_elements(v_item -> 'risk_categories') LOOP
      IF jsonb_typeof(v_risk) IS DISTINCT FROM 'string'
         OR (v_risk #>> '{}') NOT IN ('refund_compensation','price_discount','campaign_rules','efficacy_safety_claim','account_privacy','complaint_escalation','legal_commitment')
         OR (v_risk #>> '{}') COLLATE "C" <= v_previous_risk COLLATE "C" THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RISK_INVALID';
      END IF;
      v_previous_risk := v_risk #>> '{}';
    END LOOP;
    v_prev := v_item ->> 'script_id';
  END LOOP;
END;
$$;

-- Recheck authoritative DB facts every time, not merely the self-reported record.
CREATE FUNCTION public.owner_acceptance_sources_ready(p_tenant TEXT, p_record JSONB) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT count(*) = 4 FROM jsonb_array_elements(p_record #> '{scope,source_bindings}') b
  JOIN public.authoritative_source_versions s ON s.source_version_id = b ->> 'source_version_id'
    AND s.tenant_id = p_tenant AND s.domain = b ->> 'domain'
    AND s.snapshot_sha256 = b ->> 'snapshot_sha256' AND s.use_class = 'canonical'
    AND s.approved_at <= statement_timestamp()
    AND s.review_due_at = public.owner_acceptance_instant(b -> 'review_due_at')
    AND s.review_due_at > statement_timestamp()
  WHERE NOT EXISTS (SELECT 1 FROM public.authoritative_source_suspensions x WHERE x.source_version_id = s.source_version_id)
$$;

CREATE FUNCTION public.register_owner_acceptance(
  p_tenant TEXT, p_raw_record TEXT, p_approved_sha256 TEXT, p_expected_owner_hash TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_record JSONB; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_ISOLATION_DENIED';
  END IF;
  IF p_tenant IS NULL OR p_tenant !~ '^[a-zA-Z0-9_-]{1,128}$'
     OR p_approved_sha256 IS NULL OR p_approved_sha256 !~ '^[0-9a-f]{64}$'
     OR p_expected_owner_hash IS NULL OR p_expected_owner_hash !~ '^[0-9a-f]{64}$'
     OR p_raw_record IS NULL OR octet_length(p_raw_record) > 2097152 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RECORD_INVALID';
  END IF;
  IF encode(public.digest(convert_to(p_raw_record, 'UTF8'), 'sha256'), 'hex') <> p_approved_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_ANCHOR_MISMATCH';
  END IF;
  BEGIN
    v_record := p_raw_record::jsonb;
    PERFORM public.owner_acceptance_validate_record(v_record);
    IF public.jsonb_jcs(v_record) || E'\n' <> p_raw_record THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RECORD_INVALID';
    END IF;
  EXCEPTION WHEN invalid_text_representation OR untranslatable_character OR character_not_in_repertoire THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RECORD_INVALID';
  END;
  IF v_record ->> 'owner_subject_hash' <> p_expected_owner_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_OWNER_MISMATCH';
  END IF;
  -- Match the existing source-suspension fence first; keep one global lock order.
  PERFORM pg_advisory_xact_lock_shared(hashtext('cs_ai_content_publish'));
  -- Exclusive advisory lock serializes registration/revocation against bound uses.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant || ':' || p_approved_sha256, 0));
  IF public.owner_acceptance_instant(v_record -> 'accepted_at') > v_now
     OR public.owner_acceptance_instant(v_record -> 'expires_at') <= clock_timestamp()
     OR NOT public.owner_acceptance_sources_ready(p_tenant, v_record)
     OR EXISTS (SELECT 1 FROM public.owner_acceptance_revocations WHERE tenant_id = p_tenant AND record_sha256 = p_approved_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  INSERT INTO public.owner_acceptance_records(tenant_id, record_sha256, owner_subject_hash, record)
    VALUES(p_tenant, p_approved_sha256, p_expected_owner_hash, v_record) ON CONFLICT DO NOTHING;
  RETURN p_approved_sha256;
END;
$$;

CREATE FUNCTION public.revoke_owner_acceptance(p_tenant TEXT, p_sha256 TEXT, p_evidence TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_ISOLATION_DENIED';
  END IF;
  IF p_tenant IS NULL OR p_tenant !~ '^[a-zA-Z0-9_-]{1,128}$'
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_evidence IS NULL OR p_evidence !~ '^EVD-[A-Z0-9-]{6,127}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_RECORD_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant || ':' || p_sha256, 0));
  IF NOT EXISTS (SELECT 1 FROM public.owner_acceptance_records WHERE tenant_id = p_tenant AND record_sha256 = p_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'OWNER_ACCEPTANCE_NOT_FOUND';
  END IF;
  INSERT INTO public.owner_acceptance_revocations(tenant_id, record_sha256, evidence_id)
    VALUES(p_tenant, p_sha256, p_evidence) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.owner_acceptance_revocations WHERE tenant_id = p_tenant
      AND record_sha256 = p_sha256 AND evidence_id = p_evidence) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'OWNER_ACCEPTANCE_REVOCATION_CONFLICT';
  END IF;
END;
$$;

-- Caller must independently derive p_observed_scope from the exact candidate. This
-- internal primitive has NO app role grant and is not itself a loader/publish gate.
-- Invoke inside the consuming transaction; shared lock lasts until transaction end.
CREATE FUNCTION public.assert_owner_acceptance(
  p_tenant TEXT, p_sha256 TEXT, p_owner_hash TEXT, p_purpose TEXT, p_observed_scope JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_record JSONB;
BEGIN
  -- Repeatable-read snapshots could miss a revocation committed before our lock.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_ISOLATION_DENIED';
  END IF;
  IF p_tenant IS NULL OR p_tenant !~ '^[a-zA-Z0-9_-]{1,128}$'
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_owner_hash IS NULL OR p_owner_hash !~ '^[0-9a-f]{64}$'
     OR p_purpose IS DISTINCT FROM 'g1a_offline_only' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('cs_ai_content_publish'));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant || ':' || p_sha256, 0));
  SELECT record INTO v_record FROM public.owner_acceptance_records
    WHERE tenant_id = p_tenant AND record_sha256 = p_sha256 AND owner_subject_hash = p_owner_hash;
  IF NOT FOUND OR v_record -> 'scope' IS DISTINCT FROM p_observed_scope
     OR public.owner_acceptance_instant(v_record -> 'accepted_at') > clock_timestamp()
     OR public.owner_acceptance_instant(v_record -> 'expires_at') <= clock_timestamp()
     OR NOT public.owner_acceptance_sources_ready(p_tenant, v_record)
     OR EXISTS (SELECT 1 FROM public.owner_acceptance_revocations WHERE tenant_id = p_tenant AND record_sha256 = p_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
END;
$$;

REVOKE ALL ON public.owner_acceptance_records, public.owner_acceptance_revocations
  FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_work_order_worker, app_owner_acceptance_registrar;
REVOKE ALL ON FUNCTION public.owner_acceptance_immutable(), public.owner_acceptance_keys(JSONB,TEXT[]),
  public.owner_acceptance_review_input_sha256(JSONB,INTEGER),
  public.owner_acceptance_instant(JSONB), public.owner_acceptance_validate_record(JSONB),
  public.owner_acceptance_sources_ready(TEXT,JSONB), public.register_owner_acceptance(TEXT,TEXT,TEXT,TEXT),
  public.revoke_owner_acceptance(TEXT,TEXT,TEXT), public.assert_owner_acceptance(TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_immutable() OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_keys(JSONB,TEXT[]) OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_review_input_sha256(JSONB,INTEGER) OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_instant(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_validate_record(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_sources_ready(TEXT,JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.register_owner_acceptance(TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.revoke_owner_acceptance(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.assert_owner_acceptance(TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;
GRANT SELECT, INSERT ON public.owner_acceptance_records, public.owner_acceptance_revocations TO cs_ai_definer;
GRANT USAGE ON SCHEMA public TO app_owner_acceptance_registrar;
GRANT EXECUTE ON FUNCTION public.register_owner_acceptance(TEXT,TEXT,TEXT,TEXT),
  public.revoke_owner_acceptance(TEXT,TEXT,TEXT) TO app_owner_acceptance_registrar;
COMMENT ON TABLE public.owner_acceptance_records IS
  'Offline metadata registry candidate only; no existing SQL or runtime gate consumes this table yet.';

-- p_snapshot must be produced from the actual candidate by the existing
-- content_governance_snapshot AFTER business validation. No caller-supplied digest.
-- The record binds the review-input hash; this final hash binds the record and the
-- final review metadata. Keeping these preimages separate avoids circular hashes.
CREATE FUNCTION public.owner_acceptance_content_hash(
  p_snapshot JSONB, p_script_version INTEGER, p_record_sha256 TEXT
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
     OR p_script_version IS NULL OR p_script_version < 1
     OR p_record_sha256 IS NULL OR p_record_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_HASH_INVALID';
  END IF;
  -- Reuse the closed snapshot key contract; an upstream field addition must fail
  -- until both review-input and final-content preimages have been reviewed.
  PERFORM public.owner_acceptance_review_input_sha256(p_snapshot, p_script_version);
  IF p_snapshot -> 'review_mode' IS DISTINCT FROM '"owner_acceptance"'::jsonb
     OR p_snapshot -> 'has_conflict' IS DISTINCT FROM 'false'::jsonb
     OR jsonb_typeof(p_snapshot -> 'primary_reviewer_id') IS DISTINCT FROM 'string'
     OR (p_snapshot ->> 'primary_reviewer_id') !~ '^[0-9a-f]{64}$'
     OR p_snapshot -> 'primary_reviewer_role' IS DISTINCT FROM '"ROLE-CONTENT-LEAD"'::jsonb
     OR jsonb_typeof(p_snapshot -> 'primary_review_evd') IS DISTINCT FROM 'string'
     OR (p_snapshot ->> 'primary_review_evd') !~ '^EVD-[A-Z0-9-]{6,127}$'
     OR p_snapshot -> 'secondary_reviewer_id' IS DISTINCT FROM 'null'::jsonb
     OR p_snapshot -> 'secondary_reviewer_role' IS DISTINCT FROM 'null'::jsonb
     OR p_snapshot -> 'secondary_review_evd' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_HASH_INVALID';
  END IF;
  RETURN encode(public.digest(convert_to(public.jsonb_jcs(jsonb_build_object(
    'hash_version', 'customer-agent/owner-acceptance-content/v1',
    'script_version', p_script_version,
    'owner_acceptance_record_sha256', p_record_sha256,
    'content', p_snapshot
  )), 'UTF8'), 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.owner_acceptance_content_hash(JSONB,INTEGER,TEXT) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_content_hash(JSONB,INTEGER,TEXT) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;
COMMENT ON FUNCTION public.owner_acceptance_content_hash(JSONB,INTEGER,TEXT) IS
  'Versioned final content identity, not approval or activation; normalized actual content required, no application grant.';

-- Caller owns business validation and must construct snapshots from the actual
-- candidate via content_governance_snapshot, never from the approved record.
-- Source IDs are the independently selected package inputs, including empty domains.
-- Call in the consuming READ COMMITTED transaction: source/revocation fences from
-- assert_owner_acceptance remain held until that transaction ends.
CREATE FUNCTION public.assert_owner_acceptance_content(
  p_tenant TEXT, p_record_sha256 TEXT, p_expected_owner_hash TEXT,
  p_source_version_ids TEXT[], p_content JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_sources JSONB; v_source_map JSONB; v_items JSONB; v_entry JSONB;
  v_snapshot JSONB; v_version INTEGER; v_evidence TEXT;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_ISOLATION_DENIED';
  END IF;
  IF p_source_version_ids IS NULL OR cardinality(p_source_version_ids) <> 4
     OR (SELECT count(DISTINCT id) FROM unnest(p_source_version_ids) id) <> 4
     OR p_content IS NULL OR jsonb_typeof(p_content) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_INVALID';
  END IF;
  IF jsonb_array_length(p_content) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_INVALID';
  END IF;
  -- Read immutable source identities once. The existing assertion below checks
  -- readiness under its shared source fence, including concurrent suspensions.
  SELECT jsonb_agg(jsonb_build_object('domain',s.domain,'source_version_id',s.source_version_id,
      'snapshot_sha256',s.snapshot_sha256,'review_due_at',
      to_char(s.review_due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY s.domain COLLATE "C"),
    jsonb_object_agg(s.source_version_id,jsonb_build_object('domain',s.domain,'source_ref',s.source_ref))
    INTO v_sources,v_source_map
    FROM public.authoritative_source_versions s
    WHERE s.tenant_id = p_tenant AND s.source_version_id = ANY(p_source_version_ids);
  IF v_sources IS NULL OR jsonb_array_length(v_sources) <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_content) LOOP
    IF NOT public.owner_acceptance_keys(v_entry,ARRAY['script_version','snapshot','content_hash'])
       OR jsonb_typeof(v_entry -> 'script_version') IS DISTINCT FROM 'number'
       OR (v_entry ->> 'script_version') !~ '^[1-9][0-9]{0,9}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_INVALID';
    END IF;
    IF (v_entry ->> 'script_version')::bigint > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_INVALID';
    END IF;
    v_version := (v_entry ->> 'script_version')::integer;
    v_snapshot := v_entry -> 'snapshot';
    IF v_entry -> 'content_hash' IS DISTINCT FROM to_jsonb(public.owner_acceptance_content_hash(
         v_snapshot,v_version,p_record_sha256))
       OR jsonb_typeof(v_snapshot -> 'source_version_id') IS DISTINCT FROM 'string'
       OR NOT (v_source_map ? (v_snapshot ->> 'source_version_id'))
       OR v_snapshot -> 'category' IS DISTINCT FROM v_source_map #> ARRAY[v_snapshot ->> 'source_version_id','domain']
       OR v_snapshot -> 'source_ref' IS DISTINCT FROM v_source_map #> ARRAY[v_snapshot ->> 'source_version_id','source_ref'] THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_MISMATCH';
    END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object(
    'script_id',e #> '{snapshot,script_id}','script_version',e -> 'script_version',
    'domain',e #> '{snapshot,category}','source_version_id',e #> '{snapshot,source_version_id}',
    'review_input_sha256',public.owner_acceptance_review_input_sha256(e -> 'snapshot',(e ->> 'script_version')::integer),
    'risk_level',e #> '{snapshot,risk_level}','risk_categories',e #> '{snapshot,risk_categories}',
    'has_conflict',e #> '{snapshot,has_conflict}') ORDER BY (e #>> '{snapshot,script_id}') COLLATE "C")
    INTO v_items FROM jsonb_array_elements(p_content) e;
  PERFORM public.assert_owner_acceptance(p_tenant,p_record_sha256,p_expected_owner_hash,
    'g1a_offline_only',jsonb_build_object('source_bindings',v_sources,'items',v_items));
  -- Review metadata is intentionally excluded from review-input identity, so bind
  -- it explicitly to the trusted owner and the immutable registered evidence.
  SELECT record ->> 'approval_evidence_id' INTO v_evidence FROM public.owner_acceptance_records
    WHERE tenant_id = p_tenant AND record_sha256 = p_record_sha256;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_content) e
    WHERE e #> '{snapshot,primary_reviewer_id}' IS DISTINCT FROM to_jsonb(p_expected_owner_hash)
       OR e #> '{snapshot,primary_review_evd}' IS DISTINCT FROM to_jsonb(v_evidence)) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_CONTENT_MISMATCH';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_owner_acceptance_content(TEXT,TEXT,TEXT,TEXT[],JSONB) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.assert_owner_acceptance_content(TEXT,TEXT,TEXT,TEXT[],JSONB) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;
COMMENT ON FUNCTION public.assert_owner_acceptance_content(TEXT,TEXT,TEXT,TEXT[],JSONB) IS
  'Private exact candidate/registered scope check; actual normalized input required; same-transaction use only; no runtime activation.';

-- One owner for active-record timing, source readiness and revocation fences.
-- Both full-set admission and row storage call this within their write transaction.
CREATE FUNCTION public.owner_acceptance_active_record(
  p_tenant TEXT, p_sha256 TEXT, p_owner_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_record JSONB;
BEGIN
  -- Repeatable-read snapshots could miss a revocation committed before our lock.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_ISOLATION_DENIED';
  END IF;
  IF p_tenant IS NULL OR p_tenant !~ '^[a-zA-Z0-9_-]{1,128}$'
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_owner_hash IS NULL OR p_owner_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('cs_ai_content_publish'));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant || ':' || p_sha256, 0));
  SELECT record INTO v_record FROM public.owner_acceptance_records
    WHERE tenant_id = p_tenant AND record_sha256 = p_sha256 AND owner_subject_hash = p_owner_hash;
  IF NOT FOUND OR v_record ->> 'purpose' IS DISTINCT FROM 'g1a_offline_only'
     OR public.owner_acceptance_instant(v_record -> 'accepted_at') > clock_timestamp()
     OR public.owner_acceptance_instant(v_record -> 'expires_at') <= clock_timestamp()
     OR NOT public.owner_acceptance_sources_ready(p_tenant, v_record)
     OR EXISTS (SELECT 1 FROM public.owner_acceptance_revocations WHERE tenant_id = p_tenant AND record_sha256 = p_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  RETURN v_record;
END;
$$;
CREATE OR REPLACE FUNCTION public.assert_owner_acceptance(
  p_tenant TEXT, p_sha256 TEXT, p_owner_hash TEXT, p_purpose TEXT, p_observed_scope JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_record JSONB;
BEGIN
  IF p_purpose IS DISTINCT FROM 'g1a_offline_only' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  v_record := public.owner_acceptance_active_record(p_tenant,p_sha256,p_owner_hash);
  IF v_record -> 'scope' IS DISTINCT FROM p_observed_scope THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
END;
$$;

-- Shared review-shape policy; coalesce makes SQL NULL fail closed. Business risk,
-- questions, placeholders, source and effective-window constraints remain separate.
CREATE FUNCTION public.owner_acceptance_review_shape(
  p_risk TEXT,p_conflict BOOLEAN,p_mode TEXT,p_primary TEXT,p_role TEXT,p_evd TEXT,
  p_secondary TEXT,p_secondary_role TEXT,p_secondary_evd TEXT,p_record_sha256 TEXT
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(
    p_primary ~ '^[0-9a-f]{64}$' AND p_role = 'ROLE-CONTENT-LEAD' AND btrim(p_evd) <> ''
    AND (
      (p_mode = 'owner_acceptance' AND NOT p_conflict
        AND p_record_sha256 ~ '^[0-9a-f]{64}$' AND p_record_sha256 IS NOT NULL
        AND p_evd ~ '^EVD-[A-Z0-9-]{6,127}$'
        AND p_secondary IS NULL AND p_secondary_role IS NULL AND p_secondary_evd IS NULL)
      OR (p_record_sha256 IS NULL AND (
        (p_mode = 'dual' AND (p_risk = 'high' OR p_conflict)
          AND p_secondary ~ '^[0-9a-f]{64}$' AND p_secondary <> p_primary
          AND p_secondary_role = 'ROLE-CS-MANAGER' AND btrim(p_secondary_evd) <> '')
        OR (p_mode = 'single' AND p_risk IN ('low','medium') AND NOT p_conflict
          AND p_secondary IS NULL AND p_secondary_role IS NULL AND p_secondary_evd IS NULL)
      ))
    ), FALSE)
$$;

ALTER TABLE public.scripts ADD COLUMN owner_acceptance_record_sha256 TEXT;
ALTER TABLE public.staging_scripts ADD COLUMN owner_acceptance_record_sha256 TEXT;
ALTER TABLE public.staging_scripts ADD COLUMN script_version INTEGER;
ALTER TABLE public.release_items ADD COLUMN owner_acceptance_record_sha256 TEXT;
ALTER TABLE public.scripts DROP CONSTRAINT scripts_review_mode_check,
  DROP CONSTRAINT scripts_review_shape,
  ADD CONSTRAINT scripts_review_shape CHECK (public.owner_acceptance_review_shape(risk_level,has_conflict,review_mode,
      primary_reviewer_id,primary_reviewer_role,primary_review_evd,
      secondary_reviewer_id,secondary_reviewer_role,secondary_review_evd,
      owner_acceptance_record_sha256));
ALTER TABLE public.release_items DROP CONSTRAINT release_items_review_mode_check,
  DROP CONSTRAINT release_review_shape,
  ADD CONSTRAINT release_review_shape CHECK (public.owner_acceptance_review_shape(risk_level,has_conflict,review_mode,
      primary_reviewer_id,primary_reviewer_role,primary_review_evd,
      secondary_reviewer_id,secondary_reviewer_role,secondary_review_evd,
      owner_acceptance_record_sha256));
ALTER TABLE public.staging_scripts DROP CONSTRAINT staging_operation_shape,
  ADD CONSTRAINT staging_operation_shape CHECK (
    (
      operation = 'withdraw'
      AND title IS NULL AND answer_text IS NULL AND content_hash IS NULL
      AND owner_role IS NULL AND review_due_at IS NULL
      AND platform_scope IS NULL AND product_scope_type IS NULL AND product_scope_refs IS NULL
      AND campaign_tag IS NULL
      AND effective_from IS NULL AND effective_to IS NULL
      AND intent_taxonomy_version IS NULL AND intent_id IS NULL
      AND risk_level IS NULL AND risk_categories IS NULL
      AND has_conflict IS NULL AND review_mode IS NULL
      AND owner_acceptance_record_sha256 IS NULL AND script_version IS NULL
      AND primary_reviewer_id IS NULL AND primary_reviewer_role IS NULL
      AND primary_review_evd IS NULL
      AND secondary_reviewer_id IS NULL AND secondary_reviewer_role IS NULL
      AND secondary_review_evd IS NULL
      AND placeholder_keys IS NULL
      AND search_document IS NULL AND search_fallback_text IS NULL
      AND pg_catalog.jsonb_array_length(questions_json) = 0
      AND quality_status = 'clean' AND quality_gate_passed
    )
    OR (
      operation = 'upsert'
      AND title IS NOT NULL AND answer_text IS NOT NULL
      AND pg_catalog.btrim(title) <> '' AND pg_catalog.btrim(answer_text) <> ''
      AND owner_role IS NOT NULL AND pg_catalog.btrim(owner_role) <> ''
      AND review_due_at IS NOT NULL
      AND effective_from IS NOT NULL
      AND (effective_to IS NULL OR effective_from < effective_to)
      AND public.content_text_array_is_nonblank_unique(platform_scope)
      AND pg_catalog.cardinality(platform_scope) > 0
      AND platform_scope <@ ARRAY['qianniu','douyin']::TEXT[]
      AND product_scope_type IN ('storewide','category','sku')
      AND public.content_text_array_is_nonblank_unique(product_scope_refs)
      AND (
        (product_scope_type = 'storewide' AND pg_catalog.cardinality(product_scope_refs) = 0)
        OR (product_scope_type IN ('category','sku') AND pg_catalog.cardinality(product_scope_refs) > 0)
      )
      AND intent_taxonomy_version IS NOT NULL AND intent_id IS NOT NULL
      AND risk_level IN ('low','medium','high') AND has_conflict IS NOT NULL
      AND public.content_risk_categories_are_valid(risk_level, risk_categories)
      AND public.owner_acceptance_review_shape(risk_level,has_conflict,review_mode,
      primary_reviewer_id,primary_reviewer_role,primary_review_evd,
      secondary_reviewer_id,secondary_reviewer_role,secondary_review_evd,
      owner_acceptance_record_sha256)
      AND public.content_template_placeholders_are_valid(answer_text, placeholder_keys)
      AND content_hash ~ '^[0-9a-f]{64}$' AND search_document IS NOT NULL
      AND pg_catalog.length(search_document) > 0
      AND search_fallback_text IS NOT NULL AND pg_catalog.btrim(search_fallback_text) <> ''
    )
  );
ALTER TABLE public.staging_scripts ADD CONSTRAINT staging_acceptance_version CHECK (
  (review_mode = 'owner_acceptance' AND script_version IS NOT NULL AND script_version >= 1)
  OR (review_mode IS DISTINCT FROM 'owner_acceptance' AND script_version IS NULL)
);

-- Normalize the actual typed row at the storage boundary. No supplied snapshot,
-- membership flag or digest can replace this observation. This guard proves one
-- approved member, not whole-set completeness: batch consumers must also call
-- assert_owner_acceptance_content with their independently selected four sources.
CREATE FUNCTION public.owner_acceptance_storage_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_snapshot JSONB; v_record JSONB; v_item JSONB; v_tenant TEXT; v_version INTEGER;
BEGIN
  IF NEW.review_mode IS DISTINCT FROM 'owner_acceptance' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'scripts' THEN
    v_version := NEW.version; v_tenant := NEW.tenant_id;
  ELSIF TG_TABLE_NAME = 'staging_scripts' THEN
    v_version := NEW.script_version;
    SELECT tenant_id INTO v_tenant FROM public.import_batches WHERE import_batch_id = NEW.import_batch_id;
  ELSIF TG_TABLE_NAME = 'release_items' THEN
    v_version := NEW.script_version;
    SELECT tenant_id INTO v_tenant FROM public.content_releases WHERE release_id = NEW.release_id;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'OWNER_ACCEPTANCE_STORAGE_DENIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.authoritative_source_versions
    WHERE source_version_id = NEW.source_version_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  v_record := public.owner_acceptance_active_record(v_tenant,NEW.owner_acceptance_record_sha256,NEW.primary_reviewer_id);
  v_snapshot := public.content_governance_snapshot(
    NEW.script_id,NEW.category,NEW.title,NEW.answer_text,NEW.source_ref,NEW.source_version_id,
    NEW.owner_role,NEW.review_due_at,NEW.platform_scope,NEW.product_scope_type,NEW.product_scope_refs,
    NEW.effective_from,NEW.effective_to,NEW.intent_taxonomy_version,NEW.intent_id,
    NEW.risk_level,NEW.risk_categories,NEW.has_conflict,NEW.review_mode,
    NEW.primary_reviewer_id,NEW.primary_reviewer_role,NEW.primary_review_evd,
    NEW.secondary_reviewer_id,NEW.secondary_reviewer_role,NEW.secondary_review_evd,
    NEW.placeholder_keys,NEW.questions_json);
  v_item := jsonb_build_object('script_id',NEW.script_id,'script_version',v_version,
    'domain',NEW.category,'source_version_id',NEW.source_version_id,
    'review_input_sha256',public.owner_acceptance_review_input_sha256(v_snapshot,v_version),
    'risk_level',NEW.risk_level,'risk_categories',v_snapshot -> 'risk_categories','has_conflict',NEW.has_conflict);
  IF NOT ((v_record #> '{scope,items}') @> jsonb_build_array(v_item))
     OR NEW.primary_review_evd IS DISTINCT FROM v_record ->> 'approval_evidence_id'
     OR NEW.content_hash IS DISTINCT FROM public.owner_acceptance_content_hash(v_snapshot,v_version,NEW.owner_acceptance_record_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_STORAGE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER owner_acceptance_storage_guard BEFORE INSERT OR UPDATE ON public.scripts
  FOR EACH ROW EXECUTE FUNCTION public.owner_acceptance_storage_guard();
CREATE TRIGGER owner_acceptance_storage_guard BEFORE INSERT OR UPDATE ON public.staging_scripts
  FOR EACH ROW EXECUTE FUNCTION public.owner_acceptance_storage_guard();
CREATE TRIGGER owner_acceptance_storage_guard BEFORE INSERT OR UPDATE ON public.release_items
  FOR EACH ROW EXECUTE FUNCTION public.owner_acceptance_storage_guard();

REVOKE ALL ON FUNCTION public.owner_acceptance_active_record(TEXT,TEXT,TEXT),
  public.owner_acceptance_review_shape(TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  public.owner_acceptance_storage_guard() FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_active_record(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_review_shape(TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_storage_guard() OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;
COMMENT ON COLUMN public.staging_scripts.script_version IS
  'Required exact approved version for owner_acceptance; legacy single/dual keep NULL until existing publish assignment.';
CREATE OR REPLACE FUNCTION record_content_quality_review_evidence(
  p_plan_id TEXT,
  p_initial_sample_reviewed_count INTEGER,
  p_initial_defect_count INTEGER,
  p_expanded_sample_reviewed_count INTEGER,
  p_expanded_defect_count INTEGER,
  p_mandatory_reviewed_count INTEGER,
  p_mandatory_defect_count INTEGER,
  p_publishable_clean_count INTEGER,
  p_review_quarantined_count INTEGER,
  p_conclusion TEXT,
  p_evidence_ref TEXT,
  p_actor_capability TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_plan public.content_quality_review_plans%ROWTYPE;
  v_existing public.content_quality_review_evidence%ROWTYPE;
  v_initial_rate NUMERIC;
  v_expanded_rate NUMERIC;
  v_expected_conclusion TEXT;
  v_final_ordinary_defects INTEGER;
BEGIN
  -- Plans are append-only and cannot be updated/deleted. A row lock would require
  -- UPDATE privilege which this definer deliberately lacks on immutable evidence.
  SELECT plan.* INTO v_plan
  FROM public.content_quality_review_plans plan
  WHERE plan.plan_id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'quality review plan not found', DETAIL = 'NOT_FOUND';
  END IF;

  -- Quality evidence is durable plan evidence, not a worker-lease heartbeat. The isolated admin
  -- workload must present its server-side capability and the frozen plan/batch must still be open.
  IF p_actor_capability IS DISTINCT FROM 'content_quality_reviewer' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'quality reviewer capability is required', DETAIL = 'FORBIDDEN';
  END IF;
  PERFORM 1
  FROM public.import_batches batch
  WHERE batch.import_batch_id = v_plan.import_batch_id
    AND batch.status = 'validating'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'quality plan batch is no longer validating', DETAIL = 'CONFLICT';
  END IF;

  IF p_initial_sample_reviewed_count IS DISTINCT FROM v_plan.initial_sample_target
     OR p_initial_defect_count IS NULL OR p_initial_defect_count < 0
     OR p_initial_defect_count > p_initial_sample_reviewed_count
     OR p_mandatory_reviewed_count IS DISTINCT FROM v_plan.mandatory_full_review_count
     OR p_mandatory_defect_count IS NULL OR p_mandatory_defect_count < 0
     OR p_mandatory_defect_count > p_mandatory_reviewed_count
     OR p_publishable_clean_count IS NULL OR p_publishable_clean_count < 0
     OR p_review_quarantined_count IS NULL OR p_review_quarantined_count < 0
     OR p_publishable_clean_count + p_review_quarantined_count <> v_plan.clean_population_count
     OR p_conclusion IS NULL OR p_conclusion NOT IN ('passed','blocked')
     OR p_evidence_ref IS NULL OR pg_catalog.btrim(p_evidence_ref) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality review evidence shape is invalid', DETAIL = 'QUALITY_EVIDENCE_INVALID';
  END IF;

  v_initial_rate := CASE
    WHEN p_initial_sample_reviewed_count = 0 THEN 0
    ELSE p_initial_defect_count::NUMERIC / p_initial_sample_reviewed_count::NUMERIC
  END;
  IF v_plan.ordinary_population_count <= 500 OR v_initial_rate <= 0.02 OR v_initial_rate > 0.05 THEN
    IF p_expanded_sample_reviewed_count IS NOT NULL OR p_expanded_defect_count IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality expansion is not permitted for this initial result', DETAIL = 'QUALITY_EVIDENCE_INVALID';
    END IF;
    v_final_ordinary_defects := p_initial_defect_count;
    v_expected_conclusion := CASE WHEN v_initial_rate > 0.05 THEN 'blocked' ELSE 'passed' END;
  ELSE
    IF p_expanded_sample_reviewed_count IS DISTINCT FROM v_plan.expanded_sample_target
       OR p_expanded_defect_count IS NULL OR p_expanded_defect_count < 0
       OR p_expanded_defect_count > p_expanded_sample_reviewed_count THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = '30 percent expanded quality sample is required', DETAIL = 'QUALITY_EXPANSION_REQUIRED';
    END IF;
    v_expanded_rate := CASE
      WHEN p_expanded_sample_reviewed_count = 0 THEN 0
      ELSE p_expanded_defect_count::NUMERIC / p_expanded_sample_reviewed_count::NUMERIC
    END;
    v_final_ordinary_defects := p_expanded_defect_count;
    v_expected_conclusion := CASE WHEN v_expanded_rate > 0.05 THEN 'blocked' ELSE 'passed' END;
  END IF;

  IF p_conclusion IS DISTINCT FROM v_expected_conclusion
     OR p_review_quarantined_count < v_final_ordinary_defects + p_mandatory_defect_count THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality conclusion does not match frozen thresholds', DETAIL = 'QUALITY_THRESHOLD_MISMATCH';
  END IF;

  INSERT INTO public.content_quality_review_evidence(
    plan_id, import_batch_id, population_manifest_hash,
    initial_sample_reviewed_count, initial_defect_count,
    expanded_sample_reviewed_count, expanded_defect_count,
    mandatory_reviewed_count, mandatory_defect_count,
    publishable_clean_count, review_quarantined_count,
    conclusion, evidence_ref, recorded_at
  ) VALUES (
    p_plan_id, v_plan.import_batch_id, v_plan.population_manifest_hash,
    p_initial_sample_reviewed_count, p_initial_defect_count,
    p_expanded_sample_reviewed_count, p_expanded_defect_count,
    p_mandatory_reviewed_count, p_mandatory_defect_count,
    p_publishable_clean_count, p_review_quarantined_count,
    p_conclusion, p_evidence_ref, pg_catalog.clock_timestamp()
  ) ON CONFLICT DO NOTHING;

  SELECT evidence.* INTO v_existing
  FROM public.content_quality_review_evidence evidence
  WHERE evidence.plan_id = p_plan_id;
  IF NOT FOUND
     OR v_existing.import_batch_id IS DISTINCT FROM v_plan.import_batch_id
     OR v_existing.population_manifest_hash IS DISTINCT FROM v_plan.population_manifest_hash
     OR v_existing.initial_sample_reviewed_count IS DISTINCT FROM p_initial_sample_reviewed_count
     OR v_existing.initial_defect_count IS DISTINCT FROM p_initial_defect_count
     OR v_existing.expanded_sample_reviewed_count IS DISTINCT FROM p_expanded_sample_reviewed_count
     OR v_existing.expanded_defect_count IS DISTINCT FROM p_expanded_defect_count
     OR v_existing.mandatory_reviewed_count IS DISTINCT FROM p_mandatory_reviewed_count
     OR v_existing.mandatory_defect_count IS DISTINCT FROM p_mandatory_defect_count
     OR v_existing.publishable_clean_count IS DISTINCT FROM p_publishable_clean_count
     OR v_existing.review_quarantined_count IS DISTINCT FROM p_review_quarantined_count
     OR v_existing.conclusion IS DISTINCT FROM p_conclusion
     OR v_existing.evidence_ref IS DISTINCT FROM p_evidence_ref THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'quality evidence was replayed with different inputs', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION record_content_quality_review_evidence(
  TEXT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finalize_content_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_import_batch_id TEXT,
  p_final_status TEXT,
  p_staging_rows JSONB DEFAULT '[]'::jsonb,
  p_error_report JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
  v_public_error_report JSONB;
  v_diagnostic_id TEXT;
  v_population_manifest_hash TEXT;
  v_persisted_population_manifest_hash TEXT;
  v_tenant TEXT;
  v_owner_group RECORD;
  v_source_ids TEXT[];
BEGIN
  IF p_final_status IS NULL OR p_final_status NOT IN ('staged', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import validation final status must be staged or failed', DETAIL = 'VALIDATION';
  END IF;
  IF pg_catalog.jsonb_typeof(p_staging_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging_rows must be a JSON array', DETAIL = 'VALIDATION';
  END IF;
  v_population_manifest_hash := public.content_quality_population_manifest_hash(p_staging_rows);
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_staging_rows) AS item(value)
    WHERE item.value ?| ARRAY[
      'review_mode','primary_reviewer_id','primary_reviewer_role','primary_review_evd',
      'secondary_reviewer_id','secondary_reviewer_role','secondary_review_evd',
      'quality_gate_passed'
    ]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'worker payload cannot self-assert review or quality decisions', DETAIL = 'REVIEW_EVIDENCE_TRUST_BOUNDARY';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_staging_rows) AS item(value)
    WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
      AND public.content_questions_align_intent(
        item.value -> 'questions_json',
        item.value ->> 'intent_taxonomy_version',
        item.value ->> 'intent_id'
      ) IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'question identity or lineage contract is invalid', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_staging_rows) AS item(value)
    WHERE coalesce(item.value ->> 'operation', 'upsert') NOT IN ('upsert','withdraw')
       OR coalesce(item.value ->> 'category', '') NOT IN ('presale','campaign','aftersale','product')
       OR coalesce(item.value ->> 'source_version_id', '') !~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
       OR (
        coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
        AND (
        coalesce(pg_catalog.btrim(item.value ->> 'owner_role'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'review_due_at'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'effective_from'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'intent_taxonomy_version'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'intent_id'), '') = ''
        OR item.value -> 'risk_categories' IS NULL
        OR coalesce(pg_catalog.btrim(item.value ->> 'quality_status'), '') = ''
        OR item.value -> 'quality_issue_codes' IS NULL
        OR coalesce(pg_catalog.btrim(item.value ->> 'questions_grams_text'), '') = ''
        OR
        coalesce(pg_catalog.btrim(item.value ->> 'title_grams_text'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'answer_grams_text'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'search_fallback_text'), '') = ''
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row requires a bound source and complete DEC-042 upsert fields', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;

  IF p_final_status = 'failed' AND pg_catalog.jsonb_array_length(p_staging_rows) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'batch-fatal validation must not persist staging rows', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;

  -- References may select an already registered approval; review metadata remains
  -- forbidden worker input and is derived exclusively from that immutable record.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_staging_rows) item
    WHERE (item ? 'owner_acceptance_record_sha256' OR item ? 'script_version') AND (
      coalesce(item ->> 'operation','upsert') <> 'upsert'
      OR jsonb_typeof(item -> 'owner_acceptance_record_sha256') IS DISTINCT FROM 'string'
      OR (item ->> 'owner_acceptance_record_sha256') !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(item -> 'script_version') IS DISTINCT FROM 'number'
      OR (item ->> 'script_version') !~ '^[1-9][0-9]{0,9}$'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_IMPORT_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_staging_rows) item
    WHERE item ? 'script_version' AND (item ->> 'script_version')::bigint > 2147483647) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'OWNER_ACCEPTANCE_IMPORT_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_staging_rows) item
    WHERE item ? 'owner_acceptance_record_sha256') THEN
    -- Match publish's source -> batch order before storage triggers acquire record
    -- fences. No source/record fence is acquired after waiting for a publish lock.
    PERFORM pg_advisory_xact_lock_shared(hashtext('cs_ai_content_publish'));
  END IF;

  -- Lock order is source (owner mode only) -> batch -> outbox.
  PERFORM 1
  FROM public.import_batches b
  WHERE b.import_batch_id = p_import_batch_id
    AND b.status = 'validating'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import batch is not validating', DETAIL = 'CONFLICT';
  END IF;

  PERFORM 1
  FROM public.outbox_jobs j
  WHERE j.job_id = p_job_id
    AND j.job_type = 'import_validate'
    AND j.status = 'running'
    AND j.lease_owner = p_lease_owner
    AND j.lease_version = p_lease_version
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
    AND j.payload ->> 'import_batch_id' = p_import_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.import_batches WHERE import_batch_id = p_import_batch_id;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_staging_rows) r(
      script_id TEXT,script_version INTEGER,owner_acceptance_record_sha256 TEXT)
    LEFT JOIN public.scripts existing ON existing.script_id = r.script_id
    WHERE r.owner_acceptance_record_sha256 IS NOT NULL
      AND (r.script_version::bigint IS DISTINCT FROM coalesce(existing.version::bigint + 1,1)
        OR (existing.script_id IS NOT NULL AND existing.tenant_id IS DISTINCT FROM v_tenant))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_IMPORT_VERSION_MISMATCH';
  END IF;

  IF p_final_status = 'staged' AND EXISTS (
    SELECT 1
    FROM public.import_batch_source_bindings ib
    JOIN public.authoritative_source_versions asv
      ON asv.source_version_id = ib.source_version_id AND asv.domain = ib.domain
    LEFT JOIN public.authoritative_source_suspensions susp
      ON susp.source_version_id = ib.source_version_id
    WHERE ib.import_batch_id = p_import_batch_id
      AND (asv.use_class <> 'canonical' OR susp.source_version_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'import source became ineligible during validation', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF p_final_status = 'staged' AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_staging_rows) r(category TEXT, source_version_id TEXT)
    LEFT JOIN public.import_batch_source_bindings ib
      ON ib.import_batch_id = p_import_batch_id
     AND ib.domain = r.category
     AND ib.source_version_id = r.source_version_id
    WHERE ib.import_batch_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row source does not match its import binding', DETAIL = 'SOURCE_DOMAIN_MISMATCH';
  END IF;
  IF p_final_status = 'staged' AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_staging_rows) r(
      operation TEXT,
      quality_status TEXT,
      intent_taxonomy_version TEXT,
      intent_id TEXT
    )
    LEFT JOIN public.intent_taxonomy_entries entry
      ON entry.intent_taxonomy_version = r.intent_taxonomy_version
     AND entry.intent_id = r.intent_id
    WHERE coalesce(r.operation, 'upsert') = 'upsert'
      AND r.quality_status = 'clean'
      AND (entry.intent_id IS NULL OR entry.lifecycle <> 'active')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'clean row must bind an active taxonomy entry', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;
  IF p_final_status = 'staged' AND NOT EXISTS (
    SELECT 1
    FROM public.content_quality_review_plans plan
    JOIN public.content_quality_review_evidence evidence ON evidence.plan_id = plan.plan_id
    WHERE plan.import_batch_id = p_import_batch_id
      AND evidence.import_batch_id = p_import_batch_id
      AND evidence.conclusion = 'passed'
      AND plan.population_manifest_hash = v_population_manifest_hash
      AND evidence.population_manifest_hash = v_population_manifest_hash
      AND plan.clean_population_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
      )
      AND plan.mandatory_full_review_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
          AND (
            item.value ->> 'risk_level' = 'high'
            OR item.value ->> 'has_conflict' = 'true'
          )
      )
      AND evidence.publishable_clean_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
          AND item.value ->> 'quality_status' = 'clean'
      )
      AND evidence.review_quarantined_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
          AND item.value ->> 'quality_status' = 'quarantined'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'frozen quality plan/evidence is missing, blocked or stale', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;

  DELETE FROM public.staging_scripts WHERE import_batch_id = p_import_batch_id;

  IF p_final_status = 'staged' THEN
    IF pg_catalog.jsonb_array_length(p_staging_rows) < 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staged import must contain at least one row', DETAIL = 'VALIDATION';
    END IF;

    -- The validator sends normalized 2-gram token streams separately so the database, rather than
    -- an untyped prebuilt tsvector, deterministically applies the frozen A/B/C field weights.
    BEGIN
      INSERT INTO public.staging_scripts(
        staging_id, import_batch_id, script_id, operation, category, title, answer_text,
        content_hash, source_ref, source_version_id, owner_role, review_due_at,
        platform_scope, product_scope_type, product_scope_refs, campaign_tag, effective_from, effective_to,
        intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode,
        primary_reviewer_id, primary_reviewer_role, primary_review_evd,
        secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd, placeholder_keys,
        questions_json, search_document, search_fallback_text, validation_ok, validation_errors,
        quality_status, quality_issue_codes, quality_gate_passed,
        owner_acceptance_record_sha256, script_version
      )
      SELECT
        r.staging_id,
        p_import_batch_id,
        r.script_id,
        coalesce(r.operation, 'upsert'),
        r.category,
        r.title,
        r.answer_text,
        r.content_hash,
        asv.source_ref,
        r.source_version_id,
        r.owner_role,
        r.review_due_at,
        r.platform_scope,
        r.product_scope_type,
        r.product_scope_refs,
        r.campaign_tag,
        r.effective_from,
        r.effective_to,
        r.intent_taxonomy_version,
        r.intent_id,
        r.risk_level,
        r.risk_categories,
        r.has_conflict,
        CASE
          WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN NULL
          WHEN acceptance.record_sha256 IS NOT NULL THEN 'owner_acceptance'
          WHEN r.risk_level = 'high' OR r.has_conflict THEN 'dual'
          ELSE 'single'
        END,
        CASE WHEN acceptance.record_sha256 IS NOT NULL THEN acceptance.owner_subject_hash ELSE lead.reviewer_subject_hash END,
        CASE WHEN acceptance.record_sha256 IS NOT NULL THEN 'ROLE-CONTENT-LEAD' ELSE lead.reviewer_role END,
        CASE WHEN acceptance.record_sha256 IS NOT NULL THEN acceptance.record ->> 'approval_evidence_id' ELSE lead.evidence_ref END,
        CASE WHEN acceptance.record_sha256 IS NULL AND (r.risk_level = 'high' OR r.has_conflict) THEN manager.reviewer_subject_hash ELSE NULL END,
        CASE WHEN acceptance.record_sha256 IS NULL AND (r.risk_level = 'high' OR r.has_conflict) THEN manager.reviewer_role ELSE NULL END,
        CASE WHEN acceptance.record_sha256 IS NULL AND (r.risk_level = 'high' OR r.has_conflict) THEN manager.evidence_ref ELSE NULL END,
        r.placeholder_keys,
        coalesce(r.questions_json, '[]'::jsonb),
        CASE
          WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN NULL
          ELSE
            pg_catalog.setweight(
              pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.questions_grams_text, '')),
              'A'
            )
            || pg_catalog.setweight(
              pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.title_grams_text, '')),
              'B'
            )
            || pg_catalog.setweight(
              pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.answer_grams_text, '')),
              'C'
            )
        END,
        r.search_fallback_text,
        TRUE,
        NULL,
        coalesce(r.quality_status, CASE WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN 'clean' ELSE 'quarantined' END),
        coalesce(r.quality_issue_codes, CASE WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN '[]'::jsonb ELSE '["CONTENT_NEEDS_REVIEW"]'::jsonb END),
        CASE
          WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN TRUE
          ELSE r.quality_status = 'clean'
        END,
        r.owner_acceptance_record_sha256,
        r.script_version
      FROM pg_catalog.jsonb_to_recordset(p_staging_rows) AS r(
        staging_id TEXT,
        script_id TEXT,
        operation TEXT,
        category TEXT,
        title TEXT,
        answer_text TEXT,
        content_hash TEXT,
        source_version_id TEXT,
        owner_role TEXT,
        review_due_at TIMESTAMPTZ,
        platform_scope TEXT[],
        product_scope_type TEXT,
        product_scope_refs TEXT[],
        campaign_tag TEXT,
        effective_from TIMESTAMPTZ,
        effective_to TIMESTAMPTZ,
        intent_taxonomy_version TEXT,
        intent_id TEXT,
        risk_level TEXT,
        risk_categories TEXT[],
        has_conflict BOOLEAN,
        placeholder_keys TEXT[],
        questions_json JSONB,
        questions_grams_text TEXT,
        title_grams_text TEXT,
        answer_grams_text TEXT,
        search_fallback_text TEXT,
        quality_status TEXT,
        quality_issue_codes JSONB,
        owner_acceptance_record_sha256 TEXT,
        script_version INTEGER
      )
      JOIN public.import_batch_source_bindings ib
        ON ib.import_batch_id = p_import_batch_id
       AND ib.domain = r.category
       AND ib.source_version_id = r.source_version_id
      JOIN public.authoritative_source_versions asv
        ON asv.source_version_id = ib.source_version_id
       AND asv.domain = ib.domain
      LEFT JOIN public.owner_acceptance_records acceptance
        ON acceptance.tenant_id = v_tenant
       AND acceptance.record_sha256 = r.owner_acceptance_record_sha256
      LEFT JOIN public.content_review_decisions lead
        ON coalesce(r.operation, 'upsert') = 'upsert'
       AND lead.script_id = r.script_id
       AND lead.content_hash = r.content_hash
       AND lead.reviewer_role = 'ROLE-CONTENT-LEAD'
       AND lead.decision = 'approved'
      LEFT JOIN public.content_review_decisions manager
        ON coalesce(r.operation, 'upsert') = 'upsert'
       AND manager.script_id = r.script_id
       AND manager.content_hash = r.content_hash
       AND manager.reviewer_role = 'ROLE-CS-MANAGER'
       AND manager.decision = 'approved'
      WHERE coalesce(r.operation, 'upsert') = 'withdraw'
         OR acceptance.record_sha256 IS NOT NULL
         OR (
           r.owner_acceptance_record_sha256 IS NULL
           AND lead.decision_id IS NOT NULL
           AND (
             (r.risk_level IN ('low','medium') AND NOT r.has_conflict)
             OR (
               (r.risk_level = 'high' OR r.has_conflict)
               AND manager.decision_id IS NOT NULL
               AND manager.reviewer_subject_key_version = lead.reviewer_subject_key_version
               AND manager.reviewer_subject_hash <> lead.reviewer_subject_hash
             )
           )
         );
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION
      WHEN data_exception OR integrity_constraint_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid staging row payload', DETAIL = 'VALIDATION';
    END;
    IF n <> pg_catalog.jsonb_array_length(p_staging_rows) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row count mismatch', DETAIL = 'VALIDATION';
    END IF;
    v_persisted_population_manifest_hash :=
      public.content_quality_staging_population_manifest_hash(p_import_batch_id);
    IF v_persisted_population_manifest_hash IS DISTINCT FROM v_population_manifest_hash THEN
      RAISE EXCEPTION USING
        ERRCODE = 'ZA001',
        MESSAGE = 'persisted staging population differs from the frozen quality population',
        DETAIL = 'QUALITY_POPULATION_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.staging_scripts s
      WHERE s.import_batch_id = p_import_batch_id
        AND s.operation = 'upsert'
        AND s.review_mode <> 'owner_acceptance'
        AND s.content_hash IS DISTINCT FROM public.content_governance_hash(
          s.script_id, s.category, s.title, s.answer_text, s.source_ref, s.source_version_id,
          s.owner_role, s.review_due_at, s.platform_scope, s.product_scope_type,
          s.product_scope_refs, s.effective_from, s.effective_to,
          s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict,
          s.review_mode, s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
          s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
          s.placeholder_keys, s.questions_json
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging governance snapshot hash mismatch', DETAIL = 'GOVERNANCE_HASH_MISMATCH';
    END IF;
    -- Row triggers prove member integrity; this independently observes the complete
    -- persisted group and batch-selected source set so omissions cannot pass.
    SELECT array_agg(source_version_id ORDER BY domain COLLATE "C") INTO v_source_ids
      FROM public.import_batch_source_bindings WHERE import_batch_id = p_import_batch_id;
    FOR v_owner_group IN
      SELECT s.owner_acceptance_record_sha256 AS anchor,s.primary_reviewer_id AS owner_hash,
        jsonb_agg(jsonb_build_object('script_version',s.script_version,'content_hash',s.content_hash,
          'snapshot',public.content_governance_snapshot(
            s.script_id,s.category,s.title,s.answer_text,s.source_ref,s.source_version_id,
            s.owner_role,s.review_due_at,s.platform_scope,s.product_scope_type,s.product_scope_refs,
            s.effective_from,s.effective_to,s.intent_taxonomy_version,s.intent_id,
            s.risk_level,s.risk_categories,s.has_conflict,s.review_mode,
            s.primary_reviewer_id,s.primary_reviewer_role,s.primary_review_evd,
            s.secondary_reviewer_id,s.secondary_reviewer_role,s.secondary_review_evd,
            s.placeholder_keys,s.questions_json)) ORDER BY s.script_id COLLATE "C") AS content
      FROM public.staging_scripts s
      WHERE s.import_batch_id = p_import_batch_id AND s.review_mode = 'owner_acceptance'
      GROUP BY s.owner_acceptance_record_sha256,s.primary_reviewer_id
      ORDER BY s.owner_acceptance_record_sha256 COLLATE "C"
    LOOP
      PERFORM public.assert_owner_acceptance_content(v_tenant,v_owner_group.anchor,
        v_owner_group.owner_hash,v_source_ids,v_owner_group.content);
    END LOOP;
    IF p_error_report IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staged import must not include error_report', DETAIL = 'VALIDATION';
    END IF;
  ELSE
    IF p_error_report IS NULL OR pg_catalog.jsonb_typeof(p_error_report) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'failed import requires an object error_report', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report - ARRAY['code','row','column','error_count','issue_codes'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report contains non-public fields', DETAIL = 'VALIDATION';
    END IF;
    IF coalesce(p_error_report ->> 'code', '') NOT IN (
      'VALIDATION_FAILED', 'SOURCE_UNREADABLE', 'HASH_MISMATCH',
      'UNSUPPORTED_FORMAT', 'STORAGE_UNAVAILABLE', 'SOURCE_NOT_ELIGIBLE',
      'SOURCE_SUSPENDED', 'SOURCE_DOMAIN_MISMATCH', 'SOURCE_SNAPSHOT_MISMATCH',
      'SOURCE_SET_INCOMPLETE', 'CONTENT_CONTRACT_INVALID', 'GOVERNANCE_HASH_MISMATCH'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report code is not allowlisted', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'row'
       AND (
         pg_catalog.jsonb_typeof(p_error_report -> 'row') IS DISTINCT FROM 'number'
         OR p_error_report ->> 'row' !~ '^[1-9][0-9]{0,8}$'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report row is invalid', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'column'
       AND (
         pg_catalog.jsonb_typeof(p_error_report -> 'column') IS DISTINCT FROM 'number'
         OR p_error_report ->> 'column' !~ '^[1-9][0-9]{0,8}$'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report column is invalid', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'error_count'
       AND (
         pg_catalog.jsonb_typeof(p_error_report -> 'error_count') IS DISTINCT FROM 'number'
         OR p_error_report ->> 'error_count' !~ '^[1-9][0-9]{0,8}$'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report error_count is invalid', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'issue_codes' THEN
      IF pg_catalog.jsonb_typeof(p_error_report -> 'issue_codes') IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_array_length(p_error_report -> 'issue_codes') > 26 THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report issue_codes is invalid', DETAIL = 'VALIDATION';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(p_error_report -> 'issue_codes') AS issue(code)
        WHERE issue.code NOT IN (
          'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_TYPE', 'INVALID_VALUE',
          'DUPLICATE_SCRIPT_ID', 'UNKNOWN_SCRIPT_ID', 'INVALID_EFFECTIVE_WINDOW',
          'MISSING_EFFECTIVE_WINDOW', 'HASH_MISMATCH', 'UNSUPPORTED_FORMAT',
          'MACRO_DETECTED', 'EXTERNAL_LINK_DETECTED', 'ROW_LIMIT_EXCEEDED',
          'CONTENT_TOO_LARGE', 'SOURCE_NOT_REGISTERED', 'SOURCE_NOT_CANONICAL',
          'SOURCE_SUSPENDED', 'SOURCE_DOMAIN_MISMATCH', 'SOURCE_SNAPSHOT_MISMATCH',
          'SOURCE_SET_INCOMPLETE', 'MISSING_PLATFORM_SCOPE', 'INVALID_PRODUCT_SCOPE',
          'INVALID_TAXONOMY_REF', 'INVALID_QUESTION_IDENTITY',
          'INVALID_REVIEW_EVIDENCE', 'INVALID_PLACEHOLDER_TEMPLATE',
          'GOVERNANCE_HASH_MISMATCH'
        )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report issue code is not allowlisted', DETAIL = 'VALIDATION';
      END IF;
      IF (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT issue.code)
        FROM pg_catalog.jsonb_array_elements_text(p_error_report -> 'issue_codes') AS issue(code)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report issue codes must be unique', DETAIL = 'VALIDATION';
      END IF;
    END IF;
    -- The database, not the worker payload, creates the public correlation token. This makes the
    -- value opaque and prevents encoded file content, paths or exception text from entering it.
    v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    v_public_error_report := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'code', p_error_report ->> 'code',
      'diagnostic_id', v_diagnostic_id,
      'row', CASE WHEN p_error_report ? 'row' THEN (p_error_report ->> 'row')::INT ELSE NULL END,
      'column', CASE WHEN p_error_report ? 'column' THEN (p_error_report ->> 'column')::INT ELSE NULL END,
      'error_count', CASE WHEN p_error_report ? 'error_count' THEN (p_error_report ->> 'error_count')::INT ELSE NULL END,
      'issue_codes', CASE WHEN p_error_report ? 'issue_codes' THEN p_error_report -> 'issue_codes' ELSE NULL END
    ));
  END IF;

  UPDATE public.import_batches
  SET status = p_final_status,
      quality_gate_passed = CASE
        WHEN p_final_status = 'staged' THEN EXISTS (
          SELECT 1 FROM public.staging_scripts s
          WHERE s.import_batch_id = p_import_batch_id
            AND s.quality_status = 'clean' AND s.quality_gate_passed
        )
        ELSE FALSE
      END,
      clean_count = CASE WHEN p_final_status = 'staged' THEN (
        SELECT pg_catalog.count(*)::INTEGER FROM public.staging_scripts s
        WHERE s.import_batch_id = p_import_batch_id AND s.quality_status = 'clean'
      ) ELSE 0 END,
      quarantined_count = CASE WHEN p_final_status = 'staged' THEN (
        SELECT pg_catalog.count(*)::INTEGER FROM public.staging_scripts s
        WHERE s.import_batch_id = p_import_batch_id AND s.quality_status = 'quarantined'
      ) ELSE 0 END,
      error_report = CASE WHEN p_final_status = 'failed' THEN v_public_error_report ELSE NULL END,
      finished_at = now()
  WHERE import_batch_id = p_import_batch_id;

  IF p_final_status = 'failed' THEN
    INSERT INTO public.change_audits(
      change_id, action, actor_role, source, metadata, created_at
    ) VALUES (
      'chg_' || pg_catalog.gen_random_uuid()::text,
      'content_import_validation_failed', 'system', 'finalize_content_import_validation',
      pg_catalog.jsonb_build_object(
        'diagnostic_id', v_diagnostic_id,
        'job_id', p_job_id,
        'import_batch_id', p_import_batch_id,
        'error_code', p_error_report ->> 'code'
      ),
      now()
    );
  END IF;

  UPDATE public.outbox_jobs
  SET status = 'done',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost before atomic finalize', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION finalize_content_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;


-- One release-level admission owner. Observe immutable persisted content and the
-- independently stored four source bindings, never a caller-supplied scope.
-- Successful owner checks keep source/record shared transaction fences; expected
-- contract denials become readiness=false, unexpected database errors propagate.
CREATE FUNCTION public.owner_acceptance_release_content_ready(p_release_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_tenant TEXT; v_source_ids TEXT[]; v_group RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.content_releases WHERE release_id = p_release_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.release_items
      WHERE release_id = p_release_id AND review_mode = 'owner_acceptance') THEN
    RETURN TRUE;
  END IF;
  SELECT array_agg(source_version_id ORDER BY domain COLLATE "C") INTO v_source_ids
    FROM public.release_source_bindings WHERE release_id = p_release_id;
  IF cardinality(v_source_ids) IS DISTINCT FROM 4 THEN RETURN FALSE; END IF;
  FOR v_group IN
    SELECT ri.owner_acceptance_record_sha256,ri.primary_reviewer_id,
      jsonb_agg(jsonb_build_object('script_version',ri.script_version,'content_hash',ri.content_hash,
        'snapshot',public.content_governance_snapshot(
          ri.script_id,ri.category,ri.title,ri.answer_text,ri.source_ref,ri.source_version_id,
          ri.owner_role,ri.review_due_at,ri.platform_scope,ri.product_scope_type,ri.product_scope_refs,
          ri.effective_from,ri.effective_to,ri.intent_taxonomy_version,ri.intent_id,
          ri.risk_level,ri.risk_categories,ri.has_conflict,ri.review_mode,
          ri.primary_reviewer_id,ri.primary_reviewer_role,ri.primary_review_evd,
          ri.secondary_reviewer_id,ri.secondary_reviewer_role,ri.secondary_review_evd,
          ri.placeholder_keys,ri.questions_json)) ORDER BY ri.script_id COLLATE "C") AS content
    FROM public.release_items ri
    WHERE ri.release_id = p_release_id AND ri.review_mode = 'owner_acceptance'
    GROUP BY ri.owner_acceptance_record_sha256,ri.primary_reviewer_id
    ORDER BY ri.owner_acceptance_record_sha256,ri.primary_reviewer_id
  LOOP
    PERFORM public.assert_owner_acceptance_content(v_tenant,v_group.owner_acceptance_record_sha256,
      v_group.primary_reviewer_id,v_source_ids,v_group.content);
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN SQLSTATE 'ZA001' OR SQLSTATE 'ZA004' THEN
  -- These are closed content/acceptance validation denials, not infrastructure errors.
  RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_acceptance_release_content_ready(TEXT) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_release_content_ready(TEXT) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;

-- Read admission relies on per-row storage membership plus immutable release
-- content: each (release,script_id) is unique, so the exact approved member count
-- proves completeness without reserializing or hashing business payloads. New
-- members still pass the storage guard; UPDATE/DELETE of release rows are denied.
CREATE FUNCTION public.owner_acceptance_release_ready(p_release_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_tenant TEXT; v_source_ids TEXT[]; v_expected_ids TEXT[]; v_group RECORD; v_record JSONB;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.content_releases WHERE release_id = p_release_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT array_agg(source_version_id ORDER BY domain COLLATE "C") INTO v_source_ids
    FROM public.release_source_bindings WHERE release_id = p_release_id;
  FOR v_group IN
    SELECT owner_acceptance_record_sha256,primary_reviewer_id,count(*) AS member_count
    FROM public.release_items WHERE release_id = p_release_id AND review_mode = 'owner_acceptance'
    GROUP BY owner_acceptance_record_sha256,primary_reviewer_id
    ORDER BY owner_acceptance_record_sha256,primary_reviewer_id
  LOOP
    v_record := public.owner_acceptance_active_record(v_tenant,v_group.owner_acceptance_record_sha256,v_group.primary_reviewer_id);
    SELECT array_agg(binding ->> 'source_version_id' ORDER BY binding ->> 'domain' COLLATE "C")
      INTO v_expected_ids FROM jsonb_array_elements(v_record #> '{scope,source_bindings}') binding;
    IF v_group.member_count <> jsonb_array_length(v_record #> '{scope,items}')
       OR v_source_ids IS DISTINCT FROM v_expected_ids THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN SQLSTATE 'ZA004' THEN
  RETURN FALSE; -- Expected lifecycle/isolation denial; never suppress infrastructure failures.
END;
$$;
REVOKE ALL ON FUNCTION public.owner_acceptance_release_ready(TEXT) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.owner_acceptance_release_ready(TEXT) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;

CREATE OR REPLACE FUNCTION public.owner_acceptance_storage_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_snapshot JSONB; v_record JSONB; v_item JSONB; v_tenant TEXT; v_version INTEGER;
BEGIN
  IF NEW.review_mode IS DISTINCT FROM 'owner_acceptance' THEN RETURN NEW; END IF;
  -- Archival only removes authoring eligibility. Never require stale evidence to
  -- retire content, and never allow an accompanying content/identity change.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'scripts' THEN
    IF NEW.status = 'archived'
       AND (to_jsonb(NEW) - ARRAY['status','updated_at']) =
           (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'scripts' THEN
    v_version := NEW.version; v_tenant := NEW.tenant_id;
  ELSIF TG_TABLE_NAME = 'staging_scripts' THEN
    v_version := NEW.script_version;
    SELECT tenant_id INTO v_tenant FROM public.import_batches WHERE import_batch_id = NEW.import_batch_id;
  ELSIF TG_TABLE_NAME = 'release_items' THEN
    v_version := NEW.script_version;
    SELECT tenant_id INTO v_tenant FROM public.content_releases WHERE release_id = NEW.release_id;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'OWNER_ACCEPTANCE_STORAGE_DENIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.authoritative_source_versions
    WHERE source_version_id = NEW.source_version_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  v_record := public.owner_acceptance_active_record(v_tenant,NEW.owner_acceptance_record_sha256,NEW.primary_reviewer_id);
  v_snapshot := public.content_governance_snapshot(
    NEW.script_id,NEW.category,NEW.title,NEW.answer_text,NEW.source_ref,NEW.source_version_id,
    NEW.owner_role,NEW.review_due_at,NEW.platform_scope,NEW.product_scope_type,NEW.product_scope_refs,
    NEW.effective_from,NEW.effective_to,NEW.intent_taxonomy_version,NEW.intent_id,
    NEW.risk_level,NEW.risk_categories,NEW.has_conflict,NEW.review_mode,
    NEW.primary_reviewer_id,NEW.primary_reviewer_role,NEW.primary_review_evd,
    NEW.secondary_reviewer_id,NEW.secondary_reviewer_role,NEW.secondary_review_evd,
    NEW.placeholder_keys,NEW.questions_json);
  v_item := jsonb_build_object('script_id',NEW.script_id,'script_version',v_version,
    'domain',NEW.category,'source_version_id',NEW.source_version_id,
    'review_input_sha256',public.owner_acceptance_review_input_sha256(v_snapshot,v_version),
    'risk_level',NEW.risk_level,'risk_categories',v_snapshot -> 'risk_categories','has_conflict',NEW.has_conflict);
  IF NOT ((v_record #> '{scope,items}') @> jsonb_build_array(v_item))
     OR NEW.primary_review_evd IS DISTINCT FROM v_record ->> 'approval_evidence_id'
     OR NEW.content_hash IS DISTINCT FROM public.owner_acceptance_content_hash(v_snapshot,v_version,NEW.owner_acceptance_record_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'OWNER_ACCEPTANCE_STORAGE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION publish_content_release(
  p_import_batch_id TEXT,
  p_title TEXT,
  p_summary TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(release_id TEXT, release_seq BIGINT, announcement_id TEXT, source_binding_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_release_id TEXT;
  v_seq BIGINT;
  v_ann TEXT;
  v_prev TEXT;
  v_base TEXT;
  v_expected_source_hash TEXT;
  v_source_hash TEXT;
  v_source_count INT;
  v_source_noncanonical BOOLEAN;
  v_source_suspended BOOLEAN;
  v_ok_count INT;
  v_publishable_upsert_count INT;
  v_quality_population_hash TEXT;
  v_batch_claimed INT;
  v_tenant TEXT;
BEGIN
  -- p_actor_role is a server-verified end-user claim used for policy/audit. DB ACL authenticates
  -- the isolated app_content_admin workload identity; the API must select that pool only after
  -- verified owner authorization. The parameter itself is not independent database authentication.
  IF p_actor_role IS DISTINCT FROM 'owner'
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'phase1 publish requires owner', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import_batch_id is required', DETAIL = 'VALIDATION';
  END IF;

  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'publish single-flight lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  PERFORM pg_catalog.set_config('app.publishing', 'on', true);

  -- Atomic compare-and-set is the publish/cancel serialization point. If cancel wins first, this
  -- touches zero rows; if publish wins first, cancel waits on the row lock and then sees publishing.
  UPDATE public.import_batches
  SET status = 'publishing'
  WHERE import_batch_id = p_import_batch_id
    AND status = 'staged';
  GET DIAGNOSTICS v_batch_claimed = ROW_COUNT;
  IF v_batch_claimed <> 1 THEN
    IF NOT EXISTS (SELECT 1 FROM public.import_batches WHERE import_batch_id = p_import_batch_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'import_batch does not exist', DETAIL = 'NOT_FOUND';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import_batch is not staged or is concurrently changing', DETAIL = 'CONFLICT';
  END IF;

  SELECT b.base_release_id, b.source_binding_hash, b.tenant_id
  INTO v_base, v_expected_source_hash, v_tenant
  FROM public.import_batches b
  WHERE b.import_batch_id = p_import_batch_id;

  SELECT c.current_release_id INTO v_prev
  FROM public.content_current c WHERE c.id = 1 FOR UPDATE;
  IF v_prev IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import was validated against a stale current release', DETAIL = 'SOURCE_BASE_RELEASE_STALE';
  END IF;

  IF EXISTS (SELECT 1 FROM public.content_releases previous
      WHERE previous.release_id = v_prev AND previous.tenant_id IS DISTINCT FROM v_tenant)
    OR EXISTS (SELECT 1 FROM public.staging_scripts staged JOIN public.scripts existing USING (script_id)
      WHERE staged.import_batch_id = p_import_batch_id AND existing.tenant_id IS DISTINCT FROM v_tenant)
    OR EXISTS (SELECT 1 FROM public.import_batch_source_bindings binding
      JOIN public.authoritative_source_versions source USING (source_version_id)
      WHERE binding.import_batch_id = p_import_batch_id AND source.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'publish tenant binding mismatch', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staging_scripts staged LEFT JOIN public.scripts existing USING (script_id)
      WHERE staged.import_batch_id = p_import_batch_id AND staged.review_mode = 'owner_acceptance'
        AND staged.script_version::bigint IS DISTINCT FROM coalesce(existing.version::bigint,0) + 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'approved version changed after import', DETAIL = 'OWNER_ACCEPTANCE_IMPORT_VERSION_MISMATCH';
  END IF;

  WITH prospective AS (
    SELECT ib.domain, ib.source_version_id
    FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id
    UNION ALL
    SELECT rb.domain, rb.source_version_id
    FROM public.release_source_bindings rb
    WHERE rb.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings ib
        WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = rb.domain
      )
  )
  SELECT
    pg_catalog.count(*)::INT,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(p.domain || ':' || p.source_version_id, '|' ORDER BY p.domain),
      'UTF8'
    ), 'sha256'), 'hex'),
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE),
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE)
  INTO v_source_count, v_source_hash, v_source_noncanonical, v_source_suspended
  FROM prospective p
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = p.source_version_id AND asv.domain = p.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = p.source_version_id;

  IF v_source_count <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'prospective release requires exactly four source domains', DETAIL = 'SOURCE_SET_INCOMPLETE';
  END IF;
  IF v_source_noncanonical THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'prospective release contains a reference-only source', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF v_source_suspended THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'prospective release contains a suspended source', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF v_source_hash IS DISTINCT FROM v_expected_source_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'prospective source set changed after enqueue', DETAIL = 'SOURCE_BINDING_HASH_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staging_scripts s
    WHERE s.import_batch_id = p_import_batch_id AND s.validation_ok IS NOT TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging has invalid rows', DETAIL = 'VALIDATION';
  END IF;

  SELECT COUNT(*) INTO v_ok_count FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok
    AND s.quality_status = 'clean'
    AND s.quality_gate_passed;
  IF v_ok_count IS NULL OR v_ok_count < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'no clean content passed the quality gate', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;
  SELECT pg_catalog.count(*)::INT INTO v_publishable_upsert_count
  FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok
    AND s.quality_status = 'clean'
    AND s.quality_gate_passed
    AND s.operation = 'upsert';
  v_quality_population_hash :=
    public.content_quality_staging_population_manifest_hash(p_import_batch_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.import_batches b
    WHERE b.import_batch_id = p_import_batch_id
      AND b.quality_gate_passed
      AND b.clean_count = v_ok_count
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'batch quality gate evidence is missing or stale', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.content_quality_review_plans plan
    JOIN public.content_quality_review_evidence evidence ON evidence.plan_id = plan.plan_id
    WHERE plan.import_batch_id = p_import_batch_id
      AND evidence.import_batch_id = p_import_batch_id
      AND plan.population_manifest_hash = v_quality_population_hash
      AND evidence.population_manifest_hash = v_quality_population_hash
      AND plan.clean_population_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM public.staging_scripts population
        WHERE population.import_batch_id = p_import_batch_id
          AND population.operation = 'upsert'
      )
      AND evidence.publishable_clean_count = v_publishable_upsert_count
      AND evidence.review_quarantined_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM public.staging_scripts quarantined
        WHERE quarantined.import_batch_id = p_import_batch_id
          AND quarantined.operation = 'upsert'
          AND quarantined.quality_status = 'quarantined'
      )
      AND evidence.conclusion = 'passed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'frozen quality review evidence has not passed', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok
      AND s.quality_status = 'clean'
      AND s.quality_gate_passed
      AND s.operation = 'withdraw'
      AND NOT EXISTS (
        SELECT 1 FROM public.release_items ri
        WHERE ri.release_id = v_prev AND ri.script_id = s.script_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'withdraw target not in current release', DETAIL = 'VALIDATION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok
      AND s.quality_status = 'clean'
      AND s.quality_gate_passed
      AND s.operation = 'upsert'
      AND (
        s.search_document IS NULL
        OR s.search_fallback_text IS NULL
        OR (s.review_mode <> 'owner_acceptance' AND s.content_hash IS DISTINCT FROM
          public.content_governance_hash(
            s.script_id, s.category, s.title, s.answer_text, s.source_ref, s.source_version_id,
            s.owner_role, s.review_due_at, s.platform_scope, s.product_scope_type,
            s.product_scope_refs, s.effective_from, s.effective_to,
            s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict,
            s.review_mode, s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
            s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
            s.placeholder_keys, s.questions_json
          ))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'upsert governance hash/search_document mismatch', DETAIL = 'GOVERNANCE_HASH_MISMATCH';
  END IF;

  -- Register only the non-PII source indirection at the owner-controlled publish boundary. Ordinary
  -- workers cannot write this table or assert promotion/retirement evidence.
  PERFORM pg_catalog.set_config('app.semantic_asset_write', 'publish', true);
  INSERT INTO public.semantic_source_assets(
    source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version,
    source_query_id, promotion_review_ref, promoted_by_role, promoted_at,
    lifecycle, created_at
  )
  SELECT DISTINCT ON (question.value ->> 'source_asset_id')
    question.value ->> 'source_asset_id',
    question.value ->> 'source',
    question.value ->> 'origin_fingerprint',
    question.value ->> 'origin_fingerprint_key_version',
    question.value ->> 'source_query_id',
    question.value ->> 'promotion_review_ref',
    question.value ->> 'promoted_by_role',
    CASE WHEN question.value ->> 'promoted_at' IS NULL THEN NULL
      ELSE (question.value ->> 'promoted_at')::TIMESTAMPTZ END,
    'active',
    pg_catalog.clock_timestamp()
  FROM public.staging_scripts staged
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(staged.questions_json) question(value)
  WHERE staged.import_batch_id = p_import_batch_id
    AND staged.validation_ok AND staged.quality_status = 'clean'
    AND staged.quality_gate_passed AND staged.operation = 'upsert'
  ORDER BY question.value ->> 'source_asset_id', staged.script_id,
    question.value ->> 'question_id'
  ON CONFLICT (source_asset_id) DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts staged
    WHERE staged.import_batch_id = p_import_batch_id
      AND staged.validation_ok AND staged.quality_status = 'clean'
      AND staged.quality_gate_passed AND staged.operation = 'upsert'
      AND public.content_questions_source_assets_are_active(staged.questions_json) IS DISTINCT FROM TRUE
  ) OR EXISTS (
    SELECT 1
    FROM public.release_items prior
    WHERE prior.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings touched
        WHERE touched.import_batch_id = p_import_batch_id AND touched.domain = prior.category
      )
      AND public.content_questions_source_assets_are_active(prior.questions_json) IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'prospective release uses missing, mismatched or retired semantic source asset', DETAIL = 'SEMANTIC_SOURCE_ASSET_NOT_ACTIVE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(s.questions_json) question(value)
    JOIN public.script_questions existing
      ON existing.question_id = question.value ->> 'question_id'
    JOIN public.semantic_source_assets existing_asset
      ON existing_asset.source_asset_id = existing.source_asset_id
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
      AND s.operation = 'upsert'
      AND (
        existing.script_id IS DISTINCT FROM s.script_id
        OR existing.question_version > (question.value ->> 'question_version')::INTEGER
        OR (
          existing.question_version = (question.value ->> 'question_version')::INTEGER
          AND (
            existing.question_text IS DISTINCT FROM question.value ->> 'question_text'
            OR existing.question_hash IS DISTINCT FROM question.value ->> 'question_hash'
            OR existing.semantic_family_id IS DISTINCT FROM question.value ->> 'semantic_family_id'
            OR existing.origin_fingerprint IS DISTINCT FROM question.value ->> 'origin_fingerprint'
            OR existing.origin_fingerprint_key_version IS DISTINCT FROM question.value ->> 'origin_fingerprint_key_version'
            OR existing.source_asset_id IS DISTINCT FROM question.value ->> 'source_asset_id'
            OR existing.source IS DISTINCT FROM question.value ->> 'source'
            OR existing.intent_taxonomy_version IS DISTINCT FROM question.value ->> 'intent_taxonomy_version'
            OR existing.intent_id IS DISTINCT FROM question.value ->> 'intent_id'
            OR existing.source_query_id IS NOT NULL
            OR existing.promotion_review_ref IS DISTINCT FROM question.value ->> 'promotion_review_ref'
            OR existing.promoted_by_role IS DISTINCT FROM question.value ->> 'promoted_by_role'
            OR existing.promoted_at IS DISTINCT FROM CASE
              WHEN question.value ->> 'promoted_at' IS NULL THEN NULL
              ELSE (question.value ->> 'promoted_at')::TIMESTAMPTZ
            END
            OR existing.status IS DISTINCT FROM 'active'
            OR existing_asset.source_query_id IS DISTINCT FROM question.value ->> 'source_query_id'
            OR existing_asset.lifecycle IS DISTINCT FROM 'active'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'stable question identity conflicts with published lineage', DETAIL = 'QUESTION_IDENTITY_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(s.questions_json) question(value)
    LEFT JOIN LATERAL (
      SELECT pg_catalog.max(existing.question_version) AS max_version
      FROM public.script_questions existing
      WHERE existing.question_id = question.value ->> 'question_id'
    ) lineage ON TRUE
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
      AND s.operation = 'upsert'
      AND (
        (lineage.max_version IS NULL AND (question.value ->> 'question_version')::INTEGER <> 1)
        OR (
          lineage.max_version IS NOT NULL
          AND (question.value ->> 'question_version')::INTEGER > lineage.max_version
          AND (question.value ->> 'question_version')::INTEGER <> lineage.max_version + 1
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'question version must start at one and advance without gaps', DETAIL = 'QUESTION_VERSION_GAP';
  END IF;

  -- A bound domain is a complete snapshot. Archive every prior live row in touched domains first;
  -- staging upserts below republish only rows present in the approved replacement snapshot.
  UPDATE public.scripts sc
  SET status = 'archived', updated_at = now()
  WHERE sc.tenant_id = v_tenant AND EXISTS (
    SELECT 1 FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = sc.category
  );

  -- Upsert live scripts from staging upserts only.
  INSERT INTO public.scripts AS sc (
    script_id, category, title, answer_text, status, version, content_hash,
    source_ref, source_version_id, platform_scope, product_scope_type, product_scope_refs,
    campaign_tag, effective_from, effective_to,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode, owner_acceptance_record_sha256,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    priority, owner_role, review_due_at, created_at, updated_at, published_at, tenant_id
  )
  SELECT
    s.script_id, s.category, s.title, s.answer_text, 'published', coalesce(s.script_version,1), s.content_hash,
    s.source_ref, s.source_version_id, s.platform_scope, s.product_scope_type, s.product_scope_refs,
    s.campaign_tag, s.effective_from, s.effective_to,
    s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict, s.review_mode, s.owner_acceptance_record_sha256,
    s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
    s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
    s.placeholder_keys, s.questions_json,
    0, s.owner_role, s.review_due_at, now(), now(), now(), v_tenant
  FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
    AND s.operation = 'upsert'
  ON CONFLICT (script_id) DO UPDATE SET
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    answer_text = EXCLUDED.answer_text,
    status = 'published',
    version = sc.version + 1,
    content_hash = EXCLUDED.content_hash,
    source_ref = EXCLUDED.source_ref,
    source_version_id = EXCLUDED.source_version_id,
    platform_scope = EXCLUDED.platform_scope,
    product_scope_type = EXCLUDED.product_scope_type,
    product_scope_refs = EXCLUDED.product_scope_refs,
    campaign_tag = EXCLUDED.campaign_tag,
    effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to,
    intent_taxonomy_version = EXCLUDED.intent_taxonomy_version,
    intent_id = EXCLUDED.intent_id,
    risk_level = EXCLUDED.risk_level,
    risk_categories = EXCLUDED.risk_categories,
    has_conflict = EXCLUDED.has_conflict,
    review_mode = EXCLUDED.review_mode,
    owner_acceptance_record_sha256 = EXCLUDED.owner_acceptance_record_sha256,
    primary_reviewer_id = EXCLUDED.primary_reviewer_id,
    primary_reviewer_role = EXCLUDED.primary_reviewer_role,
    primary_review_evd = EXCLUDED.primary_review_evd,
    secondary_reviewer_id = EXCLUDED.secondary_reviewer_id,
    secondary_reviewer_role = EXCLUDED.secondary_reviewer_role,
    secondary_review_evd = EXCLUDED.secondary_review_evd,
    placeholder_keys = EXCLUDED.placeholder_keys,
    questions_json = EXCLUDED.questions_json,
    owner_role = EXCLUDED.owner_role,
    review_due_at = EXCLUDED.review_due_at,
    updated_at = now(),
    published_at = now();

  -- Immutable question lineage projection. Existing (question_id,version) rows are never overwritten;
  -- a changed semantic/source/taxonomy mapping must arrive as the next version.
  INSERT INTO public.script_questions AS question (
    question_id, script_id, question_version, question_text, question_hash,
    semantic_family_id, origin_fingerprint, origin_fingerprint_key_version,
    source_asset_id, source, intent_taxonomy_version, intent_id, source_query_id,
    promotion_review_ref, promoted_by_role, promoted_at, status, created_at, updated_at
  )
  SELECT
    payload.question_id, s.script_id, payload.question_version, payload.question_text,
    payload.question_hash, payload.semantic_family_id, payload.origin_fingerprint,
    payload.origin_fingerprint_key_version, payload.source_asset_id, payload.source,
    payload.intent_taxonomy_version, payload.intent_id, NULL,
    payload.promotion_review_ref, payload.promoted_by_role, payload.promoted_at,
    'active', now(), now()
  FROM public.staging_scripts s
  CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(s.questions_json) AS payload(
    question_id TEXT,
    question_version INTEGER,
    question_text TEXT,
    question_hash TEXT,
    semantic_family_id TEXT,
    origin_fingerprint TEXT,
    origin_fingerprint_key_version TEXT,
    source_asset_id TEXT,
    source TEXT,
    intent_taxonomy_version TEXT,
    intent_id TEXT,
    source_query_id TEXT,
    promotion_review_ref TEXT,
    promoted_by_role TEXT,
    promoted_at TIMESTAMPTZ
  )
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
    AND s.operation = 'upsert'
  ON CONFLICT (question_id, question_version) DO NOTHING;

  -- Withdraw is an explicit tombstone: archive live material and exclude it from the new snapshot.
  UPDATE public.scripts sc
  SET status = 'archived', updated_at = now()
  FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
    AND s.operation = 'withdraw'
    AND sc.script_id = s.script_id;

  v_seq := pg_catalog.nextval('public.content_release_seq'::pg_catalog.regclass);
  v_release_id := 'rel_' || v_seq::text;
  v_ann := 'ann_' || v_seq::text;

  UPDATE public.content_releases SET status = 'superseded' WHERE status = 'published';

  INSERT INTO public.content_releases(
    release_id, release_seq, title, summary, import_batch_id, rollback_of_release_id,
    status, source_binding_hash, published_by, published_by_role, published_at, tenant_id
  )
  VALUES (
    v_release_id, v_seq, p_title, p_summary, p_import_batch_id, NULL,
    'published', v_source_hash, p_actor_user_id, p_actor_role, now(), v_tenant
  );

  INSERT INTO public.release_source_bindings(release_id, domain, source_version_id, created_at)
  SELECT v_release_id, p.domain, p.source_version_id, now()
  FROM (
    SELECT ib.domain, ib.source_version_id
    FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id
    UNION ALL
    SELECT rb.domain, rb.source_version_id
    FROM public.release_source_bindings rb
    WHERE rb.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings ib
        WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = rb.domain
      )
  ) p;

  -- MERGE by authoritative domain: prior rows from every touched domain are removed as one unit.
  INSERT INTO public.release_items(
    release_id, script_id, script_version, content_hash, answer_text, title, category,
    source_ref, source_version_id, owner_role, review_due_at,
    effective_from, effective_to, platform_scope, product_scope_type, product_scope_refs,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode, owner_acceptance_record_sha256,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    search_document, search_fallback_text
  )
  SELECT
    v_release_id, x.script_id, x.script_version, x.content_hash, x.answer_text, x.title, x.category,
    x.source_ref, x.source_version_id, x.owner_role, x.review_due_at,
    x.effective_from, x.effective_to, x.platform_scope, x.product_scope_type, x.product_scope_refs,
    x.intent_taxonomy_version, x.intent_id, x.risk_level, x.risk_categories, x.has_conflict, x.review_mode, x.owner_acceptance_record_sha256,
    x.primary_reviewer_id, x.primary_reviewer_role, x.primary_review_evd,
    x.secondary_reviewer_id, x.secondary_reviewer_role, x.secondary_review_evd,
    x.placeholder_keys, x.questions_json,
    x.search_document, x.search_fallback_text
  FROM (
    -- upsert wins
    SELECT
      s.script_id, sc.version AS script_version, s.content_hash, s.answer_text, s.title, s.category,
      s.source_ref, s.source_version_id, s.owner_role, s.review_due_at,
      s.effective_from, s.effective_to, s.platform_scope, s.product_scope_type, s.product_scope_refs,
      s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict, s.review_mode, s.owner_acceptance_record_sha256,
      s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
      s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
      s.placeholder_keys, s.questions_json,
      s.search_document, s.search_fallback_text
    FROM public.staging_scripts s
    JOIN public.scripts sc ON sc.script_id = s.script_id
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
      AND s.operation = 'upsert'
    UNION ALL
    -- previous rows not mentioned by either upsert or withdraw remain
    SELECT
      ri.script_id, ri.script_version, ri.content_hash, ri.answer_text, ri.title, ri.category,
      ri.source_ref, ri.source_version_id, ri.owner_role, ri.review_due_at,
      ri.effective_from, ri.effective_to, ri.platform_scope, ri.product_scope_type, ri.product_scope_refs,
      ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict, ri.review_mode, ri.owner_acceptance_record_sha256,
      ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
      ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
      ri.placeholder_keys, ri.questions_json,
      ri.search_document, ri.search_fallback_text
    FROM public.release_items ri
    WHERE v_prev IS NOT NULL
      AND ri.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings ib
        WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = ri.category
      )
  ) x;

  IF NOT public.owner_acceptance_release_content_ready(v_release_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'release acceptance is not active or complete', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;

  INSERT INTO public.content_current(id, current_release_id, updated_at)
  VALUES (1, v_release_id, now())
  ON CONFLICT (id) DO UPDATE SET current_release_id = EXCLUDED.current_release_id, updated_at = now();

  INSERT INTO public.announcements(announcement_id, release_id, title, summary, created_at)
  VALUES (v_ann, v_release_id, COALESCE(p_title, '话术库更新'), p_summary, now());

  UPDATE public.import_batches SET status = 'published', finished_at = now()
  WHERE import_batch_id = p_import_batch_id;

  INSERT INTO public.change_audits(
    change_id, action, actor_role, actor_user_id, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'content_publish', p_actor_role, p_actor_user_id, 'publish_content_release',
    pg_catalog.jsonb_build_object(
      'release_id', v_release_id,
      'previous_release_id', v_prev,
      'import_batch_id', p_import_batch_id,
      'source_binding_hash', v_source_hash
    ),
    now()
  );

  release_id := v_release_id;
  release_seq := v_seq;
  announcement_id := v_ann;
  source_binding_hash := v_source_hash;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION rollback_content_release(
  p_target_release_id TEXT,
  p_title TEXT,
  p_summary TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(
  release_id TEXT,
  release_seq BIGINT,
  announcement_id TEXT,
  rollback_of_release_id TEXT,
  source_binding_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_current TEXT;
  v_release_id TEXT;
  v_seq BIGINT;
  v_ann TEXT;
  v_source_hash TEXT;
  v_stored_source_hash TEXT;
  v_source_count INT;
  v_source_noncanonical BOOLEAN;
  v_source_suspended BOOLEAN;
  v_tenant TEXT;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner'
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'phase1 rollback requires owner', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_target_release_id IS NULL OR pg_catalog.btrim(p_target_release_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'target_release_id is required', DETAIL = 'VALIDATION';
  END IF;

  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'publish single-flight lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  PERFORM pg_catalog.set_config('app.publishing', 'on', true);

  IF NOT EXISTS (
    SELECT 1 FROM public.content_releases cr WHERE cr.release_id = p_target_release_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'target release does not exist', DETAIL = 'NOT_FOUND';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.release_items ri WHERE ri.release_id = p_target_release_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'target release snapshot is empty', DETAIL = 'NOT_FOUND';
  END IF;

  SELECT target.tenant_id INTO v_tenant FROM public.content_releases target WHERE target.release_id = p_target_release_id;
  IF NOT public.owner_acceptance_release_content_ready(p_target_release_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback acceptance is not active or complete', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;

  SELECT
    pg_catalog.count(*)::INT,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(rsb.domain || ':' || rsb.source_version_id, '|' ORDER BY rsb.domain),
      'UTF8'
    ), 'sha256'), 'hex'),
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE),
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE),
    pg_catalog.max(cr.source_binding_hash)
  INTO v_source_count, v_source_hash, v_source_noncanonical, v_source_suspended, v_stored_source_hash
  FROM public.content_releases cr
  JOIN public.release_source_bindings rsb ON rsb.release_id = cr.release_id
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = rsb.source_version_id AND asv.domain = rsb.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = rsb.source_version_id
  WHERE cr.release_id = p_target_release_id;
  IF v_source_count <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'rollback target has an incomplete source set', DETAIL = 'SOURCE_SET_INCOMPLETE';
  END IF;
  IF v_source_noncanonical THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback target contains a reference-only source', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF v_source_suspended THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback target contains a suspended source', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF v_source_hash IS DISTINCT FROM v_stored_source_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'rollback target source binding hash mismatch', DETAIL = 'SOURCE_BINDING_HASH_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.release_items ri
    WHERE ri.release_id = p_target_release_id
      AND ri.review_mode <> 'owner_acceptance'
      AND ri.content_hash IS DISTINCT FROM public.content_governance_hash(
        ri.script_id, ri.category, ri.title, ri.answer_text, ri.source_ref, ri.source_version_id,
        ri.owner_role, ri.review_due_at, ri.platform_scope, ri.product_scope_type,
        ri.product_scope_refs, ri.effective_from, ri.effective_to,
        ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict,
        ri.review_mode, ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
        ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
        ri.placeholder_keys, ri.questions_json
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'rollback target governance snapshot hash mismatch', DETAIL = 'GOVERNANCE_HASH_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.release_items item
    WHERE item.release_id = p_target_release_id
      AND public.content_questions_source_assets_are_active(item.questions_json) IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback target uses retired semantic source asset', DETAIL = 'SEMANTIC_SOURCE_ASSET_NOT_ACTIVE';
  END IF;

  SELECT cc.current_release_id INTO v_current
  FROM public.content_current cc WHERE cc.id = 1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.content_releases current_release
      WHERE current_release.release_id = v_current AND current_release.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback tenant binding mismatch', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  IF v_current IS NOT DISTINCT FROM p_target_release_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'target release is already current', DETAIL = 'CONFLICT';
  END IF;

  v_seq := pg_catalog.nextval('public.content_release_seq'::pg_catalog.regclass);
  v_release_id := 'rel_' || v_seq::text;
  v_ann := 'ann_' || v_seq::text;

  UPDATE public.content_releases SET status = 'superseded' WHERE status = 'published';
  INSERT INTO public.content_releases(
    release_id, release_seq, title, summary, import_batch_id, rollback_of_release_id,
    status, source_binding_hash, published_by, published_by_role, published_at, tenant_id
  ) VALUES (
    v_release_id,
    v_seq,
    COALESCE(NULLIF(p_title, ''), '回滚到 ' || p_target_release_id),
    p_summary,
    NULL,
    p_target_release_id,
    'published',
    v_source_hash,
    p_actor_user_id,
    p_actor_role,
    now(),
    v_tenant
  );

  INSERT INTO public.release_source_bindings(release_id, domain, source_version_id, created_at)
  SELECT v_release_id, rsb.domain, rsb.source_version_id, now()
  FROM public.release_source_bindings rsb
  WHERE rsb.release_id = p_target_release_id;

  INSERT INTO public.release_items(
    release_id, script_id, script_version, content_hash, answer_text, title, category,
    source_ref, source_version_id, owner_role, review_due_at,
    effective_from, effective_to, platform_scope, product_scope_type, product_scope_refs,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode, owner_acceptance_record_sha256,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    search_document, search_fallback_text
  )
  SELECT
    v_release_id, ri.script_id, ri.script_version, ri.content_hash, ri.answer_text,
    ri.title, ri.category, ri.source_ref, ri.source_version_id, ri.owner_role, ri.review_due_at,
    ri.effective_from, ri.effective_to, ri.platform_scope, ri.product_scope_type, ri.product_scope_refs,
    ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict, ri.review_mode, ri.owner_acceptance_record_sha256,
    ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
    ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
    ri.placeholder_keys,
    ri.questions_json, ri.search_document, ri.search_fallback_text
  FROM public.release_items ri
  WHERE ri.release_id = p_target_release_id;

  IF NOT public.owner_acceptance_release_content_ready(v_release_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'release acceptance is not active or complete', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;

  INSERT INTO public.content_current(id, current_release_id, updated_at)
  VALUES (1, v_release_id, now())
  ON CONFLICT (id) DO UPDATE
    SET current_release_id = EXCLUDED.current_release_id, updated_at = now();

  INSERT INTO public.announcements(announcement_id, release_id, title, summary, created_at)
  VALUES (
    v_ann,
    v_release_id,
    COALESCE(NULLIF(p_title, ''), '话术库已回滚'),
    p_summary,
    now()
  );

  INSERT INTO public.change_audits(
    change_id, action, actor_role, actor_user_id, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'content_rollback', p_actor_role, p_actor_user_id, 'rollback_content_release',
    pg_catalog.jsonb_build_object(
      'release_id', v_release_id,
      'previous_release_id', v_current,
      'rollback_of_release_id', p_target_release_id,
      'source_binding_hash', v_source_hash
    ),
    now()
  );

  release_id := v_release_id;
  release_seq := v_seq;
  announcement_id := v_ann;
  rollback_of_release_id := p_target_release_id;
  source_binding_hash := v_source_hash;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE VIEW v_release_source_gate AS
SELECT
  cr.release_id,
  cr.release_seq,
  cr.source_binding_hash,
  (
    owner_gate.ready AND stats.source_count = 4
    AND NOT stats.has_noncanonical
    AND NOT stats.has_suspension
    AND stats.computed_hash IS NOT DISTINCT FROM cr.source_binding_hash
  ) AS source_gate_ready,
  CASE
    WHEN NOT owner_gate.ready THEN 'OWNER_ACCEPTANCE_NOT_ACTIVE'
    WHEN stats.source_count <> 4 THEN 'SOURCE_SET_INCOMPLETE'
    WHEN stats.has_noncanonical THEN 'SOURCE_NOT_ELIGIBLE'
    WHEN stats.has_suspension THEN 'SOURCE_SUSPENDED'
    WHEN stats.computed_hash IS DISTINCT FROM cr.source_binding_hash THEN 'SOURCE_BINDING_HASH_MISMATCH'
    ELSE NULL
  END AS source_gate_reason,
  CASE
    WHEN owner_gate.ready AND stats.source_count = 4
      AND NOT stats.has_noncanonical
      AND NOT stats.has_suspension
      AND stats.computed_hash IS NOT DISTINCT FROM cr.source_binding_hash
    THEN NULL
    ELSE 'SOURCE_GATE_NOT_READY'
  END AS runtime_error_reason
FROM public.content_releases cr
-- OFFSET 0 keeps the volatile admission check single-evaluation per release;
-- the release-id filter can still reach content_releases before this lateral call.
CROSS JOIN LATERAL (SELECT public.owner_acceptance_release_ready(cr.release_id) AS ready OFFSET 0) owner_gate
CROSS JOIN LATERAL (
  SELECT
    pg_catalog.count(*)::INT AS source_count,
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE) AS has_noncanonical,
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE) AS has_suspension,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(rsb.domain || ':' || rsb.source_version_id, '|' ORDER BY rsb.domain),
      'UTF8'
    ), 'sha256'), 'hex') AS computed_hash
  FROM public.release_source_bindings rsb
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = rsb.source_version_id AND asv.domain = rsb.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = rsb.source_version_id
  WHERE rsb.release_id = cr.release_id
) stats;

CREATE OR REPLACE FUNCTION issue_snapshot_offline_lease(
  p_client_id TEXT,
  p_user_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
) RETURNS TABLE(
  offline_lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  release_id TEXT,
  source_binding_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_release_id TEXT;
  v_source_binding_hash TEXT;
  v_issued_at TIMESTAMPTZ;
  v_token_hash TEXT;
  v_acceptance_deadline TIMESTAMPTZ;
BEGIN
  IF p_client_id IS NULL OR pg_catalog.btrim(p_client_id) = ''
     OR p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'client, user and 60..900 second lease ttl are required', DETAIL = 'VALIDATION';
  END IF;

  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'snapshot lease source lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  SELECT cc.current_release_id, gate.source_binding_hash
  INTO v_release_id, v_source_binding_hash
  FROM public.content_current cc
  JOIN public.v_release_source_gate gate
    ON gate.release_id = cc.current_release_id
   AND gate.source_gate_ready
  WHERE cc.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'current source set is not ready for offline use', DETAIL = 'SOURCE_GATE_NOT_READY';
  END IF;

  v_issued_at := pg_catalog.clock_timestamp();
  offline_lease_token := 'osl_' || pg_catalog.encode(public.gen_random_bytes(32), 'hex');
  -- Offline consumers cannot recheck a revoked record while disconnected; the
  -- issued lease must at least never outlive the known acceptance deadline.
  -- Its online use still revalidates current acceptance on every page/ACK.
  SELECT min(public.owner_acceptance_instant(accepted.record -> 'expires_at'))
    INTO v_acceptance_deadline
    FROM public.release_items item
    JOIN public.content_releases release ON release.release_id = item.release_id
    JOIN public.owner_acceptance_records accepted
      ON accepted.tenant_id = release.tenant_id AND accepted.record_sha256 = item.owner_acceptance_record_sha256
    WHERE item.release_id = v_release_id AND item.review_mode = 'owner_acceptance';
  lease_expires_at := least(v_issued_at + pg_catalog.make_interval(secs => p_ttl_seconds),v_acceptance_deadline);
  IF lease_expires_at <= v_issued_at THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'current acceptance expired during lease issuance', DETAIL = 'SOURCE_GATE_NOT_READY';
  END IF;
  release_id := v_release_id;
  source_binding_hash := v_source_binding_hash;
  v_token_hash := pg_catalog.encode(public.digest(
    pg_catalog.convert_to(offline_lease_token, 'UTF8'), 'sha256'
  ), 'hex');

  INSERT INTO public.snapshot_offline_leases(
    lease_token_hash, client_id, user_id, release_id, source_binding_hash,
    issued_at, expires_at, created_at
  ) VALUES (
    v_token_hash, p_client_id, p_user_id, v_release_id, v_source_binding_hash,
    v_issued_at, lease_expires_at, v_issued_at
  );
  RETURN NEXT;
END;
$$;
COMMENT ON SCHEMA public IS 'CS-AI-C11 schema.v1.15; bounded owner acceptance g1a_offline_only; legacy single/dual review retained; runtime activation, managed PostgreSQL, backup/restore and production remain NOT_CERTIFIED; Phase1 rewrite/auto_send/training hard-off';
