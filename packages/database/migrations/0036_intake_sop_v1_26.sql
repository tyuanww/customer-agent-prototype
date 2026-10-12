-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0036_intake_sop_v1_26; source schema.v1.26 SOP additive successor
-- contract_set_id=cs-ai-c11-openapi-1.23.0-schema-1.26-c08bfcadf94d
-- source_git_sha=c08bfcadf94d274d5b871c6f122848919340c769
-- source_schema_sha256=1c0a4e508ea0aab97d40abff4829ea5a0ce65882ad6a044187fc231872bbe39c
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- BEGIN SOP MEDIA CONTRACT 1d009c6820abaa749759f63ae5c9e190397acc851bd9ce9e7042233117d9e988
-- SOP media is an additive candidate only. The real storage provider, bucket, key and secret are undecided.
CREATE TABLE content_intake.sop_media_objects (
  media_object_id content_intake.identifier PRIMARY KEY,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  sha256 content_intake.sha256 NOT NULL,
  bytes BIGINT NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
  state TEXT NOT NULL DEFAULT 'staged' CHECK (state IN ('staged','adopted','released','discarded')),
  created_at TIMESTAMPTZ NOT NULL CHECK (isfinite(created_at)),
  adopted_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  UNIQUE (source_id,sha256,bytes,mime),
  UNIQUE (media_object_id,source_id,sha256,bytes,mime),
  CHECK ((state='staged' AND adopted_at IS NULL AND discarded_at IS NULL)
    OR (state IN ('adopted','released') AND adopted_at IS NOT NULL AND discarded_at IS NULL)
    OR (state='discarded' AND adopted_at IS NULL AND discarded_at IS NOT NULL)),
  CHECK (adopted_at IS NULL OR adopted_at>=created_at),
  CHECK (discarded_at IS NULL OR discarded_at>=created_at)
);
CREATE TABLE content_intake.sop_candidate_media (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  media_object_id content_intake.identifier NOT NULL,
  sheet_name TEXT NOT NULL CHECK (sheet_name IN ('过敏流程SOP','少错破SOP','品质售后SOP','税收相关规则','品牌对接资源汇总','长痘痘SOP')),
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 1 AND 5000),
  column_number INTEGER NOT NULL CHECK (column_number BETWEEN 1 AND 32),
  row_id TEXT NOT NULL CHECK (row_id = 'sop:' || sheet_name || ':' || row_number::TEXT),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  sha256 content_intake.sha256 NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
  bytes BIGINT NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  PRIMARY KEY (candidate_id,candidate_version,media_object_id,ordinal),
  UNIQUE (candidate_id,candidate_version,source_id,sheet_name,row_number,column_number,ordinal),
  UNIQUE (candidate_id,candidate_version,source_id,media_object_id,sheet_name,row_number,column_number,row_id,ordinal,sha256,mime,bytes),
  FOREIGN KEY (candidate_id,candidate_version,source_id) REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  FOREIGN KEY (media_object_id,source_id,sha256,bytes,mime) REFERENCES content_intake.sop_media_objects(media_object_id,source_id,sha256,bytes,mime)
);
CREATE TABLE content_intake.sop_release_media (
  release_id TEXT NOT NULL REFERENCES public.content_releases,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  media_object_id content_intake.identifier NOT NULL,
  sheet_name TEXT NOT NULL CHECK (sheet_name IN ('过敏流程SOP','少错破SOP','品质售后SOP','税收相关规则','品牌对接资源汇总','长痘痘SOP')),
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 1 AND 5000),
  column_number INTEGER NOT NULL CHECK (column_number BETWEEN 1 AND 32),
  row_id TEXT NOT NULL CHECK (row_id = 'sop:' || sheet_name || ':' || row_number::TEXT),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  sha256 content_intake.sha256 NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
  bytes BIGINT NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  PRIMARY KEY (release_id,media_object_id,ordinal),
  FOREIGN KEY (candidate_id,candidate_version,source_id,media_object_id,sheet_name,row_number,column_number,row_id,ordinal,sha256,mime,bytes)
    REFERENCES content_intake.sop_candidate_media(candidate_id,candidate_version,source_id,media_object_id,sheet_name,row_number,column_number,row_id,ordinal,sha256,mime,bytes)
);
ALTER TABLE content_intake.sop_media_objects OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_candidate_media OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_media OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON TABLE content_intake.sop_media_objects FROM PUBLIC;
REVOKE ALL ON TABLE content_intake.sop_candidate_media FROM PUBLIC;
REVOKE ALL ON TABLE content_intake.sop_release_media FROM PUBLIC;
COMMENT ON TABLE content_intake.sop_media_objects IS 'SOP 图片对象候选；真实对象存储未定，预览不暴露永久 URL；历史永久保留，未使用内容允许人工删除。';
COMMENT ON TABLE content_intake.sop_candidate_media IS 'SOP 图片按工作表、行号和列号绑定；每行必须另有文字答案，同一行可有多图。';
COMMENT ON TABLE content_intake.sop_release_media IS 'SOP 发布单元的不可变图片关系；已发布或正在使用的内容不得删除，不设自动到期。';
