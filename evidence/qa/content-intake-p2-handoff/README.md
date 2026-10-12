# P2 合同交接验收 · 2026-10-06

> 证据交付边界（2026-10-12 校正）：下文 `.gstack/` 文件只在原本机工作树保留，未随 Git 交付，远端审阅者不能据此直接复核原始执行。本文保留历史观察及其限制；这些本机路径不是仓内可点击证据，也不证明当前版本通过。
本次完成治理合同的产品接收、类型/validator 生成和追加迁移，未实现完整 FAQ 运行流程。依据与下一步见[需求计划 §0.5](../../../docs/plans/2026-10-03-content-intake-requirements.md#05-本地提交与产品合同交接2026-10-05-授权2026-10-06-接续)及[P2 交接](../../../docs/reference-content-intake-p2-contract-handoff.md)。

## 候选与输入

- 产品分支 `codex/content-intake-p2`，依赖 P1 `d9e68ace6c1cb61c691e85bed6d7af42b0fa144e`；不把 P1 当成本轮新变更。
- 治理提交 `d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713` 已生成不可变 export，产品实际执行 `contracts:intake --source=<该 export> --source-repository-root=<治理 worktree>`，结果 `CREATED`。来源 Git blob、双哈希、字节数均核验；精确标识由[消费锁](../../../contracts/upstream/customer-agent/contract-set.lock.json)拥有。
- 本轮代码/测试/合同输入摘要：`5325b90ca47a4be45b8bf1478912b7cdad832a923f6d332b14d9d887ee96a576`。算法：对所有相对 P1 新增/修改的非 Markdown 文件建立按路径排序的 `path→原始字节 SHA-256`，compact JSON 后 SHA-256；未变文件沿用 P1。完整清单在本地 `final-code-inputs.json`。
- Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18；PG15 testkit 每例独立临时 cluster、Unix socket，无 TCP/真实凭据/业务数据。QA 证据封装器为 Bun 1.4.2。
- 原产品工作区 `TODOS.md`、未跟踪计划和治理原工作区现有文件均保留。

## 修改与修复

1. intake 只新增已审 OpenAPI1.16.0/schema1.20 精确版本与来源路径对；错配、假来源、漂移仍拒绝。
2. 生成器区分 schema 节点、字段字典和字面量。新材料字段 `required` 曾被当关键字，使旧接口 validator 也无法编译；现在保留 `required`/`description`/`x-*` 业务名称及常量值，222 个组件均实际编译。
3. 旧 0001–0019 保持原字节和 provenance；仅追加 0020/0021。旧 overlay 源和冻结 SQL 同时校验，不能把修改旧源变成静默无效操作。
4. 新封闭存储纳入原 verifier。修前实测：删掉 `version_check` 后负数版本被接受但 verify=PASS。修复把 DOMAIN 的 CHECK、基类型/修饰、默认值、空值规则、排序规则和 ACL 纳入既有摘要；原复现现在触发 `MIGRATION_VERIFY_FAILED`，永久回归覆盖这些漂移及回滚后恢复。
5. 实测清单为 215 ACL、2680 对象、209 函数、74 触发器。额外四条 ACL 是原来未观察到的 domain 默认 PUBLIC USAGE，不是应用 schema/表授权。七种应用角色访问新表均被拒绝。

校验仍由 database 深模块拥有，沿用 `status → plan → apply → verify`，未增加调用方必须配套执行的第二个校验器。选择追加迁移而非重写历史；选择扩展现有精确摘要而非新建类型检查服务。

## 实际验证

详细文件均在当前 worktree 的 ignored `.gstack/content-intake-p2-handoff/`；该目录不是运行或发布产物。下列结果均为真实执行，失败历史仍保留。

| 命令 / 范围 | 结果 | 原始记录 |
| --- | --- | --- |
| `pnpm lint` / `pnpm typecheck` | PASS | `lint-domain.log` / `typecheck-domain.log` |
| `pnpm test` | PASS；API 443 pass / 91 skip，桌面 1096 pass / 1 skip | `test-domain.log` |
| `pnpm build` | PASS，含生成物一致性与实际服务/桌面构建 | `build-domain.log` |
| `pnpm contracts:verify` | VERIFIED，仍未激活 | `review-qa/.qa-evidence/001/` |
| intake 单测 | 19/19，含新精确版本对、混用/错路径拒绝 | `review-qa/.qa-evidence/002/` |
| contracts generator/runtime 定向 | 19/19，含 222 schema 编译及生成字节可再现 | `review-qa/.qa-evidence/003/` |
| `pnpm test:db:integration` | 17/17；空库、历史前缀升级、旧账本不变、漂移、并发/未知 COMMIT 恢复 | `postgres-final.log`，`review-qa/.qa-evidence/004/` |
| API 真实 PG import / worker / release 定向 | 21/21；显式启用 `CUSTOMER_AGENT_API_PG15_INTEGRATION=1` | `api-publish-integration.log` |
| `pnpm workspace:check` | PASS，20.6 MiB / 32 MiB | `workspace.log` |

隔离 PG 使用 `CUSTOMER_AGENT_PG15_BIN` 指定 PG15。API 定向命令为 `pnpm --filter @customer-agent/api exec vitest run tests/content-import.integration.test.ts tests/content-worker.integration.test.ts tests/content-release.integration.test.ts`。生成、接收、迁移均经真实消费者验收，不以子进程退出码代替输出检查。

原始缺陷与修复轨迹：`runtime-contracts.log` → `contracts-green.log`；`domain-drift-adversarial-evidence.json` / `domain-regression-red.log` → `domain-original-replay.log`（按原脚本运行，现因正确拒绝而退出 1）及 `postgres-final.log`。修复后曾有一条 NOT NULL 测试选择数组元素域被 PG 拒绝，已改用标量版本域并纠正 TYPE 授权语法；不将该设置失败写成产品通过。

## 代码审查与范围

- 使用用户指定 `open-code-review-delegate`：OCR 只负责选文件与规则，宿主审查。最终 30 路径全部交代；10 个可审项 10/10，20 个默认排除项有明确理由（14 个测试/生成物、6 个 Markdown）。测试由宿主完整补审；生成物核对生成源、字节及实际消费者；冻结上游复用同一治理提交的有效审查，不声称再次逐行人工阅读全部历史 SQL。
- 修后本机对抗复核无剩余具体代码缺陷。新发现的 DOMAIN 漏检已修复；交接文档旧 ACL 计数已同步。
- Claude Code 原完整输入两次因 500000-token 上限被拒绝；改为完整文件分组，结构化 2/2 组完成且通过结果校验，无待修代码发现。对抗第 1 组完成；第 2 组虽返回结论，但缺规范 Recommendation 行，结果校验失败，**保留该组外部覆盖缺口**。运行返回模型 `claude-opus-5`，完整原文、modelUsage 和验证结果均保留；不得据此写成所有外部审查通过。
- 治理阶段历史 `/review` 三次修复后 INCOMPLETE、超时和校验失败仍为历史事实；当前产品接收审查不能替其改写历史或代签三方 EVD。

### Exploratory QA and Verification Results

功能面为 CLI/生成物/隔离数据库，无视觉评分。5 分钟 smoke 中完成有效合同接收、混版本/来源拒绝、字段名/字面量转换检查；新增 DOMAIN 修复属于必要复核，使用独立 120 秒命令上限。安全数据与实际观察由 `gstack-qa-evidence` 落盘，检查点依次为本地 002（本机历史文件 `.gstack/content-intake-p2-handoff/review-qa/exploration-002.json`）、003（本机历史文件 `.gstack/content-intake-p2-handoff/review-qa/exploration-003.json`）、004（本机历史文件 `.gstack/content-intake-p2-handoff/review-qa/exploration-004.json`）。

检查前后核对非文档输入；未变化的合同、解析和 API 实库证据复用。DOMAIN 源码变化后已重跑仓库四项及 PG 必要回归。最终仅校正 PG 测试设置和说明文档，PG17重新通过；未重复不受其影响的全仓检查。临时 PG 实例已停止；持久保留本地审查/测试日志供审阅。

## 未验证项与下一步

- 根测试默认跳过的 API/桌面专项仍按其开关列为未运行；其中本次受影响旧内容链的 21 项已另外运行。未做新 FAQ UI、Electron/跨平台/真实 OS、安装包、真实飞书或业务资料验收。
- P2 存储仍封闭，消费锁为 `VERIFIED_NOT_ACTIVATED`。完整权限事务、持久候选、人工审批适配器、旧写隔离、原子发布及第二坐席查询尚未接线，不把此次交接称为完整 P2 功能完成。
- 下一切片从 API 权威事实/授权及持久候选事务开始，复用既有身份、幂等/未知回执和 P1 模型；通过对应并发、撤权、跨店拒绝及旧写隔离测试后再开放受控 DB 入口。
- 本轮仅获本地 commit；不包含 push、PR、merge、deploy、真实数据或 v2-active。三方公开交付 EVD 仍待齐。
