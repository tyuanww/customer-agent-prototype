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
