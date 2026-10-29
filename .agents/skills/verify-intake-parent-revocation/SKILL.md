---
name: verify-intake-parent-revocation
description: "核验客服 Agent 父授权撤销后子业务授权必须失效。修改 grants、授权 SQL、角色上限或迁移验证时使用；在独立 PostgreSQL 15 临时库穷举真实函数，不连接测试或生产库。"
---

本 Skill 验证一个承诺：撤销父 allocation 后，它签出的 business grant 不能再被任何授权函数放行。违反这个承诺会使已经收回的权限仍然可用。

## 执行

从仓库根目录运行。使用仓库已有依赖、Node.js 24、pnpm 11.19.0 和 PostgreSQL 15；不自动安装、不启动现有环境。

```sh
PATH="/Users/hutou/homebrew/opt/node@24/bin:$PATH" \
CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
node .agents/skills/verify-intake-parent-revocation/verify.mjs /tmp/customer-agent-parent-revocation.json
```

脚本先核验生成物与源文件一致、构建 database runtime，再通过项目的 `Pg15Harness` 创建全新临时集群；没有数据库连接地址参数。每组场景回滚，退出时停止并删除临时集群。报告只含合成主体、源码哈希和验证状态。

结果解释：

- 退出 0：迁移完整后验通过，672 组均满足不变量，负向对照被抓住，恢复后与原结果一致。
- 退出 1：发现权限反例或迁移完整后验失败。阅读 `bootstrap` 和 `result.counterexamples`，不能当作通过。
- 退出 2：fixture、断言或运行错误，不能据此宣称产品缺陷。前置版本、生成物检查或构建失败也属于未完成验证；此时可能没有报告。

## 验证方法与范围

使用真实 PostgreSQL 函数的有限穷举，未使用手写授权模型。没有适合本项目 PL/pgSQL、触发器、SQL 组合的现成源码证明器，因此用 PostgreSQL 15 执行所有选定输入。它不是无界形式化证明。

固定 1 个租户/应用、1 个范围、1 个来源、2 个主体、1 条 allocation 父授权和 1 条 business 子授权。穷举 7 种角色 × 8 种动作 × 2 种 steward 状态 × 2 种子授权撤销状态 × 3 种人员事实状态，共 672 组。

角色为 director、manager、supervisor、lead、engineer、agent、enabler；动作直接使用数据库的 query、content-manage、import、source-confirm、review、publish、candidate-cancel、rollback。事实为有效、禁用、过期。签发人始终拥有有效 director 资格；父子授权满足范围、动作和时间包含关系。`SET CONSTRAINTS ALL IMMEDIATE` 确认延迟外键成立，避免把非法数据库状态误报成业务反例。

每组读取撤销前两个真实函数的结果，再撤销父授权并同时要求：

1. `authorization_deadline` 返回 NULL。
2. `authorization_sources` 不返回目标范围/来源。

至少一组撤销前必须同时放行，防止空跑。每次执行还会在这个临时库中暂时移除真实 `authorization_sources` 的 `ancestor.revoked_at IS NULL` 校验，验证“父授权已撤销”的原本拒绝场景变为反例，再在 finally 中还原函数，并重新穷举、对比全部结果。此负向对照不会修改仓库 SQL 或任何已有数据库。

不覆盖多层 delegation、并发事务、多个候选授权、任意时间顺序、通配 source、policy/store-set 换版、跨租户攻击、HTTP 路由、Electron IPC、飞书身份获取、实际人员权限或备份恢复。API 消费方仅用于确认影响范围，没有随本命令执行端到端验证。

## 当前验证记录

修复基于提交 `4635ef01581877edfd17b3763b7de66e4a60393c`，增加 `0076_authorization_decision`。2026-10-29 在 Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18 实测工作区修复：完整 77 段迁移后验成功，672 组中 0 个反例，撤销前有 42 组合法正例；负向对照被抓住，还原函数后重新穷举一致。该记录针对未提交修复；准确内容以每次报告的源码 SHA-256 为准，不表示基线提交已经含有修复。

修复前同一不变量有 84 个反例，且 verifier 拒绝完整 75 段目录。修复后脚本要求正常迁移及完整后验成功，不保留绕过 verifier 的续跑逻辑。

多层 delegation、真实调用角色、策略与店铺换版、通配来源和 75→76 升级由 `packages/database/tests/authorization-lifecycle.integration.test.ts` 单独验证，已经加入 `pnpm test:db:integration`；它们不算作本命令的 672 组覆盖。

## 源码对应与维护

直接执行的函数与约束：

- `packages/database/overlays/0055_grant_steward_required.sql`：steward 与父授权依赖。
- `packages/database/overlays/0057_role_ceiling.sql`：角色上限、两个授权函数的原有边界。
- `packages/database/overlays/0060_grant_issuer_authority.sql`：父子关系与签发人资格触发器。
- `packages/database/overlays/0076_authorization_decision.sql`：当前共享授权决策，sources 检查全部祖先，deadline 取同范围/来源的最大截止。
- `packages/database/migrations/manifest.generated.json` 与 `packages/database/src/generated/migrations.generated.ts`：实际运行的完整迁移目录；由 `check:generated` 核对，不手改。
- `packages/database/src/runner.ts`、`verifier.ts`：迁移提交及完整后验；精确校验 74、75、76、77 的函数与 ACL 指纹。

影响判断的消费方：`apps/api/src/content-intake/authority.ts` 的 `authorize`、`candidate.ts` 的审核资格、`discovery.ts` 的来源发现按动作集合读取 sources；`usage.ts` 的查询资格与 `apps/api/src/project-roster-login.ts` 的登录动作投影使用 sources。不要把数据库函数反例夸大为所有 API 都已成功越权。

报告记录被覆盖源码的 SHA-256 和安装函数的 MD5。改动上述文件、角色/动作集合或数据约束后，先核对场景仍然可达、集合仍完整，再运行。若新约束合法拒绝 fixture，要修正构造方式，不能关闭约束；若业务规则有意改变，应先确认新规则，再同步不变量和边界。不得为消除红灯而弱化断言或修改产品代码。

只有重新核对代码关系、实际运行且负向对照有效后，才能推进同步提交。迁移正常路径必须通过完整 verifier，不能添加诊断豁免。代码变化后没有同步验证，可用 `/maintain-formal-verification-skill` 重新对齐本 Skill。
