-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0061_sop_entry_code_identity; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A SOP row's identity is the code the operator writes, not the row it sits on.
-- Position-based ids renumbered every entry below an inserted row, which silently
-- replaced published answers while both keys stayed put, so the row-identity
-- guard could not see it. This narrows that guard to positional ids only;
-- explicit codes are new data and never existed under the old rule.
--
-- Everything else here is 0040 verbatim, replaced in place so the owner, ACL and
-- call sites stay unchanged.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION content_intake.stage_sop_candidate_assets(p_actor text,p_id text,p_version bigint,p_rows jsonb,p_media jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; r jsonb; v_items jsonb; v_existing jsonb; v_payload text; v_registered text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version FOR UPDATE;
  IF NOT FOUND OR content_intake.authorization_deadline(p_actor,'import',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF c.state NOT IN ('awaiting-evidence','ready') OR c.publication_policy<>'direct-v1' OR EXISTS
    (SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=p_id AND candidate_version=p_version AND action='publish' AND state IN ('pending','unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM content_intake.sources WHERE source_id=c.source_id AND current_mapping_version=c.source_version AND mode='v2-preview') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  IF jsonb_typeof(p_media) IS DISTINCT FROM 'object' OR p_media-ARRAY['sourceId','sourceVersion','fileSha256','materialDigest','contentVersion','freshRowIds','items']<>'{}'::jsonb
    OR NOT p_media ?& ARRAY['sourceId','sourceVersion','fileSha256','materialDigest','contentVersion','freshRowIds','items']
    OR p_media->'sourceId' IS DISTINCT FROM to_jsonb(c.source_id::text)
    OR p_media->'sourceVersion' IS DISTINCT FROM to_jsonb(c.source_version::bigint)
    OR p_media->'fileSha256' IS DISTINCT FROM to_jsonb(c.file_sha256::text)
    OR p_media->'materialDigest' IS DISTINCT FROM to_jsonb(c.digest::text)
    OR jsonb_typeof(p_media->'freshRowIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_media->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF jsonb_typeof(p_media->'contentVersion') IS DISTINCT FROM 'object'
    OR (p_media->'contentVersion')-ARRAY['kind','value']<>'{}'::jsonb OR NOT (p_media->'contentVersion') ?& ARRAY['kind','value']
    OR jsonb_typeof(p_media#>'{contentVersion,kind}') IS DISTINCT FROM 'string'
    OR p_media#>>'{contentVersion,kind}' NOT IN ('declared','sha256')
    OR jsonb_typeof(p_media#>'{contentVersion,value}') IS DISTINCT FROM 'string'
    OR length(p_media#>>'{contentVersion,value}') NOT BETWEEN 1 AND 32767 OR btrim(p_media#>>'{contentVersion,value}')=''
    OR (p_media#>>'{contentVersion,kind}'='sha256' AND p_media#>>'{contentVersion,value}'<>c.file_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  v_items:=p_media->'items';
  IF jsonb_array_length(v_items)>500 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x WHERE
    jsonb_typeof(x) IS DISTINCT FROM 'object' OR x-ARRAY['mediaObjectId','payloadObjectId','sha256','bytes','mime','sheetName','rowNumber','columnNumber','ordinal']<>'{}'::jsonb
    OR NOT x ?& ARRAY['mediaObjectId','payloadObjectId','sha256','bytes','mime','sheetName','rowNumber','columnNumber','ordinal']
    OR jsonb_typeof(x->'mediaObjectId') IS DISTINCT FROM 'string' OR (x->>'mediaObjectId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR jsonb_typeof(x->'payloadObjectId') IS DISTINCT FROM 'string' OR (x->>'payloadObjectId') !~ '^obj_[0-9a-f]{64}$'
    OR jsonb_typeof(x->'sha256') IS DISTINCT FROM 'string' OR (x->>'sha256') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(x->'mime') IS DISTINCT FROM 'string' OR (x->>'mime') NOT IN ('image/png','image/jpeg','image/gif')
    OR jsonb_typeof(x->'sheetName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(x->'bytes') IS DISTINCT FROM 'number' OR (x->>'bytes') !~ '^[1-9][0-9]{0,6}$'
    OR jsonb_typeof(x->'rowNumber') IS DISTINCT FROM 'number' OR (x->>'rowNumber') !~ '^[1-9][0-9]{0,3}$'
    OR jsonb_typeof(x->'columnNumber') IS DISTINCT FROM 'number' OR (x->>'columnNumber') !~ '^[1-9][0-9]?$'
    OR jsonb_typeof(x->'ordinal') IS DISTINCT FROM 'number' OR (x->>'ordinal') !~ '^[1-9][0-9]{0,2}$') THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  -- The row helper validates every material entry and never infers missing rows.
  PERFORM content_intake.register_sop_candidate_rows(p_actor,p_id,p_version,p_rows);
  IF EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d JOIN content_intake.sop_candidate_rows b
      ON b.source_id=d.source_id AND b.row_id=d.row_id WHERE b.candidate_id=p_id AND b.candidate_version=p_version
      AND d.content_version=p_media->'contentVersion') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x WHERE (x->>'bytes')::bigint>5242880
    OR (x->>'columnNumber')::int>32 OR (x->>'ordinal')::int>100 OR NOT EXISTS
    (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=p_id AND b.candidate_version=p_version
      AND b.row_id='sop:'||(x->>'sheetName')||':'||(x->>'rowNumber')))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x GROUP BY x->>'sheetName',x->>'rowNumber',x->>'mediaObjectId',x->>'ordinal' HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x GROUP BY x->>'sheetName',x->>'rowNumber',x->>'columnNumber',x->>'ordinal' HAVING count(*)>1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  v_payload:=encode(public.digest(public.jsonb_jcs(jsonb_build_object('rows',
    (SELECT jsonb_agg(x ORDER BY x->>'rowId') FROM jsonb_array_elements(p_rows) x),
    'media',p_media||jsonb_build_object('freshRowIds',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) FROM jsonb_array_elements(p_media->'freshRowIds') x),'items',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'sheetName',(x->>'rowNumber')::int,(x->>'columnNumber')::int,(x->>'ordinal')::int,x->>'mediaObjectId'),'[]'::jsonb) FROM jsonb_array_elements(v_items) x)))),'sha256'),'hex');
  SELECT payload_digest INTO v_registered FROM content_intake.sop_asset_registrations WHERE candidate_id=p_id AND candidate_version=p_version;
  IF FOUND THEN
    IF v_registered IS DISTINCT FROM v_payload THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    RETURN;
  END IF;
  -- A published entry's workbook row identity is immutable. Historical candidates
  -- lacking reliable row provenance must be reimported through an approved repair.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l JOIN content_intake.candidate_versions prior
      ON prior.candidate_id=l.candidate_id AND prior.version=l.candidate_version
    JOIN content_intake.sop_candidate_rows current ON current.candidate_id=p_id AND current.candidate_version=p_version AND current.business_entry_id=l.business_entry_id
    WHERE l.release_id=c.base_release_id AND l.source_id=c.source_id
      -- A positional id ('sop7') is derived from the row index, so its published
      -- workbook row must not move. An operator-written code names the row itself:
      -- inserting a row above it legitimately shifts the workbook row while the
      -- code, and therefore the entry, stays the same. Positional ids keep the
      -- original check unchanged.
      AND l.business_entry_id ~ '^sop[0-9]+$'
      AND NOT EXISTS
      (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version
        AND b.business_entry_id=l.business_entry_id AND b.source_id=c.source_id AND b.row_id=current.row_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Parser labels fresh rows explicitly: equal text does not imply inherited
  -- media because a fresh workbook may replace/remove images without text edits.
  IF jsonb_array_length(p_media->'freshRowIds')>(SELECT count(*) FROM content_intake.sop_candidate_rows WHERE candidate_id=p_id AND candidate_version=p_version)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_media->'freshRowIds') x WHERE jsonb_typeof(x)<>'string'
      OR NOT EXISTS (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=p_id AND b.candidate_version=p_version AND to_jsonb(b.row_id)=x))
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(p_media->'freshRowIds') x)
    OR EXISTS (
      -- Expand each immutable version once. Correlated expansion per lineage row
      -- multiplies whole-workbook scans and can exhaust the transaction deadline.
      WITH base_lineage AS MATERIALIZED (
        SELECT candidate_id,candidate_version,source_id,business_entry_id
        FROM content_intake.release_lineage WHERE release_id=c.base_release_id AND source_id=c.source_id
      ), prior_versions AS MATERIALIZED (
        SELECT prior.candidate_id,prior.version,prior.material
        FROM (SELECT DISTINCT candidate_id,candidate_version FROM base_lineage) versions
        JOIN content_intake.candidate_versions prior ON prior.candidate_id=versions.candidate_id AND prior.version=versions.candidate_version
      ), prior_entries AS MATERIALIZED (
        SELECT prior.candidate_id,prior.version,old.value AS entry FROM prior_versions prior
        CROSS JOIN LATERAL jsonb_array_elements(prior.material->'entries') old
      ), current_entries AS MATERIALIZED (
        SELECT value AS entry FROM jsonb_array_elements(c.material->'entries')
      ), inherited_rows AS MATERIALIZED (
        SELECT b.row_id,b.business_entry_id FROM base_lineage l
        JOIN content_intake.sop_candidate_rows b ON b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version
          AND b.source_id=l.source_id AND b.business_entry_id=l.business_entry_id
        JOIN prior_entries old ON old.candidate_id=l.candidate_id AND old.version=l.candidate_version
          AND old.entry->>'businessEntryId'=b.business_entry_id
        JOIN current_entries current_entry ON current_entry.entry=old.entry
      )
      SELECT 1 FROM content_intake.sop_candidate_rows current WHERE current.candidate_id=p_id AND current.candidate_version=p_version
        AND NOT (p_media->'freshRowIds') ? current.row_id
        AND NOT EXISTS(SELECT 1 FROM inherited_rows prior WHERE prior.row_id=current.row_id AND prior.business_entry_id=current.business_entry_id)
    ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Only explicitly inherited entries retain the exact prior media set.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l JOIN content_intake.candidate_versions prior
      ON prior.candidate_id=l.candidate_id AND prior.version=l.candidate_version
    JOIN content_intake.sop_candidate_rows b ON b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version AND b.business_entry_id=l.business_entry_id
    JOIN LATERAL jsonb_array_elements(prior.material->'entries') old ON old->>'businessEntryId'=l.business_entry_id
    WHERE l.release_id=c.base_release_id AND l.source_id=c.source_id AND NOT (p_media->'freshRowIds') ? b.row_id
    AND (SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',m.media_object_id,'payloadObjectId',(SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=m.media_object_id),'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,
      'sheetName',m.sheet_name,'rowNumber',m.row_number,'columnNumber',m.column_number,'ordinal',m.ordinal) ORDER BY m.sheet_name,m.row_number,m.column_number,m.ordinal,m.media_object_id),'[]'::jsonb)
      FROM content_intake.sop_candidate_media m WHERE m.candidate_id=l.candidate_id AND m.candidate_version=l.candidate_version AND m.row_id=b.row_id)
    IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x->>'sheetName',(x->>'rowNumber')::int,(x->>'columnNumber')::int,(x->>'ordinal')::int,x->>'mediaObjectId'),'[]'::jsonb) FROM jsonb_array_elements(v_items) x
      WHERE 'sop:'||(x->>'sheetName')||':'||(x->>'rowNumber')=b.row_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',m.media_object_id,'payloadObjectId',(SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=m.media_object_id),'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,
    'sheetName',m.sheet_name,'rowNumber',m.row_number,'columnNumber',m.column_number,'ordinal',m.ordinal) ORDER BY m.sheet_name,m.row_number,m.column_number,m.ordinal,m.media_object_id),'[]'::jsonb)
    INTO v_existing FROM content_intake.sop_candidate_media m WHERE candidate_id=p_id AND candidate_version=p_version;
  IF v_existing<>'[]'::jsonb AND v_existing IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x->>'sheetName',(x->>'rowNumber')::int,(x->>'columnNumber')::int,(x->>'ordinal')::int,x->>'mediaObjectId'),'[]'::jsonb) FROM jsonb_array_elements(v_items) x) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(v_items) x LOOP
    IF EXISTS (SELECT 1 FROM content_intake.sop_media_objects o WHERE o.media_object_id=r->>'mediaObjectId' AND
      (o.source_id<>c.source_id OR o.sha256<>r->>'sha256' OR o.bytes<>(r->>'bytes')::bigint OR o.mime<>r->>'mime' OR o.payload_object_id IS DISTINCT FROM r->>'payloadObjectId'))
      OR EXISTS (SELECT 1 FROM content_intake.sop_media_objects o WHERE o.source_id=c.source_id AND o.sha256=r->>'sha256' AND o.bytes=(r->>'bytes')::bigint AND o.mime=r->>'mime' AND o.media_object_id<>r->>'mediaObjectId') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d CROSS JOIN LATERAL jsonb_array_elements(d.media) m
      WHERE d.source_id=c.source_id AND d.content_version=p_media->'contentVersion' AND m->>'mediaObjectId'=r->>'mediaObjectId' AND m->>'state'='discarded') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF EXISTS (SELECT 1 FROM content_intake.sop_media_objects WHERE media_object_id=r->>'mediaObjectId' AND state='discarded') THEN
      -- A different operation/job is not a different content version. All deletion
      -- history participates, including an older version seen before the last one.
      IF NOT (p_media->'freshRowIds') ? ('sop:'||(r->>'sheetName')||':'||(r->>'rowNumber'))
        OR EXISTS (SELECT 1 FROM content_intake.sop_candidate_media WHERE media_object_id=r->>'mediaObjectId')
        OR EXISTS (SELECT 1 FROM content_intake.sop_release_media WHERE media_object_id=r->>'mediaObjectId')
        OR EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d CROSS JOIN LATERAL jsonb_array_elements(d.media) m
          WHERE d.source_id=c.source_id AND d.content_version=p_media->'contentVersion' AND m->>'mediaObjectId'=r->>'mediaObjectId')
        OR NOT EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d CROSS JOIN LATERAL jsonb_array_elements(d.media) m
          JOIN content_intake.sop_media_objects o ON o.media_object_id=m->>'mediaObjectId'
          WHERE d.source_id=c.source_id AND o.media_object_id=r->>'mediaObjectId' AND o.adopted_at IS NULL
            AND m->>'state'='discarded' AND m->>'sha256'=o.sha256 AND (m->>'bytes')::bigint=o.bytes AND m->>'mime'=o.mime
            AND (m->>'discardedAt')::timestamptz=o.discarded_at AND d.content_version IS DISTINCT FROM p_media->'contentVersion') THEN
        RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
      UPDATE content_intake.sop_media_objects SET state='staged',discarded_at=NULL WHERE media_object_id=r->>'mediaObjectId' AND state='discarded' AND adopted_at IS NULL;
    END IF;
    INSERT INTO content_intake.sop_media_objects(media_object_id,source_id,actor_id,sha256,bytes,mime,state,created_at,payload_object_id)
      VALUES(r->>'mediaObjectId',c.source_id,p_actor,r->>'sha256',(r->>'bytes')::bigint,r->>'mime','staged',clock_timestamp(),r->>'payloadObjectId') ON CONFLICT(media_object_id) DO NOTHING;
    INSERT INTO content_intake.sop_candidate_media VALUES(p_id,p_version,c.source_id,r->>'mediaObjectId',r->>'sheetName',(r->>'rowNumber')::int,(r->>'columnNumber')::int,
      'sop:'||(r->>'sheetName')||':'||(r->>'rowNumber'),(r->>'ordinal')::int,r->>'sha256',r->>'mime',(r->>'bytes')::bigint) ON CONFLICT(candidate_id,candidate_version,row_id,media_object_id,ordinal) DO NOTHING;
  END LOOP;
  INSERT INTO content_intake.sop_asset_registrations VALUES(p_id,p_version,v_payload,p_media->'contentVersion');
  IF content_intake.authorization_deadline(p_actor,'import',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
END $$;

ALTER FUNCTION content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb) FROM intake_business;
