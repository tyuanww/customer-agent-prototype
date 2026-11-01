# SOP successor 合同接收边界

状态：`CANDIDATE_REVIEW_ONLY`。

本文是产品仓接收 successor 合同的核对卡，不是已接收的正式合同。它不改变 API、PostgreSQL、Main 或 Query 的运行时能力。

## 接收对象

产品仓只接收一个带来源绑定的 successor 候选包。候选包至少需要以下信息：

```text
contract              successor 合同标识
mappingVersion        真实六表映射版本
sourceSha256          原始工作簿内容 SHA-256
structureDigest       六表结构证据摘要
openapiDigest         API 合同摘要
ddlDigest             数据库结构摘要
migrationsDigest      可运行迁移清单摘要
graphShape            节点、边、流程、媒体和版本约束
publishable           必须为 false，直到正式批准
```

这些字段是来源证明和接收门禁，不是业务授权。业务授权仍由候选审核、发布事务和资格租约提供。

## 所有权

- 治理侧拥有 successor 合同、OpenAPI 摘要、DDL 摘要和迁移清单。
- 产品仓的 `content-intake` 只校验来源绑定、结构完整性和候选状态。
- API 只消费已批准的版本化 graph snapshot。
- PostgreSQL 拥有候选、审核、发布事务和不可变 snapshot。
- Main 拥有资格核验、流程会话、修订、撤权清理和剪贴板。
- Query 只发送类型化意图，不持有授权 token、主体 ID 或正文写入能力。

## 必须保持的不变量

1. `sourceSha256` 必须与真实六表只读证据一致。
2. `mappingVersion`、`structureDigest` 和来源摘要必须属于同一份映射证据。
3. graph 中的流程、任务、边、话术和媒体引用必须完整，不能只保留第一条流程。
4. 任何 unresolved 引用都拒绝进入候选投影。
5. `publishable` 为 `false` 时不能进入正式 API snapshot。
6. 真实 `domain=sop` 不能降级为 FAQ。
7. 不能用合成树补齐正式 graph。
8. 旧版本续用必须保留原 snapshot，不能静默替换为新版本。

## 拒绝路径

- 来源 SHA-256 不匹配时拒绝接收。
- 映射版本或结构摘要不匹配时拒绝接收。
- OpenAPI、DDL 或迁移摘要缺失时拒绝接收。
- graph 存在孤立节点、无目标边或媒体归属不明时拒绝接收。
- 候选状态被声明为可发布时拒绝接收。
- 任何调用方尝试走 FAQ fallback 或合成树 fallback 时拒绝接收。

## 进入下一阶段的门槛

必须同时满足以下条件：

- 六表映射返回 `ready-for-graph-preparation`。
- 业务分支、知识、资源、图片、范围、可见对象和有效期都有证据。
- 治理侧正式冻结 successor 合同。
- 产品仓完成来源哈希、OpenAPI、DDL 和迁移清单的逐项核对。

在门槛满足前，只允许 review-only 投影和离线校验，不接正式 graph 消费。
