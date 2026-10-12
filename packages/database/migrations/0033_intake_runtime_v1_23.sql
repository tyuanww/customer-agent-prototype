-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0033_intake_runtime_v1_23; source schema.v1.23 runtime companions (atomic product installation)
-- contract_set_id=cs-ai-c11-openapi-1.21.0-schema-1.23-e35c0c01b551
-- source_git_sha=e35c0c01b5510ffcff75f2b19ba441ad53a9b504
-- source_schema_sha256=4c2969459265262fabfe38ae425ab8c1275c46274d03ae09ec39b75ae9cc978e
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- installation_sha256=1683c487d6dc84e84b44d9f2a80ca9ab9cfb941144ace8d3b2cf7f520bb58486

-- companion=roles; sha256=54a7a75d8b58f0217cdbc782b450ffc0f256633cb050a509fb930274e17fb9ee
-- DRAFT capability bootstrap. No environment LOGIN, password, role membership or database CONNECT.
-- Installer is the governance migration owner; existing same-name roles fail closed.
CREATE ROLE intake_runtime_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE intake_usage NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE intake_business NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE intake_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE intake_org_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE intake_directory_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE intake_directory_key_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;

-- companion=organization; sha256=656113a5b12a5f6438df467e1afe5858b26c60062568cec4c4535069a283ca14
-- DRAFT registered organization input. Trusted service owns canonical request digests and facts CAS.
CREATE SCHEMA intake_organization;
REVOKE ALL ON SCHEMA intake_organization FROM PUBLIC;
CREATE TABLE intake_organization.bindings (
  tenant_id content_intake.identifier NOT NULL, app_id content_intake.identifier NOT NULL, principal_id content_intake.identifier NOT NULL,
  binding_version content_intake.version NOT NULL, binding_digest content_intake.sha256 NOT NULL,
  open_id content_intake.identifier NOT NULL, enabled boolean NOT NULL, valid_until timestamptz NOT NULL CHECK(isfinite(valid_until)),
  PRIMARY KEY(tenant_id,app_id,principal_id,binding_version),
  FOREIGN KEY(principal_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id),
  UNIQUE(tenant_id,app_id,principal_id,binding_version,open_id)
);
CREATE TABLE intake_organization.current_bindings (
  tenant_id content_intake.identifier NOT NULL, app_id content_intake.identifier NOT NULL, principal_id content_intake.identifier NOT NULL,
  binding_version content_intake.version NOT NULL, open_id content_intake.identifier NOT NULL,
  PRIMARY KEY(tenant_id,app_id,principal_id),
  UNIQUE(tenant_id,app_id,open_id),
  FOREIGN KEY(tenant_id,app_id,principal_id,binding_version,open_id)
    REFERENCES intake_organization.bindings(tenant_id,app_id,principal_id,binding_version,open_id)
);
CREATE TABLE intake_organization.observations (
  principal_id content_intake.identifier NOT NULL, facts_version content_intake.version NOT NULL,
  tenant_id content_intake.identifier NOT NULL, app_id content_intake.identifier NOT NULL, binding_version content_intake.version NOT NULL,
  request_digest content_intake.sha256 NOT NULL,
  kind text NOT NULL CHECK(kind IN ('observation','revocation')),
  mapping_version text, directory_digest content_intake.sha256, observed_until timestamptz CHECK(isfinite(observed_until)),
  PRIMARY KEY(principal_id,facts_version),
  FOREIGN KEY(principal_id,facts_version) REFERENCES content_intake.principal_facts,
  FOREIGN KEY(tenant_id,app_id,principal_id,binding_version) REFERENCES intake_organization.bindings,
  CHECK ((kind='observation' AND mapping_version IS NOT NULL AND mapping_version='feishu-contact-job-title-v1'
    AND directory_digest IS NOT NULL AND directory_digest ~ '^[0-9a-f]{64}$' AND observed_until IS NOT NULL)
    OR (kind='revocation' AND mapping_version IS NULL AND directory_digest IS NULL AND observed_until IS NULL))
);

