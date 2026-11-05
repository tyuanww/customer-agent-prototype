# `@customer-agent/unified-contracts`

本包是统一架构计划的手写跨模块合同源，拥有访问决策、Query 结果、持久操作、发布快照、overlay 快照和授权矩阵的语义。`packages/contracts` 继续只拥有冻结上游 OpenAPI 的生成资产；本包不修改或复制那些生成资产。

数据库仍是授权运行时权威。`ROLE_CEILING_POLICY` 以 `role`、`businessActions`、`mayAllocate`、`mayDelegate`、`maySkipImportParent` 镜像 `content_intake.role_ceiling`；ACL 矩阵由这份数据展开，`grants-manage` 与 `accounts-manage` 只在 `mayAllocate` 时导出。`AccessDecision` 只携带一次解析后的版本组与允许范围，`toQueryAccessView`、`toDashboardSettingsView`、`toAdminAccessView` 是不可互换的最小投影。Query 投影没有账号或授权管理能力。

```bash
pnpm --filter @customer-agent/unified-contracts test
pnpm --filter @customer-agent/unified-contracts benchmark
pnpm --filter @customer-agent/unified-contracts check:generated
```

授权策略唯一写在 `src/index.ts`，由 `scripts/generate-policy-artifacts.mjs` 生成 JSON 与数据库 seed SQL。SQL 只使用 0057 的实际五列，冲突键为 `role` 主键；测试会读取 `0057_role_ceiling.sql` 并拒绝列、主键或角色值漂移。生成物只能通过 `generate` 更新，`check:generated` 做字节级漂移检查。该 seed 是待审核生成物，不表示已经应用到数据库。

运行时验证器还要求：Scope 只能携带所属 kind 的字段；SOP 分支必须唯一并绑定一个 decision source，目标步骤存在，step 序号为正且唯一；ready release 必须有不空 index ID/hash 和正版本，empty release 不带身份或条目；操作终态回执形状精确、时间有效，`expired` 是显式终态，`recoveryDeadline` 不得早于 `updatedAt`；content Top 3 的 rank 与 copy handle 均唯一。
