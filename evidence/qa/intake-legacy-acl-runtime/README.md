# 旧目录校验权限：正式合同接收与合成回归

2026-10-09。产品基线 `f6f8cf35ef9a9007cddade8a0c7fa4b648bef9a1`，版本保持 **0.3.26**。本轮关闭 [上一轮 CSV 证据](../intake-csv-runtime/README.md) 中“旧目录非空时缺少八个 CHECK helper EXECUTE”的缺口。已有历史报告按当时输入保留，不改写为通过。

## 批准对象与实际接收

用户批准治理 `231cba56` 的三个精确对象后，治理仓以 `db6ba13d4780a3abb1558e8673e016f7bfb5604e` 冻结并实际导出 v4 完整包，`0125a97c284a78262a52a67b3d9834107a0f59bc` 只补充导出回执。产品实际接收 [完整快照](../../../contracts/upstream/customer-agent/cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780/contract-set.json)，锁指向 OpenAPI 1.22.0 / schema1.25；16 个成员含 13 个运行依赖。批准的原始字节没有改变：

| 对象 | SHA-256 |
| --- | --- |
| 八项 ACL 增量 | `6e286747d15b8af6a11a03d9b00c33d36ac62c36f25efa653285c1cbc6984584` |
| schema1.25 | `0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998` |
| 新安装清单 | `fbc601f305013b54e5273e3c4b97faf009f348c3db6a6b4c9f397cfd87707418` |

`intake.log` 为真实 `CREATED`，`verify.log` 为真实 `VERIFIED`。`intake-v4-roundtrip.log` 另外证明导出物能被隔离接收 CLI、核验 CLI、真实 migration generator 连续消费，并保持旧 34 段 SQL 及元数据一致。这个临时探针没有改产品锁；本轮随后执行的正式 intake 更新了产品锁，两者不混记。

正式状态仍为 `VERIFIED_NOT_ACTIVATED`、`ddev_authorized=false`、`runtime_activated=false`。冻结/接收不代表启用真实数据、正式账号或生产权限。

## 实现与失败路径

- 根 intake 复用原 CSV 安装依赖校验，只追加 v4 外层闭包；完整成员、同源批准、哈希、浅历史和降级检查仍失败关闭。不是散 SQL 导入，也不重放完整 DDL。
- database 追加 `0035_intake_legacy_check_acl_v1_25`，前 34 段 SQL 与账本元数据不变。唯一数据库权限差异是给既有 **NOLOGIN** 函数属主增加八个纯校验 helper 的 EXECUTE；登录角色、角色上限、表/列权限和审批材料规则均不变。[物理差异清单](db-manifest-delta.json) 记录 ACL 从 542 到 550 项，无删除；对象 3090、函数安全属性 255、触发器 109 项及其摘要全部相同。
- 发现并修复安装前置核验缺口：原 runner 只验账本，属主被改成 LOGIN 时可能先提交增权，再在事务外核验失败。保留 `preflight-red.log` 作为修复前实证。现在 0035 在**同一事务**先验完整 34 段物理状态，再执行获批 SQL、记账并验完整 35 段状态；任一失败回滚权限和账本。COMMIT 回执未知仍单独报告，不虚假回滚。
- 初次修复的 `preflight-green.log` 暴露 `SET LOCAL search_path` 对 `pg_get_*` 名称限定的影响；恢复此前核验上下文后，`preflight-green-final.log` 三项通过，没有放宽摘要。七类旧安装漂移和事务内后验失败均有实际 PG15 拒绝及回滚检查。
- API 使用非超级用户业务用途账号完成旧八行保留、连续两次发布、纠正回退和同操作重放，旧资料每个字段与发布前基线一致。来源停用、映射变化、权限变化，以及旧 approval-v1 撤销/到期仍拒绝发布或回退；不伪造审批通过或 owner 材料。

## 实际验证

环境：当前 Mac arm64、Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18。全部使用合成 fixture 和一次性本机 PG15。没有安装依赖。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| v4 intake 单测 | 87/87 PASS | `intake-v4-unit.log` |
| 导出物 → 接收/核验 CLI → generator | PASS；16 件、13 依赖、35 段，旧 34 段完全相同 | `intake-v4-roundtrip.log` |
| database generator / planner / runner | 40/40 PASS | `database-unit.log` |
| PG15 全数据库门禁 | 首轮 74 PASS / 1 FAIL；仅旧迁移后缀数量断言需从 25 改为 26，定向复测该项 PASS。合计 75 项覆盖，不宣称一次完整 75 项绿跑 | `database-pg15.log`、`database-pg15-recheck.log` |
| 受限 API 旧目录及失效回归 | 31 PASS / 137 未选中；当前 0035 输入不变 | `api-pg15.log`、`api-result.json` |
| 根 lint / typecheck / test / build | PASS | 对应原始日志 |
| 文档、差异、旧 migration 与批准摘要 | 见 `checks.json` 的最终核验记录 | `checks.json` |
| workspace 源码体积预算 | 40.3 MiB / 32 MiB，超 8.30 MiB；根目录规则 PASS（前一轮已为 38.8 MiB） | `workspace.log` |

根 `pnpm test` 实际通过：contracts 24、retrieval-core 9、content-intake 97、database 42、API 567、desktop 1426；另有 Node smoke/脚本测试。默认跳过 database 26、API 332、desktop 7，不把这些记为本次完整 PG/E2E 通过。上表单列了实际启用 PG15 的专项覆盖。

治理 `test:release` 46/46 步（通用测试 299/299）通过；治理原 17 项 PG15 根据 18 项输入哈希不变复用，没有重跑。精确导出/验收回执位于治理仓 `business-docs/01-客服Agent项目/30-开发-进行中/content-intake-runtime-candidate/legacy-check-export-receipt.json`，只据此声称它实际覆盖的范围。

## 审查、复用及未验证范围

本机核心和独立差异审查已完成；发现的安装原子性与测试断言问题已修复并验证，没有待处理代码发现。完整外部 `/review` 仍为 **INCOMPLETE**，详见 [review.json](review.json)。不重复历史角色 15/15 审核，也不重复超时外审。

之前 Mac CSV/XLSX、Electron 与未签名安装副本报告保留其原输入范围；本轮没有修改桌面运行代码，但数据库和正式快照变化，因此不把旧报告说成本轮新包验收。本轮没有重新打包、人工操作原生窗口或进行 Windows 实机验收。

正式飞书组织装配、真实 Menokin 来源及范围/人员认领、保留期和生产配置仍按计划 §0.53 的现有事项推进。本轮不读取真实资料或凭据，不开生产 HTTP/ACL，不 push、PR、合并或部署。

可复核命令、输入和原始日志 SHA-256 统一记录在 [checks.json](checks.json)；失败日志按原始字节保留。
