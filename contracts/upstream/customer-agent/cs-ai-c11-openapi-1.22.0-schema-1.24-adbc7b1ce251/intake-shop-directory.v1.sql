-- Shop display directory. Names are not columns on sources and are not read from
-- Feishu contact fields. A registered steward row is the only writer. Absence of
-- that row fails closed. Writing a name does not insert a grant and does not
-- replace content_intake.authorization_deadline.
-- No application role receives EXECUTE or table privileges.

-- Match the wire character rule: no control/line-separator characters, and
-- ECMAScript whitespace may occur only inside a nonblank name.
CREATE FUNCTION content_intake.valid_shop_display_name(p_name TEXT) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_name IS NOT NULL AND char_length(p_name) BETWEEN 1 AND 256
    AND p_name = btrim(p_name, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    AND p_name !~ U&'[\0001-\001F\007F\2028\2029]'
$$;

CREATE TABLE content_intake.shop_directory_stewards (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  steward_id content_intake.identifier,
  registered_at TIMESTAMPTZ NOT NULL CHECK (isfinite(registered_at)),
  version content_intake.version NOT NULL,
  active BOOLEAN NOT NULL,
  valid_until TIMESTAMPTZ,
  CHECK (active = (steward_id IS NOT NULL)),
  CHECK ((active AND valid_until IS NOT NULL AND isfinite(valid_until) AND registered_at < valid_until)
    OR (NOT active AND valid_until IS NULL)),
  PRIMARY KEY (tenant_id, app_id),
  FOREIGN KEY (steward_id, tenant_id, app_id)
    REFERENCES content_intake.principals(principal_id, tenant_id, app_id)
);
CREATE FUNCTION content_intake.shop_directory_steward_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR current_setting('content_intake.directory_steward_write',true) IS DISTINCT FROM 'writing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.tenant_id,NEW.app_id) IS DISTINCT FROM (OLD.tenant_id,OLD.app_id)
      OR NEW.version <> OLD.version + 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shop_directory_steward_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON content_intake.shop_directory_stewards
  FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_steward_guard();

CREATE TABLE content_intake.shop_directory_revisions (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  directory_revision content_intake.version NOT NULL,
  PRIMARY KEY (tenant_id, app_id)
);
CREATE TABLE content_intake.shop_displays (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  shop_id content_intake.identifier NOT NULL,
  display_version content_intake.version NOT NULL,
  display_name TEXT NOT NULL,
  directory_revision content_intake.version NOT NULL,
  steward_id content_intake.identifier NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL CHECK (isfinite(recorded_at)),
  PRIMARY KEY (tenant_id, app_id, shop_id, display_version),
  CHECK (content_intake.valid_shop_display_name(display_name)),
  FOREIGN KEY (steward_id, tenant_id, app_id)
    REFERENCES content_intake.principals(principal_id, tenant_id, app_id)
);
CREATE TABLE content_intake.shop_display_current (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  shop_id content_intake.identifier NOT NULL,
  display_version content_intake.version NOT NULL,
  directory_revision content_intake.version NOT NULL,
  PRIMARY KEY (tenant_id, app_id, shop_id),
  FOREIGN KEY (tenant_id, app_id, shop_id, display_version)
    REFERENCES content_intake.shop_displays(tenant_id, app_id, shop_id, display_version)
);

CREATE FUNCTION content_intake.shop_display_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DISPLAY_IMMUTABLE';
  END IF;
  IF pg_catalog.current_setting('content_intake.directory_write', true) IS DISTINCT FROM 'writing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shop_display_write
  BEFORE INSERT OR UPDATE OR DELETE ON content_intake.shop_displays
  FOR EACH ROW EXECUTE FUNCTION content_intake.shop_display_guard();

CREATE FUNCTION content_intake.shop_display_current_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DISPLAY_IMMUTABLE';
  END IF;
  IF pg_catalog.current_setting('content_intake.directory_write', true) IS DISTINCT FROM 'writing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.app_id, NEW.shop_id) IS DISTINCT FROM (OLD.tenant_id, OLD.app_id, OLD.shop_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DISPLAY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shop_display_current_write
  BEFORE INSERT OR UPDATE OR DELETE ON content_intake.shop_display_current
  FOR EACH ROW EXECUTE FUNCTION content_intake.shop_display_current_guard();

CREATE FUNCTION content_intake.shop_directory_revision_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DISPLAY_IMMUTABLE';
  END IF;
  IF pg_catalog.current_setting('content_intake.directory_write', true) IS DISTINCT FROM 'writing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.directory_revision IS DISTINCT FROM OLD.directory_revision + 1
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.app_id IS DISTINCT FROM OLD.app_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shop_directory_revision_write
  BEFORE INSERT OR UPDATE OR DELETE ON content_intake.shop_directory_revisions
  FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_revision_guard();

CREATE FUNCTION content_intake.upsert_shop_display(
  p_actor TEXT, p_tenant TEXT, p_app TEXT, p_shop TEXT, p_display_name TEXT, p_expected_revision BIGINT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  v_steward content_intake.identifier;
  v_steward_until TIMESTAMPTZ;
  v_revision content_intake.version;
  v_next_revision content_intake.version;
  v_version content_intake.version;
  v_identifier CONSTANT TEXT := '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
BEGIN
  IF p_actor IS NULL OR p_tenant IS NULL OR p_app IS NULL OR p_shop IS NULL
     OR p_actor !~ v_identifier OR p_tenant !~ v_identifier OR p_app !~ v_identifier OR p_shop !~ v_identifier
     OR NOT content_intake.valid_shop_display_name(p_display_name) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DISPLAY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant || ':' || p_app, 0));
  SELECT s.steward_id, least(f.valid_until,s.valid_until) INTO v_steward, v_steward_until
  FROM content_intake.shop_directory_stewards s
  JOIN content_intake.principals p
    ON p.principal_id = p_actor AND p.tenant_id = s.tenant_id AND p.app_id = s.app_id
  JOIN content_intake.principal_facts f ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
  JOIN backend_identity.subject_bindings b ON b.user_id = p.user_id
  JOIN LATERAL (SELECT count(DISTINCT rr.role) AS n,min(rr.role) AS role FROM content_intake.role_rules rr
    WHERE rr.tenant_id=p.tenant_id AND rr.app_id=p.app_id AND rr.department_id=ANY(f.department_ids) AND rr.job_id=f.job_id) roles
    ON roles.n=1 AND roles.role IN ('director','manager')
  WHERE s.tenant_id = p_tenant AND s.app_id = p_app AND s.steward_id = p_actor
    AND s.active AND clock_timestamp() < s.valid_until
    AND b.enabled AND f.enabled AND f.checked_at <= pg_catalog.clock_timestamp()
    AND pg_catalog.clock_timestamp() < f.valid_until
  FOR SHARE OF s, p, f, b;
  IF NOT FOUND OR pg_catalog.clock_timestamp() >= v_steward_until THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  SELECT r.directory_revision INTO v_revision
  FROM content_intake.shop_directory_revisions r
  WHERE r.tenant_id = p_tenant AND r.app_id = p_app
  FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CONFLICT';
    END IF;
    v_next_revision := 1;
  ELSIF p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CONFLICT';
  ELSE
    v_next_revision := v_revision + 1;
  END IF;
  SELECT coalesce(max(d.display_version), 0) + 1 INTO v_version
  FROM content_intake.shop_displays d
  WHERE d.tenant_id = p_tenant AND d.app_id = p_app AND d.shop_id = p_shop;
  PERFORM pg_catalog.set_config('content_intake.directory_write', 'writing', true);
  INSERT INTO content_intake.shop_displays(
    tenant_id, app_id, shop_id, display_version, display_name, directory_revision, steward_id, recorded_at
  ) VALUES (
    p_tenant, p_app, p_shop, v_version, p_display_name, v_next_revision, p_actor, pg_catalog.clock_timestamp()
  );
  INSERT INTO content_intake.shop_display_current(tenant_id, app_id, shop_id, display_version, directory_revision)
  VALUES (p_tenant, p_app, p_shop, v_version, v_next_revision)
  ON CONFLICT (tenant_id, app_id, shop_id) DO UPDATE
    SET display_version = EXCLUDED.display_version,
        directory_revision = EXCLUDED.directory_revision;
  IF v_revision IS NULL THEN
    INSERT INTO content_intake.shop_directory_revisions(tenant_id, app_id, directory_revision)
    VALUES (p_tenant, p_app, v_next_revision);
  ELSE
    UPDATE content_intake.shop_directory_revisions
       SET directory_revision = v_next_revision
     WHERE tenant_id = p_tenant AND app_id = p_app;
  END IF;
  IF pg_catalog.clock_timestamp() >= v_steward_until THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  PERFORM pg_catalog.set_config('content_intake.directory_write', '', true);
  RETURN pg_catalog.jsonb_build_object(
    'shopId', p_shop,
    'displayName', p_display_name,
    'displayVersion', v_version,
    'directoryRevision', v_next_revision
  );
