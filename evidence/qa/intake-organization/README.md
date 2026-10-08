# 组织事实刷新：离线合成验收

2026-10-08；依赖 `29fc709`，分支 `codex/intake-organization`。本轮只完成已登记主体的组织事实事务实验，不是生产刷新器或飞书接入。生产 API 构建排除 experiments；无新 HTTP、迁移、正式角色或真实数据输入。

## 输入与所有者

写入器接受严格字段 `{principalId, expectedFactsVersion, departmentIds, jobId, enabled, checkedAt, validUntil}`。可信组织观察方独占这些事实；当前测试直接提供合成观察，不验证原生 API、上游缓存、事件来源或时间戳。checkedAt 是观察开始时间，截止至多五分钟；拒绝未来、过期、早于或等于当前观察的更新。部门排序规范化，重复/空/超限及额外字段拒绝。

服务端 scope 绑定 tenant/app，只更新已登记 principal，不能修改 userId/personKey、岗位规则、业务 grant 或发布物。复用既有内容锁，在一个事务中追加不可变事实、推进 current_facts_version，停用/岗位/部门变化时推进 generation。正常续鲜不推进 generation；查询消费者仍重验当前事实及资格自身截止。

恢复键是同一主体的 `expectedFactsVersion + 1`，摘要绑定范围、主体、版本及完整规范化观察。相同键不同材料拒绝；准确重放返回历史 `replayed` 与 `currentFactsVersion`，不修改指针/截止/代际。COMMIT 响应丢失返回 `commit: unknown`，调用方须保留原输入并重试；不得重新获取一个更晚时间戳冒充原请求成功。历史回执不能当作使用资格。

## 实际验证

环境：Mac arm64、Node 24.19.0、pnpm 11.19.0、隔离 PG15。命令 `pnpm --filter @customer-agent/api test:intake:organization`，最终 8/8 通过；[原始输出](organization-tests.log)、[QA 捕获回执](qa-receipt.json)、[输入指纹](inputs.json)。第一次 6 项通过后补充到期回滚和部门变更，再运行最终 8 项；只以最终结果作为本轮完整专项结论。

| 场景 | 实际结果 |
| --- | --- |
| 受限写入及真实消费者 | 非 owner 账号追加事实；产品认证取得真实私有会话，原 usage 签发资格并读取快照；重复刷新不改原租约截止或代际 |
| 停用、岗位、部门变化 | 停用立即拒绝旧 snapshot；旧启用请求重放不能复活；重新启用并改岗位后旧资格因 generation 拒绝；无映射部门不能取得新资格；既有业务 grant 没有被改写或扩权 |
| 不可信/乱序输入 | 未登记/跨 tenant、未知字段、空或重复部门、错误布尔/版本、未来/过期/超五分钟观察全部拒绝且无写入 |
| 并发与旧观察 | 同一预期版本两个不同快照仅一个写入；另一份冲突；提高版本号不能绕过观察时间顺序 |
| 提交响应丢失 | 故障发生在实际 COMMIT 后；重建 writer 后原输入回读同一事实版本，无重复代际更新；换材料拒绝 |
| 提交前到期 | UPDATE 后故意延迟至观察过期，验证已写事实和指针全部回滚 |
| 数据库权限 | 临时账号不是 superuser/createdb/createrole；身份映射、岗位、grant、历史改写/删除、发布指针及 DDL 均被数据库拒绝；合法事实刷新成功 |

受限账号权限只存在于测试临时库：两个表的读取、principal_facts INSERT、principals 两个版本列 UPDATE、schema USAGE 与内容锁函数 EXECUTE。它是可信组织写入者的能力样例，不提供数据库级多租户行隔离，不构成批准的完整生产 ACL；业务/解析/坐席连接用途仍须独立设计与验收。

## 检查、审查与剩余边界

`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过，普通测试保留既有环境门控 skip，本轮 8 项已由专项单独实跑。本机核心/独立审查未发现待修问题；两路 Claude Code 审查均 180 秒超时且无结论，故完整 `/review` 记为 **INCOMPLETE**，不算全部审核通过。实际结果及原始日志路径见 [review.json](review.json)。本轮未改桌面、冻结合同或迁移；不重复 GUI/Windows 验收。构建产物不含实验 writer，真实组织观察、审批 transport、生产装配及完整受限权限、旧目录认领继续待办。没有 push、PR、合并或部署。
