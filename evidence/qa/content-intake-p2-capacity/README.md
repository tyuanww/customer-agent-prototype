# 第二组：对象容量与并发合成验收

2026-10-08；基线 `1e5cca6`，分支 `codex/content-intake-capacity`。这份证据只覆盖本组的独立合成开发，不能签发真实数据、生产 ACL、历史清理或 P2 全阶段完成。被测输入指纹见 [inputs.json](inputs.json)，观测见 [observations.json](observations.json)。原 workspace 的用户修改保持原样；本轮获取远端 main 超时，未声称同步成功。

## 交付与边界

- `capacity.ts` 统一输入 XLSX、失败报告、普通/回滚审核包的 tenant 1 GiB 预留；对象存储生成 ID，预留提交后才写第一个字节。
- 业务对象登记与采用预留在同一内容事务中完成；来源、主体、用途、指纹和字节必须吻合，防止迟到采用或错误归属。
- 未采用对象仍按预留计费；明确失败或重放副本进入 releasing，磁盘删除及目录 fsync 成功后才释放。已登记引用、活跃写入及未知提交保持保护；磁盘/DB 错误不会伪装成释放成功。
- 失败报告额度不足时任务仍终结为 failed/cancelled，报告为空并反馈 QUOTA_EXCEEDED；已有候选不被改写。收尾支持单连接池。
- `content-retention --group intake-objects --dsn ...` 输出只读账本 JSON。无明确 DSN、与旧组混用或 --apply 均拒绝。它不扫描整个对象磁盘，不自动删除历史、未知对象或陈旧 reserved/persisted。
- 新增私有 0029 overlay；0001–0028 原 SQL/来源/hash 保持不变，应用 ACL、公开合同、桌面 UI/IPC 不变。

## 实际验证

| 验证 | 结果 | 原始证据 |
| --- | --- | --- |
| API 全部 intake PG15 集成 | 180/180；包含四条文件路径、审核重放/提交丢失、取消、回滚、权限和查询 | [api-postgres.log](api-postgres.log) |
| 补充引用保护与迟到采用竞态 | 1/1；adopted 不删除，releasing 拒绝采用，超限失败释放 | [adoption-race.log](adoption-race.log) |
| DB 空库、升级、重复迁移、并发、权限与精确后验 | 33/33，另补 28→29 前缀升级与 ACL 1/1 | [database-postgres.log](database-postgres.log)、[capacity-upgrade.log](capacity-upgrade.log) |
| lint / typecheck / build | PASS | [lint](lint.log)、[typecheck](typecheck.log)、[build](build.log) |
| 全量 workspace 测试链 | 修正新增迁移计数断言后完整 test:built PASS；环境条件跳过项按日志保留 | [workspace-tests.log](workspace-tests.log) |
| CLI 产物消费 | 实际子进程输出经 JSON.parse 与 DB 干跑结果比对；--apply 拒绝 | API PG capacity 用例 |
| 10→100 并发准入 | 最后一份额度下分别只有 1 个开始消费字节，无超售 | [observations.json](observations.json) |
| 10→100 发布历史 | 实际候选解析、来源确认、合成审批、质量、发布；10 次时 22 对象，100 次时 202 对象，全部审核引用存在 | [observations.json](observations.json) |
| 双来源 global CAS | 初始 2 次审批；后发布来源遇 BASE_CHANGED，重新走候选/来源/审批/质量，多 1 次审批；另一来源谱系逐字段保持 | [observations.json](observations.json) |
| EXPLAIN ANALYZE | tenant 容量统计使用 objects_capacity Index Only Scan，单次聚合 | [observations.json](observations.json) |

上述历史探针的基准是 10 次合成发布，十倍为 100 次；输入通过测试 helper 登记，容量上传边界由同一套独立 HTTP 用例验证。不能把这组数据解释为真实生产规模、全维度最大负载或人工审批耗时。已有最大目录性能证据继续单独保留。

## 审查与修复

使用 OCR delegate 进行确定性文件筛选/规则解析，由宿主逐项审查；同时执行 /review 的原生独立对抗复审。初轮发现并修复：满额导致任务无法结束（P1）、失败收尾嵌套借连接（P2）、释放前没有同步删除目录（P2）。另修复损坏本地回执时应整体阻止回收的保护缺口。最终原生复审无新增阻断项，详见 [review.json](review.json)。

外部 Claude Code adversarial 与 structured 各运行 180 秒后超时，均无可校验结果：[adversarial](outside-adversarial.json)、[structured](outside-structured.json)。不计为通过，也不替代原生审核；历史外部超时记录没有被改写。

## 剩余依赖

历史保留期尚未批准。当前已登记对象和未知状态全部保留；批准后才可实施历史资料的过期选择、磁盘对账与受控回收。真实组织事实、飞书审批 transport、最小运行权限、生产配置及旧目录认领仍属正式接入组；Windows 现场/普通账号验收按原安排保留。本轮没有 push、PR、部署或真实数据测试。