END;
$$;

-- Signing key is a distinct server-only input, never derived from a bearer token
-- or session hash. A client knowing its own token must not be able to sign a cursor.
CREATE FUNCTION content_intake.read_shop_directory(
  p_principal TEXT, p_session_hash TEXT, p_at TIMESTAMPTZ, p_cursor TEXT, p_limit INTEGER, p_cursor_signing_key TEXT, p_outer_deadline TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  v_tenant content_intake.identifier;
  v_app content_intake.identifier;
  v_facts content_intake.version;
  v_revocation content_intake.generation;
  v_fact_until TIMESTAMPTZ;
  v_revision BIGINT := 0;
  v_digest TEXT;
  v_deadline TIMESTAMPTZ;
  v_count BIGINT;
  v_visible JSONB;
  v_limit INTEGER;
  v_cursor_ord BIGINT := 0;
  v_match TEXT[];
  v_cursor_signature TEXT;
  v_payload TEXT;
  v_signature TEXT;
  v_cursor_limit INTEGER;
  v_at TIMESTAMPTZ;
  v_cursor_facts BIGINT;
  v_cursor_revocation BIGINT;
  v_cursor_revision BIGINT;
  v_cursor_digest TEXT;
  v_cursor_deadline_us BIGINT;
  v_cursor_shop TEXT;
  v_boundary content_intake.identifier;
  v_items JSONB;
  v_len INTEGER;
  v_last TEXT;
  v_after_count BIGINT;
  v_deadline_us BIGINT;
  v_next TEXT;
BEGIN
  IF p_principal IS NULL OR p_session_hash IS NULL OR p_at IS NULL OR NOT isfinite(p_at)
     OR p_session_hash !~ '^[0-9a-f]{64}$'
     OR p_cursor_signing_key IS NULL OR p_cursor_signing_key !~ '^[0-9a-f]{64}$'
     OR (p_cursor IS NOT NULL AND (octet_length(p_cursor) = 0 OR octet_length(p_cursor) > 512))
     OR (p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
  END IF;
  v_limit := coalesce(p_limit, 50);
  SELECT tenant_id, app_id INTO v_tenant, v_app FROM content_intake.principals WHERE principal_id = p_principal;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_SESSION';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(v_tenant || ':' || v_app, 0));
  v_at := greatest(p_at, pg_catalog.clock_timestamp());
  SELECT p.current_facts_version, p.revocation_generation, f.valid_until
    INTO v_facts, v_revocation, v_fact_until
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f
    ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
  JOIN backend_identity.subject_bindings b ON b.user_id = p.user_id
  WHERE p.principal_id = p_principal AND p.tenant_id = v_tenant AND p.app_id = v_app
    AND b.enabled AND f.enabled AND f.checked_at <= v_at AND v_at < f.valid_until
  FOR SHARE OF p, f, b;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_EXPIRED';
  END IF;
  SELECT r.directory_revision INTO v_revision
  FROM content_intake.shop_directory_revisions r
  WHERE r.tenant_id = v_tenant AND r.app_id = v_app;
  IF NOT FOUND THEN
    v_revision := 0;
  END IF;
  -- One jsonb value, not a temporary table: a pooled session must be able to call
  -- this function again without reusing a dropped relation's cached plan.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'shopId', q.shop_id,
           'displayName', q.display_name,
           'displayVersion', q.display_version,
           'shopDeadline', q.shop_deadline
         ) ORDER BY q.shop_id COLLATE "C"), '[]'::jsonb)
    INTO v_visible
  FROM (
    SELECT s.shop_id, d.display_name, c.display_version,
           min(content_intake.authorization_deadline(p_principal, 'query', s.scope_id, src.source_id, v_at)) AS shop_deadline
    FROM content_intake.scopes s
    JOIN content_intake.sources src ON src.scope_id = s.scope_id AND src.mode = 'v2-preview'
    LEFT JOIN content_intake.shop_display_current c
      ON c.tenant_id = s.tenant_id AND c.app_id = s.app_id AND c.shop_id = s.shop_id
    LEFT JOIN content_intake.shop_displays d
      ON d.tenant_id = c.tenant_id AND d.app_id = c.app_id AND d.shop_id = c.shop_id
     AND d.display_version = c.display_version
    WHERE s.tenant_id = v_tenant AND s.app_id = v_app AND s.shop_id IS NOT NULL
      AND content_intake.authorization_deadline(p_principal, 'query', s.scope_id, src.source_id, v_at) IS NOT NULL
    GROUP BY s.shop_id, d.display_name, c.display_version
  ) q;
  IF (SELECT count(DISTINCT item->>'shopId') FROM jsonb_array_elements(v_visible) item)
     IS DISTINCT FROM jsonb_array_length(v_visible) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'SHOP_DIRECTORY_DUPLICATE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_visible) item
    WHERE item->>'displayName' IS NULL OR item->>'displayVersion' IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DISPLAY_MISSING';
  END IF;
  SELECT pg_catalog.encode(public.digest(pg_catalog.convert_to(
           coalesce(string_agg(item->>'shopId' || ':' || (item->>'displayVersion'), ','
                    ORDER BY item->>'shopId' COLLATE "C"), ''),
           'UTF8'), 'sha256'), 'hex'),
         min((item->>'shopDeadline')::timestamptz),
         count(*)
    INTO v_digest, v_deadline, v_count
  FROM jsonb_array_elements(v_visible) item;
  IF v_count = 0 THEN
    v_deadline := v_fact_until;
  ELSE
    v_deadline := least(v_fact_until, v_deadline);
  END IF;
  v_deadline := least(v_deadline,p_outer_deadline);
  v_deadline := date_trunc('milliseconds', v_deadline);
  v_deadline_us := (extract(epoch FROM v_deadline) * 1000000)::bigint;
  IF p_cursor IS NOT NULL THEN
    v_match := regexp_match(p_cursor, '^sd2\.([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9a-f]{64})\.([0-9]+)\.([0-9]+)\.([0-9]+)\.([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\.([0-9a-f]{64})$');
    IF v_match IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
    END IF;
    BEGIN
      v_cursor_facts := v_match[1]::bigint;
      v_cursor_revocation := v_match[2]::bigint;
      v_cursor_revision := v_match[3]::bigint;
      v_cursor_digest := v_match[4];
      v_cursor_deadline_us := v_match[5]::bigint;
      v_cursor_ord := v_match[6]::bigint;
      v_cursor_limit := v_match[7]::integer;
      v_cursor_shop := v_match[8];
      v_cursor_signature := v_match[9];
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
    END;
    v_payload := left(p_cursor, length(p_cursor) - 65);
    v_signature := encode(public.hmac(convert_to(jsonb_build_array(p_principal, v_tenant, v_app, p_session_hash, v_payload)::text, 'UTF8'), decode(p_cursor_signing_key, 'hex'), 'sha256'), 'hex');
    IF v_cursor_signature IS DISTINCT FROM v_signature OR v_cursor_limit IS DISTINCT FROM v_limit THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
    END IF;
    IF v_cursor_facts IS DISTINCT FROM v_facts OR v_cursor_revocation IS DISTINCT FROM v_revocation THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CHANGED';
    END IF;
    IF v_cursor_revision IS DISTINCT FROM v_revision THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CHANGED';
    END IF;
    IF (extract(epoch FROM v_at) * 1000000)::bigint >= v_cursor_deadline_us THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_EXPIRED';
    END IF;
    IF v_deadline_us < v_cursor_deadline_us OR v_cursor_digest IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CHANGED';
    END IF;
    BEGIN
      v_boundary := v_visible -> ((v_cursor_ord - 1)::integer) ->> 'shopId';
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
    END;
    IF v_boundary IS NULL OR v_boundary IS DISTINCT FROM v_cursor_shop OR v_cursor_ord < 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
    END IF;
    -- Renewal must not extend the original pagination lifetime.
    v_deadline_us := v_cursor_deadline_us;
    v_deadline := to_timestamp(v_deadline_us / 1000000.0);
  END IF;
  IF greatest(p_at, pg_catalog.clock_timestamp()) >= v_deadline THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_EXPIRED';
  END IF;
  v_after_count := v_count - coalesce(v_cursor_ord, 0);
  SELECT coalesce(jsonb_agg(page.item ORDER BY page.ord), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT t.ord, t.element - 'shopDeadline' AS item
    FROM jsonb_array_elements(v_visible) WITH ORDINALITY AS t(element, ord)
    WHERE t.ord > coalesce(v_cursor_ord, 0)
    ORDER BY t.ord
    LIMIT v_limit
  ) page;
  v_len := jsonb_array_length(v_items);
  v_next := NULL;
  IF v_after_count > v_limit THEN
    v_last := v_items -> (v_len - 1) ->> 'shopId';
    v_payload := 'sd2.' || v_facts::text || '.' || v_revocation::text || '.'
      || v_revision::text || '.' || v_digest || '.' || v_deadline_us::text || '.'
      || (coalesce(v_cursor_ord, 0) + v_len)::text || '.' || v_limit::text || '.' || v_last;
    v_signature := encode(public.hmac(convert_to(jsonb_build_array(p_principal, v_tenant, v_app, p_session_hash, v_payload)::text, 'UTF8'), decode(p_cursor_signing_key, 'hex'), 'sha256'), 'hex');
    v_next := v_payload || '.' || v_signature;
    IF octet_length(v_next) > 512 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_CURSOR';
    END IF;
  END IF;
  -- Page construction and HMAC can also consume the remaining lifetime.
  IF greatest(p_at, pg_catalog.clock_timestamp()) >= v_deadline THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_DIRECTORY_EXPIRED';
  END IF;
  RETURN jsonb_build_object(
    'items', v_items,
    'nextCursor', v_next,
    'validUntil', to_jsonb(date_trunc('milliseconds', v_deadline))
  );
