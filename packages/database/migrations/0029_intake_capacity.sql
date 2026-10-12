-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0029_intake_capacity; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8
-- source_git_sha=240ae98a47d8b9432559c298f60af6fdc9ba8c4e
-- source_schema_sha256=5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013
-- Product-private disk admission journal. No runtime ACL or HTTP contract change.
-- Unknown writes stay charged indefinitely; historical retention is not approved.
CREATE TABLE content_intake.object_reservations (
  object_id TEXT PRIMARY KEY CHECK (object_id ~ '^obj_[0-9a-f]{64}$'),
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals(principal_id),
  source_id content_intake.identifier REFERENCES content_intake.sources(source_id),
  purpose TEXT NOT NULL CHECK (purpose IN ('input','report','review-package')),
  reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes BETWEEN 1 AND 1073741824),
  actual_bytes BIGINT CHECK (actual_bytes BETWEEN 1 AND reserved_bytes),
  sha256 TEXT CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('reserved','persisted','adopted','releasing','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (state NOT IN ('persisted','adopted') OR (actual_bytes IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE INDEX object_reservations_capacity ON content_intake.object_reservations(tenant_id)
  INCLUDE (reserved_bytes) WHERE state IN ('reserved','persisted','releasing');
CREATE INDEX objects_capacity ON content_intake.objects(tenant_id) INCLUDE (bytes);
REVOKE ALL ON content_intake.object_reservations FROM PUBLIC;
