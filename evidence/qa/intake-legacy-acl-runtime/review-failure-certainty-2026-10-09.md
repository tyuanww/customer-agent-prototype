# 容量与组织写入的提交确定性定向修复

基线为产品 `codex/intake-organization@466fac49`，版本保持 `0.3.26`。本轮只用本地合成身份、文件与临时 PG15；不接入真实飞书、客户资料、员工资料或生产账号。发现来自整分支有界只读审查，不代表完整 `/review` 已结束。

## 确证问题与改动

- 容量预留或持久化的 `COMMIT` 回执丢失时，容量层虽保留 reservation 和损坏连接，却把原始异常抛给上传层；上传层的通用失败转换将它标为 `commit=rolled_back`。合成 PG15 的现有容量测试已验证回执丢失后 reservation 可实际存在。本轮新增管理 HTTP 探针在修前得到 500，修后得到 `503/OVERLOADED/COMMIT_UNKNOWN`、零正式对象、零上传回执，持久化 reservation 仍占容量。容量层现用专门错误承载 `COMMIT` 或 `ROLLBACK` 无法确认的结果；上传层保留 `commit=unknown`，不会把它写成确定回滚。
- 容量预留发生在上传回执写入之前。此处 `COMMIT_UNKNOWN` 并不意味着原 `operationId` 已可查到这笔临时 reservation；后续仍须按既有容量/保留流程核对，不能把保留桌面 pending 写成自动恢复或不重复预留的保证。
- 组织登记和事实 writer 在 `ROLLBACK` 抛错时销毁连接，却仍返回 `commit=rolled_back`。新增 PG15 合成连接替身先让数据库执行 `ROLLBACK`，再丢失响应；修前登记返回 `VERSION_CONFLICT/rolled_back`，修后登记和事实 writer 均保守返回 `DEPENDENCY_UNAVAILABLE/unknown`。真实断线时能否回滚不能由此探针证明；结果未知时沿原版本/请求恢复，不能换新操作假定失败。
- 桌面 `FILE_LIMIT`、`FILE_INVALID` 共用提示不再要求 XLSX；CSV/XLSX 均按当前来源格式重新导出。文件选择器原本已接受两种格式，本轮未改变解析或发布流程。

## 实际验证

红测：`CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --dir apps/api exec vitest run tests/content-intake.integration.test.ts experiments/intake-organization/registered-refresh.integration.test.ts -t 'management HTTP reports an unknown upload outcome when the capacity COMMIT response is lost|does not certify a rollback when its response is lost during registration or fact writing'`，修前退出 1，`2 failed | 170 skipped`；两条失败分别是 HTTP 500 对期望 503，以及组织返回 `rolled_back` 对期望 `unknown`。

修后同命令加上 `capacity: serializes tenfold admission`：退出 0，`3 passed | 169 skipped`。正常路径另跑 `management HTTP uploads real bytes idempotently, drives parse and pages immutable authorized material|reads registered identity, persists exact provenance atomically and rejects modified replay`：退出 0，`2 passed | 170 skipped`。这些 PG15 用例对网络回执丢失使用合成连接替身，数据库和 HTTP 状态是真实临时实例；未模拟生产网络或真实飞书。

仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均退出 0；默认测试按仓库配置跳过 PG15，不能代替上述定向用例。`pnpm workspace:check` 退出 0，分组预算为源码 16.8/20、冻结合同 12.8/15、冻结证据 9.88/10 MiB，合计约 39.5/45.0 MiB。本轮未做新安装包、真人系统框、Windows 或真实资料验收。

## 回退部分失权的合同解释和回归

用户确认：回退计划仍属于操作者、但只对部分影响来源有权限时，整单拒绝且返回 `403/FORBIDDEN/SCOPE_DENIED`；全部影响来源失权时返回 `404/NOT_FOUND/SCOPE_DENIED`。治理仓新增 `90-评审/2026-10-09_P2回退部分失权合同解释.md` 记录其与既有资源隐藏/策略拒绝规则的关系，没有修改冻结 OpenAPI、DDL 或导出。产品的两条 PG15 HTTP 回归用合成双来源目录覆盖：计划准备后撤掉一项权限仍是 403；普通部分失权仍是 403，错误响应不披露失权的 source-b；全失权及准备后全失权仍是 404；两种状态均没有新回退 publication、永久回执或 current 指针变化。执行命令：`CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --dir apps/api exec vitest run tests/content-intake.integration.test.ts -t 'rollback: a synthetic two-source catalog proves full impact authorization without exposing denied scopes|rollback: full grant loss after prepare is a resource-level 404 without a publication'`，退出 0，`2 passed | 160 skipped`。

完整 `/review` 与 `review.json.externalCompleteReview` 仍为 `INCOMPLETE`。当前 26 路径增量的 Codex 宿主对抗和 Testing/Maintainability/API Contract 专项未发现可行动缺陷；本轮之后的新增代码仍需增量复核，不能借用前一候选的无发现结论。该解释不更改冻结机器合同，也不代表真实设备或真实数据验收。