END;
$$;

REVOKE ALL ON FUNCTION content_intake.shop_directory_steward_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.shop_display_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.shop_display_current_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.shop_directory_revision_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.upsert_shop_display(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.read_shop_directory(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON TABLE content_intake.shop_directory_stewards FROM PUBLIC;
REVOKE ALL ON TABLE content_intake.shop_directory_revisions FROM PUBLIC;
REVOKE ALL ON TABLE content_intake.shop_displays FROM PUBLIC;
REVOKE ALL ON TABLE content_intake.shop_display_current FROM PUBLIC;

REVOKE ALL ON FUNCTION content_intake.valid_shop_display_name(TEXT) FROM PUBLIC;

-- Explicit governance bootstrap, not a job-derived tenant administrator.
-- Runtime roles cannot grant, edit or revoke these rows. The bootstrap owner is
-- a separate approval input; registrar operations still require director/manager.
CREATE TABLE content_intake.shop_directory_registrars (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  registrar_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL CHECK (isfinite(valid_from)),
  valid_until TIMESTAMPTZ NOT NULL CHECK (isfinite(valid_until) AND valid_from < valid_until),
  revoked_at TIMESTAMPTZ CHECK (isfinite(revoked_at)),
  PRIMARY KEY (tenant_id,app_id,registrar_id),
  FOREIGN KEY (registrar_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id)
);
CREATE TABLE content_intake.shop_directory_steward_events (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  actor_id content_intake.identifier NOT NULL,
  actor_facts_version content_intake.version NOT NULL,
  registrar_version content_intake.version NOT NULL,
  prior_steward_id content_intake.identifier,
  steward_id content_intake.identifier,
  target_facts_version content_intake.version,
  valid_until TIMESTAMPTZ,
  operation_id content_intake.identifier NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 512),
  recorded_at TIMESTAMPTZ NOT NULL CHECK (isfinite(recorded_at)),
  result JSONB NOT NULL,
  PRIMARY KEY (tenant_id,app_id,version),
  UNIQUE (actor_id,operation_id)
);
-- Key material exists only on the current private state row, never in audit or
-- browser/API output. Rotation replaces it; revocation clears it. No real key is
-- created or bootstrapped by this draft. All application ACL remains revoked.
CREATE TABLE content_intake.shop_directory_keys (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  key_id content_intake.identifier,
  key_material TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,app_id),
  CHECK ((key_id IS NULL AND key_material IS NULL AND valid_from IS NULL AND valid_until IS NULL)
    OR (key_id IS NOT NULL AND key_material IS NOT NULL AND key_material ~ '^[0-9a-f]{64}$' AND valid_from IS NOT NULL
      AND isfinite(valid_from) AND valid_until IS NOT NULL AND isfinite(valid_until) AND valid_from < valid_until))
);
CREATE TABLE content_intake.shop_directory_key_events (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  key_id content_intake.identifier,
  operator_role TEXT NOT NULL,
  valid_until TIMESTAMPTZ,
  operation_id content_intake.identifier NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 512),
  recorded_at TIMESTAMPTZ NOT NULL CHECK (isfinite(recorded_at)),
  result JSONB NOT NULL,
  PRIMARY KEY (tenant_id,app_id,version),
  UNIQUE (tenant_id,app_id,operation_id)
);
CREATE FUNCTION content_intake.shop_directory_event_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_IMMUTABLE'; END;
$$;
CREATE TRIGGER shop_directory_steward_event_immutable BEFORE UPDATE OR DELETE ON content_intake.shop_directory_steward_events
FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_event_immutable();
CREATE TRIGGER shop_directory_key_event_immutable BEFORE UPDATE OR DELETE ON content_intake.shop_directory_key_events
FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_event_immutable();