-- The service owns observation mapping/digests, while SQL keeps append-only
-- history and current binding CAS. It never creates a principal or a grant.
CREATE FUNCTION intake_organization.history_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ORGANIZATION_HISTORY_IMMUTABLE'; END;
$$;
CREATE TRIGGER organization_binding_immutable BEFORE UPDATE OR DELETE ON intake_organization.bindings
 FOR EACH ROW EXECUTE FUNCTION intake_organization.history_immutable();
CREATE TRIGGER organization_observation_immutable BEFORE UPDATE OR DELETE ON intake_organization.observations
 FOR EACH ROW EXECUTE FUNCTION intake_organization.history_immutable();
CREATE FUNCTION intake_organization.binding_transition() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prior intake_organization.bindings;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT b.* INTO prior FROM intake_organization.current_bindings c JOIN intake_organization.bindings b
   USING(tenant_id,app_id,principal_id,binding_version)
   WHERE c.tenant_id=NEW.tenant_id AND c.app_id=NEW.app_id AND c.principal_id=NEW.principal_id;
  IF NEW.binding_version<>coalesce(prior.binding_version,0)+1
    OR (coalesce(prior.enabled,false) AND (NEW.enabled OR NEW.open_id<>prior.open_id OR NEW.valid_until<>prior.valid_until))
    OR (NOT coalesce(prior.enabled,false) AND (NOT NEW.enabled OR NEW.valid_until<=clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ORGANIZATION_BINDING_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_binding_transition BEFORE INSERT ON intake_organization.bindings
 FOR EACH ROW EXECUTE FUNCTION intake_organization.binding_transition();
CREATE FUNCTION intake_organization.current_binding_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
    ((NEW.tenant_id,NEW.app_id,NEW.principal_id) IS DISTINCT FROM (OLD.tenant_id,OLD.app_id,OLD.principal_id)
      OR NEW.binding_version<>OLD.binding_version+1)) OR (TG_OP='INSERT' AND NEW.binding_version<>1 AND NOT EXISTS(
      SELECT 1 FROM intake_organization.current_bindings prior WHERE prior.tenant_id=NEW.tenant_id AND prior.app_id=NEW.app_id
        AND prior.principal_id=NEW.principal_id AND prior.binding_version+1=NEW.binding_version)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ORGANIZATION_BINDING_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_current_guard BEFORE INSERT OR UPDATE OR DELETE ON intake_organization.current_bindings
 FOR EACH ROW EXECUTE FUNCTION intake_organization.current_binding_guard();
CREATE FUNCTION intake_organization.observation_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b intake_organization.bindings; c intake_organization.bindings; f content_intake.principal_facts;
BEGIN
  SELECT * INTO b FROM intake_organization.bindings WHERE tenant_id=NEW.tenant_id AND app_id=NEW.app_id
    AND principal_id=NEW.principal_id AND binding_version=NEW.binding_version;
  SELECT history.* INTO c FROM intake_organization.current_bindings ptr JOIN intake_organization.bindings history
    USING(tenant_id,app_id,principal_id,binding_version)
    WHERE ptr.tenant_id=NEW.tenant_id AND ptr.app_id=NEW.app_id AND ptr.principal_id=NEW.principal_id;
  SELECT * INTO f FROM content_intake.principal_facts WHERE principal_id=NEW.principal_id AND facts_version=NEW.facts_version;
  IF b.principal_id IS NULL OR c.principal_id IS NULL OR f.principal_id IS NULL OR NOT b.enabled
    OR (NEW.kind='observation' AND (NOT c.enabled OR c.binding_version<>b.binding_version
      OR f.valid_until>b.valid_until OR NEW.observed_until<f.checked_at OR NEW.observed_until>=f.valid_until
      OR NEW.observed_until>clock_timestamp() OR clock_timestamp()>=f.valid_until))
    OR (NEW.kind='revocation' AND (c.enabled OR c.binding_version<>b.binding_version+1 OR c.open_id<>b.open_id OR f.enabled)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ORGANIZATION_PROVENANCE_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_observation_guard BEFORE INSERT ON intake_organization.observations
 FOR EACH ROW EXECUTE FUNCTION intake_organization.observation_guard();
-- Registered writer facts require evidence in the SAME transaction. Bootstrap
-- fixtures remain separately privileged and do not masquerade as observations.
-- WHEN is captured when the row is inserted, not when deferred triggers run: a
-- later RESET ROLE cannot erase the evidence obligation.
CREATE FUNCTION intake_organization.fact_evidence_required() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM intake_organization.observations
    WHERE principal_id=NEW.principal_id AND facts_version=NEW.facts_version) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ORGANIZATION_PROVENANCE_REQUIRED';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER organization_fact_evidence AFTER INSERT ON content_intake.principal_facts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (current_user='intake_org_writer')
 EXECUTE FUNCTION intake_organization.fact_evidence_required();
REVOKE ALL ON ALL TABLES IN SCHEMA intake_organization FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA intake_organization FROM PUBLIC;

-- companion=session; sha256=4447e3d2a4477cd66aea754d2eb970d6e92f328c61192bb26edfc054d1768ac6
-- DRAFT trusted transaction boundary. Global content lock must precede this call.
CREATE SCHEMA intake_runtime;
REVOKE ALL ON SCHEMA intake_runtime FROM PUBLIC;

-- The caller supplies the authenticated module's private session hash and user,
-- never renderer data. No identity rows, token hashes or mutable capabilities are
-- returned. Locks remain held until the caller's transaction ends, serializing
-- session revocation and subject disable with its business transaction.
CREATE FUNCTION intake_runtime.lock_product_session(p_hash TEXT, p_user TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE deadline TIMESTAMPTZ;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
    OR p_user IS NULL OR length(p_user) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SESSION_UNAVAILABLE';
  END IF;
  SELECT s.expires_at INTO deadline
    FROM backend_identity.sessions s
    JOIN backend_identity.subject_bindings b USING(binding_id)
    WHERE s.token_hash=p_hash AND b.user_id=p_user AND b.enabled
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
    FOR SHARE OF s,b;
  -- Time can pass while waiting for a row lock. Do not return a stale deadline.
  IF deadline IS NULL OR deadline<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SESSION_UNAVAILABLE';
  END IF;
  RETURN deadline;
END
$$;
REVOKE ALL ON FUNCTION intake_runtime.lock_product_session(TEXT,TEXT) FROM PUBLIC;

-- Startup/checkout guard for a dedicated environment LOGIN after SET ROLE.
-- session_user is the connection identity; current_user is exactly one NOLOGIN
-- capability. This is not an authenticated end-user or a complete ACL auditor.
CREATE FUNCTION intake_runtime.assert_purpose(p_purpose TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE expected TEXT; login_record RECORD; capability_record RECORD;
BEGIN
  expected:=CASE p_purpose WHEN 'usage' THEN 'intake_usage' WHEN 'business' THEN 'intake_business'
    WHEN 'worker' THEN 'intake_worker' WHEN 'organization' THEN 'intake_org_writer'
    WHEN 'directory-key' THEN 'intake_directory_key_operator' ELSE NULL END;
  SELECT * INTO login_record FROM pg_roles WHERE rolname=session_user;
  SELECT * INTO capability_record FROM pg_roles WHERE rolname=expected;
  IF expected IS NULL OR current_user<>expected OR session_user=current_user
    OR NOT login_record.rolcanlogin OR login_record.rolinherit OR login_record.rolsuper OR login_record.rolcreatedb
    OR login_record.rolcreaterole OR login_record.rolbypassrls OR login_record.rolreplication
    OR capability_record.rolcanlogin OR capability_record.rolinherit OR capability_record.rolsuper
    OR capability_record.rolcreatedb OR capability_record.rolcreaterole OR capability_record.rolbypassrls OR capability_record.rolreplication
    OR NOT pg_has_role(session_user,expected,'MEMBER')
    OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=login_record.oid
      AND (m.roleid<>capability_record.oid OR m.admin_option))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=capability_record.oid)
    OR pg_has_role(session_user,'intake_runtime_fn_owner','MEMBER')
    OR pg_has_role(session_user,'intake_directory_fn_owner','MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='INTAKE_RUNTIME_ROLE_BOUNDARY';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION intake_runtime.assert_purpose(TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA intake_runtime TO intake_usage,intake_business,intake_worker,intake_org_writer,intake_directory_key_operator;
GRANT EXECUTE ON FUNCTION intake_runtime.assert_purpose(TEXT) TO intake_usage,intake_business,intake_worker,intake_org_writer,intake_directory_key_operator;

-- companion=directory; sha256=73254ecac5144e7416e87177e1443944579cbc82ec93ed89273e98e4d1d5d9fc
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

-- companion=directoryAcl; sha256=49b4555f80cfe8d7302c67d081cc49a915949b613acda564dcd408a6232c67fa
-- Trusted registered organization service; append-only histories and pointer
-- transitions remain guarded. No bindings/principals/role/grant creation in the
-- identity or content authority domains is granted.
GRANT USAGE ON SCHEMA intake_organization TO intake_org_writer;
GRANT SELECT,INSERT ON intake_organization.bindings,intake_organization.current_bindings,intake_organization.observations TO intake_org_writer;
GRANT UPDATE(binding_version,open_id) ON intake_organization.current_bindings TO intake_org_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA intake_organization TO intake_org_writer;

-- Directory owns only its own state and keys; it does not borrow publication
-- table writes from intake_runtime_fn_owner. Public low-level EXECUTE stays off.
GRANT USAGE ON SCHEMA content_intake,backend_identity,backend_review,public TO intake_directory_fn_owner;
GRANT USAGE ON SCHEMA content_intake TO intake_directory_key_operator;
GRANT SELECT ON backend_identity.sessions,backend_identity.subject_bindings,
  content_intake.principals,content_intake.principal_facts,content_intake.role_rules,
  content_intake.grants,content_intake.scopes,content_intake.sources TO intake_directory_fn_owner;
GRANT UPDATE(token_hash) ON backend_identity.sessions TO intake_directory_fn_owner;
GRANT UPDATE(user_id) ON backend_identity.subject_bindings TO intake_directory_fn_owner;
GRANT UPDATE(principal_id) ON content_intake.principals,content_intake.principal_facts TO intake_directory_fn_owner;
GRANT EXECUTE ON FUNCTION backend_review.lock_content(),public.digest(bytea,text),public.hmac(bytea,bytea,text),
  content_intake.authorization_deadline(text,text,text,text,timestamptz) TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_stewards OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_revisions OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_displays OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_display_current OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_registrars OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_steward_events OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_keys OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_key_events OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.valid_shop_display_name(text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_steward_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_display_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_display_current_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_revision_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.upsert_shop_display(text,text,text,text,text,bigint) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.read_shop_directory(text,text,timestamptz,text,integer,text,timestamptz) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_event_immutable() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_session_context(text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.manage_shop_directory_steward(text,text,bigint,bigint,timestamptz,text,text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.rotate_shop_directory_key(text,text,text,text,timestamptz,bigint,text,text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_signing_key(content_intake.shop_directory_keys) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.prepare_shop_directory_read(text,text,integer) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.prepare_shop_directory_write(text,text,text,bigint) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.finish_shop_directory_transaction(jsonb) OWNER TO intake_directory_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.prepare_shop_directory_read(text,text,integer),content_intake.finish_shop_directory_transaction(jsonb) TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.prepare_shop_directory_write(text,text,text,bigint),content_intake.manage_shop_directory_steward(text,text,bigint,bigint,timestamptz,text,text),content_intake.finish_shop_directory_transaction(jsonb) TO intake_business;
GRANT EXECUTE ON FUNCTION content_intake.rotate_shop_directory_key(text,text,text,text,timestamptz,bigint,text,text) TO intake_directory_key_operator;
-- Core directory consumers can run independently of product-only publication
-- overlays. These minimum grants do not activate the business upload service.
GRANT USAGE ON SCHEMA content_intake,backend_review TO intake_usage,intake_business,intake_org_writer;
GRANT EXECUTE ON FUNCTION backend_review.lock_content() TO intake_usage,intake_business,intake_org_writer;
GRANT SELECT ON content_intake.principals,content_intake.principal_facts TO intake_org_writer;
GRANT INSERT ON content_intake.principal_facts TO intake_org_writer;
GRANT UPDATE(current_facts_version,revocation_generation) ON content_intake.principals TO intake_org_writer;
GRANT EXECUTE ON FUNCTION content_intake.principal_guard() TO intake_org_writer;

-- companion=acl; sha256=59a5fda26bd839a2edea3d73a2c009f12dba7e89edab787b80c23364dc583e05
-- Install as a single transaction AFTER the exact product implementation overlays.
-- Missing implementation must abort before any partial grants are applied.
DO $$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY['content_intake.publish_candidate(text,jsonb,jsonb)',
    'content_intake.preview_rollback(text,text,text)','content_intake.execute_rollback(text,jsonb,jsonb)',
    'content_intake.quality_state(text,bigint)','content_intake.assert_family_catalog(text)'] LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INTAKE_RUNTIME_IMPLEMENTATION_REQUIRED',DETAIL=signature;
    END IF;
  END LOOP;
END $$;
-- DRAFT trusted-service capability ACL. Capability roles are NOLOGIN; environment sessions SET ROLE explicitly.
-- No per-user SQL row isolation: authenticated principal/grants remain the service owners' responsibility.
GRANT USAGE ON SCHEMA intake_runtime, content_intake, backend_review, public
  TO intake_usage, intake_business, intake_worker, intake_org_writer, intake_runtime_fn_owner;
GRANT USAGE ON SCHEMA backend_identity TO intake_usage, intake_business, intake_runtime_fn_owner;

-- Identity locks stay inside the NOLOGIN owner. LOGIN roles never receive these columns.
GRANT SELECT ON backend_identity.sessions, backend_identity.subject_bindings TO intake_runtime_fn_owner;
GRANT UPDATE (revoked_at) ON backend_identity.sessions TO intake_runtime_fn_owner;
GRANT UPDATE (enabled) ON backend_identity.subject_bindings TO intake_runtime_fn_owner;
GRANT SELECT (user_id, enabled) ON backend_identity.subject_bindings TO intake_usage, intake_business;

ALTER FUNCTION intake_runtime.lock_product_session(text, text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION intake_runtime.lock_product_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime.lock_product_session(text, text) TO intake_usage, intake_business;

-- The context trigger takes FOR SHARE on the same security columns. DEFINER keeps
-- that UPDATE off every LOGIN role. The body is already schema-qualified.
ALTER FUNCTION content_intake.entitlement_context_guard() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.entitlement_context_guard() SECURITY DEFINER;
ALTER FUNCTION content_intake.entitlement_context_guard() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION content_intake.entitlement_context_guard()
  FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_backend_auth, app_backend_review, app_backend_worker;
GRANT EXECUTE ON FUNCTION content_intake.entitlement_context_guard() TO intake_usage;

-- Direct publish/rollback keep their original bodies and search_path. Only the
-- NOLOGIN owner holds the table rights those bodies need past the first denial.
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION content_intake.preview_rollback(text, text, text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.preview_rollback(text, text, text) SECURITY DEFINER;
ALTER FUNCTION content_intake.preview_rollback(text, text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION content_intake.execute_rollback(text, jsonb, jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.execute_rollback(text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.execute_rollback(text, jsonb, jsonb) SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION
  content_intake.publish_candidate(text, jsonb, jsonb),
  content_intake.preview_rollback(text, text, text),
  content_intake.execute_rollback(text, jsonb, jsonb)
  FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_backend_auth, app_backend_review, app_backend_worker;
GRANT EXECUTE ON FUNCTION
  content_intake.publish_candidate(text, jsonb, jsonb),
  content_intake.preview_rollback(text, text, text),
  content_intake.execute_rollback(text, jsonb, jsonb)
  TO intake_business;

GRANT EXECUTE ON FUNCTION backend_review.lock_content()
  TO intake_usage, intake_business, intake_worker, intake_org_writer, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.authorization_deadline(text, text, text, text, timestamptz)
  TO intake_usage, intake_business, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.quality_state(text, bigint) TO intake_business, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.assert_family_catalog(text) TO intake_usage, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.entitlement_context_required() TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.entitlement_lease_guard() TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.selection_ids_valid(text[]) TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.object_scope_guard() TO intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.parse_object_guard() TO intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.principal_guard() TO intake_org_writer;
GRANT EXECUTE ON FUNCTION public.issue_snapshot_offline_lease(text, text, integer) TO intake_usage;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_content_ready(text) TO intake_usage;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_ready(text) TO intake_usage;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_instant(jsonb) TO intake_usage;
-- PUBLIC execute was revoked. Hashing stays in the issuing statement; the token column is not selected.
GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO intake_usage, intake_runtime_fn_owner;
-- Publication hashes JSON text and mints a commit ticket; bytea-only digest is insufficient.
GRANT EXECUTE ON FUNCTION public.digest(text, text), public.gen_random_bytes(integer) TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.jsonb_jcs(jsonb) TO intake_runtime_fn_owner;

GRANT SELECT ON
  content_intake.policy_versions, content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
  content_intake.sources, content_intake.scopes, content_intake.source_mappings, content_intake.grants,
  content_intake.release_catalogs, content_intake.release_lineage, content_intake.release_revocations,
  content_intake.candidate_versions, content_intake.source_confirmations, content_intake.approval_current,
  content_intake.approval_facts, content_intake.review_bindings, content_intake.release_rollback_lineage,
  content_intake.vocabulary, content_intake.vocabulary_displays, content_intake.entitlements,
  content_intake.entitlement_scopes, content_intake.entitlement_contexts
  TO intake_usage;
GRANT SELECT ON
  public.content_current, public.content_releases, public.release_items, public.v_release_source_gate,
  public.snapshot_offline_leases, public.owner_acceptance_records, public.release_source_bindings
  TO intake_usage;
GRANT INSERT ON content_intake.entitlements, content_intake.entitlement_scopes, content_intake.entitlement_contexts
  TO intake_usage;

GRANT SELECT ON
  content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
  content_intake.sources, content_intake.scopes, content_intake.source_mappings, content_intake.grants,
  content_intake.quality_plans, content_intake.quality_rounds
  TO intake_business;

GRANT SELECT (principal_id, user_id, tenant_id, app_id) ON content_intake.principals TO intake_worker;
GRANT SELECT ON content_intake.sources, content_intake.scopes TO intake_worker;
GRANT SELECT, INSERT ON content_intake.objects TO intake_worker;
GRANT SELECT ON content_intake.parse_jobs, content_intake.object_reservations TO intake_worker;
GRANT UPDATE (state, finished_at, report_object_id) ON content_intake.parse_jobs TO intake_worker;
GRANT UPDATE (state, updated_at) ON content_intake.object_reservations TO intake_worker;

GRANT SELECT ON content_intake.principals, content_intake.principal_facts TO intake_org_writer;
GRANT INSERT ON content_intake.principal_facts TO intake_org_writer;
GRANT UPDATE (current_facts_version, revocation_generation) ON content_intake.principals TO intake_org_writer;

-- Honest owner rights for a later full publish. LOGIN roles do not receive them.
GRANT SELECT, INSERT, UPDATE ON
  content_intake.write_attempts, content_intake.commit_tickets, content_intake.commit_ticket_sources,
  content_intake.candidate_versions, content_intake.release_catalogs, content_intake.release_lineage,
  content_intake.publications, content_intake.release_rollback_lineage
  TO intake_runtime_fn_owner;
GRANT SELECT ON
  content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
  content_intake.sources, content_intake.scopes, content_intake.source_mappings, content_intake.grants,
  content_intake.rollback_plans, content_intake.rollback_scopes, content_intake.release_revocations,
  content_intake.source_confirmations, content_intake.quality_plans, content_intake.quality_rounds,
  content_intake.approval_current, content_intake.approval_facts, content_intake.review_bindings,
  content_intake.entitlements, content_intake.entitlement_contexts
  TO intake_runtime_fn_owner;
GRANT SELECT, INSERT, UPDATE ON
  public.content_releases, public.release_source_bindings, public.release_items, public.content_current, public.announcements
  TO intake_runtime_fn_owner;
GRANT SELECT ON public.v_release_source_gate, public.owner_acceptance_records, public.snapshot_offline_leases
  TO intake_runtime_fn_owner;
GRANT USAGE, UPDATE ON SEQUENCE public.content_release_seq TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_content_ready(text) TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_ready(text) TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_instant(jsonb) TO intake_runtime_fn_owner;

CREATE FUNCTION intake_runtime.worker_object_purpose() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'intake_worker' AND NEW.purpose IS DISTINCT FROM 'report' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'WORKER_OBJECT_PURPOSE';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION intake_runtime.worker_terminal_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'intake_worker' AND NOT (
    OLD.state IN ('reading', 'parsing') AND NEW.state IN ('failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'WORKER_TERMINAL_ONLY';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION intake_runtime.worker_object_purpose(), intake_runtime.worker_terminal_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime.worker_object_purpose(), intake_runtime.worker_terminal_only() TO intake_worker;
CREATE TRIGGER intake_worker_object_purpose BEFORE INSERT ON content_intake.objects
  FOR EACH ROW EXECUTE FUNCTION intake_runtime.worker_object_purpose();
CREATE TRIGGER intake_worker_terminal_only BEFORE UPDATE ON content_intake.parse_jobs
  FOR EACH ROW EXECUTE FUNCTION intake_runtime.worker_terminal_only();


GRANT SELECT ON backend_review.receipts TO intake_business;
GRANT INSERT ON backend_review.receipts TO intake_business;
GRANT SELECT ON content_intake.policy_versions, content_intake.objects,
  content_intake.object_reservations, content_intake.parse_jobs, content_intake.candidate_versions,
  content_intake.candidate_vocabulary, content_intake.source_confirmations, content_intake.publications,
  content_intake.write_attempts, content_intake.release_catalogs, content_intake.release_lineage,
  content_intake.release_revocations, content_intake.release_rollback_lineage,
  content_intake.review_bindings, content_intake.approval_current, content_intake.approval_facts,
  content_intake.rollback_plans, content_intake.rollback_scopes,
  content_intake.vocabulary, content_intake.vocabulary_displays,
  public.content_current, public.content_releases TO intake_business;
GRANT INSERT ON content_intake.objects, content_intake.object_reservations,
  content_intake.parse_jobs, content_intake.candidate_versions, content_intake.candidate_vocabulary,
  content_intake.source_confirmations, content_intake.quality_plans, content_intake.quality_rounds,
  content_intake.rollback_plans, content_intake.rollback_scopes, content_intake.grants,
  content_intake.grant_history TO intake_business;
GRANT UPDATE (state,finished_at,result_candidate_id,result_candidate_version) ON content_intake.parse_jobs TO intake_business;
GRANT UPDATE (state,source_evidence_version,revocation_generation,updated_at) ON content_intake.candidate_versions TO intake_business;
GRANT UPDATE (state,actual_bytes,sha256,updated_at) ON content_intake.object_reservations TO intake_business;
GRANT UPDATE (version,last_change_reason,steward_id,revoked_at) ON content_intake.grants TO intake_business;
GRANT UPDATE (revocation_generation) ON content_intake.principals TO intake_business;
GRANT INSERT (actor_id,operation_id,action,candidate_id,candidate_version,candidate_digest,payload_digest,state,created_at,publication_policy) ON content_intake.write_attempts TO intake_business;
GRANT UPDATE (state) ON content_intake.write_attempts TO intake_business;
-- FOR UPDATE needs one updatable column. The non-authoritative timestamp grants
-- the lock without allowing the login to change current_release_id or id.
GRANT UPDATE (updated_at) ON public.content_current TO intake_business;
GRANT EXECUTE ON FUNCTION backend_review.sample_ids(jsonb,text,integer),
  public.content_quality_population_manifest_hash(jsonb) TO intake_business;
GRANT EXECUTE ON FUNCTION public.digest(text,text), public.digest(bytea,text), public.jsonb_jcs(jsonb) TO intake_business;

-- Worker terminal capacity consumes reports, never input/review-package authority.
GRANT INSERT ON content_intake.object_reservations TO intake_worker;
GRANT UPDATE (actual_bytes,sha256) ON content_intake.object_reservations TO intake_worker;

CREATE FUNCTION intake_runtime.consumer_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user='intake_business' THEN
    IF TG_TABLE_NAME='grants' AND ((to_jsonb(NEW)->>'kind')='allocation' OR (TG_OP='UPDATE' AND (to_jsonb(OLD)->>'kind')='allocation')) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ROOT_ALLOCATION_FORBIDDEN';
    ELSIF TG_TABLE_NAME='write_attempts' AND (
      (to_jsonb(NEW)->>'action') IS DISTINCT FROM 'cancel'
      OR (TG_OP='INSERT' AND (to_jsonb(NEW)->>'state') IS DISTINCT FROM 'pending')
      OR (TG_OP='UPDATE' AND ((to_jsonb(OLD)->>'state') IS DISTINCT FROM 'pending'
        OR (to_jsonb(NEW)->>'state') IS DISTINCT FROM 'cancelled'
        OR (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')))) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_CANCEL_ATTEMPT_ONLY';
    ELSIF TG_TABLE_NAME='objects' AND (to_jsonb(NEW)->>'purpose')<>'input' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_OBJECT_PURPOSE';
    ELSIF TG_TABLE_NAME='object_reservations' AND (to_jsonb(NEW)->>'purpose')<>'input' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_RESERVATION_PURPOSE';
    ELSIF TG_TABLE_NAME='candidate_versions' AND (to_jsonb(NEW)->>'state') IN ('publishing','published') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_PUBLICATION_STATE';
    ELSIF TG_TABLE_NAME='receipts' AND (to_jsonb(NEW)->>'operation') NOT LIKE 'intake:%' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='RECEIPT_NAMESPACE';
    END IF;
  ELSIF current_user='intake_worker' AND TG_TABLE_NAME='object_reservations' AND (to_jsonb(NEW)->>'purpose')<>'report' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WORKER_RESERVATION_PURPOSE';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION intake_runtime.consumer_write_guard() FROM PUBLIC;
CREATE TRIGGER consumer_grant BEFORE INSERT OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_object BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_reservation BEFORE INSERT OR UPDATE ON content_intake.object_reservations FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_candidate BEFORE INSERT OR UPDATE ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_receipt BEFORE INSERT ON backend_review.receipts FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();


CREATE TRIGGER consumer_cancel_attempt BEFORE INSERT OR UPDATE ON content_intake.write_attempts FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
