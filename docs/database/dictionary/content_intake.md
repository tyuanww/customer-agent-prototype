# schema `content_intake`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（58）

### approval_current

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `review_request_id` | `content_intake.identifier` | 否 |  |  |
| `facts_version` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `approval_current_pkey` | P | PRIMARY KEY (review_request_id) |
| `approval_current_review_request_id_facts_version_fkey` | F | FOREIGN KEY (review_request_id, facts_version) REFERENCES content_intake.approval_facts(review_request_id, facts_version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `approval_current_pkey` | CREATE UNIQUE INDEX approval_current_pkey ON content_intake.approval_current USING btree (review_request_id) |

### approval_facts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `review_request_id` | `content_intake.identifier` | 否 |  |  |
| `facts_version` | `content_intake.version` | 否 |  |  |
| `revocation_generation` | `content_intake.generation` | 否 |  |  |
| `state` | `text` | 否 |  |  |
| `checked_at` | `timestamp with time zone` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 否 |  |  |
| `raw_facts_digest` | `content_intake.sha256` | 否 |  |  |
| `package_verified_sha256` | `content_intake.sha256` | 是 |  |  |
| `human_task_id` | `content_intake.identifier` | 是 |  |  |
| `reviewer_id` | `content_intake.identifier` | 是 |  |  |
| `reviewer_facts_version` | `content_intake.version` | 是 |  |  |
| `decided_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `approval_facts_check` | C | CHECK (((valid_until > checked_at) AND (valid_until <= (checked_at + '00:05:00'::interval)))) |
| `approval_facts_check1` | C | CHECK (((state <> 'approved'::text) OR ((human_task_id IS NOT NULL) AND (reviewer_id IS NOT NULL) AND (reviewer_facts_version IS NOT NULL) AND (decided_at IS NOT NULL) AND (decided_at <= checked_at) AND (package_verified_sha256 IS NOT NULL)))) |
| `approval_facts_checked_at_check` | C | CHECK (isfinite(checked_at)) |
| `approval_facts_pkey` | P | PRIMARY KEY (review_request_id, facts_version) |
| `approval_facts_review_request_id_fkey` | F | FOREIGN KEY (review_request_id) REFERENCES content_intake.review_bindings(review_request_id) |
| `approval_facts_reviewer_id_reviewer_facts_version_fkey` | F | FOREIGN KEY (reviewer_id, reviewer_facts_version) REFERENCES content_intake.principal_facts(principal_id, facts_version) |
| `approval_facts_state_check` | C | CHECK ((state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'revoked'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `approval_facts_pkey` | CREATE UNIQUE INDEX approval_facts_pkey ON content_intake.approval_facts USING btree (review_request_id, facts_version) |

### candidate_versions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `scope_id` | `content_intake.identifier` | 否 |  |  |
| `source_version` | `content_intake.version` | 否 |  |  |
| `object_id` | `content_intake.identifier` | 否 |  |  |
| `file_sha256` | `content_intake.sha256` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `base_release_id` | `text` | 是 |  |  |
| `canonical_encoding` | `text` | 否 |  |  |
| `canonical_material` | `text` | 否 |  |  |
| `material` | `jsonb` | 否 |  |  |
| `digest` | `text` | 是 | `encode(digest(canonical_material, 'sha256'::text), 'hex'::text)` | STORED GENERATED |
| `risk` | `text` | 否 |  |  |
| `explicit_disable_count` | `integer` | 否 |  |  |
| `state` | `text` | 否 | `'awaiting-evidence'::text` |  |
| `source_evidence_version` | `content_intake.generation` | 否 | `0` |  |
| `approval_evidence_version` | `content_intake.generation` | 否 | `0` |  |
| `revocation_generation` | `content_intake.generation` | 否 | `0` |  |
| `created_at` | `timestamp with time zone` | 否 |  |  |
| `updated_at` | `timestamp with time zone` | 否 |  |  |
| `publication_policy` | `text` | 否 | `'approval-v1'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `candidate_publication_readiness` | C | CHECK ((((publication_policy <> 'direct-v1'::text) OR ((approval_evidence_version)::bigint = 0)) AND ((state <> ALL (ARRAY['ready'::text, 'publishing'::text, 'published'::text])) OR (((source_evidence_version)::bigint > 0) AND ((publication_policy = 'direct-v1'::text) OR ((approval_evidence_version)::bigint > 0)))))) |
| `candidate_versions_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `candidate_versions_base_release_id_fkey` | F | FOREIGN KEY (base_release_id) REFERENCES content_releases(release_id) |
| `candidate_versions_candidate_id_version_digest_key` | U | UNIQUE (candidate_id, version, digest) |
| `candidate_versions_candidate_id_version_file_sha256_key` | U | UNIQUE (candidate_id, version, file_sha256) |
| `candidate_versions_candidate_id_version_object_id_key` | U | UNIQUE (candidate_id, version, object_id) |
| `candidate_versions_candidate_id_version_publication_policy_key` | U | UNIQUE (candidate_id, version, publication_policy) |
| `candidate_versions_candidate_id_version_source_id_key` | U | UNIQUE (candidate_id, version, source_id) |
| `candidate_versions_canonical_encoding_check` | C | CHECK ((canonical_encoding = 'candidate-p1.1'::text)) |
| `candidate_versions_canonical_material_check` | C | CHECK (((octet_length(canonical_material) >= 2) AND (octet_length(canonical_material) <= 52428800))) |
| `candidate_versions_check` | C | CHECK (((canonical_material)::jsonb = material)) |
| `candidate_versions_check1` | C | CHECK ((NOT ((material ->> 'canonicalEncodingVersion'::text) IS DISTINCT FROM canonical_encoding))) |
| `candidate_versions_check11` | C | CHECK ((updated_at >= created_at)) |
| `candidate_versions_check2` | C | CHECK ((NOT ((material #>> '{scope,sourceId}'::text[]) IS DISTINCT FROM (source_id)::text))) |
| `candidate_versions_check3` | C | CHECK ((NOT ((material #>> '{object,objectId}'::text[]) IS DISTINCT FROM (object_id)::text))) |
| `candidate_versions_check4` | C | CHECK ((NOT ((material #>> '{object,sha256}'::text[]) IS DISTINCT FROM (file_sha256)::text))) |
| `candidate_versions_check5` | C | CHECK ((NOT ((material #>> '{sourceClaim,fileSha256}'::text[]) IS DISTINCT FROM (file_sha256)::text))) |
| `candidate_versions_check6` | C | CHECK ((NOT ((material ->> 'baseReleaseId'::text) IS DISTINCT FROM base_release_id))) |
| `candidate_versions_check7` | C | CHECK ((NOT ((material #>> '{risk,level}'::text[]) IS DISTINCT FROM risk))) |
| `candidate_versions_check8` | C | CHECK ((NOT ((material #>> '{risk,explicitDisableCount}'::text[]) IS DISTINCT FROM (explicit_disable_count)::text))) |
| `candidate_versions_check9` | C | CHECK (((explicit_disable_count < 2) OR (risk = 'critical'::text))) |
| `candidate_versions_explicit_disable_count_check` | C | CHECK (((explicit_disable_count >= 0) AND (explicit_disable_count <= 5000))) |
| `candidate_versions_material_check` | C | CHECK ((jsonb_typeof(material) = 'object'::text)) |
| `candidate_versions_material_check1` | C | CHECK ((NOT (jsonb_typeof((material -> 'contributors'::text)) IS DISTINCT FROM 'array'::text))) |
| `candidate_versions_material_check2` | C | CHECK (((jsonb_array_length((material -> 'contributors'::text)) >= 1) AND (jsonb_array_length((material -> 'contributors'::text)) <= 100))) |
| `candidate_versions_object_id_source_id_file_sha256_fkey` | F | FOREIGN KEY (object_id, source_id, file_sha256) REFERENCES content_intake.objects(object_id, source_id, sha256) |
| `candidate_versions_pkey` | P | PRIMARY KEY (candidate_id, version) |
| `candidate_versions_publication_policy_check` | C | CHECK ((publication_policy = ANY (ARRAY['approval-v1'::text, 'direct-v1'::text]))) |
| `candidate_versions_risk_check` | C | CHECK ((risk = ANY (ARRAY['routine'::text, 'critical'::text]))) |
| `candidate_versions_source_id_scope_id_fkey` | F | FOREIGN KEY (source_id, scope_id) REFERENCES content_intake.sources(source_id, scope_id) |
| `candidate_versions_source_id_source_version_fkey` | F | FOREIGN KEY (source_id, source_version) REFERENCES content_intake.source_mappings(source_id, version) |
| `candidate_versions_state_check` | C | CHECK ((state = ANY (ARRAY['awaiting-evidence'::text, 'ready'::text, 'publishing'::text, 'published'::text, 'cancelled'::text, 'invalidated'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `candidate_actor_open` | CREATE INDEX candidate_actor_open ON content_intake.candidate_versions USING btree (actor_id) WHERE (state = ANY (ARRAY['awaiting-evidence'::text, 'ready'::text, 'publishing'::text])) |
| `candidate_one_open_version` | CREATE UNIQUE INDEX candidate_one_open_version ON content_intake.candidate_versions USING btree (candidate_id) WHERE (state = ANY (ARRAY['awaiting-evidence'::text, 'ready'::text, 'publishing'::text])) |
| `candidate_scope_state_updated` | CREATE INDEX candidate_scope_state_updated ON content_intake.candidate_versions USING btree (scope_id, state, updated_at DESC, candidate_id, version) |
| `candidate_source_state_updated` | CREATE INDEX candidate_source_state_updated ON content_intake.candidate_versions USING btree (source_id, state, updated_at DESC, candidate_id, version) |
| `candidate_versions_candidate_id_version_digest_key` | CREATE UNIQUE INDEX candidate_versions_candidate_id_version_digest_key ON content_intake.candidate_versions USING btree (candidate_id, version, digest) |
| `candidate_versions_candidate_id_version_file_sha256_key` | CREATE UNIQUE INDEX candidate_versions_candidate_id_version_file_sha256_key ON content_intake.candidate_versions USING btree (candidate_id, version, file_sha256) |
| `candidate_versions_candidate_id_version_object_id_key` | CREATE UNIQUE INDEX candidate_versions_candidate_id_version_object_id_key ON content_intake.candidate_versions USING btree (candidate_id, version, object_id) |
| `candidate_versions_candidate_id_version_publication_policy_key` | CREATE UNIQUE INDEX candidate_versions_candidate_id_version_publication_policy_key ON content_intake.candidate_versions USING btree (candidate_id, version, publication_policy) |
| `candidate_versions_candidate_id_version_source_id_key` | CREATE UNIQUE INDEX candidate_versions_candidate_id_version_source_id_key ON content_intake.candidate_versions USING btree (candidate_id, version, source_id) |
| `candidate_versions_pkey` | CREATE UNIQUE INDEX candidate_versions_pkey ON content_intake.candidate_versions USING btree (candidate_id, version) |

### candidate_vocabulary

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `vocabulary_id` | `content_intake.identifier` | 否 |  |  |
| `display_version` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `candidate_vocabulary_candidate_id_candidate_version_fkey` | F | FOREIGN KEY (candidate_id, candidate_version) REFERENCES content_intake.candidate_versions(candidate_id, version) |
| `candidate_vocabulary_pkey` | P | PRIMARY KEY (candidate_id, candidate_version, vocabulary_id) |
| `candidate_vocabulary_vocabulary_id_display_version_fkey` | F | FOREIGN KEY (vocabulary_id, display_version) REFERENCES content_intake.vocabulary_displays(vocabulary_id, display_version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `candidate_vocabulary_pkey` | CREATE UNIQUE INDEX candidate_vocabulary_pkey ON content_intake.candidate_vocabulary USING btree (candidate_id, candidate_version, vocabulary_id) |

### commit_ticket_sources

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `ticket_hash` | `content_intake.sha256` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `source_generation` | `content_intake.generation` | 否 |  |  |
| `mode_version` | `content_intake.version` | 否 |  |  |
| `source_evidence_generation` | `content_intake.generation` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `commit_ticket_sources_pkey` | P | PRIMARY KEY (ticket_hash, source_id) |
| `commit_ticket_sources_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |
| `commit_ticket_sources_ticket_hash_fkey` | F | FOREIGN KEY (ticket_hash) REFERENCES content_intake.commit_tickets(ticket_hash) |

索引：

| 名称 | 定义 |
| --- | --- |
| `commit_ticket_sources_pkey` | CREATE UNIQUE INDEX commit_ticket_sources_pkey ON content_intake.commit_ticket_sources USING btree (ticket_hash, source_id) |

### commit_tickets

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `ticket_hash` | `content_intake.sha256` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `action` | `text` | 否 |  |  |
| `operation_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_generation` | `content_intake.generation` | 是 |  |  |
| `actor_facts_version` | `content_intake.version` | 否 |  |  |
| `actor_generation` | `content_intake.generation` | 否 |  |  |
| `reviewer_facts_version` | `content_intake.version` | 是 |  |  |
| `reviewer_generation` | `content_intake.generation` | 是 |  |  |
| `approval_facts_version` | `content_intake.version` | 是 |  |  |
| `approval_generation` | `content_intake.generation` | 是 |  |  |
| `issued_at` | `timestamp with time zone` | 否 |  |  |
| `expires_at` | `timestamp with time zone` | 否 |  |  |
| `consumed_at` | `timestamp with time zone` | 是 |  |  |
| `publication_policy` | `text` | 否 | `'approval-v1'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `commit_tickets_action_check` | C | CHECK ((action = ANY (ARRAY['publish'::text, 'rollback'::text]))) |
| `commit_tickets_actor_id_action_operation_id_fkey` | F | FOREIGN KEY (actor_id, action, operation_id) REFERENCES content_intake.write_attempts(actor_id, action, operation_id) |
| `commit_tickets_actor_id_action_operation_id_publication_po_fkey` | F | FOREIGN KEY (actor_id, action, operation_id, publication_policy) REFERENCES content_intake.write_attempts(actor_id, action, operation_id, publication_policy) |
| `commit_tickets_check` | C | CHECK (((action = 'publish'::text) = (candidate_generation IS NOT NULL))) |
| `commit_tickets_check1` | C | CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '00:01:00'::interval)))) |
| `commit_tickets_check2` | C | CHECK (((consumed_at IS NULL) OR ((consumed_at >= issued_at) AND (consumed_at < expires_at)))) |
| `commit_tickets_issued_at_check` | C | CHECK (isfinite(issued_at)) |
| `commit_tickets_pkey` | P | PRIMARY KEY (ticket_hash) |
| `commit_tickets_publication_policy_check` | C | CHECK ((publication_policy = ANY (ARRAY['approval-v1'::text, 'direct-v1'::text]))) |
| `ticket_publication_evidence` | C | CHECK ((((publication_policy = 'approval-v1'::text) AND (reviewer_facts_version IS NOT NULL) AND (reviewer_generation IS NOT NULL) AND (approval_facts_version IS NOT NULL) AND (approval_generation IS NOT NULL)) OR ((publication_policy = 'direct-v1'::text) AND (reviewer_facts_version IS NULL) AND (reviewer_generation IS NULL) AND (approval_facts_version IS NULL) AND (approval_generation IS NULL)))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `commit_tickets_pkey` | CREATE UNIQUE INDEX commit_tickets_pkey ON content_intake.commit_tickets USING btree (ticket_hash) |

### contributors

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 是 |  |  |
| `candidate_version` | `content_intake.version` | 是 |  |  |
| `principal_id` | `content_intake.identifier` | 是 |  |  |

### entitlement_contexts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `entitlement_hash` | `content_intake.sha256` | 否 |  |  |
| `session_token_hash` | `content_intake.sha256` | 否 |  |  |
| `product_ids` | `text[]` | 否 |  |  |
| `scenario_ids` | `text[]` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `entitlement_contexts_entitlement_hash_fkey` | F | FOREIGN KEY (entitlement_hash) REFERENCES content_intake.entitlements(entitlement_hash) NOT VALID |
| `entitlement_contexts_pkey` | P | PRIMARY KEY (entitlement_hash) |
| `entitlement_contexts_product_ids_check` | C | CHECK (content_intake.selection_ids_valid(product_ids)) |
| `entitlement_contexts_scenario_ids_check` | C | CHECK (content_intake.selection_ids_valid(scenario_ids)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `entitlement_contexts_pkey` | CREATE UNIQUE INDEX entitlement_contexts_pkey ON content_intake.entitlement_contexts USING btree (entitlement_hash) |

### entitlement_scopes

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `entitlement_hash` | `content_intake.sha256` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `entitlement_scopes_entitlement_hash_fkey` | F | FOREIGN KEY (entitlement_hash) REFERENCES content_intake.entitlements(entitlement_hash) NOT VALID |
| `entitlement_scopes_pkey` | P | PRIMARY KEY (entitlement_hash, source_id) |
| `entitlement_scopes_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `entitlement_scopes_pkey` | CREATE UNIQUE INDEX entitlement_scopes_pkey ON content_intake.entitlement_scopes USING btree (entitlement_hash, source_id) |

### entitlements

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `entitlement_hash` | `content_intake.sha256` | 否 |  |  |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `lease_token_hash` | `text` | 否 |  |  |
| `release_id` | `text` | 否 |  |  |
| `shop_id` | `content_intake.identifier` | 否 |  |  |
| `context_generation` | `content_intake.version` | 否 |  |  |
| `principal_generation` | `content_intake.generation` | 否 |  |  |
| `release_generation` | `content_intake.generation` | 否 |  |  |
| `issued_at` | `timestamp with time zone` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `entitlement_context_required` | t | TRIGGER DEFERRABLE INITIALLY DEFERRED |
| `entitlements_check` | C | CHECK (((valid_until > issued_at) AND (valid_until <= (issued_at + '00:05:00'::interval)))) |
| `entitlements_issued_at_check` | C | CHECK (isfinite(issued_at)) |
| `entitlements_lease_token_hash_fkey` | F | FOREIGN KEY (lease_token_hash) REFERENCES snapshot_offline_leases(lease_token_hash) |
| `entitlements_lease_token_hash_key` | U | UNIQUE (lease_token_hash) |
| `entitlements_lease_token_hash_user_id_release_id_fkey` | F | FOREIGN KEY (lease_token_hash, user_id, release_id) REFERENCES snapshot_offline_leases(lease_token_hash, user_id, release_id) |
| `entitlements_pkey` | P | PRIMARY KEY (entitlement_hash) |
| `entitlements_principal_id_user_id_fkey` | F | FOREIGN KEY (principal_id, user_id) REFERENCES content_intake.principals(principal_id, user_id) |
| `entitlements_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_intake.release_catalogs(release_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `entitlements_lease_token_hash_key` | CREATE UNIQUE INDEX entitlements_lease_token_hash_key ON content_intake.entitlements USING btree (lease_token_hash) |
| `entitlements_pkey` | CREATE UNIQUE INDEX entitlements_pkey ON content_intake.entitlements USING btree (entitlement_hash) |

### grant_history

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `grant_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 |  |  |
| `record` | `jsonb` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `grant_history_grant_id_fkey` | F | FOREIGN KEY (grant_id) REFERENCES content_intake.grants(grant_id) NOT VALID |
| `grant_history_pkey` | P | PRIMARY KEY (grant_id, version) |
| `grant_history_record_check` | C | CHECK ((jsonb_typeof(record) = 'object'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `grant_history_pkey` | CREATE UNIQUE INDEX grant_history_pkey ON content_intake.grant_history USING btree (grant_id, version) |

### grants

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `grant_id` | `content_intake.identifier` | 否 |  |  |
| `kind` | `text` | 否 |  |  |
| `issuer_id` | `content_intake.identifier` | 否 |  |  |
| `recipient_id` | `content_intake.identifier` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `scope_id` | `content_intake.identifier` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 是 |  |  |
| `action` | `text` | 否 |  |  |
| `starts_at` | `timestamp with time zone` | 否 |  |  |
| `expires_at` | `timestamp with time zone` | 否 |  |  |
| `revoked_at` | `timestamp with time zone` | 是 |  |  |
| `steward_id` | `content_intake.identifier` | 是 |  |  |
| `version` | `content_intake.version` | 否 | `1` |  |
| `reason` | `text` | 否 |  |  |
| `last_change_reason` | `text` | 是 |  |  |
| `parent_grant_id` | `content_intake.identifier` | 是 |  |  |
| `may_redelegate` | `boolean` | 否 | `false` |  |
| `policy_version` | `content_intake.version` | 是 |  |  |
| `store_set_version` | `content_intake.version` | 是 |  |  |
| `roster_job_id` | `content_intake.identifier` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `grants_action_check` | C | CHECK ((action = ANY (ARRAY['query'::text, 'content-manage'::text, 'import'::text, 'source-confirm'::text, 'review'::text, 'publish'::text, 'candidate-cancel'::text, 'rollback'::text]))) |
| `grants_check` | C | CHECK ((isfinite(expires_at) AND (expires_at > starts_at))) |
| `grants_check1` | C | CHECK (((((version)::bigint = 1) AND (last_change_reason IS NULL)) OR (((version)::bigint > 1) AND (last_change_reason IS NOT NULL)))) |
| `grants_check2` | C | CHECK (((kind = 'allocation'::text) OR ((issuer_id)::text <> (recipient_id)::text))) |
| `grants_issuer_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (issuer_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |
| `grants_kind_check` | C | CHECK ((kind = ANY (ARRAY['business'::text, 'allocation'::text, 'delegation'::text]))) |
| `grants_last_change_reason_check` | C | CHECK (((last_change_reason IS NULL) OR ((length(btrim(last_change_reason)) >= 1) AND (length(btrim(last_change_reason)) <= 512)))) |
| `grants_may_redelegate_check` | C | CHECK ((may_redelegate = false)) |
| `grants_parent_grant_id_fkey` | F | FOREIGN KEY (parent_grant_id) REFERENCES content_intake.grants(grant_id) |
| `grants_pkey` | P | PRIMARY KEY (grant_id) |
| `grants_reason_check` | C | CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 512))) |
| `grants_recipient_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (recipient_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |
| `grants_scope_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (scope_id, tenant_id, app_id) REFERENCES content_intake.scopes(scope_id, tenant_id, app_id) |
| `grants_source_id_scope_id_fkey` | F | FOREIGN KEY (source_id, scope_id) REFERENCES content_intake.sources(source_id, scope_id) |
| `grants_starts_at_check` | C | CHECK (isfinite(starts_at)) |
| `grants_steward_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (steward_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `grants_parent` | CREATE INDEX grants_parent ON content_intake.grants USING btree (parent_grant_id) |
| `grants_pkey` | CREATE UNIQUE INDEX grants_pkey ON content_intake.grants USING btree (grant_id) |
| `grants_recipient_scope` | CREATE INDEX grants_recipient_scope ON content_intake.grants USING btree (recipient_id, scope_id, action, expires_at) WHERE (revoked_at IS NULL) |
| `grants_recipient_scope_source` | CREATE INDEX grants_recipient_scope_source ON content_intake.grants USING btree (recipient_id, scope_id, source_id, action, expires_at) WHERE (revoked_at IS NULL) |

### object_reservations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `object_id` | `text` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 是 |  |  |
| `purpose` | `text` | 否 |  |  |
| `reserved_bytes` | `bigint` | 否 |  |  |
| `actual_bytes` | `bigint` | 是 |  |  |
| `sha256` | `text` | 是 |  |  |
| `state` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `object_reservations_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `object_reservations_check` | C | CHECK (((actual_bytes >= 1) AND (actual_bytes <= reserved_bytes))) |
| `object_reservations_check1` | C | CHECK (((state <> ALL (ARRAY['persisted'::text, 'adopted'::text])) OR ((actual_bytes IS NOT NULL) AND (sha256 IS NOT NULL)))) |
| `object_reservations_object_id_check` | C | CHECK ((object_id ~ '^obj_[0-9a-f]{64}$'::text)) |
| `object_reservations_pkey` | P | PRIMARY KEY (object_id) |
| `object_reservations_purpose_check` | C | CHECK ((purpose = ANY (ARRAY['input'::text, 'report'::text, 'review-package'::text, 'sop-media'::text]))) |
| `object_reservations_reserved_bytes_check` | C | CHECK (((reserved_bytes >= 1) AND (reserved_bytes <= 1073741824))) |
| `object_reservations_sha256_check` | C | CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `object_reservations_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |
| `object_reservations_state_check` | C | CHECK ((state = ANY (ARRAY['reserved'::text, 'persisted'::text, 'adopted'::text, 'releasing'::text, 'released'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `object_reservations_capacity` | CREATE INDEX object_reservations_capacity ON content_intake.object_reservations USING btree (tenant_id) INCLUDE (reserved_bytes) WHERE (state = ANY (ARRAY['reserved'::text, 'persisted'::text, 'releasing'::text])) |
| `object_reservations_pkey` | CREATE UNIQUE INDEX object_reservations_pkey ON content_intake.object_reservations USING btree (object_id) |

### objects

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `object_id` | `content_intake.identifier` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 是 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `object_key` | `text` | 否 |  |  |
| `sha256` | `content_intake.sha256` | 否 |  |  |
| `bytes` | `bigint` | 否 |  |  |
| `mime` | `text` | 否 |  |  |
| `purpose` | `text` | 否 |  |  |
| `received_at` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `objects_actor_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (actor_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |
| `objects_bytes_check` | C | CHECK (((bytes >= 1) AND (bytes <= 52428800))) |
| `objects_check` | C | CHECK (((source_id IS NOT NULL) OR (purpose = 'review-package'::text))) |
| `objects_input_format_check` | C | CHECK ((((purpose = 'input'::text) AND (bytes <= 10485760) AND (mime = ANY (ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'text/csv'::text]))) OR ((purpose = ANY (ARRAY['report'::text, 'review-package'::text])) AND (mime = ANY (ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/pdf'::text, 'application/json'::text]))) OR ((purpose = 'sop-media'::text) AND (bytes <= 5242880) AND (mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text]))))) |
| `objects_mime_check` | C | CHECK ((mime = ANY (ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'text/csv'::text, 'application/pdf'::text, 'application/json'::text, 'image/png'::text, 'image/jpeg'::text, 'image/gif'::text]))) |
| `objects_object_id_sha256_key` | U | UNIQUE (object_id, sha256) |
| `objects_object_id_source_id_key` | U | UNIQUE (object_id, source_id) |
| `objects_object_id_source_id_sha256_key` | U | UNIQUE (object_id, source_id, sha256) |
| `objects_object_key_check` | C | CHECK (((object_key ~ '^intake/[A-Za-z0-9._/-]{1,200}$'::text) AND (object_key !~~ '%..%'::text))) |
| `objects_object_key_key` | U | UNIQUE (object_key) |
| `objects_pkey` | P | PRIMARY KEY (object_id) |
| `objects_purpose_check` | C | CHECK ((purpose = ANY (ARRAY['input'::text, 'report'::text, 'review-package'::text, 'sop-media'::text]))) |
| `objects_sop_payload_identity` | U | UNIQUE (object_id, source_id, sha256, bytes, mime, purpose) |
| `objects_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `objects_capacity` | CREATE INDEX objects_capacity ON content_intake.objects USING btree (tenant_id) INCLUDE (bytes) |
| `objects_object_id_sha256_key` | CREATE UNIQUE INDEX objects_object_id_sha256_key ON content_intake.objects USING btree (object_id, sha256) |
| `objects_object_id_source_id_key` | CREATE UNIQUE INDEX objects_object_id_source_id_key ON content_intake.objects USING btree (object_id, source_id) |
| `objects_object_id_source_id_sha256_key` | CREATE UNIQUE INDEX objects_object_id_source_id_sha256_key ON content_intake.objects USING btree (object_id, source_id, sha256) |
| `objects_object_key_key` | CREATE UNIQUE INDEX objects_object_key_key ON content_intake.objects USING btree (object_key) |
| `objects_pkey` | CREATE UNIQUE INDEX objects_pkey ON content_intake.objects USING btree (object_id) |
| `objects_sop_payload_identity` | CREATE UNIQUE INDEX objects_sop_payload_identity ON content_intake.objects USING btree (object_id, source_id, sha256, bytes, mime, purpose) |

### parse_jobs

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `job_id` | `content_intake.identifier` | 否 |  |  |
| `source_version` | `content_intake.version` | 否 |  |  |
| `contributor_ids` | `content_intake.identifier[]` | 否 |  |  |
| `generation` | `content_intake.version` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `object_id` | `content_intake.identifier` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `state` | `text` | 否 |  |  |
| `base_release_id` | `text` | 是 |  |  |
| `report_object_id` | `content_intake.identifier` | 是 |  |  |
| `started_at` | `timestamp with time zone` | 否 |  |  |
| `finished_at` | `timestamp with time zone` | 是 |  |  |
| `expected_prior_id` | `content_intake.identifier` | 是 |  |  |
| `expected_prior_version` | `content_intake.version` | 是 |  |  |
| `expected_prior_digest` | `content_intake.sha256` | 是 |  |  |
| `result_candidate_id` | `content_intake.identifier` | 是 |  |  |
| `result_candidate_version` | `content_intake.version` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `parse_jobs_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `parse_jobs_base_release_id_fkey` | F | FOREIGN KEY (base_release_id) REFERENCES content_releases(release_id) |
| `parse_jobs_check` | C | CHECK ((((expected_prior_id IS NULL) AND (expected_prior_version IS NULL) AND (expected_prior_digest IS NULL)) OR ((expected_prior_id IS NOT NULL) AND (expected_prior_version IS NOT NULL) AND (expected_prior_digest IS NOT NULL)))) |
| `parse_jobs_check1` | C | CHECK (((result_candidate_id IS NULL) = (result_candidate_version IS NULL))) |
| `parse_jobs_check2` | C | CHECK (((state = 'validated'::text) = (result_candidate_id IS NOT NULL))) |
| `parse_jobs_check3` | C | CHECK (((state = ANY (ARRAY['validated'::text, 'failed'::text, 'cancelled'::text])) = (finished_at IS NOT NULL))) |
| `parse_jobs_contributor_ids_check` | C | CHECK ((((cardinality(contributor_ids) >= 1) AND (cardinality(contributor_ids) <= 100)) AND (array_position(contributor_ids, (NULL::text)::content_intake.identifier) IS NULL))) |
| `parse_jobs_expected_prior_id_expected_prior_version_expect_fkey` | F | FOREIGN KEY (expected_prior_id, expected_prior_version, expected_prior_digest) REFERENCES content_intake.candidate_versions(candidate_id, version, digest) |
| `parse_jobs_expected_prior_id_expected_prior_version_source_fkey` | F | FOREIGN KEY (expected_prior_id, expected_prior_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) |
| `parse_jobs_object_id_fkey` | F | FOREIGN KEY (object_id) REFERENCES content_intake.objects(object_id) |
| `parse_jobs_object_id_source_id_fkey` | F | FOREIGN KEY (object_id, source_id) REFERENCES content_intake.objects(object_id, source_id) |
| `parse_jobs_pkey` | P | PRIMARY KEY (job_id) |
| `parse_jobs_report_object_id_fkey` | F | FOREIGN KEY (report_object_id) REFERENCES content_intake.objects(object_id) |
| `parse_jobs_report_object_id_source_id_fkey` | F | FOREIGN KEY (report_object_id, source_id) REFERENCES content_intake.objects(object_id, source_id) |
| `parse_jobs_result_candidate_id_result_candidate_version_ob_fkey` | F | FOREIGN KEY (result_candidate_id, result_candidate_version, object_id) REFERENCES content_intake.candidate_versions(candidate_id, version, object_id) |
| `parse_jobs_result_candidate_id_result_candidate_version_so_fkey` | F | FOREIGN KEY (result_candidate_id, result_candidate_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) |
| `parse_jobs_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |
| `parse_jobs_source_id_source_version_fkey` | F | FOREIGN KEY (source_id, source_version) REFERENCES content_intake.source_mappings(source_id, version) |
| `parse_jobs_state_check` | C | CHECK ((state = ANY (ARRAY['reading'::text, 'parsing'::text, 'validated'::text, 'failed'::text, 'cancelled'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `parse_jobs_pkey` | CREATE UNIQUE INDEX parse_jobs_pkey ON content_intake.parse_jobs USING btree (job_id) |

### policy_versions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `policy_versions_pkey` | P | PRIMARY KEY (tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `policy_versions_pkey` | CREATE UNIQUE INDEX policy_versions_pkey ON content_intake.policy_versions USING btree (tenant_id, app_id) |

### principal_facts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `facts_version` | `content_intake.version` | 否 |  |  |
| `department_ids` | `text[]` | 否 |  |  |
| `job_id` | `content_intake.identifier` | 否 |  |  |
| `enabled` | `boolean` | 否 |  |  |
| `checked_at` | `timestamp with time zone` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 否 |  |  |
| `facts_digest` | `content_intake.sha256` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `organization_fact_evidence` | t | TRIGGER DEFERRABLE INITIALLY DEFERRED |
| `principal_facts_check` | C | CHECK (((valid_until > checked_at) AND (valid_until <= (checked_at + '24:00:00'::interval)))) |
| `principal_facts_checked_at_check` | C | CHECK (isfinite(checked_at)) |
| `principal_facts_department_ids_check` | C | CHECK ((((cardinality(department_ids) >= 1) AND (cardinality(department_ids) <= 100)) AND (array_position(department_ids, NULL::text) IS NULL))) |
| `principal_facts_pkey` | P | PRIMARY KEY (principal_id, facts_version) |
| `principal_facts_principal_id_fkey` | F | FOREIGN KEY (principal_id) REFERENCES content_intake.principals(principal_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `principal_facts_pkey` | CREATE UNIQUE INDEX principal_facts_pkey ON content_intake.principal_facts USING btree (principal_id, facts_version) |

### principals

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `identity_scope` | `content_intake.identifier` | 否 |  |  |
| `person_key` | `content_intake.identifier` | 否 |  |  |
| `current_facts_version` | `content_intake.version` | 否 |  |  |
| `revocation_generation` | `content_intake.generation` | 否 | `0` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `principal_current_facts_fk` | F | FOREIGN KEY (principal_id, current_facts_version) REFERENCES content_intake.principal_facts(principal_id, facts_version) DEFERRABLE INITIALLY DEFERRED |
| `principals_pkey` | P | PRIMARY KEY (principal_id) |
| `principals_principal_id_tenant_id_app_id_key` | U | UNIQUE (principal_id, tenant_id, app_id) |
| `principals_principal_id_user_id_key` | U | UNIQUE (principal_id, user_id) |
| `principals_tenant_id_app_id_identity_scope_person_key_key` | U | UNIQUE (tenant_id, app_id, identity_scope, person_key) |
| `principals_user_id_fkey` | F | FOREIGN KEY (user_id) REFERENCES backend_identity.subject_bindings(user_id) |
| `principals_user_id_key` | U | UNIQUE (user_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `principals_pkey` | CREATE UNIQUE INDEX principals_pkey ON content_intake.principals USING btree (principal_id) |
| `principals_principal_id_tenant_id_app_id_key` | CREATE UNIQUE INDEX principals_principal_id_tenant_id_app_id_key ON content_intake.principals USING btree (principal_id, tenant_id, app_id) |
| `principals_principal_id_user_id_key` | CREATE UNIQUE INDEX principals_principal_id_user_id_key ON content_intake.principals USING btree (principal_id, user_id) |
| `principals_tenant_id_app_id_identity_scope_person_key_key` | CREATE UNIQUE INDEX principals_tenant_id_app_id_identity_scope_person_key_key ON content_intake.principals USING btree (tenant_id, app_id, identity_scope, person_key) |
| `principals_user_id_key` | CREATE UNIQUE INDEX principals_user_id_key ON content_intake.principals USING btree (user_id) |

### publications

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 是 |  |  |
| `candidate_version` | `content_intake.version` | 是 |  |  |
| `rollback_plan_id` | `content_intake.identifier` | 是 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `action` | `text` | 否 |  |  |
| `operation_id` | `content_intake.identifier` | 否 |  |  |
| `release_id` | `text` | 否 |  |  |
| `announcement_id` | `text` | 否 |  |  |
| `publication_policy` | `text` | 否 | `'approval-v1'::text` |  |
| `confirmed_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `publication_confirmation` | C | CHECK ((((publication_policy = 'approval-v1'::text) AND (confirmed_at IS NULL)) OR ((publication_policy = 'direct-v1'::text) AND (confirmed_at IS NOT NULL) AND isfinite(confirmed_at)))) |
| `publications_action_check` | C | CHECK ((action = ANY (ARRAY['publish'::text, 'rollback'::text]))) |
| `publications_actor_id_action_operation_id_candidate_id_can_fkey` | F | FOREIGN KEY (actor_id, action, operation_id, candidate_id, candidate_version) REFERENCES content_intake.write_attempts(actor_id, action, operation_id, candidate_id, candidate_version) NOT VALID |
| `publications_actor_id_action_operation_id_key` | U | UNIQUE (actor_id, action, operation_id) |
| `publications_actor_id_action_operation_id_publication_poli_fkey` | F | FOREIGN KEY (actor_id, action, operation_id, publication_policy) REFERENCES content_intake.write_attempts(actor_id, action, operation_id, publication_policy) NOT VALID |
| `publications_actor_id_action_operation_id_rollback_plan_id_fkey` | F | FOREIGN KEY (actor_id, action, operation_id, rollback_plan_id) REFERENCES content_intake.write_attempts(actor_id, action, operation_id, rollback_plan_id) |
| `publications_announcement_id_fkey` | F | FOREIGN KEY (announcement_id) REFERENCES announcements(announcement_id) |
| `publications_announcement_id_key` | U | UNIQUE (announcement_id) |
| `publications_announcement_id_release_id_fkey` | F | FOREIGN KEY (announcement_id, release_id) REFERENCES announcements(announcement_id, release_id) |
| `publications_candidate_id_candidate_version_fkey` | F | FOREIGN KEY (candidate_id, candidate_version) REFERENCES content_intake.candidate_versions(candidate_id, version) NOT VALID |
| `publications_candidate_id_candidate_version_key` | U | UNIQUE (candidate_id, candidate_version) |
| `publications_candidate_id_candidate_version_publication_po_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, publication_policy) REFERENCES content_intake.candidate_versions(candidate_id, version, publication_policy) NOT VALID |
| `publications_check` | C | CHECK ((((action = 'publish'::text) AND (candidate_id IS NOT NULL) AND (candidate_version IS NOT NULL) AND (rollback_plan_id IS NULL)) OR ((action = 'rollback'::text) AND (candidate_id IS NULL) AND (candidate_version IS NULL) AND (rollback_plan_id IS NOT NULL)))) |
| `publications_pkey` | P | PRIMARY KEY (release_id) |
| `publications_publication_policy_check` | C | CHECK ((publication_policy = ANY (ARRAY['approval-v1'::text, 'direct-v1'::text]))) |
| `publications_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |
| `publications_rollback_plan_id_key` | U | UNIQUE (rollback_plan_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `publications_actor_id_action_operation_id_key` | CREATE UNIQUE INDEX publications_actor_id_action_operation_id_key ON content_intake.publications USING btree (actor_id, action, operation_id) |
| `publications_announcement_id_key` | CREATE UNIQUE INDEX publications_announcement_id_key ON content_intake.publications USING btree (announcement_id) |
| `publications_candidate_id_candidate_version_key` | CREATE UNIQUE INDEX publications_candidate_id_candidate_version_key ON content_intake.publications USING btree (candidate_id, candidate_version) |
| `publications_pkey` | CREATE UNIQUE INDEX publications_pkey ON content_intake.publications USING btree (release_id) |
| `publications_rollback_plan_id_key` | CREATE UNIQUE INDEX publications_rollback_plan_id_key ON content_intake.publications USING btree (rollback_plan_id) |

### quality_plans

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `candidate_digest` | `content_intake.sha256` | 否 |  |  |
| `policy_version` | `text` | 否 |  |  |
| `plan` | `jsonb` | 否 |  |  |
| `frozen_by` | `content_intake.identifier` | 否 |  |  |
| `facts_version` | `content_intake.version` | 否 |  |  |
| `frozen_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `quality_plans_candidate_id_candidate_version_candidate_dig_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id, version, digest) NOT VALID |
| `quality_plans_candidate_id_candidate_version_candidate_dige_key` | U | UNIQUE (candidate_id, candidate_version, candidate_digest) |
| `quality_plans_frozen_by_facts_version_fkey` | F | FOREIGN KEY (frozen_by, facts_version) REFERENCES content_intake.principal_facts(principal_id, facts_version) NOT VALID |
| `quality_plans_pkey` | P | PRIMARY KEY (candidate_id, candidate_version) |
| `quality_plans_plan_check` | C | CHECK (((jsonb_typeof(plan) = 'object'::text) AND (octet_length((plan)::text) <= 5242880))) |
| `quality_plans_policy_version_check` | C | CHECK ((policy_version = 'intake-quality-v1'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `quality_plans_candidate_id_candidate_version_candidate_dige_key` | CREATE UNIQUE INDEX quality_plans_candidate_id_candidate_version_candidate_dige_key ON content_intake.quality_plans USING btree (candidate_id, candidate_version, candidate_digest) |
| `quality_plans_pkey` | CREATE UNIQUE INDEX quality_plans_pkey ON content_intake.quality_plans USING btree (candidate_id, candidate_version) |

### quality_rounds

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `candidate_digest` | `content_intake.sha256` | 否 |  |  |
| `phase` | `text` | 否 |  |  |
| `checks` | `jsonb` | 否 |  |  |
| `checked_by` | `content_intake.identifier` | 否 |  |  |
| `facts_version` | `content_intake.version` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `quality_rounds_candidate_id_candidate_version_candidate_di_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, candidate_digest) REFERENCES content_intake.quality_plans(candidate_id, candidate_version, candidate_digest) |
| `quality_rounds_checked_by_facts_version_fkey` | F | FOREIGN KEY (checked_by, facts_version) REFERENCES content_intake.principal_facts(principal_id, facts_version) NOT VALID |
| `quality_rounds_checks_check` | C | CHECK (((jsonb_typeof(checks) = 'array'::text) AND (jsonb_array_length(checks) <= 5000) AND (octet_length((checks)::text) <= 8388608))) |
| `quality_rounds_phase_check` | C | CHECK ((phase = ANY (ARRAY['initial'::text, 'expanded'::text]))) |
| `quality_rounds_pkey` | P | PRIMARY KEY (candidate_id, candidate_version, phase) |

索引：

| 名称 | 定义 |
| --- | --- |
| `quality_rounds_pkey` | CREATE UNIQUE INDEX quality_rounds_pkey ON content_intake.quality_rounds USING btree (candidate_id, candidate_version, phase) |

### release_catalogs

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `format_version` | `text` | 否 |  |  |
| `sop_nodes` | `jsonb` | 否 | `'[]'::jsonb` |  |
| `sop_edges` | `jsonb` | 否 | `'[]'::jsonb` |  |
| `media` | `jsonb` | 否 | `'[]'::jsonb` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `release_catalogs_format_version_check` | C | CHECK ((format_version = 'intake-v2.1'::text)) |
| `release_catalogs_media_check` | C | CHECK ((media = '[]'::jsonb)) |
| `release_catalogs_pkey` | P | PRIMARY KEY (release_id) |
| `release_catalogs_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |
| `release_catalogs_sop_edges_check` | C | CHECK ((sop_edges = '[]'::jsonb)) |
| `release_catalogs_sop_nodes_check` | C | CHECK ((sop_nodes = '[]'::jsonb)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `release_catalogs_pkey` | CREATE UNIQUE INDEX release_catalogs_pkey ON content_intake.release_catalogs USING btree (release_id) |

### release_lineage

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `business_entry_id` | `content_intake.identifier` | 否 |  |  |
| `script_version` | `content_intake.version` | 否 |  |  |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `review_request_id` | `content_intake.identifier` | 是 |  |  |
| `content_valid_until` | `timestamp with time zone` | 否 |  |  |
| `publication_policy` | `text` | 否 | `'approval-v1'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `lineage_publication_evidence` | C | CHECK ((((publication_policy = 'approval-v1'::text) AND (review_request_id IS NOT NULL)) OR ((publication_policy = 'direct-v1'::text) AND (review_request_id IS NULL)))) |
| `release_lineage_candidate_id_candidate_version_publication_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, publication_policy) REFERENCES content_intake.candidate_versions(candidate_id, version, publication_policy) NOT VALID |
| `release_lineage_candidate_id_candidate_version_source_id_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) NOT VALID |
| `release_lineage_pkey` | P | PRIMARY KEY (release_id, source_id, business_entry_id) |
| `release_lineage_publication_policy_check` | C | CHECK ((publication_policy = ANY (ARRAY['approval-v1'::text, 'direct-v1'::text]))) |
| `release_lineage_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_intake.release_catalogs(release_id) |
| `release_lineage_review_request_id_candidate_id_candidate_v_fkey` | F | FOREIGN KEY (review_request_id, candidate_id, candidate_version) REFERENCES content_intake.review_bindings(review_request_id, candidate_id, candidate_version) |
| `release_lineage_review_request_id_fkey` | F | FOREIGN KEY (review_request_id) REFERENCES content_intake.review_bindings(review_request_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `release_lineage_pkey` | CREATE UNIQUE INDEX release_lineage_pkey ON content_intake.release_lineage USING btree (release_id, source_id, business_entry_id) |
| `release_lineage_review` | CREATE INDEX release_lineage_review ON content_intake.release_lineage USING btree (review_request_id, release_id) |

### release_revocations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `generation` | `content_intake.version` | 否 |  |  |
| `reason` | `text` | 否 |  |  |
| `revoked_at` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `release_revocations_pkey` | P | PRIMARY KEY (release_id) |
| `release_revocations_reason_check` | C | CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 512))) |
| `release_revocations_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `release_revocations_pkey` | CREATE UNIQUE INDEX release_revocations_pkey ON content_intake.release_revocations USING btree (release_id) |

### release_rollback_lineage

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `review_request_id` | `content_intake.identifier` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `release_rollback_lineage_pkey` | P | PRIMARY KEY (release_id, review_request_id) |
| `release_rollback_lineage_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_intake.release_catalogs(release_id) |
| `release_rollback_lineage_review_request_id_fkey` | F | FOREIGN KEY (review_request_id) REFERENCES content_intake.review_bindings(review_request_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `release_rollback_lineage_pkey` | CREATE UNIQUE INDEX release_rollback_lineage_pkey ON content_intake.release_rollback_lineage USING btree (release_id, review_request_id) |
| `release_rollback_lineage_review` | CREATE INDEX release_rollback_lineage_review ON content_intake.release_rollback_lineage USING btree (review_request_id, release_id) |

### review_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `review_request_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_id` | `content_intake.identifier` | 是 |  |  |
| `candidate_version` | `content_intake.version` | 是 |  |  |
| `candidate_digest` | `content_intake.sha256` | 是 |  |  |
| `rollback_plan_id` | `content_intake.identifier` | 是 |  |  |
| `impact_digest` | `content_intake.sha256` | 是 |  |  |
| `evidence_version` | `content_intake.version` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `definition_id` | `content_intake.identifier` | 否 |  |  |
| `node_id` | `content_intake.identifier` | 否 |  |  |
| `create_uuid` | `uuid` | 否 |  |  |
| `instance_code` | `content_intake.identifier` | 是 |  |  |
| `package_object_id` | `content_intake.identifier` | 否 |  |  |
| `package_sha256` | `content_intake.sha256` | 否 |  |  |
| `attachment_file_code` | `text` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `review_bindings_attachment_file_code_check` | C | CHECK (((length(attachment_file_code) >= 1) AND (length(attachment_file_code) <= 512))) |
| `review_bindings_candidate_id_candidate_version_candidate_d_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id, version, digest) |
| `review_bindings_candidate_id_candidate_version_evidence_ver_key` | U | UNIQUE (candidate_id, candidate_version, evidence_version) |
| `review_bindings_check` | C | CHECK ((((candidate_id IS NOT NULL) AND (candidate_version IS NOT NULL) AND (candidate_digest IS NOT NULL) AND (rollback_plan_id IS NULL) AND (impact_digest IS NULL)) OR ((candidate_id IS NULL) AND (candidate_version IS NULL) AND (candidate_digest IS NULL) AND (rollback_plan_id IS NOT NULL) AND (impact_digest IS NOT NULL)))) |
| `review_bindings_create_uuid_key` | U | UNIQUE (create_uuid) |
| `review_bindings_package_object_id_fkey` | F | FOREIGN KEY (package_object_id) REFERENCES content_intake.objects(object_id) |
| `review_bindings_package_object_id_package_sha256_fkey` | F | FOREIGN KEY (package_object_id, package_sha256) REFERENCES content_intake.objects(object_id, sha256) |
| `review_bindings_pkey` | P | PRIMARY KEY (review_request_id) |
| `review_bindings_review_request_id_candidate_id_candidate_ve_key` | U | UNIQUE (review_request_id, candidate_id, candidate_version) |
| `review_bindings_rollback_plan_id_evidence_version_key` | U | UNIQUE (rollback_plan_id, evidence_version) |
| `review_bindings_rollback_plan_id_impact_digest_fkey` | F | FOREIGN KEY (rollback_plan_id, impact_digest) REFERENCES content_intake.rollback_plans(rollback_plan_id, impact_digest) |
| `review_bindings_tenant_id_app_id_instance_code_key` | U | UNIQUE (tenant_id, app_id, instance_code) |

索引：

| 名称 | 定义 |
| --- | --- |
| `review_bindings_candidate_id_candidate_version_evidence_ver_key` | CREATE UNIQUE INDEX review_bindings_candidate_id_candidate_version_evidence_ver_key ON content_intake.review_bindings USING btree (candidate_id, candidate_version, evidence_version) |
| `review_bindings_create_uuid_key` | CREATE UNIQUE INDEX review_bindings_create_uuid_key ON content_intake.review_bindings USING btree (create_uuid) |
| `review_bindings_pkey` | CREATE UNIQUE INDEX review_bindings_pkey ON content_intake.review_bindings USING btree (review_request_id) |
| `review_bindings_review_request_id_candidate_id_candidate_ve_key` | CREATE UNIQUE INDEX review_bindings_review_request_id_candidate_id_candidate_ve_key ON content_intake.review_bindings USING btree (review_request_id, candidate_id, candidate_version) |
| `review_bindings_rollback_plan_id_evidence_version_key` | CREATE UNIQUE INDEX review_bindings_rollback_plan_id_evidence_version_key ON content_intake.review_bindings USING btree (rollback_plan_id, evidence_version) |
| `review_bindings_tenant_id_app_id_instance_code_key` | CREATE UNIQUE INDEX review_bindings_tenant_id_app_id_instance_code_key ON content_intake.review_bindings USING btree (tenant_id, app_id, instance_code) |

### role_ceiling

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `role` | `content_intake.identifier` | 否 |  |  |
| `business_actions` | `text[]` | 否 |  |  |
| `may_allocate` | `boolean` | 否 |  |  |
| `may_delegate` | `boolean` | 否 |  |  |
| `may_skip_import_parent` | `boolean` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `role_ceiling_business_actions_check` | C | CHECK (((cardinality(business_actions) >= 1) AND (cardinality(business_actions) <= 8))) |
| `role_ceiling_check` | C | CHECK (((NOT may_delegate) OR may_allocate)) |
| `role_ceiling_pkey` | P | PRIMARY KEY (role) |

索引：

| 名称 | 定义 |
| --- | --- |
| `role_ceiling_pkey` | CREATE UNIQUE INDEX role_ceiling_pkey ON content_intake.role_ceiling USING btree (role) |

### role_rule_history

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `event_id` | `uuid` | 否 | `public.gen_random_uuid()` |  |
| `recorded_at` | `timestamp with time zone` | 否 |  |  |
| `before_record` | `jsonb` | 是 |  |  |
| `after_record` | `jsonb` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `role_rule_history_check` | C | CHECK (((before_record IS NOT NULL) OR (after_record IS NOT NULL))) |
| `role_rule_history_pkey` | P | PRIMARY KEY (event_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `role_rule_history_pkey` | CREATE UNIQUE INDEX role_rule_history_pkey ON content_intake.role_rule_history USING btree (event_id) |

### role_rules

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `department_id` | `content_intake.identifier` | 否 |  |  |
| `job_id` | `content_intake.identifier` | 否 |  |  |
| `policy_version` | `content_intake.version` | 否 |  |  |
| `role` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `role_rules_pkey` | P | PRIMARY KEY (tenant_id, app_id, department_id, job_id) |
| `role_rules_role_check` | C | CHECK ((role = ANY (ARRAY['agent'::text, 'enabler'::text, 'lead'::text, 'supervisor'::text, 'manager'::text, 'director'::text, 'engineer'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `role_rules_pkey` | CREATE UNIQUE INDEX role_rules_pkey ON content_intake.role_rules USING btree (tenant_id, app_id, department_id, job_id) |

### rollback_plans

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `rollback_plan_id` | `content_intake.identifier` | 否 |  |  |
| `base_release_id` | `text` | 否 |  |  |
| `target_release_id` | `text` | 否 |  |  |
| `impact_digest` | `content_intake.sha256` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `rollback_plans_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `rollback_plans_base_release_id_fkey` | F | FOREIGN KEY (base_release_id) REFERENCES content_releases(release_id) |
| `rollback_plans_check` | C | CHECK ((base_release_id <> target_release_id)) |
| `rollback_plans_pkey` | P | PRIMARY KEY (rollback_plan_id) |
| `rollback_plans_rollback_plan_id_impact_digest_key` | U | UNIQUE (rollback_plan_id, impact_digest) |
| `rollback_plans_target_release_id_fkey` | F | FOREIGN KEY (target_release_id) REFERENCES content_releases(release_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `rollback_plans_pkey` | CREATE UNIQUE INDEX rollback_plans_pkey ON content_intake.rollback_plans USING btree (rollback_plan_id) |
| `rollback_plans_rollback_plan_id_impact_digest_key` | CREATE UNIQUE INDEX rollback_plans_rollback_plan_id_impact_digest_key ON content_intake.rollback_plans USING btree (rollback_plan_id, impact_digest) |

### rollback_scopes

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `rollback_plan_id` | `content_intake.identifier` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `rollback_scopes_pkey` | P | PRIMARY KEY (rollback_plan_id, source_id) |
| `rollback_scopes_rollback_plan_id_fkey` | F | FOREIGN KEY (rollback_plan_id) REFERENCES content_intake.rollback_plans(rollback_plan_id) |
| `rollback_scopes_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `rollback_scopes_pkey` | CREATE UNIQUE INDEX rollback_scopes_pkey ON content_intake.rollback_scopes USING btree (rollback_plan_id, source_id) |

### roster_terms

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `term` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `roster_terms_pkey` | P | PRIMARY KEY (principal_id) |
| `roster_terms_principal_id_fkey` | F | FOREIGN KEY (principal_id) REFERENCES content_intake.principals(principal_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `roster_terms_pkey` | CREATE UNIQUE INDEX roster_terms_pkey ON content_intake.roster_terms USING btree (principal_id) |

### scopes

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `scope_id` | `content_intake.identifier` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `brand_id` | `content_intake.identifier` | 否 |  |  |
| `shop_id` | `content_intake.identifier` | 是 |  |  |
| `domain` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `scopes_domain_check` | C | CHECK ((domain = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text, 'sop'::text]))) |
| `scopes_pkey` | P | PRIMARY KEY (scope_id) |
| `scopes_scope_id_tenant_id_app_id_key` | U | UNIQUE (scope_id, tenant_id, app_id) |
| `scopes_tenant_id_app_id_brand_id_shop_id_domain_key` | U | UNIQUE NULLS NOT DISTINCT (tenant_id, app_id, brand_id, shop_id, domain) |

索引：

| 名称 | 定义 |
| --- | --- |
| `scopes_pkey` | CREATE UNIQUE INDEX scopes_pkey ON content_intake.scopes USING btree (scope_id) |
| `scopes_scope_id_tenant_id_app_id_key` | CREATE UNIQUE INDEX scopes_scope_id_tenant_id_app_id_key ON content_intake.scopes USING btree (scope_id, tenant_id, app_id) |
| `scopes_tenant_id_app_id_brand_id_shop_id_domain_key` | CREATE UNIQUE INDEX scopes_tenant_id_app_id_brand_id_shop_id_domain_key ON content_intake.scopes USING btree (tenant_id, app_id, brand_id, shop_id, domain) NULLS NOT DISTINCT |

### seat_posts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `department_id` | `content_intake.identifier` | 否 |  |  |
| `job_id` | `content_intake.identifier` | 否 |  |  |
| `assigned_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |
| `assigned_by` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `seat_posts_assigned_at_check` | C | CHECK (isfinite(assigned_at)) |
| `seat_posts_assigned_by_check` | C | CHECK (((length(assigned_by) >= 1) AND (length(assigned_by) <= 128))) |
| `seat_posts_pkey` | P | PRIMARY KEY (principal_id) |
| `seat_posts_principal_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (principal_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `seat_posts_pkey` | CREATE UNIQUE INDEX seat_posts_pkey ON content_intake.seat_posts USING btree (principal_id) |

### shop_directory_key_events

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `key_id` | `content_intake.identifier` | 是 |  |  |
| `operator_role` | `text` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 是 |  |  |
| `operation_id` | `content_intake.identifier` | 否 |  |  |
| `request_hash` | `text` | 否 |  |  |
| `reason` | `text` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 |  |  |
| `result` | `jsonb` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_directory_key_events_pkey` | P | PRIMARY KEY (tenant_id, app_id, version) |
| `shop_directory_key_events_reason_check` | C | CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 512))) |
| `shop_directory_key_events_recorded_at_check` | C | CHECK (isfinite(recorded_at)) |
| `shop_directory_key_events_request_hash_check` | C | CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)) |
| `shop_directory_key_events_tenant_id_app_id_operation_id_key` | U | UNIQUE (tenant_id, app_id, operation_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_directory_key_events_pkey` | CREATE UNIQUE INDEX shop_directory_key_events_pkey ON content_intake.shop_directory_key_events USING btree (tenant_id, app_id, version) |
| `shop_directory_key_events_tenant_id_app_id_operation_id_key` | CREATE UNIQUE INDEX shop_directory_key_events_tenant_id_app_id_operation_id_key ON content_intake.shop_directory_key_events USING btree (tenant_id, app_id, operation_id) |

### shop_directory_keys

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `key_id` | `content_intake.identifier` | 是 |  |  |
| `key_material` | `text` | 是 |  |  |
| `valid_from` | `timestamp with time zone` | 是 |  |  |
| `valid_until` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_directory_keys_check` | C | CHECK ((((key_id IS NULL) AND (key_material IS NULL) AND (valid_from IS NULL) AND (valid_until IS NULL)) OR ((key_id IS NOT NULL) AND (key_material IS NOT NULL) AND (key_material ~ '^[0-9a-f]{64}$'::text) AND (valid_from IS NOT NULL) AND isfinite(valid_from) AND (valid_until IS NOT NULL) AND isfinite(valid_until) AND (valid_from < valid_until)))) |
| `shop_directory_keys_pkey` | P | PRIMARY KEY (tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_directory_keys_pkey` | CREATE UNIQUE INDEX shop_directory_keys_pkey ON content_intake.shop_directory_keys USING btree (tenant_id, app_id) |

### shop_directory_registrars

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `registrar_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `valid_from` | `timestamp with time zone` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 否 |  |  |
| `revoked_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_directory_registrars_check` | C | CHECK ((isfinite(valid_until) AND (valid_from < valid_until))) |
| `shop_directory_registrars_pkey` | P | PRIMARY KEY (tenant_id, app_id, registrar_id) |
| `shop_directory_registrars_registrar_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (registrar_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |
| `shop_directory_registrars_revoked_at_check` | C | CHECK (isfinite(revoked_at)) |
| `shop_directory_registrars_valid_from_check` | C | CHECK (isfinite(valid_from)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_directory_registrars_pkey` | CREATE UNIQUE INDEX shop_directory_registrars_pkey ON content_intake.shop_directory_registrars USING btree (tenant_id, app_id, registrar_id) |

### shop_directory_revisions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `directory_revision` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_directory_revisions_pkey` | P | PRIMARY KEY (tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_directory_revisions_pkey` | CREATE UNIQUE INDEX shop_directory_revisions_pkey ON content_intake.shop_directory_revisions USING btree (tenant_id, app_id) |

### shop_directory_steward_events

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `actor_facts_version` | `content_intake.version` | 否 |  |  |
| `registrar_version` | `content_intake.version` | 否 |  |  |
| `prior_steward_id` | `content_intake.identifier` | 是 |  |  |
| `steward_id` | `content_intake.identifier` | 是 |  |  |
| `target_facts_version` | `content_intake.version` | 是 |  |  |
| `valid_until` | `timestamp with time zone` | 是 |  |  |
| `operation_id` | `content_intake.identifier` | 否 |  |  |
| `request_hash` | `text` | 否 |  |  |
| `reason` | `text` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 |  |  |
| `result` | `jsonb` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_directory_steward_events_actor_id_operation_id_key` | U | UNIQUE (actor_id, operation_id) |
| `shop_directory_steward_events_pkey` | P | PRIMARY KEY (tenant_id, app_id, version) |
| `shop_directory_steward_events_reason_check` | C | CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 512))) |
| `shop_directory_steward_events_recorded_at_check` | C | CHECK (isfinite(recorded_at)) |
| `shop_directory_steward_events_request_hash_check` | C | CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_directory_steward_events_actor_id_operation_id_key` | CREATE UNIQUE INDEX shop_directory_steward_events_actor_id_operation_id_key ON content_intake.shop_directory_steward_events USING btree (actor_id, operation_id) |
| `shop_directory_steward_events_pkey` | CREATE UNIQUE INDEX shop_directory_steward_events_pkey ON content_intake.shop_directory_steward_events USING btree (tenant_id, app_id, version) |

### shop_directory_stewards

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `steward_id` | `content_intake.identifier` | 是 |  |  |
| `registered_at` | `timestamp with time zone` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `active` | `boolean` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_directory_stewards_check` | C | CHECK ((active = (steward_id IS NOT NULL))) |
| `shop_directory_stewards_check1` | C | CHECK (((active AND (valid_until IS NOT NULL) AND isfinite(valid_until) AND (registered_at < valid_until)) OR ((NOT active) AND (valid_until IS NULL)))) |
| `shop_directory_stewards_pkey` | P | PRIMARY KEY (tenant_id, app_id) |
| `shop_directory_stewards_registered_at_check` | C | CHECK (isfinite(registered_at)) |
| `shop_directory_stewards_steward_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (steward_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_directory_stewards_pkey` | CREATE UNIQUE INDEX shop_directory_stewards_pkey ON content_intake.shop_directory_stewards USING btree (tenant_id, app_id) |

### shop_display_current

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `shop_id` | `content_intake.identifier` | 否 |  |  |
| `display_version` | `content_intake.version` | 否 |  |  |
| `directory_revision` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_display_current_pkey` | P | PRIMARY KEY (tenant_id, app_id, shop_id) |
| `shop_display_current_tenant_id_app_id_shop_id_display_vers_fkey` | F | FOREIGN KEY (tenant_id, app_id, shop_id, display_version) REFERENCES content_intake.shop_displays(tenant_id, app_id, shop_id, display_version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_display_current_pkey` | CREATE UNIQUE INDEX shop_display_current_pkey ON content_intake.shop_display_current USING btree (tenant_id, app_id, shop_id) |

### shop_displays

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `shop_id` | `content_intake.identifier` | 否 |  |  |
| `display_version` | `content_intake.version` | 否 |  |  |
| `display_name` | `text` | 否 |  |  |
| `directory_revision` | `content_intake.version` | 否 |  |  |
| `steward_id` | `content_intake.identifier` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `shop_displays_display_name_check` | C | CHECK (content_intake.valid_shop_display_name(display_name)) |
| `shop_displays_pkey` | P | PRIMARY KEY (tenant_id, app_id, shop_id, display_version) |
| `shop_displays_recorded_at_check` | C | CHECK (isfinite(recorded_at)) |
| `shop_displays_steward_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (steward_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `shop_displays_pkey` | CREATE UNIQUE INDEX shop_displays_pkey ON content_intake.shop_displays USING btree (tenant_id, app_id, shop_id, display_version) |

### sop_asset_registrations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `payload_digest` | `content_intake.sha256` | 是 |  |  |
| `content_version` | `jsonb` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_asset_registrations_candidate_id_candidate_version_fkey` | F | FOREIGN KEY (candidate_id, candidate_version) REFERENCES content_intake.candidate_versions(candidate_id, version) |
| `sop_asset_registrations_content_version_check` | C | CHECK ((jsonb_typeof(content_version) = 'object'::text)) |
| `sop_asset_registrations_pkey` | P | PRIMARY KEY (candidate_id, candidate_version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_asset_registrations_pkey` | CREATE UNIQUE INDEX sop_asset_registrations_pkey ON content_intake.sop_asset_registrations USING btree (candidate_id, candidate_version) |

### sop_candidate_media

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `media_object_id` | `content_intake.identifier` | 否 |  |  |
| `sheet_name` | `text` | 否 |  |  |
| `row_number` | `integer` | 否 |  |  |
| `column_number` | `integer` | 否 |  |  |
| `row_id` | `text` | 否 |  |  |
| `ordinal` | `integer` | 否 |  |  |
| `sha256` | `content_intake.sha256` | 否 |  |  |
| `mime` | `text` | 否 |  |  |
| `bytes` | `bigint` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_candidate_media_bytes_check` | C | CHECK (((bytes >= 1) AND (bytes <= 5242880))) |
| `sop_candidate_media_candidate_id_candidate_version_source__fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) |
| `sop_candidate_media_candidate_id_candidate_version_source__key1` | U | UNIQUE (candidate_id, candidate_version, source_id, media_object_id, sheet_name, row_number, column_number, row_id, ordinal, sha256, mime, bytes) |
| `sop_candidate_media_candidate_id_candidate_version_source_i_key` | U | UNIQUE (candidate_id, candidate_version, source_id, sheet_name, row_number, column_number, ordinal) |
| `sop_candidate_media_check` | C | CHECK ((row_id = ((('sop:'::text \|\| sheet_name) \|\| ':'::text) \|\| (row_number)::text))) |
| `sop_candidate_media_column_number_check` | C | CHECK (((column_number >= 1) AND (column_number <= 32))) |
| `sop_candidate_media_media_object_id_source_id_sha256_bytes_fkey` | F | FOREIGN KEY (media_object_id, source_id, sha256, bytes, mime) REFERENCES content_intake.sop_media_objects(media_object_id, source_id, sha256, bytes, mime) |
| `sop_candidate_media_mime_check` | C | CHECK ((mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text]))) |
| `sop_candidate_media_ordinal_check` | C | CHECK (((ordinal >= 1) AND (ordinal <= 100))) |
| `sop_candidate_media_pkey` | P | PRIMARY KEY (candidate_id, candidate_version, row_id, media_object_id, ordinal) |
| `sop_candidate_media_row_number_check` | C | CHECK (((row_number >= 1) AND (row_number <= 5000))) |
| `sop_candidate_media_sheet_name_check` | C | CHECK ((sheet_name = ANY (ARRAY['过敏流程SOP'::text, '少错破SOP'::text, '品质售后SOP'::text, '税收相关规则'::text, '品牌对接资源汇总'::text, '长痘痘SOP'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_candidate_media_candidate_id_candidate_version_source__key1` | CREATE UNIQUE INDEX sop_candidate_media_candidate_id_candidate_version_source__key1 ON content_intake.sop_candidate_media USING btree (candidate_id, candidate_version, source_id, media_object_id, sheet_name, row_number, column_number, row_id, ordinal, sha256, mime, bytes) |
| `sop_candidate_media_candidate_id_candidate_version_source_i_key` | CREATE UNIQUE INDEX sop_candidate_media_candidate_id_candidate_version_source_i_key ON content_intake.sop_candidate_media USING btree (candidate_id, candidate_version, source_id, sheet_name, row_number, column_number, ordinal) |
| `sop_candidate_media_pkey` | CREATE UNIQUE INDEX sop_candidate_media_pkey ON content_intake.sop_candidate_media USING btree (candidate_id, candidate_version, row_id, media_object_id, ordinal) |

### sop_candidate_rows

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `row_id` | `text` | 否 |  |  |
| `business_entry_id` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_candidate_rows_candidate_id_candidate_version_business__key` | U | UNIQUE (candidate_id, candidate_version, business_entry_id) |
| `sop_candidate_rows_candidate_id_candidate_version_source_i_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) |
| `sop_candidate_rows_pkey` | P | PRIMARY KEY (candidate_id, candidate_version, row_id) |
| `sop_candidate_rows_row_id_check` | C | CHECK ((row_id ~ '^sop:[^:]{1,128}:[1-9][0-9]{0,3}$'::text)) |
| `sop_candidate_rows_row_id_check1` | C | CHECK (((split_part(row_id, ':'::text, 2) = ANY (ARRAY['过敏流程SOP'::text, '少错破SOP'::text, '品质售后SOP'::text, '税收相关规则'::text, '品牌对接资源汇总'::text, '长痘痘SOP'::text])) AND ((split_part(row_id, ':'::text, 3))::integer <= 5000))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_candidate_rows_candidate_id_candidate_version_business__key` | CREATE UNIQUE INDEX sop_candidate_rows_candidate_id_candidate_version_business__key ON content_intake.sop_candidate_rows USING btree (candidate_id, candidate_version, business_entry_id) |
| `sop_candidate_rows_pkey` | CREATE UNIQUE INDEX sop_candidate_rows_pkey ON content_intake.sop_candidate_rows USING btree (candidate_id, candidate_version, row_id) |

### sop_media_objects

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `media_object_id` | `content_intake.identifier` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `sha256` | `content_intake.sha256` | 否 |  |  |
| `bytes` | `bigint` | 否 |  |  |
| `mime` | `text` | 否 |  |  |
| `state` | `text` | 否 | `'staged'::text` |  |
| `created_at` | `timestamp with time zone` | 否 |  |  |
| `adopted_at` | `timestamp with time zone` | 是 |  |  |
| `discarded_at` | `timestamp with time zone` | 是 |  |  |
| `payload_object_id` | `content_intake.identifier` | 是 |  |  |
| `payload_purpose` | `text` | 否 | `'sop-media'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_media_objects_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `sop_media_objects_bytes_check` | C | CHECK (((bytes >= 1) AND (bytes <= 5242880))) |
| `sop_media_objects_check` | C | CHECK ((((state = 'staged'::text) AND (adopted_at IS NULL) AND (discarded_at IS NULL)) OR ((state = ANY (ARRAY['adopted'::text, 'released'::text])) AND (adopted_at IS NOT NULL) AND (discarded_at IS NULL)) OR ((state = 'discarded'::text) AND (adopted_at IS NULL) AND (discarded_at IS NOT NULL)))) |
| `sop_media_objects_check1` | C | CHECK (((adopted_at IS NULL) OR (adopted_at >= created_at))) |
| `sop_media_objects_check2` | C | CHECK (((discarded_at IS NULL) OR (discarded_at >= created_at))) |
| `sop_media_objects_created_at_check` | C | CHECK (isfinite(created_at)) |
| `sop_media_objects_media_object_id_source_id_sha256_bytes_mi_key` | U | UNIQUE (media_object_id, source_id, sha256, bytes, mime) |
| `sop_media_objects_mime_check` | C | CHECK ((mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text]))) |
| `sop_media_objects_payload_purpose_check` | C | CHECK ((payload_purpose = 'sop-media'::text)) |
| `sop_media_objects_pkey` | P | PRIMARY KEY (media_object_id) |
| `sop_media_objects_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |
| `sop_media_objects_source_id_sha256_bytes_mime_key` | U | UNIQUE (source_id, sha256, bytes, mime) |
| `sop_media_objects_state_check` | C | CHECK ((state = ANY (ARRAY['staged'::text, 'adopted'::text, 'released'::text, 'discarded'::text]))) |
| `sop_payload_exact` | F | FOREIGN KEY (payload_object_id, source_id, sha256, bytes, mime, payload_purpose) REFERENCES content_intake.objects(object_id, source_id, sha256, bytes, mime, purpose) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_media_objects_media_object_id_source_id_sha256_bytes_mi_key` | CREATE UNIQUE INDEX sop_media_objects_media_object_id_source_id_sha256_bytes_mi_key ON content_intake.sop_media_objects USING btree (media_object_id, source_id, sha256, bytes, mime) |
| `sop_media_objects_pkey` | CREATE UNIQUE INDEX sop_media_objects_pkey ON content_intake.sop_media_objects USING btree (media_object_id) |
| `sop_media_objects_source_id_sha256_bytes_mime_key` | CREATE UNIQUE INDEX sop_media_objects_source_id_sha256_bytes_mime_key ON content_intake.sop_media_objects USING btree (source_id, sha256, bytes, mime) |

### sop_payload_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `job_id` | `content_intake.identifier` | 否 |  |  |
| `media_object_id` | `content_intake.identifier` | 否 |  |  |
| `object_id` | `text` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `sha256` | `content_intake.sha256` | 否 |  |  |
| `bytes` | `bigint` | 否 |  |  |
| `mime` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_payload_bindings_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `sop_payload_bindings_bytes_check` | C | CHECK (((bytes >= 1) AND (bytes <= 5242880))) |
| `sop_payload_bindings_job_id_fkey` | F | FOREIGN KEY (job_id) REFERENCES content_intake.parse_jobs(job_id) |
| `sop_payload_bindings_media_object_id_check` | C | CHECK (((media_object_id)::text ~ '^med_[0-9a-f]{64}$'::text)) |
| `sop_payload_bindings_mime_check` | C | CHECK ((mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text]))) |
| `sop_payload_bindings_object_id_fkey` | F | FOREIGN KEY (object_id) REFERENCES content_intake.object_reservations(object_id) |
| `sop_payload_bindings_pkey` | P | PRIMARY KEY (job_id, media_object_id) |
| `sop_payload_bindings_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_payload_bindings_pkey` | CREATE UNIQUE INDEX sop_payload_bindings_pkey ON content_intake.sop_payload_bindings USING btree (job_id, media_object_id) |

### sop_release_media

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `media_object_id` | `content_intake.identifier` | 否 |  |  |
| `sheet_name` | `text` | 否 |  |  |
| `row_number` | `integer` | 否 |  |  |
| `column_number` | `integer` | 否 |  |  |
| `row_id` | `text` | 否 |  |  |
| `ordinal` | `integer` | 否 |  |  |
| `sha256` | `content_intake.sha256` | 否 |  |  |
| `mime` | `text` | 否 |  |  |
| `bytes` | `bigint` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_release_media_bytes_check` | C | CHECK (((bytes >= 1) AND (bytes <= 5242880))) |
| `sop_release_media_candidate_id_candidate_version_source_id_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_id, media_object_id, sheet_name, row_number, column_number, row_id, ordinal, sha256, mime, bytes) REFERENCES content_intake.sop_candidate_media(candidate_id, candidate_version, source_id, media_object_id, sheet_name, row_number, column_number, row_id, ordinal, sha256, mime, bytes) |
| `sop_release_media_check` | C | CHECK ((row_id = ((('sop:'::text \|\| sheet_name) \|\| ':'::text) \|\| (row_number)::text))) |
| `sop_release_media_column_number_check` | C | CHECK (((column_number >= 1) AND (column_number <= 32))) |
| `sop_release_media_mime_check` | C | CHECK ((mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text]))) |
| `sop_release_media_ordinal_check` | C | CHECK (((ordinal >= 1) AND (ordinal <= 100))) |
| `sop_release_media_pkey` | P | PRIMARY KEY (release_id, row_id, media_object_id, ordinal) |
| `sop_release_media_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |
| `sop_release_media_row_number_check` | C | CHECK (((row_number >= 1) AND (row_number <= 5000))) |
| `sop_release_media_sheet_name_check` | C | CHECK ((sheet_name = ANY (ARRAY['过敏流程SOP'::text, '少错破SOP'::text, '品质售后SOP'::text, '税收相关规则'::text, '品牌对接资源汇总'::text, '长痘痘SOP'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_release_media_pkey` | CREATE UNIQUE INDEX sop_release_media_pkey ON content_intake.sop_release_media USING btree (release_id, row_id, media_object_id, ordinal) |

### sop_row_deletion_events

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `row_id` | `text` | 否 |  |  |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `content_version` | `jsonb` | 否 |  |  |
| `deleted_at` | `timestamp with time zone` | 否 |  |  |
| `media` | `jsonb` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_row_deletion_events_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `sop_row_deletion_events_candidate_id_candidate_version_sou_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) |
| `sop_row_deletion_events_deleted_at_check` | C | CHECK (isfinite(deleted_at)) |
| `sop_row_deletion_events_media_check` | C | CHECK ((jsonb_typeof(media) = 'array'::text)) |
| `sop_row_deletion_events_pkey` | P | PRIMARY KEY (candidate_id, candidate_version, row_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_deletion_source_row` | CREATE INDEX sop_deletion_source_row ON content_intake.sop_row_deletion_events USING btree (source_id, row_id) |
| `sop_row_deletion_events_pkey` | CREATE UNIQUE INDEX sop_row_deletion_events_pkey ON content_intake.sop_row_deletion_events USING btree (candidate_id, candidate_version, row_id) |

### source_confirmations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `candidate_id` | `content_intake.identifier` | 否 |  |  |
| `candidate_version` | `content_intake.version` | 否 |  |  |
| `candidate_digest` | `content_intake.sha256` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `evidence_version` | `content_intake.version` | 否 |  |  |
| `revocation_generation` | `content_intake.generation` | 否 | `0` |  |
| `version_kind` | `text` | 否 |  |  |
| `version_value` | `text` | 否 |  |  |
| `acquisition` | `text` | 否 |  |  |
| `confirmed_by` | `content_intake.identifier` | 否 |  |  |
| `confirmed_at` | `timestamp with time zone` | 否 |  |  |
| `object_sha256` | `content_intake.sha256` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `source_confirmations_acquisition_check` | C | CHECK ((acquisition = ANY (ARRAY['feishu-export'::text, 'controlled-synthetic-export'::text]))) |
| `source_confirmations_candidate_id_candidate_version_candid_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id, version, digest) |
| `source_confirmations_candidate_id_candidate_version_object_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, object_sha256) REFERENCES content_intake.candidate_versions(candidate_id, version, file_sha256) |
| `source_confirmations_candidate_id_candidate_version_source_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_id) REFERENCES content_intake.candidate_versions(candidate_id, version, source_id) |
| `source_confirmations_check` | C | CHECK (((version_kind <> 'integer'::text) OR (version_value ~ '^(0\|[1-9][0-9]{0,18})$'::text))) |
| `source_confirmations_confirmed_by_fkey` | F | FOREIGN KEY (confirmed_by) REFERENCES content_intake.principals(principal_id) |
| `source_confirmations_pkey` | P | PRIMARY KEY (candidate_id, candidate_version, evidence_version) |
| `source_confirmations_version_kind_check` | C | CHECK ((version_kind = ANY (ARRAY['integer'::text, 'opaque'::text]))) |
| `source_confirmations_version_value_check` | C | CHECK (((length(version_value) >= 1) AND (length(version_value) <= 128))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `source_confirmations_pkey` | CREATE UNIQUE INDEX source_confirmations_pkey ON content_intake.source_confirmations USING btree (candidate_id, candidate_version, evidence_version) |

### source_mappings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `template_version` | `text` | 否 |  |  |
| `rule_version` | `text` | 否 |  |  |
| `mapping_version` | `text` | 否 |  |  |
| `structure_digest` | `content_intake.sha256` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `source_mappings_mapping_version_check` | C | CHECK (((length(mapping_version) >= 1) AND (length(mapping_version) <= 64))) |
| `source_mappings_pkey` | P | PRIMARY KEY (source_id, version) |
| `source_mappings_rule_version_check` | C | CHECK (((length(rule_version) >= 1) AND (length(rule_version) <= 64))) |
| `source_mappings_source_id_fkey` | F | FOREIGN KEY (source_id) REFERENCES content_intake.sources(source_id) |
| `source_mappings_template_version_check` | C | CHECK (((length(template_version) >= 1) AND (length(template_version) <= 64))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `source_mappings_pkey` | CREATE UNIQUE INDEX source_mappings_pkey ON content_intake.source_mappings USING btree (source_id, version) |

### sources

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `scope_id` | `content_intake.identifier` | 否 |  |  |
| `current_mapping_version` | `content_intake.version` | 否 |  |  |
| `mode` | `text` | 否 | `'legacy'::text` |  |
| `mode_version` | `content_intake.version` | 否 | `1` |  |
| `revocation_generation` | `content_intake.generation` | 否 | `0` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `source_current_mapping_fk` | F | FOREIGN KEY (source_id, current_mapping_version) REFERENCES content_intake.source_mappings(source_id, version) DEFERRABLE INITIALLY DEFERRED |
| `sources_mode_check` | C | CHECK ((mode = ANY (ARRAY['legacy'::text, 'v2-preview'::text, 'v2-active'::text]))) |
| `sources_pkey` | P | PRIMARY KEY (source_id) |
| `sources_scope_id_fkey` | F | FOREIGN KEY (scope_id) REFERENCES content_intake.scopes(scope_id) |
| `sources_source_id_scope_id_key` | U | UNIQUE (source_id, scope_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sources_pkey` | CREATE UNIQUE INDEX sources_pkey ON content_intake.sources USING btree (source_id) |
| `sources_source_id_scope_id_key` | CREATE UNIQUE INDEX sources_source_id_scope_id_key ON content_intake.sources USING btree (source_id, scope_id) |

### store_set_current

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `store_set_current_pkey` | P | PRIMARY KEY (tenant_id, app_id) |
| `store_set_current_tenant_id_app_id_version_fkey` | F | FOREIGN KEY (tenant_id, app_id, version) REFERENCES content_intake.store_sets(tenant_id, app_id, version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `store_set_current_pkey` | CREATE UNIQUE INDEX store_set_current_pkey ON content_intake.store_set_current USING btree (tenant_id, app_id) |

### store_set_members

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `scope_id` | `content_intake.identifier` | 否 |  |  |
| `source_id` | `content_intake.identifier` | 否 |  |  |
| `content_valid_until` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `store_set_members_pkey` | P | PRIMARY KEY (tenant_id, app_id, version, scope_id, source_id) |
| `store_set_members_source_id_scope_id_fkey` | F | FOREIGN KEY (source_id, scope_id) REFERENCES content_intake.sources(source_id, scope_id) |
| `store_set_members_tenant_id_app_id_version_fkey` | F | FOREIGN KEY (tenant_id, app_id, version) REFERENCES content_intake.store_sets(tenant_id, app_id, version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `store_set_members_pkey` | CREATE UNIQUE INDEX store_set_members_pkey ON content_intake.store_set_members USING btree (tenant_id, app_id, version, scope_id, source_id) |

### store_sets

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `version` | `content_intake.version` | 否 |  |  |
| `approved_at` | `timestamp with time zone` | 否 |  |  |
| `provenance` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `store_sets_pkey` | P | PRIMARY KEY (tenant_id, app_id, version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `store_sets_pkey` | CREATE UNIQUE INDEX store_sets_pkey ON content_intake.store_sets USING btree (tenant_id, app_id, version) |

### vocabulary

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `vocabulary_id` | `content_intake.identifier` | 否 |  |  |
| `scope_id` | `content_intake.identifier` | 否 |  |  |
| `kind` | `text` | 否 |  |  |
| `meaning_digest` | `content_intake.sha256` | 否 |  |  |
| `active` | `boolean` | 否 | `true` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `vocabulary_kind_check` | C | CHECK ((kind = ANY (ARRAY['product'::text, 'scenario'::text]))) |
| `vocabulary_pkey` | P | PRIMARY KEY (vocabulary_id) |
| `vocabulary_scope_id_fkey` | F | FOREIGN KEY (scope_id) REFERENCES content_intake.scopes(scope_id) |
| `vocabulary_vocabulary_id_scope_id_key` | U | UNIQUE (vocabulary_id, scope_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `vocabulary_pkey` | CREATE UNIQUE INDEX vocabulary_pkey ON content_intake.vocabulary USING btree (vocabulary_id) |
| `vocabulary_vocabulary_id_scope_id_key` | CREATE UNIQUE INDEX vocabulary_vocabulary_id_scope_id_key ON content_intake.vocabulary USING btree (vocabulary_id, scope_id) |

### vocabulary_displays

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `vocabulary_id` | `content_intake.identifier` | 否 |  |  |
| `display_version` | `content_intake.version` | 否 |  |  |
| `display_name` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `vocabulary_displays_display_name_check` | C | CHECK (((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 256))) |
| `vocabulary_displays_pkey` | P | PRIMARY KEY (vocabulary_id, display_version) |
| `vocabulary_displays_vocabulary_id_fkey` | F | FOREIGN KEY (vocabulary_id) REFERENCES content_intake.vocabulary(vocabulary_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `vocabulary_displays_pkey` | CREATE UNIQUE INDEX vocabulary_displays_pkey ON content_intake.vocabulary_displays USING btree (vocabulary_id, display_version) |

### write_attempts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `actor_id` | `content_intake.identifier` | 否 |  |  |
| `operation_id` | `content_intake.identifier` | 否 |  |  |
| `action` | `text` | 否 |  |  |
| `candidate_id` | `content_intake.identifier` | 是 |  |  |
| `candidate_version` | `content_intake.version` | 是 |  |  |
| `candidate_digest` | `content_intake.sha256` | 是 |  |  |
| `rollback_plan_id` | `content_intake.identifier` | 是 |  |  |
| `impact_digest` | `content_intake.sha256` | 是 |  |  |
| `payload_digest` | `content_intake.sha256` | 否 |  |  |
| `base_release_id` | `text` | 是 |  |  |
| `source_evidence_version` | `content_intake.version` | 是 |  |  |
| `approval_evidence_version` | `content_intake.version` | 是 |  |  |
| `import_batch_id` | `text` | 是 |  |  |
| `state` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 |  |  |
| `publication_policy` | `text` | 否 | `'approval-v1'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `attempt_publication_evidence` | C | CHECK ((((action = 'cancel'::text) AND (source_evidence_version IS NULL) AND (approval_evidence_version IS NULL) AND (import_batch_id IS NULL)) OR ((action = ANY (ARRAY['publish'::text, 'rollback'::text])) AND (((action = 'publish'::text) AND (source_evidence_version IS NOT NULL)) OR ((action = 'rollback'::text) AND (source_evidence_version IS NULL) AND (import_batch_id IS NULL))) AND (((publication_policy = 'approval-v1'::text) AND (approval_evidence_version IS NOT NULL)) OR ((publication_policy = 'direct-v1'::text) AND (approval_evidence_version IS NULL)))))) |
| `write_attempts_action_check` | C | CHECK ((action = ANY (ARRAY['publish'::text, 'cancel'::text, 'rollback'::text]))) |
| `write_attempts_actor_id_action_operation_id_candidate_id_ca_key` | U | UNIQUE (actor_id, action, operation_id, candidate_id, candidate_version) |
| `write_attempts_actor_id_action_operation_id_publication_pol_key` | U | UNIQUE (actor_id, action, operation_id, publication_policy) |
| `write_attempts_actor_id_action_operation_id_rollback_plan_i_key` | U | UNIQUE (actor_id, action, operation_id, rollback_plan_id) |
| `write_attempts_actor_id_fkey` | F | FOREIGN KEY (actor_id) REFERENCES content_intake.principals(principal_id) |
| `write_attempts_base_release_id_fkey` | F | FOREIGN KEY (base_release_id) REFERENCES content_releases(release_id) |
| `write_attempts_candidate_id_candidate_version_approval_evi_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, approval_evidence_version) REFERENCES content_intake.review_bindings(candidate_id, candidate_version, evidence_version) |
| `write_attempts_candidate_id_candidate_version_candidate_di_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id, version, digest) |
| `write_attempts_candidate_id_candidate_version_publication__fkey` | F | FOREIGN KEY (candidate_id, candidate_version, publication_policy) REFERENCES content_intake.candidate_versions(candidate_id, version, publication_policy) |
| `write_attempts_candidate_id_candidate_version_source_evide_fkey` | F | FOREIGN KEY (candidate_id, candidate_version, source_evidence_version) REFERENCES content_intake.source_confirmations(candidate_id, candidate_version, evidence_version) |
| `write_attempts_check` | C | CHECK ((((action = ANY (ARRAY['publish'::text, 'cancel'::text])) AND (candidate_id IS NOT NULL) AND (candidate_version IS NOT NULL) AND (candidate_digest IS NOT NULL) AND (rollback_plan_id IS NULL) AND (impact_digest IS NULL)) OR ((action = 'rollback'::text) AND (candidate_id IS NULL) AND (candidate_version IS NULL) AND (candidate_digest IS NULL) AND (rollback_plan_id IS NOT NULL) AND (impact_digest IS NOT NULL)))) |
| `write_attempts_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES import_batches(import_batch_id) |
| `write_attempts_import_batch_id_key` | U | UNIQUE (import_batch_id) |
| `write_attempts_pkey` | P | PRIMARY KEY (actor_id, action, operation_id) |
| `write_attempts_publication_policy_check` | C | CHECK ((publication_policy = ANY (ARRAY['approval-v1'::text, 'direct-v1'::text]))) |
| `write_attempts_rollback_plan_id_approval_evidence_version_fkey` | F | FOREIGN KEY (rollback_plan_id, approval_evidence_version) REFERENCES content_intake.review_bindings(rollback_plan_id, evidence_version) |
| `write_attempts_rollback_plan_id_impact_digest_fkey` | F | FOREIGN KEY (rollback_plan_id, impact_digest) REFERENCES content_intake.rollback_plans(rollback_plan_id, impact_digest) |
| `write_attempts_state_check` | C | CHECK ((state = ANY (ARRAY['pending'::text, 'unknown'::text, 'published'::text, 'cancelled'::text, 'failed'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `candidate_one_uncertain_attempt` | CREATE UNIQUE INDEX candidate_one_uncertain_attempt ON content_intake.write_attempts USING btree (candidate_id, candidate_version) WHERE ((action = 'publish'::text) AND (state = ANY (ARRAY['pending'::text, 'unknown'::text]))) |
| `rollback_one_uncertain_attempt` | CREATE UNIQUE INDEX rollback_one_uncertain_attempt ON content_intake.write_attempts USING btree (rollback_plan_id) WHERE ((action = 'rollback'::text) AND (state = ANY (ARRAY['pending'::text, 'unknown'::text]))) |
| `write_attempts_actor_id_action_operation_id_candidate_id_ca_key` | CREATE UNIQUE INDEX write_attempts_actor_id_action_operation_id_candidate_id_ca_key ON content_intake.write_attempts USING btree (actor_id, action, operation_id, candidate_id, candidate_version) |
| `write_attempts_actor_id_action_operation_id_publication_pol_key` | CREATE UNIQUE INDEX write_attempts_actor_id_action_operation_id_publication_pol_key ON content_intake.write_attempts USING btree (actor_id, action, operation_id, publication_policy) |
| `write_attempts_actor_id_action_operation_id_rollback_plan_i_key` | CREATE UNIQUE INDEX write_attempts_actor_id_action_operation_id_rollback_plan_i_key ON content_intake.write_attempts USING btree (actor_id, action, operation_id, rollback_plan_id) |
| `write_attempts_import_batch_id_key` | CREATE UNIQUE INDEX write_attempts_import_batch_id_key ON content_intake.write_attempts USING btree (import_batch_id) |
| `write_attempts_pkey` | CREATE UNIQUE INDEX write_attempts_pkey ON content_intake.write_attempts USING btree (actor_id, action, operation_id) |

## 函数（87）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `adopt_sop_payloads` | `p_actor text, p_job text, p_media jsonb` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `approval_current_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `approval_package_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `assert_family_catalog` | `p_release text` | void | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `authorization_deadline` | `p_principal text, p_action text, p_scope text, p_source text, p_at timestamp with time zone` | timestamp with time zone | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `authorization_sources` | `p_principal text, p_action text, p_at timestamp with time zone` | TABLE(scope_id content_intake.identifier, source_id content_intake.identifier, policy_version content_intake.version, store_set_version content_intake.version, valid_until timestamp with time zone) | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `begin_sop_media_release` | `p_actor text, p_job text, p_media text, p_object text` | jsonb | sql | 是 | `search_path=pg_catalog` | 本仓 |
| `candidate_format_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `candidate_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `candidate_scope_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `complete_sop_media_payload` | `p_actor text, p_job text, p_media text, p_object text` | jsonb | sql | 是 | `search_path=pg_catalog` | 本仓 |
| `complete_sop_media_release` | `p_actor text, p_job text, p_media text, p_object text` | jsonb | sql | 是 | `search_path=pg_catalog` | 本仓 |
| `delete_unused_sop_row` | `p_candidate_id content_intake.identifier, p_version content_intake.version, p_row_id text` | void | plpgsql | 是 | `search_path=content_intake, public, pg_temp` | 本仓 |
| `entitlement_context_guard` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `entitlement_context_required` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `entitlement_lease_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `execute_rollback` | `p_actor text, p_request jsonb, p_observation jsonb` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `finish_shop_directory_transaction` | `p_envelope jsonb` | void | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `freeze_sop_parsed_candidate` | `p_actor text, p_job text, p_material jsonb, p_rows jsonb, p_media jsonb` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `grant_parent_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `grant_version_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `guard_legacy_domains` | `p_domains text[]` | void | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `guard_legacy_write` | `p_batch text, p_target text` | void | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `immutable_history` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `inherit_legacy_catalog` | `p_previous text, p_next text` | void | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `inherit_rollback_reviews` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `input_format_matches` | `p_template text, p_rule text, p_mapping text, p_structure text, p_mime text` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `input_object_format_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `issue_roster_query` | `p_principal_id text, p_tenant_id text, p_app_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `legacy_mode_admission` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `manage_shop_directory_steward` | `p_session_hash text, p_target text, p_expected_version bigint, p_target_facts bigint, p_valid_until timestamp with time zone, p_reason text, p_operation text` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `object_scope_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `parse_format_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `parse_object_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `prepare_shop_directory_read` | `p_session_hash text, p_cursor text, p_limit integer` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `prepare_shop_directory_write` | `p_session_hash text, p_shop text, p_name text, p_expected_revision bigint` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `preview_rollback` | `p_actor text, p_base text, p_target text` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `principal_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `project_feishu_roster` | `p_principal_id text, p_user_id text, p_tenant_id text, p_app_id text, p_identity_scope text, p_person_key text, p_department_ids text[], p_job_id text, p_role text, p_actions text[]` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `project_seat_login` | `p_binding_id text` | text | plpgsql | 是 | `search_path=pg_catalog, pg_temp` | 本仓 |
| `project_sop_release_media` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `publication_family_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `publish_candidate` | `p_actor text, p_request jsonb, p_observation jsonb` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `quality_round_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `quality_state` | `p_candidate text, p_version bigint` | text | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `read_shop_directory` | `p_principal text, p_session_hash text, p_at timestamp with time zone, p_cursor text, p_limit integer, p_cursor_signing_key text, p_outer_deadline timestamp with time zone` | jsonb | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `read_sop_inherited_assets` | `p_actor text, p_job text` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `read_sop_release_assets` | `p_actor text, p_entitlement_hash text, p_session_token_hash text` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `record_policy_history` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `register_sop_candidate_rows` | `p_actor text, p_id text, p_version bigint, p_rows jsonb` | void | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `reserve_sop_media_payload` | `p_actor text, p_job text, p_media text, p_sha text, p_bytes bigint, p_mime text` | jsonb | sql | 是 | `search_path=pg_catalog` | 本仓 |
| `restamp_query_grants` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, pg_temp` | 本仓 |
| `restamp_query_grants_for_policy` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, pg_temp` | 本仓 |
| `review_binding_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `review_package_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `revise_unused_sop_row` | `p_actor text, p_id text, p_version bigint, p_digest text, p_row text` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `role_allows` | `p_role text, p_action text` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `role_may_allocate` | `p_role text` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `role_may_delegate` | `p_role text` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `role_may_skip_import_parent` | `p_role text` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `roster_day_one` | `p_tenant_id text, p_app_id text` | TABLE(policy_version bigint, store_set_version bigint, provenance text, grant_id text, source_id text, roster_job_id text) | sql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `roster_permission_for_user` | `p_user_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `rotate_shop_directory_key` | `p_tenant text, p_app text, p_key_id text, p_material text, p_valid_until timestamp with time zone, p_expected_version bigint, p_reason text, p_operation text` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `seat_administration_allowed` | `p_user_id text` | boolean | sql | 是 | `search_path=pg_catalog, pg_temp` | 本仓 |
| `seat_post_mapping` | `p_post text` | TABLE(out_job_id text, out_role text, out_session_role text) | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `selection_ids_valid` | `ids text[]` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_directory_event_immutable` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_directory_revision_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_directory_session_context` | `p_session_hash text` | jsonb | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_directory_signing_key` | `k content_intake.shop_directory_keys` | text | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_directory_steward_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_display_current_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `shop_display_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `sop_payload_transition` | `p_actor text, p_job text, p_media text, p_object text, p_action text, p_expected jsonb` | jsonb | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `source_format_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `source_scope_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `source_write_lock` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `stage_sop_candidate_assets` | `p_actor text, p_id text, p_version bigint, p_rows jsonb, p_media jsonb` | void | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `stage_sop_candidate_media` | `p_candidate_id content_intake.identifier, p_version content_intake.version, p_source_id content_intake.identifier, p_actor_id content_intake.identifier, p_media_object_id content_intake.identifier, p_sha256 content_intake.sha256, p_bytes bigint, p_mime text, p_sheet text, p_row integer, p_column integer, p_ordinal integer` | void | plpgsql | 是 | `search_path=content_intake, public, pg_temp` | 本仓 |
| `store_set_keep_members` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `ticket_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `upsert_shop_display` | `p_actor text, p_tenant text, p_app text, p_shop text, p_display_name text, p_expected_revision bigint` | jsonb | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `valid_shop_display_name` | `p_name text` | boolean | sql | 否 | `search_path=pg_catalog` | 本仓 |
| `vocabulary_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `vocabulary_scope_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `withdraw_roster_query` | `p_principal_id text, p_tenant_id text, p_app_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `write_attempt_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |

## 触发器（73）

| 触发器 | 表 | 定义 | 状态 |
| --- | --- | --- | --- |
| `approval_pointer` | `approval_current` | CREATE TRIGGER approval_pointer BEFORE DELETE OR UPDATE ON content_intake.approval_current FOR EACH ROW EXECUTE FUNCTION content_intake.approval_current_guard() | 启用 |
| `approval_package` | `approval_facts` | CREATE TRIGGER approval_package BEFORE INSERT ON content_intake.approval_facts FOR EACH ROW EXECUTE FUNCTION content_intake.approval_package_guard() | 启用 |
| `immutable_history` | `approval_facts` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.approval_facts FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `candidate_format` | `candidate_versions` | CREATE TRIGGER candidate_format BEFORE INSERT ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION content_intake.candidate_format_guard() | 启用 |
| `candidate_immutable` | `candidate_versions` | CREATE TRIGGER candidate_immutable BEFORE DELETE OR UPDATE ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION content_intake.candidate_guard() | 启用 |
| `candidate_scope` | `candidate_versions` | CREATE TRIGGER candidate_scope BEFORE INSERT ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION content_intake.candidate_scope_guard() | 启用 |
| `consumer_candidate` | `candidate_versions` | CREATE TRIGGER consumer_candidate BEFORE INSERT OR UPDATE ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard() | 启用 |
| `immutable_history` | `candidate_vocabulary` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.candidate_vocabulary FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `vocabulary_scope` | `candidate_vocabulary` | CREATE TRIGGER vocabulary_scope BEFORE INSERT ON content_intake.candidate_vocabulary FOR EACH ROW EXECUTE FUNCTION content_intake.vocabulary_scope_guard() | 启用 |
| `immutable_history` | `commit_ticket_sources` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.commit_ticket_sources FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `ticket_once` | `commit_tickets` | CREATE TRIGGER ticket_once BEFORE INSERT OR DELETE OR UPDATE ON content_intake.commit_tickets FOR EACH ROW EXECUTE FUNCTION content_intake.ticket_guard() | 启用 |
| `entitlement_context_binding` | `entitlement_contexts` | CREATE TRIGGER entitlement_context_binding BEFORE INSERT ON content_intake.entitlement_contexts FOR EACH ROW EXECUTE FUNCTION content_intake.entitlement_context_guard() | 启用 |
| `immutable_history` | `entitlement_contexts` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.entitlement_contexts FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `entitlement_scopes` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.entitlement_scopes FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `entitlement_context_required` | `entitlements` | CREATE CONSTRAINT TRIGGER entitlement_context_required AFTER INSERT ON content_intake.entitlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION content_intake.entitlement_context_required() | 启用 |
| `entitlement_lease` | `entitlements` | CREATE TRIGGER entitlement_lease BEFORE INSERT ON content_intake.entitlements FOR EACH ROW EXECUTE FUNCTION content_intake.entitlement_lease_guard() | 启用 |
| `immutable_history` | `entitlements` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.entitlements FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `grant_history` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.grant_history FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `consumer_grant` | `grants` | CREATE TRIGGER consumer_grant BEFORE INSERT OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard() | 启用 |
| `grant_history` | `grants` | CREATE TRIGGER grant_history AFTER INSERT OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION content_intake.record_policy_history() | 启用 |
| `grant_parent` | `grants` | CREATE TRIGGER grant_parent BEFORE INSERT ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION content_intake.grant_parent_guard() | 启用 |
| `grant_version` | `grants` | CREATE TRIGGER grant_version BEFORE DELETE OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION content_intake.grant_version_guard() | 启用 |
| `consumer_reservation` | `object_reservations` | CREATE TRIGGER consumer_reservation BEFORE INSERT OR UPDATE ON content_intake.object_reservations FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard() | 启用 |
| `consumer_object` | `objects` | CREATE TRIGGER consumer_object BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard() | 启用 |
| `immutable_history` | `objects` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `input_object_format` | `objects` | CREATE TRIGGER input_object_format BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION content_intake.input_object_format_guard() | 启用 |
| `intake_worker_object_purpose` | `objects` | CREATE TRIGGER intake_worker_object_purpose BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION intake_runtime.worker_object_purpose() | 启用 |
| `object_scope` | `objects` | CREATE TRIGGER object_scope BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION content_intake.object_scope_guard() | 启用 |
| `intake_worker_terminal_only` | `parse_jobs` | CREATE TRIGGER intake_worker_terminal_only BEFORE UPDATE ON content_intake.parse_jobs FOR EACH ROW EXECUTE FUNCTION intake_runtime.worker_terminal_only() | 启用 |
| `parse_format` | `parse_jobs` | CREATE TRIGGER parse_format BEFORE INSERT ON content_intake.parse_jobs FOR EACH ROW EXECUTE FUNCTION content_intake.parse_format_guard() | 启用 |
| `parse_object` | `parse_jobs` | CREATE TRIGGER parse_object BEFORE INSERT OR DELETE OR UPDATE ON content_intake.parse_jobs FOR EACH ROW EXECUTE FUNCTION content_intake.parse_object_guard() | 启用 |
| `restamp_query_grants_for_policy` | `policy_versions` | CREATE TRIGGER restamp_query_grants_for_policy AFTER UPDATE OF version ON content_intake.policy_versions FOR EACH ROW EXECUTE FUNCTION content_intake.restamp_query_grants_for_policy() | 启用 |
| `immutable_history` | `principal_facts` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.principal_facts FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `organization_fact_evidence` | `principal_facts` | CREATE CONSTRAINT TRIGGER organization_fact_evidence AFTER INSERT ON content_intake.principal_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((CURRENT_USER = 'intake_org_writer'::name)) EXECUTE FUNCTION intake_organization.fact_evidence_required() | 启用 |
| `principal_version` | `principals` | CREATE TRIGGER principal_version BEFORE DELETE OR UPDATE ON content_intake.principals FOR EACH ROW EXECUTE FUNCTION content_intake.principal_guard() | 启用 |
| `immutable_history` | `publications` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.publications FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `inherit_rollback_reviews` | `publications` | CREATE TRIGGER inherit_rollback_reviews AFTER INSERT ON content_intake.publications FOR EACH ROW EXECUTE FUNCTION content_intake.inherit_rollback_reviews() | 启用 |
| `publication_family_guard` | `publications` | CREATE TRIGGER publication_family_guard AFTER INSERT ON content_intake.publications FOR EACH ROW EXECUTE FUNCTION content_intake.publication_family_guard() | 启用 |
| `immutable_history` | `quality_plans` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.quality_plans FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `quality_rounds` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.quality_rounds FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `quality_round_guard` | `quality_rounds` | CREATE TRIGGER quality_round_guard BEFORE INSERT ON content_intake.quality_rounds FOR EACH ROW EXECUTE FUNCTION content_intake.quality_round_guard() | 启用 |
| `immutable_history` | `release_catalogs` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.release_catalogs FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `release_lineage` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.release_lineage FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `project_sop_release_media` | `release_lineage` | CREATE TRIGGER project_sop_release_media AFTER INSERT ON content_intake.release_lineage REFERENCING NEW TABLE AS sop_new_lineage FOR EACH STATEMENT EXECUTE FUNCTION content_intake.project_sop_release_media() | 启用 |
| `immutable_history` | `release_revocations` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.release_revocations FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `release_rollback_lineage` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.release_rollback_lineage FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `review_binding_immutable` | `review_bindings` | CREATE TRIGGER review_binding_immutable BEFORE DELETE OR UPDATE ON content_intake.review_bindings FOR EACH ROW EXECUTE FUNCTION content_intake.review_binding_guard() | 启用 |
| `review_package` | `review_bindings` | CREATE TRIGGER review_package BEFORE INSERT ON content_intake.review_bindings FOR EACH ROW EXECUTE FUNCTION content_intake.review_package_guard() | 启用 |
| `immutable_history` | `role_rule_history` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.role_rule_history FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `role_history` | `role_rules` | CREATE TRIGGER role_history AFTER INSERT OR DELETE OR UPDATE ON content_intake.role_rules FOR EACH ROW EXECUTE FUNCTION content_intake.record_policy_history() | 启用 |
| `immutable_history` | `rollback_plans` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.rollback_plans FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `rollback_scopes` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.rollback_scopes FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `scopes` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.scopes FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `shop_directory_key_event_immutable` | `shop_directory_key_events` | CREATE TRIGGER shop_directory_key_event_immutable BEFORE DELETE OR UPDATE ON content_intake.shop_directory_key_events FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_event_immutable() | 启用 |
| `shop_directory_revision_write` | `shop_directory_revisions` | CREATE TRIGGER shop_directory_revision_write BEFORE INSERT OR DELETE OR UPDATE ON content_intake.shop_directory_revisions FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_revision_guard() | 启用 |
| `shop_directory_steward_event_immutable` | `shop_directory_steward_events` | CREATE TRIGGER shop_directory_steward_event_immutable BEFORE DELETE OR UPDATE ON content_intake.shop_directory_steward_events FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_event_immutable() | 启用 |
| `shop_directory_steward_immutable` | `shop_directory_stewards` | CREATE TRIGGER shop_directory_steward_immutable BEFORE INSERT OR DELETE OR UPDATE ON content_intake.shop_directory_stewards FOR EACH ROW EXECUTE FUNCTION content_intake.shop_directory_steward_guard() | 启用 |
| `shop_display_current_write` | `shop_display_current` | CREATE TRIGGER shop_display_current_write BEFORE INSERT OR DELETE OR UPDATE ON content_intake.shop_display_current FOR EACH ROW EXECUTE FUNCTION content_intake.shop_display_current_guard() | 启用 |
| `shop_display_write` | `shop_displays` | CREATE TRIGGER shop_display_write BEFORE INSERT OR DELETE OR UPDATE ON content_intake.shop_displays FOR EACH ROW EXECUTE FUNCTION content_intake.shop_display_guard() | 启用 |
| `immutable_history` | `sop_release_media` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.sop_release_media FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `sop_deletion_history` | `sop_row_deletion_events` | CREATE TRIGGER sop_deletion_history BEFORE DELETE OR UPDATE ON content_intake.sop_row_deletion_events FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `source_confirmations` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.source_confirmations FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `immutable_history` | `source_mappings` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.source_mappings FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `source_format` | `source_mappings` | CREATE TRIGGER source_format BEFORE INSERT ON content_intake.source_mappings FOR EACH ROW EXECUTE FUNCTION content_intake.source_format_guard() | 启用 |
| `legacy_mode_admission` | `sources` | CREATE TRIGGER legacy_mode_admission BEFORE INSERT OR UPDATE ON content_intake.sources FOR EACH ROW EXECUTE FUNCTION content_intake.legacy_mode_admission() | 启用 |
| `source_scope` | `sources` | CREATE TRIGGER source_scope BEFORE UPDATE ON content_intake.sources FOR EACH ROW EXECUTE FUNCTION content_intake.source_scope_guard() | 启用 |
| `source_write_lock` | `sources` | CREATE TRIGGER source_write_lock BEFORE INSERT OR DELETE OR UPDATE ON content_intake.sources FOR EACH STATEMENT EXECUTE FUNCTION content_intake.source_write_lock() | 启用 |
| `restamp_query_grants` | `store_set_current` | CREATE TRIGGER restamp_query_grants AFTER INSERT OR UPDATE OF version ON content_intake.store_set_current FOR EACH ROW EXECUTE FUNCTION content_intake.restamp_query_grants() | 启用 |
| `store_set_keep_members` | `store_set_current` | CREATE TRIGGER store_set_keep_members BEFORE UPDATE OF version ON content_intake.store_set_current FOR EACH ROW EXECUTE FUNCTION content_intake.store_set_keep_members() | 启用 |
| `vocabulary_semantics` | `vocabulary` | CREATE TRIGGER vocabulary_semantics BEFORE UPDATE ON content_intake.vocabulary FOR EACH ROW EXECUTE FUNCTION content_intake.vocabulary_guard() | 启用 |
| `immutable_history` | `vocabulary_displays` | CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON content_intake.vocabulary_displays FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history() | 启用 |
| `consumer_cancel_attempt` | `write_attempts` | CREATE TRIGGER consumer_cancel_attempt BEFORE INSERT OR UPDATE ON content_intake.write_attempts FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard() | 启用 |
| `write_attempt` | `write_attempts` | CREATE TRIGGER write_attempt BEFORE INSERT OR DELETE OR UPDATE ON content_intake.write_attempts FOR EACH ROW EXECUTE FUNCTION content_intake.write_attempt_guard() | 启用 |