-- Internal context consumer: lock order matches the product transaction owner.
-- No job/tenant/actor DTO is accepted in place of a real current product session.
CREATE FUNCTION content_intake.shop_directory_session_context(p_session_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE v RECORD; v_roles TEXT[];
BEGIN
  PERFORM backend_review.lock_content();
  SELECT p.principal_id,p.tenant_id,p.app_id,p.current_facts_version,p.revocation_generation,
    least(s.expires_at,f.valid_until) AS valid_until,f.department_ids,f.job_id
    INTO v
  FROM backend_identity.sessions s JOIN backend_identity.subject_bindings b USING(binding_id)
  JOIN content_intake.principals p ON p.user_id=b.user_id
  JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
  WHERE s.token_hash=p_session_hash AND s.revoked_at IS NULL AND b.enabled AND f.enabled
    AND s.issued_at <= clock_timestamp() AND clock_timestamp()<s.expires_at
    AND f.checked_at<=clock_timestamp() AND clock_timestamp()<f.valid_until
  FOR SHARE OF s,b,p,f;
  IF NOT FOUND OR clock_timestamp()>=v.valid_until THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_SESSION';
  END IF;
  SELECT array_agg(DISTINCT r.role::text) INTO v_roles FROM content_intake.role_rules r
    WHERE r.tenant_id=v.tenant_id AND r.app_id=v.app_id AND r.department_id=ANY(v.department_ids) AND r.job_id=v.job_id;
  RETURN jsonb_build_object('principal',v.principal_id,'tenant',v.tenant_id,'app',v.app_id,
    'factsVersion',v.current_facts_version,'generation',v.revocation_generation,
    'role',CASE WHEN cardinality(v_roles)=1 THEN v_roles[1] ELSE NULL END,
    'sessionHash',p_session_hash,'validUntil',v.valid_until);
END;
$$;

CREATE FUNCTION content_intake.manage_shop_directory_steward(p_session_hash TEXT,p_target TEXT,
  p_expected_version BIGINT,p_target_facts BIGINT,p_valid_until TIMESTAMPTZ,p_reason TEXT,p_operation TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c JSONB; r RECORD; old content_intake.shop_directory_stewards; prior RECORD; target RECORD;
  digest TEXT; answer JSONB; version BIGINT; deadline TIMESTAMPTZ;
BEGIN
  c:=content_intake.shop_directory_session_context(p_session_hash);
  IF c->>'role' IS NULL OR c->>'role' NOT IN ('director','manager') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_REGISTRAR_REQUIRED';
  END IF;
  SELECT * INTO r FROM content_intake.shop_directory_registrars
   WHERE tenant_id=c->>'tenant' AND app_id=c->>'app' AND registrar_id=c->>'principal'
     AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND clock_timestamp()<valid_until FOR SHARE;
  IF NOT FOUND OR clock_timestamp()>=r.valid_until THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_REGISTRAR_REQUIRED';
  END IF;
  deadline:=least((c->>'validUntil')::timestamptz,r.valid_until);
  IF p_expected_version IS NULL OR p_expected_version<0 OR p_operation IS NULL
     OR p_operation !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_INVALID';
  END IF;
  digest:=encode(public.digest(convert_to(jsonb_build_array(p_target,p_expected_version,p_target_facts,extract(epoch FROM p_valid_until),p_reason)::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO prior FROM content_intake.shop_directory_steward_events WHERE actor_id=c->>'principal' AND operation_id=p_operation;
  IF FOUND THEN
    IF prior.request_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CONFLICT'; END IF;
    RETURN jsonb_build_object('value',prior.result,'context',c,'deadline',deadline,'kind','replay','registrarVersion',r.version);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((c->>'tenant')||':'||(c->>'app'),0));
  SELECT * INTO old FROM content_intake.shop_directory_stewards WHERE tenant_id=c->>'tenant' AND app_id=c->>'app' FOR UPDATE;
  IF coalesce(old.version,0)<>p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CONFLICT';
  END IF;
  IF p_target IS NULL THEN
    IF old.version IS NULL OR NOT old.active OR p_target_facts IS NOT NULL OR p_valid_until IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_INVALID';
    END IF;
  ELSE
    SELECT p.principal_id,p.current_facts_version,f.valid_until INTO target
      FROM content_intake.principals p JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
      JOIN backend_identity.subject_bindings b ON b.user_id=p.user_id
      JOIN LATERAL (SELECT count(DISTINCT rr.role) AS n,min(rr.role) AS role FROM content_intake.role_rules rr
        WHERE rr.tenant_id=p.tenant_id AND rr.app_id=p.app_id AND rr.department_id=ANY(f.department_ids) AND rr.job_id=f.job_id) roles
        ON roles.n=1 AND roles.role IN ('director','manager')
      WHERE p.principal_id=p_target AND p.tenant_id=c->>'tenant' AND p.app_id=c->>'app'
        AND p.current_facts_version=p_target_facts AND b.enabled AND f.enabled
        AND f.checked_at<=clock_timestamp() AND clock_timestamp()<f.valid_until FOR SHARE OF p,f,b;
    IF NOT FOUND OR p_valid_until IS NULL OR NOT isfinite(p_valid_until) OR clock_timestamp()>=p_valid_until OR p_valid_until>r.valid_until THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_STEWARD_REQUIRED';
    END IF;
    deadline:=least(deadline,target.valid_until);
  END IF;
  version:=coalesce(old.version,0)+1;
  answer:=jsonb_build_object('version',version,'stewardId',p_target,'active',p_target IS NOT NULL,'validUntil',p_valid_until);
  INSERT INTO content_intake.shop_directory_steward_events VALUES(c->>'tenant',c->>'app',version,c->>'principal',
    (c->>'factsVersion')::bigint,r.version,old.steward_id,p_target,p_target_facts,p_valid_until,p_operation,digest,p_reason,clock_timestamp(),answer);
  PERFORM set_config('content_intake.directory_steward_write','writing',true);
  INSERT INTO content_intake.shop_directory_stewards(tenant_id,app_id,steward_id,registered_at,version,active,valid_until)
    VALUES(c->>'tenant',c->>'app',p_target,clock_timestamp(),version,p_target IS NOT NULL,p_valid_until)
    ON CONFLICT(tenant_id,app_id) DO UPDATE SET steward_id=EXCLUDED.steward_id,registered_at=EXCLUDED.registered_at,
      version=EXCLUDED.version,active=EXCLUDED.active,valid_until=EXCLUDED.valid_until;
  PERFORM set_config('content_intake.directory_steward_write','',true);
  IF clock_timestamp()>=deadline THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_EXPIRED'; END IF;
  RETURN jsonb_build_object('value',answer,'context',c,'deadline',deadline,'kind','manage','registrarVersion',r.version,
    'stewardVersion',version,'target',p_target,'targetFacts',p_target_facts);
END;
$$;

-- Infrastructure-only operator entry. Granting this entry is not a business-role
-- decision and never follows from director/manager. No runtime application ACL.
CREATE FUNCTION content_intake.rotate_shop_directory_key(p_tenant TEXT,p_app TEXT,p_key_id TEXT,p_material TEXT,
  p_valid_until TIMESTAMPTZ,p_expected_version BIGINT,p_reason TEXT,p_operation TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old content_intake.shop_directory_keys; prior RECORD; digest TEXT; version BIGINT; answer JSONB;
BEGIN
  PERFORM backend_review.lock_content();
  IF p_tenant IS NULL OR p_app IS NULL OR p_expected_version IS NULL OR p_expected_version<0
    OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR p_app !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 512
    OR p_operation IS NULL OR p_operation !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_INVALID';
  END IF;
  digest:=encode(public.digest(convert_to(jsonb_build_array(p_key_id,p_material,extract(epoch FROM p_valid_until),p_expected_version,p_reason)::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO prior FROM content_intake.shop_directory_key_events WHERE tenant_id=p_tenant AND app_id=p_app AND operation_id=p_operation;
  IF FOUND THEN
    IF prior.request_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CONFLICT'; END IF;
    RETURN prior.result;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant||':'||p_app,0));
  SELECT * INTO old FROM content_intake.shop_directory_keys WHERE tenant_id=p_tenant AND app_id=p_app FOR UPDATE;
  IF coalesce(old.version,0)<>p_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CONFLICT'; END IF;
  IF p_key_id IS NULL THEN
    IF old.version IS NULL OR old.key_id IS NULL OR p_material IS NOT NULL OR p_valid_until IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_INVALID';
    END IF;
  ELSIF p_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR p_material IS NULL OR p_material !~ '^[0-9a-f]{64}$'
    OR p_valid_until IS NULL OR NOT isfinite(p_valid_until) OR clock_timestamp()>=p_valid_until
    OR EXISTS(SELECT 1 FROM content_intake.shop_directory_key_events WHERE tenant_id=p_tenant AND app_id=p_app AND key_id=p_key_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_INVALID';
  END IF;
  version:=coalesce(old.version,0)+1;
  answer:=jsonb_build_object('version',version,'keyId',p_key_id,'active',p_key_id IS NOT NULL,'validUntil',p_valid_until);
  INSERT INTO content_intake.shop_directory_key_events VALUES(p_tenant,p_app,version,p_key_id,
    coalesce(nullif(current_setting('role',true),'none'),session_user),p_valid_until,p_operation,digest,p_reason,clock_timestamp(),answer);
  INSERT INTO content_intake.shop_directory_keys VALUES(p_tenant,p_app,version,p_key_id,p_material,
    CASE WHEN p_key_id IS NOT NULL THEN clock_timestamp() ELSE NULL END,p_valid_until)
    ON CONFLICT(tenant_id,app_id) DO UPDATE SET version=EXCLUDED.version,key_id=EXCLUDED.key_id,key_material=EXCLUDED.key_material,
      valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until;
  IF p_key_id IS NOT NULL AND clock_timestamp()>=p_valid_until THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_EXPIRED';
  END IF;
  RETURN answer;
END;
$$;

-- A key version is part of the cryptographic domain. Reusing the same raw
-- material under a new id/version still invalidates every old cursor.
CREATE FUNCTION content_intake.shop_directory_signing_key(k content_intake.shop_directory_keys) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT encode(public.hmac(convert_to(jsonb_build_array(k.tenant_id,k.app_id,k.key_id,k.version)::text,'UTF8'),
    decode(k.key_material,'hex'),'sha256'),'hex')
$$;
CREATE FUNCTION content_intake.prepare_shop_directory_read(p_session_hash TEXT,p_cursor TEXT,p_limit INTEGER) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c JSONB; k content_intake.shop_directory_keys; answer JSONB; deadline TIMESTAMPTZ;
BEGIN
  c:=content_intake.shop_directory_session_context(p_session_hash);
  SELECT * INTO k FROM content_intake.shop_directory_keys WHERE tenant_id=c->>'tenant' AND app_id=c->>'app' FOR SHARE;
  IF NOT FOUND OR k.key_id IS NULL OR k.valid_from>clock_timestamp() OR clock_timestamp()>=k.valid_until THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_UNAVAILABLE';
  END IF;
  deadline:=least((c->>'validUntil')::timestamptz,k.valid_until);
  answer:=content_intake.read_shop_directory(c->>'principal',p_session_hash,clock_timestamp(),p_cursor,p_limit,content_intake.shop_directory_signing_key(k),deadline);
  RETURN jsonb_build_object('value',answer,'context',c,'deadline',answer->'validUntil','kind','read',
    'keyVersion',k.version,'cursor',p_cursor,'limit',p_limit);
END;
$$;
CREATE FUNCTION content_intake.prepare_shop_directory_write(p_session_hash TEXT,p_shop TEXT,p_name TEXT,p_expected_revision BIGINT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c JSONB; s content_intake.shop_directory_stewards; answer JSONB;
BEGIN
  c:=content_intake.shop_directory_session_context(p_session_hash);
  IF c->>'role' IS NULL OR c->>'role' NOT IN ('director','manager') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_STEWARD_REQUIRED';
  END IF;
  SELECT * INTO s FROM content_intake.shop_directory_stewards WHERE tenant_id=c->>'tenant' AND app_id=c->>'app'
    AND steward_id=c->>'principal' AND active AND clock_timestamp()<valid_until FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_STEWARD_REQUIRED'; END IF;
  answer:=content_intake.upsert_shop_display(c->>'principal',c->>'tenant',c->>'app',p_shop,p_name,p_expected_revision);
  RETURN jsonb_build_object('value',answer,'context',c,'deadline',least((c->>'validUntil')::timestamptz,s.valid_until),
    'kind','write','stewardVersion',s.version);
END;
$$;
-- The unique transaction owner calls this after all work and before COMMIT. It
-- re-reads current authority and uses DB time; an earlier successful prepare is
-- not a commit permit. No output envelope or key is released to the caller.
CREATE FUNCTION content_intake.finish_shop_directory_transaction(p_envelope JSONB) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c JSONB; now_context JSONB; s RECORD; r RECORD; k content_intake.shop_directory_keys; current_value JSONB; deadline TIMESTAMPTZ;
BEGIN
  c:=p_envelope->'context';
  IF p_envelope IS NULL OR jsonb_typeof(p_envelope)<>'object' OR p_envelope->>'kind' IS NULL
    OR p_envelope->>'kind' NOT IN ('read','write','manage','replay') OR c IS NULL OR p_envelope->>'deadline' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DISPLAY_INVALID';
  END IF;
  now_context:=content_intake.shop_directory_session_context(c->>'sessionHash');
  IF (now_context->>'principal',now_context->>'tenant',now_context->>'app',now_context->>'factsVersion',now_context->>'generation')
    IS DISTINCT FROM(c->>'principal',c->>'tenant',c->>'app',c->>'factsVersion',c->>'generation') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CHANGED';
  END IF;
  deadline:=least((p_envelope->>'deadline')::timestamptz,(now_context->>'validUntil')::timestamptz);
  IF p_envelope->>'kind'='read' THEN
    SELECT * INTO k FROM content_intake.shop_directory_keys WHERE tenant_id=c->>'tenant' AND app_id=c->>'app' FOR SHARE;
    IF NOT FOUND OR k.key_id IS NULL OR k.version<>(p_envelope->>'keyVersion')::bigint OR clock_timestamp()>=k.valid_until THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_UNAVAILABLE';
    END IF;
    deadline:=least(deadline,k.valid_until);
    current_value:=content_intake.read_shop_directory(c->>'principal',c->>'sessionHash',clock_timestamp(),
      p_envelope->>'cursor',(p_envelope->>'limit')::integer,content_intake.shop_directory_signing_key(k),deadline);
    IF current_value IS DISTINCT FROM p_envelope->'value' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CHANGED';
    END IF;
  ELSE
    IF p_envelope->>'kind' IN ('manage','replay') THEN
      SELECT * INTO r FROM content_intake.shop_directory_registrars WHERE tenant_id=c->>'tenant' AND app_id=c->>'app'
        AND registrar_id=c->>'principal' AND version=(p_envelope->>'registrarVersion')::bigint
        AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND clock_timestamp()<valid_until FOR SHARE;
      IF NOT FOUND OR now_context->>'role' IS NULL OR now_context->>'role' NOT IN ('director','manager') THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_REGISTRAR_REQUIRED';
      END IF;
      deadline:=least(deadline,r.valid_until);
    END IF;
    IF p_envelope->>'kind'<>'replay' THEN
      SELECT * INTO s FROM content_intake.shop_directory_stewards WHERE tenant_id=c->>'tenant' AND app_id=c->>'app'
        AND version=(p_envelope->>'stewardVersion')::bigint FOR SHARE;
      IF NOT FOUND OR (p_envelope->>'kind'='write' AND (NOT s.active OR s.steward_id<>c->>'principal'
          OR now_context->>'role' IS NULL OR now_context->>'role' NOT IN ('director','manager'))) THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CHANGED';
      END IF;
      IF s.active THEN deadline:=least(deadline,s.valid_until); END IF;
    END IF;
    IF p_envelope->>'target' IS NOT NULL THEN
      PERFORM 1 FROM content_intake.principals p JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        JOIN backend_identity.subject_bindings b ON b.user_id=p.user_id
        JOIN LATERAL (SELECT count(DISTINCT rr.role) AS n,min(rr.role) AS role FROM content_intake.role_rules rr
          WHERE rr.tenant_id=p.tenant_id AND rr.app_id=p.app_id AND rr.department_id=ANY(f.department_ids) AND rr.job_id=f.job_id) roles
          ON roles.n=1 AND roles.role IN ('director','manager')
        WHERE p.principal_id=p_envelope->>'target' AND p.current_facts_version=(p_envelope->>'targetFacts')::bigint
          AND b.enabled AND f.enabled AND f.checked_at<=clock_timestamp() AND clock_timestamp()<f.valid_until;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_CHANGED'; END IF;
    END IF;
  END IF;
  IF NOT isfinite(deadline) OR clock_timestamp()>=deadline THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SHOP_DIRECTORY_EXPIRED';
  END IF;
END;
$$;

REVOKE ALL ON TABLE content_intake.shop_directory_registrars,content_intake.shop_directory_steward_events,
  content_intake.shop_directory_keys,content_intake.shop_directory_key_events FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.shop_directory_event_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.shop_directory_session_context(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.manage_shop_directory_steward(TEXT,TEXT,BIGINT,BIGINT,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.rotate_shop_directory_key(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.prepare_shop_directory_read(TEXT,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.prepare_shop_directory_write(TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.finish_shop_directory_transaction(JSONB) FROM PUBLIC;

REVOKE ALL ON FUNCTION content_intake.shop_directory_signing_key(content_intake.shop_directory_keys) FROM PUBLIC;
