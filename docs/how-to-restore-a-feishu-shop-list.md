# 如何恢复飞书登录后的店铺列表

桌面下拉显示「暂无可用店铺」时，先查出登录停在哪一步。顶栏那句「没有权限，请找人开通。」是另一条路径，见[如何核对职位名单查询权](how-to-check-roster-permission.md)。字段和放行规则见[职位名单权限模型](reference-job-roster-permission-model.md)。

这篇不写入授权。`backend_identity.admit_feishu_agent` 只插入一条 `subject_bindings`。会话使用的 principal id 由 `rosterPrincipalId` 和 `content_intake.project_feishu_roster` 计算，形式是 `prin_` 加上 open id 的 sha256 前 32 位十六进制。查询授权在投影状态成为 `registered` 之后，由 `content_intake.issue_roster_query` 签发，动作只有 `query`，有效期不超过 1 天。

店铺要出现，来源模式必须是 `v2-preview`，店铺 ID 非空，并且有一条未撤销的 `query` 授权。该授权的 `source_id`、`policy_version`、`store_set_version` 必须等于当前行。事实窗口长度见迁移 [`0073_feishu_query_grant.sql`](../packages/database/migrations/0073_feishu_query_grant.sql) 中的 `principal_facts_check` 约束（24 小时）。重新登录会重写事实。点「刷新店铺」不会重写事实，但会重新读取授权。店铺下拉不跟着 10 秒一次的会话轮询走。事实重写之后要点「刷新店铺」。`source_id` 为空的根授权不会出现在店铺里。

这次恢复不追加 `publish`、`import` 或 `rollback`。`0072_seat_post_grants` 给「客服」和「客服主管」签发的也只有 `query`。

## 前提

- 在杭州机器上查询，库名是 `customer_agent_formal`。连接方式见[如何在杭州运行后端](how-to-run-backend-on-hangzhou.md)。不要把口令写进文档或聊天。
- 下面的 SQL 只读。把 psql 变量 `open_id` 设成当事人的飞书 open id。
- 仓库里的迁移头是 `0072_seat_post_grants`。杭州账本以查到的 `migration_id` 为准。

## 步骤

1. 读账本和身份。先看最新迁移，再算出 principal id，然后读绑定、principal、最新事实和未过期的授权。

```sql
SELECT position, migration_id, applied_at
FROM customer_agent_meta.schema_migrations
ORDER BY position DESC
LIMIT 5;

SELECT binding_id, user_id, enabled, role
FROM backend_identity.subject_bindings
WHERE provider = 'feishu' AND binding_id = :'open_id';

SELECT 'prin_' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(:'open_id', 'UTF8')), 'hex'), 32) AS principal_id,
       left('usr_' || :'open_id', 128) AS user_id;

SELECT principal_id, user_id, tenant_id, app_id, identity_scope
FROM content_intake.principals
WHERE user_id = left('usr_' || :'open_id', 128)
   OR principal_id = 'prin_' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(:'open_id', 'UTF8')), 'hex'), 32);

SELECT facts_version, enabled, checked_at, valid_until
FROM content_intake.principal_facts
WHERE principal_id = 'prin_' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(:'open_id', 'UTF8')), 'hex'), 32)
ORDER BY facts_version DESC
LIMIT 3;

SELECT action, source_id, policy_version, store_set_version, expires_at, revoked_at, reason
FROM content_intake.grants
WHERE recipient_id = 'prin_' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(:'open_id', 'UTF8')), 'hex'), 32)
ORDER BY starts_at DESC
LIMIT 20;
```

2. 按下面的顺序命中第一条，然后停。不要为了让店铺出现而手写 `content_intake.grants`。

- 没有绑定行。请对方重新登录一次。`admit_feishu_agent` 会在回调找不到启用绑定时插入绑定。不要手写 principal。
- 有绑定行，并且 `enabled` 为假。准入冲突时不会把这一行重新打开。先处理停用，再让对方登录。
- 没有职务快照，或职务标题对不上花名册。`projectRosterLogin` 返回 `unmatched`，不会调用 `issue_roster_query`。先让飞书职务原文对上目录。
- 投影状态是 `policy-pending`。岗位规则没有对上。先补规则，再让对方登录。
- 投影已经 `registered`，当前发布谱系里没有 `v2-preview` 来源。先发布这些来源。改准入函数不会造出店铺。
- 已有 `query` 授权，但最新事实的 `valid_until` 已过。请对方重新登录。窗口长度见迁移 [`0073_feishu_query_grant.sql`](../packages/database/migrations/0073_feishu_query_grant.sql) 中的 `principal_facts_check` 约束（24 小时）。
- 事实仍有效，授权行也在，店铺列表仍空。把 `source_id`、`policy_version`、`store_set_version` 和当前策略版本、当前店铺集版本并排列出来。把这几行带回来，再决定要不要改代码。

## 怎样确认

- principal id 以 `prin_` 开头，并且和 `apps/api/src/project-roster-login.ts` 里的 `rosterPrincipalId` 使用同一种 sha256 截取。
- 授权原因若是系统签发，正文是「职位名单系统签发。」动作是 `query`。
- 桌面只把模式为 `v2-preview`、带店铺 ID、且动作含 `query` 的来源放进下拉。空列表在主进程里是 `NO_GRANT`，下拉文字是「暂无可用店铺」。
- `authorization_deadline` 返回的时间如果等于事实的 `valid_until`，查询授权还在，店铺列表会跟着事实窗口结束。窗口长度见迁移 [`0073_feishu_query_grant.sql`](../packages/database/migrations/0073_feishu_query_grant.sql) 中的 `principal_facts_check` 约束（24 小时）。结束之后重新登录，再点「刷新店铺」。

## 失败时

- 账本查不到。先确认连的是杭州 socket 上的 `customer_agent_formal`，不是 Mac 上端口 43299 的那份库。
- 绑定在、principal 不在。登录还没有走到 `project_feishu_roster`。回到职务匹配，不要另造一个 `feishu_` 前缀的 id。
- 对方刚登录仍没有店铺。先看事实是否仍有效。有效就点「刷新店铺」。仍然为空再看第七条。
