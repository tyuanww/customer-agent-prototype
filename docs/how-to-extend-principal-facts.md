# 如何把主体事实窗口放到 24 小时

登录后的店铺列表跟着 `content_intake.principal_facts.valid_until` 走。原来的表约束 `principal_facts_check` 只允许 5 分钟。只改函数不放宽约束，24 小时的插入会被拒绝。

> 本文保留 `0073_feishu_query_grant` 的历史解释。0077 后，登录和目录刷新只登记身份、事实与最低候选，不签发业务 grant。当前权限规则见[职位名单权限模型](reference-job-roster-permission-model.md)，初始化与授权步骤见[如何管理生产身份](how-to-manage-production-identities.md)。

## 0073 的历史变更

- 新迁移 `0073_feishu_query_grant` 删掉 5 分钟约束，改成不超过 24 小时。
- 同一条迁移替换仍在生效的写入函数。飞书投影、建席、坐席登录写出的事实是 24 小时。坐席管理谓词也按 24 小时判断。
- `requireFresh` 接受最长 24 小时的事实。没有这条，发现接口会把新事实当成不可用。

`0077_manual_identity_grants` 又退役了两类旧自动 `query` grant。飞书登录和目录刷新现在只登记身份、事实与最低候选，不再签发 `query`。业务授权必须由权限页面显式创建，重新登录不会恢复已撤销的 grant。

已入账的 `0045` 到 `0072` 没有改字节。回滚脚本在 `packages/database/rollbacks/0074_rollback_0073.sql`。它不在迁移目录里。生成器要求 `packages/database/migrations` 里的文件和目录清单逐个对应。把这段恢复放进 `0074` 并套用，会在 `0073` 之后把窗口改回 5 分钟，而且只要库里已经有超过 5 分钟的事实，约束恢复就会失败。要倒回已上线的库，用备份恢复。

## 0073 的历史部署记录

以下是 `0073` 合并时的部署记录。当时杭州账本为 `0072`，`0073` 尚未部署。它不代表当前生产迁移状态，也不能用于判断 0077 是否已上线。

1. 合并包含 `0073_feishu_query_grant` 的提交。
2. 按[如何在杭州运行后端](how-to-run-backend-on-hangzhou.md)换软链，然后 `systemctl restart customer-agent-stack`。启动时套用尚未入账的迁移，并拉起 API。
3. 核对账本出现 `0073_feishu_query_grant`。
4. 让对方重新登录。新的事实窗口在下一次投影时写成 24 小时；业务权限仍需单独授予。

不要对 `127.0.0.1:43299` 执行生产写入。那不是杭州库。
