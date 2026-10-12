# P2 管理端：来源、审批与发布 HTTP 验收

日期：2026-10-07（Asia/Shanghai）。分支 `codex/content-intake-p2`，基线 `750d992`；精确源码/测试字节和实测结果见 [verification.json](verification.json)。范围由[计划 §0.20](../../../docs/plans/2026-10-03-content-intake-requirements.md#020-来源审批与发布管理-http-闭环2026-10-07)拥有。全部数据、产品登录和审批 transport 为合成 fixture，API 使用本机临时 loopback 端口，PG15 只监听自有临时 Unix socket。

本段接通冻结合同的七条管理路径：来源确认、审批发起/读取/刷新、发布、取消、按 action 查询操作回执。复用前段文件上传/解析/材料读取及现有质量、发布和坐席资格服务，实测第二坐席通过 HTTP 读到了此次发布的三条 FAQ 和完整多行原文，内部说明未下发。质量检查在这条测试中仍是显式的带真实会话内部服务调用；未宣称质量 HTTP 或完整管理界面已经交付。

## 所有者与接口

- `management-http.ts` 仅在隔离宿主显式注册；写请求的地址候选/版本必须与正文一致，完整正文交由冻结 validator 校验。审批适配器只来自服务端配置，不接受客户端审批结论、身份或凭据。每阶段事务仍锁定真实产品会话并重验权限。
- `evidence.ts` 拥有来源确认、不可变审核包、创建 UUID、人工事实版本及观察截止。GET 审批只读、不续期；发布继续即时核验适配器返回的任务、时间线与附件。常规可自审，关键变更必须合格非贡献人复核。
- `candidate.ts` 将已持久化的取消候选结果投影成冻结 `IntakeReceipt`，旧回执字节不迁移。`publication.ts.operationReceipt` 按当前主体+action+operationId 查永久结果；历史结果不续签内容使用权。不存在或无权的操作同样返回 NOT_FOUND。回退执行器仍未实现，回执的 rollback 枚举不代表新增回退能力。
- DB、既有单 current、一次票据、质量和目录谱系仍由原模块拥有，没有新增表、迁移、正式合同或运行 ACL。

## 审核与修复

沿用用户要求的 OCR delegate → 修复 → 验证 → 本地提交。父宿主按 OCR 规则阅读完整源码、测试与文档；[覆盖清单](review-coverage.json)逐项记录。`/review` 原生对抗审查与父审分别确认了一项 P2 资源问题：审批包在确定回滚、验证失败或并发相同操作被永久回执合并时，未采用的文件没有回收，且未被 DB 对象容量统计。

真实 HTTP/PG 回归连续两次复现三个失败场景：并发时磁盘 3 个文件、DB 仅引用 2 个；验证失败或注销前回滚时磁盘 2 个、DB 仅引用 1 个。修复把包归属留在审批证据模块：只有确定未采用才回收，未知 COMMIT/ROLLBACK 保留；包注册成功后不因后续注销或 provider 失败删除。原三个回归已通过，另有未知提交、注册后注销及原操作恢复两项保护检查通过。

原生对抗审查对测试/fixture 仅看统计摘要；测试 payload 和断言由父宿主完整阅读并实际运行。外部模型按既有偏好未调用，历史外部超时/输出校验失败不改写为通过。提交前最终零修改审查与内容绑定由 gstack review logger 保存，不能由本报告替代。

## Exploratory QA and Verification Results

| 合同 / 检查 | 实际结果 | 判定 |
| --- | --- | --- |
| 上传至第二坐席消费 | 实际 HTTP 发布 `rel_2`，第二坐席资格与快照绑定同一 release；三条 FAQ、多行正文完整、内部说明不下发 | PASS |
| 输入与权限 | 地址/正文不一致、未知字段、查询污染、坐席写入、缺失适配器、关键稿自审均拒绝；不产生越权发布 | PASS |
| 审批 I/O 竞争 | 注销、撤发布权、取消、更新来源确认分别先赢，发布失败且 current 保持原基线 | PASS |
| 审批及提交丢响应 | 原创建 UUID 恢复一个实例；发布 COMMIT 丢响应后按主体/action/原键恢复一个 release | PASS |
| 审核包归属 | 并发败方/确定失败回收；可能提交或已引用的包保留并可恢复 | PASS |
| 新 HTTP 场景 | 15 项通过，实际网络请求、PG 持久结果、磁盘对象计数均有断言 | PASS |
| 完整资料事务与材料 | 119 项事务 + 8 项材料 = 127 项通过 | PASS |
| 根级检查 | lint / typecheck / test / build 全通过；默认 test 1,837 项通过，224 项专项默认跳过且单列 | PASS |
| 架构与文档 | 339 个源文件、0 越界；workspace/docs/diff 检查通过 | PASS |

[功能证据](functional-evidence.json)为 producer 实际汇总，判定 PASS、open 为空。Capture 006 被同一个 300 秒探索计时器截断，保留 incomplete/124，未算通过；之后仅继续有限时必验回归，007 用相同命令完成。003/004 保留修前失败，009/010 在最终字节上重放原命令。初始开发阶段有测试夹具字段与类型错误，修正的是夹具，不计作产品缺陷。

- [checkpoint 002](exploration-002.json)：从成功消费转向权限和未知结果恢复。
- [checkpoint 003](exploration-003.json)：验证审查发现的审核包泄漏。
- [checkpoint 004](exploration-004.json)：同命令、同初始夹具再次复现。
- [checkpoint 005](exploration-005.json)：原失败命令在修后通过。
- [checkpoint 006](exploration-006.json)：准备完整修后检查，随后被探索计时器截断。
- [checkpoint 007](exploration-007.json)：带有限超时的必验重跑，15 项通过。
- [checkpoint 008](exploration-008.json)：完整 PG/材料回归 127 项通过。
- [checkpoint 009](exploration-009.json)：最终原成功消费命令复验。
- [checkpoint 010](exploration-010.json)：最终原泄漏命令复验。

## 剩余依赖与下一步验收

[质量合同交接](../../../docs/reference-content-intake-p2-contract-handoff.md)已列出质量状态/计划、冻结、逐条提交、未知结果恢复、最大请求与分页的具体缺口。下一步按治理仓形成版本化质量合同候选，批准/冻结/export 后在本仓 intake，再由 Main 窄 adapter 接管理界面。不能直接把内部 5,000 条完整质量投影塞入当前 64 KiB HTTP 写口，也不能让客户端传入通过结论。

后续验收须覆盖逐条集合/hash/阶段一致、关键稿贡献人回避、最大输入与分页消费、换版/撤权/注销、丢响应恢复及 UI → 质量 HTTP → 发布 → 现有 Query 原文查询/复制。质量 passed 仍不替代组织审批或发布资格。

本段未验证真实飞书/客户/员工数据、生产注册/ACL/active、完整管理 UI、正式初始化目录或 Mac/Windows 实机交互；没有修改桌面/窗口代码，因此未重复 Electron 或安装包测试。没有 push、PR、merge、deploy。成功测试夹具关闭了自有应用与 PG；006 截断留下的唯一临时 PG 已核对 PID/目录后停止并删除，记录在 verification。详细原始日志、收据和 OCR 输入保存在 ignored `.gstack/content-intake-workflow/`。
