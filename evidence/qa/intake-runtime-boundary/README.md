# 正式运行前：会话锁窄权限离线候选

2026-10-08；依赖 `e18ff820988fe7bf8bb9222def70809a300f0260`，在现有 `codex/intake-organization` 接续，产品版本保持 0.3.26。本轮仅使用新建 PG15 集群内的合成身份与空目录；没有真实组织/审批、正式角色、迁移、HTTP 注册或生产装配。

## 实际发现与交付

现有 `lockProductSession` 使用 `FOR SHARE OF s,b`，SELECT-only 账号不能执行。给用途账号追加 `sessions.revoked_at` / `subject_bindings.enabled` UPDATE 虽让锁成功，却能逆转管理员停用。该反例仅在一次性合成库演示并回滚，不是生产已授权配置，也不把不安全 GRANT 作为推荐方案。

新增 [SQL 候选](../../../apps/api/experiments/intake-runtime/session-lock.sql)把会话查询及行锁收在固定 SECURITY DEFINER 函数中。安装由[测试](../../../apps/api/tests/intake-runtime-boundary.integration.test.ts)负责：函数 owner 为 NOLOGIN、非超级用户角色，仅持必要表权；用途账号无身份 schema/table 权限，只获得窄函数执行能力。函数固定 pg_catalog search_path，使用显式 schema 表名，返回原会话截止；不写身份、授权或内容，持锁直至事务结束，锁等待后再核验有效期。SQL 本身不建角色、也不授运行账号权限。

这仍是正式合同前的实验。现有 `transaction.ts` 没有改接窄函数；本轮没有证明完整受限用途连接已经完成资格签发/分页、管理/发布或 worker 收尾。函数调用参数必须来自认证模块私有对象，不能新增客户端 hash/user 字段；正式采用需由身份合同所有者审核角色、执行接口与错误语义，版本化 export/intake 后再接线。

## 可重复验证

```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/intake-runtime-boundary.integration.test.ts
```

环境：Mac arm64、Node 24.19.0、pnpm 11.19.0、隔离 PostgreSQL 15；测试自己建库并关闭集群。最终 **8/8 PASS**，见 [最终 PG 输出](postgres-final.log)。前两轮的 [4 项边界复现](postgres.log)和 [7 项候选输出](postgres-candidate.log)保留形成过程，仅最终 8 项代表完整专项结果。没有套用之前组织刷新 8 项的数字。

| 验证 | 实际观察 |
| --- | --- |
| 原消费者缺权 | SELECT 成功但 session 行锁 42501；只补 session UPDATE 后 subject 行锁仍 42501 |
| 不安全增权反例 | 两安全列 UPDATE 能逆转合成停用；事务回滚后停用继续有效 |
| 现有事务失败处理 | 原 `createIntakeTransactions` 未进入业务回调；诊断含 42501，对外 INTERNAL_ERROR / COMMIT_UNKNOWN 且 commit=rolled_back；无资格、上下文、范围或发布行，current 不变，连接可重用 |
| 原读/锁候选账号边界 | 不是 superuser/createdb/createrole/bypassrls；身份、主体/授权事实、发布与 DDL 写拒绝 |
| 窄函数实际消费 | 无身份 SELECT/UPDATE 账号调用成功，返回原截止；未知会话、错误身份、停用、撤销拒绝，不延期 |
| 锁竞争 | 事务内函数调用同时阻止 session 撤销和 subject 停用；提交后撤销成功，下次调用拒绝 |
| owner 与对象隔离 | owner 不可登录且非超级用户；另一角色无函数执行权；调用方不能建 schema 对象，临时同名表及 search_path 不影响查询 |
| 等待时到期 | pg_blocking_pids 确认真实阻塞后等待截止，释放锁后拒绝，不返回旧截止 |

`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。普通 `pnpm test` 保留环境门控 skip，本专项已单独启用 PG 实跑。无变化的组织刷新、完整 FAQ/桌面及既有合同证据继续绑定原提交；未重复 GUI/Windows、真实组织/审批或远程 CI。生成的 API dist 不包含该实验。`docs:check` 最初因审查记录尚未生成而失败，记录补齐后最终通过；`workspace:check` 通过，保留量 30.8 MiB / 32 MiB。

证据命令、输入哈希及结果见 [inputs.json](inputs.json)、[review.json](review.json)。本机核心审查完整阅读 SQL 与测试；宿主独立对抗审查阅读 SQL、相邻身份/事务源码和文档，测试仅用摘要。未发现本轮待修问题。外部审查本轮未重新调用，之前两次 180 秒超时记录原样保留于[上轮审查](../intake-organization/review.json)，完整 `/review` 仍 **INCOMPLETE**，不能写为全部通过。

## 尚缺的正式输入

公开官方字段核对、治理批准依据和具体映射差异集中在[合同交接](../../../docs/reference-content-intake-p2-contract-handoff.md#2026-10-08-接续核对原生输入与会话锁权限)。精确岗位来源与标识、原生人工审批节点/任务/表单/附件策略尚未确定；没有将官方字段模型当作租户配置或可信网络观察证明。窄函数的治理、完整用途权限、正式装配、旧目录认领及真实数据门仍待完成。没有 push、PR、合并、部署或对外发送。
