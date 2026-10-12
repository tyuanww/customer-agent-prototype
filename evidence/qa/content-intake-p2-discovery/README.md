# 授权店铺与来源发现验收

基线 `c0db575001d5b4d74a19f43b16e1206d90f3f43b`，`codex/content-intake-p2`，2026-10-06～07。本次只使用合成 fixture、隔离 PG15 和 loopback HTTP。授权范围与边界方案见[计划 §0.17](../../../docs/plans/2026-10-03-content-intake-requirements.md#017-授权店铺与资料来源发现2026-10-06)。

## 当前行为

- 冻结 `/authorization`、`/sources` 的封闭读取复用真实认证引用、组织事实及权限谓词；按来源区分业务操作、分配和委派。
- 分页绑定会话/列表/投影/有效期，跨会话、撤权、模式变化和服务重启后不能继续旧游标。来源和权限只作发现提示；查询/复制仍须取得完整发布资格。
- Main 收齐分页并复核可见权限的一致性后返回可选店铺；品牌通用不当全店、分配资格不当业务权限。50 页/列表和合计 8 MiB 预算失败关闭；此上限不承诺所有字段均取最大长度时容纳 5000 个来源。
- 实际 ProductHttp/ProductSession 探针从返回店铺选择，消费 101 条合成发布结果、多行原文、全停用新版及撤权后的零店菜单；取消和退出不会交付旧结果。

## 审查与修复

使用用户指定的 `open-code-review-delegate`：OCR 只负责选文件和规则，宿主逐文件审查；`/review` 增加宿主内独立对抗复审。独立审核对测试/fixture 只看统计与覆盖概要，主审核读取完整测试。本轮没有调用外部模型，历史外部审查超时/校验失败不改写为通过。审查只针对本次差异，提交前在冻结结果上执行零修改复审，最终回执由本地 gstack review-log 保存。

| 发现 | 修复与实际证明 |
| --- | --- |
| P2：每页重复全来源授权投影，同范围的 5000 条独立来源授权查询约 3.9 秒；150 页总耗时估算超过 300 秒事实窗口 | 追加 `0026_intake_discovery_index`，`source_id` 放在 `action` 前；保持正式 `authorization_deadline`、ACL 与 0001–0025 原字节。独立 SQL 实验从 3901/3859ms 降到 121/123ms；最终实际 Main 消费 150 页为 **25315ms**，完整 5000 项且仍在事实截止内。见[索引实验](index-experiment.json)。前者是局部查询实验，不是旧整链超时的实测。 |
| P2：同来源 5000 条有效重叠授权，即使有新索引仍触发 5s 超时 | 将业务谓词移到动作/种类聚合后，每组仅调用一次。独立同库对照为原查询 5010ms / SQLSTATE 57014、改法 12ms；实际 service 定向回归 28ms、完整矩阵复验 19ms，均完成两张菜单及 query/publish 边界核验。见[重叠授权实验](overlap-experiment.json)。 |
| P3：架构页仍称两条 HTTP 路由、Main 发现职责落在历史 D5 段落 | 改为四条路径，将发现职责归入模块表，明确来源发现不是跨 HTTP 原子快照。 |

未引入权限缓存或第二套授权算法。索引实验比较了两种列顺序：来源优先约 0.12 秒，动作优先约 1.4 秒；选择前者。后续聚合修复仅改发现 SQL，不改变上述索引或正式谓词。对象 manifest 增加一个索引及其五列；ACL、函数安全与触发器 manifest 完全不变，见[数据库核验结果](database-manifests.json)。

## Exploratory QA and Verification Results

环境为本机 macOS、Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18。QA 由主审核执行，五分钟 smoke 结束后只做必要修复复验，未重置计时。每个数据库测试拥有并清理自己的临时 cluster、对象目录、会话与子进程；不读用户 profile，也不操作现有业务库。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | 全通过；默认测试 **1815 passed、199 gated-skipped**，跳过项不计通过 |
| `CUSTOMER_AGENT_PG15_BIN=<PG15 bin> pnpm --filter @customer-agent/api test:intake:transactions` | **102/102**；94 个隔离 PG 用例 + 8 个材料用例，包括两个实际 HTTP/Main 消费场景 |
| `CUSTOMER_AGENT_PG15_BIN=<PG15 bin> pnpm test:db:integration` | **23/23**；空库、历史前缀、25→26 升级、删除索引后的拒绝，以及原 ACL/事务/漂移门禁 |
| Main 发现定向测试 | **12/12**；完整分页、空范围、分配/品牌隔离、错范围、重复/循环页、过期、取消、退出/重登、大小预算 |
| `pnpm check:architecture` / `pnpm workspace:check` / `pnpm docs:check` / `git diff --check` | 全通过；workspace 约 23.3 MiB / 32 MiB，190 个 Markdown 文件 |

上述套件是独立运行，不能把重复用例叠加成唯一覆盖数。前一轮功能证据与 checkpoint 保留为历史；最终 SQL 复验另见[功能复验证据](functional-recheck.json)。源码、冻结合同、锁文件和迁移 SHA、命令及日志摘要保存在[验证清单](verification.json)；原始命令输出与观察见[功能证据](functional-evidence.json)。新增迁移初次复验曾暴露两处旧总数断言；已按 catalogue 长度减已应用前缀修正，最终复验通过。未削弱原有业务断言。

- [checkpoint 002](exploration-002.json)：初始 Main 单测后验证真实 PG/HTTP；此阶段尚未增加索引，只作历史。
- [checkpoint 003](exploration-003.json)：索引修复后核对旧账本、ACL 和对象漂移。
- [checkpoint 004](exploration-004.json)：从数据库门禁推进到完整资料导入/审批/发布/使用矩阵。
- [checkpoint 005](exploration-005.json)：最终 Main 源码重新核对取消、会话和资源上限。

## 未验证范围与下一步

没有生产 factory/ACL/activation、真实飞书或客户数据，没有 IPC/renderer 和原生 Mac/Windows 窗口验收；本轮没有重跑杭州 WSL。发现列表是选择提示，复读只能检测可见权限变化，不能证明跨 HTTP 原子快照；来源独立变化及读完后的变化仍由真正使用资格重新核验。当前合同只提供店铺 ID，显示名须由后续登记合同提供。三方公开交付 EVD 和真实运行仍独立办理。

下一切片接合成 profile 的 Main factory、白名单 IPC 和 FAQ 界面，验收应覆盖当前店、零店空态、切店立即失去旧复制资格，以及 sender/main-frame 拒绝。完整管理闭环和原生 Mac/Windows 实机测试仍需分别完成。
