# B3 负责人承接输入与离线装载

> **当前进度入口：** 本页保存形成时的计划、批准范围或证据，不维护最新进度；当前动作统一见[执行清单](2026-09-06-execution-goal.md)。已批准范围继续有效，历史状态不覆盖新的具体授权与实测。

> **状态：** `APPROVED · SYNTHETIC IMPLEMENTATION ONLY`
> **实施：** `LOCAL VALIDATED · PR HANDOFF PENDING`
> **依据：** 用户 2026-09-06 授权逐功能 PR 自主实施；依赖产品 PR #29 `9e579e1` 的完整不可变合同。仍不授权真实文件读取、T5/T6、运行接入或部署。

所有者：输入读取器拥有闭合 v2/v3 包与外部锚点；内容身份模块拥有规范化内容、审核前投影与最终摘要；loader 只从实际输入生成数据库 snapshot，并在同一事务登记、验证完整集合、插入和后验。runner 拥有隔离 PG、只读搜索事务和清理。

比较逐条内嵌重复记录与单独第五文件两种方案。采用 `owner-acceptance.json` 单记录文件，v3 manifest 固定五成员；调用方显式传入独立记录 SHA-256 和负责人 subject hash，缺少或不匹配均在创建 PG 前失败。文件自报值不能形成批准。v2 四成员与 single/dual 保持原规则；v3 可同时容纳 legacy 内容，但承接 scope 必须精确覆盖全部 owner 条目，无默认回退。

规范化知识收进一个内容身份模块；JS 从实际字段构造审核前摘要，PG 从原始字段独立调用官方 snapshot/hash 并核对 scope，防止两个运行层共同信任自报摘要。承接记录仅允许无冲突内容；风险字段、版本、来源、期限、owner/EVD 与四域绑定逐项校验。

owner 路径使用 `READ COMMITTED`，符合源合同的来源/撤销 fence；评测事务仍为 READ ONLY，旧 v2 保留 REPEATABLE READ。loader 的失败整批回滚，runner 继续关闭全部 client、停止并删除临时 cluster，报告保持脱敏、零事件、NOT_SIGNED/NOT_EVALUATED。

验证：v2 回归；v3 全链 50 条合成搜索；缺失/错误外部锚点、记录或内容漏增、正文/风险/版本篡改、owner/EVD/期限/冲突、撤销及来源停用；JS/SQL 摘要对照与直传 loader 篡改回滚。运行相关 unit/PG15、全仓 lint/typecheck/test/build/workspace 检查后独立 review 和 PR。

## 实际证据（2026-09-06）

- `pnpm test:g1a:e0`：4 文件、69 项通过，包含 7 项 PG15 集成；owner 全链 50 条合成搜索、零事件、清理通过。直接调用 loader 的六类篡改均整批回滚，随后合法装载成功；repeatable-read、来源停用和撤销路径拒绝搜索。
- `pnpm test`：contracts 17、database 19、API 143、desktop 509 与 artifact-boundary 8 通过；25 项显式 integration 默认跳过，其中本步 E0 另行运行。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm workspace:check`、`git diff --check` 通过。来源预算 10.6 MiB / 32 MiB。
- 独立只读 review 无待修项。B1/B2 的数据库和 API 专项未重复：本步未更改 DDL、migration、生产 API 或权限清单。未运行桌面 E2E：桌面无变更。
- 合成测试不替代仓外真实装包、T5/T6、宿主级网络隔离、Windows 或发布证据；本步不合并或部署。
