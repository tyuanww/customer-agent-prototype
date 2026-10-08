-- DRAFT experimental attachment. Not a migration, application ACL, or frozen contract.
CREATE SCHEMA intake_org_candidate;
REVOKE ALL ON SCHEMA intake_org_candidate FROM PUBLIC;
CREATE TABLE intake_org_candidate.bindings (
  tenant_id content_intake.identifier NOT NULL, app_id content_intake.identifier NOT NULL, principal_id content_intake.identifier NOT NULL,
  binding_version content_intake.version NOT NULL, binding_digest content_intake.sha256 NOT NULL,
  open_id content_intake.identifier NOT NULL, enabled boolean NOT NULL, valid_until timestamptz NOT NULL CHECK(isfinite(valid_until)),
  PRIMARY KEY(tenant_id,app_id,principal_id,binding_version),
  FOREIGN KEY(principal_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id),
  UNIQUE(tenant_id,app_id,principal_id,binding_version,open_id)
);
CREATE TABLE intake_org_candidate.current_bindings (
  tenant_id content_intake.identifier NOT NULL, app_id content_intake.identifier NOT NULL, principal_id content_intake.identifier NOT NULL,
  binding_version content_intake.version NOT NULL, open_id content_intake.identifier NOT NULL,
  PRIMARY KEY(tenant_id,app_id,principal_id),
  UNIQUE(tenant_id,app_id,open_id),
  FOREIGN KEY(tenant_id,app_id,principal_id,binding_version,open_id)
    REFERENCES intake_org_candidate.bindings(tenant_id,app_id,principal_id,binding_version,open_id)
);
CREATE TABLE intake_org_candidate.observations (
  principal_id content_intake.identifier NOT NULL, facts_version content_intake.version NOT NULL,
  tenant_id content_intake.identifier NOT NULL, app_id content_intake.identifier NOT NULL, binding_version content_intake.version NOT NULL,
  request_digest content_intake.sha256 NOT NULL,
  kind text NOT NULL CHECK(kind IN ('observation','revocation')),
  mapping_version text, directory_digest content_intake.sha256, observed_until timestamptz CHECK(isfinite(observed_until)),
  PRIMARY KEY(principal_id,facts_version),
  FOREIGN KEY(principal_id,facts_version) REFERENCES content_intake.principal_facts,
  FOREIGN KEY(tenant_id,app_id,principal_id,binding_version) REFERENCES intake_org_candidate.bindings,
  CHECK ((kind='observation' AND mapping_version IS NOT NULL AND mapping_version='feishu-contact-job-title-v1-experiment'
    AND directory_digest IS NOT NULL AND directory_digest ~ '^[0-9a-f]{64}$' AND observed_until IS NOT NULL)
    OR (kind='revocation' AND mapping_version IS NULL AND directory_digest IS NULL AND observed_until IS NULL))
);
