# schema `backend_review`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（3）

### quality_checks

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `plan_id` | `text` | 否 |  |  |
| `review_revision` | `text` | 否 |  |  |
| `phase` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `content_hash` | `text` | 否 |  |  |
| `defect` | `boolean` | 否 |  |  |
| `actor_user_id` | `text` | 否 |  |  |
| `evidence_id` | `text` | 否 |  |  |
| `recorded_at` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `quality_checks_actor_user_id_fkey` | F | FOREIGN KEY (actor_user_id) REFERENCES backend_identity.subject_bindings(user_id) |
| `quality_checks_content_hash_check` | C | CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)) |
| `quality_checks_evidence_id_check` | C | CHECK ((evidence_id ~ '^EVD-[A-Z0-9-]{6,127}$'::text)) |
| `quality_checks_phase_check` | C | CHECK ((phase = ANY (ARRAY['initial'::text, 'expanded'::text]))) |
| `quality_checks_pkey` | P | PRIMARY KEY (plan_id, review_revision, phase, script_id, content_hash) |
| `quality_checks_plan_id_fkey` | F | FOREIGN KEY (plan_id) REFERENCES backend_review.waits(plan_id) |
| `quality_checks_plan_id_review_revision_fkey` | F | FOREIGN KEY (plan_id, review_revision) REFERENCES backend_review.waits(plan_id, review_revision) |
| `quality_checks_review_revision_check` | C | CHECK ((review_revision ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `quality_checks_pkey` | CREATE UNIQUE INDEX quality_checks_pkey ON backend_review.quality_checks USING btree (plan_id, review_revision, phase, script_id, content_hash) |

### receipts

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `actor_user_id` | `text` | 否 |  |  |
| `operation` | `text` | 否 |  |  |
| `request_key` | `text` | 否 |  |  |
| `request_hash` | `text` | 否 |  |  |
| `response` | `jsonb` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `receipts_pkey` | P | PRIMARY KEY (actor_user_id, operation, request_key) |
| `receipts_request_key_check` | C | CHECK (((length(request_key) >= 1) AND (length(request_key) <= 128))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `receipts_pkey` | CREATE UNIQUE INDEX receipts_pkey ON backend_review.receipts USING btree (actor_user_id, operation, request_key) |

### waits

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `import_batch_id` | `text` | 否 |  |  |
| `review_revision` | `text` | 否 |  |  |
| `plan_id` | `text` | 否 |  |  |
| `population_manifest_hash` | `text` | 否 |  |  |
| `object_key` | `text` | 否 |  |  |
| `object_sha256` | `text` | 否 |  |  |
| `object_bytes` | `bigint` | 否 |  |  |
| `parked_job_id` | `text` | 否 |  |  |
| `resumed_job_id` | `text` | 是 |  |  |
| `status` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 |  |  |
| `resumed_at` | `timestamp with time zone` | 是 |  |  |
| `cancelled_at` | `timestamp with time zone` | 是 |  |  |
| `rows` | `jsonb` | 否 | `'[]'::jsonb` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `waits_check` | C | CHECK ((parked_job_id IS DISTINCT FROM resumed_job_id)) |
| `waits_check1` | C | CHECK ((((status = 'waiting'::text) AND (resumed_job_id IS NULL) AND (resumed_at IS NULL) AND (cancelled_at IS NULL)) OR ((status = 'resumed'::text) AND (resumed_job_id IS NOT NULL) AND (resumed_at IS NOT NULL) AND (cancelled_at IS NULL)) OR ((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL)))) |
| `waits_check2` | C | CHECK (((resumed_at IS NULL) OR (resumed_at >= created_at))) |
| `waits_check3` | C | CHECK (((cancelled_at IS NULL) OR (cancelled_at >= created_at))) |
| `waits_import_batch_id_fkey` | F | FOREIGN KEY (import_batch_id) REFERENCES import_batches(import_batch_id) |
| `waits_import_batch_id_review_revision_key` | U | UNIQUE (import_batch_id, review_revision) |
| `waits_object_bytes_check` | C | CHECK (((object_bytes >= 1) AND (object_bytes <= 52428800))) |
| `waits_object_key_check` | C | CHECK ((object_key ~ '^review/[A-Za-z0-9_-]{1,128}$'::text)) |
| `waits_object_sha256_check` | C | CHECK ((object_sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `waits_parked_job_id_fkey` | F | FOREIGN KEY (parked_job_id) REFERENCES outbox_jobs(job_id) |
| `waits_parked_job_id_key` | U | UNIQUE (parked_job_id) |
| `waits_pkey` | P | PRIMARY KEY (import_batch_id) |
| `waits_plan_id_import_batch_id_population_manifest_hash_fkey` | F | FOREIGN KEY (plan_id, import_batch_id, population_manifest_hash) REFERENCES content_quality_review_plans(plan_id, import_batch_id, population_manifest_hash) |
| `waits_plan_id_key` | U | UNIQUE (plan_id) |
| `waits_plan_id_review_revision_key` | U | UNIQUE (plan_id, review_revision) |
| `waits_population_manifest_hash_check` | C | CHECK ((population_manifest_hash ~ '^[0-9a-f]{64}$'::text)) |
| `waits_resumed_job_id_fkey` | F | FOREIGN KEY (resumed_job_id) REFERENCES outbox_jobs(job_id) |
| `waits_resumed_job_id_key` | U | UNIQUE (resumed_job_id) |
| `waits_review_revision_check` | C | CHECK ((review_revision ~ '^[0-9a-f]{64}$'::text)) |
| `waits_rows_check` | C | CHECK ((jsonb_typeof(rows) = 'array'::text)) |
| `waits_status_check` | C | CHECK ((status = ANY (ARRAY['waiting'::text, 'resumed'::text, 'cancelled'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `waits_import_batch_id_review_revision_key` | CREATE UNIQUE INDEX waits_import_batch_id_review_revision_key ON backend_review.waits USING btree (import_batch_id, review_revision) |
| `waits_parked_job_id_key` | CREATE UNIQUE INDEX waits_parked_job_id_key ON backend_review.waits USING btree (parked_job_id) |
| `waits_pkey` | CREATE UNIQUE INDEX waits_pkey ON backend_review.waits USING btree (import_batch_id) |
| `waits_plan_id_key` | CREATE UNIQUE INDEX waits_plan_id_key ON backend_review.waits USING btree (plan_id) |
| `waits_plan_id_review_revision_key` | CREATE UNIQUE INDEX waits_plan_id_review_revision_key ON backend_review.waits USING btree (plan_id, review_revision) |
| `waits_resumed_job_id_key` | CREATE UNIQUE INDEX waits_resumed_job_id_key ON backend_review.waits USING btree (resumed_job_id) |

## 函数（15）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `assert_wait` | `p_batch text, p_revision text` | backend_review.waits | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `cancel` | `p_token text, p_batch text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `decision` | `p_token text, p_batch text, p_revision text, p_key text, p_script text, p_hash text, p_decision text, p_evidence text` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `finish` | `p_job text, p_owner text, p_lease bigint, p_batch text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `list` | `p_token text, p_cursor text, p_limit integer` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `lock_content` | `` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `page` | `p_token text, p_batch text, p_revision text, p_after integer, p_limit integer` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `park` | `p_job text, p_owner text, p_lease bigint, p_batch text, p_plan text, p_key text, p_digest text, p_bytes bigint, p_rows jsonb` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `quality` | `p_token text, p_batch text, p_revision text, p_key text, p_phase text, p_checks jsonb, p_evidence text` | jsonb | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `quality_checks_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `require_capability` | `p_user text, p_cap text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `resume` | `p_token text, p_batch text, p_revision text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `sample_ids` | `p_rows jsonb, p_seed text, p_target integer` | text[] | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `sync_wait_on_batch_failed` | `` | trigger | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `waits_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |

## 触发器（3）

| 触发器 | 表 | 定义 | 状态 |
| --- | --- | --- | --- |
| `quality_checks_guard` | `quality_checks` | CREATE TRIGGER quality_checks_guard BEFORE INSERT OR DELETE OR UPDATE ON backend_review.quality_checks FOR EACH ROW EXECUTE FUNCTION backend_review.quality_checks_guard() | 启用 |
| `consumer_receipt` | `receipts` | CREATE TRIGGER consumer_receipt BEFORE INSERT ON backend_review.receipts FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard() | 启用 |
| `waits_guard` | `waits` | CREATE TRIGGER waits_guard BEFORE UPDATE ON backend_review.waits FOR EACH ROW EXECUTE FUNCTION backend_review.waits_guard() | 启用 |
