-- Trusted registered organization service; append-only histories and pointer
-- transitions remain guarded. No bindings/principals/role/grant creation in the
-- identity or content authority domains is granted.
GRANT USAGE ON SCHEMA intake_organization TO intake_org_writer;
GRANT SELECT,INSERT ON intake_organization.bindings,intake_organization.current_bindings,intake_organization.observations TO intake_org_writer;
GRANT UPDATE(binding_version,open_id) ON intake_organization.current_bindings TO intake_org_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA intake_organization TO intake_org_writer;

-- Directory owns only its own state and keys; it does not borrow publication
-- table writes from intake_runtime_fn_owner. Public low-level EXECUTE stays off.
GRANT USAGE ON SCHEMA content_intake,backend_identity,backend_review,public TO intake_directory_fn_owner;
GRANT USAGE ON SCHEMA content_intake TO intake_directory_key_operator;
GRANT SELECT ON backend_identity.sessions,backend_identity.subject_bindings,
  content_intake.principals,content_intake.principal_facts,content_intake.role_rules,
  content_intake.grants,content_intake.scopes,content_intake.sources TO intake_directory_fn_owner;
GRANT UPDATE(token_hash) ON backend_identity.sessions TO intake_directory_fn_owner;
GRANT UPDATE(user_id) ON backend_identity.subject_bindings TO intake_directory_fn_owner;
GRANT UPDATE(principal_id) ON content_intake.principals,content_intake.principal_facts TO intake_directory_fn_owner;
GRANT EXECUTE ON FUNCTION backend_review.lock_content(),public.digest(bytea,text),public.hmac(bytea,bytea,text),
  content_intake.authorization_deadline(text,text,text,text,timestamptz) TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_stewards OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_revisions OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_displays OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_display_current OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_registrars OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_steward_events OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_keys OWNER TO intake_directory_fn_owner;
ALTER TABLE content_intake.shop_directory_key_events OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.valid_shop_display_name(text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_steward_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_display_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_display_current_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_revision_guard() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.upsert_shop_display(text,text,text,text,text,bigint) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.read_shop_directory(text,text,timestamptz,text,integer,text,timestamptz) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_event_immutable() OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_session_context(text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.manage_shop_directory_steward(text,text,bigint,bigint,timestamptz,text,text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.rotate_shop_directory_key(text,text,text,text,timestamptz,bigint,text,text) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.shop_directory_signing_key(content_intake.shop_directory_keys) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.prepare_shop_directory_read(text,text,integer) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.prepare_shop_directory_write(text,text,text,bigint) OWNER TO intake_directory_fn_owner;
ALTER FUNCTION content_intake.finish_shop_directory_transaction(jsonb) OWNER TO intake_directory_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.prepare_shop_directory_read(text,text,integer),content_intake.finish_shop_directory_transaction(jsonb) TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.prepare_shop_directory_write(text,text,text,bigint),content_intake.manage_shop_directory_steward(text,text,bigint,bigint,timestamptz,text,text),content_intake.finish_shop_directory_transaction(jsonb) TO intake_business;
GRANT EXECUTE ON FUNCTION content_intake.rotate_shop_directory_key(text,text,text,text,timestamptz,bigint,text,text) TO intake_directory_key_operator;
-- Core directory consumers can run independently of product-only publication
-- overlays. These minimum grants do not activate the business upload service.
GRANT USAGE ON SCHEMA content_intake,backend_review TO intake_usage,intake_business,intake_org_writer;
GRANT EXECUTE ON FUNCTION backend_review.lock_content() TO intake_usage,intake_business,intake_org_writer;
GRANT SELECT ON content_intake.principals,content_intake.principal_facts TO intake_org_writer;
GRANT INSERT ON content_intake.principal_facts TO intake_org_writer;
GRANT UPDATE(current_facts_version,revocation_generation) ON content_intake.principals TO intake_org_writer;
GRANT EXECUTE ON FUNCTION content_intake.principal_guard() TO intake_org_writer;
