# SOP PostgreSQL 候选与 snapshot 数据形状草案

状态：`REVIEW_ONLY_DESIGN`。

本文只为 C 阶段写清数据形状、所有者、不变量和失败路径，不创建 migration，不改变现有正式合同、API 快照或运行时能力。

## 当前数据库边界

现有 `content_intake.release_catalogs.sop_nodes`、`sop_edges` 和 `media` 仍由空数组约束保护。0036–0039 只提供图片元数据暂存、候选行绑定和旧 `sop-v1` 来源登记；这些结构不能表达 `resume-v3` 所需的多 flow、稳定业务编号、分支目标、知识/资源归属、可见对象、适用范围和有效区间。

因此不能直接把 review-only candidate 填入旧 `release_catalogs`，也不能把 `sop_candidate_media` 的工作表/行号当作正式 graph 身份。正式 successor 批准前，现有 migration 和正式 API graph 保持不变。

## 候选事务的逻辑形状

以下是未来事务的逻辑边界，不是已批准的 SQL 表名。每个候选版本必须能够由 handoff manifest 的来源绑定和 snapshot hash 重建。

| 逻辑对象 | 最小字段 | 所有者 | 作用 |
| --- | --- | --- | --- |
| `sop_graph_candidate` | `candidate_id`、`candidate_version`、`mapping_version`、`source_sha256`、`structure_digest`、`openapi_digest`、`ddl_digest`、`migrations_digest`、`snapshot_hash`、`state` | PostgreSQL 候选事务 | 保存不可发布候选的身份、来源和结构摘要 |
| `sop_graph_flow` | `source_id`、`flow_id`、`flow_version`、标题、入口词、适用范围、可见对象、有效期、`start_node_id` | PostgreSQL snapshot | 保存一条完整流程的版本化头信息 |
| `sop_graph_node` | flow identity、`node_id`、任务类型、阶段、判断/确认约束、知识引用、话术引用 | PostgreSQL snapshot | 保存任务节点及其业务引用 |
| `sop_graph_edge` | flow identity、`edge_id`、`from`、`to`、条件、动作 | PostgreSQL snapshot | 保存分支和返回路径，禁止跨 flow 引用 |
| `sop_graph_script` | `source_id`、业务条目 ID、话术版本、标题、对客正文 | PostgreSQL snapshot | 保存可复制正文；内部说明不能进入坐席正文 |
| `sop_graph_media` | 对象 ID、序号、SHA-256、MIME、字节数、归属目标、可见对象、适用范围 | PostgreSQL 元数据与资源所有者 | 保存图片元数据和 graph 归属；图片字节不进入当前候选表 |
| `sop_graph_evidence` | 候选身份、证据类型、审核布尔值、来源绑定、审核摘要 | PostgreSQL 审核事务 | 分开保存 successor 接收和业务审核事实 |
| `sop_graph_snapshot` | 候选身份、snapshot 版本、snapshot hash、完整 graph payload、发布状态 | PostgreSQL 不可变快照 | 只有批准发布事务才能生成正式 current；旧 snapshot 不覆盖 |
| `sop_graph_receipt` | 幂等键、请求 hash、候选身份、结果摘要 | PostgreSQL 回执 | 支持重放和未知提交恢复，冲突幂等键必须拒绝 |

## 不变量

1. `source_sha256`、`mapping_version` 和四个合同摘要必须来自同一 handoff；任何一项漂移都拒绝事务。
2. 候选、审核、snapshot 和 release 是不同状态；结构 ready 不等于业务批准，业务批准也不等于发布成功。
3. 每条 flow、node、edge、script、media 引用必须在同一候选 projection 内闭包解析；不能按物理行号或旧 FAQ row ID 猜身份。
4. `publishable=false` 的候选不能写入正式 API current；真实 `domain=sop` 不能降级为 FAQ 或合成树。
5. 发布事务必须在同一事务中写入候选审核事实、不可变 snapshot 和 durable receipt；部分写入必须回滚。
6. 同一个幂等键只能对应一个请求 hash；相同 hash 只返回原回执，冲突 hash 拒绝。
7. 旧版本续用必须读取原 snapshot，并重新核验当前资格、适用范围、有效期和撤权状态；不能静默替换为新版本。
8. 图片只能通过已授权的 media relation 暴露；无资格、过期、撤权或归属不明时，API 不返回正文或图片句柄。

## 失败路径

| 失败 | 数据库行为 | 用户可见结果 |
| --- | --- | --- |
| 来源或摘要不一致 | 事务前拒绝，不写候选 | 维护方看到来源绑定错误 |
| flow/node/edge/media 引用不闭包 | readiness 失败，不生成 snapshot | 候选保持待修订 |
| successor 或业务审核未完成 | 不进入发布事务 | 仍为 review-only |
| 幂等键重放且请求相同 | 返回原 durable receipt | 不重复写入或发布 |
| 幂等键冲突 | 拒绝并保持原记录 | 要求使用新操作键 |
| 提交结果未知 | 通过 receipt 查询恢复 | 不盲目重发 |
| 发布时权限/版本/截止时间失效 | 发布事务回滚 | 原 current 保持有效 |
| 旧 snapshot 续用但已撤权/过期 | API/Main 重新拒绝 | 坐席不能复制旧内容或图片 |

## 所有权和接线顺序

- 治理侧：冻结 successor、OpenAPI/DDL/迁移摘要和合同来源。
- `packages/content-intake`：解析外部 candidate、投影 graph、检查 readiness、生成 review-only transaction/handoff。
- PostgreSQL：候选、审核、发布事务、不可变 snapshot 和回执；不由 renderer 或 API 自行拼接发布状态。
- API：只读取已批准且带资格的版本化 snapshot；不把候选或旧 `release_catalogs` 当正式 graph。
- Main：每次 `open/next/choose/back/copy/renew/close` 前重验资格、版本、撤权和截止时间，拥有剪贴板写入。
- Query：只发类型化意图，不持有正文、token、主体 ID 或图片路径。

接线顺序必须是：正式 mapping ready → successor 正式冻结 → PostgreSQL 候选/审核/发布/snapshot → API 只读 snapshot → Main continuation → Query actions。任何一步失败都保持旧 current 或空正式 graph，不启用 fallback。

## 方案选择

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 复用旧 `release_catalogs` JSON 直接承载 successor | 否决 | 现有空数组约束和旧 FAQ ownership 无法表达 graph identity、证据和续用语义，容易把候选伪装成正式发布 |
| 新建独立 SOP 发布库和执行引擎 | 否决 | 会复制权限、发布、回退和媒体所有权，破坏现有 PostgreSQL/Main 单一所有者 |
| 在既有 PostgreSQL 所有权内增加版本化候选、证据、snapshot 和回执边界 | 采用为后续设计方向 | 保留现有发布所有者，允许事务原子性、来源追溯和旧版本续用；正式表名与字段仍须等 successor 合同批准后冻结 |

本文完成的是 C 阶段的设计前置，不是 migration、API 接线或生产发布证据。当前 handoff manifest、隔离 PostgreSQL 演练和现有正式 schema 均保持 review-only/未激活。
