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
