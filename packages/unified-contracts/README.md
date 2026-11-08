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

## 可观测性合同

`TraceIdentity` 关联请求、可选操作、查询、父查询、会话、generation、release 和查询类型。`sessionEpoch` 与 `generation` 必须同时存在或同时为空，`parentQueryId` 不得等于 `queryId`。类型定义把这组会话字段建成联合类型，运行时 parser 仍对不可信输入做同样校验。OBS 只携带 `operationId`，不复制 `OperationEnvelope` 或操作状态机的语义。

`QueryTelemetryRecord` 只允许 HMAC-SHA-256 `queryFingerprint`、`queryLength`、有限的 `intent`、`kind`、`releaseId` 和可选 `trace`。trace 的 `kind` 必须与记录一致，非空 trace release 必须与 `releaseId` 一致。SOP 记录使用 `intent: "sop"`，普通记录不能使用该 intent，类型联合也拒绝这个组合。默认合同不接受问句原文、答案、候选正文、SOP 消息、文件路径、订单号、客户标识、占位值或原始用户 ID。

`StageRecord` 使用 `OBSERVABILITY_STAGES` 中的稳定 stage，要求有效且不超过 64 个字符的 ISO 时间、从 0 到一天的有限 `durationMs`、有限 outcome、稳定 error code、budget class 和 external 标记。普通 recall、fusion、rerank、response validation 阶段不能关联 SOP trace；SOP match、path expansion、branch selection、SOP response validation 阶段不能关联 ordinary trace。成功阶段不得带 error code，失败阶段必须有 error code，类型联合也拒绝这两个错误组合。

`EvaluationRecord` 用 `ordinary | sop` 区分固定数据集指标。普通评估记录 recall、Top K、no-hit 和 response validation failure。SOP 评估记录 match、path、branch、stale release rejection 和 unauthorized resource rejection 数量。所有计数不得超出来自 `samples` 的分母，`errors` 也不得超出样本数。

`AlertRecord` 有五种精确形状：`budget_breach`、`unknown_operation`、`dead_letter_growth`、`stale_release` 和 `release_index_failure`。budget breach 的观测值必须高于阈值，dead-letter growth 的当前深度必须高于之前深度，stale release 的 trace release 必须存在且不同于期望 release。

每类记录都提供 `validate*` 与 `parse*`。验证器拒绝未知键、缺失键、错误 enum、超长或不安全的稳定 ID、非有限数和相互矛盾的字段。序列化输入只能是已经解析的 typed record。
