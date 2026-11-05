-- GENERATED FILE. DO NOT EDIT. Source: packages/unified-contracts/src/index.ts
INSERT INTO content_intake.role_ceiling (role, business_actions, may_allocate, may_delegate, may_skip_import_parent) VALUES
  ('agent', ARRAY['query'], false, false, false),
  ('director', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], true, true, true),
  ('enabler', ARRAY['query'], false, false, false),
  ('engineer', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], true, true, true),
  ('lead', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], false, false, false),
  ('manager', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], true, true, true),
  ('supervisor', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], false, false, false)
ON CONFLICT (role) DO UPDATE SET business_actions = EXCLUDED.business_actions, may_allocate = EXCLUDED.may_allocate, may_delegate = EXCLUDED.may_delegate, may_skip_import_parent = EXCLUDED.may_skip_import_parent;
