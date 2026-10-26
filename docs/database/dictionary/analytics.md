# schema `analytics`

本文件由 `pnpm --filter @customer-agent/database dictionary` 从真实库生成。不要手改：下一次生成会覆盖，`--check` 会因此失败。

## 关系（0）

没有表或视图。

## 函数（1）

| 函数 | 参数 | 返回 | 语言 | SECURITY DEFINER | 配置 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `question_v1` | `p_start timestamp with time zone, p_end timestamp with time zone` | TABLE(query_count bigint, hit_count bigint, no_hit_count bigint, other_count bigint, inaccuracy_count bigint, hit_rate numeric, no_hit_rate numeric, inaccuracy_rate numeric) | plpgsql | 是 | `search_path=pg_catalog, pg_temp` | 本仓 |

## 触发器（0）

没有触发器。
