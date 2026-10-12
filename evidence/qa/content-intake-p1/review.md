# P1 /review 历史审查记录

> 后续用户指定的 OCR 复审已完成，当前提交前结论见 [OCR 记录](ocr-review.md)。以下保留本次 `/review` 当时结果，不回写为外部审查全部通过。

**Pre-Landing Review: 0 已确认未修复问题（0 critical / 0 informational）；INCOMPLETE，converged=false。**

完成三次读者收集及三次修正。最后修正的 72 项定向回归和仓库级检查通过，但没有修后第四次完整审查，不能把“已修复已知问题”写成“最终差异已完整复审通过”。这是本次 `/review` 结果，不是发布批准。

## 范围与方法

- 基线 `origin/main@8ab309f`；`codex/content-intake-p1` 的未提交差异，包括未跟踪的新源码与选择带入的计划。
- 父审执行 critical / informational 清单、设计边界复核和实际复现；三轮 Codex in-host 对抗审查只读完整非测试源码，测试/fixture 按 skill 仅看摘要。没有 Review Army 专家覆盖。
- 复用已有 autoplan 的 P1 业务决定；不补造 CEO 超时/Eng 结果校验失败的通过记录。
- 非目标：生产 HTTP/IPC/DB 接线、真实租户、客户工作簿、PG 原子提交或 OS/打包证明；这些保留在 P2/P4 条件中。
- `gstack-review/SKILL.md` Step 5.8 明文：**“Allow at most 3 fix cycles”**。达到第三次修正后停止本次审查调用，记录未收敛，不启动第四轮规避上限。

## 已修复（当前无待实施的已确认发现）

| 发现族 | 修正与实际证据 |
| --- | --- |
| 范围和资格 | Grant 改为单 action/scope，批量是多记录；撤 A 店不会改变 B 店或其他动作；保留签发者、版本递增、重复撤销无副作用；授权起止都被分配资格包含 |
| 人工审批 | 审核人历史/当前资格、当前版本/撤权代际；证据截止取组织、review grant、附件事实最早值；原生表单和任务类型严格要求字符串，不将数组强转成合法值 |
| 候选与签票 | 模块从旧/新完整快照自行计算差异和最高风险；来源确认单独绑定候选/来源及代际；提交点重查两个人的资格、来源确认与票据 60s 最大窗口 |
| 风险误判 | 前后版本与标题/正文分别匹配关键词；只统计已有启用条目转停用；新建停用不当作减少已发布内容 |
| Excel 资源 | 分配前列定义预算、整格/共享字符串累计富文本及 CDATA；中央/局部部件名一致、ASCII 规范路径；拒绝点路径/重复坐标/外链变体 |
| 媒体完整性 | 所选页背景图/绘图引用/图片均阻断；排除页图片仍计数；不被 ExcelJS 忽略后误报成功 |
| 文本与结果 | 真实日历日期、稳定问法编号、非示例 ID；stdout 深形状与整批语义检查、严格状态枚举；选中页重复共享字符串按每次引用计入 300 万 UTF-16 单元预算，序列化前阻断放大 |
| 进程与实物 | 取消/超时等待退出再释放槽位，后续任务可用；有效/无效 XLSX 与报告磁盘重开、错误坐标与正文换行验证 |

修复在用户已授权 P1 范围内完成，均未改变正式运行链、upstream lock 或 owner-only 规则。具体测试源位于 [解析回归](../../../packages/content-intake/tests/workbook.test.ts) 和 [权限审批回归](../../../apps/api/tests/content-intake-p1.test.ts)。最后一轮还包括原生字符串形状、票据窗口、风险字段/停用计数、规范文本总额的修正；这些只有当前自动化回归，没有完整修后人工式审查。

## 外部审查的真实状态

完整返回与 modelUsage 见 [review-attempts.json](review-attempts.json)，未覆盖项没有由原生审查冒充补齐。

| 轮次 | 对抗审查 | 结构化审查 |
| --- | --- | --- |
| 1 | Claude Code 返回并通过完成校验；发现由父审复现/处理 | 540s 超时，无完成结果 |
| 2 | 540s 超时，无完成结果 | 540s 超时，无完成结果 |
| 3 | CLI 返回文本，但缺少完成校验要求的 recommendation 标记，`outside_status=unavailable`；内容仅作独立排查线索 | 返回且完成校验通过；原始 gate=FAIL，所报 P1 经复现为误报；票据期限建议采纳 |

第三轮已证伪的线索：

- `xml?.write(...).close()` 是连续可选链，xml 为 undefined 时整个后续链短路。实际 Node 重放不抛异常，排除页二进制图片解析成功并计为 1；并非所报“所有图片都损坏”。
- 重复 FAQ 表名的合成包实际返回 `INVALID_XLSX`，未发生报告所述静默漏导。
- JSZip 3.10.1 的 `readLocalPart` 直接跳过 local extra；此处不存在“按 local Unicode extra 换名”的消费路径。已核对依赖源码及现有中央/局部文件名门禁。
- 具体输出见 [独立复核](review-evidence/structured-r3-triage.txt)。没有为了满足外部评分而修改已正确的可选链，也没有把其原始失败 gate 改写成通过。

## Exploratory QA and Verification Results

这是功能 QA，无视觉分数。初始探索窗口 300s 未重置；后续是审查发现的定向复现与修正回归，使用独立有界命令。所有输入均为合成，未访问真实工作簿、员工、飞书凭据或租户。

| 证据 | 实际结果与有效范围 |
| --- | --- |
| [首两轮捕获及重放](review-evidence/cycles-1-2.json) | 生成器记录 pass；保存原始红结果和同命令修后重放。后续修改影响的部分由最终回归替代 |
| [最终定向回归](review-evidence/final-regressions.json) | 41 解析/进程 + 31 权限/审批 PASS；这是第三次修正后的自动验证，不是第四次完整审查 |
| [仓库级验证](verification.json) | lint/typecheck/test/build 全部退出 0；每条命令/日志 SHA 和 19 项代码/配置/测试输入 SHA 绑定 |
| [实物与性能](probe.json) | 三个 XLSX 文件重开及 SHA 读回核对；500/5000 行各 10 次、取消/恢复、Node 调用方事件循环和资源观测 |

发现过程保留，不将旧红结果伪装成最终失败或最终通过：

- [checkpoint 002](review-evidence/exploration-002.json) — 从基础解析转向日期/编号/重复坐标边界。
- [checkpoint 003](review-evidence/exploration-003.json) — 更正复现的父条目 ID，隔离问法编号问题。
- [checkpoint 004](review-evidence/exploration-004.json) — 第一轮修正及邻接路径。
- [checkpoint 005](review-evidence/exploration-005.json) — 两个 ZIP 消费者的部件身份。
- [checkpoint 006](review-evidence/exploration-006.json) — 第二轮富文本/期限/类型原始复现。
- [checkpoint 007](review-evidence/exploration-007.json) — 第二轮修正及精确预算边界。
- [checkpoint 008](review-evidence/exploration-008.json) — 原始独立解析入口重新执行。
- [checkpoint 009](review-evidence/exploration-009.json) — 第一轮原输入准确重放。
- [checkpoint 010](review-evidence/exploration-010.json) — 第二轮原输入准确重放。

限制：G01–G31 的整组新端到端验收未完成；PG 条件测试和一项桌面条件测试 SKIP 不算 PASS。真实飞书附件/人工节点、身份事实与传播、Main/utilityProcess、OS 出站/RSS 上限、平台安装包仍未验证。n=10 尾值不是 SLA。最后修正需后续完整复审；commit/push/PR/merge/deploy 均未授权执行。
