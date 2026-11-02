# 2026-10-31 SOP 当前阶段质量收尾

状态：`READY_FOR_REVIEW`。本文只收尾真实六表映射和候选登记阶段，不代表正式 SOP 已发布或已接入生产。

## 完成质量

当前阶段完成了真实六表的结构证据绑定、候选业务身份设计、候选登记失败关闭、映射占位值拒绝，以及 successor 候选、snapshot readiness、事务前置条件和 review-only handoff manifest。正式 graph、API、PostgreSQL、Main、Query、安装包和业务验收仍未进入本阶段。

真实映射保持 `mappingState: "candidate"`、`publishable: false` 和 `needs-business-confirmation`。任何候选身份和入口词都保持禁用。

## 代码质量

- `checkRealSixSheetMapping` 只接受固定来源 SHA、六表结构和显式业务声明。
- `待业务确认`、`pending`、`TBD` 和 `TODO` 等占位值会被拒绝。
- 候选身份登记只有一个机器可读来源。Markdown 只解释规则和边界。
- 候选登记检查已接入 `test:workflow`。
- 业务决定记录明确区分工作决定和正式发布批准。
- handoff parser 固定来源哈希、映射版本、候选身份、snapshot hash 和两类审核证据；`state=CANDIDATE`、`publishable=false` 不能被外部 JSON 改写。

## 架构结论

映射校验、候选登记、graph projection、snapshot gate、事务候选和 handoff manifest 保持在 `packages/content-intake` 及离线脚本边界内。PostgreSQL 只做隔离临时表演练；这些模块不拥有正式 API、数据库 schema、Electron Main、preload 或 renderer 状态。候选数据没有运行时入口。正式 graph 消费必须等待业务映射、合同冻结和权限边界完成。

## 实际验证

- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `pnpm --filter @customer-agent/content-intake test` 通过，432/432。
- `pnpm test:workflow` 通过，196/196。
- `node scripts/architecture-boundary-check.mjs` 通过，562 个文件、0 条违规。
- successor、snapshot、事务和 handoff 定向测试通过，39/39；隔离 PostgreSQL 15 事务演练实际 6/6 通过，新增 snapshot 来源摘要漂移回滚、successor/business 双摘要隔离及未完成审核拒绝检查。
- `pnpm typecheck`、`pnpm lint`、文档 349 文件、候选登记检查和 `git diff --check` 通过。
- 候选登记脚本、文档检查和 `git diff --check` 通过。

## 未完成项

真实业务仍需确认稳定编号、入口词、分支目标、知识和资源所有权、适用范围、可见对象及有效期；successor 仍需正式冻结和批准。确认完成前不能生成正式 graph snapshot，也不能开始后续正式 API、PostgreSQL、Main 和 Query 接线。当前 handoff manifest 只记录 review-only 候选，不是合同接收或发布凭据。

完整 `pnpm test`、生产构建、正式安装包、第二坐席验收、正式 SOP 接线和生产发布不属于本阶段验证范围。
