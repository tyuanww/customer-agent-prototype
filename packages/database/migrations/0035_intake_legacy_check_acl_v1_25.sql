-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0035_intake_legacy_check_acl_v1_25; source schema.v1.25 legacy CHECK execution closure
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- DRAFT: immutable v1.24 successor; apply atomically after the approved runtime ACL.
-- These pure INVOKER predicates are evaluated again when publish/rollback copies
-- legacy release_items. Grant only their transitive call closure to the existing
-- NOLOGIN function owner. No LOGIN, membership, table, DDL or function-body change.
GRANT EXECUTE ON FUNCTION
  public.content_template_placeholders_are_valid(text, text[]),
  public.content_text_array_is_nonblank_unique(text[]),
  public.content_questions_align_intent(jsonb, text, text),
  public.content_questions_are_valid(jsonb),
  public.content_question_hash(jsonb),
  public.content_utc_timestamp_text(timestamptz),
  public.content_risk_categories_are_valid(text, text[]),
  public.owner_acceptance_review_shape(text, boolean, text, text, text, text, text, text, text, text)
  TO intake_runtime_fn_owner;
