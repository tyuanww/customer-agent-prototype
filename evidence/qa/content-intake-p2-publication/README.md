# P2 原生候选发布验收

2026-10-06；分支 `codex/content-intake-p2`；本轮增量基线 `98b888b`。仅隔离 PostgreSQL 15 与合成 XLSX/审批附件，生产应用 ACL、HTTP/Main/renderer、真实数据和 v2-active 均未开放。

## 交付与合同边界

API 新增 `publish` / `publicationReceipt`，复用现有事务、正式 validator、审批观察及永久回执。产品 overlay `0024_intake_publication` 只追加一个私有 security-invoker 函数；前 23 段 migration 字节不变，应用角色无新 EXECUTE。新材料与审核由原生候选/谱系证明；旧成员原样复制，旧四域来源和 owner 门继续独立核验。[字段/证据映射](../../../docs/reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)与[运行配方](../../../docs/how-to-develop-content-intake.md#p2-原生候选原子发布)说明接口和限制。

即时审批观察在锁外；最终事务重验当前资格、base、来源/审批版本、质量和继承证据，签发并消费观察开始后至多 60 秒的票据。目录、谱系、单 current、公告、永久发布身份及回执同时提交。票据拒绝复用；原操作丢响应可以恢复，不能换键重复发布。

## 实际验证

- 资料导入与材料定向检查：72 项（64 PG + 8 material），本轮新增 19 个 PG 场景。
- 数据库生成、升级规划和实库：36 项；前 23 段账本保持一致，全部六种应用角色拒绝调用；函数安全属性与 ACL 漂移会被后验拒绝。
- 既有发布/回退实库回归：13 项。
- 仓库 lint、typecheck、test、build 通过；文档、目录和 diff 检查由 [checks.json](checks.json)记录。
- 新验收覆盖：独立发布授权、长多行正文及管理说明保真、缺行保留/显式停用、不同来源继承及审批撤销传播、旧不同域成员全部字段保真、七类门拒绝无发布副作用、公告尾部失败回滚、COMMIT 丢响应恢复、取消/撤权两种顺序、同 base 竞争和过期观察。

测试开发时发现非空附件说明被既有媒体规则拒绝，已把成功样例改成无附件；没有放松解析规则。另修正漏更新的 migrationCount 断言和测试适配器漏传取消信号；这不是产品漏洞修复声明。命令、退出码、日志哈希在 [checks.json](checks.json)，当前输入在 [inputs.json](inputs.json)。

## 审查

OCR delegate 负责文件清单与规则，宿主逐项审读，含默认排除的测试、生成物和文档；清单见 [ocr-coverage.json](ocr-coverage.json)。本机独立对抗审查未发现确认缺陷，fixture 为 summary-only，未独立执行测试；宿主负责实际运行与完整测试源码审查。结果见 [review.json](review.json)。

历史外部对抗/结构化两次 540000ms 超时仍为缺失覆盖；本轮没有重试或换模型。更新 origin/main 的 fetch 网络超时，审查采用已知 `8ab309f` 基线和精确 `98b888b` 增量，不声称已验证最新远程头。

## Exploratory QA and Verification Results

| 元数据 | 值 |
| --- | --- |
| 调用与范围 | /review；纯功能面；5 分钟 / 最多 12 探针 |
| 环境 | macOS；Node 24.19.0 / pnpm 11.19.0 / PostgreSQL 15.18 |
| 隔离与清理 | Pg15Harness 新建 Unix socket 集群及对象目录，逐测试关闭并删除；无真实网络目标 |
| 结果 | 2 次 capture，6 个选定测试通过；因必需冒烟完成停止 |

| 合同 | 观察结果 | 结论 |
| --- | --- | --- |
| 原生发布与原回执恢复 | release/lineage/current/公告与一次票据真实回读；重放无二次发布 | PASS，capture 001 |
| 原子失败、未知回执、取消/撤权竞争 | 晚失败全部回滚；丢响应恢复同一发布；先取消/撤权拒绝，先提交后取消拒绝 | PASS，capture 002 |

[checkpoint 002](exploration-002.json) 保存成功观察如何决定后续故障探针；完整安全输出由工具写入 [evidence.json](evidence.json)。[charter](charter.md) 记录权限、入口、隔离和退出条件。无视觉分数，未用浏览器冒充服务验证。

## 剩余条件

本轮只从已登记原生 catalog 接续；bootstrap、旧同域内容认领/迁移及显式同题覆盖冲突证明尚未实现，会明确拒绝。完整 owner 承接正向包在本入口的实库消费、真实 Feishu 身份/附件、生产角色权限、HTTP/Main/renderer、原生使用资格及第二坐席查询仍未验收；没有正式上线或完整 FAQ 闭环结论。

下一切片：在同一 sealed 合成执行器实现使用资格与按店原生快照，验证跨店不可读、内部说明不下发、撤权/过期/审批撤销停止使用、同店更新与权限失效区分、空 SOP/media 真实为空。
