# schema `customer_agent_meta`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（1）

### schema_migrations

| 列 | 类型 | 可空 | 默认 | 备注 |
| --- | --- | --- | --- | --- |
| `position` | `integer` | 否 |  |  |
| `migration_id` | `text` | 否 |  |  |
| `migration_sha256` | `text` | 否 |  |  |
| `contract_set_id` | `text` | 否 |  |  |
| `source_git_sha` | `text` | 否 |  |  |
| `source_schema_sha256` | `text` | 否 |  |  |
| `applied_at` | `timestamp with time zone` | 否 | `clock_timestamp()` |  |
| `execution_ms` | `integer` | 否 |  |  |

约束：

| 名称 | 类型 | 定义 |
| --- | --- | --- |
| `schema_migrations_execution_ms_check` | C | CHECK ((execution_ms >= 0)) |
| `schema_migrations_migration_id_check` | C | CHECK ((migration_id ~ '^[0-9]{4}_[a-z0-9_]+$'::text)) |
| `schema_migrations_migration_id_key` | U | UNIQUE (migration_id) |
| `schema_migrations_migration_sha256_check` | C | CHECK ((migration_sha256 ~ '^[0-9a-f]{64}$'::text)) |
| `schema_migrations_pkey` | P | PRIMARY KEY ("position") |
| `schema_migrations_position_check` | C | CHECK (("position" > 0)) |
| `schema_migrations_source_git_sha_check` | C | CHECK ((source_git_sha ~ '^[0-9a-f]{40}$'::text)) |
| `schema_migrations_source_schema_sha256_check` | C | CHECK ((source_schema_sha256 ~ '^[0-9a-f]{64}$'::text)) |

索引：

| 名称 | 定义 |
| --- | --- |
| `schema_migrations_migration_id_key` | CREATE UNIQUE INDEX schema_migrations_migration_id_key ON customer_agent_meta.schema_migrations USING btree (migration_id) |
| `schema_migrations_pkey` | CREATE UNIQUE INDEX schema_migrations_pkey ON customer_agent_meta.schema_migrations USING btree ("position") |

## 函数（0）

没有函数。

## 触发器（0）

没有触发器。
