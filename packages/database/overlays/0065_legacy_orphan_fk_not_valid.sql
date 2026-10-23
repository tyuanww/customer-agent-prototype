-- Legacy orphan foreign keys, marked validated while their rows violate them.
--
-- The 2026-10-23 removal of the retired `hz-publisher` principal deleted parent rows with
-- foreign-key triggers suppressed, so child rows were left referencing rows that no longer
-- exist while every constraint still read `convalidated = true`. pg_dump re-checks each
-- constraint on restore, so each of these made the whole backup unrestorable.
--
-- They are converted to NOT VALID rather than repaired by deleting the children:
-- grant_history, publications and release_lineage are audit evidence, and the authorization
-- model requires a revocation to keep its history row. NOT VALID exempts the pre-existing
-- rows only; every new row is still checked. Once the orphans are gone, VALIDATE CONSTRAINT
-- restores the stronger state without another migration.
--
-- The list is explicit instead of discovered at run time: a migration that silently weakened
-- whatever happened to be broken would make the set of weakened constraints depend on when
-- it ran. The post-check re-scans every still-validated foreign key and raises if any orphan
-- remains, so an incomplete list fails here instead of shipping an unrestorable backup.
-- The names are the 63-byte truncated ones PostgreSQL actually assigned; several end in
-- `_fkey` mid-word because the full identifier does not fit.

DROP TABLE IF EXISTS legacy_orphan_fk;
CREATE TEMP TABLE legacy_orphan_fk(qualified_name TEXT PRIMARY KEY);
INSERT INTO legacy_orphan_fk(qualified_name) VALUES
  ('content_intake.entitlement_contexts.entitlement_contexts_entitlement_hash_fkey'),
  ('content_intake.entitlement_scopes.entitlement_scopes_entitlement_hash_fkey'),
  ('content_intake.grant_history.grant_history_grant_id_fkey'),
  ('content_intake.publications.publications_actor_id_action_operation_id_candidate_id_can_fkey'),
  ('content_intake.publications.publications_actor_id_action_operation_id_publication_poli_fkey'),
  ('content_intake.publications.publications_candidate_id_candidate_version_fkey'),
  ('content_intake.publications.publications_candidate_id_candidate_version_publication_po_fkey'),
  ('content_intake.quality_plans.quality_plans_candidate_id_candidate_version_candidate_dig_fkey'),
  ('content_intake.quality_plans.quality_plans_frozen_by_facts_version_fkey'),
  ('content_intake.quality_rounds.quality_rounds_checked_by_facts_version_fkey'),
  ('content_intake.release_lineage.release_lineage_candidate_id_candidate_version_publication_fkey'),
  ('content_intake.release_lineage.release_lineage_candidate_id_candidate_version_source_id_fkey'),
  ('intake_organization.current_bindings.current_bindings_tenant_id_app_id_principal_id_binding_ver_fkey'),
  ('intake_organization.observations.observations_principal_id_facts_version_fkey'),
  ('intake_organization.observations.observations_tenant_id_app_id_principal_id_binding_version_fkey');

DO $$
DECLARE
  target RECORD;
  rel OID;
  name TEXT;
  definition TEXT;
BEGIN
  FOR target IN SELECT qualified_name FROM legacy_orphan_fk ORDER BY qualified_name LOOP
    name := split_part(target.qualified_name, '.', 3);
    rel := to_regclass(quote_ident(split_part(target.qualified_name, '.', 1))
      || '.' || quote_ident(split_part(target.qualified_name, '.', 2)));
    IF rel IS NULL THEN
      RAISE EXCEPTION 'LEGACY_ORPHAN_FK_MISSING: relation of % does not exist', target.qualified_name;
    END IF;

    SELECT pg_get_constraintdef(con.oid) INTO definition
      FROM pg_constraint con
     WHERE con.conname = name AND con.conrelid = rel AND con.contype = 'f';
    IF definition IS NULL THEN
      RAISE EXCEPTION 'LEGACY_ORPHAN_FK_MISSING: % is not a foreign key on that relation', target.qualified_name;
    END IF;
    -- A retry after a manual fix must not flip a validated constraint back to NOT VALID.
    IF definition LIKE '%NOT VALID' THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel::regclass, name);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID', rel::regclass, name, definition);
  END LOOP;
END $$;

-- Any foreign key still marked validated must actually hold for every row. If this raises,
-- the list above is incomplete and the backup would still be unrestorable.
DO $$
DECLARE
  con RECORD;
  child_cols TEXT;
  parent_cols TEXT;
  null_guard TEXT;
  orphans BIGINT;
  offenders TEXT := '';
BEGIN
  FOR con IN
    SELECT c.oid, c.conname, c.conrelid, c.confrelid, c.conkey, c.confkey
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND c.convalidated
       AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
  LOOP
    SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord),
           string_agg(format('p.%I', pa.attname), ', ' ORDER BY k.ord),
           string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ' ORDER BY k.ord)
      INTO child_cols, parent_cols, null_guard
      FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      JOIN unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = k.ord
      JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = pk.attnum;

    EXECUTE format(
      'SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE (%s) = (%s))',
      con.conrelid::regclass, null_guard, con.confrelid::regclass, child_cols, parent_cols
    ) INTO orphans;
    IF orphans > 0 THEN
      offenders := offenders || format(' %s(%s rows)', con.conname, orphans);
    END IF;
  END LOOP;
  IF offenders <> '' THEN
    RAISE EXCEPTION 'LEGACY_ORPHAN_FK_INCOMPLETE:%', offenders;
  END IF;
END $$;

DROP TABLE legacy_orphan_fk;
