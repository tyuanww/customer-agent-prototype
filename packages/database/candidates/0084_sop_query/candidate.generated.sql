-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0084_sop_query_candidate; source test-only graph/read candidate
-- contract_set_id=cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b
-- source_git_sha=0fb1dc76ee2b84fda4a82025c081eea7dd697534
-- source_schema_sha256=29af409df12f6ea511261812591d449deb2a1b11f9777af11c8a3a4800c167b8
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- schema.v1.30 storage contract candidate, not a product migration.
-- Existing format guards, quality and publish functions remain closed to this new format
-- until the product implements the obligations in installation.candidate.json.
-- No second current pointer, no new authorization domain, no direct runtime table grants.
CREATE TABLE content_intake.sop_graph_versions (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','disable')),
  canonical_graph text NOT NULL CHECK (octet_length(canonical_graph) BETWEEN 2 AND 33554432),
  graph_payload jsonb NOT NULL CHECK (jsonb_typeof(graph_payload)='object'),
  graph_digest text GENERATED ALWAYS AS (encode(public.digest(canonical_graph,'sha256'),'hex')) STORED,
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id),
  UNIQUE (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
  FOREIGN KEY (candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_id)
    REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  CHECK (canonical_graph::jsonb=graph_payload),
  CHECK (graph_payload ?& ARRAY['definition','entries','media']),
  CHECK (graph_payload-ARRAY['definition','entries','media']='{}'::jsonb),
  CHECK (graph_payload#>>'{definition,header,key,sourceId}' IS NOT DISTINCT FROM source_id::text),
  CHECK (graph_payload#>>'{definition,header,key,flowId}' IS NOT DISTINCT FROM flow_id::text),
  CHECK (graph_payload#>>'{definition,header,key,flowVersion}' IS NOT DISTINCT FROM flow_version::text),
  CHECK (graph_payload#>>'{definition,header,operation}' IS NOT DISTINCT FROM operation),
  CHECK (jsonb_typeof(graph_payload#>'{definition,nodes}') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_array_length(graph_payload#>'{definition,nodes}') BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(graph_payload#>'{definition,edges}') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_array_length(graph_payload#>'{definition,edges}') BETWEEN 0 AND 512),
  CHECK (jsonb_typeof(graph_payload->'entries') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_typeof(graph_payload->'media') IS NOT DISTINCT FROM 'array')
);

CREATE TABLE content_intake.sop_graph_media_bindings (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  business_entry_id content_intake.identifier NOT NULL,
  script_version content_intake.version NOT NULL,
  object_id content_intake.identifier NOT NULL,
  sha256 content_intake.sha256 NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  alt text NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 1024 AND alt ~ '\S'),
  required boolean NOT NULL,
  PRIMARY KEY (candidate_id,candidate_version,object_id),
  UNIQUE (candidate_id,candidate_version,source_id,business_entry_id,script_version,ordinal),
  UNIQUE (candidate_id,candidate_version,source_id,business_entry_id,script_version,object_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id)
    REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  FOREIGN KEY (object_id,source_id,sha256,bytes,mime)
    REFERENCES content_intake.sop_media_objects(media_object_id,source_id,sha256,bytes,mime)
);

CREATE TABLE content_intake.sop_graph_quality_targets (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  policy_version text NOT NULL CHECK (policy_version='sop-graph-quality-v1'),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
  UNIQUE (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
);
CREATE TABLE content_intake.sop_graph_quality_checks (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  phase text NOT NULL CHECK (phase IN ('initial','expanded')),
  reviewer_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  defect boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(reason)<=2000),
  checked_at timestamptz NOT NULL CHECK (isfinite(checked_at)),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id,phase),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_quality_targets(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
  CHECK (NOT defect OR reason ~ '\S')
);

-- One source/flow per release. Tombstones stay in the candidate history; only upserts
-- enter this projection. Deferred FKs permit one atomic catalog/lineage/current write.
CREATE TABLE content_intake.sop_graph_release_lineage (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  review_request_id content_intake.identifier NOT NULL,
  PRIMARY KEY (release_id,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (review_request_id,candidate_id,candidate_version)
    REFERENCES content_intake.review_bindings(review_request_id,candidate_id,candidate_version)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE content_intake.sop_graph_release_media (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  source_id content_intake.identifier NOT NULL,
  business_entry_id content_intake.identifier NOT NULL,
  script_version content_intake.version NOT NULL,
  object_id content_intake.identifier NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  PRIMARY KEY (release_id,object_id),
  FOREIGN KEY (release_id,source_id,business_entry_id)
    REFERENCES content_intake.release_lineage(release_id,source_id,business_entry_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,source_id,business_entry_id,script_version,object_id)
    REFERENCES content_intake.sop_graph_media_bindings(candidate_id,candidate_version,source_id,business_entry_id,script_version,object_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION content_intake.sop_graph_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED';
END $$;
REVOKE ALL ON FUNCTION content_intake.sop_graph_immutable() FROM PUBLIC;
ALTER FUNCTION content_intake.sop_graph_immutable() OWNER TO intake_runtime_fn_owner;
DO $ownership$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['sop_graph_versions','sop_graph_media_bindings',
    'sop_graph_quality_targets','sop_graph_quality_checks','sop_graph_release_lineage','sop_graph_release_media'] LOOP
    EXECUTE format('ALTER TABLE content_intake.%I OWNER TO intake_runtime_fn_owner',relation_name);
    EXECUTE format('REVOKE ALL ON TABLE content_intake.%I FROM PUBLIC, app_runtime, intake_business, intake_worker',relation_name);
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.%I FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable()',relation_name);
  END LOOP;
END $ownership$;
COMMENT ON TABLE content_intake.sop_graph_versions IS 'Immutable complete graph and exact entry/media dependencies. Freeze validates graph reachability, cycles, same-source keys, canonical sorting, digest, diff and media bytes before insertion.';
COMMENT ON TABLE content_intake.sop_graph_quality_targets IS 'Exact changed graph targets frozen with materialDigest. Unchanged graph evidence may only be reused for identical graphDigest with preserved attribution.';
COMMENT ON TABLE content_intake.sop_graph_release_lineage IS 'Derived projection inside the existing publication transaction. No independent current state. Commit must cover all upserts, omit disabled flows, validate all dependencies and quality, then move public.content_current atomically.';
COMMENT ON TABLE content_intake.sop_graph_release_media IS 'Must exactly match the version of the same release entry; never infer binding by title or row number. Backup and rollback preserve referenced media objects.';

-- BEGIN MENOKIN SOP QUERY TRANSPORT
-- schema.v1.30 SOP query transport supplement candidate.
-- Draft only: this is not a product migration and is not installed or activated.
-- The business alias is menokin-sop-query-v1; the formal contract-set id is assigned
-- from the source commit after the candidate is reviewed and exported.

CREATE TABLE content_intake.sop_query_leases (
  lease_id TEXT PRIMARY KEY CHECK (lease_id ~ '^sopl_[0-9a-f]{64}$'),
  actor_binding_hash TEXT NOT NULL CHECK (actor_binding_hash ~ '^[0-9a-f]{64}$'),
  release_id TEXT NOT NULL REFERENCES public.content_releases(release_id),
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  context_generation TEXT NOT NULL CHECK (btrim(context_generation) <> '' AND length(context_generation) <= 128),
  issued_at TIMESTAMPTZ NOT NULL CHECK (isfinite(issued_at)),
  expires_at TIMESTAMPTZ NOT NULL CHECK (isfinite(expires_at) AND expires_at > issued_at),
  session_epoch BIGINT NOT NULL CHECK (session_epoch >= 0),
  UNIQUE (actor_binding_hash, request_id)
);

CREATE INDEX sop_query_leases_expiry_idx
  ON content_intake.sop_query_leases (release_id, expires_at);

CREATE FUNCTION content_intake.sop_query_lease_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, content_intake, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'SOP query leases are immutable', DETAIL = 'SOP_QUERY_LEASE_IMMUTABLE';
END;
$$;

CREATE TRIGGER sop_query_leases_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_query_leases
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_query_lease_immutable();

CREATE FUNCTION content_intake.issue_sop_query_lease(
  p_lease_id TEXT,
  p_actor_binding_hash TEXT,
  p_release_id TEXT,
  p_request_id UUID,
  p_request_hash TEXT,
  p_context_generation TEXT,
  p_issued_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ,
  p_session_epoch BIGINT
) RETURNS content_intake.sop_query_leases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, content_intake, public, pg_temp
AS $$
DECLARE
  v_existing content_intake.sop_query_leases;
  v_created content_intake.sop_query_leases;
BEGIN
  SELECT * INTO v_existing
  FROM content_intake.sop_query_leases
  WHERE actor_binding_hash = p_actor_binding_hash AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'SOP query idempotency conflict', DETAIL = 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing;
  END IF;
  IF p_expires_at <= p_issued_at OR p_expires_at > p_issued_at + INTERVAL '15 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SOP query lease window is invalid', DETAIL = 'LEASE_WINDOW_INVALID';
  END IF;
  INSERT INTO content_intake.sop_query_leases (
    lease_id, actor_binding_hash, release_id, request_id, request_hash,
    context_generation, issued_at, expires_at, session_epoch
  ) VALUES (
    p_lease_id, p_actor_binding_hash, p_release_id, p_request_id, p_request_hash,
    p_context_generation, p_issued_at, p_expires_at, p_session_epoch
  ) RETURNING * INTO v_created;
  RETURN v_created;
END;
$$;

CREATE FUNCTION content_intake.validate_sop_query_lease(
  p_lease_id TEXT,
  p_actor_binding_hash TEXT,
  p_release_id TEXT,
  p_request_id UUID,
  p_session_epoch BIGINT
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, content_intake, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM content_intake.sop_query_leases
    WHERE lease_id = p_lease_id
      AND actor_binding_hash = p_actor_binding_hash
      AND release_id = p_release_id
      AND request_id = p_request_id
      AND session_epoch = p_session_epoch
      AND expires_at > clock_timestamp()
  );
$$;

ALTER TABLE content_intake.sop_query_leases OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_query_lease_immutable() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON TABLE content_intake.sop_query_leases FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.sop_query_lease_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) TO app_runtime;
GRANT EXECUTE ON FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) TO app_runtime;

COMMENT ON TABLE content_intake.sop_query_leases IS 'Server-owned, release-bound SOP query leases. No raw user id or bearer token is stored; expiry and current access are rechecked at query and response boundaries.';
COMMENT ON COLUMN content_intake.sop_query_leases.actor_binding_hash IS 'Server-derived opaque actor binding hash; never a request field and never reversible identity.';
COMMENT ON COLUMN content_intake.sop_query_leases.request_hash IS 'Canonical hash of the validated request body for same-key idempotency and conflict detection.';
-- END MENOKIN SOP QUERY TRANSPORT

CREATE FUNCTION content_intake.sop_query_normalize(input text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $fn$
SELECT btrim(COALESCE(string_agg(COALESCE($fold${"A":"a","B":"b","C":"c","D":"d","E":"e","F":"f","G":"g","H":"h","I":"i","J":"j","K":"k","L":"l","M":"m","N":"n","O":"o","P":"p","Q":"q","R":"r","S":"s","T":"t","U":"u","V":"v","W":"w","X":"x","Y":"y","Z":"z","µ":"μ","À":"à","Á":"á","Â":"â","Ã":"ã","Ä":"ä","Å":"å","Æ":"æ","Ç":"ç","È":"è","É":"é","Ê":"ê","Ë":"ë","Ì":"ì","Í":"í","Î":"î","Ï":"ï","Ð":"ð","Ñ":"ñ","Ò":"ò","Ó":"ó","Ô":"ô","Õ":"õ","Ö":"ö","Ø":"ø","Ù":"ù","Ú":"ú","Û":"û","Ü":"ü","Ý":"ý","Þ":"þ","ß":"ss","Ā":"ā","Ă":"ă","Ą":"ą","Ć":"ć","Ĉ":"ĉ","Ċ":"ċ","Č":"č","Ď":"ď","Đ":"đ","Ē":"ē","Ĕ":"ĕ","Ė":"ė","Ę":"ę","Ě":"ě","Ĝ":"ĝ","Ğ":"ğ","Ġ":"ġ","Ģ":"ģ","Ĥ":"ĥ","Ħ":"ħ","Ĩ":"ĩ","Ī":"ī","Ĭ":"ĭ","Į":"į","İ":"i̇","Ĳ":"ĳ","Ĵ":"ĵ","Ķ":"ķ","Ĺ":"ĺ","Ļ":"ļ","Ľ":"ľ","Ŀ":"ŀ","Ł":"ł","Ń":"ń","Ņ":"ņ","Ň":"ň","ŉ":"ʼn","Ŋ":"ŋ","Ō":"ō","Ŏ":"ŏ","Ő":"ő","Œ":"œ","Ŕ":"ŕ","Ŗ":"ŗ","Ř":"ř","Ś":"ś","Ŝ":"ŝ","Ş":"ş","Š":"š","Ţ":"ţ","Ť":"ť","Ŧ":"ŧ","Ũ":"ũ","Ū":"ū","Ŭ":"ŭ","Ů":"ů","Ű":"ű","Ų":"ų","Ŵ":"ŵ","Ŷ":"ŷ","Ÿ":"ÿ","Ź":"ź","Ż":"ż","Ž":"ž","ſ":"s","Ɓ":"ɓ","Ƃ":"ƃ","Ƅ":"ƅ","Ɔ":"ɔ","Ƈ":"ƈ","Ɖ":"ɖ","Ɗ":"ɗ","Ƌ":"ƌ","Ǝ":"ǝ","Ə":"ə","Ɛ":"ɛ","Ƒ":"ƒ","Ɠ":"ɠ","Ɣ":"ɣ","Ɩ":"ɩ","Ɨ":"ɨ","Ƙ":"ƙ","Ɯ":"ɯ","Ɲ":"ɲ","Ɵ":"ɵ","Ơ":"ơ","Ƣ":"ƣ","Ƥ":"ƥ","Ʀ":"ʀ","Ƨ":"ƨ","Ʃ":"ʃ","Ƭ":"ƭ","Ʈ":"ʈ","Ư":"ư","Ʊ":"ʊ","Ʋ":"ʋ","Ƴ":"ƴ","Ƶ":"ƶ","Ʒ":"ʒ","Ƹ":"ƹ","Ƽ":"ƽ","Ǆ":"ǆ","ǅ":"ǆ","Ǉ":"ǉ","ǈ":"ǉ","Ǌ":"ǌ","ǋ":"ǌ","Ǎ":"ǎ","Ǐ":"ǐ","Ǒ":"ǒ","Ǔ":"ǔ","Ǖ":"ǖ","Ǘ":"ǘ","Ǚ":"ǚ","Ǜ":"ǜ","Ǟ":"ǟ","Ǡ":"ǡ","Ǣ":"ǣ","Ǥ":"ǥ","Ǧ":"ǧ","Ǩ":"ǩ","Ǫ":"ǫ","Ǭ":"ǭ","Ǯ":"ǯ","ǰ":"ǰ","Ǳ":"ǳ","ǲ":"ǳ","Ǵ":"ǵ","Ƕ":"ƕ","Ƿ":"ƿ","Ǹ":"ǹ","Ǻ":"ǻ","Ǽ":"ǽ","Ǿ":"ǿ","Ȁ":"ȁ","Ȃ":"ȃ","Ȅ":"ȅ","Ȇ":"ȇ","Ȉ":"ȉ","Ȋ":"ȋ","Ȍ":"ȍ","Ȏ":"ȏ","Ȑ":"ȑ","Ȓ":"ȓ","Ȕ":"ȕ","Ȗ":"ȗ","Ș":"ș","Ț":"ț","Ȝ":"ȝ","Ȟ":"ȟ","Ƞ":"ƞ","Ȣ":"ȣ","Ȥ":"ȥ","Ȧ":"ȧ","Ȩ":"ȩ","Ȫ":"ȫ","Ȭ":"ȭ","Ȯ":"ȯ","Ȱ":"ȱ","Ȳ":"ȳ","Ⱥ":"ⱥ","Ȼ":"ȼ","Ƚ":"ƚ","Ⱦ":"ⱦ","Ɂ":"ɂ","Ƀ":"ƀ","Ʉ":"ʉ","Ʌ":"ʌ","Ɇ":"ɇ","Ɉ":"ɉ","Ɋ":"ɋ","Ɍ":"ɍ","Ɏ":"ɏ","ͅ":"ι","Ͱ":"ͱ","Ͳ":"ͳ","Ͷ":"ͷ","Ϳ":"ϳ","Ά":"ά","Έ":"έ","Ή":"ή","Ί":"ί","Ό":"ό","Ύ":"ύ","Ώ":"ώ","ΐ":"ΐ","Α":"α","Β":"β","Γ":"γ","Δ":"δ","Ε":"ε","Ζ":"ζ","Η":"η","Θ":"θ","Ι":"ι","Κ":"κ","Λ":"λ","Μ":"μ","Ν":"ν","Ξ":"ξ","Ο":"ο","Π":"π","Ρ":"ρ","Σ":"σ","Τ":"τ","Υ":"υ","Φ":"φ","Χ":"χ","Ψ":"ψ","Ω":"ω","Ϊ":"ϊ","Ϋ":"ϋ","ΰ":"ΰ","ς":"σ","Ϗ":"ϗ","ϐ":"β","ϑ":"θ","ϕ":"φ","ϖ":"π","Ϙ":"ϙ","Ϛ":"ϛ","Ϝ":"ϝ","Ϟ":"ϟ","Ϡ":"ϡ","Ϣ":"ϣ","Ϥ":"ϥ","Ϧ":"ϧ","Ϩ":"ϩ","Ϫ":"ϫ","Ϭ":"ϭ","Ϯ":"ϯ","ϰ":"κ","ϱ":"ρ","ϴ":"θ","ϵ":"ε","Ϸ":"ϸ","Ϲ":"ϲ","Ϻ":"ϻ","Ͻ":"ͻ","Ͼ":"ͼ","Ͽ":"ͽ","Ѐ":"ѐ","Ё":"ё","Ђ":"ђ","Ѓ":"ѓ","Є":"є","Ѕ":"ѕ","І":"і","Ї":"ї","Ј":"ј","Љ":"љ","Њ":"њ","Ћ":"ћ","Ќ":"ќ","Ѝ":"ѝ","Ў":"ў","Џ":"џ","А":"а","Б":"б","В":"в","Г":"г","Д":"д","Е":"е","Ж":"ж","З":"з","И":"и","Й":"й","К":"к","Л":"л","М":"м","Н":"н","О":"о","П":"п","Р":"р","С":"с","Т":"т","У":"у","Ф":"ф","Х":"х","Ц":"ц","Ч":"ч","Ш":"ш","Щ":"щ","Ъ":"ъ","Ы":"ы","Ь":"ь","Э":"э","Ю":"ю","Я":"я","Ѡ":"ѡ","Ѣ":"ѣ","Ѥ":"ѥ","Ѧ":"ѧ","Ѩ":"ѩ","Ѫ":"ѫ","Ѭ":"ѭ","Ѯ":"ѯ","Ѱ":"ѱ","Ѳ":"ѳ","Ѵ":"ѵ","Ѷ":"ѷ","Ѹ":"ѹ","Ѻ":"ѻ","Ѽ":"ѽ","Ѿ":"ѿ","Ҁ":"ҁ","Ҋ":"ҋ","Ҍ":"ҍ","Ҏ":"ҏ","Ґ":"ґ","Ғ":"ғ","Ҕ":"ҕ","Җ":"җ","Ҙ":"ҙ","Қ":"қ","Ҝ":"ҝ","Ҟ":"ҟ","Ҡ":"ҡ","Ң":"ң","Ҥ":"ҥ","Ҧ":"ҧ","Ҩ":"ҩ","Ҫ":"ҫ","Ҭ":"ҭ","Ү":"ү","Ұ":"ұ","Ҳ":"ҳ","Ҵ":"ҵ","Ҷ":"ҷ","Ҹ":"ҹ","Һ":"һ","Ҽ":"ҽ","Ҿ":"ҿ","Ӏ":"ӏ","Ӂ":"ӂ","Ӄ":"ӄ","Ӆ":"ӆ","Ӈ":"ӈ","Ӊ":"ӊ","Ӌ":"ӌ","Ӎ":"ӎ","Ӑ":"ӑ","Ӓ":"ӓ","Ӕ":"ӕ","Ӗ":"ӗ","Ә":"ә","Ӛ":"ӛ","Ӝ":"ӝ","Ӟ":"ӟ","Ӡ":"ӡ","Ӣ":"ӣ","Ӥ":"ӥ","Ӧ":"ӧ","Ө":"ө","Ӫ":"ӫ","Ӭ":"ӭ","Ӯ":"ӯ","Ӱ":"ӱ","Ӳ":"ӳ","Ӵ":"ӵ","Ӷ":"ӷ","Ӹ":"ӹ","Ӻ":"ӻ","Ӽ":"ӽ","Ӿ":"ӿ","Ԁ":"ԁ","Ԃ":"ԃ","Ԅ":"ԅ","Ԇ":"ԇ","Ԉ":"ԉ","Ԋ":"ԋ","Ԍ":"ԍ","Ԏ":"ԏ","Ԑ":"ԑ","Ԓ":"ԓ","Ԕ":"ԕ","Ԗ":"ԗ","Ԙ":"ԙ","Ԛ":"ԛ","Ԝ":"ԝ","Ԟ":"ԟ","Ԡ":"ԡ","Ԣ":"ԣ","Ԥ":"ԥ","Ԧ":"ԧ","Ԩ":"ԩ","Ԫ":"ԫ","Ԭ":"ԭ","Ԯ":"ԯ","Ա":"ա","Բ":"բ","Գ":"գ","Դ":"դ","Ե":"ե","Զ":"զ","Է":"է","Ը":"ը","Թ":"թ","Ժ":"ժ","Ի":"ի","Լ":"լ","Խ":"խ","Ծ":"ծ","Կ":"կ","Հ":"հ","Ձ":"ձ","Ղ":"ղ","Ճ":"ճ","Մ":"մ","Յ":"յ","Ն":"ն","Շ":"շ","Ո":"ո","Չ":"չ","Պ":"պ","Ջ":"ջ","Ռ":"ռ","Ս":"ս","Վ":"վ","Տ":"տ","Ր":"ր","Ց":"ց","Ւ":"ւ","Փ":"փ","Ք":"ք","Օ":"օ","Ֆ":"ֆ","և":"եւ","Ⴀ":"ⴀ","Ⴁ":"ⴁ","Ⴂ":"ⴂ","Ⴃ":"ⴃ","Ⴄ":"ⴄ","Ⴅ":"ⴅ","Ⴆ":"ⴆ","Ⴇ":"ⴇ","Ⴈ":"ⴈ","Ⴉ":"ⴉ","Ⴊ":"ⴊ","Ⴋ":"ⴋ","Ⴌ":"ⴌ","Ⴍ":"ⴍ","Ⴎ":"ⴎ","Ⴏ":"ⴏ","Ⴐ":"ⴐ","Ⴑ":"ⴑ","Ⴒ":"ⴒ","Ⴓ":"ⴓ","Ⴔ":"ⴔ","Ⴕ":"ⴕ","Ⴖ":"ⴖ","Ⴗ":"ⴗ","Ⴘ":"ⴘ","Ⴙ":"ⴙ","Ⴚ":"ⴚ","Ⴛ":"ⴛ","Ⴜ":"ⴜ","Ⴝ":"ⴝ","Ⴞ":"ⴞ","Ⴟ":"ⴟ","Ⴠ":"ⴠ","Ⴡ":"ⴡ","Ⴢ":"ⴢ","Ⴣ":"ⴣ","Ⴤ":"ⴤ","Ⴥ":"ⴥ","Ⴧ":"ⴧ","Ⴭ":"ⴭ","ᏸ":"Ᏸ","ᏹ":"Ᏹ","ᏺ":"Ᏺ","ᏻ":"Ᏻ","ᏼ":"Ᏼ","ᏽ":"Ᏽ","ᲀ":"в","ᲁ":"д","ᲂ":"о","ᲃ":"с","ᲄ":"т","ᲅ":"т","ᲆ":"ъ","ᲇ":"ѣ","ᲈ":"ꙋ","Ᲊ":"ᲊ","Ა":"ა","Ბ":"ბ","Გ":"გ","Დ":"დ","Ე":"ე","Ვ":"ვ","Ზ":"ზ","Თ":"თ","Ი":"ი","Კ":"კ","Ლ":"ლ","Მ":"მ","Ნ":"ნ","Ო":"ო","Პ":"პ","Ჟ":"ჟ","Რ":"რ","Ს":"ს","Ტ":"ტ","Უ":"უ","Ფ":"ფ","Ქ":"ქ","Ღ":"ღ","Ყ":"ყ","Შ":"შ","Ჩ":"ჩ","Ც":"ც","Ძ":"ძ","Წ":"წ","Ჭ":"ჭ","Ხ":"ხ","Ჯ":"ჯ","Ჰ":"ჰ","Ჱ":"ჱ","Ჲ":"ჲ","Ჳ":"ჳ","Ჴ":"ჴ","Ჵ":"ჵ","Ჶ":"ჶ","Ჷ":"ჷ","Ჸ":"ჸ","Ჹ":"ჹ","Ჺ":"ჺ","Ჽ":"ჽ","Ჾ":"ჾ","Ჿ":"ჿ","Ḁ":"ḁ","Ḃ":"ḃ","Ḅ":"ḅ","Ḇ":"ḇ","Ḉ":"ḉ","Ḋ":"ḋ","Ḍ":"ḍ","Ḏ":"ḏ","Ḑ":"ḑ","Ḓ":"ḓ","Ḕ":"ḕ","Ḗ":"ḗ","Ḙ":"ḙ","Ḛ":"ḛ","Ḝ":"ḝ","Ḟ":"ḟ","Ḡ":"ḡ","Ḣ":"ḣ","Ḥ":"ḥ","Ḧ":"ḧ","Ḩ":"ḩ","Ḫ":"ḫ","Ḭ":"ḭ","Ḯ":"ḯ","Ḱ":"ḱ","Ḳ":"ḳ","Ḵ":"ḵ","Ḷ":"ḷ","Ḹ":"ḹ","Ḻ":"ḻ","Ḽ":"ḽ","Ḿ":"ḿ","Ṁ":"ṁ","Ṃ":"ṃ","Ṅ":"ṅ","Ṇ":"ṇ","Ṉ":"ṉ","Ṋ":"ṋ","Ṍ":"ṍ","Ṏ":"ṏ","Ṑ":"ṑ","Ṓ":"ṓ","Ṕ":"ṕ","Ṗ":"ṗ","Ṙ":"ṙ","Ṛ":"ṛ","Ṝ":"ṝ","Ṟ":"ṟ","Ṡ":"ṡ","Ṣ":"ṣ","Ṥ":"ṥ","Ṧ":"ṧ","Ṩ":"ṩ","Ṫ":"ṫ","Ṭ":"ṭ","Ṯ":"ṯ","Ṱ":"ṱ","Ṳ":"ṳ","Ṵ":"ṵ","Ṷ":"ṷ","Ṹ":"ṹ","Ṻ":"ṻ","Ṽ":"ṽ","Ṿ":"ṿ","Ẁ":"ẁ","Ẃ":"ẃ","Ẅ":"ẅ","Ẇ":"ẇ","Ẉ":"ẉ","Ẋ":"ẋ","Ẍ":"ẍ","Ẏ":"ẏ","Ẑ":"ẑ","Ẓ":"ẓ","Ẕ":"ẕ","ẖ":"ẖ","ẗ":"ẗ","ẘ":"ẘ","ẙ":"ẙ","ẚ":"aʾ","ẛ":"ṡ","ẞ":"ss","Ạ":"ạ","Ả":"ả","Ấ":"ấ","Ầ":"ầ","Ẩ":"ẩ","Ẫ":"ẫ","Ậ":"ậ","Ắ":"ắ","Ằ":"ằ","Ẳ":"ẳ","Ẵ":"ẵ","Ặ":"ặ","Ẹ":"ẹ","Ẻ":"ẻ","Ẽ":"ẽ","Ế":"ế","Ề":"ề","Ể":"ể","Ễ":"ễ","Ệ":"ệ","Ỉ":"ỉ","Ị":"ị","Ọ":"ọ","Ỏ":"ỏ","Ố":"ố","Ồ":"ồ","Ổ":"ổ","Ỗ":"ỗ","Ộ":"ộ","Ớ":"ớ","Ờ":"ờ","Ở":"ở","Ỡ":"ỡ","Ợ":"ợ","Ụ":"ụ","Ủ":"ủ","Ứ":"ứ","Ừ":"ừ","Ử":"ử","Ữ":"ữ","Ự":"ự","Ỳ":"ỳ","Ỵ":"ỵ","Ỷ":"ỷ","Ỹ":"ỹ","Ỻ":"ỻ","Ỽ":"ỽ","Ỿ":"ỿ","Ἀ":"ἀ","Ἁ":"ἁ","Ἂ":"ἂ","Ἃ":"ἃ","Ἄ":"ἄ","Ἅ":"ἅ","Ἆ":"ἆ","Ἇ":"ἇ","Ἐ":"ἐ","Ἑ":"ἑ","Ἒ":"ἒ","Ἓ":"ἓ","Ἔ":"ἔ","Ἕ":"ἕ","Ἠ":"ἠ","Ἡ":"ἡ","Ἢ":"ἢ","Ἣ":"ἣ","Ἤ":"ἤ","Ἥ":"ἥ","Ἦ":"ἦ","Ἧ":"ἧ","Ἰ":"ἰ","Ἱ":"ἱ","Ἲ":"ἲ","Ἳ":"ἳ","Ἴ":"ἴ","Ἵ":"ἵ","Ἶ":"ἶ","Ἷ":"ἷ","Ὀ":"ὀ","Ὁ":"ὁ","Ὂ":"ὂ","Ὃ":"ὃ","Ὄ":"ὄ","Ὅ":"ὅ","ὐ":"ὐ","ὒ":"ὒ","ὔ":"ὔ","ὖ":"ὖ","Ὑ":"ὑ","Ὓ":"ὓ","Ὕ":"ὕ","Ὗ":"ὗ","Ὠ":"ὠ","Ὡ":"ὡ","Ὢ":"ὢ","Ὣ":"ὣ","Ὤ":"ὤ","Ὥ":"ὥ","Ὦ":"ὦ","Ὧ":"ὧ","ᾀ":"ἀι","ᾁ":"ἁι","ᾂ":"ἂι","ᾃ":"ἃι","ᾄ":"ἄι","ᾅ":"ἅι","ᾆ":"ἆι","ᾇ":"ἇι","ᾈ":"ἀι","ᾉ":"ἁι","ᾊ":"ἂι","ᾋ":"ἃι","ᾌ":"ἄι","ᾍ":"ἅι","ᾎ":"ἆι","ᾏ":"ἇι","ᾐ":"ἠι","ᾑ":"ἡι","ᾒ":"ἢι","ᾓ":"ἣι","ᾔ":"ἤι","ᾕ":"ἥι","ᾖ":"ἦι","ᾗ":"ἧι","ᾘ":"ἠι","ᾙ":"ἡι","ᾚ":"ἢι","ᾛ":"ἣι","ᾜ":"ἤι","ᾝ":"ἥι","ᾞ":"ἦι","ᾟ":"ἧι","ᾠ":"ὠι","ᾡ":"ὡι","ᾢ":"ὢι","ᾣ":"ὣι","ᾤ":"ὤι","ᾥ":"ὥι","ᾦ":"ὦι","ᾧ":"ὧι","ᾨ":"ὠι","ᾩ":"ὡι","ᾪ":"ὢι","ᾫ":"ὣι","ᾬ":"ὤι","ᾭ":"ὥι","ᾮ":"ὦι","ᾯ":"ὧι","ᾲ":"ὰι","ᾳ":"αι","ᾴ":"άι","ᾶ":"ᾶ","ᾷ":"ᾶι","Ᾰ":"ᾰ","Ᾱ":"ᾱ","Ὰ":"ὰ","Ά":"ά","ᾼ":"αι","ι":"ι","ῂ":"ὴι","ῃ":"ηι","ῄ":"ήι","ῆ":"ῆ","ῇ":"ῆι","Ὲ":"ὲ","Έ":"έ","Ὴ":"ὴ","Ή":"ή","ῌ":"ηι","ῒ":"ῒ","ΐ":"ΐ","ῖ":"ῖ","ῗ":"ῗ","Ῐ":"ῐ","Ῑ":"ῑ","Ὶ":"ὶ","Ί":"ί","ῢ":"ῢ","ΰ":"ΰ","ῤ":"ῤ","ῦ":"ῦ","ῧ":"ῧ","Ῠ":"ῠ","Ῡ":"ῡ","Ὺ":"ὺ","Ύ":"ύ","Ῥ":"ῥ","ῲ":"ὼι","ῳ":"ωι","ῴ":"ώι","ῶ":"ῶ","ῷ":"ῶι","Ὸ":"ὸ","Ό":"ό","Ὼ":"ὼ","Ώ":"ώ","ῼ":"ωι","Ω":"ω","K":"k","Å":"å","Ⅎ":"ⅎ","Ⅰ":"ⅰ","Ⅱ":"ⅱ","Ⅲ":"ⅲ","Ⅳ":"ⅳ","Ⅴ":"ⅴ","Ⅵ":"ⅵ","Ⅶ":"ⅶ","Ⅷ":"ⅷ","Ⅸ":"ⅸ","Ⅹ":"ⅹ","Ⅺ":"ⅺ","Ⅻ":"ⅻ","Ⅼ":"ⅼ","Ⅽ":"ⅽ","Ⅾ":"ⅾ","Ⅿ":"ⅿ","Ↄ":"ↄ","Ⓐ":"ⓐ","Ⓑ":"ⓑ","Ⓒ":"ⓒ","Ⓓ":"ⓓ","Ⓔ":"ⓔ","Ⓕ":"ⓕ","Ⓖ":"ⓖ","Ⓗ":"ⓗ","Ⓘ":"ⓘ","Ⓙ":"ⓙ","Ⓚ":"ⓚ","Ⓛ":"ⓛ","Ⓜ":"ⓜ","Ⓝ":"ⓝ","Ⓞ":"ⓞ","Ⓟ":"ⓟ","Ⓠ":"ⓠ","Ⓡ":"ⓡ","Ⓢ":"ⓢ","Ⓣ":"ⓣ","Ⓤ":"ⓤ","Ⓥ":"ⓥ","Ⓦ":"ⓦ","Ⓧ":"ⓧ","Ⓨ":"ⓨ","Ⓩ":"ⓩ","Ⰰ":"ⰰ","Ⰱ":"ⰱ","Ⰲ":"ⰲ","Ⰳ":"ⰳ","Ⰴ":"ⰴ","Ⰵ":"ⰵ","Ⰶ":"ⰶ","Ⰷ":"ⰷ","Ⰸ":"ⰸ","Ⰹ":"ⰹ","Ⰺ":"ⰺ","Ⰻ":"ⰻ","Ⰼ":"ⰼ","Ⰽ":"ⰽ","Ⰾ":"ⰾ","Ⰿ":"ⰿ","Ⱀ":"ⱀ","Ⱁ":"ⱁ","Ⱂ":"ⱂ","Ⱃ":"ⱃ","Ⱄ":"ⱄ","Ⱅ":"ⱅ","Ⱆ":"ⱆ","Ⱇ":"ⱇ","Ⱈ":"ⱈ","Ⱉ":"ⱉ","Ⱊ":"ⱊ","Ⱋ":"ⱋ","Ⱌ":"ⱌ","Ⱍ":"ⱍ","Ⱎ":"ⱎ","Ⱏ":"ⱏ","Ⱐ":"ⱐ","Ⱑ":"ⱑ","Ⱒ":"ⱒ","Ⱓ":"ⱓ","Ⱔ":"ⱔ","Ⱕ":"ⱕ","Ⱖ":"ⱖ","Ⱗ":"ⱗ","Ⱘ":"ⱘ","Ⱙ":"ⱙ","Ⱚ":"ⱚ","Ⱛ":"ⱛ","Ⱜ":"ⱜ","Ⱝ":"ⱝ","Ⱞ":"ⱞ","Ⱟ":"ⱟ","Ⱡ":"ⱡ","Ɫ":"ɫ","Ᵽ":"ᵽ","Ɽ":"ɽ","Ⱨ":"ⱨ","Ⱪ":"ⱪ","Ⱬ":"ⱬ","Ɑ":"ɑ","Ɱ":"ɱ","Ɐ":"ɐ","Ɒ":"ɒ","Ⱳ":"ⱳ","Ⱶ":"ⱶ","Ȿ":"ȿ","Ɀ":"ɀ","Ⲁ":"ⲁ","Ⲃ":"ⲃ","Ⲅ":"ⲅ","Ⲇ":"ⲇ","Ⲉ":"ⲉ","Ⲋ":"ⲋ","Ⲍ":"ⲍ","Ⲏ":"ⲏ","Ⲑ":"ⲑ","Ⲓ":"ⲓ","Ⲕ":"ⲕ","Ⲗ":"ⲗ","Ⲙ":"ⲙ","Ⲛ":"ⲛ","Ⲝ":"ⲝ","Ⲟ":"ⲟ","Ⲡ":"ⲡ","Ⲣ":"ⲣ","Ⲥ":"ⲥ","Ⲧ":"ⲧ","Ⲩ":"ⲩ","Ⲫ":"ⲫ","Ⲭ":"ⲭ","Ⲯ":"ⲯ","Ⲱ":"ⲱ","Ⲳ":"ⲳ","Ⲵ":"ⲵ","Ⲷ":"ⲷ","Ⲹ":"ⲹ","Ⲻ":"ⲻ","Ⲽ":"ⲽ","Ⲿ":"ⲿ","Ⳁ":"ⳁ","Ⳃ":"ⳃ","Ⳅ":"ⳅ","Ⳇ":"ⳇ","Ⳉ":"ⳉ","Ⳋ":"ⳋ","Ⳍ":"ⳍ","Ⳏ":"ⳏ","Ⳑ":"ⳑ","Ⳓ":"ⳓ","Ⳕ":"ⳕ","Ⳗ":"ⳗ","Ⳙ":"ⳙ","Ⳛ":"ⳛ","Ⳝ":"ⳝ","Ⳟ":"ⳟ","Ⳡ":"ⳡ","Ⳣ":"ⳣ","Ⳬ":"ⳬ","Ⳮ":"ⳮ","Ⳳ":"ⳳ","Ꙁ":"ꙁ","Ꙃ":"ꙃ","Ꙅ":"ꙅ","Ꙇ":"ꙇ","Ꙉ":"ꙉ","Ꙋ":"ꙋ","Ꙍ":"ꙍ","Ꙏ":"ꙏ","Ꙑ":"ꙑ","Ꙓ":"ꙓ","Ꙕ":"ꙕ","Ꙗ":"ꙗ","Ꙙ":"ꙙ","Ꙛ":"ꙛ","Ꙝ":"ꙝ","Ꙟ":"ꙟ","Ꙡ":"ꙡ","Ꙣ":"ꙣ","Ꙥ":"ꙥ","Ꙧ":"ꙧ","Ꙩ":"ꙩ","Ꙫ":"ꙫ","Ꙭ":"ꙭ","Ꚁ":"ꚁ","Ꚃ":"ꚃ","Ꚅ":"ꚅ","Ꚇ":"ꚇ","Ꚉ":"ꚉ","Ꚋ":"ꚋ","Ꚍ":"ꚍ","Ꚏ":"ꚏ","Ꚑ":"ꚑ","Ꚓ":"ꚓ","Ꚕ":"ꚕ","Ꚗ":"ꚗ","Ꚙ":"ꚙ","Ꚛ":"ꚛ","Ꜣ":"ꜣ","Ꜥ":"ꜥ","Ꜧ":"ꜧ","Ꜩ":"ꜩ","Ꜫ":"ꜫ","Ꜭ":"ꜭ","Ꜯ":"ꜯ","Ꜳ":"ꜳ","Ꜵ":"ꜵ","Ꜷ":"ꜷ","Ꜹ":"ꜹ","Ꜻ":"ꜻ","Ꜽ":"ꜽ","Ꜿ":"ꜿ","Ꝁ":"ꝁ","Ꝃ":"ꝃ","Ꝅ":"ꝅ","Ꝇ":"ꝇ","Ꝉ":"ꝉ","Ꝋ":"ꝋ","Ꝍ":"ꝍ","Ꝏ":"ꝏ","Ꝑ":"ꝑ","Ꝓ":"ꝓ","Ꝕ":"ꝕ","Ꝗ":"ꝗ","Ꝙ":"ꝙ","Ꝛ":"ꝛ","Ꝝ":"ꝝ","Ꝟ":"ꝟ","Ꝡ":"ꝡ","Ꝣ":"ꝣ","Ꝥ":"ꝥ","Ꝧ":"ꝧ","Ꝩ":"ꝩ","Ꝫ":"ꝫ","Ꝭ":"ꝭ","Ꝯ":"ꝯ","Ꝺ":"ꝺ","Ꝼ":"ꝼ","Ᵹ":"ᵹ","Ꝿ":"ꝿ","Ꞁ":"ꞁ","Ꞃ":"ꞃ","Ꞅ":"ꞅ","Ꞇ":"ꞇ","Ꞌ":"ꞌ","Ɥ":"ɥ","Ꞑ":"ꞑ","Ꞓ":"ꞓ","Ꞗ":"ꞗ","Ꞙ":"ꞙ","Ꞛ":"ꞛ","Ꞝ":"ꞝ","Ꞟ":"ꞟ","Ꞡ":"ꞡ","Ꞣ":"ꞣ","Ꞥ":"ꞥ","Ꞧ":"ꞧ","Ꞩ":"ꞩ","Ɦ":"ɦ","Ɜ":"ɜ","Ɡ":"ɡ","Ɬ":"ɬ","Ɪ":"ɪ","Ʞ":"ʞ","Ʇ":"ʇ","Ʝ":"ʝ","Ꭓ":"ꭓ","Ꞵ":"ꞵ","Ꞷ":"ꞷ","Ꞹ":"ꞹ","Ꞻ":"ꞻ","Ꞽ":"ꞽ","Ꞿ":"ꞿ","Ꟁ":"ꟁ","Ꟃ":"ꟃ","Ꞔ":"ꞔ","Ʂ":"ʂ","Ᶎ":"ᶎ","Ꟈ":"ꟈ","Ꟊ":"ꟊ","Ɤ":"ɤ","Ꟍ":"ꟍ","Ꟑ":"ꟑ","Ꟗ":"ꟗ","Ꟙ":"ꟙ","Ꟛ":"ꟛ","Ƛ":"ƛ","Ꟶ":"ꟶ","ꭰ":"Ꭰ","ꭱ":"Ꭱ","ꭲ":"Ꭲ","ꭳ":"Ꭳ","ꭴ":"Ꭴ","ꭵ":"Ꭵ","ꭶ":"Ꭶ","ꭷ":"Ꭷ","ꭸ":"Ꭸ","ꭹ":"Ꭹ","ꭺ":"Ꭺ","ꭻ":"Ꭻ","ꭼ":"Ꭼ","ꭽ":"Ꭽ","ꭾ":"Ꭾ","ꭿ":"Ꭿ","ꮀ":"Ꮀ","ꮁ":"Ꮁ","ꮂ":"Ꮂ","ꮃ":"Ꮃ","ꮄ":"Ꮄ","ꮅ":"Ꮅ","ꮆ":"Ꮆ","ꮇ":"Ꮇ","ꮈ":"Ꮈ","ꮉ":"Ꮉ","ꮊ":"Ꮊ","ꮋ":"Ꮋ","ꮌ":"Ꮌ","ꮍ":"Ꮍ","ꮎ":"Ꮎ","ꮏ":"Ꮏ","ꮐ":"Ꮐ","ꮑ":"Ꮑ","ꮒ":"Ꮒ","ꮓ":"Ꮓ","ꮔ":"Ꮔ","ꮕ":"Ꮕ","ꮖ":"Ꮖ","ꮗ":"Ꮗ","ꮘ":"Ꮘ","ꮙ":"Ꮙ","ꮚ":"Ꮚ","ꮛ":"Ꮛ","ꮜ":"Ꮜ","ꮝ":"Ꮝ","ꮞ":"Ꮞ","ꮟ":"Ꮟ","ꮠ":"Ꮠ","ꮡ":"Ꮡ","ꮢ":"Ꮢ","ꮣ":"Ꮣ","ꮤ":"Ꮤ","ꮥ":"Ꮥ","ꮦ":"Ꮦ","ꮧ":"Ꮧ","ꮨ":"Ꮨ","ꮩ":"Ꮩ","ꮪ":"Ꮪ","ꮫ":"Ꮫ","ꮬ":"Ꮬ","ꮭ":"Ꮭ","ꮮ":"Ꮮ","ꮯ":"Ꮯ","ꮰ":"Ꮰ","ꮱ":"Ꮱ","ꮲ":"Ꮲ","ꮳ":"Ꮳ","ꮴ":"Ꮴ","ꮵ":"Ꮵ","ꮶ":"Ꮶ","ꮷ":"Ꮷ","ꮸ":"Ꮸ","ꮹ":"Ꮹ","ꮺ":"Ꮺ","ꮻ":"Ꮻ","ꮼ":"Ꮼ","ꮽ":"Ꮽ","ꮾ":"Ꮾ","ꮿ":"Ꮿ","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st","ﬓ":"մն","ﬔ":"մե","ﬕ":"մի","ﬖ":"վն","ﬗ":"մխ","Ａ":"ａ","Ｂ":"ｂ","Ｃ":"ｃ","Ｄ":"ｄ","Ｅ":"ｅ","Ｆ":"ｆ","Ｇ":"ｇ","Ｈ":"ｈ","Ｉ":"ｉ","Ｊ":"ｊ","Ｋ":"ｋ","Ｌ":"ｌ","Ｍ":"ｍ","Ｎ":"ｎ","Ｏ":"ｏ","Ｐ":"ｐ","Ｑ":"ｑ","Ｒ":"ｒ","Ｓ":"ｓ","Ｔ":"ｔ","Ｕ":"ｕ","Ｖ":"ｖ","Ｗ":"ｗ","Ｘ":"ｘ","Ｙ":"ｙ","Ｚ":"ｚ","𐐀":"𐐨","𐐁":"𐐩","𐐂":"𐐪","𐐃":"𐐫","𐐄":"𐐬","𐐅":"𐐭","𐐆":"𐐮","𐐇":"𐐯","𐐈":"𐐰","𐐉":"𐐱","𐐊":"𐐲","𐐋":"𐐳","𐐌":"𐐴","𐐍":"𐐵","𐐎":"𐐶","𐐏":"𐐷","𐐐":"𐐸","𐐑":"𐐹","𐐒":"𐐺","𐐓":"𐐻","𐐔":"𐐼","𐐕":"𐐽","𐐖":"𐐾","𐐗":"𐐿","𐐘":"𐑀","𐐙":"𐑁","𐐚":"𐑂","𐐛":"𐑃","𐐜":"𐑄","𐐝":"𐑅","𐐞":"𐑆","𐐟":"𐑇","𐐠":"𐑈","𐐡":"𐑉","𐐢":"𐑊","𐐣":"𐑋","𐐤":"𐑌","𐐥":"𐑍","𐐦":"𐑎","𐐧":"𐑏","𐒰":"𐓘","𐒱":"𐓙","𐒲":"𐓚","𐒳":"𐓛","𐒴":"𐓜","𐒵":"𐓝","𐒶":"𐓞","𐒷":"𐓟","𐒸":"𐓠","𐒹":"𐓡","𐒺":"𐓢","𐒻":"𐓣","𐒼":"𐓤","𐒽":"𐓥","𐒾":"𐓦","𐒿":"𐓧","𐓀":"𐓨","𐓁":"𐓩","𐓂":"𐓪","𐓃":"𐓫","𐓄":"𐓬","𐓅":"𐓭","𐓆":"𐓮","𐓇":"𐓯","𐓈":"𐓰","𐓉":"𐓱","𐓊":"𐓲","𐓋":"𐓳","𐓌":"𐓴","𐓍":"𐓵","𐓎":"𐓶","𐓏":"𐓷","𐓐":"𐓸","𐓑":"𐓹","𐓒":"𐓺","𐓓":"𐓻","𐕰":"𐖗","𐕱":"𐖘","𐕲":"𐖙","𐕳":"𐖚","𐕴":"𐖛","𐕵":"𐖜","𐕶":"𐖝","𐕷":"𐖞","𐕸":"𐖟","𐕹":"𐖠","𐕺":"𐖡","𐕼":"𐖣","𐕽":"𐖤","𐕾":"𐖥","𐕿":"𐖦","𐖀":"𐖧","𐖁":"𐖨","𐖂":"𐖩","𐖃":"𐖪","𐖄":"𐖫","𐖅":"𐖬","𐖆":"𐖭","𐖇":"𐖮","𐖈":"𐖯","𐖉":"𐖰","𐖊":"𐖱","𐖌":"𐖳","𐖍":"𐖴","𐖎":"𐖵","𐖏":"𐖶","𐖐":"𐖷","𐖑":"𐖸","𐖒":"𐖹","𐖔":"𐖻","𐖕":"𐖼","𐲀":"𐳀","𐲁":"𐳁","𐲂":"𐳂","𐲃":"𐳃","𐲄":"𐳄","𐲅":"𐳅","𐲆":"𐳆","𐲇":"𐳇","𐲈":"𐳈","𐲉":"𐳉","𐲊":"𐳊","𐲋":"𐳋","𐲌":"𐳌","𐲍":"𐳍","𐲎":"𐳎","𐲏":"𐳏","𐲐":"𐳐","𐲑":"𐳑","𐲒":"𐳒","𐲓":"𐳓","𐲔":"𐳔","𐲕":"𐳕","𐲖":"𐳖","𐲗":"𐳗","𐲘":"𐳘","𐲙":"𐳙","𐲚":"𐳚","𐲛":"𐳛","𐲜":"𐳜","𐲝":"𐳝","𐲞":"𐳞","𐲟":"𐳟","𐲠":"𐳠","𐲡":"𐳡","𐲢":"𐳢","𐲣":"𐳣","𐲤":"𐳤","𐲥":"𐳥","𐲦":"𐳦","𐲧":"𐳧","𐲨":"𐳨","𐲩":"𐳩","𐲪":"𐳪","𐲫":"𐳫","𐲬":"𐳬","𐲭":"𐳭","𐲮":"𐳮","𐲯":"𐳯","𐲰":"𐳰","𐲱":"𐳱","𐲲":"𐳲","𐵐":"𐵰","𐵑":"𐵱","𐵒":"𐵲","𐵓":"𐵳","𐵔":"𐵴","𐵕":"𐵵","𐵖":"𐵶","𐵗":"𐵷","𐵘":"𐵸","𐵙":"𐵹","𐵚":"𐵺","𐵛":"𐵻","𐵜":"𐵼","𐵝":"𐵽","𐵞":"𐵾","𐵟":"𐵿","𐵠":"𐶀","𐵡":"𐶁","𐵢":"𐶂","𐵣":"𐶃","𐵤":"𐶄","𐵥":"𐶅","𑢠":"𑣀","𑢡":"𑣁","𑢢":"𑣂","𑢣":"𑣃","𑢤":"𑣄","𑢥":"𑣅","𑢦":"𑣆","𑢧":"𑣇","𑢨":"𑣈","𑢩":"𑣉","𑢪":"𑣊","𑢫":"𑣋","𑢬":"𑣌","𑢭":"𑣍","𑢮":"𑣎","𑢯":"𑣏","𑢰":"𑣐","𑢱":"𑣑","𑢲":"𑣒","𑢳":"𑣓","𑢴":"𑣔","𑢵":"𑣕","𑢶":"𑣖","𑢷":"𑣗","𑢸":"𑣘","𑢹":"𑣙","𑢺":"𑣚","𑢻":"𑣛","𑢼":"𑣜","𑢽":"𑣝","𑢾":"𑣞","𑢿":"𑣟","𖹀":"𖹠","𖹁":"𖹡","𖹂":"𖹢","𖹃":"𖹣","𖹄":"𖹤","𖹅":"𖹥","𖹆":"𖹦","𖹇":"𖹧","𖹈":"𖹨","𖹉":"𖹩","𖹊":"𖹪","𖹋":"𖹫","𖹌":"𖹬","𖹍":"𖹭","𖹎":"𖹮","𖹏":"𖹯","𖹐":"𖹰","𖹑":"𖹱","𖹒":"𖹲","𖹓":"𖹳","𖹔":"𖹴","𖹕":"𖹵","𖹖":"𖹶","𖹗":"𖹷","𖹘":"𖹸","𖹙":"𖹹","𖹚":"𖹺","𖹛":"𖹻","𖹜":"𖹼","𖹝":"𖹽","𖹞":"𖹾","𖹟":"𖹿","𞤀":"𞤢","𞤁":"𞤣","𞤂":"𞤤","𞤃":"𞤥","𞤄":"𞤦","𞤅":"𞤧","𞤆":"𞤨","𞤇":"𞤩","𞤈":"𞤪","𞤉":"𞤫","𞤊":"𞤬","𞤋":"𞤭","𞤌":"𞤮","𞤍":"𞤯","𞤎":"𞤰","𞤏":"𞤱","𞤐":"𞤲","𞤑":"𞤳","𞤒":"𞤴","𞤓":"𞤵","𞤔":"𞤶","𞤕":"𞤷","𞤖":"𞤸","𞤗":"𞤹","𞤘":"𞤺","𞤙":"𞤻","𞤚":"𞤼","𞤛":"𞤽","𞤜":"𞤾","𞤝":"𞤿","𞤞":"𞥀","𞤟":"𞥁","𞤠":"𞥂","𞤡":"𞥃"}$fold$::jsonb->>letter,letter),'' ORDER BY ordinal),''))
FROM regexp_split_to_table(normalize(input,NFKC),'') WITH ORDINALITY AS part(letter,ordinal)
$fn$;
ALTER FUNCTION content_intake.sop_query_normalize(text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_normalize(text) FROM PUBLIC;
-- Candidate only. Install exclusively with install.test-only.ts after the verified 0083 prefix.
-- Query annotations are explicit author input absent from the frozen graph shape.
-- They contain no answer text and cannot replace graph or release lineage.
CREATE TABLE content_intake.sop_query_annotations (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  nodes jsonb NOT NULL CHECK (jsonb_typeof(nodes) = 'array'),
  edges jsonb NOT NULL CHECK (jsonb_typeof(edges) = 'array'),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_annotations
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable();
ALTER TABLE content_intake.sop_query_annotations OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_query_annotations FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE TABLE content_intake.sop_query_requests (
  actor_binding_hash content_intake.sha256 NOT NULL,
  request_id uuid NOT NULL,
  request_hash content_intake.sha256 NOT NULL,
  PRIMARY KEY (actor_binding_hash,request_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_requests
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_query_lease_immutable();
ALTER TABLE content_intake.sop_query_requests OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_query_requests FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE TABLE content_intake.sop_query_completions (
  actor_binding_hash content_intake.sha256 NOT NULL,
  request_id uuid NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (actor_binding_hash,request_id),
  FOREIGN KEY (actor_binding_hash,request_id) REFERENCES content_intake.sop_query_requests
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_completions
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_query_lease_immutable();
ALTER TABLE content_intake.sop_query_completions OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_query_completions FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE FUNCTION content_intake.complete_sop_query(p_actor text,p_request uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO content_intake.sop_query_completions VALUES(p_actor,p_request,p_result) ON CONFLICT DO NOTHING;
  RETURN p_result;
END $$;
ALTER FUNCTION content_intake.complete_sop_query(text,uuid,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.complete_sop_query(text,uuid,jsonb) FROM PUBLIC;

-- Leases can only be minted through the authorized query, never by a runtime caller.
REVOKE ALL ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM app_runtime;

CREATE FUNCTION content_intake.sop_query_closed(p_status text,p_reason text,p_release text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('status',p_status,'release_id',p_release,
    'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code',p_reason)))
$$;
ALTER FUNCTION content_intake.sop_query_closed(text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_closed(text,text,text) FROM PUBLIC;

CREATE FUNCTION content_intake.read_sop_query(
  p_user_id text,p_session_token_hash text,p_sop_group text,p_shop_id text,
  p_product_context_type text,p_product_context_ref text,p_query_text text,
  p_context_generation text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,content_intake,public,pg_temp AS $$
DECLARE
  at_time timestamptz := clock_timestamp();
  deadline timestamptz;
  session_deadline timestamptz;
  actor content_intake.principals;
  graph content_intake.sop_graph_versions;
  annotations content_intake.sop_query_annotations;
  lease content_intake.sop_query_leases;
  release_id_value text;
  flow_id_value text;
  binding_hash text;
  body_hash text;
  old_hash text;
  prior_result jsonb;
  node_value jsonb;
  edge_value jsonb;
  entry_value jsonb;
  meta jsonb;
  nodes jsonb := '[]';
  edges jsonb := '[]';
  messages jsonb := '[]';
  matched boolean;
  match_count integer;
  approval_deadline timestamptz;
  graph_count integer;
  node_count integer;
  visited_count integer;
  output_kind text;
  title_value text;
  text_value text;
BEGIN
  IF p_request_id IS NULL OR p_shop_id IS NULL OR length(p_shop_id) NOT BETWEEN 1 AND 128
    OR p_query_text IS NULL OR length(btrim(p_query_text)) NOT BETWEEN 1 AND 2048
    OR p_context_generation IS NULL OR length(btrim(p_context_generation)) NOT BETWEEN 1 AND 128
    OR NOT ((p_product_context_type IS NULL AND p_product_context_ref IS NULL)
      OR (p_product_context_type IN ('storewide','category','sku') AND length(p_product_context_ref) BETWEEN 1 AND 256)) THEN
    RAISE EXCEPTION 'SOP_BLOCKED' USING ERRCODE='22023';
  END IF;
  flow_id_value := CASE p_sop_group WHEN '过敏流程SOP' THEN 'allergy' WHEN '长痘痘SOP' THEN 'acne'
    WHEN '品质售后SOP' THEN 'quality-after-sale' WHEN '少错破SOP' THEN 'less-breakage' WHEN '税收相关规则' THEN 'tax' END;
  IF flow_id_value IS NULL THEN RAISE EXCEPTION 'SOP_BLOCKED' USING ERRCODE='22023'; END IF;
  PERFORM backend_review.lock_content();
  BEGIN
    session_deadline := intake_runtime.lock_product_session(p_session_token_hash,p_user_id);
  EXCEPTION WHEN SQLSTATE 'ZA003' THEN
    RAISE EXCEPTION 'SCOPE_DENIED' USING ERRCODE='ZA005';
  END;
  SELECT * INTO actor FROM content_intake.principals WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_DENIED' USING ERRCODE='ZA005'; END IF;
  at_time := clock_timestamp();
  SELECT max(least(allowed.valid_until,member.content_valid_until)) INTO deadline
    FROM content_intake.authorization_sources(actor.principal_id,'query',at_time) allowed
    JOIN content_intake.sources src ON src.source_id=allowed.source_id
    JOIN content_intake.scopes scope ON scope.scope_id=allowed.scope_id
    JOIN content_intake.store_set_members member ON member.tenant_id=actor.tenant_id AND member.app_id=actor.app_id
      AND member.version=allowed.store_set_version AND member.source_id=allowed.source_id AND member.scope_id=allowed.scope_id
    WHERE src.source_id='menokin-sop' AND src.mode='v2-preview' AND scope.shop_id=p_shop_id
      AND scope.tenant_id=actor.tenant_id AND scope.app_id=actor.app_id;
  IF deadline IS NULL OR deadline<=at_time THEN RAISE EXCEPTION 'SCOPE_DENIED' USING ERRCODE='ZA005'; END IF;
  deadline := least(deadline,session_deadline,at_time+interval '15 minutes');
  binding_hash := encode(public.digest(p_user_id||':'||p_session_token_hash,'sha256'),'hex');
  body_hash := encode(public.digest(public.jsonb_jcs(jsonb_build_array(p_sop_group,p_shop_id,
    p_product_context_type,p_product_context_ref,p_query_text,p_context_generation)),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(binding_hash||p_request_id::text,0));
  INSERT INTO content_intake.sop_query_requests VALUES(binding_hash,p_request_id,body_hash) ON CONFLICT DO NOTHING;
  SELECT request_hash INTO old_hash FROM content_intake.sop_query_requests
    WHERE actor_binding_hash=binding_hash AND request_id=p_request_id;
  IF old_hash<>body_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  SELECT current_release_id INTO release_id_value FROM public.content_current WHERE id=1;
  SELECT * INTO lease FROM content_intake.sop_query_leases WHERE actor_binding_hash=binding_hash AND request_id=p_request_id;
  IF FOUND THEN
    IF lease.release_id IS DISTINCT FROM release_id_value OR lease.session_epoch<>actor.revocation_generation THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','STALE_RELEASE',lease.release_id));
    END IF;
    IF lease.expires_at<=clock_timestamp() THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','LEASE_EXPIRED',lease.release_id)); END IF;
  END IF;
  SELECT result INTO prior_result FROM content_intake.sop_query_completions
    WHERE actor_binding_hash=binding_hash AND request_id=p_request_id;
  IF prior_result->>'status' IN ('blocked','stale') THEN RETURN prior_result; END IF;
  IF release_id_value IS NULL OR NOT EXISTS (SELECT 1 FROM public.content_releases r
    JOIN content_intake.release_catalogs c USING(release_id)
    JOIN public.v_release_source_gate gate USING(release_id)
    WHERE r.release_id=release_id_value AND r.tenant_id=actor.tenant_id AND r.status='published'
      AND gate.source_gate_ready AND public.owner_acceptance_release_content_ready(r.release_id)) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SOURCE_GATE_NOT_READY'));
  END IF;
  IF EXISTS(SELECT 1 FROM content_intake.release_revocations WHERE release_id=release_id_value) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','APPROVAL_REVOKED',release_id_value));
  END IF;
  SELECT count(*) INTO graph_count FROM content_intake.sop_graph_release_lineage
    WHERE release_id=release_id_value AND source_id='menokin-sop' AND flow_id=flow_id_value;
  IF graph_count<>1 THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
  SELECT g.* INTO graph FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.sop_graph_versions g USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    JOIN content_intake.candidate_versions c ON c.candidate_id=g.candidate_id AND c.version=g.candidate_version
    JOIN content_intake.sources s ON s.source_id=c.source_id
    WHERE l.release_id=release_id_value AND l.source_id='menokin-sop' AND l.flow_id=flow_id_value
      AND g.operation='upsert' AND c.state='published' AND c.source_version=s.current_mapping_version;
  IF NOT FOUND THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','STALE_RELEASE',release_id_value)); END IF;
  IF NOT EXISTS(SELECT 1 FROM content_intake.candidate_versions c
    JOIN content_intake.source_confirmations sc ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version
      AND sc.evidence_version=c.source_evidence_version AND sc.candidate_digest=c.digest AND sc.object_sha256=c.file_sha256
    WHERE c.candidate_id=graph.candidate_id AND c.version=graph.candidate_version) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SOURCE_GATE_NOT_READY'));
  END IF;
  SELECT min(f.valid_until) INTO approval_deadline FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.review_bindings r USING(review_request_id)
    JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts f USING(review_request_id,facts_version)
    WHERE l.release_id=release_id_value AND f.state='approved' AND f.checked_at<=at_time AND f.valid_until>at_time
      AND f.package_verified_sha256=r.package_sha256;
  IF approval_deadline IS NULL OR EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.review_bindings r USING(review_request_id)
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts f USING(review_request_id,facts_version)
    WHERE l.release_id=release_id_value AND (f.state IS DISTINCT FROM 'approved' OR f.valid_until<=at_time
      OR f.checked_at>at_time OR f.package_verified_sha256 IS DISTINCT FROM r.package_sha256)) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','APPROVAL_REVOKED',release_id_value));
  END IF;
  deadline := least(deadline,approval_deadline);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'entries') dep
    WHERE dep->>'sourceId' IS DISTINCT FROM graph.source_id::text OR NOT EXISTS(
      SELECT 1 FROM content_intake.release_lineage l
      JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
      CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') entry
      WHERE l.release_id=release_id_value AND l.source_id=graph.source_id
        AND l.business_entry_id=dep#>>'{entry,businessEntryId}' AND l.script_version::text=dep#>>'{entry,scriptVersion}'
        AND entry=dep->'entry' AND entry->>'operation'='upsert')) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') n
    WHERE n->'key' IS DISTINCT FROM graph.graph_payload#>'{definition,header,key}')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e
      WHERE e->'key' IS DISTINCT FROM graph.graph_payload#>'{definition,header,key}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'entries') dep
      WHERE dep->>'sourceId'=graph.graph_payload#>>'{definition,header,anchorEntry,sourceId}'
        AND dep#>>'{entry,businessEntryId}'=graph.graph_payload#>>'{definition,header,anchorEntry,businessEntryId}'
        AND dep#>>'{entry,scriptVersion}'=graph.graph_payload#>>'{definition,header,anchorEntry,scriptVersion}')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') n
      WHERE n#>>'{body,kind}'='message' AND n#>>'{body,entry,sourceId}' IS DISTINCT FROM graph.source_id::text)
    OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e)
      <>jsonb_array_length(graph.graph_payload#>'{definition,edges}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  IF graph.canonical_graph IS DISTINCT FROM public.jsonb_jcs(graph.graph_payload) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  FOR entry_value IN SELECT value->'entry' FROM jsonb_array_elements(graph.graph_payload->'entries') LOOP
    IF (entry_value->>'effectiveFrom')::timestamptz>at_time OR (entry_value->>'effectiveTo')::timestamptz<=at_time THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','STALE_RELEASE',release_id_value));
    END IF;
    deadline := least(deadline,(entry_value->>'effectiveTo')::timestamptz);
    IF jsonb_array_length(entry_value->'productRefs')>0 AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(entry_value->'productRefs') ref WHERE ref->>'id'=p_product_context_ref
        AND p_product_context_type IN ('category','sku')) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SCOPE_DENIED'));
    END IF;
    IF jsonb_array_length(entry_value->'scenarioRefs')>0 THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SCOPE_DENIED'));
    END IF;
  END LOOP;
  -- Missing transport declarations never acquire meaning from array order or answer text.
  SELECT * INTO annotations FROM content_intake.sop_query_annotations
    WHERE candidate_id=graph.candidate_id AND candidate_version=graph.candidate_version
      AND source_id=graph.source_id AND flow_id=graph.flow_id AND graph_digest=graph.graph_digest;
  IF NOT FOUND THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
  IF jsonb_array_length(graph.graph_payload->'media')<>0 THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','MEDIA_UNVERIFIED'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_checks q
    WHERE q.candidate_id=graph.candidate_id AND q.candidate_version=graph.candidate_version
      AND q.source_id=graph.source_id AND q.flow_id=graph.flow_id AND q.graph_digest=graph.graph_digest AND NOT q.defect)
    OR EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_checks q
      WHERE q.candidate_id=graph.candidate_id AND q.candidate_version=graph.candidate_version AND q.defect) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SAFETY_REVIEW_REQUIRED'));
  END IF;
  node_count := jsonb_array_length(graph.graph_payload#>'{definition,nodes}');
  IF (SELECT count(DISTINCT e->>'branch_id') FROM jsonb_array_elements(annotations.edges) e)<>jsonb_array_length(annotations.edges)
    OR jsonb_array_length(annotations.nodes)<>node_count
    OR jsonb_array_length(annotations.edges)<>jsonb_array_length(graph.graph_payload#>'{definition,edges}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  FOR node_value IN SELECT value FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') LOOP
    SELECT value INTO meta FROM jsonb_array_elements(annotations.nodes) WHERE value->>'node_id'=node_value->>'id';
    IF meta IS NULL OR jsonb_typeof(meta->'sequence') IS DISTINCT FROM 'number'
      OR COALESCE(meta->>'sequence','') !~ '^[0-9]{1,5}$' OR (meta->>'sequence')::numeric>10000
      OR jsonb_typeof(meta->'source_ref') IS DISTINCT FROM 'string' OR COALESCE(meta->>'source_ref','')=''
      OR (SELECT count(*) FROM jsonb_array_elements(annotations.nodes) WHERE value->>'node_id'=node_value->>'id')<>1 THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    SELECT count(*) INTO graph_count FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id';
    IF (node_value#>>'{body,kind}' IN ('message','internal') AND (graph_count<>1 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id' AND e#>>'{action,kind}' IS DISTINCT FROM 'next')))
      OR (node_value#>>'{body,kind}'='decision' AND (graph_count NOT BETWEEN 2 AND 4 OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id' AND e#>>'{action,kind}' IS DISTINCT FROM 'choice'))) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    IF node_value#>>'{body,kind}'='decision' AND (
      SELECT array_agg((e#>>'{action,ordinal}')::integer ORDER BY (e#>>'{action,ordinal}')::integer)
      FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id'
    ) IS DISTINCT FROM ARRAY(SELECT generate_series(1,graph_count)) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    output_kind := CASE node_value#>>'{body,kind}' WHEN 'message' THEN 'instruction' WHEN 'internal' THEN 'instruction'
      WHEN 'decision' THEN 'decision' WHEN 'end' THEN 'terminal' END;
    IF output_kind IS NULL THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
    nodes := nodes||jsonb_build_array(jsonb_build_object('node_id',node_value->>'id','scenario_id',flow_id_value,
      'sequence',meta->'sequence','kind',output_kind,'terminal',output_kind='terminal','source_ref',meta->>'source_ref'));
    IF node_value#>>'{body,kind}'='message' THEN
      SELECT value->'entry' INTO entry_value FROM jsonb_array_elements(graph.graph_payload->'entries')
        WHERE value->>'sourceId'=graph.source_id AND value#>>'{entry,businessEntryId}'=node_value#>>'{body,entry,businessEntryId}'
          AND value#>>'{entry,scriptVersion}'=node_value#>>'{body,entry,scriptVersion}' AND value#>>'{entry,operation}'='upsert';
      IF entry_value IS NULL THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
      title_value := entry_value->>'title'; text_value := entry_value->>'answerText';
    ELSE
      title_value := meta->>'title'; text_value := node_value#>>'{body,text}';
    END IF;
    IF COALESCE(meta->>'message_id','')='' OR COALESCE(title_value,'')='' OR COALESCE(text_value,'')=''
      OR COALESCE(meta->>'risk_level','') NOT IN ('unclassified','low','medium','high','critical')
      OR jsonb_typeof(meta->'copy_allowed') IS DISTINCT FROM 'boolean' THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    IF meta->>'risk_level'='unclassified' OR (node_value#>>'{body,kind}'<>'message' AND (meta->>'copy_allowed')::boolean) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SAFETY_REVIEW_REQUIRED'));
    END IF;
    IF (title_value LIKE '%过敏%' OR text_value LIKE '%过敏%') AND (text_value NOT LIKE '%停手%' OR text_value NOT LIKE '%确认%') THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SAFETY_REVIEW_REQUIRED'));
    END IF;
    messages := messages||jsonb_build_array(jsonb_build_object('message_id',meta->>'message_id','node_id',node_value->>'id',
      'title',title_value,'body',text_value,'risk_level',meta->>'risk_level','copy_allowed',meta->'copy_allowed'));
  END LOOP;
  FOR edge_value IN SELECT value FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') LOOP
    SELECT value INTO meta FROM jsonb_array_elements(annotations.edges) WHERE value->>'branch_id'=edge_value->>'id';
    IF meta IS NULL OR COALESCE(meta->>'option','')='' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=edge_value->>'from')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=edge_value->>'to')
      OR (edge_value#>>'{action,kind}'='choice' AND meta->>'option' IS DISTINCT FROM edge_value#>>'{action,label}') THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=edge_value->>'from' AND (value->>'terminal')::boolean) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','TERMINAL_HAS_OUTGOING_EDGE'));
    END IF;
    edges := edges||jsonb_build_array(jsonb_build_object('branch_id',edge_value->>'id','source_node_id',edge_value->>'from',
      'option',meta->>'option','target_node_id',edge_value->>'to','is_unresolved',false));
  END LOOP;
  WITH RECURSIVE reach(a,b) AS (
    SELECT edge->>'source_node_id',edge->>'target_node_id' FROM jsonb_array_elements(edges) edge
    UNION SELECT reach.a,edge->>'target_node_id' FROM reach
      JOIN jsonb_array_elements(edges) edge ON edge->>'source_node_id'=reach.b
  ) SELECT CASE WHEN EXISTS(SELECT 1 FROM reach WHERE a=b) THEN -1 ELSE
      1+(SELECT count(*)::integer FROM reach WHERE a=graph.graph_payload#>>'{definition,header,startNodeId}') END INTO visited_count;
  IF visited_count<>node_count OR (SELECT count(DISTINCT n->>'node_id') FROM jsonb_array_elements(nodes) n)<>node_count
    OR (SELECT count(DISTINCT n->>'sequence') FROM jsonb_array_elements(nodes) n)<>node_count
    OR (SELECT count(DISTINCT m->>'message_id') FROM jsonb_array_elements(messages) m)<>jsonb_array_length(messages)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=graph.graph_payload#>>'{definition,header,startNodeId}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  -- Only authored terms participate. Several matches for one target still count once.
  SELECT count(DISTINCT target) INTO match_count FROM (
    SELECT value AS term,graph.graph_payload#>>'{definition,header,startNodeId}' AS target
      FROM jsonb_array_elements_text(graph.graph_payload#>'{definition,header,entryTerms}')
    UNION ALL SELECT term,edge->>'to' FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') edge
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(edge#>'{action,matchTerms}','[]')) term
  ) terms WHERE length(btrim(term))>0 AND position(content_intake.sop_query_normalize(term) in content_intake.sop_query_normalize(p_query_text))>0;
  IF match_count>1 THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
  matched := match_count=1;
  IF deadline<=clock_timestamp() THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','LEASE_EXPIRED',release_id_value)); END IF;
  IF lease.lease_id IS NULL THEN
    lease := content_intake.issue_sop_query_lease('sopl_'||encode(public.digest(binding_hash||p_request_id::text,'sha256'),'hex'),
      binding_hash,release_id_value,p_request_id,body_hash,p_context_generation,at_time,deadline,actor.revocation_generation);
  END IF;
  IF lease.expires_at>deadline THEN
    RETURN content_intake.sop_query_closed('stale','LEASE_EXPIRED',release_id_value);
  END IF;
  IF prior_result IS NOT NULL THEN RETURN prior_result; END IF;
  RETURN content_intake.complete_sop_query(binding_hash,p_request_id,jsonb_build_object('status',CASE WHEN matched THEN 'ready' ELSE 'no_match' END,'release_id',release_id_value,
    'lease_expires_at',to_char(least(lease.expires_at,deadline) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reasons','[]'::jsonb,'result',CASE WHEN matched THEN jsonb_build_object('entry_node_id',graph.graph_payload#>>'{definition,header,startNodeId}',
      'nodes',nodes,'branches',edges,'messages',messages,'media_refs','[]'::jsonb)
      ELSE jsonb_build_object('nodes','[]'::jsonb,'branches','[]'::jsonb,'messages','[]'::jsonb,'media_refs','[]'::jsonb) END));
END $$;
ALTER FUNCTION content_intake.read_sop_query(text,text,text,text,text,text,text,text,uuid) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_query(text,text,text,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_query(text,text,text,text,text,text,text,text,uuid) TO intake_usage;
