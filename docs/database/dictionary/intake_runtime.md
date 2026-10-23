# schema `intake_runtime`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（0）

没有表或视图。

## 函数（5）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `assert_purpose` | `p_purpose text` | void | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `consumer_write_guard` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `lock_product_session` | `p_hash text, p_user text` | timestamp with time zone | plpgsql | 是 | `search_path=pg_catalog` | 本仓 |
| `worker_object_purpose` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |
| `worker_terminal_only` | `` | trigger | plpgsql | 否 | `search_path=pg_catalog` | 本仓 |

## 触发器（0）

没有触发器。
