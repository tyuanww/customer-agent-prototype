# 负责人承接 B1/B2：不可变合同消费与迁移

> **计划状态：** `APPROVED · SYNTHETIC IMPLEMENTATION ONLY`
> **实施状态：** `LOCAL VALIDATED · PR HANDOFF PENDING`
> **依据：** 用户 2026-09-06 授权按小功能 PR 自主推进负责人承接合同实施；本切片仅包含完整合同接收、代码生成和数据库后缀迁移。源合同已在治理 PR #67 提交并通过 CI，不以代码实现签发真实内容或运行权限。
> **产品起点：** `bb1925ef1816e7e6bb3e4de490fe071a02cc3f46`；独立分支 `codex/owner-contract-consumption`。

## 1. 来源与边界

- 合同：`cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701`。
- 治理 source Git：`2c75d8e7670134e6aa95a4780ff09fe0422a65e8`；[PR #67](https://github.com/weiweity/tianyuan-ai-brief/pull/67)，[CI](https://github.com/weiweity/tianyuan-ai-brief/actions/runs/34011148178)。该 PR 为尚未合并的治理堆栈顶部，来源提交已可验证，不宣称治理 main 已包含此合同。
- OpenAPI SHA-256：`361f20128c88143eb87370f136b67c4de8c1ed5fc02c7072f62c16545951315c`。
- DDL SHA-256：`859c4a4757d87e642e797ad8a26cfb334c49ae7f8f263966099eb89e6750b38b`。
- 接收器从已提交来源核对字节、大小和 SHA 后复制三成员不可变快照；消费锁继续 `VERIFIED_NOT_ACTIVATED`、`ddev_authorized=false`、`runtime_activated=false`。

## 2. 边界方案与实现

比较了直接重放聚合 DDL 和保留历史追加后缀两个方案。聚合 DDL 是全新安装参考，直接重放会重建已有对象并破坏账本。采用原样保留 0001–0011、提取六个增量及最终 schema marker 的单个 0012；由 runner 拥有外层事务，迁移和账本一起提交，避免暴露只安装了一部分承接约束的状态。

- 根 intake 拥有固定版本/双路径配对；禁止旧 OpenAPI 与新 DDL 混配、未知版本或路径重定向。
- contracts 从锁内快照生成 133 个 component（新增 OwnerAcceptanceRecord）及 ReviewMode。没有新增 HTTP 路径。
- database 生成器核对聚合总哈希、七个源段顺序/摘要和完整旧 v1.14 前缀；迁移 provenance 保留每段来源行号。
- migration 0012 在同一事务创建登记/撤销、摘要、存储约束、导入终结和发布/回滚/current gate；原应用角色不获得登记能力。
- verifier 精确检查 42 表、2 视图、159 函数、6 个安全角色、170 条 ACL、1446 条对象信息和 31 个触发器。API readiness 新增四个实际搜索依赖，共 15 个函数/视图摘要成员。
- 登记角色已经存在时安装失败关闭，不自动重用或删除既有角色。测试各用独立临时 PG15 cluster；失败后仍保留合法 11 段账本，排除冲突后才可重试。

## 3. 验证记录

仅使用合成与一次性 PG15：

| 验证 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` | PASS；包含 133 component 延迟编译、509 desktop/component/script 回归与产物边界测试 |
| `pnpm test:db` | PASS；19 单元测试、compiled package smoke、13 PG15 集成测试 |
| API `test:integration` | PASS；43 项，含现有 Search + Events 与 50 条合成搜索 runner |
| `pnpm test:g1a:e0` | PASS；54 项，现有 single/dual 仓外合成包和成功/失败清理保持可用 |
| `pnpm workspace:check` | PASS；source budget 10.7 MiB / 32.0 MiB |
| 生成物及历史迁移核对 | 合同/迁移生成物一致；0001–0011 与基线字节完全一致 |
| `/review` | 主审及独立只读专项复核无待处理问题；专项覆盖提取范围、来源、事务和权限指纹 |

正式服务候选产物脚本要求干净工作树，因此提交前按预期拒绝 `M0_FORMAL_CANDIDATE_REQUIRES_CLEAN_WORKTREE`，提交后单独核验。没有运行 Electron E2E、设备验收或桌面打包：本切片不修改桌面行为或原生信任边界。上述证据均不代表真实 G1a 或上线。

## 4. 后续

B3 才修改仓外输入合同、实际内容摘要和受控 loader；B4 负责仓外装包器。本 PR 不读取真实资料、不改历史包，不运行真实 T5、不签发 T6，不涉及桌面交互、正式身份、部署、merge 或上线。
