-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0001_extensions; source schema.v1.12 lines 17-97
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Runner control plane is part of 0001, never an untracked hidden migration.
CREATE SCHEMA customer_agent_meta;
REVOKE ALL ON SCHEMA customer_agent_meta FROM PUBLIC;

CREATE TABLE customer_agent_meta.schema_migrations (
  position              INTEGER PRIMARY KEY CHECK (position > 0),
  migration_id          TEXT NOT NULL UNIQUE CHECK (migration_id ~ '^[0-9]{4}_[a-z0-9_]+$'),
  migration_sha256      TEXT NOT NULL CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  contract_set_id       TEXT NOT NULL,
  source_git_sha        TEXT NOT NULL CHECK (source_git_sha ~ '^[0-9a-f]{40}$'),
  source_schema_sha256  TEXT NOT NULL CHECK (source_schema_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  execution_ms          INTEGER NOT NULL CHECK (execution_ms >= 0)
);
REVOKE ALL ON TABLE customer_agent_meta.schema_migrations FROM PUBLIC;
COMMENT ON SCHEMA customer_agent_meta IS
  'CS-AI-C11 migration control plane; owner-only immutable catalogue ledger';
COMMENT ON TABLE customer_agent_meta.schema_migrations IS
  'Applied immutable migrations; drift is fail-closed and never auto-repaired';


DO $install_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND rolsuper
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'clean-install reference DDL requires a PostgreSQL superuser; managed-service migrations must use the provider-specific 46 §6 path';
  END IF;
END
$install_preflight$;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid if needed
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fallback ILIKE/exact acceleration only; NOT the 2-gram primary index

-- Fail-closed DB roles. Login roles are provisioned by deployment tooling and granted membership;
-- this schema deliberately creates NOLOGIN group/owner roles and never embeds passwords.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cs_ai_definer') THEN
    CREATE ROLE cs_ai_definer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_content_admin') THEN
    CREATE ROLE app_content_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_import_worker') THEN
    CREATE ROLE app_import_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_work_order_worker') THEN
    CREATE ROLE app_work_order_worker NOLOGIN;
  END IF;
END
$roles$;

DO $role_attribute_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname IN ('cs_ai_definer','app_runtime','app_content_admin','app_import_worker','app_work_order_worker')
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'capability roles must already be NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS; refuse to repurpose a privileged cluster role';
  END IF;
END
$role_attribute_preflight$;

ALTER ROLE cs_ai_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE app_content_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE app_import_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE app_work_order_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

DO $role_membership_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname IN ('cs_ai_definer','app_runtime','app_content_admin','app_import_worker','app_work_order_worker')
       OR granted_role.rolname IN ('cs_ai_definer','app_runtime','app_content_admin','app_import_worker','app_work_order_worker')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'capability roles must have no pre-existing inbound or outbound membership; install first, then bind login roles from an explicit deployment allowlist';
  END IF;
END
$role_membership_preflight$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
