-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0022_intake_legacy_fence; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa
-- source_git_sha=d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713
-- source_schema_sha256=1418537f66274657f8221896387933b4a00a15c23253993541c3bb0ca8964d41
-- Product overlay: retain the reviewed publishers, add the intake coexistence gate.
-- Legacy input has domains, not shop/app/source identity: its conservative impact
-- is EVERY registered source in each bound domain, including other shops/tenants.
-- The two public entry points retain their OIDs, ACL, owner and complete gate bodies.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION content_intake.guard_legacy_domains(p_domains TEXT[]) RETURNS VOID
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_current TEXT;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT current_release_id INTO v_current FROM public.content_current WHERE id=1;
  IF coalesce(cardinality(p_domains),0)=0 THEN
    -- No exact impact proof, no write. Do not guess scope from uploaded rows.
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='legacy publish impact is unknown', DETAIL='CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM content_intake.sources s JOIN content_intake.scopes k USING(scope_id)
      WHERE s.mode='v2-active' AND k.domain=ANY(p_domains))
    OR EXISTS (SELECT 1 FROM content_intake.release_lineage l
      JOIN content_intake.sources s USING(source_id) JOIN content_intake.scopes k USING(scope_id)
      WHERE l.release_id=v_current AND k.domain=ANY(p_domains)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='legacy publish intersects intake state', DETAIL='CONFLICT';
  END IF;
END;
$$;

CREATE FUNCTION content_intake.guard_legacy_write(p_batch TEXT, p_target TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_current TEXT;
  v_domains TEXT[];
BEGIN
  -- Same first lock as P2 writers. The original publisher takes its legacy lock
  -- afterwards, including when content_current has no row yet.
  PERFORM backend_review.lock_content();
  SELECT current_release_id INTO v_current FROM public.content_current WHERE id=1;
  IF p_target IS NOT NULL THEN
    -- Legacy rollback replaces the entire catalog and has no P2 impact plan or
    -- human approval. Never discard or revive P2 lineage via this entry point.
    IF EXISTS (SELECT 1 FROM content_intake.sources WHERE mode='v2-active')
      OR EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id IN (v_current,p_target)) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='legacy rollback intersects intake state', DETAIL='CONFLICT';
    END IF;
    RETURN;
  END IF;
  SELECT array_agg(domain ORDER BY domain) INTO v_domains
    FROM public.import_batch_source_bindings WHERE import_batch_id=p_batch;
  PERFORM content_intake.guard_legacy_domains(v_domains);
  IF EXISTS (SELECT 1 FROM content_intake.release_revocations WHERE release_id=v_current) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='cannot inherit revoked intake state', DETAIL='CONFLICT';
  END IF;
END;
$$;

CREATE FUNCTION content_intake.inherit_legacy_catalog(p_previous TEXT, p_next TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- Called within the publishing transaction, under the guard's content lock.
  -- Recheck actual output bindings before copying, not just declared input scope.
  IF NOT EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id=p_previous) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l
    JOIN content_intake.sources s USING(source_id) JOIN content_intake.scopes k USING(scope_id)
    LEFT JOIN public.release_source_bindings old ON old.release_id=p_previous AND old.domain=k.domain
    LEFT JOIN public.release_source_bindings new ON new.release_id=p_next AND new.domain=k.domain
    WHERE l.release_id=p_previous AND (old.source_version_id IS NULL OR new.source_version_id IS DISTINCT FROM old.source_version_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='intake source inheritance cannot be proven', DETAIL='CONFLICT';
  END IF;
  INSERT INTO content_intake.release_catalogs(release_id,format_version,sop_nodes,sop_edges,media)
    SELECT p_next,format_version,sop_nodes,sop_edges,media FROM content_intake.release_catalogs WHERE release_id=p_previous;
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
      candidate_id,candidate_version,review_request_id,content_valid_until)
    SELECT p_next,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until
      FROM content_intake.release_lineage WHERE release_id=p_previous;
END;
$$;

REVOKE ALL ON FUNCTION content_intake.guard_legacy_domains(TEXT[]), content_intake.guard_legacy_write(TEXT,TEXT), content_intake.inherit_legacy_catalog(TEXT,TEXT) FROM PUBLIC;
-- Narrow access for the existing non-login definer, not application pools.
GRANT USAGE ON SCHEMA content_intake TO cs_ai_definer;
GRANT SELECT ON content_intake.sources,content_intake.scopes,content_intake.release_catalogs,
  content_intake.release_lineage,content_intake.release_revocations TO cs_ai_definer;
GRANT INSERT ON content_intake.release_catalogs,content_intake.release_lineage TO cs_ai_definer;
GRANT CREATE ON SCHEMA content_intake TO cs_ai_definer;
ALTER FUNCTION content_intake.guard_legacy_domains(TEXT[]) OWNER TO cs_ai_definer;
ALTER FUNCTION content_intake.guard_legacy_write(TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION content_intake.inherit_legacy_catalog(TEXT,TEXT) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA content_intake FROM cs_ai_definer;

-- Bounded surgery avoids copying two large gate implementations into another
-- independently maintained publisher. Exact predecessor body hashes + anchors
-- make an unexpected installed definition a migration error, not a silent patch.
DO $$
DECLARE
  v_name TEXT;
  v_expected TEXT;
  v_source TEXT;
  v_body TEXT;
  v_definition TEXT;
  v_lock TEXT := '  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext(''cs_ai_content_publish''));';
  v_result TEXT := '  release_id := v_release_id;';
BEGIN
  FOR v_name,v_expected IN SELECT * FROM (VALUES
    ('publish_content_release','13480de3ad540c3ddf7a6336176a2e44a1527f640f8daf59cee83f48fd1f004a'),
    ('rollback_content_release','4396f6138b873a1944647b54c973e39439e5b982869ea4f71291f9e4482eb482')
  ) AS expected(name,hash) LOOP
    SELECT prosrc,pg_get_functiondef(oid) INTO STRICT v_source,v_definition
      FROM pg_proc WHERE oid=to_regprocedure('public.' || v_name || '(text,text,text,text,text)');
    IF encode(public.digest(v_source,'sha256'),'hex')<>v_expected
      OR cardinality(string_to_array(v_source,v_lock))<>2
      OR cardinality(string_to_array(v_source,v_result))<>2 THEN
      RAISE EXCEPTION 'legacy publisher predecessor drift: %',v_name;
    END IF;
    v_body := replace(v_source,v_lock,'  PERFORM content_intake.guard_legacy_write('
      || CASE WHEN v_name='publish_content_release' THEN 'p_import_batch_id,NULL' ELSE 'NULL,p_target_release_id' END
      || ');' || chr(10) || v_lock);
    IF v_name='publish_content_release' THEN
      v_body := replace(v_body,v_result,'  PERFORM content_intake.inherit_legacy_catalog(v_prev,v_release_id);' || chr(10) || v_result);
    END IF;
    EXECUTE replace(v_definition,v_source,v_body);
  END LOOP;
END;
$$;

-- Snapshot advance happens in the upload transaction, before a batch is created.
-- Restore is a shared-source write as well. Fence both SQL entry points, not only
-- the HTTP caller or the eventual publish. Keep the actor admission lock second.
DO $$
DECLARE
  item RECORD;
  old_body TEXT;
  definition TEXT;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.cancel_actor_in_flight_imports(text,text)',
      'f373ccf7687d3f702f9af340054ad4b848c9d48b54fd26cf874ba2411fdbdfe8',
      '  FOR v_id IN',
      '  PERFORM backend_review.lock_content();
  PERFORM pg_catalog.pg_advisory_xact_lock(724019, 19);'),
    ('public.record_org_reviewed_quality_evidence(text,text,bigint,text,text,jsonb)',
      '3a9b99176a775f710604835e6ada2205e35daab30b53597dac8f941d194c398b',
      '  PERFORM 1 FROM public.outbox_jobs job',
      '  PERFORM backend_review.lock_content();'),
    ('public.finalize_org_reviewed_import_validation(text,text,bigint,text,jsonb)',
      'b364aa166befd8d78cb57296bfe21e7d4300f61e7c7e221b6e17473071f3bf95',
      '  PERFORM 1 FROM public.outbox_jobs job',
      '  PERFORM backend_review.lock_content();'),
    ('public.assert_no_in_flight_content_import(text)',
      'ee47f7c7af74631c5a6dc8d415c7864086e13b7c970ced35e35831cf7946c1e2',
      '  PERFORM pg_catalog.pg_advisory_xact_lock(724019, 19);',
      '  PERFORM backend_review.lock_content();'),
    ('public.advance_source_snapshots(jsonb,text,text,text)',
      'dd7f9f859ade82e0b746adc151996415bb0effc481fa8175ba39398ab15a6096',
      '  INSERT INTO public.source_snapshot_revisions(',
      '  PERFORM backend_review.lock_content();
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_source_bindings) r(domain TEXT,source_version_id TEXT)
    LEFT JOIN public.authoritative_source_versions a ON a.source_version_id=r.source_version_id AND a.domain=r.domain
    WHERE a.source_version_id IS NULL OR a.use_class<>''canonical'') THEN
    RAISE EXCEPTION USING ERRCODE=''ZA004'',MESSAGE=''source version is not registered for runtime use'',DETAIL=''SOURCE_NOT_ELIGIBLE'';
  END IF;
  PERFORM content_intake.guard_legacy_domains(ARRAY(SELECT DISTINCT a.domain FROM jsonb_to_recordset(p_source_bindings) r(domain TEXT,source_version_id TEXT) JOIN public.authoritative_source_versions a ON a.source_version_id=r.source_version_id));'),
    ('public.restore_source_snapshots(text)',
      'cf09f5d33725bbf344725d11993c4a2b98c58cadc286a82d38b35ff9493a4755',
      '  PERFORM pg_catalog.set_config(''customer_agent.source_snapshot_advance'', ''on'', TRUE);',
      '  PERFORM backend_review.lock_content();
  IF NOT EXISTS (SELECT 1 FROM public.source_snapshot_revisions WHERE import_batch_id=p_import_batch_id) THEN RETURN; END IF;
  PERFORM content_intake.guard_legacy_domains(ARRAY(SELECT DISTINCT domain FROM public.source_snapshot_revisions WHERE import_batch_id=p_import_batch_id));')
  ) AS edits(signature,hash,anchor,insertion) LOOP
    SELECT prosrc,pg_get_functiondef(oid) INTO STRICT old_body,definition FROM pg_proc WHERE oid=to_regprocedure(item.signature);
    IF encode(public.digest(old_body,'sha256'),'hex')<>item.hash
      OR cardinality(string_to_array(old_body,item.anchor))<>2 THEN
      RAISE EXCEPTION 'legacy snapshot predecessor drift: %',item.signature;
    END IF;
    EXECUTE replace(definition,old_body,replace(old_body,item.anchor,item.insertion || chr(10) || item.anchor));
  END LOOP;
END;
$$;

-- Activation must not strand an older snapshot reservation: cancellation must
-- still be able to restore it. This is only a storage prerequisite, never approval
-- to activate a real source. Applications retain no source/mode write privilege.
CREATE FUNCTION content_intake.source_write_lock() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM backend_review.lock_content();
  RETURN NULL;
END;
$$;
CREATE FUNCTION content_intake.legacy_mode_admission() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.mode='v2-active' AND EXISTS (
    SELECT 1 FROM content_intake.scopes k JOIN public.source_snapshot_revisions r ON r.domain=k.domain
    LEFT JOIN public.import_batches b USING(import_batch_id)
    WHERE k.scope_id=NEW.scope_id AND b.status IS DISTINCT FROM 'published'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='pending legacy snapshot restoration',DETAIL='CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION content_intake.source_write_lock(),content_intake.legacy_mode_admission() FROM PUBLIC;
CREATE TRIGGER source_write_lock BEFORE INSERT OR UPDATE OR DELETE ON content_intake.sources
  FOR EACH STATEMENT EXECUTE FUNCTION content_intake.source_write_lock();
CREATE TRIGGER legacy_mode_admission BEFORE INSERT OR UPDATE ON content_intake.sources
  FOR EACH ROW EXECUTE FUNCTION content_intake.legacy_mode_admission();
