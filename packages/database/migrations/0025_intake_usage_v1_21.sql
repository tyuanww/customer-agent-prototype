-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0025_intake_usage_v1_21; source schema.v1.21 lines 12738-12791
-- contract_set_id=cs-ai-c11-openapi-1.17.0-schema-1.21-53906e302288
-- source_git_sha=53906e302288fe0fb70e58b24a40088ecbbd3ef6
-- source_schema_sha256=5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Stored selections have one canonical form, so request order cannot change a lease.
CREATE FUNCTION content_intake.selection_ids_valid(ids TEXT[]) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT ids IS NOT NULL AND cardinality(ids)<=100 AND (cardinality(ids)=0 OR
    (array_ndims(ids)=1 AND array_lower(ids,1)=1 AND array_position(ids,NULL) IS NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(ids) id WHERE id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
     AND ids=ARRAY(SELECT DISTINCT id COLLATE "C" FROM unnest(ids) id ORDER BY id COLLATE "C")))
$$;
CREATE TABLE content_intake.entitlement_contexts (
  entitlement_hash content_intake.sha256 PRIMARY KEY REFERENCES content_intake.entitlements,
  session_token_hash content_intake.sha256 NOT NULL,
  product_ids TEXT[] NOT NULL CHECK (content_intake.selection_ids_valid(product_ids)),
  scenario_ids TEXT[] NOT NULL CHECK (content_intake.selection_ids_valid(scenario_ids))
);
-- No FK to the short-lived sessions table: logout/retention may remove sessions.
-- Creation checks its identity/deadline; every read must join the live session again.
-- The private stored hash is obtained by authentication and never returned on the wire.
CREATE FUNCTION content_intake.entitlement_context_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.entitlements e
    JOIN backend_identity.sessions s ON s.token_hash=NEW.session_token_hash
    JOIN backend_identity.subject_bindings b ON b.binding_id=s.binding_id AND b.user_id=e.user_id
    WHERE e.entitlement_hash=NEW.entitlement_hash AND b.enabled AND s.revoked_at IS NULL
      AND s.issued_at<=e.issued_at AND e.issued_at<=clock_timestamp()
      AND e.valid_until<=s.expires_at AND clock_timestamp()<e.valid_until
    FOR SHARE OF s,b
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ENTITLEMENT_SESSION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entitlement_context_binding BEFORE INSERT ON content_intake.entitlement_contexts
  FOR EACH ROW EXECUTE FUNCTION content_intake.entitlement_context_guard();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON content_intake.entitlement_contexts
  FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history();
-- Existing rows are not backfilled with invented sessions/selections. They are
-- unreadable in the new API. Every NEW qualification must commit with its context.
CREATE FUNCTION content_intake.entitlement_context_required() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM content_intake.entitlement_contexts WHERE entitlement_hash=NEW.entitlement_hash) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ENTITLEMENT_CONTEXT_REQUIRED';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER entitlement_context_required AFTER INSERT ON content_intake.entitlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION content_intake.entitlement_context_required();
REVOKE ALL ON TABLE content_intake.entitlement_contexts FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
REVOKE ALL ON FUNCTION content_intake.selection_ids_valid(TEXT[]),content_intake.entitlement_context_guard(),content_intake.entitlement_context_required()
  FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
