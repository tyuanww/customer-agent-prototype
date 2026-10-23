# schema `intake_organization`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（3）

### bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `binding_version` | `content_intake.version` | 否 |  |  |
| `binding_digest` | `content_intake.sha256` | 否 |  |  |
| `open_id` | `content_intake.identifier` | 否 |  |  |
| `enabled` | `boolean` | 否 |  |  |
| `valid_until` | `timestamp with time zone` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `bindings_pkey` | P | PRIMARY KEY (tenant_id, app_id, principal_id, binding_version) |
| `bindings_principal_id_tenant_id_app_id_fkey` | F | FOREIGN KEY (principal_id, tenant_id, app_id) REFERENCES content_intake.principals(principal_id, tenant_id, app_id) |
| `bindings_tenant_id_app_id_principal_id_binding_version_open_key` | U | UNIQUE (tenant_id, app_id, principal_id, binding_version, open_id) |
| `bindings_valid_until_check` | C | CHECK (isfinite(valid_until)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `bindings_pkey` | CREATE UNIQUE INDEX bindings_pkey ON intake_organization.bindings USING btree (tenant_id, app_id, principal_id, binding_version) |
| `bindings_tenant_id_app_id_principal_id_binding_version_open_key` | CREATE UNIQUE INDEX bindings_tenant_id_app_id_principal_id_binding_version_open_key ON intake_organization.bindings USING btree (tenant_id, app_id, principal_id, binding_version, open_id) |

### current_bindings

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `binding_version` | `content_intake.version` | 否 |  |  |
| `open_id` | `content_intake.identifier` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `current_bindings_pkey` | P | PRIMARY KEY (tenant_id, app_id, principal_id) |
| `current_bindings_tenant_id_app_id_open_id_key` | U | UNIQUE (tenant_id, app_id, open_id) |
| `current_bindings_tenant_id_app_id_principal_id_binding_ver_fkey` | F | FOREIGN KEY (tenant_id, app_id, principal_id, binding_version, open_id) REFERENCES intake_organization.bindings(tenant_id, app_id, principal_id, binding_version, open_id) NOT VALID |

索引：

| 名称 | 定义 |
| --- | --- |
| `current_bindings_pkey` | CREATE UNIQUE INDEX current_bindings_pkey ON intake_organization.current_bindings USING btree (tenant_id, app_id, principal_id) |
| `current_bindings_tenant_id_app_id_open_id_key` | CREATE UNIQUE INDEX current_bindings_tenant_id_app_id_open_id_key ON intake_organization.current_bindings USING btree (tenant_id, app_id, open_id) |

### observations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `principal_id` | `content_intake.identifier` | 否 |  |  |
| `facts_version` | `content_intake.version` | 否 |  |  |
| `tenant_id` | `content_intake.identifier` | 否 |  |  |
| `app_id` | `content_intake.identifier` | 否 |  |  |
| `binding_version` | `content_intake.version` | 否 |  |  |
| `request_digest` | `content_intake.sha256` | 否 |  |  |
| `kind` | `text` | 否 |  |  |
| `mapping_version` | `text` | 是 |  |  |
| `directory_digest` | `content_intake.sha256` | 是 |  |  |
| `observed_until` | `timestamp with time zone` | 是 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `observations_check` | C | CHECK ((((kind = 'observation'::text) AND (mapping_version IS NOT NULL) AND (mapping_version = 'feishu-contact-job-title-v1'::text) AND (directory_digest IS NOT NULL) AND ((directory_digest)::text ~ '^[0-9a-f]{64}$'::text) AND (observed_until IS NOT NULL)) OR ((kind = 'revocation'::text) AND (mapping_version IS NULL) AND (directory_digest IS NULL) AND (observed_until IS NULL)))) |
| `observations_kind_check` | C | CHECK ((kind = ANY (ARRAY['observation'::text, 'revocation'::text]))) |
| `observations_observed_until_check` | C | CHECK (isfinite(observed_until)) |
| `observations_pkey` | P | PRIMARY KEY (principal_id, facts_version) |
| `observations_principal_id_facts_version_fkey` | F | FOREIGN KEY (principal_id, facts_version) REFERENCES content_intake.principal_facts(principal_id, facts_version) NOT VALID |
| `observations_tenant_id_app_id_principal_id_binding_version_fkey` | F | FOREIGN KEY (tenant_id, app_id, principal_id, binding_version) REFERENCES intake_organization.bindings(tenant_id, app_id, principal_id, binding_version) NOT VALID |

索引：

| 名称 | 定义 |
| --- | --- |
| `observations_pkey` | CREATE UNIQUE INDEX observations_pkey ON intake_organization.observations USING btree (principal_id, facts_version) |

## 函数（5）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `binding_transition` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `current_binding_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `fact_evidence_required` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `history_immutable` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `observation_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |

## 触发器（5）

| 触发器 | 表 | 定义 | 状态 |
| --- | --- | --- | --- |
| `organization_binding_immutable` | `bindings` | CREATE TRIGGER organization_binding_immutable BEFORE DELETE OR UPDATE ON intake_organization.bindings FOR EACH ROW EXECUTE FUNCTION intake_organization.history_immutable() | 启用 |
| `organization_binding_transition` | `bindings` | CREATE TRIGGER organization_binding_transition BEFORE INSERT ON intake_organization.bindings FOR EACH ROW EXECUTE FUNCTION intake_organization.binding_transition() | 启用 |
| `organization_current_guard` | `current_bindings` | CREATE TRIGGER organization_current_guard BEFORE INSERT OR DELETE OR UPDATE ON intake_organization.current_bindings FOR EACH ROW EXECUTE FUNCTION intake_organization.current_binding_guard() | 启用 |
| `organization_observation_guard` | `observations` | CREATE TRIGGER organization_observation_guard BEFORE INSERT ON intake_organization.observations FOR EACH ROW EXECUTE FUNCTION intake_organization.observation_guard() | 启用 |
| `organization_observation_immutable` | `observations` | CREATE TRIGGER organization_observation_immutable BEFORE DELETE OR UPDATE ON intake_organization.observations FOR EACH ROW EXECUTE FUNCTION intake_organization.history_immutable() | 启用 |
