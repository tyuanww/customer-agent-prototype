-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0026_intake_discovery_index; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.17.0-schema-1.21-53906e302288
-- source_git_sha=53906e302288fe0fb70e58b24a40088ecbbd3ef6
-- source_schema_sha256=5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013
-- Product-owned physical access path; no contract, policy or ACL change.
-- Discovery has no fixed action and reuses authorization_deadline per source.
-- source_id must precede action: otherwise each source scans the whole scope.
CREATE INDEX grants_recipient_scope_source
  ON content_intake.grants (recipient_id, scope_id, source_id, action, expires_at)
  WHERE revoked_at IS NULL;
