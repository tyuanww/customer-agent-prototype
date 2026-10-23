# 数据库字典

本目录由 `packages/database/scripts/generate-data-dictionary.mjs` 从真实库生成，只读 catalog，不读业务行。不要手改：下一次生成会覆盖，`--check` 会因此失败。

共 8 个 schema、114 张表。

| schema | 表 | 视图 | 列 | 函数 | 触发器 |
| --- | --- | --- | --- | --- | --- |
| [`backend_identity`](backend_identity.md) | 4 | 0 | 29 | 8 | 1 |
| [`backend_review`](backend_review.md) | 3 | 0 | 28 | 15 | 3 |
| [`content_intake`](content_intake.md) | 56 | 1 | 444 | 83 | 72 |
| [`customer_agent_meta`](customer_agent_meta.md) | 1 | 0 | 8 | 0 | 0 |
| [`intake_organization`](intake_organization.md) | 3 | 0 | 23 | 5 | 5 |
| [`intake_runtime`](intake_runtime.md) | 0 | 0 | 0 | 5 | 0 |
| [`ops_loop`](ops_loop.md) | 4 | 0 | 38 | 10 | 0 |
| [`public`](public.md) | 43 | 6 | 561 | 168 | 33 |
