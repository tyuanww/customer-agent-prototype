# schema `backend_identity`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（4）

### capability_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `user_id` | `text` | 否 |  |  |
| `capability` | `text` | 否 |  |  |
| `enabled` | `boolean` | 否 | `false` |  |
| `version` | `bigint` | 否 | `1` |  |
| `evidence_id` | `text` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `capability_bindings_capability_check` | C | CHECK ((capability = ANY (ARRAY['content_review_lead'::text, 'content_review_manager'::text, 'content_quality_reviewer'::text]))) |
| `capability_bindings_evidence_id_check` | C | CHECK ((evidence_id ~ '^EVD-[A-Z0-9-]{6,127}$'::text)) |
| `capability_bindings_pkey` | P | PRIMARY KEY (user_id, capability) |
| `capability_bindings_user_id_fkey` | F | FOREIGN KEY (user_id) REFERENCES backend_identity.subject_bindings(user_id) |
| `capability_bindings_version_check` | C | CHECK ((version > 0)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `capability_bindings_pkey` | CREATE UNIQUE INDEX capability_bindings_pkey ON backend_identity.capability_bindings USING btree (user_id, capability) |

### login_requests

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `login_id` | `text` | 否 |  |  |
| `state_hash` | `text` | 否 |  |  |
| `client_challenge` | `text` | 否 |  |  |
| `status` | `text` | 否 |  |  |
| `issued_at` | `timestamp with time zone` | 否 |  |  |
| `expires_at` | `timestamp with time zone` | 否 |  |  |
| `exchange_started_at` | `timestamp with time zone` | 是 |  |  |
| `binding_id` | `text` | 是 |  |  |
| `consumed_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `login_requests_binding_id_fkey` | F | FOREIGN KEY (binding_id) REFERENCES backend_identity.subject_bindings(binding_id) |
| `login_requests_check` | C | CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '00:05:00'::interval)))) |
| `login_requests_check1` | C | CHECK ((((status = ANY (ARRAY['ready'::text, 'consumed'::text])) AND (binding_id IS NOT NULL)) OR ((status <> ALL (ARRAY['ready'::text, 'consumed'::text])) AND (binding_id IS NULL)))) |
| `login_requests_check2` | C | CHECK (((status = 'consumed'::text) = (consumed_at IS NOT NULL))) |
| `login_requests_check3` | C | CHECK (((consumed_at IS NULL) OR ((consumed_at >= issued_at) AND (consumed_at < expires_at)))) |
| `login_requests_check4` | C | CHECK (((status <> 'exchanging'::text) OR (exchange_started_at IS NOT NULL))) |
| `login_requests_client_challenge_check` | C | CHECK ((client_challenge ~ '^[A-Za-z0-9_-]{43}$'::text)) |
| `login_requests_login_id_binding_id_key` | U | UNIQUE (login_id, binding_id) |
| `login_requests_pkey` | P | PRIMARY KEY (login_id) |
| `login_requests_state_hash_check` | C | CHECK ((state_hash ~ '^[0-9a-f]{64}$'::text)) |
| `login_requests_state_hash_key` | U | UNIQUE (state_hash) |
| `login_requests_status_check` | C | CHECK ((status = ANY (ARRAY['pending'::text, 'exchanging'::text, 'ready'::text, 'consumed'::text, 'failed'::text, 'expired'::text]))) |

索引：

| 名称 | 定义 |
| --- | --- |
| `login_requests_login_id_binding_id_key` | CREATE UNIQUE INDEX login_requests_login_id_binding_id_key ON backend_identity.login_requests USING btree (login_id, binding_id) |
| `login_requests_pkey` | CREATE UNIQUE INDEX login_requests_pkey ON backend_identity.login_requests USING btree (login_id) |
| `login_requests_state_hash_key` | CREATE UNIQUE INDEX login_requests_state_hash_key ON backend_identity.login_requests USING btree (state_hash) |

### sessions

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `token_hash` | `text` | 否 |  |  |
| `login_id` | `text` | 否 |  |  |
| `binding_id` | `text` | 否 |  |  |
| `issued_at` | `timestamp with time zone` | 否 |  |  |
| `expires_at` | `timestamp with time zone` | 否 |  |  |
| `revoked_at` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `sessions_binding_id_fkey` | F | FOREIGN KEY (binding_id) REFERENCES backend_identity.subject_bindings(binding_id) |
| `sessions_check` | C | CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '00:15:00'::interval)))) |
| `sessions_check1` | C | CHECK (((revoked_at IS NULL) OR (revoked_at >= issued_at))) |
| `sessions_login_id_binding_id_fkey` | F | FOREIGN KEY (login_id, binding_id) REFERENCES backend_identity.login_requests(login_id, binding_id) |
| `sessions_login_id_key` | U | UNIQUE (login_id) |
| `sessions_pkey` | P | PRIMARY KEY (token_hash) |
| `sessions_token_hash_check` | C | CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `sessions_expiry` | CREATE INDEX sessions_expiry ON backend_identity.sessions USING btree (expires_at) |
| `sessions_login_id_key` | CREATE UNIQUE INDEX sessions_login_id_key ON backend_identity.sessions USING btree (login_id) |
| `sessions_pkey` | CREATE UNIQUE INDEX sessions_pkey ON backend_identity.sessions USING btree (token_hash) |

### subject_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `binding_id` | `text` | 否 |  |  |
| `provider` | `text` | 否 |  |  |
| `tenant` | `text` | 否 |  |  |
| `subject` | `text` | 否 |  |  |
| `user_id` | `text` | 否 |  |  |
| `subject_hash` | `text` | 否 |  |  |
| `enabled` | `boolean` | 否 | `false` |  |
| `role` | `text` | 否 |  |  |
| `authorization_version` | `bigint` | 否 | `1` |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `subject_bindings_authorization_version_check` | C | CHECK ((authorization_version > 0)) |
| `subject_bindings_pkey` | P | PRIMARY KEY (binding_id) |
| `subject_bindings_provider_check` | C | CHECK ((provider = ANY (ARRAY['synthetic'::text, 'feishu'::text]))) |
| `subject_bindings_provider_tenant_subject_key` | U | UNIQUE (provider, tenant, subject) |
| `subject_bindings_role_check` | C | CHECK ((role = ANY (ARRAY['agent'::text, 'coach'::text, 'owner'::text]))) |
| `subject_bindings_subject_check` | C | CHECK (((length(subject) >= 1) AND (length(subject) <= 256))) |
| `subject_bindings_subject_hash_check` | C | CHECK ((subject_hash ~ '^[0-9a-f]{64}$'::text)) |
| `subject_bindings_tenant_check` | C | CHECK (((length(tenant) >= 1) AND (length(tenant) <= 128))) |
| `subject_bindings_user_id_check` | C | CHECK (((length(user_id) >= 1) AND (length(user_id) <= 128))) |
| `subject_bindings_user_id_key` | U | UNIQUE (user_id) |

索引：

| 名称 | 定义 |
| --- | --- |
| `subject_bindings_pkey` | CREATE UNIQUE INDEX subject_bindings_pkey ON backend_identity.subject_bindings USING btree (binding_id) |
| `subject_bindings_provider_tenant_subject_key` | CREATE UNIQUE INDEX subject_bindings_provider_tenant_subject_key ON backend_identity.subject_bindings USING btree (provider, tenant, subject) |
| `subject_bindings_user_id_key` | CREATE UNIQUE INDEX subject_bindings_user_id_key ON backend_identity.subject_bindings USING btree (user_id) |

## 函数（8）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `actor` | `p_token text` | TABLE(user_id text, role text, subject_hash text) | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `admit_feishu_agent` | `p_open_id text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `begin_callback` | `p_state text` | text | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `complete_callback` | `p_id text, p_binding text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `create_login` | `p_id text, p_state_hash text, p_challenge text` | void | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `exchange` | `p_id text, p_verifier text, p_new_token text` | timestamp with time zone | plpgsql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `logout` | `p_token text` | void | sql | 是 | `search_path=pg_catalog, public, pg_temp` | 本仓 |
| `sessions_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |

## 触发器（1）

| 触发器 | 表 | 定义 | 状态 |
| --- | --- | --- | --- |
| `sessions_guard` | `sessions` | CREATE TRIGGER sessions_guard BEFORE INSERT ON backend_identity.sessions FOR EACH ROW EXECUTE FUNCTION backend_identity.sessions_guard() | 启用 |
