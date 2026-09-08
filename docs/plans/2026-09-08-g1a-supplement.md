# P1–P4：G1a 补证与签收实施

> APPROVED · DEVELOPMENT / SYNTHETIC TEST。用户明确要求按gstack执行P1–P4；真实运行逐次展示dry-run后授权，人工观察与T6不得由工具代签。历史工程基线main c8ed3b7；当前产品已合并21c6fc5，009双路比较已完成，原报告不改写。

## 当前状态（2026-09-08）

- P1：关键词基线及人工观察证据类型已由用户确认采用，治理 [PR #70](https://github.com/weiweity/tianyuan-ai-brief/pull/70) 合并为 `04ba9eee9025e60fb9524077f7aade0f2fe2b60f`，合并后 CI `34196256720` 通过。采用口径不代表观察已完成。
- P2：产品 [PR #47](https://github.com/weiweity/customer-agent-prototype/pull/47) 合并为 `21c6fc5bae332c67c95f9e686c06fec424835c48`，合并后 CI `34196217594` 五项全部通过。仓外 v6 操作器 23 项合成检查、独立工程审查及宿主实际命令中断/清理/重入预演通过。
- P3：用户批准具体 dry-run 后，`owner-t5-009` 单次真实比较完成。基线正例19/20、稳健性4/18、安全12/12；候选20/20、18/18、12/12。共15项改善、0项回退、35项不变。两路p95分别19.318ms、71.079ms；来源分别19/19、34/34，禁止候选、后端错误、事件写入与进程守卫尝试均0。未超时，清理PASS。机器核验逐题、汇总、输入和同事务一致；候选逐题正确性与008一致，不是新的未见题集。009授权已使用，不得重跑。
- P3剩余：16项实际人工观察（6澄清、10升级）仍待完成，交接表与业务/QA待审表已绑定009结果摘要并保存在仓外受控目录。
- P4：等待实际业务/QA意见与明确T6决定。状态仍为 `EVALUATED_NOT_SIGNED / REVIEW_REQUIRED`，机器下游 `NOT_EVALUATED`。不以50/50或工程审查代签。

下文工程过程及当时下一步为历史记录；当前动作以本节及末尾任务清单为准。

## 范围与现有能力

复用tests/support/g1a-e0的输入边界、loader、PG15与网络守卫、evaluate和safe-delivery合同。正式SearchBackend继续原实现，旧单路命令向后兼容。当前report-contract只允许NOT_EVALUATED；补证必须是独立证据，不升级原报告状态。

## P1：口径与所有者

关键词基线优先采用已合并DEV-M1 #18的原算法（362e53c，候选db46f9c），保留bigram primary、无primary才phrase fallback、exact/phrase/ts_rank排序与稳定ID tie。从Git冻结SQL及归一化语义，不读取真实结果调参，不引入新的排名启发式。真实采用该基线须将定义写入治理决定。

下游采用人工流程观察作为待审证据类型：16项（6 clarify/10 escalate），记录实际观察、受控引用、人员与时间；none的34项不混入动作分母。人工记录不代表软件执行。原用户反馈有记录，但不补造逐题审阅或独立性声明。

## P2：架构与实施

方案A：复制整个runner并各跑一次。优点隔离简单；缺点重复清理规则、两个时点、性能比较不可控。拒绝。
方案B：既有runner内部共享装载和只读事务，新增显式双路比较入口；依次评测冻结关键词与当前候选，分别测时和核对零事件，统一cleanup后才返回。选择B，现有单路入口行为不变。

测试专用关键词模块拥有冻结算法与来源pin；runner拥有PG/身份/时间/清理；evaluate拥有判题；新comparison-contract只拥有两份合法报告的同输入/同题/同来源/版本连接与差异统计。不会新建通用插件框架。

输入 -> 既有校验 -> 单次装载/只读事务
                    +-> 冻结关键词 -> 既有evaluate -> 基线报告
                    +-> 当前候选   -> 既有evaluate -> 候选报告
                    -> 零事件/清理 -> 比较合同 -> CLI -> 实际落盘回读

## 验证与失败路径

- 单元：历史算法parity、稳定tie、无primary的fallback；空/非法查询不放大返回。
- 合同：输入hash不一致、重复/缺题、分层或来源不一致、算法pin缺失、报告分数伪造、未清理、非零事件必须拒绝。
- 集成：真实PG合成50题双路 -> 序列化 -> CLI消费 -> 回读；相同transaction timestamp，分别p95，来源撤销与时间边界，错误/超时cleanup。
- 原单路008对应合同及命令回归保持，不把no-hit当澄清升级；验证产物不含正文或内部定位符。
- lint/typecheck/test/build、PG/E0专项、workspace/正式产物隔离检查；按review -> ship -> PR CI，获批后merge核验。

覆盖图（验证范围；工程结果见下文，人工观察仍待真实证据）：
输入边界[复用] -> 双路装载/时间[新增集成] -> 排名[新增parity]
              -> 报告对齐[新增单元] -> CLI实际消费[新增E2E]
              -> 异常及清理[复用并补双路] -> 人工观察[仅真实证据可完成]

性能：串行两路避免并发争用；50题有界，分别统计耗时，不将总耗时冒充搜索p95。保留现有300ms合同，不修改阈值。

## 当前工程进度

2026-09-08：已冻结#18算法三份源码与provenance，基线单测3/3。runner已增加同装载/同事务的双路入口，旧单路保持；真实PG合成集成1/1，包括两路各50题、零事件、清理、报告序列化、CLI实际消费及错误manifest/版本/事务时间拒绝。合计4/4通过，API typecheck通过。

后续进展：CLI实际落盘回读已通过；新增错SHA独立锚点、错时间、重复题、来源变化、缺清理、事件写入、伪计数、额外字段拒绝检查。新增受控命令test:g1a:comparison:package（未运行真实数据），运行前后要求clean HEAD及baseline pin。E0串行集成共88项通过，避免既有全局PG残留断言与新增测试并行干扰。独立检查发现的浅克隆缺历史对象已在CI配置改为完整历史；消费者现在独立接受expected candidate SHA，合法但错误SHA回归通过。

该阶段待补的算法差异/来源撤销、合法失败产物消费、受控入口预演和最终复核，已由下述最终工程验证补齐；PR/CI、合并及具体P3准备仍须后续完成。

最终工程验证对应已推送代码 `1c81e314a9a98172701827b1fe390def43aae7d4`：全仓 lint/typecheck/test/build 通过，API 272 通过、59 跳过，Desktop 511 通过；E0 `:ci` 92 项全部执行通过，含新增双路真实 PG 合成集成 5/5。覆盖算法差异、未命中/安全失败报告实际 CLI 消费、来源暂停及 owner 撤销两路同拒绝。workspace、diff 检查及独立代码审查通过，未发现未解决问题。

clean 候选的受控入口已用纯合成输入完成“实际命令 → CLI → 50题输出”预演：improved 1、regressed 0、unchanged 49，`real_input=false`、`t6_signed=false`。`artifact:m0:build` 和 `artifact:m0:verify` 通过，77 文件候选及78文本扫描证明比较工具未进入正式 runtime 候选；产物仍为不可部署且 `runtime_activated=false`。这些均不构成真实比较、人工观察或T6证据。下一步为 PR 及确切头提交的 CI，合并另行授权。

## 运行入口与最终检查

- `pnpm test:g1a:e0:ci`：92项合成测试实际执行通过，单进程文件串行；CI同时要求原11项集成与新5项比较集成存在且全通过。
- `pnpm test:g1a:comparison:package`：显式受控入口。必须配置现有输入/manifest/owner锚点及 `CUSTOMER_AGENT_G1A_CANDIDATE_SHA`，运行前后检查clean HEAD与基线pin。测试源码不属于正式运行包。
- 输出一行 `G1A_COMPARISON_DELIVERY` 加封装JSON；消费者 `node scripts/read-g1a-comparison.mjs <manifest-sha256> <expected-candidate-sha>` 从stdin接收该行前缀之后的JSON，输出比较报告。它拒绝额外字段、错误独立候选SHA、不同输入/来源/时点/题目或非零事件。
- 退出0表示报告结构可消费，不表示算法通过或T6签发；保留两路runner_result、failure_codes和逐题事实。

## P3：真实补证

完成工程交付及宿主合成预演后，绑定新的合并SHA、run_id和有效输入。008不得重跑，包不得自动续期。新双路命令的运行上限、版本pin及失败停止条件在具体dry-run展示。真实结果消费与50题一致性检查后，交既定复核人补16项实际观察。

## P4：签收

汇总真实比较、人工观察、硬门、清理、用户实际意见与未覆盖范围。只有真实复核结论和明确签发决定齐备才记录T6；缺证据保留待签。不执行P5正式身份、桌面接入或部署。

## NOT in scope

正式API、OAuth、桌面、自动动作、消息外发和上线不在P1–P4。真实数据不入Git，仓外旧包/结果不覆盖。无需新增依赖或安装新平台。

## Implementation Tasks

- [x] T1：冻结历史关键词算法与版本来源，补parity测试。
- [x] T2：在既有生命周期中实现双路评测，保持单路兼容。
- [x] T3：比较合同与CLI实际消费，完成异常矩阵。
- [x] T4：工程验证、review、ship交付、PR CI与获批合并完成；合并后CI通过。
- [ ] T5：009真实双路比较已完成；16项实际人工观察未完成。
- [ ] T6：证据复核与真实签发。

串行实施，共享runner及报告边界；独立计划审查不修改代码。

## GSTACK REVIEW REPORT

| Review | Runs | Status | Findings |
| --- | --- | --- | --- |
| Eng Review | 1 | ENGINEERING CLEAR | 两项计划风险与CI接线问题已落实验证；真实门另行保留 |
| Outside voice | 1 | COMPLETE | 冻结完整算法；两路同事务。已纳入，不冒称跨模型 |

VERDICT: P1口径采用、P2交付及009真实比较已完成；P3人工观察与P4实际复核/签发未完成。

**UNRESOLVED DECISIONS:**
- 16项实际人工观察和业务/QA意见尚缺；T6待证据齐备后明确签发。既有口径采用、合并及009运行授权不重复询问。
