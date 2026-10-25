# schema `ops_loop`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（4）

### inaccuracy_reports

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `query_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `actor_user_id` | `text` | 否 |  |  |
| `script_version` | `integer` | 是 |  |  |
| `rank` | `integer` | 是 |  |  |
| `content_hash` | `text` | 是 |  |  |
| `evidence_hash` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `inaccuracy_reports_actor_user_id_check` | C | CHECK ((btrim(actor_user_id) <> ''::text)) |
| `inaccuracy_reports_content_hash_check` | C | CHECK (((content_hash IS NULL) OR (content_hash ~ '^[0-9a-f]{64}$'::text))) |
| `inaccuracy_reports_evidence_hash_check` | C | CHECK ((evidence_hash ~ '^[0-9a-f]{64}$'::text)) |
| `inaccuracy_reports_pkey` | P | PRIMARY KEY (query_id, script_id) |
| `inaccuracy_reports_query_id_fkey` | F | FOREIGN KEY (query_id) REFERENCES query_events(query_id) |
| `inaccuracy_reports_rank_check` | C | CHECK (((rank IS NULL) OR ((rank >= 1) AND (rank <= 3)))) |
| `inaccuracy_reports_script_id_check` | C | CHECK (((btrim(script_id) <> ''::text) AND (length(script_id) <= 128))) |
| `inaccuracy_reports_script_version_check` | C | CHECK (((script_version IS NULL) OR (script_version >= 1))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `inaccuracy_reports_pkey` | CREATE UNIQUE INDEX inaccuracy_reports_pkey ON ops_loop.inaccuracy_reports USING btree (query_id, script_id) |
| `inaccuracy_reports_script_created` | CREATE INDEX inaccuracy_reports_script_created ON ops_loop.inaccuracy_reports USING btree (script_id, created_at DESC) |

### script_mutations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `mutation_id` | `text` | 否 |  |  |
| `script_id` | `text` | 否 |  |  |
| `action` | `text` | 否 |  |  |
| `expected_version` | `integer` | 否 |  |  |
| `title` | `text` | 是 |  |  |
| `answer_text` | `text` | 是 |  |  |
| `effective_from` | `timestamp with time zone` | 是 |  |  |
| `effective_to` | `timestamp with time zone` | 是 |  |  |
| `actor_user_id` | `text` | 否 |  |  |
| `version` | `integer` | 否 | `1` |  |
| `review_status` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `script_mutations_action_check` | C | CHECK ((action = ANY (ARRAY['patch'::text, 'delete'::text]))) |
| `script_mutations_actor_user_id_check` | C | CHECK ((btrim(actor_user_id) <> ''::text)) |
| `script_mutations_check` | C | CHECK ((((action = 'patch'::text) AND (title IS NOT NULL) AND ((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 256)) AND (answer_text IS NOT NULL) AND ((length(answer_text) >= 1) AND (length(answer_text) <= 20000)) AND (effective_from IS NOT NULL) AND ((effective_to IS NULL) OR (effective_from < effective_to))) OR ((action = 'delete'::text) AND (title IS NULL) AND (answer_text IS NULL) AND (effective_from IS NULL) AND (effective_to IS NULL)))) |
| `script_mutations_expected_version_check` | C | CHECK ((expected_version >= 1)) |
| `script_mutations_mutation_id_check` | C | CHECK ((btrim(mutation_id) <> ''::text)) |
| `script_mutations_pkey` | P | PRIMARY KEY (mutation_id) |
| `script_mutations_review_status_check` | C | CHECK ((review_status = 'pending_review'::text)) |
| `script_mutations_script_id_check` | C | CHECK (((btrim(script_id) <> ''::text) AND (length(script_id) <= 128))) |
| `script_mutations_version_check` | C | CHECK ((version >= 1)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `script_mutations_pkey` | CREATE UNIQUE INDEX script_mutations_pkey ON ops_loop.script_mutations USING btree (mutation_id) |

### software_release_catalog

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `catalog_id` | `text` | 否 |  |  |
| `version` | `text` | 否 |  |  |
| `platform` | `text` | 否 |  |  |
| `sha256` | `text` | 否 |  |  |
| `download_url` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `signed` | `boolean` | 否 |  |  |
| `is_current` | `boolean` | 否 | `false` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `software_release_catalog_catalog_id_check` | C | CHECK ((btrim(catalog_id) <> ''::text)) |
| `software_release_catalog_download_url_check` | C | CHECK ((download_url ~ '^https://'::text)) |
| `software_release_catalog_pkey` | P | PRIMARY KEY (catalog_id) |
| `software_release_catalog_platform_check` | C | CHECK ((platform = ANY (ARRAY['mac-universal'::text, 'win-x64'::text, 'linux-x64'::text]))) |
| `software_release_catalog_sha256_check` | C | CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `software_release_catalog_version_check` | C | CHECK (((btrim(version) <> ''::text) AND (length(version) <= 64))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `software_release_catalog_pkey` | CREATE UNIQUE INDEX software_release_catalog_pkey ON ops_loop.software_release_catalog USING btree (catalog_id) |
| `software_release_one_current` | CREATE UNIQUE INDEX software_release_one_current ON ops_loop.software_release_catalog USING btree (is_current) WHERE is_current |

### sop_nodes

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `node_id` | `text` | 否 |  |  |
| `parent_node_id` | `text` | 是 |  |  |
| `product_session_id` | `text` | 否 |  |  |
| `title` | `text` | 否 |  |  |
| `body` | `text` | 否 |  |  |
| `sort_key` | `integer` | 否 | `0` |  |
| `version` | `integer` | 否 | `1` |  |
| `lifecycle` | `text` | 否 |  |  |
| `created_at` | `timestamp with time zone` | 否 | `now()` |  |
| `updated_at` | `timestamp with time zone` | 否 | `now()` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sop_nodes_body_check` | C | CHECK (((length(body) >= 1) AND (length(body) <= 20000))) |
| `sop_nodes_lifecycle_check` | C | CHECK ((lifecycle = ANY (ARRAY['active'::text, 'deleted'::text]))) |
| `sop_nodes_node_id_check` | C | CHECK (((btrim(node_id) <> ''::text) AND (length(node_id) <= 128))) |
| `sop_nodes_parent_node_id_fkey` | F | FOREIGN KEY (parent_node_id) REFERENCES ops_loop.sop_nodes(node_id) |
| `sop_nodes_pkey` | P | PRIMARY KEY (node_id) |
| `sop_nodes_product_session_id_check` | C | CHECK (((btrim(product_session_id) <> ''::text) AND (length(product_session_id) <= 128))) |
| `sop_nodes_title_check` | C | CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 256))) |
| `sop_nodes_version_check` | C | CHECK ((version >= 1)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sop_nodes_pkey` | CREATE UNIQUE INDEX sop_nodes_pkey ON ops_loop.sop_nodes USING btree (node_id) |
| `sop_nodes_session_lifecycle` | CREATE INDEX sop_nodes_session_lifecycle ON ops_loop.sop_nodes USING btree (product_session_id, lifecycle, sort_key, node_id) |

## 函数（11）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `current_software_release` | `p_actor_role text` | ops_loop.software_release_catalog | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `delete_sop_node` | `p_node_id text, p_expected_version integer, p_actor_role text` | ops_loop.sop_nodes | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `evidence_hash` | `p_script_version integer, p_rank integer, p_content_hash text` | text | sql | 否 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `import_sop_catalog` | `p_product_session_id text, p_nodes jsonb, p_actor_user_id text, p_actor_role text` | TABLE(ok boolean, product_session_id text, node_count integer) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `list_resolved_inaccuracy_outcomes` | `p_actor_role text` | TABLE(script_id text, resolved_at timestamp with time zone, ready boolean, before_count integer, after_count integer, window_days integer) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `list_software_releases` | `p_actor_role text` | TABLE(version text, platform text, sha256 text, download_url text, created_at timestamp with time zone, signed boolean) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `mutate_script` | `p_script_id text, p_action text, p_expected_version integer, p_title text, p_answer_text text, p_effective_from timestamp with time zone, p_effective_to timestamp with time zone, p_actor_user_id text, p_actor_role text` | TABLE(ok boolean, script_id text, mutation_id text, review_status text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `patch_sop_node` | `p_node_id text, p_expected_version integer, p_title text, p_body text, p_sort_key integer, p_actor_role text` | ops_loop.sop_nodes | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `read_retrieval_metrics` | `p_window text, p_actor_role text` | TABLE(no_hit_rate numeric, copy_complete_rate numeric, open_task_count integer, current_release_script_count integer, metric_window text, release_id text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `read_sop_catalog` | `p_product_session_id text, p_actor_role text` | TABLE(node_id text, parent_node_id text, title text, body text, sort_key integer, version integer, lifecycle text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `record_inaccuracy_report` | `p_query_id text, p_script_id text, p_script_version integer, p_rank integer, p_content_hash text, p_actor_user_id text, p_actor_role text` | TABLE(ok boolean, query_id text, script_id text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |

## 触发器（0）

没有触发器。
