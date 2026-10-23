# schema `public`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（49）

### adoption_events

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `query_id` | `text` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `outcome` | `text` | 否 |  |  |
| `chosen_rank` | `integer` | 是 |  |  |
| `chosen_script_id` | `text` | 是 |  |  |
| `push_method` | `text` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `adoption_adopted_requires_success` | C | CHECK (((outcome <> 'adopted'::text) OR ((push_method IS NOT NULL) AND (push_method = ANY (ARRAY['clipboard'::text, 'autofill'::text]))))) |
| `adoption_candidate_fk` | F | FOREIGN KEY (query_id, chosen_rank, chosen_script_id) REFERENCES candidate_impressions(query_id, rank, script_id) |
| `adoption_choice_shape` | C | CHECK ((((outcome = 'adopted'::text) AND (chosen_rank IS NOT NULL) AND (chosen_script_id IS NOT NULL)) OR ((outcome <> 'adopted'::text) AND (chosen_rank IS NULL) AND (chosen_script_id IS NULL)))) |
| `adoption_events_chosen_rank_check` | C | CHECK (((chosen_rank IS NULL) OR ((chosen_rank >= 1) AND (chosen_rank <= 3)))) |
| `adoption_events_outcome_check` | C | CHECK ((outcome = ANY (ARRAY['adopted'::text, 'dismissed'::text, 'no_hit_exit'::text, 'timeout'::text]))) |
| `adoption_events_pkey` | P | PRIMARY KEY (query_id) |
| `adoption_events_push_method_check` | C | CHECK (((push_method IS NULL) OR (push_method = ANY (ARRAY['clipboard'::text, 'autofill'::text, 'failed'::text, 'pending'::text])))) |
| `adoption_query_owner_fk` | F | FOREIGN KEY (query_id, user_id) REFERENCES query_events(query_id, user_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `adoption_events_pkey` | CREATE UNIQUE INDEX adoption_events_pkey ON public.adoption_events USING btree (query_id) |
| `uq_adoption_copy_provenance` | CREATE UNIQUE INDEX uq_adoption_copy_provenance ON public.adoption_events USING btree (query_id, user_id, outcome, push_method) |

### announcements

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `announcement_id` | `text` | 否 |  |  |
| `release_id` | `text` | 否 |  |  |
| `title` | `text` | 否 |  |  |
| `summary` | `text` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `announcement_release_identity` | U | UNIQUE (announcement_id, release_id) |
| `announcements_pkey` | P | PRIMARY KEY (announcement_id) |
| `announcements_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `announcement_release_identity` | CREATE UNIQUE INDEX announcement_release_identity ON public.announcements USING btree (announcement_id, release_id) |
| `announcements_pkey` | CREATE UNIQUE INDEX announcements_pkey ON public.announcements USING btree (announcement_id) |
| `idx_announcements_release` | CREATE INDEX idx_announcements_release ON public.announcements USING btree (release_id) |

### app_users

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `user_id` | `text` | 否 |  |  |
| `feishu_open_id` | `text` | 是 |  |  |
| `display_name` | `text` | 是 |  |  |
| `role` | `text` | 否 |  |  |
| `is_active` | `boolean` | 否 | `true` |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `app_users_feishu_open_id_key` | U | UNIQUE (feishu_open_id) |
| `app_users_pkey` | P | PRIMARY KEY (user_id) |
| `app_users_role_check` | C | CHECK ((role = ANY (ARRAY['agent'::text, 'coach'::text, 'owner'::text, 'system'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `app_users_feishu_open_id_key` | CREATE UNIQUE INDEX app_users_feishu_open_id_key ON public.app_users USING btree (feishu_open_id) |
| `app_users_pkey` | CREATE UNIQUE INDEX app_users_pkey ON public.app_users USING btree (user_id) |

### authoritative_source_suspensions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `suspension_id` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `reason_code` | `text` | 否 |  |  |
| `evidence_ref` | `text` | 否 |  |  |
| `suspended_by` | `text` | 否 |  |  |
| `suspended_by_role` | `text` | 否 |  |  |
| `suspended_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `authoritative_source_suspensions_evidence_ref_check` | C | CHECK ((btrim(evidence_ref) <> ''::text)) |
| `authoritative_source_suspensions_pkey` | P | PRIMARY KEY (suspension_id) |
| `authoritative_source_suspensions_reason_code_check` | C | CHECK ((reason_code = ANY (ARRAY['SOURCE_REVOKED'::text, 'SOURCE_COMPROMISED'::text, 'SOURCE_EXPIRED'::text, 'SOURCE_REPLACED'::text]))) |
| `authoritative_source_suspensions_source_version_id_fkey` | F | FOREIGN KEY (source_version_id) REFERENCES authoritative_source_versions(source_version_id) |
| `authoritative_source_suspensions_source_version_id_key` | U | UNIQUE (source_version_id) |
| `authoritative_source_suspensions_suspended_by_check` | C | CHECK ((btrim(suspended_by) <> ''::text)) |
| `authoritative_source_suspensions_suspended_by_role_check` | C | CHECK ((suspended_by_role = 'owner'::text)) |
| `authoritative_source_suspensions_suspension_id_check` | C | CHECK ((suspension_id ~ '^susp_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `authoritative_source_suspensions_pkey` | CREATE UNIQUE INDEX authoritative_source_suspensions_pkey ON public.authoritative_source_suspensions USING btree (suspension_id) |
| `authoritative_source_suspensions_source_version_id_key` | CREATE UNIQUE INDEX authoritative_source_suspensions_source_version_id_key ON public.authoritative_source_suspensions USING btree (source_version_id) |

### authoritative_source_versions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `text` | 否 | `'default'::text` |  |
| `source_version_id` | `text` | 否 |  |  |
| `source_ref` | `text` | 否 |  |  |
| `domain` | `text` | 否 |  |  |
| `upstream_version` | `text` | 否 |  |  |
| `snapshot_sha256` | `text` | 否 |  |  |
| `use_class` | `text` | 否 |  |  |
| `owner_role` | `text` | 否 |  |  |
| `approval_evd` | `text` | 否 |  |  |
| `approved_by` | `text` | 否 |  |  |
| `approved_at` | `timestamp with time zone` | 否 |  |  |
| `review_due_at` | `timestamp with time zone` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `authoritative_source_alias_version_unique` | U | UNIQUE (tenant_id, source_ref, upstream_version) |
| `authoritative_source_review_window` | C | CHECK ((review_due_at >= approved_at)) |
| `authoritative_source_version_alias_unique` | U | UNIQUE (source_version_id, domain, source_ref) |
| `authoritative_source_version_domain_unique` | U | UNIQUE (source_version_id, domain) |
| `authoritative_source_versions_approval_evd_check` | C | CHECK ((btrim(approval_evd) <> ''::text)) |
| `authoritative_source_versions_approved_by_check` | C | CHECK ((btrim(approved_by) <> ''::text)) |
| `authoritative_source_versions_domain_check` | C | CHECK ((domain = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text]))) |
| `authoritative_source_versions_owner_role_check` | C | CHECK ((btrim(owner_role) <> ''::text)) |
| `authoritative_source_versions_pkey` | P | PRIMARY KEY (source_version_id) |
| `authoritative_source_versions_snapshot_sha256_check` | C | CHECK ((snapshot_sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `authoritative_source_versions_source_ref_check` | C | CHECK ((source_ref ~ '^SRC-[A-Z0-9][A-Z0-9._-]{0,126}$'::text)) |
| `authoritative_source_versions_source_version_id_check` | C | CHECK ((source_version_id ~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `authoritative_source_versions_tenant_id_check` | C | CHECK ((btrim(tenant_id) <> ''::text)) |
| `authoritative_source_versions_upstream_version_check` | C | CHECK ((btrim(upstream_version) <> ''::text)) |
| `authoritative_source_versions_use_class_check` | C | CHECK ((use_class = ANY (ARRAY['canonical'::text, 'reference'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `authoritative_source_alias_version_unique` | CREATE UNIQUE INDEX authoritative_source_alias_version_unique ON public.authoritative_source_versions USING btree (tenant_id, source_ref, upstream_version) |
| `authoritative_source_version_alias_unique` | CREATE UNIQUE INDEX authoritative_source_version_alias_unique ON public.authoritative_source_versions USING btree (source_version_id, domain, source_ref) |
| `authoritative_source_version_domain_unique` | CREATE UNIQUE INDEX authoritative_source_version_domain_unique ON public.authoritative_source_versions USING btree (source_version_id, domain) |
| `authoritative_source_versions_pkey` | CREATE UNIQUE INDEX authoritative_source_versions_pkey ON public.authoritative_source_versions USING btree (source_version_id) |

### candidate_impressions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `query_id` | `text` | 否 |  |  |
| `rank` | `integer` | 否 |  |  |
| `release_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `script_version` | `integer` | 否 |  |  |
| `content_hash` | `text` | 否 |  |  |
| `score` | `double precision` | 是 |  |  |
| `client_snapshot_release_id` | `text` | 是 |  | 客户端上报时本机快照的 release。与 release_id 不同 = 坐席看到的是旧版本内容（漂移行）。不加外键：该版本可能已被清理，而这类行正是需要保留的证据。 |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `candidate_client_snapshot_shape` | C | CHECK (((client_snapshot_release_id IS NULL) OR (client_snapshot_release_id ~ '^rel_[0-9]+$'::text))) |
| `candidate_impressions_pkey` | P | PRIMARY KEY (query_id, rank) |
| `candidate_impressions_query_id_fkey` | F | FOREIGN KEY (query_id) REFERENCES query_events(query_id) |
| `candidate_impressions_rank_check` | C | CHECK (((rank >= 1) AND (rank <= 3))) |
| `candidate_query_release_fk` | F | FOREIGN KEY (query_id, release_id) REFERENCES query_events(query_id, release_id) |
| `candidate_release_item_fk` | F | FOREIGN KEY (release_id, script_id) REFERENCES release_items(release_id, script_id) |
| `candidate_release_item_provenance_fk` | F | FOREIGN KEY (release_id, script_id, script_version, content_hash) REFERENCES release_items(release_id, script_id, script_version, content_hash) |

索引：

| 名称 | 定义 |
| --- | --- |
| `candidate_impressions_pkey` | CREATE UNIQUE INDEX candidate_impressions_pkey ON public.candidate_impressions USING btree (query_id, rank) |
| `idx_candidate_client_snapshot_drift` | CREATE INDEX idx_candidate_client_snapshot_drift ON public.candidate_impressions USING btree (client_snapshot_release_id) WHERE (client_snapshot_release_id IS DISTINCT FROM release_id) |
| `uq_candidate_query_rank_script` | CREATE UNIQUE INDEX uq_candidate_query_rank_script ON public.candidate_impressions USING btree (query_id, rank, script_id) |

### change_audits

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `change_id` | `text` | 否 |  |  |
| `script_id` | `text` | 是 |  |  |
| `action` | `text` | 否 |  |  |
| `before_hash` | `text` | 是 |  |  |
| `after_hash` | `text` | 是 |  |  |
| `actor_role` | `text` | 是 |  |  |
| `actor_user_id` | `text` | 是 |  |  |
| `source` | `text` | 是 |  |  |
| `metadata` | `jsonb` | 否 | `'{}'::jsonb` |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `change_audits_pkey` | P | PRIMARY KEY (change_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `change_audits_pkey` | CREATE UNIQUE INDEX change_audits_pkey ON public.change_audits USING btree (change_id) |

### client_sync_state

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `client_id` | `text` | 否 |  |  |
| `user_id` | `text` | 是 |  |  |
| `last_seen_release_id` | `text` | 是 |  |  |
| `last_seen_release_seq` | `bigint` | 是 |  |  |
| `last_seen_source_binding_hash` | `text` | 是 |  |  |
| `last_ack_lease_token_hash` | `text` | 是 |  |  |
| `last_ack_at` | `timestamp with time zone` | 是 |  |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `client_sync_lease_shape` | C | CHECK ((((last_seen_release_id IS NULL) AND (last_seen_release_seq IS NULL) AND (last_seen_source_binding_hash IS NULL) AND (last_ack_lease_token_hash IS NULL)) OR ((user_id IS NOT NULL) AND (last_seen_release_id IS NOT NULL) AND (last_seen_release_seq IS NOT NULL) AND (last_seen_source_binding_hash ~ '^[0-9a-f]{64}$'::text) AND (last_ack_lease_token_hash ~ '^[0-9a-f]{64}$'::text)))) |
| `client_sync_lease_token_fk` | F | FOREIGN KEY (last_ack_lease_token_hash) REFERENCES snapshot_offline_leases(lease_token_hash) |
| `client_sync_release_pair_fk` | F | FOREIGN KEY (last_seen_release_id, last_seen_release_seq) REFERENCES content_releases(release_id, release_seq) |
| `client_sync_release_pair_shape` | C | CHECK ((((last_seen_release_id IS NULL) AND (last_seen_release_seq IS NULL)) OR ((last_seen_release_id IS NOT NULL) AND (last_seen_release_seq IS NOT NULL)))) |
| `client_sync_source_binding_fk` | F | FOREIGN KEY (last_seen_release_id, last_seen_source_binding_hash) REFERENCES content_releases(release_id, source_binding_hash) |
| `client_sync_state_pkey` | P | PRIMARY KEY (client_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `client_sync_state_pkey` | CREATE UNIQUE INDEX client_sync_state_pkey ON public.client_sync_state USING btree (client_id) |

### content_current

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `id` | `integer` | 否 |  |  |
| `current_release_id` | `text` | 否 |  |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `content_current_current_release_id_fkey` | F | FOREIGN KEY (current_release_id) REFERENCES content_releases(release_id) |
| `content_current_id_check` | C | CHECK ((id = 1)) |
| `content_current_pkey` | P | PRIMARY KEY (id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `content_current_pkey` | CREATE UNIQUE INDEX content_current_pkey ON public.content_current USING btree (id) |

### content_quality_review_evidence

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `plan_id` | `text` | 否 |  |  |
| `import_batch_id` | `text` | 否 |  |  |
| `population_manifest_hash` | `text` | 否 |  |  |
| `initial_sample_reviewed_count` | `integer` | 否 |  |  |
| `initial_defect_count` | `integer` | 否 |  |  |
| `expanded_sample_reviewed_count` | `integer` | 是 |  |  |
| `expanded_defect_count` | `integer` | 是 |  |  |
| `mandatory_reviewed_count` | `integer` | 否 |  |  |
| `mandatory_defect_count` | `integer` | 否 |  |  |
| `publishable_clean_count` | `integer` | 否 |  |  |
| `review_quarantined_count` | `integer` | 否 |  |  |
| `conclusion` | `text` | 否 |  |  |
| `evidence_ref` | `text` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `content_quality_review_evide_initial_sample_reviewed_coun_check` | C | CHECK ((initial_sample_reviewed_count >= 0)) |
| `content_quality_review_evidence_check` | C | CHECK (((initial_defect_count >= 0) AND (initial_defect_count <= initial_sample_reviewed_count))) |
| `content_quality_review_evidence_check1` | C | CHECK (((mandatory_defect_count >= 0) AND (mandatory_defect_count <= mandatory_reviewed_count))) |
| `content_quality_review_evidence_conclusion_check` | C | CHECK ((conclusion = ANY (ARRAY['passed'::text, 'blocked'::text]))) |
| `content_quality_review_evidence_evidence_ref_check` | C | CHECK ((btrim(evidence_ref) <> ''::text)) |
| `content_quality_review_evidence_mandatory_reviewed_count_check` | C | CHECK ((mandatory_reviewed_count >= 0)) |
| `content_quality_review_evidence_pkey` | P | PRIMARY KEY (plan_id) |
| `content_quality_review_evidence_plan_id_fkey` | F | FOREIGN KEY (plan_id) REFERENCES content_quality_review_plans(plan_id) |
| `content_quality_review_evidence_population_manifest_hash_check` | C | CHECK ((population_manifest_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_quality_review_evidence_publishable_clean_count_check` | C | CHECK ((publishable_clean_count >= 0)) |
| `content_quality_review_evidence_review_quarantined_count_check` | C | CHECK ((review_quarantined_count >= 0)) |
| `quality_evidence_expansion_pair` | C | CHECK ((((expanded_sample_reviewed_count IS NULL) AND (expanded_defect_count IS NULL)) OR ((expanded_sample_reviewed_count IS NOT NULL) AND (expanded_sample_reviewed_count >= 0) AND (expanded_defect_count IS NOT NULL) AND (expanded_defect_count >= 0) AND (expanded_defect_count <= expanded_sample_reviewed_count)))) |
| `quality_evidence_population_fk` | F | FOREIGN KEY (plan_id, import_batch_id, population_manifest_hash) REFERENCES content_quality_review_plans(plan_id, import_batch_id, population_manifest_hash) |
| `quality_evidence_population_manifest_shape` | C | CHECK ((population_manifest_hash ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `content_quality_review_evidence_pkey` | CREATE UNIQUE INDEX content_quality_review_evidence_pkey ON public.content_quality_review_evidence USING btree (plan_id) |

### content_quality_review_plans

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `plan_id` | `text` | 否 |  |  |
| `import_batch_id` | `text` | 否 |  |  |
| `sampling_policy_version` | `text` | 否 |  |  |
| `cutoff_at` | `timestamp with time zone` | 否 |  |  |
| `clean_population_count` | `integer` | 否 |  |  |
| `ordinary_population_count` | `integer` | 否 |  |  |
| `mandatory_full_review_count` | `integer` | 否 |  |  |
| `initial_sample_target` | `integer` | 否 |  |  |
| `expanded_sample_target` | `integer` | 否 |  |  |
| `selection_seed_hash` | `text` | 否 |  |  |
| `selection_manifest_hash` | `text` | 否 |  |  |
| `population_manifest_hash` | `text` | 否 |  |  |
| `selection_algorithm` | `text` | 否 |  |  |
| `frozen_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `content_quality_review_plans_clean_population_count_check` | C | CHECK (((clean_population_count >= 0) AND (clean_population_count <= 5000))) |
| `content_quality_review_plans_expanded_sample_target_check` | C | CHECK ((expanded_sample_target >= 0)) |
| `content_quality_review_plans_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES import_batches(import_batch_id) |
| `content_quality_review_plans_import_batch_id_key` | U | UNIQUE (import_batch_id) |
| `content_quality_review_plans_initial_sample_target_check` | C | CHECK ((initial_sample_target >= 0)) |
| `content_quality_review_plans_mandatory_full_review_count_check` | C | CHECK ((mandatory_full_review_count >= 0)) |
| `content_quality_review_plans_ordinary_population_count_check` | C | CHECK ((ordinary_population_count >= 0)) |
| `content_quality_review_plans_pkey` | P | PRIMARY KEY (plan_id) |
| `content_quality_review_plans_plan_id_check` | C | CHECK ((plan_id ~ '^qplan_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `content_quality_review_plans_population_manifest_hash_check` | C | CHECK ((population_manifest_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_quality_review_plans_sampling_policy_version_check` | C | CHECK ((btrim(sampling_policy_version) <> ''::text)) |
| `content_quality_review_plans_selection_algorithm_check` | C | CHECK ((selection_algorithm = 'sha256-ranked-v1'::text)) |
| `content_quality_review_plans_selection_manifest_hash_check` | C | CHECK ((selection_manifest_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_quality_review_plans_selection_seed_hash_check` | C | CHECK ((selection_seed_hash ~ '^[0-9a-f]{64}$'::text)) |
| `quality_plan_expanded_target` | C | CHECK ((expanded_sample_target = CASE WHEN (ordinary_population_count <= 500) THEN ordinary_population_count ELSE (ceil(((ordinary_population_count)::numeric * 0.30)))::integer END)) |
| `quality_plan_frozen_after_cutoff` | C | CHECK ((frozen_at >= cutoff_at)) |
| `quality_plan_initial_target` | C | CHECK ((initial_sample_target = CASE WHEN (ordinary_population_count <= 500) THEN ordinary_population_count ELSE LEAST(300, GREATEST(100, (ceil(((ordinary_population_count)::numeric * 0.10)))::integer)) END)) |
| `quality_plan_manifest_identity` | U | UNIQUE (plan_id, import_batch_id, population_manifest_hash) |
| `quality_plan_population_manifest_shape` | C | CHECK ((population_manifest_hash ~ '^[0-9a-f]{64}$'::text)) |
| `quality_plan_population_partition` | C | CHECK ((clean_population_count = (ordinary_population_count + mandatory_full_review_count))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `content_quality_review_plans_import_batch_id_key` | CREATE UNIQUE INDEX content_quality_review_plans_import_batch_id_key ON public.content_quality_review_plans USING btree (import_batch_id) |
| `content_quality_review_plans_pkey` | CREATE UNIQUE INDEX content_quality_review_plans_pkey ON public.content_quality_review_plans USING btree (plan_id) |
| `quality_plan_manifest_identity` | CREATE UNIQUE INDEX quality_plan_manifest_identity ON public.content_quality_review_plans USING btree (plan_id, import_batch_id, population_manifest_hash) |

### content_releases

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `release_seq` | `bigint` | 否 |  |  |
| `title` | `text` | 是 |  |  |
| `summary` | `text` | 是 |  |  |
| `import_batch_id` | `text` | 是 |  |  |
| `rollback_of_release_id` | `text` | 是 |  |  |
| `status` | `text` | 否 |  |  |
| `source_binding_hash` | `text` | 否 |  |  |
| `published_by` | `text` | 是 |  |  |
| `published_by_role` | `text` | 是 |  |  |
| `published_at` | `timestamp with time zone` | 否 | `now()` |  |
| `tenant_id` | `text` | 否 | `'default'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `content_releases_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES import_batches(import_batch_id) |
| `content_releases_pkey` | P | PRIMARY KEY (release_id) |
| `content_releases_release_seq_key` | U | UNIQUE (release_seq) |
| `content_releases_rollback_of_release_id_fkey` | F | FOREIGN KEY (rollback_of_release_id) REFERENCES content_releases(release_id) |
| `content_releases_source_binding_hash_check` | C | CHECK ((source_binding_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_releases_status_check` | C | CHECK ((status = ANY (ARRAY['published'::text, 'superseded'::text, 'rolled_back'::text]))) |
| `release_source_set_complete` | t | TRIGGER DEFERRABLE INITIALLY DEFERRED |

索引：

| 名称 | 定义 |
| --- | --- |
| `content_releases_pkey` | CREATE UNIQUE INDEX content_releases_pkey ON public.content_releases USING btree (release_id) |
| `content_releases_release_seq_key` | CREATE UNIQUE INDEX content_releases_release_seq_key ON public.content_releases USING btree (release_seq) |
| `idx_release_seq` | CREATE INDEX idx_release_seq ON public.content_releases USING btree (release_seq) |
| `uq_release_id_seq` | CREATE UNIQUE INDEX uq_release_id_seq ON public.content_releases USING btree (release_id, release_seq) |
| `uq_release_source_binding_hash` | CREATE UNIQUE INDEX uq_release_source_binding_hash ON public.content_releases USING btree (release_id, source_binding_hash) |

### content_review_decisions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `decision_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `content_hash` | `text` | 否 |  |  |
| `reviewer_role` | `text` | 否 |  |  |
| `reviewer_subject_hash` | `text` | 否 |  |  |
| `reviewer_subject_key_version` | `text` | 否 |  |  |
| `evidence_ref` | `text` | 否 |  |  |
| `decision` | `text` | 否 |  |  |
| `decided_at` | `timestamp with time zone` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `content_review_decisions_content_hash_check` | C | CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_review_decisions_decision_check` | C | CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text]))) |
| `content_review_decisions_decision_id_check` | C | CHECK ((decision_id ~ '^crd_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `content_review_decisions_evidence_ref_check` | C | CHECK ((btrim(evidence_ref) <> ''::text)) |
| `content_review_decisions_pkey` | P | PRIMARY KEY (decision_id) |
| `content_review_decisions_reviewer_role_check` | C | CHECK ((reviewer_role = ANY (ARRAY['ROLE-CONTENT-LEAD'::text, 'ROLE-CS-MANAGER'::text]))) |
| `content_review_decisions_reviewer_subject_hash_check` | C | CHECK ((reviewer_subject_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_review_decisions_reviewer_subject_key_version_check` | C | CHECK ((reviewer_subject_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text)) |
| `content_review_decisions_script_id_check` | C | CHECK ((btrim(script_id) <> ''::text)) |
| `content_review_role_once` | U | UNIQUE (script_id, content_hash, reviewer_role) |

索引：

| 名称 | 定义 |
| --- | --- |
| `content_review_decisions_pkey` | CREATE UNIQUE INDEX content_review_decisions_pkey ON public.content_review_decisions USING btree (decision_id) |
| `content_review_role_once` | CREATE UNIQUE INDEX content_review_role_once ON public.content_review_decisions USING btree (script_id, content_hash, reviewer_role) |

### escalate_actions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `escalate_id` | `text` | 否 |  |  |
| `query_id` | `text` | 否 |  |  |
| `action` | `text` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `escalate_actions_action_check` | C | CHECK ((action = ANY (ARRAY['open_feishu'::text, 'copy_contact'::text, 'other'::text]))) |
| `escalate_actions_pkey` | P | PRIMARY KEY (escalate_id) |
| `escalate_actions_query_id_fkey` | F | FOREIGN KEY (query_id) REFERENCES query_events(query_id) |
| `escalate_query_action_unique` | U | UNIQUE (query_id, action) |
| `escalate_query_owner_fk` | F | FOREIGN KEY (query_id, user_id) REFERENCES query_events(query_id, user_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `escalate_actions_pkey` | CREATE UNIQUE INDEX escalate_actions_pkey ON public.escalate_actions USING btree (escalate_id) |
| `escalate_query_action_unique` | CREATE UNIQUE INDEX escalate_query_action_unique ON public.escalate_actions USING btree (query_id, action) |

### idempotency_keys

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `scope` | `text` | 否 |  |  |
| `idem_key` | `text` | 否 |  |  |
| `user_id` | `text` | 是 |  |  |
| `request_hash` | `text` | 否 |  |  |
| `request_hash_key_version` | `text` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `status_code` | `integer` | 是 |  |  |
| `response_body` | `jsonb` | 是 |  |  |
| `lease_owner` | `text` | 是 |  |  |
| `lease_version` | `bigint` | 否 | `1` |  |
| `lease_expires_at` | `timestamp with time zone` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |
| `expires_at` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `idempotency_keys_pkey` | P | PRIMARY KEY (scope, idem_key) |
| `idempotency_keys_status_check` | C | CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idempotency_keys_pkey` | CREATE UNIQUE INDEX idempotency_keys_pkey ON public.idempotency_keys USING btree (scope, idem_key) |
| `idx_idem_expires` | CREATE INDEX idx_idem_expires ON public.idempotency_keys USING btree (expires_at) |
| `idx_idem_status` | CREATE INDEX idx_idem_status ON public.idempotency_keys USING btree (status) |

### import_batch_source_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `import_batch_id` | `text` | 否 |  |  |
| `domain` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `import_batch_source_binding_triple_unique` | U | UNIQUE (import_batch_id, domain, source_version_id) |
| `import_batch_source_bindings_domain_check` | C | CHECK ((domain = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text]))) |
| `import_batch_source_bindings_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES import_batches(import_batch_id) |
| `import_batch_source_bindings_pkey` | P | PRIMARY KEY (import_batch_id, domain) |
| `import_batch_source_version_fk` | F | FOREIGN KEY (source_version_id, domain) REFERENCES authoritative_source_versions(source_version_id, domain) |

索引：

| 名称 | 定义 |
| --- | --- |
| `import_batch_source_binding_triple_unique` | CREATE UNIQUE INDEX import_batch_source_binding_triple_unique ON public.import_batch_source_bindings USING btree (import_batch_id, domain, source_version_id) |
| `import_batch_source_bindings_pkey` | CREATE UNIQUE INDEX import_batch_source_bindings_pkey ON public.import_batch_source_bindings USING btree (import_batch_id, domain) |

### import_batches

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `import_batch_id` | `text` | 否 |  |  |
| `source_type` | `text` | 否 |  |  |
| `source_ref` | `text` | 是 |  |  |
| `source_sha256` | `text` | 是 |  |  |
| `source_size_bytes` | `bigint` | 是 |  |  |
| `base_release_id` | `text` | 是 |  |  |
| `source_binding_hash` | `text` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `quality_gate_passed` | `boolean` | 否 | `false` |  |
| `clean_count` | `integer` | 否 | `0` |  |
| `quarantined_count` | `integer` | 否 | `0` |  |
| `error_report` | `jsonb` | 是 |  |  |
| `actor_user_id` | `text` | 是 |  |  |
| `actor_role` | `text` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `finished_at` | `timestamp with time zone` | 是 |  |  |
| `tenant_id` | `text` | 否 | `'default'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `import_batch_base_release_fk` | F | FOREIGN KEY (base_release_id) REFERENCES content_releases(release_id) |
| `import_batch_error_report_shape` | C | CHECK (((((status = 'failed'::text) AND (error_report IS NOT NULL) AND (jsonb_typeof(error_report) = 'object'::text) AND (error_report ?& ARRAY['code'::text, 'diagnostic_id'::text]) AND ((error_report ->> 'code'::text) = ANY (ARRAY['CANCELLED'::text, 'MAX_ATTEMPTS_EXHAUSTED'::text, 'VALIDATION_FAILED'::text, 'SOURCE_UNREADABLE'::text, 'HASH_MISMATCH'::text, 'UNSUPPORTED_FORMAT'::text, 'STORAGE_UNAVAILABLE'::text, 'SOURCE_NOT_ELIGIBLE'::text, 'SOURCE_SUSPENDED'::text, 'SOURCE_DOMAIN_MISMATCH'::text, 'SOURCE_SNAPSHOT_MISMATCH'::text, 'SOURCE_SET_INCOMPLETE'::text, 'CONTENT_CONTRACT_INVALID'::text, 'GOVERNANCE_HASH_MISMATCH'::text])) AND (COALESCE((error_report ->> 'diagnostic_id'::text), ''::text) ~ '^diag_[0-9a-f]{32}$'::text) AND ((((error_report ->> 'code'::text) = 'CANCELLED'::text) AND ((error_report - ARRAY['code'::text, 'diagnostic_id'::text]) = '{}'::jsonb)) OR (((error_report ->> 'code'::text) = 'MAX_ATTEMPTS_EXHAUSTED'::text) AND (error_report ?& ARRAY['attempts'::text, 'max_attempts'::text]) AND ((error_report - ARRAY['code'::text, 'diagnostic_id'::text, 'attempts'::text, 'max_attempts'::text]) = '{}'::jsonb) AND (jsonb_typeof((error_report -> 'attempts'::text)) = 'number'::text) AND ((error_report ->> 'attempts'::text) ~ '^[1-9][0-9]{0,8}$'::text) AND (jsonb_typeof((error_report -> 'max_attempts'::text)) = 'number'::text) AND ((error_report ->> 'max_attempts'::text) ~ '^[1-9][0-9]{0,8}$'::text)) OR (((error_report ->> 'code'::text) = ANY (ARRAY['VALIDATION_FAILED'::text, 'SOURCE_UNREADABLE'::text, 'HASH_MISMATCH'::text, 'UNSUPPORTED_FORMAT'::text, 'STORAGE_UNAVAILABLE'::text, 'SOURCE_NOT_ELIGIBLE'::text, 'SOURCE_SUSPENDED'::text, 'SOURCE_DOMAIN_MISMATCH'::text, 'SOURCE_SNAPSHOT_MISMATCH'::text, 'SOURCE_SET_INCOMPLETE'::text, 'CONTENT_CONTRACT_INVALID'::text, 'GOVERNANCE_HASH_MISMATCH'::text])) AND ((error_report - ARRAY['code'::text, 'diagnostic_id'::text, 'row'::text, 'column'::text, 'error_count'::text, 'issue_codes'::text]) = '{}'::jsonb) AND CASE WHEN (error_report ? 'row'::text) THEN ((jsonb_typeof((error_report -> 'row'::text)) = 'number'::text) AND ((error_report ->> 'row'::text) ~ '^[1-9][0-9]{0,8}$'::text)) ELSE true END AND CASE WHEN (error_report ? 'column'::text) THEN ((jsonb_typeof((error_report -> 'column'::text)) = 'number'::text) AND ((error_report ->> 'column'::text) ~ '^[1-9][0-9]{0,8}$'::text)) ELSE true END AND CASE WHEN (error_report ? 'error_count'::text) THEN ((jsonb_typeof((error_report -> 'error_count'::text)) = 'number'::text) AND ((error_report ->> 'error_count'::text) ~ '^[1-9][0-9]{0,8}$'::text)) ELSE true END AND import_issue_codes_are_public((error_report -> 'issue_codes'::text))))) IS TRUE) OR (((status <> 'failed'::text) AND (error_report IS NULL)) IS TRUE))) |
| `import_batches_clean_count_check` | C | CHECK ((clean_count >= 0)) |
| `import_batches_pkey` | P | PRIMARY KEY (import_batch_id) |
| `import_batches_quarantined_count_check` | C | CHECK ((quarantined_count >= 0)) |
| `import_batches_source_binding_hash_check` | C | CHECK ((source_binding_hash ~ '^[0-9a-f]{64}$'::text)) |
| `import_batches_source_size_bytes_check` | C | CHECK (((source_size_bytes IS NULL) OR (source_size_bytes >= 0))) |
| `import_batches_source_type_check` | C | CHECK ((source_type = ANY (ARRAY['excel'::text, 'csv'::text, 'feishu_api'::text, 'seed'::text, 'other'::text]))) |
| `import_batches_status_check` | C | CHECK ((status = ANY (ARRAY['validating'::text, 'failed'::text, 'staged'::text, 'publishing'::text, 'published'::text, 'rolled_back'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `import_batches_pkey` | CREATE UNIQUE INDEX import_batches_pkey ON public.import_batches USING btree (import_batch_id) |

### intent_taxonomy_entries

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `intent_taxonomy_version` | `text` | 否 |  |  |
| `intent_id` | `text` | 否 |  |  |
| `label` | `text` | 否 |  |  |
| `lifecycle` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `intent_taxonomy_entries_intent_id_check` | C | CHECK ((intent_id ~ '^intent_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `intent_taxonomy_entries_intent_taxonomy_version_fkey` | F | FOREIGN KEY (intent_taxonomy_version) REFERENCES intent_taxonomy_versions(intent_taxonomy_version) |
| `intent_taxonomy_entries_label_check` | C | CHECK ((btrim(label) <> ''::text)) |
| `intent_taxonomy_entries_lifecycle_check` | C | CHECK ((lifecycle = ANY (ARRAY['active'::text, 'deprecated'::text]))) |
| `intent_taxonomy_entries_pkey` | P | PRIMARY KEY (intent_taxonomy_version, intent_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `intent_taxonomy_entries_pkey` | CREATE UNIQUE INDEX intent_taxonomy_entries_pkey ON public.intent_taxonomy_entries USING btree (intent_taxonomy_version, intent_id) |

### intent_taxonomy_mappings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `mapping_id` | `text` | 否 |  |  |
| `from_taxonomy_version` | `text` | 否 |  |  |
| `from_intent_id` | `text` | 否 |  |  |
| `to_taxonomy_version` | `text` | 否 |  |  |
| `to_intent_id` | `text` | 否 |  |  |
| `mapping_type` | `text` | 否 |  |  |
| `approval_evd` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `intent_taxonomy_mapping_not_identity` | C | CHECK (((from_taxonomy_version IS DISTINCT FROM to_taxonomy_version) OR (from_intent_id IS DISTINCT FROM to_intent_id))) |
| `intent_taxonomy_mapping_source_fk` | F | FOREIGN KEY (from_taxonomy_version, from_intent_id) REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id) |
| `intent_taxonomy_mapping_target_fk` | F | FOREIGN KEY (to_taxonomy_version, to_intent_id) REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id) |
| `intent_taxonomy_mapping_unique` | U | UNIQUE (from_taxonomy_version, from_intent_id, to_taxonomy_version, to_intent_id, mapping_type) |
| `intent_taxonomy_mappings_approval_evd_check` | C | CHECK ((btrim(approval_evd) <> ''::text)) |
| `intent_taxonomy_mappings_mapping_id_check` | C | CHECK ((mapping_id ~ '^itmap_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `intent_taxonomy_mappings_mapping_type_check` | C | CHECK ((mapping_type = ANY (ARRAY['rename'::text, 'merge'::text, 'split'::text, 'deprecate'::text]))) |
| `intent_taxonomy_mappings_pkey` | P | PRIMARY KEY (mapping_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `intent_taxonomy_mapping_unique` | CREATE UNIQUE INDEX intent_taxonomy_mapping_unique ON public.intent_taxonomy_mappings USING btree (from_taxonomy_version, from_intent_id, to_taxonomy_version, to_intent_id, mapping_type) |
| `intent_taxonomy_mappings_pkey` | CREATE UNIQUE INDEX intent_taxonomy_mappings_pkey ON public.intent_taxonomy_mappings USING btree (mapping_id) |

### intent_taxonomy_versions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `intent_taxonomy_version` | `text` | 否 |  |  |
| `approval_evd` | `text` | 否 |  |  |
| `approved_by` | `text` | 否 |  |  |
| `approved_at` | `timestamp with time zone` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `intent_taxonomy_versions_approval_evd_check` | C | CHECK ((btrim(approval_evd) <> ''::text)) |
| `intent_taxonomy_versions_approved_by_check` | C | CHECK ((btrim(approved_by) <> ''::text)) |
| `intent_taxonomy_versions_intent_taxonomy_version_check` | C | CHECK ((intent_taxonomy_version ~ '^itax_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `intent_taxonomy_versions_pkey` | P | PRIMARY KEY (intent_taxonomy_version) |

索引：

| 名称 | 定义 |
| --- | --- |
| `intent_taxonomy_versions_pkey` | CREATE UNIQUE INDEX intent_taxonomy_versions_pkey ON public.intent_taxonomy_versions USING btree (intent_taxonomy_version) |

### iteration_task_status_audits

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `audit_id` | `text` | 否 |  |  |
| `task_id` | `text` | 否 |  |  |
| `before_status` | `text` | 是 |  |  |
| `after_status` | `text` | 否 |  |  |
| `actor_user_id` | `text` | 是 |  |  |
| `actor_role` | `text` | 是 |  |  |
| `resolution` | `text` | 是 |  |  |
| `resolution_note` | `text` | 是 |  |  |
| `version` | `integer` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `iteration_task_status_audits_pkey` | P | PRIMARY KEY (audit_id) |
| `iteration_task_status_audits_task_id_fkey` | F | FOREIGN KEY (task_id) REFERENCES iteration_tasks(task_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `iteration_task_status_audits_pkey` | CREATE UNIQUE INDEX iteration_task_status_audits_pkey ON public.iteration_task_status_audits USING btree (audit_id) |

### iteration_tasks

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `task_id` | `text` | 否 |  |  |
| `signal_id` | `text` | 否 |  |  |
| `cluster_key` | `text` | 否 |  |  |
| `sample_query_ids` | `text[]` | 否 | `'{}'::text[]` |  |
| `suspected_cause` | `text` | 否 |  |  |
| `suggested_script_ids` | `text[]` | 否 | `'{}'::text[]` |  |
| `status` | `text` | 否 | `'open'::text` |  |
| `resolution` | `text` | 是 |  |  |
| `resolution_note` | `text` | 是 |  |  |
| `assignee_role` | `text` | 是 |  |  |
| `version` | `integer` | 否 | `1` |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |
| `resolved_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `iteration_task_initial_and_terminal_shape` | C | CHECK ((((status = ANY (ARRAY['open'::text, 'in_progress'::text])) AND (resolution IS NULL) AND (resolution_note IS NULL) AND (resolved_at IS NULL)) OR ((status = ANY (ARRAY['resolved'::text, 'wont_fix'::text])) AND (resolution = status) AND (resolution_note IS NOT NULL) AND (btrim(resolution_note) <> ''::text) AND (length(resolution_note) <= 2000) AND (resolved_at IS NOT NULL)))) |
| `iteration_tasks_pkey` | P | PRIMARY KEY (task_id) |
| `iteration_tasks_resolution_check` | C | CHECK ((resolution = ANY (ARRAY['resolved'::text, 'wont_fix'::text]))) |
| `iteration_tasks_status_check` | C | CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'wont_fix'::text]))) |
| `iteration_tasks_suspected_cause_check` | C | CHECK ((suspected_cause = ANY (ARRAY['content_gap'::text, 'ranking'::text, 'stale'::text, 'mixed'::text]))) |
| `iteration_tasks_version_check` | C | CHECK ((version >= 1)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_iteration_tasks_signal` | CREATE INDEX idx_iteration_tasks_signal ON public.iteration_tasks USING btree (signal_id, status) |
| `idx_iteration_tasks_status_created` | CREATE INDEX idx_iteration_tasks_status_created ON public.iteration_tasks USING btree (status, created_at DESC, task_id DESC) |
| `iteration_tasks_pkey` | CREATE UNIQUE INDEX iteration_tasks_pkey ON public.iteration_tasks USING btree (task_id) |

### notice_decisions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `notice_version` | `text` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `decision` | `text` | 否 |  |  |
| `decision_source` | `text` | 否 | `'first_run_prompt'::text` |  |
| `decided_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `notice_decisions_decision_check` | C | CHECK ((decision = ANY (ARRAY['accepted'::text, 'declined'::text]))) |
| `notice_decisions_decision_source_check` | C | CHECK ((decision_source = ANY (ARRAY['first_run_prompt'::text, 'settings'::text]))) |
| `notice_decisions_notice_version_fkey` | F | FOREIGN KEY (notice_version) REFERENCES privacy_notices(notice_version) |
| `notice_decisions_pkey` | P | PRIMARY KEY (notice_version, user_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `notice_decisions_pkey` | CREATE UNIQUE INDEX notice_decisions_pkey ON public.notice_decisions USING btree (notice_version, user_id) |

### outbox_jobs

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `job_id` | `text` | 否 |  |  |
| `job_type` | `text` | 否 |  |  |
| `payload` | `jsonb` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `attempts` | `integer` | 否 | `0` |  |
| `max_attempts` | `integer` | 否 | `5` |  |
| `available_at` | `timestamp with time zone` | 否 | `now()` |  |
| `lease_owner` | `text` | 是 |  |  |
| `lease_version` | `bigint` | 否 | `0` |  |
| `lease_expires_at` | `timestamp with time zone` | 是 |  |  |
| `last_error` | `text` | 是 |  |  |
| `completed_at` | `timestamp with time zone` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `outbox_jobs_job_type_check` | C | CHECK ((job_type = ANY (ARRAY['import_validate'::text, 'work_order_import_validate'::text, 'event_upload'::text, 'announce_fanout'::text, 'rewrite_candidate'::text, 'other'::text]))) |
| `outbox_jobs_pkey` | P | PRIMARY KEY (job_id) |
| `outbox_jobs_status_check` | C | CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'dead'::text]))) |
| `outbox_max_attempts_range` | C | CHECK (((max_attempts >= 1) AND (max_attempts <= 20))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_outbox_claim_v13` | CREATE INDEX idx_outbox_claim_v13 ON public.outbox_jobs USING btree (job_type, status, available_at, lease_expires_at, created_at) |
| `outbox_jobs_pkey` | CREATE UNIQUE INDEX outbox_jobs_pkey ON public.outbox_jobs USING btree (job_id) |

### owner_acceptance_records

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `text` | 否 |  |  |
| `record_sha256` | `text` | 否 |  |  |
| `owner_subject_hash` | `text` | 否 |  |  |
| `record` | `jsonb` | 否 |  |  |
| `registered_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `owner_acceptance_records_owner_subject_hash_check` | C | CHECK ((owner_subject_hash ~ '^[0-9a-f]{64}$'::text)) |
| `owner_acceptance_records_pkey` | P | PRIMARY KEY (tenant_id, record_sha256) |
| `owner_acceptance_records_record_sha256_check` | C | CHECK ((record_sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `owner_acceptance_records_tenant_id_check` | C | CHECK ((tenant_id ~ '^[a-zA-Z0-9_-]{1,128}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `owner_acceptance_records_pkey` | CREATE UNIQUE INDEX owner_acceptance_records_pkey ON public.owner_acceptance_records USING btree (tenant_id, record_sha256) |

### owner_acceptance_revocations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `text` | 否 |  |  |
| `record_sha256` | `text` | 否 |  |  |
| `evidence_id` | `text` | 否 |  |  |
| `revoked_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `owner_acceptance_revocations_evidence_id_check` | C | CHECK ((evidence_id ~ '^EVD-[A-Z0-9-]{6,127}$'::text)) |
| `owner_acceptance_revocations_pkey` | P | PRIMARY KEY (tenant_id, record_sha256) |
| `owner_acceptance_revocations_tenant_id_record_sha256_fkey` | F | FOREIGN KEY (tenant_id, record_sha256) REFERENCES owner_acceptance_records(tenant_id, record_sha256) |

索引：

| 名称 | 定义 |
| --- | --- |
| `owner_acceptance_revocations_pkey` | CREATE UNIQUE INDEX owner_acceptance_revocations_pkey ON public.owner_acceptance_revocations USING btree (tenant_id, record_sha256) |

### policy_flags

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `flag_key` | `text` | 否 |  |  |
| `flag_value` | `boolean` | 否 |  |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_by` | `text` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `policy_flags_pkey` | P | PRIMARY KEY (flag_key) |

索引：

| 名称 | 定义 |
| --- | --- |
| `policy_flags_pkey` | CREATE UNIQUE INDEX policy_flags_pkey ON public.policy_flags USING btree (flag_key) |

### privacy_notices

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `notice_version` | `text` | 否 |  |  |
| `notice_text` | `text` | 否 |  |  |
| `content_hash` | `text` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `published_at` | `timestamp with time zone` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `privacy_notice_publish_shape` | C | CHECK ((((status = 'draft'::text) AND (published_at IS NULL)) OR ((status = ANY (ARRAY['current'::text, 'retired'::text])) AND (published_at IS NOT NULL)))) |
| `privacy_notices_content_hash_check` | C | CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)) |
| `privacy_notices_notice_text_check` | C | CHECK ((btrim(notice_text) <> ''::text)) |
| `privacy_notices_pkey` | P | PRIMARY KEY (notice_version) |
| `privacy_notices_status_check` | C | CHECK ((status = ANY (ARRAY['draft'::text, 'current'::text, 'retired'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `privacy_notices_pkey` | CREATE UNIQUE INDEX privacy_notices_pkey ON public.privacy_notices USING btree (notice_version) |
| `uq_privacy_notice_current` | CREATE UNIQUE INDEX uq_privacy_notice_current ON public.privacy_notices USING btree (status) WHERE (status = 'current'::text) |

### query_events

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `query_id` | `text` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `parent_query_id` | `text` | 是 |  |  |
| `interaction_reason` | `text` | 否 | `'original'::text` |  |
| `request_hash` | `text` | 否 |  |  |
| `request_hash_key_version` | `text` | 否 |  |  |
| `query_text_redacted` | `text` | 是 |  |  |
| `query_text_hash` | `text` | 是 |  |  |
| `hash_key_version` | `text` | 否 |  |  |
| `text_storage_status` | `text` | 否 |  |  |
| `collection_mode` | `text` | 否 |  |  |
| `detected_category` | `text` | 是 |  |  |
| `detected_platform` | `text` | 是 |  |  |
| `platform` | `text` | 是 |  |  |
| `platform_source` | `text` | 否 |  |  |
| `product_context_type` | `text` | 是 |  |  |
| `product_context_ref_hash` | `text` | 是 |  |  |
| `product_context_hash_key_version` | `text` | 是 |  |  |
| `redaction_policy_version` | `text` | 否 |  |  |
| `hit_status` | `text` | 否 |  |  |
| `latency_ms` | `integer` | 是 |  |  |
| `release_id` | `text` | 否 |  |  |
| `text_expires_at` | `timestamp with time zone` | 是 |  |  |
| `event_expires_at` | `timestamp with time zone` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `tenant_id` | `text` | 否 | `'default'::text` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `query_events_collection_mode_check` | C | CHECK ((collection_mode = ANY (ARRAY['synthetic'::text, 'approved_redacted'::text, 'pilot_recorded'::text]))) |
| `query_events_detected_platform_check` | C | CHECK (((detected_platform IS NULL) OR (detected_platform = ANY (ARRAY['qianniu'::text, 'douyin'::text, 'unknown'::text])))) |
| `query_events_hit_status_check` | C | CHECK ((hit_status = ANY (ARRAY['hit'::text, 'no_hit'::text]))) |
| `query_events_interaction_reason_check` | C | CHECK ((interaction_reason = ANY (ARRAY['original'::text, 'reselection'::text]))) |
| `query_events_parent_query_id_fkey` | F | FOREIGN KEY (parent_query_id) REFERENCES query_events(query_id) |
| `query_events_pkey` | P | PRIMARY KEY (query_id) |
| `query_events_platform_check` | C | CHECK (((platform IS NULL) OR (platform = ANY (ARRAY['qianniu'::text, 'douyin'::text, 'unknown'::text])))) |
| `query_events_platform_source_check` | C | CHECK ((platform_source = ANY (ARRAY['manual'::text, 'foreground_process'::text, 'native_integration'::text, 'unknown'::text]))) |
| `query_events_product_context_ref_hash_check` | C | CHECK (((product_context_ref_hash IS NULL) OR (product_context_ref_hash ~ '^[0-9a-f]{64}$'::text))) |
| `query_events_product_context_type_check` | C | CHECK (((product_context_type IS NULL) OR (product_context_type = ANY (ARRAY['category'::text, 'sku'::text])))) |
| `query_events_redaction_policy_version_check` | C | CHECK ((btrim(redaction_policy_version) <> ''::text)) |
| `query_events_text_storage_status_check` | C | CHECK ((text_storage_status = ANY (ARRAY['stored'::text, 'suppressed'::text]))) |
| `query_expiry_shape` | C | CHECK ((((text_expires_at IS NULL) OR (text_expires_at >= created_at)) AND ((event_expires_at IS NULL) OR (event_expires_at >= created_at)) AND ((text_expires_at IS NULL) OR (event_expires_at IS NULL) OR (text_expires_at <= event_expires_at)))) |
| `query_interaction_shape` | C | CHECK ((((interaction_reason = 'original'::text) AND (parent_query_id IS NULL)) OR ((interaction_reason = 'reselection'::text) AND (parent_query_id IS NOT NULL)))) |
| `query_platform_provenance_shape` | C | CHECK (((platform_source = ANY (ARRAY['manual'::text, 'native_integration'::text])) OR ((platform_source = 'foreground_process'::text) AND (detected_platform IS NOT NULL) AND (platform IS NOT NULL) AND (detected_platform = ANY (ARRAY['qianniu'::text, 'douyin'::text])) AND (platform = detected_platform)) OR ((platform_source = 'unknown'::text) AND ((platform IS NULL) OR (platform = 'unknown'::text))))) |
| `query_product_context_shape` | C | CHECK ((((product_context_type IS NULL) AND (product_context_ref_hash IS NULL) AND (product_context_hash_key_version IS NULL)) OR ((product_context_type = ANY (ARRAY['category'::text, 'sku'::text])) AND (product_context_ref_hash IS NOT NULL) AND (product_context_hash_key_version IS NOT NULL) AND (btrim(product_context_hash_key_version) <> ''::text)))) |
| `query_release_fk` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |
| `query_text_storage_shape` | C | CHECK ((((text_storage_status = 'stored'::text) AND (query_text_redacted IS NOT NULL) AND (btrim(query_text_redacted) <> ''::text) AND (query_text_hash IS NOT NULL) AND (query_text_hash ~ '^[0-9a-f]{64}$'::text)) OR ((text_storage_status = 'suppressed'::text) AND (query_text_redacted IS NULL) AND (query_text_hash IS NULL)))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_query_created` | CREATE INDEX idx_query_created ON public.query_events USING btree (created_at) |
| `idx_query_event_expiry` | CREATE INDEX idx_query_event_expiry ON public.query_events USING btree (event_expires_at) WHERE (event_expires_at IS NOT NULL) |
| `idx_query_hit` | CREATE INDEX idx_query_hit ON public.query_events USING btree (hit_status) |
| `idx_query_parent` | CREATE INDEX idx_query_parent ON public.query_events USING btree (parent_query_id) WHERE (parent_query_id IS NOT NULL) |
| `idx_query_text_expiry` | CREATE INDEX idx_query_text_expiry ON public.query_events USING btree (text_expires_at) WHERE (text_expires_at IS NOT NULL) |
| `idx_query_user` | CREATE INDEX idx_query_user ON public.query_events USING btree (user_id) |
| `query_events_pkey` | CREATE UNIQUE INDEX query_events_pkey ON public.query_events USING btree (query_id) |
| `uq_query_release` | CREATE UNIQUE INDEX uq_query_release ON public.query_events USING btree (query_id, release_id) |
| `uq_query_user` | CREATE UNIQUE INDEX uq_query_user ON public.query_events USING btree (query_id, user_id) |

### rate_limit_buckets

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `bucket_key` | `text` | 否 |  |  |
| `tokens` | `double precision` | 否 |  |  |
| `capacity` | `double precision` | 否 |  |  |
| `refill_per_sec` | `double precision` | 否 |  |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `rate_limit_buckets_pkey` | P | PRIMARY KEY (bucket_key) |

索引：

| 名称 | 定义 |
| --- | --- |
| `rate_limit_buckets_pkey` | CREATE UNIQUE INDEX rate_limit_buckets_pkey ON public.rate_limit_buckets USING btree (bucket_key) |

### release_items

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `script_version` | `integer` | 否 |  |  |
| `content_hash` | `text` | 否 |  |  |
| `answer_text` | `text` | 否 |  |  |
| `title` | `text` | 否 |  |  |
| `category` | `text` | 否 |  |  |
| `source_ref` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `owner_role` | `text` | 否 |  |  |
| `review_due_at` | `timestamp with time zone` | 否 |  |  |
| `effective_from` | `timestamp with time zone` | 否 |  |  |
| `effective_to` | `timestamp with time zone` | 是 |  |  |
| `platform_scope` | `text[]` | 否 |  |  |
| `product_scope_type` | `text` | 否 |  |  |
| `product_scope_refs` | `text[]` | 否 |  |  |
| `intent_taxonomy_version` | `text` | 否 |  |  |
| `intent_id` | `text` | 否 |  |  |
| `risk_level` | `text` | 否 |  |  |
| `risk_categories` | `text[]` | 否 |  |  |
| `has_conflict` | `boolean` | 否 |  |  |
| `review_mode` | `text` | 否 |  |  |
| `primary_reviewer_id` | `text` | 否 |  |  |
| `primary_reviewer_role` | `text` | 否 |  |  |
| `primary_review_evd` | `text` | 否 |  |  |
| `secondary_reviewer_id` | `text` | 是 |  |  |
| `secondary_reviewer_role` | `text` | 是 |  |  |
| `secondary_review_evd` | `text` | 是 |  |  |
| `placeholder_keys` | `text[]` | 否 |  |  |
| `questions_json` | `jsonb` | 否 |  |  |
| `search_document` | `tsvector` | 否 |  |  |
| `search_fallback_text` | `text` | 否 |  |  |
| `owner_acceptance_record_sha256` | `text` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `release_campaign_requires_window` | C | CHECK (((category <> 'campaign'::text) OR ((effective_from IS NOT NULL) AND (effective_to IS NOT NULL)))) |
| `release_effective_window` | C | CHECK (((effective_to IS NULL) OR (effective_from < effective_to))) |
| `release_item_intent_fk` | F | FOREIGN KEY (intent_taxonomy_version, intent_id) REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id) |
| `release_item_source_binding_fk` | F | FOREIGN KEY (release_id, category, source_version_id) REFERENCES release_source_bindings(release_id, domain, source_version_id) |
| `release_item_source_version_fk` | F | FOREIGN KEY (source_version_id, category, source_ref) REFERENCES authoritative_source_versions(source_version_id, domain, source_ref) |
| `release_items_category_check` | C | CHECK ((category = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text]))) |
| `release_items_content_hash_check` | C | CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)) |
| `release_items_owner_role_check` | C | CHECK ((btrim(owner_role) <> ''::text)) |
| `release_items_pkey` | P | PRIMARY KEY (release_id, script_id) |
| `release_items_primary_review_evd_check` | C | CHECK ((btrim(primary_review_evd) <> ''::text)) |
| `release_items_primary_reviewer_id_check` | C | CHECK ((primary_reviewer_id ~ '^[0-9a-f]{64}$'::text)) |
| `release_items_primary_reviewer_role_check` | C | CHECK ((primary_reviewer_role = 'ROLE-CONTENT-LEAD'::text)) |
| `release_items_product_scope_type_check` | C | CHECK ((product_scope_type = ANY (ARRAY['storewide'::text, 'category'::text, 'sku'::text]))) |
| `release_items_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |
| `release_items_risk_level_check` | C | CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))) |
| `release_items_source_ref_check` | C | CHECK ((btrim(source_ref) <> ''::text)) |
| `release_placeholders` | C | CHECK (content_template_placeholders_are_valid(answer_text, placeholder_keys)) |
| `release_platform_scope` | C | CHECK ((content_text_array_is_nonblank_unique(platform_scope) AND (cardinality(platform_scope) > 0) AND (platform_scope <@ ARRAY['qianniu'::text, 'douyin'::text]))) |
| `release_product_scope` | C | CHECK ((content_text_array_is_nonblank_unique(product_scope_refs) AND (((product_scope_type = 'storewide'::text) AND (cardinality(product_scope_refs) = 0)) OR ((product_scope_type = ANY (ARRAY['category'::text, 'sku'::text])) AND (cardinality(product_scope_refs) > 0))))) |
| `release_questions_array` | C | CHECK (content_questions_align_intent(questions_json, intent_taxonomy_version, intent_id)) |
| `release_review_shape` | C | CHECK (owner_acceptance_review_shape(risk_level, has_conflict, review_mode, primary_reviewer_id, primary_reviewer_role, primary_review_evd, secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd, owner_acceptance_record_sha256)) |
| `release_risk_categories` | C | CHECK (content_risk_categories_are_valid(risk_level, risk_categories)) |
| `release_search_document_nonempty` | C | CHECK ((length(search_document) > 0)) |
| `release_text_nonempty` | C | CHECK (((btrim(title) <> ''::text) AND (btrim(answer_text) <> ''::text) AND (btrim(search_fallback_text) <> ''::text))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_release_items_search_document` | CREATE INDEX idx_release_items_search_document ON public.release_items USING gin (search_document) |
| `idx_release_items_search_fallback_trgm` | CREATE INDEX idx_release_items_search_fallback_trgm ON public.release_items USING gin (search_fallback_text gin_trgm_ops) |
| `release_items_pkey` | CREATE UNIQUE INDEX release_items_pkey ON public.release_items USING btree (release_id, script_id) |
| `uq_release_item_provenance` | CREATE UNIQUE INDEX uq_release_item_provenance ON public.release_items USING btree (release_id, script_id, script_version, content_hash) |

### release_source_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 否 |  |  |
| `domain` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `release_source_binding_triple_unique` | U | UNIQUE (release_id, domain, source_version_id) |
| `release_source_bindings_domain_check` | C | CHECK ((domain = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text]))) |
| `release_source_bindings_pkey` | P | PRIMARY KEY (release_id, domain) |
| `release_source_bindings_release_id_fkey` | F | FOREIGN KEY (release_id) REFERENCES content_releases(release_id) |
| `release_source_version_fk` | F | FOREIGN KEY (source_version_id, domain) REFERENCES authoritative_source_versions(source_version_id, domain) |

索引：

| 名称 | 定义 |
| --- | --- |
| `release_source_binding_triple_unique` | CREATE UNIQUE INDEX release_source_binding_triple_unique ON public.release_source_bindings USING btree (release_id, domain, source_version_id) |
| `release_source_bindings_pkey` | CREATE UNIQUE INDEX release_source_bindings_pkey ON public.release_source_bindings USING btree (release_id, domain) |

### rewrite_logs

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `rewrite_id` | `text` | 否 |  |  |
| `source_script_id` | `text` | 是 |  |  |
| `proposed_text` | `text` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `model` | `text` | 是 |  |  |
| `prompt_hash` | `text` | 是 |  |  |
| `tenant_id` | `text` | 否 | `'default'::text` |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `rewrite_logs_pkey` | P | PRIMARY KEY (rewrite_id) |
| `rewrite_logs_status_check` | C | CHECK ((status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `rewrite_logs_pkey` | CREATE UNIQUE INDEX rewrite_logs_pkey ON public.rewrite_logs USING btree (rewrite_id) |

### script_questions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `question_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `question_version` | `integer` | 否 |  |  |
| `question_text` | `text` | 否 |  |  |
| `question_hash` | `text` | 否 |  |  |
| `semantic_family_id` | `text` | 否 |  |  |
| `origin_fingerprint` | `text` | 否 |  |  |
| `origin_fingerprint_key_version` | `text` | 否 |  |  |
| `source_asset_id` | `text` | 否 |  |  |
| `source` | `text` | 否 |  |  |
| `intent_taxonomy_version` | `text` | 否 |  |  |
| `intent_id` | `text` | 否 |  |  |
| `source_query_id` | `text` | 是 |  |  |
| `promotion_review_ref` | `text` | 是 |  |  |
| `promoted_by_role` | `text` | 是 |  |  |
| `promoted_at` | `timestamp with time zone` | 是 |  |  |
| `status` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `script_question_intent_fk` | F | FOREIGN KEY (intent_taxonomy_version, intent_id) REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id) |
| `script_question_origin_version_unique` | U | UNIQUE (origin_fingerprint_key_version, origin_fingerprint, question_version) |
| `script_question_promotion_shape` | C | CHECK (((source_query_id IS NULL) AND (((source = 'from_log'::text) AND (promotion_review_ref IS NOT NULL) AND (btrim(promotion_review_ref) <> ''::text) AND (promoted_by_role IS NOT NULL) AND (btrim(promoted_by_role) <> ''::text) AND (promoted_at IS NOT NULL)) OR ((source <> 'from_log'::text) AND (promotion_review_ref IS NULL) AND (promoted_by_role IS NULL) AND (promoted_at IS NULL))))) |
| `script_question_source_asset_fk` | F | FOREIGN KEY (source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint) REFERENCES semantic_source_assets(source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint) ON DELETE RESTRICT |
| `script_questions_origin_fingerprint_check` | C | CHECK ((origin_fingerprint ~ '^[0-9a-f]{64}$'::text)) |
| `script_questions_origin_fingerprint_key_version_check` | C | CHECK ((origin_fingerprint_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text)) |
| `script_questions_pkey` | P | PRIMARY KEY (question_id, question_version) |
| `script_questions_question_hash_check` | C | CHECK ((question_hash ~ '^[0-9a-f]{64}$'::text)) |
| `script_questions_question_id_check` | C | CHECK ((question_id ~ '^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$'::text)) |
| `script_questions_question_version_check` | C | CHECK ((question_version >= 1)) |
| `script_questions_script_id_fkey` | F | FOREIGN KEY (script_id) REFERENCES scripts(script_id) |
| `script_questions_semantic_family_id_check` | C | CHECK ((semantic_family_id ~ '^sf_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `script_questions_source_asset_id_check` | C | CHECK ((source_asset_id ~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `script_questions_source_check` | C | CHECK ((source = ANY (ARRAY['manual'::text, 'from_log'::text, 'import'::text]))) |
| `script_questions_status_check` | C | CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_questions_script` | CREATE INDEX idx_questions_script ON public.script_questions USING btree (script_id) |
| `idx_script_questions_source_asset` | CREATE INDEX idx_script_questions_source_asset ON public.script_questions USING btree (source_asset_id) |
| `script_question_origin_version_unique` | CREATE UNIQUE INDEX script_question_origin_version_unique ON public.script_questions USING btree (origin_fingerprint_key_version, origin_fingerprint, question_version) |
| `script_questions_pkey` | CREATE UNIQUE INDEX script_questions_pkey ON public.script_questions USING btree (question_id, question_version) |

### scripts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `script_id` | `text` | 否 |  |  |
| `category` | `text` | 否 |  |  |
| `title` | `text` | 否 |  |  |
| `answer_text` | `text` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `version` | `integer` | 否 | `1` |  |
| `content_hash` | `text` | 否 |  |  |
| `source_ref` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `platform_scope` | `text[]` | 否 |  |  |
| `product_scope_type` | `text` | 否 |  |  |
| `product_scope_refs` | `text[]` | 否 |  |  |
| `campaign_tag` | `text` | 是 |  |  |
| `effective_from` | `timestamp with time zone` | 否 |  |  |
| `effective_to` | `timestamp with time zone` | 是 |  |  |
| `intent_taxonomy_version` | `text` | 否 |  |  |
| `intent_id` | `text` | 否 |  |  |
| `risk_level` | `text` | 否 |  |  |
| `risk_categories` | `text[]` | 否 |  |  |
| `has_conflict` | `boolean` | 否 | `false` |  |
| `review_mode` | `text` | 否 |  |  |
| `primary_reviewer_id` | `text` | 否 |  |  |
| `primary_reviewer_role` | `text` | 否 |  |  |
| `primary_review_evd` | `text` | 否 |  |  |
| `secondary_reviewer_id` | `text` | 是 |  |  |
| `secondary_reviewer_role` | `text` | 是 |  |  |
| `secondary_review_evd` | `text` | 是 |  |  |
| `placeholder_keys` | `text[]` | 否 |  |  |
| `questions_json` | `jsonb` | 否 |  |  |
| `priority` | `integer` | 否 | `0` |  |
| `owner_role` | `text` | 否 |  |  |
| `review_due_at` | `timestamp with time zone` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |
| `published_at` | `timestamp with time zone` | 是 |  |  |
| `tenant_id` | `text` | 否 | `'default'::text` |  |
| `owner_acceptance_record_sha256` | `text` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `scripts_campaign_requires_window` | C | CHECK (((category <> 'campaign'::text) OR ((effective_from IS NOT NULL) AND (effective_to IS NOT NULL)))) |
| `scripts_category_check` | C | CHECK ((category = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text]))) |
| `scripts_content_hash_check` | C | CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)) |
| `scripts_effective_window` | C | CHECK (((effective_to IS NULL) OR (effective_from < effective_to))) |
| `scripts_intent_fk` | F | FOREIGN KEY (intent_taxonomy_version, intent_id) REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id) |
| `scripts_owner_role_check` | C | CHECK ((btrim(owner_role) <> ''::text)) |
| `scripts_pkey` | P | PRIMARY KEY (script_id) |
| `scripts_placeholders` | C | CHECK (content_template_placeholders_are_valid(answer_text, placeholder_keys)) |
| `scripts_platform_scope` | C | CHECK ((content_text_array_is_nonblank_unique(platform_scope) AND (cardinality(platform_scope) > 0) AND (platform_scope <@ ARRAY['qianniu'::text, 'douyin'::text]))) |
| `scripts_primary_review_evd_check` | C | CHECK ((btrim(primary_review_evd) <> ''::text)) |
| `scripts_primary_reviewer_id_check` | C | CHECK ((primary_reviewer_id ~ '^[0-9a-f]{64}$'::text)) |
| `scripts_primary_reviewer_role_check` | C | CHECK ((primary_reviewer_role = 'ROLE-CONTENT-LEAD'::text)) |
| `scripts_product_scope` | C | CHECK ((content_text_array_is_nonblank_unique(product_scope_refs) AND (((product_scope_type = 'storewide'::text) AND (cardinality(product_scope_refs) = 0)) OR ((product_scope_type = ANY (ARRAY['category'::text, 'sku'::text])) AND (cardinality(product_scope_refs) > 0))))) |
| `scripts_product_scope_type_check` | C | CHECK ((product_scope_type = ANY (ARRAY['storewide'::text, 'category'::text, 'sku'::text]))) |
| `scripts_questions` | C | CHECK (content_questions_align_intent(questions_json, intent_taxonomy_version, intent_id)) |
| `scripts_review_shape` | C | CHECK (owner_acceptance_review_shape(risk_level, has_conflict, review_mode, primary_reviewer_id, primary_reviewer_role, primary_review_evd, secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd, owner_acceptance_record_sha256)) |
| `scripts_risk_categories` | C | CHECK (content_risk_categories_are_valid(risk_level, risk_categories)) |
| `scripts_risk_level_check` | C | CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))) |
| `scripts_source_ref_check` | C | CHECK ((btrim(source_ref) <> ''::text)) |
| `scripts_source_version_fk` | F | FOREIGN KEY (source_version_id, category, source_ref) REFERENCES authoritative_source_versions(source_version_id, domain, source_ref) |
| `scripts_status_check` | C | CHECK ((status = ANY (ARRAY['draft'::text, 'in_review'::text, 'published'::text, 'archived'::text]))) |
| `scripts_version_check` | C | CHECK ((version >= 1)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_scripts_effective` | CREATE INDEX idx_scripts_effective ON public.scripts USING btree (effective_from, effective_to) |
| `idx_scripts_published` | CREATE INDEX idx_scripts_published ON public.scripts USING btree (status) WHERE (status = 'published'::text) |
| `scripts_pkey` | CREATE UNIQUE INDEX scripts_pkey ON public.scripts USING btree (script_id) |

### semantic_source_assets

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `source_asset_id` | `text` | 否 |  |  |
| `source` | `text` | 否 |  |  |
| `origin_fingerprint` | `text` | 否 |  |  |
| `origin_fingerprint_key_version` | `text` | 否 |  |  |
| `source_query_id` | `text` | 是 |  |  |
| `promotion_review_ref` | `text` | 是 |  |  |
| `promoted_by_role` | `text` | 是 |  |  |
| `promoted_at` | `timestamp with time zone` | 是 |  |  |
| `lifecycle` | `text` | 否 | `'active'::text` |  |
| `retirement_evd` | `text` | 是 |  |  |
| `retired_by_subject_hash` | `text` | 是 |  |  |
| `retired_by_subject_key_version` | `text` | 是 |  |  |
| `retired_at` | `timestamp with time zone` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `semantic_source_asset_identity_unique` | U | UNIQUE (source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint) |
| `semantic_source_asset_origin_shape` | C | CHECK ((((source = 'from_log'::text) AND (promotion_review_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'::text) AND (promoted_by_role IS NOT NULL) AND (btrim(promoted_by_role) <> ''::text) AND (promoted_at IS NOT NULL) AND (((lifecycle = 'active'::text) AND (source_query_id IS NOT NULL)) OR ((lifecycle = 'retired'::text) AND (source_query_id IS NULL)))) OR ((source = ANY (ARRAY['manual'::text, 'import'::text])) AND (source_query_id IS NULL) AND (promotion_review_ref IS NULL) AND (promoted_by_role IS NULL) AND (promoted_at IS NULL)))) |
| `semantic_source_asset_retirement_shape` | C | CHECK ((((lifecycle = 'active'::text) AND (retirement_evd IS NULL) AND (retired_by_subject_hash IS NULL) AND (retired_by_subject_key_version IS NULL) AND (retired_at IS NULL)) OR ((lifecycle = 'retired'::text) AND (retirement_evd ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'::text) AND (retired_by_subject_hash ~ '^[0-9a-f]{64}$'::text) AND (retired_by_subject_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text) AND (retired_at IS NOT NULL) AND (retired_at >= created_at)))) |
| `semantic_source_assets_lifecycle_check` | C | CHECK ((lifecycle = ANY (ARRAY['active'::text, 'retired'::text]))) |
| `semantic_source_assets_origin_fingerprint_check` | C | CHECK ((origin_fingerprint ~ '^[0-9a-f]{64}$'::text)) |
| `semantic_source_assets_origin_fingerprint_key_version_check` | C | CHECK ((origin_fingerprint_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text)) |
| `semantic_source_assets_pkey` | P | PRIMARY KEY (source_asset_id) |
| `semantic_source_assets_source_asset_id_check` | C | CHECK ((source_asset_id ~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text)) |
| `semantic_source_assets_source_check` | C | CHECK ((source = ANY (ARRAY['manual'::text, 'from_log'::text, 'import'::text]))) |
| `semantic_source_assets_source_query_id_fkey` | F | FOREIGN KEY (source_query_id) REFERENCES query_events(query_id) ON DELETE RESTRICT |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_semantic_source_assets_lifecycle` | CREATE INDEX idx_semantic_source_assets_lifecycle ON public.semantic_source_assets USING btree (lifecycle, source_asset_id) |
| `idx_semantic_source_assets_query` | CREATE INDEX idx_semantic_source_assets_query ON public.semantic_source_assets USING btree (source_query_id) WHERE (source_query_id IS NOT NULL) |
| `semantic_source_asset_identity_unique` | CREATE UNIQUE INDEX semantic_source_asset_identity_unique ON public.semantic_source_assets USING btree (source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint) |
| `semantic_source_assets_pkey` | CREATE UNIQUE INDEX semantic_source_assets_pkey ON public.semantic_source_assets USING btree (source_asset_id) |

### snapshot_offline_leases

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `lease_token_hash` | `text` | 否 |  |  |
| `client_id` | `text` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `release_id` | `text` | 否 |  |  |
| `source_binding_hash` | `text` | 否 |  |  |
| `issued_at` | `timestamp with time zone` | 否 |  |  |
| `expires_at` | `timestamp with time zone` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `lease_principal_release_identity` | U | UNIQUE (lease_token_hash, user_id, release_id) |
| `snapshot_offline_lease_release_fk` | F | FOREIGN KEY (release_id, source_binding_hash) REFERENCES content_releases(release_id, source_binding_hash) |
| `snapshot_offline_lease_window` | C | CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '00:15:00'::interval)))) |
| `snapshot_offline_leases_client_id_check` | C | CHECK ((btrim(client_id) <> ''::text)) |
| `snapshot_offline_leases_lease_token_hash_check` | C | CHECK ((lease_token_hash ~ '^[0-9a-f]{64}$'::text)) |
| `snapshot_offline_leases_pkey` | P | PRIMARY KEY (lease_token_hash) |
| `snapshot_offline_leases_source_binding_hash_check` | C | CHECK ((source_binding_hash ~ '^[0-9a-f]{64}$'::text)) |
| `snapshot_offline_leases_user_id_check` | C | CHECK ((btrim(user_id) <> ''::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `lease_principal_release_identity` | CREATE UNIQUE INDEX lease_principal_release_identity ON public.snapshot_offline_leases USING btree (lease_token_hash, user_id, release_id) |
| `snapshot_offline_leases_pkey` | CREATE UNIQUE INDEX snapshot_offline_leases_pkey ON public.snapshot_offline_leases USING btree (lease_token_hash) |

### source_denial_audits

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `denial_key` | `text` | 否 |  |  |
| `operation` | `text` | 否 |  |  |
| `reason_code` | `text` | 否 |  |  |
| `actor_subject_hash` | `text` | 否 |  |  |
| `hash_key_version` | `text` | 否 |  |  |
| `actor_role` | `text` | 否 |  |  |
| `release_id` | `text` | 是 |  |  |
| `source_version_id` | `text` | 是 |  |  |
| `source_binding_hash` | `text` | 是 |  |  |
| `diagnostic_id` | `text` | 否 |  |  |
| `committed_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `source_denial_audits_actor_role_check` | C | CHECK ((actor_role = ANY (ARRAY['agent'::text, 'coach'::text, 'owner'::text]))) |
| `source_denial_audits_actor_subject_hash_check` | C | CHECK ((actor_subject_hash ~ '^[0-9a-f]{64}$'::text)) |
| `source_denial_audits_denial_key_check` | C | CHECK ((denial_key ~ '^sda_[0-9a-f]{64}$'::text)) |
| `source_denial_audits_diagnostic_id_check` | C | CHECK ((diagnostic_id ~ '^diag_[0-9a-f]{32}$'::text)) |
| `source_denial_audits_hash_key_version_check` | C | CHECK ((btrim(hash_key_version) <> ''::text)) |
| `source_denial_audits_operation_check` | C | CHECK ((operation = ANY (ARRAY['content_import'::text, 'content_publish'::text, 'content_rollback'::text, 'search'::text, 'announce_current'::text, 'announce_snapshot'::text, 'announce_ack'::text, 'source_suspend'::text]))) |
| `source_denial_audits_pkey` | P | PRIMARY KEY (denial_key) |
| `source_denial_audits_reason_code_check` | C | CHECK ((reason_code = ANY (ARRAY['SOURCE_NOT_REGISTERED'::text, 'SOURCE_NOT_ELIGIBLE'::text, 'SOURCE_SUSPENDED'::text, 'SOURCE_DOMAIN_MISMATCH'::text, 'SOURCE_SNAPSHOT_MISMATCH'::text, 'SOURCE_SET_INCOMPLETE'::text, 'SOURCE_BASE_RELEASE_STALE'::text, 'SOURCE_BINDING_HASH_MISMATCH'::text, 'SOURCE_GATE_NOT_READY'::text, 'OFFLINE_LEASE_INVALID'::text, 'OFFLINE_LEASE_EXPIRED'::text, 'OFFLINE_LEASE_BINDING_MISMATCH'::text]))) |
| `source_denial_audits_release_id_check` | C | CHECK (((release_id IS NULL) OR (btrim(release_id) <> ''::text))) |
| `source_denial_audits_source_binding_hash_check` | C | CHECK (((source_binding_hash IS NULL) OR (source_binding_hash ~ '^[0-9a-f]{64}$'::text))) |
| `source_denial_audits_source_version_id_check` | C | CHECK (((source_version_id IS NULL) OR (source_version_id ~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'::text))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `source_denial_audits_pkey` | CREATE UNIQUE INDEX source_denial_audits_pkey ON public.source_denial_audits USING btree (denial_key) |

### source_snapshot_revisions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `import_batch_id` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `domain` | `text` | 否 |  |  |
| `previous_sha256` | `text` | 否 |  |  |
| `new_sha256` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `source_snapshot_revisions_new_sha256_check` | C | CHECK ((new_sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `source_snapshot_revisions_pkey` | P | PRIMARY KEY (import_batch_id, source_version_id) |
| `source_snapshot_revisions_previous_sha256_check` | C | CHECK ((previous_sha256 ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `source_snapshot_revisions_pkey` | CREATE UNIQUE INDEX source_snapshot_revisions_pkey ON public.source_snapshot_revisions USING btree (import_batch_id, source_version_id) |

### staging_scripts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `staging_id` | `text` | 否 |  |  |
| `import_batch_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `operation` | `text` | 否 | `'upsert'::text` |  |
| `category` | `text` | 否 |  |  |
| `title` | `text` | 是 |  |  |
| `answer_text` | `text` | 是 |  |  |
| `content_hash` | `text` | 是 |  |  |
| `source_ref` | `text` | 否 |  |  |
| `source_version_id` | `text` | 否 |  |  |
| `owner_role` | `text` | 是 |  |  |
| `review_due_at` | `timestamp with time zone` | 是 |  |  |
| `platform_scope` | `text[]` | 是 |  |  |
| `product_scope_type` | `text` | 是 |  |  |
| `product_scope_refs` | `text[]` | 是 |  |  |
| `campaign_tag` | `text` | 是 |  |  |
| `effective_from` | `timestamp with time zone` | 是 |  |  |
| `effective_to` | `timestamp with time zone` | 是 |  |  |
| `intent_taxonomy_version` | `text` | 是 |  |  |
| `intent_id` | `text` | 是 |  |  |
| `risk_level` | `text` | 是 |  |  |
| `risk_categories` | `text[]` | 是 |  |  |
| `has_conflict` | `boolean` | 是 |  |  |
| `review_mode` | `text` | 是 |  |  |
| `primary_reviewer_id` | `text` | 是 |  |  |
| `primary_reviewer_role` | `text` | 是 |  |  |
| `primary_review_evd` | `text` | 是 |  |  |
| `secondary_reviewer_id` | `text` | 是 |  |  |
| `secondary_reviewer_role` | `text` | 是 |  |  |
| `secondary_review_evd` | `text` | 是 |  |  |
| `placeholder_keys` | `text[]` | 是 |  |  |
| `questions_json` | `jsonb` | 否 | `'[]'::jsonb` |  |
| `search_document` | `tsvector` | 是 |  |  |
| `search_fallback_text` | `text` | 是 |  |  |
| `validation_ok` | `boolean` | 否 | `false` |  |
| `validation_errors` | `text` | 是 |  |  |
| `quality_status` | `text` | 否 |  |  |
| `quality_issue_codes` | `jsonb` | 否 | `'[]'::jsonb` |  |
| `quality_gate_passed` | `boolean` | 否 | `false` |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `owner_acceptance_record_sha256` | `text` | 是 |  |  |
| `script_version` | `integer` | 是 |  | Required exact approved version for owner_acceptance; legacy single/dual keep NULL until existing publish assignment. |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `staging_acceptance_version` | C | CHECK ((((review_mode = 'owner_acceptance'::text) AND (script_version IS NOT NULL) AND (script_version >= 1)) OR ((review_mode IS DISTINCT FROM 'owner_acceptance'::text) AND (script_version IS NULL)))) |
| `staging_batch_script_unique` | U | UNIQUE (import_batch_id, script_id) |
| `staging_batch_source_binding_fk` | F | FOREIGN KEY (import_batch_id, category, source_version_id) REFERENCES import_batch_source_bindings(import_batch_id, domain, source_version_id) |
| `staging_campaign_requires_window` | C | CHECK (((operation = 'withdraw'::text) OR (category <> 'campaign'::text) OR ((effective_from IS NOT NULL) AND (effective_to IS NOT NULL)))) |
| `staging_operation_shape` | C | CHECK ((((operation = 'withdraw'::text) AND (title IS NULL) AND (answer_text IS NULL) AND (content_hash IS NULL) AND (owner_role IS NULL) AND (review_due_at IS NULL) AND (platform_scope IS NULL) AND (product_scope_type IS NULL) AND (product_scope_refs IS NULL) AND (campaign_tag IS NULL) AND (effective_from IS NULL) AND (effective_to IS NULL) AND (intent_taxonomy_version IS NULL) AND (intent_id IS NULL) AND (risk_level IS NULL) AND (risk_categories IS NULL) AND (has_conflict IS NULL) AND (review_mode IS NULL) AND (owner_acceptance_record_sha256 IS NULL) AND (script_version IS NULL) AND (primary_reviewer_id IS NULL) AND (primary_reviewer_role IS NULL) AND (primary_review_evd IS NULL) AND (secondary_reviewer_id IS NULL) AND (secondary_reviewer_role IS NULL) AND (secondary_review_evd IS NULL) AND (placeholder_keys IS NULL) AND (search_document IS NULL) AND (search_fallback_text IS NULL) AND (jsonb_array_length(questions_json) = 0) AND (quality_status = 'clean'::text) AND quality_gate_passed) OR ((operation = 'upsert'::text) AND (title IS NOT NULL) AND (answer_text IS NOT NULL) AND (btrim(title) <> ''::text) AND (btrim(answer_text) <> ''::text) AND (owner_role IS NOT NULL) AND (btrim(owner_role) <> ''::text) AND (review_due_at IS NOT NULL) AND (effective_from IS NOT NULL) AND ((effective_to IS NULL) OR (effective_from < effective_to)) AND content_text_array_is_nonblank_unique(platform_scope) AND (cardinality(platform_scope) > 0) AND (platform_scope <@ ARRAY['qianniu'::text, 'douyin'::text]) AND (product_scope_type = ANY (ARRAY['storewide'::text, 'category'::text, 'sku'::text])) AND content_text_array_is_nonblank_unique(product_scope_refs) AND (((product_scope_type = 'storewide'::text) AND (cardinality(product_scope_refs) = 0)) OR ((product_scope_type = ANY (ARRAY['category'::text, 'sku'::text])) AND (cardinality(product_scope_refs) > 0))) AND (intent_taxonomy_version IS NOT NULL) AND (intent_id IS NOT NULL) AND (risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])) AND (has_conflict IS NOT NULL) AND content_risk_categories_are_valid(risk_level, risk_categories) AND owner_acceptance_review_shape(risk_level, has_conflict, review_mode, primary_reviewer_id, primary_reviewer_role, primary_review_evd, secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd, owner_acceptance_record_sha256) AND content_template_placeholders_are_valid(answer_text, placeholder_keys) AND (content_hash ~ '^[0-9a-f]{64}$'::text) AND (search_document IS NOT NULL) AND (length(search_document) > 0) AND (search_fallback_text IS NOT NULL) AND (btrim(search_fallback_text) <> ''::text)))) |
| `staging_quality_issue_codes` | C | CHECK (content_quality_issue_codes_are_public(quality_issue_codes)) |
| `staging_quality_shape` | C | CHECK ((((quality_status = 'clean'::text) AND (quality_issue_codes = '[]'::jsonb) AND quality_gate_passed) OR ((quality_status = 'quarantined'::text) AND (jsonb_array_length(quality_issue_codes) > 0) AND (NOT quality_gate_passed)))) |
| `staging_questions_array` | C | CHECK (((operation = 'withdraw'::text) OR content_questions_align_intent(questions_json, intent_taxonomy_version, intent_id))) |
| `staging_scripts_category_check` | C | CHECK ((category = ANY (ARRAY['presale'::text, 'campaign'::text, 'aftersale'::text, 'product'::text]))) |
| `staging_scripts_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES import_batches(import_batch_id) |
| `staging_scripts_operation_check` | C | CHECK ((operation = ANY (ARRAY['upsert'::text, 'withdraw'::text]))) |
| `staging_scripts_pkey` | P | PRIMARY KEY (staging_id) |
| `staging_scripts_quality_status_check` | C | CHECK ((quality_status = ANY (ARRAY['clean'::text, 'quarantined'::text]))) |
| `staging_scripts_source_ref_check` | C | CHECK ((source_ref ~ '^SRC-[A-Z0-9][A-Z0-9._-]{0,126}$'::text)) |
| `staging_source_version_fk` | F | FOREIGN KEY (source_version_id, category, source_ref) REFERENCES authoritative_source_versions(source_version_id, domain, source_ref) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_staging_batch` | CREATE INDEX idx_staging_batch ON public.staging_scripts USING btree (import_batch_id) |
| `staging_batch_script_unique` | CREATE UNIQUE INDEX staging_batch_script_unique ON public.staging_scripts USING btree (import_batch_id, script_id) |
| `staging_scripts_pkey` | CREATE UNIQUE INDEX staging_scripts_pkey ON public.staging_scripts USING btree (staging_id) |

### v_release_source_gate

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `release_id` | `text` | 是 |  |  |
| `release_seq` | `bigint` | 是 |  |  |
| `source_binding_hash` | `text` | 是 |  |  |
| `source_gate_ready` | `boolean` | 是 |  |  |
| `source_gate_reason` | `text` | 是 |  |  |
| `runtime_error_reason` | `text` | 是 |  |  |

### v_scripts_recommendable

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `script_id` | `text` | 是 |  |  |
| `category` | `text` | 是 |  |  |
| `title` | `text` | 是 |  |  |
| `answer_text` | `text` | 是 |  |  |
| `version` | `integer` | 是 |  |  |
| `content_hash` | `text` | 是 |  |  |
| `source_ref` | `text` | 是 |  |  |
| `source_version_id` | `text` | 是 |  |  |
| `owner_role` | `text` | 是 |  |  |
| `review_due_at` | `timestamp with time zone` | 是 |  |  |
| `platform_scope` | `text[]` | 是 |  |  |
| `product_scope_type` | `text` | 是 |  |  |
| `product_scope_refs` | `text[]` | 是 |  |  |
| `effective_from` | `timestamp with time zone` | 是 |  |  |
| `effective_to` | `timestamp with time zone` | 是 |  |  |
| `intent_taxonomy_version` | `text` | 是 |  |  |
| `intent_id` | `text` | 是 |  |  |
| `risk_level` | `text` | 是 |  |  |
| `risk_categories` | `text[]` | 是 |  |  |
| `has_conflict` | `boolean` | 是 |  |  |
| `review_mode` | `text` | 是 |  |  |
| `primary_reviewer_role` | `text` | 是 |  |  |
| `primary_review_evd` | `text` | 是 |  |  |
| `secondary_reviewer_role` | `text` | 是 |  |  |
| `secondary_review_evd` | `text` | 是 |  |  |
| `placeholder_keys` | `text[]` | 是 |  |  |
| `questions_json` | `jsonb` | 是 |  |  |
| `search_document` | `tsvector` | 是 |  |  |
| `search_fallback_text` | `text` | 是 |  |  |
| `release_id` | `text` | 是 |  |  |
| `source_binding_hash` | `text` | 是 |  |  |

### vw_owner_agent_daily

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `day` | `timestamp with time zone` | 是 |  |  |
| `agent` | `text` | 是 |  |  |
| `questions` | `bigint` | 是 |  |  |
| `matched` | `bigint` | 是 |  |  |
| `copied` | `bigint` | 是 |  |  |
| `copy_rate` | `numeric` | 是 |  |  |

### vw_owner_asked_questions

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `asked_at` | `timestamp with time zone` | 是 |  |  |
| `agent` | `text` | 是 |  |  |
| `question` | `text` | 是 |  |  |
| `library_matched` | `boolean` | 是 |  |  |
| `library_version` | `text` | 是 |  |  |
| `platform` | `text` | 是 |  |  |
| `waited_ms` | `integer` | 是 |  |  |
| `question_retention` | `text` | 是 |  |  |

### vw_owner_shown_scripts

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `asked_at` | `timestamp with time zone` | 是 |  |  |
| `agent` | `text` | 是 |  |  |
| `shown_rank` | `integer` | 是 |  |  |
| `script` | `text` | 是 |  |  |
| `script_version` | `integer` | 是 |  |  |
| `copied_to_clipboard` | `boolean` | 是 |  |  |
| `copy_method` | `text` | 是 |  |  |
| `library_version` | `text` | 是 |  |  |
| `agent_snapshot_version` | `text` | 是 |  |  |
| `snapshot_was_stale` | `boolean` | 是 |  |  |

### vw_owner_unmatched_questions

类型：VIEW

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `asked_at` | `timestamp with time zone` | 是 |  |  |
| `agent` | `text` | 是 |  |  |
| `question` | `text` | 是 |  |  |
| `library_version` | `text` | 是 |  |  |
| `platform` | `text` | 是 |  |  |

### work_order_export_audits

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `export_id` | `text` | 否 |  |  |
| `tenant_scope` | `text` | 否 |  |  |
| `actor_user_id` | `text` | 否 |  |  |
| `actor_role` | `text` | 否 |  |  |
| `filter_hash` | `text` | 否 |  |  |
| `field_set` | `text[]` | 否 |  |  |
| `row_count` | `integer` | 否 |  |  |
| `result` | `text` | 否 |  |  |
| `diagnostic_id` | `text` | 是 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `work_order_export_audits_actor_role_check` | C | CHECK ((actor_role = ANY (ARRAY['coach'::text, 'owner'::text]))) |
| `work_order_export_audits_filter_hash_check` | C | CHECK ((filter_hash ~ '^[0-9a-f]{64}$'::text)) |
| `work_order_export_audits_pkey` | P | PRIMARY KEY (export_id) |
| `work_order_export_audits_result_check` | C | CHECK ((result = ANY (ARRAY['succeeded'::text, 'denied'::text, 'failed'::text]))) |
| `work_order_export_audits_row_count_check` | C | CHECK ((row_count >= 0)) |
| `work_order_export_diagnostic_shape` | C | CHECK ((((result = 'succeeded'::text) AND (diagnostic_id IS NULL)) OR ((result = ANY (ARRAY['denied'::text, 'failed'::text])) AND (diagnostic_id ~ '^diag_[0-9a-f]{32}$'::text)))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_work_order_export_audits_actor_created` | CREATE INDEX idx_work_order_export_audits_actor_created ON public.work_order_export_audits USING btree (actor_user_id, created_at DESC) |
| `work_order_export_audits_pkey` | CREATE UNIQUE INDEX work_order_export_audits_pkey ON public.work_order_export_audits USING btree (export_id) |

### work_order_import_batches

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `import_batch_id` | `text` | 否 |  |  |
| `tenant_scope` | `text` | 否 |  |  |
| `source_system` | `text` | 否 |  |  |
| `source_ref` | `text` | 是 |  |  |
| `source_file_name_safe` | `text` | 是 |  |  |
| `source_sha256` | `text` | 否 |  |  |
| `source_size_bytes` | `bigint` | 否 |  |  |
| `mapping_version` | `text` | 否 |  |  |
| `status` | `text` | 否 | `'validating'::text` |  |
| `record_count` | `integer` | 否 | `0` |  |
| `accepted_count` | `integer` | 否 | `0` |  |
| `rejected_count` | `integer` | 否 | `0` |  |
| `data_from` | `timestamp with time zone` | 是 |  |  |
| `data_to` | `timestamp with time zone` | 是 |  |  |
| `error_report` | `jsonb` | 是 |  |  |
| `actor_user_id` | `text` | 否 |  |  |
| `actor_role` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `completed_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `work_order_import_batches_accepted_count_check` | C | CHECK ((accepted_count >= 0)) |
| `work_order_import_batches_actor_role_check` | C | CHECK ((actor_role = ANY (ARRAY['coach'::text, 'owner'::text]))) |
| `work_order_import_batches_pkey` | P | PRIMARY KEY (import_batch_id) |
| `work_order_import_batches_record_count_check` | C | CHECK ((record_count >= 0)) |
| `work_order_import_batches_rejected_count_check` | C | CHECK ((rejected_count >= 0)) |
| `work_order_import_batches_source_sha256_check` | C | CHECK ((source_sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `work_order_import_batches_source_size_bytes_check` | C | CHECK ((source_size_bytes >= 0)) |
| `work_order_import_batches_status_check` | C | CHECK ((status = ANY (ARRAY['received'::text, 'validating'::text, 'ready'::text, 'failed'::text]))) |
| `work_order_import_counts` | C | CHECK (((status <> ALL (ARRAY['ready'::text, 'failed'::text])) OR (record_count = (accepted_count + rejected_count)))) |
| `work_order_import_dates` | C | CHECK (((data_from IS NULL) OR (data_to IS NULL) OR (data_to >= data_from))) |
| `work_order_import_error_report_shape` | C | CHECK (((((status = 'failed'::text) AND (error_report IS NOT NULL) AND (jsonb_typeof(error_report) = 'object'::text) AND (error_report ?& ARRAY['code'::text, 'diagnostic_id'::text]) AND ((error_report ->> 'code'::text) = ANY (ARRAY['VALIDATION_FAILED'::text, 'SOURCE_UNREADABLE'::text, 'HASH_MISMATCH'::text, 'UNSUPPORTED_FORMAT'::text, 'STORAGE_UNAVAILABLE'::text, 'MAX_ATTEMPTS_EXHAUSTED'::text])) AND (COALESCE((error_report ->> 'diagnostic_id'::text), ''::text) ~ '^diag_[0-9a-f]{32}$'::text) AND ((error_report - ARRAY['code'::text, 'diagnostic_id'::text, 'row'::text, 'column'::text, 'error_count'::text, 'issue_codes'::text]) = '{}'::jsonb) AND CASE WHEN (error_report ? 'row'::text) THEN ((jsonb_typeof((error_report -> 'row'::text)) = 'number'::text) AND ((error_report ->> 'row'::text) ~ '^[1-9][0-9]{0,8}$'::text)) ELSE true END AND CASE WHEN (error_report ? 'column'::text) THEN ((jsonb_typeof((error_report -> 'column'::text)) = 'number'::text) AND ((error_report ->> 'column'::text) ~ '^[1-9][0-9]{0,8}$'::text)) ELSE true END AND CASE WHEN (error_report ? 'error_count'::text) THEN ((jsonb_typeof((error_report -> 'error_count'::text)) = 'number'::text) AND ((error_report ->> 'error_count'::text) ~ '^[1-9][0-9]{0,8}$'::text)) ELSE true END AND work_order_issue_codes_are_public((error_report -> 'issue_codes'::text))) IS TRUE) OR (((status <> 'failed'::text) AND (error_report IS NULL)) IS TRUE))) |
| `work_order_import_source_unique` | U | UNIQUE (tenant_scope, source_sha256, mapping_version) |
| `work_order_import_terminal_shape` | C | CHECK ((((status = ANY (ARRAY['received'::text, 'validating'::text])) AND (completed_at IS NULL)) OR ((status = 'ready'::text) AND (completed_at IS NOT NULL) AND (error_report IS NULL)) OR ((status = 'failed'::text) AND (completed_at IS NOT NULL) AND (error_report IS NOT NULL)))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_work_order_batches_scope_created` | CREATE INDEX idx_work_order_batches_scope_created ON public.work_order_import_batches USING btree (tenant_scope, created_at DESC, import_batch_id DESC) |
| `work_order_import_batches_pkey` | CREATE UNIQUE INDEX work_order_import_batches_pkey ON public.work_order_import_batches USING btree (import_batch_id) |
| `work_order_import_source_unique` | CREATE UNIQUE INDEX work_order_import_source_unique ON public.work_order_import_batches USING btree (tenant_scope, source_sha256, mapping_version) |

### work_order_records

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `record_id` | `text` | 否 |  |  |
| `import_batch_id` | `text` | 否 |  |  |
| `tenant_scope` | `text` | 否 |  |  |
| `source_record_hash` | `text` | 否 |  |  |
| `category` | `text` | 是 |  |  |
| `issue_type` | `text` | 是 |  |  |
| `product_ref_hash` | `text` | 是 |  |  |
| `channel` | `text` | 是 |  |  |
| `record_status` | `text` | 是 |  |  |
| `opened_at` | `timestamp with time zone` | 是 |  |  |
| `closed_at` | `timestamp with time zone` | 是 |  |  |
| `handling_seconds` | `integer` | 是 |  |  |
| `error_type` | `text` | 是 |  |  |
| `escalated` | `boolean` | 否 | `false` |  |
| `quality_tags` | `text[]` | 否 | `'{}'::text[]` |  |
| `normalization_version` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `work_order_record_source_unique` | U | UNIQUE (import_batch_id, source_record_hash) |
| `work_order_record_times` | C | CHECK (((opened_at IS NULL) OR (closed_at IS NULL) OR (closed_at >= opened_at))) |
| `work_order_records_handling_seconds_check` | C | CHECK (((handling_seconds IS NULL) OR (handling_seconds >= 0))) |
| `work_order_records_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES work_order_import_batches(import_batch_id) |
| `work_order_records_pkey` | P | PRIMARY KEY (record_id) |
| `work_order_records_product_ref_hash_check` | C | CHECK (((product_ref_hash IS NULL) OR (product_ref_hash ~ '^[0-9a-f]{64}$'::text))) |
| `work_order_records_source_record_hash_check` | C | CHECK ((source_record_hash ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `idx_work_order_records_batch` | CREATE INDEX idx_work_order_records_batch ON public.work_order_records USING btree (import_batch_id, record_id) |
| `idx_work_order_records_dimensions` | CREATE INDEX idx_work_order_records_dimensions ON public.work_order_records USING btree (tenant_scope, channel, category, issue_type, record_status, error_type) |
| `idx_work_order_records_scope_opened` | CREATE INDEX idx_work_order_records_scope_opened ON public.work_order_records USING btree (tenant_scope, opened_at DESC, record_id DESC) |
| `work_order_record_source_unique` | CREATE UNIQUE INDEX work_order_record_source_unique ON public.work_order_records USING btree (import_batch_id, source_record_hash) |
| `work_order_records_pkey` | CREATE UNIQUE INDEX work_order_records_pkey ON public.work_order_records USING btree (record_id) |

## 函数（168）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `ack_client_release` | `p_client_id text, p_user_id text, p_release_id text, p_release_seq bigint, p_offline_lease_token text` | boolean | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `advance_source_snapshots` | `p_source_bindings jsonb, p_snapshot_sha256 text, p_actor_user_id text, p_import_batch_id text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `armor` | `bytea` | text | c | 否 |  | 扩展 `pgcrypto` |
| `armor` | `bytea, text[], text[]` | text | c | 否 |  | 扩展 `pgcrypto` |
| `assert_no_in_flight_content_import` | `p_actor_user_id text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `assert_owner_acceptance` | `p_tenant text, p_sha256 text, p_owner_hash text, p_purpose text, p_observed_scope jsonb` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `assert_owner_acceptance_content` | `p_tenant text, p_record_sha256 text, p_expected_owner_hash text, p_source_version_ids text[], p_content jsonb` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `cancel_actor_in_flight_imports` | `p_actor_user_id text, p_actor_role text` | integer | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `cancel_content_import` | `p_import_batch_id text, p_reason text, p_actor_user_id text, p_actor_role text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `claim_content_import_validation` | `p_lease_owner text, p_lease_seconds integer` | TABLE(claimed_job_id text, claimed_job_type text, job_payload jsonb, claimed_lease_version bigint) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `claim_work_order_import_validation` | `p_lease_owner text, p_lease_seconds integer` | TABLE(claimed_job_id text, claimed_job_type text, job_payload jsonb, claimed_lease_version bigint) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `close_iteration_task` | `p_task_id text, p_expected_version integer, p_status text, p_resolution_note text, p_actor_user_id text, p_actor_role text` | iteration_tasks | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_governance_hash` | `p_script_id text, p_category text, p_title text, p_answer_text text, p_source_ref text, p_source_version_id text, p_owner_role text, p_review_due_at timestamp with time zone, p_platform_scope text[], p_product_scope_type text, p_product_scope_refs text[], p_effective_from timestamp with time zone, p_effective_to timestamp with time zone, p_intent_taxonomy_version text, p_intent_id text, p_risk_level text, p_risk_categories text[], p_has_conflict boolean, p_review_mode text, p_primary_reviewer_id text, p_primary_reviewer_role text, p_primary_review_evd text, p_secondary_reviewer_id text, p_secondary_reviewer_role text, p_secondary_review_evd text, p_placeholder_keys text[], p_questions jsonb` | text | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_governance_snapshot` | `p_script_id text, p_category text, p_title text, p_answer_text text, p_source_ref text, p_source_version_id text, p_owner_role text, p_review_due_at timestamp with time zone, p_platform_scope text[], p_product_scope_type text, p_product_scope_refs text[], p_effective_from timestamp with time zone, p_effective_to timestamp with time zone, p_intent_taxonomy_version text, p_intent_id text, p_risk_level text, p_risk_categories text[], p_has_conflict boolean, p_review_mode text, p_primary_reviewer_id text, p_primary_reviewer_role text, p_primary_review_evd text, p_secondary_reviewer_id text, p_secondary_reviewer_role text, p_secondary_review_evd text, p_placeholder_keys text[], p_questions jsonb` | jsonb | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_public_questions` | `p_questions jsonb` | jsonb | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_quality_issue_codes_are_public` | `p_codes jsonb` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_quality_population_manifest_hash` | `p_rows jsonb` | text | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_quality_staging_population_manifest_hash` | `p_import_batch_id text` | text | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_question_hash` | `p_question jsonb` | text | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_questions_align_intent` | `p_questions jsonb, p_intent_taxonomy_version text, p_intent_id text` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_questions_are_valid` | `p_questions jsonb` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_questions_source_assets_are_active` | `p_questions jsonb` | boolean | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_risk_categories_are_valid` | `p_risk_level text, p_risk_categories text[]` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_scope_matches` | `p_platform_scope text[], p_product_scope_type text, p_product_scope_refs text[], p_platform text, p_product_context_type text, p_product_context_ref text` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_template_placeholders_are_valid` | `p_answer_text text, p_placeholder_keys text[]` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_text_array_is_nonblank_unique` | `p_values text[]` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `content_utc_timestamp_text` | `p_value timestamp with time zone` | text | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `crypt` | `text, text` | text | c | 否 |  | 扩展 `pgcrypto` |
| `dearmor` | `text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `decrypt` | `bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `decrypt_iv` | `bytea, bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `digest` | `bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `digest` | `text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `encrypt` | `bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `encrypt_iv` | `bytea, bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `enqueue_content_import` | `p_import_batch_id text, p_source_type text, p_source_ref text, p_source_sha256 text, p_source_size_bytes bigint, p_source_bindings jsonb, p_actor_user_id text, p_actor_role text` | TABLE(import_batch_id text, status text, job_id text, source_binding_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `enqueue_work_order_import` | `p_import_batch_id text, p_tenant_scope text, p_source_system text, p_source_ref text, p_source_file_name_safe text, p_source_sha256 text, p_source_size_bytes bigint, p_mapping_version text, p_data_from timestamp with time zone, p_data_to timestamp with time zone, p_actor_user_id text, p_actor_role text` | TABLE(import_batch_id text, status text, job_id text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `finalize_content_import_validation` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_import_batch_id text, p_final_status text, p_staging_rows jsonb, p_error_report jsonb` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `finalize_org_reviewed_import_validation` | `p_job text, p_owner text, p_lease bigint, p_batch text, p_rows jsonb` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `finalize_work_order_import_validation` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_import_batch_id text, p_final_status text, p_records jsonb, p_rejected_count integer, p_error_report jsonb` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `freeze_content_quality_review_plan` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_import_batch_id text, p_plan_id text, p_sampling_policy_version text, p_cutoff_at timestamp with time zone, p_clean_population_count integer, p_ordinary_population_count integer, p_mandatory_full_review_count integer, p_selection_seed_hash text, p_selection_manifest_hash text, p_selection_algorithm text, p_population_rows jsonb` | TABLE(frozen_plan_id text, initial_sample_target integer, expanded_sample_target integer) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `gen_random_bytes` | `integer` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `gen_random_uuid` | `` | uuid | c | 否 |  | 扩展 `pgcrypto` |
| `gen_salt` | `text` | text | c | 否 |  | 扩展 `pgcrypto` |
| `gen_salt` | `text, integer` | text | c | 否 |  | 扩展 `pgcrypto` |
| `gin_extract_query_trgm` | `text, internal, smallint, internal, internal, internal, internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gin_extract_value_trgm` | `text, internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gin_trgm_consistent` | `internal, smallint, text, integer, internal, internal, internal, internal` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `gin_trgm_triconsistent` | `internal, smallint, text, integer, internal, internal, internal` | "char" | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_compress` | `internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_consistent` | `internal, text, smallint, oid, internal` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_decompress` | `internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_distance` | `internal, text, smallint, oid, internal` | double precision | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_in` | `cstring` | gtrgm | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_options` | `internal` | void | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_out` | `gtrgm` | cstring | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_penalty` | `internal, internal, internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_picksplit` | `internal, internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_same` | `gtrgm, gtrgm, internal` | internal | c | 否 |  | 扩展 `pg_trgm` |
| `gtrgm_union` | `internal, internal` | gtrgm | c | 否 |  | 扩展 `pg_trgm` |
| `heartbeat_content_import_validation` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_extend_seconds integer` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `heartbeat_work_order_import_validation` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_extend_seconds integer` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `hmac` | `bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `hmac` | `text, text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `idempotency_claim` | `p_scope text, p_idem_key text, p_user_id text, p_request_hash text, p_request_hash_key_version text, p_lease_owner text, p_lease_seconds integer` | TABLE(action text, status_code integer, response_body jsonb, detail text, lease_version bigint) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `idempotency_complete` | `p_scope text, p_idem_key text, p_lease_owner text, p_lease_version bigint, p_status_code integer, p_response_body jsonb, p_ok boolean` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `idempotency_heartbeat` | `p_scope text, p_idem_key text, p_lease_owner text, p_lease_version bigint, p_extend_seconds integer` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `idempotency_lookup` | `p_scope text, p_idem_key text, p_user_id text, p_request_hash text, p_request_hash_key_version text` | TABLE(action text, status_code integer, response_body jsonb, detail text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `idempotency_request_hash_version` | `p_scope text, p_idem_key text, p_user_id text` | text | sql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `import_issue_codes_are_public` | `p_codes jsonb` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `issue_snapshot_offline_lease` | `p_client_id text, p_user_id text, p_ttl_seconds integer` | TABLE(offline_lease_token text, lease_expires_at timestamp with time zone, release_id text, source_binding_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `jsonb_jcs` | `p_value jsonb` | text | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `outbox_claim` | `p_job_type text, p_lease_owner text, p_lease_seconds integer` | TABLE(claimed_job_id text, claimed_job_type text, job_payload jsonb, claimed_lease_version bigint) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `outbox_complete` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_final_status text, p_last_error text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `outbox_heartbeat` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_extend_seconds integer` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `outbox_retry` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_retry_after_seconds integer, p_last_error text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_active_record` | `p_tenant text, p_sha256 text, p_owner_hash text` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_content_hash` | `p_snapshot jsonb, p_script_version integer, p_record_sha256 text` | text | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_immutable` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_instant` | `p_value jsonb` | timestamp with time zone | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_keys` | `p_value jsonb, p_keys text[]` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_release_content_ready` | `p_release_id text` | boolean | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_release_ready` | `p_release_id text` | boolean | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_review_input_sha256` | `p_snapshot jsonb, p_script_version integer` | text | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_review_shape` | `p_risk text, p_conflict boolean, p_mode text, p_primary text, p_role text, p_evd text, p_secondary text, p_secondary_role text, p_secondary_evd text, p_record_sha256 text` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_sources_ready` | `p_tenant text, p_record jsonb` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_storage_guard` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `owner_acceptance_validate_record` | `p_record jsonb` | void | plpgsql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `pgp_armor_headers` | `text, OUT key text, OUT value text` | SETOF record | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_key_id` | `bytea` | text | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_decrypt` | `bytea, bytea` | text | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_decrypt` | `bytea, bytea, text` | text | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_decrypt` | `bytea, bytea, text, text` | text | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_decrypt_bytea` | `bytea, bytea` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_decrypt_bytea` | `bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_decrypt_bytea` | `bytea, bytea, text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_encrypt` | `text, bytea` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_encrypt` | `text, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_encrypt_bytea` | `bytea, bytea` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_pub_encrypt_bytea` | `bytea, bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_decrypt` | `bytea, text` | text | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_decrypt` | `bytea, text, text` | text | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_decrypt_bytea` | `bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_decrypt_bytea` | `bytea, text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_encrypt` | `text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_encrypt` | `text, text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_encrypt_bytea` | `bytea, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `pgp_sym_encrypt_bytea` | `bytea, text, text` | bytea | c | 否 |  | 扩展 `pgcrypto` |
| `publish_content_release` | `p_import_batch_id text, p_title text, p_summary text, p_actor_user_id text, p_actor_role text` | TABLE(release_id text, release_seq bigint, announcement_id text, source_binding_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `rate_limit_take` | `p_bucket_key text, p_capacity double precision, p_refill_per_sec double precision, p_cost double precision` | TABLE(allowed boolean, retry_after_sec integer, tokens_left double precision) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `read_content_import_preview` | `p_import_batch_id text, p_actor_user_id text, p_actor_role text, p_cursor text, p_limit integer` | TABLE(rows_json jsonb, next_cursor text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `read_content_import_status` | `p_import_batch_id text, p_actor_user_id text, p_actor_role text` | TABLE(import_batch_id text, status text, quality_gate_passed boolean, clean_count integer, quarantined_count integer, error_report jsonb, created_at timestamp with time zone, finished_at timestamp with time zone) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `read_current_announcement_with_lease` | `p_client_id text, p_user_id text, p_ttl_seconds integer` | TABLE(current_release_id text, release_seq bigint, source_binding_hash text, offline_lease_token text, lease_expires_at timestamp with time zone, announcement_id text, announcement_title text, announcement_summary text, announcement_created_at timestamp with time zone) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `read_snapshot_page` | `p_offline_lease_token text, p_client_id text, p_user_id text, p_release_id text, p_cursor text, p_limit integer` | TABLE(release_id text, release_seq bigint, source_binding_hash text, lease_expires_at timestamp with time zone, items_json jsonb, next_cursor text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `reconcile_exhausted_content_imports` | `p_limit integer` | integer | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `reconcile_exhausted_work_order_imports` | `p_limit integer` | integer | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_admin_source_denial_audit` | `p_denial_key text, p_operation text, p_reason_code text, p_actor_subject_hash text, p_hash_key_version text, p_actor_role text, p_release_id text, p_source_version_id text, p_source_binding_hash text, p_diagnostic_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_content_quality_review_evidence` | `p_plan_id text, p_initial_sample_reviewed_count integer, p_initial_defect_count integer, p_expanded_sample_reviewed_count integer, p_expanded_defect_count integer, p_mandatory_reviewed_count integer, p_mandatory_defect_count integer, p_publishable_clean_count integer, p_review_quarantined_count integer, p_conclusion text, p_evidence_ref text, p_actor_capability text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_content_review_decision` | `p_decision_id text, p_script_id text, p_content_hash text, p_reviewer_role text, p_reviewer_subject_hash text, p_reviewer_subject_key_version text, p_evidence_ref text, p_decision text, p_decided_at timestamp with time zone, p_actor_capability text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_org_reviewed_quality_evidence` | `p_job text, p_owner text, p_lease bigint, p_batch text, p_plan text, p_rows jsonb` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_runtime_source_denial_audit` | `p_denial_key text, p_operation text, p_reason_code text, p_actor_subject_hash text, p_hash_key_version text, p_actor_role text, p_release_id text, p_source_version_id text, p_source_binding_hash text, p_diagnostic_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_source_denial_audit` | `p_denial_key text, p_operation text, p_reason_code text, p_actor_subject_hash text, p_hash_key_version text, p_actor_role text, p_release_id text, p_source_version_id text, p_source_binding_hash text, p_diagnostic_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_work_order_export` | `p_tenant_scope text, p_actor_user_id text, p_actor_role text, p_filter_hash text, p_field_set text[], p_row_count integer, p_result text, p_diagnostic_id text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `register_owner_acceptance` | `p_tenant text, p_raw_record text, p_approved_sha256 text, p_expected_owner_hash text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `resolve_previous_content_release` | `p_actor_user_id text` | TABLE(release_id text, release_seq bigint) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `restore_source_snapshots` | `p_import_batch_id text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `retire_semantic_source_asset` | `p_source_asset_id text, p_retirement_evd text, p_actor_subject_hash text, p_actor_subject_key_version text, p_actor_role text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `retry_content_import_validation` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_retry_after_seconds integer, p_last_error text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `retry_work_order_import_validation` | `p_job_id text, p_lease_owner text, p_lease_version bigint, p_retry_after_seconds integer, p_last_error text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `revoke_owner_acceptance` | `p_tenant text, p_sha256 text, p_evidence text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `rollback_content_release` | `p_target_release_id text, p_title text, p_summary text, p_actor_user_id text, p_actor_role text` | TABLE(release_id text, release_seq bigint, announcement_id text, rollback_of_release_id text, source_binding_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `search_recommendable_scripts` | `p_actor_user_id text, p_platform text, p_product_context_type text, p_product_context_ref text` | TABLE(is_candidate boolean, script_id text, script_version integer, content_hash text, title text, category text, answer_text text, platform_scope text[], product_scope_type text, product_scope_refs text[], effective_from timestamp with time zone, effective_to timestamp with time zone, intent_taxonomy_version text, intent_id text, risk_level text, risk_categories text[], has_conflict boolean, placeholder_keys text[], questions jsonb, search_document tsvector, search_fallback_text text, release_id text, source_binding_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `search_recommendable_scripts` | `p_platform text, p_product_context_type text, p_product_context_ref text` | TABLE(is_candidate boolean, script_id text, script_version integer, content_hash text, title text, category text, answer_text text, platform_scope text[], product_scope_type text, product_scope_refs text[], effective_from timestamp with time zone, effective_to timestamp with time zone, intent_taxonomy_version text, intent_id text, risk_level text, risk_categories text[], has_conflict boolean, placeholder_keys text[], questions jsonb, search_document tsvector, search_fallback_text text, release_id text, source_binding_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `set_limit` | `real` | real | c | 否 |  | 扩展 `pg_trgm` |
| `set_policy_flag` | `p_flag_key text, p_flag_value boolean, p_actor_user_id text, p_actor_role text, p_adr_id text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `show_limit` | `` | real | c | 否 |  | 扩展 `pg_trgm` |
| `show_trgm` | `text` | text[] | c | 否 |  | 扩展 `pg_trgm` |
| `similarity` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `similarity_dist` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `similarity_op` | `text, text` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `start_iteration_task` | `p_task_id text, p_expected_version integer, p_actor_user_id text, p_actor_role text` | iteration_tasks | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `strict_word_similarity` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `strict_word_similarity_commutator_op` | `text, text` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `strict_word_similarity_dist_commutator_op` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `strict_word_similarity_dist_op` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `strict_word_similarity_op` | `text, text` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `suspend_authoritative_source` | `p_source_version_id text, p_reason_code text, p_evidence_ref text, p_actor_user_id text, p_actor_role text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_authoritative_source_suspension_insert_guard` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `trg_import_source_binding_insert_guard` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `trg_iteration_task_audit` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_iteration_task_guard` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_query_lineage_guard` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_release_items_immutable` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `trg_release_source_binding_guard` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `trg_release_source_set_complete` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_restore_snapshots_on_import_failed` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_scripts_protect_published` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `trg_semantic_source_asset_guard` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_source_gate_search_telemetry_guard` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `trg_source_history_immutable` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `trg_staging_mutable_while_validating` | `` | trigger | plpgsql | 否 |  | 本仓 |
| `validate_snapshot_offline_lease` | `p_offline_lease_token text, p_client_id text, p_user_id text, p_release_id text` | TABLE(release_id text, release_seq bigint, source_binding_hash text, lease_expires_at timestamp with time zone) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `word_similarity` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `word_similarity_commutator_op` | `text, text` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `word_similarity_dist_commutator_op` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `word_similarity_dist_op` | `text, text` | real | c | 否 |  | 扩展 `pg_trgm` |
| `word_similarity_op` | `text, text` | boolean | c | 否 |  | 扩展 `pg_trgm` |
| `work_order_issue_codes_are_public` | `p_codes jsonb` | boolean | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |

## 触发器（33）

| 触发器 | 表 | 定义 | 状态 |
| --- | --- | --- | --- |
| `authoritative_source_suspension_insert_guard` | `authoritative_source_suspensions` | CREATE TRIGGER authoritative_source_suspension_insert_guard BEFORE INSERT ON public.authoritative_source_suspensions FOR EACH ROW EXECUTE FUNCTION trg_authoritative_source_suspension_insert_guard() | 启用 |
| `authoritative_source_suspensions_immutable` | `authoritative_source_suspensions` | CREATE TRIGGER authoritative_source_suspensions_immutable BEFORE DELETE OR UPDATE ON public.authoritative_source_suspensions FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `authoritative_source_versions_immutable` | `authoritative_source_versions` | CREATE TRIGGER authoritative_source_versions_immutable BEFORE DELETE OR UPDATE ON public.authoritative_source_versions FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `impression_source_gate_telemetry_guard` | `candidate_impressions` | CREATE TRIGGER impression_source_gate_telemetry_guard BEFORE INSERT ON public.candidate_impressions FOR EACH ROW EXECUTE FUNCTION trg_source_gate_search_telemetry_guard() | 启用 |
| `change_audits_immutable` | `change_audits` | CREATE TRIGGER change_audits_immutable BEFORE DELETE OR UPDATE ON public.change_audits FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `content_quality_review_evidence_immutable` | `content_quality_review_evidence` | CREATE TRIGGER content_quality_review_evidence_immutable BEFORE DELETE OR UPDATE ON public.content_quality_review_evidence FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `content_quality_review_plans_immutable` | `content_quality_review_plans` | CREATE TRIGGER content_quality_review_plans_immutable BEFORE DELETE OR UPDATE ON public.content_quality_review_plans FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `release_source_set_complete` | `content_releases` | CREATE CONSTRAINT TRIGGER release_source_set_complete AFTER INSERT ON public.content_releases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_release_source_set_complete() | 启用 |
| `content_review_decisions_immutable` | `content_review_decisions` | CREATE TRIGGER content_review_decisions_immutable BEFORE DELETE OR UPDATE ON public.content_review_decisions FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `import_batch_source_bindings_immutable` | `import_batch_source_bindings` | CREATE TRIGGER import_batch_source_bindings_immutable BEFORE DELETE OR UPDATE ON public.import_batch_source_bindings FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `import_source_binding_insert_guard` | `import_batch_source_bindings` | CREATE TRIGGER import_source_binding_insert_guard BEFORE INSERT ON public.import_batch_source_bindings FOR EACH ROW EXECUTE FUNCTION trg_import_source_binding_insert_guard() | 启用 |
| `backend_review_sync_wait_on_batch_failed` | `import_batches` | CREATE TRIGGER backend_review_sync_wait_on_batch_failed AFTER UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION backend_review.sync_wait_on_batch_failed() | 停用 |
| `import_batches_restore_snapshots` | `import_batches` | CREATE TRIGGER import_batches_restore_snapshots AFTER UPDATE OF status ON public.import_batches FOR EACH ROW EXECUTE FUNCTION trg_restore_snapshots_on_import_failed() | 停用 |
| `intent_taxonomy_entries_immutable` | `intent_taxonomy_entries` | CREATE TRIGGER intent_taxonomy_entries_immutable BEFORE DELETE OR UPDATE ON public.intent_taxonomy_entries FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `intent_taxonomy_mappings_immutable` | `intent_taxonomy_mappings` | CREATE TRIGGER intent_taxonomy_mappings_immutable BEFORE DELETE OR UPDATE ON public.intent_taxonomy_mappings FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `intent_taxonomy_versions_immutable` | `intent_taxonomy_versions` | CREATE TRIGGER intent_taxonomy_versions_immutable BEFORE DELETE OR UPDATE ON public.intent_taxonomy_versions FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `iteration_task_audit` | `iteration_tasks` | CREATE TRIGGER iteration_task_audit AFTER INSERT OR UPDATE ON public.iteration_tasks FOR EACH ROW EXECUTE FUNCTION trg_iteration_task_audit() | 启用 |
| `iteration_task_guard` | `iteration_tasks` | CREATE TRIGGER iteration_task_guard BEFORE INSERT OR UPDATE ON public.iteration_tasks FOR EACH ROW EXECUTE FUNCTION trg_iteration_task_guard() | 启用 |
| `owner_acceptance_records_immutable` | `owner_acceptance_records` | CREATE TRIGGER owner_acceptance_records_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.owner_acceptance_records FOR EACH STATEMENT EXECUTE FUNCTION owner_acceptance_immutable() | 启用 |
| `owner_acceptance_revocations_immutable` | `owner_acceptance_revocations` | CREATE TRIGGER owner_acceptance_revocations_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.owner_acceptance_revocations FOR EACH STATEMENT EXECUTE FUNCTION owner_acceptance_immutable() | 启用 |
| `query_lineage_guard` | `query_events` | CREATE TRIGGER query_lineage_guard BEFORE INSERT OR UPDATE ON public.query_events FOR EACH ROW EXECUTE FUNCTION trg_query_lineage_guard() | 启用 |
| `query_source_gate_telemetry_guard` | `query_events` | CREATE TRIGGER query_source_gate_telemetry_guard BEFORE INSERT ON public.query_events FOR EACH ROW EXECUTE FUNCTION trg_source_gate_search_telemetry_guard() | 启用 |
| `owner_acceptance_storage_guard` | `release_items` | CREATE TRIGGER owner_acceptance_storage_guard BEFORE INSERT OR UPDATE ON public.release_items FOR EACH ROW EXECUTE FUNCTION owner_acceptance_storage_guard() | 启用 |
| `release_items_immutable` | `release_items` | CREATE TRIGGER release_items_immutable BEFORE DELETE OR UPDATE ON public.release_items FOR EACH ROW EXECUTE FUNCTION trg_release_items_immutable() | 启用 |
| `release_source_binding_guard` | `release_source_bindings` | CREATE TRIGGER release_source_binding_guard BEFORE INSERT OR DELETE OR UPDATE ON public.release_source_bindings FOR EACH ROW EXECUTE FUNCTION trg_release_source_binding_guard() | 启用 |
| `script_questions_immutable` | `script_questions` | CREATE TRIGGER script_questions_immutable BEFORE DELETE OR UPDATE ON public.script_questions FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `owner_acceptance_storage_guard` | `scripts` | CREATE TRIGGER owner_acceptance_storage_guard BEFORE INSERT OR UPDATE ON public.scripts FOR EACH ROW EXECUTE FUNCTION owner_acceptance_storage_guard() | 启用 |
| `scripts_protect_published` | `scripts` | CREATE TRIGGER scripts_protect_published BEFORE UPDATE ON public.scripts FOR EACH ROW EXECUTE FUNCTION trg_scripts_protect_published() | 启用 |
| `semantic_source_asset_guard` | `semantic_source_assets` | CREATE TRIGGER semantic_source_asset_guard BEFORE INSERT OR DELETE OR UPDATE ON public.semantic_source_assets FOR EACH ROW EXECUTE FUNCTION trg_semantic_source_asset_guard() | 启用 |
| `snapshot_offline_leases_immutable` | `snapshot_offline_leases` | CREATE TRIGGER snapshot_offline_leases_immutable BEFORE DELETE OR UPDATE ON public.snapshot_offline_leases FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `source_denial_audits_immutable` | `source_denial_audits` | CREATE TRIGGER source_denial_audits_immutable BEFORE DELETE OR UPDATE ON public.source_denial_audits FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable() | 启用 |
| `owner_acceptance_storage_guard` | `staging_scripts` | CREATE TRIGGER owner_acceptance_storage_guard BEFORE INSERT OR UPDATE ON public.staging_scripts FOR EACH ROW EXECUTE FUNCTION owner_acceptance_storage_guard() | 启用 |
| `staging_mutable_while_validating` | `staging_scripts` | CREATE TRIGGER staging_mutable_while_validating BEFORE INSERT OR DELETE OR UPDATE ON public.staging_scripts FOR EACH ROW EXECUTE FUNCTION trg_staging_mutable_while_validating() | 启用 |
