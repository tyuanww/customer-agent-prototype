# `@customer-agent/unified-contracts`

本包是统一架构计划的手写跨模块合同源，拥有访问决策、Query 结果、持久操作、发布快照、overlay 快照和授权矩阵的语义。`packages/contracts` 继续只拥有冻结上游 OpenAPI 的生成资产；本包不修改或复制那些生成资产。

数据库仍是授权运行时权威。`AccessDecision` 只携带一次解析后的版本组与允许范围，`toQueryAccessView`、`toDashboardSettingsView`、`toAdminAccessView` 是不可互换的最小投影。Query 投影没有账号或授权管理能力。

```bash
pnpm --filter @customer-agent/unified-contracts test
pnpm --filter @customer-agent/unified-contracts benchmark
pnpm --filter @customer-agent/unified-contracts check:generated
```

授权矩阵唯一写在 `src/index.ts`，由 `scripts/generate-policy-artifacts.mjs` 生成 JSON 与数据库 seed SQL。生成物只能通过 `generate` 更新；`check:generated` 做字节级漂移检查。
