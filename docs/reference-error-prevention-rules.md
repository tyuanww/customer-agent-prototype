# 错误预防规则表

本表记录 v0.3.35 部署中发现的错误类及其强制机制。每条规则必须有对应的自动化检查，纯文档不算强制。

| 错误类 | 症状 | 根因 | 规则 | 强制机制 | 验证位置 |
|--------|------|------|------|----------|----------|
| 1. 数据库连接猜测 | 多次尝试不同 PostgreSQL 连接方式 | 没有 SSOT 记录实际配置 | 数据库连接参数、角色、schema、函数签名记录在 `docs/reference-database-roles-and-connection.md`；修改前必须先查询 | 文档 (层级 4) — 运行时配置无法用类型强制 | 人工复核；运行时错误会暴露配置错误 |
| 2. 权限角色猜测 | 尝试不存在的角色名 (`stack_migrator`, `stack_backend_application`) | 凭命名惯例猜测，而非查询实际角色 | 同错误类 1；禁止假设角色名，使用前必须查询确认 | 文档 (层级 4) | 同错误类 1 |
| 3. 迁移 provenance drift | 服务启动失败，报告迁移 SHA256 不匹配 | 已提交的迁移文件在后续 commit 被修改 | 已记录在 `manifest.generated.json` 的迁移文件不可修改；任何字节变化都是不可变性违反 | CI 检查 (层级 2) — `scripts/check-migration-immutability.mjs` 在 CI `pnpm check` 前运行，对比 manifest sha256 与当前文件 | `.github/workflows/ci.yml` line 62 |
| 4. 非标准部署 | 直接修改软链，目录名不一致 | 未遵循标准 bundle → upload → deploy 流程 | 标准部署流程记录在 `docs/how-to-remote-development-and-deployment.md`；生产发布目录按完整 Git SHA 命名，`current` 只是软链 | 文档 (层级 4) — 部署是人工操作，无法完全自动化到层级 1 | 人工复核；`docs/reference-runtime-ports-and-release-layout.md` 记录发布目录合同 |
| 5. 版本号不一致 | VERSION 文件、package.json、git tag 不同步 | 没有自动化同步机制 | `VERSION` 文件必须与 `apps/desktop/package.json` 的 `version` 字段一致 | 测试 (层级 3) — `scripts/version-identity.test.mjs` 在 `pnpm test:workflow` 中运行 | `package.json` line 81 的 `test:workflow` |

## 修复层级参考

按 `/correct` skill 的层级从高到低：

1. **架构消除** — 给每个状态一个所有者，让错误写法无法编译
2. **类型或 CI 强制** — 错误代码无法通过构建或 CI
3. **测试** — 行为测试，实现变了但行为对就通过
4. **文档** — 最后手段，无 fail-fast 机制

## 未来改进方向

- **错误类 3** 可提升到层级 1（架构消除）：`packages/database` 的 `pnpm generate` 直接从合同 snapshot 确定性生成迁移，生成后的 manifest 成为 SSOT；手工修改迁移文件会被 `pnpm db:migrations:check` 拒绝
- **错误类 5** 已在层级 3（测试），可提升到层级 2：添加 pre-commit hook 或 CI 门禁，在 `pnpm check` 前运行 `node scripts/version-identity.test.mjs`

## 相关文档

- [工程工作流程](reference-engineering-workflow.md) — 统一的阶段顺序、Git/gstack 路由、证据复用
- [运行环境、端口与发布目录参考](reference-runtime-ports-and-release-layout.md) — 端口合同、发布目录结构
- [远端开发与部署指南](how-to-remote-development-and-deployment.md) — 标准部署流程的详细步骤

## 更新记录

- 2026-10-28: 基于 v0.3.35 部署分析创建初始规则表
