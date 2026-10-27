# 如何把主体事实窗口放到 24 小时

登录后的店铺列表跟着 `content_intake.principal_facts.valid_until` 走。原来的表约束 `principal_facts_check` 只允许 5 分钟。只改函数不放宽约束，24 小时的插入会被拒绝。

## 这次改了什么

- 新迁移 `0073_feishu_query_grant` 删掉 5 分钟约束，改成不超过 24 小时。
- 同一条迁移替换仍在生效的写入函数。飞书投影、建席、坐席登录写出的事实是 24 小时。坐席管理谓词也按 24 小时判断。
- 新的飞书绑定在恰好有一个当前店铺集、并且找得到一条活着的 `query` 父授权时，按 `v2-preview` 来源签发 `query`。`mode` 在 `content_intake.sources`。已有绑定不会再次签发。
- `requireFresh` 接受最长 24 小时的事实。没有这条，发现接口会把新事实当成不可用。

已入账的 `0045` 到 `0072` 没有改字节。回滚脚本在 `packages/database/rollbacks/0074_rollback_0073.sql`。它不在迁移目录里。生成器要求 `packages/database/migrations` 里的文件和目录清单逐个对应。把这段恢复放进 `0074` 并套用，会在 `0073` 之后把窗口改回 5 分钟，而且只要库里已经有超过 5 分钟的事实，约束恢复就会失败。要倒回已上线的库，用备份恢复。

## 部署

杭州账本目前是 `0072`。这次还没有部署。

1. 合并包含 `0073_feishu_query_grant` 的提交。
2. 按[如何在杭州运行后端](how-to-run-backend-on-hangzhou.md)换软链，然后 `systemctl restart customer-agent-stack`。启动时套用尚未入账的迁移，并拉起 API。
3. 核对账本出现 `0073_feishu_query_grant`。
4. 让对方重新登录。已有绑定不会因为这次函数走到签发。新的事实窗口在下一次投影时写成 24 小时。

不要对 `127.0.0.1:43299` 执行生产写入。那不是杭州库。
