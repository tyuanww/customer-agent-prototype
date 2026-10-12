# P2 候选质量投影验收

2026-10-06，`codex/content-intake-p2`，接续 `789ce58`。本轮实现已在独立合成执行器运行；未完成 P2 原子发布或完整 FAQ 产品闭环。范围及授权见[计划 §0.9](../../../docs/plans/2026-10-03-content-intake-requirements.md#09-候选质量投影与旧门消费验证2026-10-06)。

## 交付与边界

- [quality.ts](../../../apps/api/src/content-intake/quality.ts) 提供候选质量投影；[service.ts](../../../apps/api/src/content-intake/service.ts) 暴露内部 `qualityPreview(actor,key)`，每次重验 review 权限、完整材料键、来源、base 和候选状态。
- 复用既有抽样数量规则、数据库 population 摘要及排序。ID 按来源隔离；候选摘要绑定问法、词项、说明及显式停用；关键稿全部启用条目强制复核，缺行继续保留。
- 预览只读，不冻结质量计划、不写人工检查结果、owner 承接、票据或 release。测试中的旧批次/lease 是隔离消费者 fixture，不存在生产桥接器。应用 ACL、合同快照和旧 SQL 均不变。
- 旧 `g1a_offline_only` owner 记录不能由原生审批替代；抽样 hash 不能当 governance hash。字段映射与剩余条件见[合同差集](../../../docs/reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)。

## 实际验证

[检查记录](checks.json) 保存命令、日志哈希和结果，[输入指纹](inputs.json) 绑定实现、依赖、合同及说明。完整日志在本次工作树 ignored `.gstack/content-intake-p2-quality/`；可按[运行说明](../../../docs/how-to-develop-content-intake.md#p2-候选质量预览与-sql-消费探针) 重跑。

| 检查 | 实际结果 |
| --- | --- |
| 定向实库与材料测试 | 43/43：35 个真实 PostgreSQL 测试、8 个材料测试；本轮新增 7 项 |
| lint / typecheck / test / build | 四项均通过；默认 test 的条件跳过不算实库 PASS，实库由上行显式启用 |
| docs / workspace / diff | 文档链接、工作区预算和空白检查通过 |
| 实物消费 | 实际 XLSX → 持久候选 → 预览 → SQL 冻结计划，回读 population/selection 摘要与目标数匹配 |
| 关键失败 | 501 普通行得到 100 初样 / 151 扩样；缺扩样、伪造通过、关键稿漏审被拒绝；撤权、取消和错键拒绝预览 |
| 证据边界 | 原生审批和质量通过仍不能调用未登记 owner 承接；没有 release 或票据副作用 |

首轮开发检查有两处无效测试构造：非空附件说明违反 P2 合同，直接撤权未递增 grant 版本。已改成明确的附件拒绝断言及调用正式撤权方法，43 项完整回归通过；没有将测试修正写成产品缺陷修复。

## 审查

按用户点名的 OCR delegate 逐项核对规则、差异与新增文件；[覆盖清单](ocr-coverage.json) 记录全部路径，测试与 Markdown 排除项由宿主补查。宿主复核和原生对抗审查没有剩余确认缺陷。原生审查对 fixture 采用 summary-mode；宿主完整读取并执行测试。历史证据仅按不变输入复用。

[审查记录](review.json) 保留两项外部复核原始状态：对抗和结构化均在 540000ms 超时并结束，没有返回结论，属于缺失覆盖。不得表述为“全部外部审查通过”。远端 fetch 返回空响应；当前没有 PR，使用本地已知 `origin/main` / `8ab309f`，未确认最新远端变化。

## Exploratory QA and Verification Results

| 字段 | 值 |
| --- | --- |
| 日期 / 基线 | 2026-10-06 / HEAD `789ce58` + 本轮输入指纹 |
| 授权 / 范围 | /review 功能烟测；自有临时 PG、合成 XLSX，不访问真实数据 |
| 工具 | Node 24.19.0 / pnpm 11.19.0 / PostgreSQL 15.18；Q 记录器 Bun 1.4.2 |
| 退出条件 | 300s/12 探针上限内完成 2 项，共 3972ms；成功和最高风险拒绝均得到验证 |

| 合同 | 观测 | 结果 |
| --- | --- | --- |
| 候选投影可被既有 freezer 实际消费 | 预览稳定且无写入；SQL 冻结后的目标与摘要一致 | PASS |
| 质量拒绝不会制造通过结论 | 缺扩样与虚假通过均拒绝，随后合法 blocked 结论落盘，release 仍为零 | PASS |

探针实际输出由 [Q evidence](evidence.json) 保存。因果记录：[checkpoint 002](exploration-002.json)。完整 43 项回归与四项仓库检查独立执行，输入复核无漂移，未为复审重复跑已通过的完整检查。临时 PG 与对象目录由 harness 清理，报告日志保留；报告生成首次因相对路径用法失败，修正调用后 materialize PASS，未覆盖已有报告。

无浏览器、真实 Feishu、最大负载、OS/打包或上线验证；这些不属于本轮改动的验收。本轮没有新增生产入口。

## 下一阶段验收入口

1. 候选键绑定的不可变质量计划和逐条检查持久化：先冻结后检查、精确样本覆盖、扩样、任一阻断错误整批修订；旧材料证据不得用于新版本。
2. 明确新材料到发布成员及旧 owner 继承的字段/证据映射；需要改变正式合同含义时先治理仓版本化、再 intake。
3. 票据与原子提交：质量拒绝零副作用，取消/撤权先赢不发布，未知响应原操作恢复，永久候选→release 不重复，catalog/谱系/公告共事务。
4. 使用资格与另一坐席按店查询接线；生产 ACL、真实审批和真实启用继续按各自批准。
