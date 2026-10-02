# RFC：Migration 控制面边界

状态：`DRAFT · 等待第二个真实消费者`

本 RFC 讨论把 PostgreSQL migration 的 catalogue、账本、锁、执行和后验机制复用于第二个项目的条件。当前实现继续由 `packages/database` 独占；它不是 API runtime 的生产依赖，也不授权自动迁移或生产数据库操作。

## 当前 owner

`packages/database` 负责从已验证合同快照确定性生成 migration，并封装：

- migration catalogue 的身份、顺序、checksum、来源范围和兼容元数据；
- `status → plan → apply → verify` 的控制面；
- 单 client、session advisory lock、逐段事务、账本读取和失败关闭；
- 精确的表、view、function、ACL、能力角色与 schema marker 后验。

当前 package entry 暴露 `inspectDatabaseMigrations`、`planDatabaseMigrations`、`applyDatabaseMigrations`、`verifyDatabaseMigrations` 及对应只读类型。它拒绝裸 `pg.Pool`、并发控制面操作、未知 catalogue、未登记 schema 和账本漂移。

## 候选公开 API

第二个消费者可以验证下面的候选形状，具体类型名仍由 RFC 实施 PR 决定：

```ts
inspect(client, catalogue) -> MigrationStatus
plan(status) -> MigrationPlan
apply(client, catalogue) -> ApplyMigrationsResult
verify(client, catalogue) -> DatabaseVerificationReport
```

候选 API 的输入必须是已经验证的、不可变的 catalogue 和一个已连接、已 checkout 的数据库会话。`status` 与 `plan` 只返回 provenance 和 migration metadata，不返回可执行 SQL；只有 `apply` 在锁和事务边界内执行 catalogue 中的 SQL。

## 留在项目内的知识

- migration SQL、schema 名称、表 / view / function 清单和权限模型；
- `contract_set_id`、来源 SHA、DDL hash、历史 signed baseline 和 reviewed upgrade；
- capability role 名称、`SECURITY DEFINER` 入口、ACL 允许矩阵和业务 seed；
- 生产环境的备份、回滚、发布窗口、连接凭据和部署编排。

共享控制面不能把不同项目的 catalogue 拼接成一个“通用 schema”，也不能把某项目的 role grant 当作默认策略。

## 依赖与注入

候选共享层只应依赖一个窄的已连接 query capability 和不可变 catalogue：

- 不读取环境变量，不创建连接池，不解析 DSN；
- 不依赖 Fastify、Electron、API route 或业务 repository；
- 由项目注入 catalogue、schema marker、compatibility policy 和验证清单；
- 若未来需要可测试时钟或锁等待参数，显式注入并设置有界默认值，不从全局读取。

当前以 PostgreSQL 15 为目标。抽取前不能把 PostgreSQL 方言假装成数据库无关；第二个项目若使用其他数据库，应先建立独立 adapter，而不是扩大本 RFC 的第一版范围。

## 失败策略

| 情况 | 结果 |
| --- | --- |
| catalogue 身份、顺序、hash 或来源无效 | 在查询前失败，禁止执行 |
| 数据库没有可信 ledger 且已有非空 schema | `MIGRATION_UNTRACKED_SCHEMA`，禁止猜测状态 |
| ledger 顺序、hash、provenance 或时间漂移 | `MIGRATION_LEDGER_DRIFT`，停止执行 |
| advisory lock 获取失败或超时 | 返回 lock failure，不绕过锁 |
| migration 失败 | 回滚当前事务；保留 migration id 和受限诊断 |
| 提交结果未知 / rollback 失败 | 进入显式 `unknown` 结果，禁止假定成功 |
| 后验不符合 catalogue / ACL 合同 | verify 失败，不能写成 ready |

状态和报告不能泄露 SQL、凭证、完整数据库错误 detail 或真实数据行。

## 独立验证方式

第二个消费者的 adapter 至少应有：

- 纯单测：catalogue 身份、顺序、hash、compatibility 和 ledger 漂移反例；
- 编译包入口 smoke，证明生产入口不带 testkit 或 API 依赖；
- 一次性 PostgreSQL 15 集群中的 fresh、partial、complete、lock、rollback、commit-unknown 和 verify 反例；
- 精确 ACL / function / role 后验，不以“迁移命令退出 0”替代；
- `check:architecture` 证明共享层不依赖项目 apps。

两个项目都通过独立 adapter 后，才能比较 catalogue 抽象是否稳定。若测试只能复用某项目的 migration SQL，说明还没有跨项目边界。

## 停止抽取条件

出现以下情况时保留项目内控制面：

1. 项目需要不同的 ledger 语义、兼容规则或提交未知处理；
2. 公开 API 必须暴露项目表名、角色名、ACL 或 schema marker；
3. 共享层需要创建连接、读取 env、管理备份或触碰部署发布；
4. 为了支持第二个数据库方言而引入大量条件分支，且没有独立 adapter 层。

## 相关文档

- [`@customer-agent/database` README](../../packages/database/README.md)
- [项目架构与目录边界](../reference-project-architecture.md)
- [可复用能力 RFC 索引](README.md)
