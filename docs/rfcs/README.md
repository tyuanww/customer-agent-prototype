# 可复用能力 RFC

本目录记录从当前客服 Agent 实现中识别出的潜在共享能力边界。它们是设计输入，不是已发布的共享包，也不改变当前运行时合同。

三份 RFC 都遵守同一条门槛：出现第二个真实消费者后，先用独立适配层验证公开接口，再决定是否建立 workspace 包。只有当前项目通过测试，不能证明跨项目复用成立。

| RFC | 当前 owner | 候选能力 | 启动条件 |
| --- | --- | --- | --- |
| [合同运行时](2026-10-02-contracts-runtime.md) | `packages/contracts` | JSON Schema component validator 与错误归一化 | 第二个项目使用相同合同运行时语义 |
| [Migration 控制面](2026-10-02-migrations-control-plane.md) | `packages/database` | catalogue、ledger、锁、runner、verifier | 第二个项目需要同样的 PostgreSQL 控制面 |
| [安全边界](2026-10-02-security-boundaries.md) | `apps/api/src` | canonical JSON、HMAC、输入限制、纯授权谓词 | 第二个项目拥有可比较的安全合同 |

## 如何使用

实现新项目时，先把项目自己的合同、迁移 SQL、策略和密钥域留在项目内，再对照 RFC 写一个本地 adapter。adapter 至少要证明成功、拒绝、回滚和敏感字段处理；验证前不要把候选能力提升到公共 package。

RFC 中的“公开 API”是候选形状，不代表当前仓库已经提供该入口。当前可用入口仍以各 package README、架构参考和代码为准。

## 相关入口

- [项目架构与目录边界](../reference-project-architecture.md)
- [工程工作流程](../reference-engineering-workflow.md)
- [贡献约定](../../CONTRIBUTING.md)
