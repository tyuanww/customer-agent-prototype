-- Product-owned physical access path; no contract, policy or ACL change.
-- Discovery has no fixed action and reuses authorization_deadline per source.
-- source_id must precede action: otherwise each source scans the whole scope.
CREATE INDEX grants_recipient_scope_source
  ON content_intake.grants (recipient_id, scope_id, source_id, action, expires_at)
  WHERE revoked_at IS NULL;
