# 真实 G1a 搜索准入与离线影子执行计划

> **历史实施记录：** 本文批准范围、设计和按版本记录的事实保留；正文中的“当前”、等待与分支均指记录形成时。恢复任务请只从[当前执行清单](2026-09-06-execution-goal.md)进入，不从本页推导新授权或重复执行已完成步骤。

> **状态：** `APPROVED · G1A-E0 ONLY`
> **实施状态：** `T1～T3 COMPLETE · MERGED SYNTHETIC EVIDENCE`（PR #21 · `main@be33c0e` · post-merge CI run `33849888116` 三条 lane 全绿）
> **真实准入状态：** `T4 BLOCKED / RISK REVALIDATION REQUIRED · T5 ATTEMPTED / BLOCKED · T6 NOT SIGNED · G1a NOT_EVALUATED`（2026-09-05；历史验收保留，当前包不能据此重跑；治理仓拥有批准与真实证据）
> **决定来源：** 治理仓 `DEC-SEARCH-01`（2026-09-04，`PASS-WITH-CONDITIONS`）
> **当前产品基线：** 风险校验实现合并基线 `main@04c90b3c2e60a519192913ba00537c130eb10176`（PR #26；合并后 CI run `33943165306` 三路通过；后续纯文档提交不改变该实现证据）
> **治理基线：** `main@e70b88fa25c2c527a3d562685a9245b345de43f7`（本轮读取的本地基线）
> **实现归档：** PR #21（候选头 `ec97528`，合并头 `be33c0e`）
> **授权边界：** 只放行本计划 T1～T3 的离线工具与合成替身实现；真实数据导出、复制、装载与运行须在对应 EVD 完成后另行执行。本文不授权 DEV-M2、桌面 adapter、飞书运行接入、外部模型、自动发送、部署或 Pilot。

## 1. 结论

### 2026-09-05 业务版本确认与工程记录衔接

- 用户明确确认：售前、售后、活动、产品四域表格均由业务提供且已审核通过；当前执行继续原批准范围，不启动原文重审、改写或首发删减方案。
- 本文历史“正式批准 0/33”指装包所需逐条风险签收记录尚未齐备，不能解释为业务话术未获批准。当前助手不代填最终风险等级、审核主体或第二审核人，也不把业务版本确认自动变成未实际发生的双审证据。
- 实际工程缺口为：来源版本与批准覆盖关系、逐条风险元数据、合同规定的审核主体记录，以及版本化装包入口仍绑定历史路径/基线。`reviewer-decisions.confirmed.json` 仍不存在；先核对既有业务批准可复用的内容，不反复要求审核原文。
- 用户后续明确选择由自己统一承接本批四域业务版本批准；不再等待第二审核人这一范围选择。决定已记录，合同转换尚未实施：须先在治理仓明确受限的负责人承接模式，再同步快照、新增 migration、输入校验与装包器；不能修改已冻结 migration、伪造另一审核主体或清空风险类别绕过约束。该决定不代签 QA、数据安全、T6 或上线。
- AI 选句、多模型评测、蒸馏与 RAGFlow 均暂停，不是上线前置条件。桌面合成 fixture 仍为测试/演示基线，并未被替换成业务话术；正式接线与上线尚未完成。
- 本次记录澄清不改变 T4/T5/T6 的机器证据和状态，不自动续期、装包、运行或签发。治理仓对应留存为 `90-评审/2026-09-05_四域业务批准确认与工程准入差异.md`，无运行时跨仓依赖。

搜索上线工作按六板块推进：负责人承接合同 → 真实话术版本化入包 → 真实搜索质量验收 → 正式内容/身份运行链 → 桌面搜索闭环 → 内部灰度与上线交付。详细盘点由上述治理记录拥有；当前实施仍停留第一板块的变更面核对，不把此导航当作 DEV-M2 或发布授权。

### 2026-09-05 风险输入校验修正（PR #26 已合并）

- T5 ATTEMPT-06/07 已尝试但未生成评测报告。ATTEMPT-07 的受控诊断为 SQLSTATE `23514`、表 `release_items`；清理证据为 PASS，临时根目录与 PG 进程残留均为 0，真实输入未删除。
- 仓外只读投影发现 33/33 条均为 medium 且风险类别非空，与冻结数据库风险合同冲突。旧装包器按域填类别并硬编码 medium/single，没有消费逐条审定输入；这一事实足以阻断装载，不代表其他风险已经排除。
- 产品输入边界提前拒绝 low/medium 携带类别、high 无类别及活动缺少截止时间；保持既有高风险/冲突双审与数据库约束，不做自动改判或降级。
- 仓外装包逻辑改为消费显式、来源绑定的审定合同；覆盖缺失审定、来源漂移、同主体双审及未决冲突。结构校验不是审核人身份和审批真实性的证明；旧包与历史锚点不修改。
- 33 条逐条候选及空白待审模板仅在仓外生成，正式批准 0/33。完成真实审定后才可准备版本化新包、外部锚点和新基线 dry-run；不得复用历史 READY 直接重跑 T5。
- 验证：输入边界 31/31；E0 纯合成（含隔离 PG15）54/54；仓外审定合同 8/8；lint、typecheck、test、build、workspace:check 均通过。未运行新的真实 T5，未签发 T6；不涉及桌面变更，未重复本地 Electron E2E。
- Git 退出：候选 `cc9565b` 经 PR #26 合并为 `04c90b3`；候选 CI run `33942953693` 与合并后 CI run `33943165306` 均三路通过。本地 main 已同步，`codex/g1a-risk-admission` 本地及远端候选分支已删除；不涉及真实资料删除。

以下各节中的既往验证/修复记录保留其当时语境；当前重跑条件以上述状态为准。

现有 `DEV-M1` 已具备可复用的 PostgreSQL 15 `SearchBackend`、四域 current-release 门、DB 侧 Top 3、来源/版本/范围过滤与纯合成 50 条 runner，但现有 HTTP 路由仍主动拒绝非 `synthetic`，桌面也仍使用本地合成检索。真实 G1a 不应通过放宽 `/v1/search` 或接入飞书来完成。

本计划选择**离线、用途锁定、无网络出站的影子评测**：受控真实资料在仓外完成脱敏和冻结；产品仓只实现闭合 manifest 校验、隔离 PG15 装载、同一 `SearchBackend` 执行和不含原文的汇总报告。这样能验证真实检索质量，同时保持在线 API、事件采集、桌面和生产权限全部关闭。

## 2. 已有能力与缺口

| 项 | 当前事实 | G1a 处理 |
| --- | --- | --- |
| 搜索实现 | `SearchRepository` 在单 SQL 内完成 current release、四域来源、scope、有效期、排序和 Top 3 | 原样复用，不复制第二套 ranker |
| HTTP 路由 | `/v1/search` 只接受 `collection_mode=synthetic` | G1a 不经过 HTTP，不放宽路由 |
| 合同 | `CollectionMode` 已含 `approved_redacted`，但当前运行路由未启用 | 仅作为受控资料分类语义；本轮不改 OpenAPI |
| 事件 | Search + query/impression/adoption/escalate 事务已实现 | G1a 不写运行事件，不产生采用率或发送事实 |
| 桌面 | Query 仍读 `SYNTHETIC_SCRIPTS`，无 API adapter | 保持不变；DEV-M2 另行授权 |
| runner | 50 条纯合成、50/50、`NOT_SIGNED / NOT_EVALUATED` | 复用执行结构，不复用数据、分数或结论 |
| 真实资料 | 不在 Git；治理仓已记录 T4 静态验收和盲审锁，T5 尚无评测结论 | 重试前重验包有效期、权限与外部锚点；本计划不签收真实结果 |

## 3. 采用与拒绝的方案

### 方案 A：直接开放 `/v1/search` 的 `approved_redacted`

拒绝。它会同时引入真实身份、运行时内容、事件留存、notice、桌面 adapter 和生产 ACL，无法把“评测”与“上线链路”隔离，失败面超过当前决定。

### 方案 B：独立离线 G1a runner（采用）

```text
仓外受控工作区
  ├─ 权威四域快照（已脱敏、不可变、带 SHA-256）
  ├─ 20 正例 + 12 安全负例 + 18 鲁棒性问法
  └─ 盲审前冻结的期望话术 ID / no-hit / 澄清或升级条件
            │  closed manifest + hash verification
            ▼
本机隔离 PostgreSQL 15（无 TCP 监听、临时目录、运行后销毁）
  └─ 评测专用 owner 装载不可变 release snapshot
            │
            ▼
现有 SearchBackend → SearchRepository → search_recommendable_scripts
            │
            ▼
逐例结果（仅评测进程内）→ 聚合计分 → 脱敏报告
  └─ 不含 query_text / answer_text / source locator / PII / token
```

离线 runner 是评测工具，不是第十个业务端口。它不得导入 `apps/desktop`，不得注册 HTTP route，不得读取飞书、不写运行事件、不把真实文本写入仓库，也不得创建可长期复用的真实数据库。

实现固定放在 `apps/api/tests/support/g1a-e0/` 与显式 runner test 中；API 的 `tsconfig.build.json` 只编译 `src/**`，因此该能力不进入 `apps/api/dist` 或正式候选包。此处的 Node 网络守卫只防止评测进程意外 TCP / fetch 出站，并允许当前临时 PostgreSQL Unix socket；报告只把该观察面记为 `NODE_TCP_FETCH_GUARD_ONLY / process_guard_attempts`，不得改写成宿主级“零外网”。它不是对 UDP、预缓存原生引用、恶意原生代码或 OS 沙箱成立的证明，T5 真实运行前仍须补宿主级网络与残留检查。

## 4. 冻结评测合同

### 4.1 输入包

真实 G1a 包必须位于仓外受控目录，并至少包含：

- `manifest.json`：使用 `customer-agent/g1a-evaluation-manifest/v2`，记录 `eval_set_id`、内容快照 ID/hash、创建/到期时间、用途锁 `g1a_search_eval_only`、DLP 与独立性证据 ID/hash、实施者 / 业务 Owner / 盲审人的伪名主体 hash、删除截止时间；manifest 自身 SHA-256 必须由仓外 EVD 作为必填参数传入，不能从输入目录自证；
- `content.jsonl`：四域不可变来源绑定与可检索发布项；不得携带原始飞书 URL、协作者、审批原文或未脱敏客户信息；
- `cases.jsonl`：固定 50 条，顺序为 20 正例、12 安全负例、18 鲁棒性；每条有稳定随机 ID、分层标签、平台和成对商品上下文；
- `expectations.jsonl`：在看系统结果前冻结的可接受话术 ID 集、`expected_search_action`（`top3|no_hit`）、`downstream_action`（`none|clarify|escalate`）与禁止返回 ID；治理决定中的通用 `expected_action` 在 wire 合同中拆为这两个闭合字段，并与问法正文分文件，便于盲审锁定；
- 每个 payload 的 SHA-256、字节数和 LF/closed-shape 约束；manifest 的 own-hash 由 runner 计算并与仓外锚点比较，不做循环式自描述。
- `comparison_sets` 使用 `customer-agent/g1a-comparison-manifest/v2`：`PRESENT` 必须让样本 ID、来源 ID 与语义簇 ID 三轴均非空，`NOT_PRESENT` 必须让三轴均为空；状态和排序后的三轴列表一起进入 canonical SHA-256，并由外层 manifest 的仓外锚点锁定。`dev_synthetic` 必须为 `PRESENT`，train/G1b 可以用显式 `NOT_PRESENT` 表达当前尚无对照资产，禁止以测试占位 ID 伪造存在；T4 EVD 仍须独立记录三组清单 hash，不能让 runner 从当前目录自行选取比较集。

任何真实正文都不得进入 Git、测试快照、日志、异常 message 或 gstack 产物。仓内只允许保存 schema、纯合成替身和不含原文的汇总证据。

本地正则只作为明显 URL、token、邮箱、手机号和长标识符的 **leak canary**，不得写成 DLP 已完成；真实脱敏结论只由 manifest 绑定的冻结 EVD 证明。内容项不接收独立 `search_terms`，检索文档按与正式导入相同的 question / title / answer 字段权重确定性派生；`content_hash` 在临时 PostgreSQL 中调用正式 `content_governance_hash(...)` 复核，禁止退化成 answer-only hash。

#### E0 共享工作簿的域级来源映射（2026-09-05，PR #24 已合并）

`source_ref` 标识来源，允许四域共用同一工作簿；`source_version_id` 仍须四域各自唯一。
E0 manifest 的 `content_snapshot_id` 是整包快照，不是每域的供应方版本号。
装载器独占映射职责，将临时数据库 `upstream_version` 确定性编码为
`JSON.stringify(['g1a-e0-domain-snapshot-v1', content_snapshot_id, domain])`。
这是隔离评测内部的域级快照键，不宣称是飞书原生 revision，也不改变正式来源版本合同。

该映射对独立来源和共享来源统一使用，不根据重复次数打补丁；JSON 元组防止分隔符歧义。
来源别名、版本 ID、绑定 hash、内容治理 hash、审批与有效期保持输入原值。
数据库唯一约束和整体事务回滚保持不变，同来源同域重复版本仍拒绝；不使用忽略冲突的插入。
无需修改 manifest v2 格式或真实包字节。修复完成合成验证及 Git 合并；修复后未重试真实 T5、未签发 T6。

本地验证：新增共享工作簿用例在修正前复现 `G1A_LOAD_CONTRACT_INVALID`，修正后通过；
`pnpm test:g1a:e0` 45/45，宿主网络沙箱内 5/5（含共享来源、重复域拒绝、失败回滚与清理），临时根目录残留 0。
`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm workspace:check` 通过。
`pnpm test` 中显式 PG / 真实包用例按开关跳过，E0 PG 合成集已单独验证；未运行真实包、Electron E2E、部署或 T6 签发。
上述修复由候选头 `7a54a8c` 经 PR #24 合并为 `4dbee4b`；合并后 CI run `33930030132` 的 Linux canonical、PostgreSQL 15 integration 和 Windows feasibility smoke 全部通过。本地 main 已同步，候选分支保留。合成验证不替代真实 T5 或治理仓的阶段签发。

### 4.2 独立性

- `dev_synthetic / train / G1a / G1b` 的样本 ID、来源和语义簇交集必须由已绑定内容 hash 的冻结清单实际计算为 0；manifest 中自报一个 `overlap=0` 或与清单内容不一致的任意 hash 均不构成证据；
- G1a 使用同一冻结内容快照同时跑关键词基线与当前候选方案；不得在看到结果后删除难题、补答案或修改内容；
- 真实 Pilot 产生的 `REAL-FWD` 只进入 G1b，不得回填 G1a；
- 唯一实现者不得担任独立盲审人，按伪名 subject hash 判定而不是只比较角色名。`L1 · SINGLE_OWNER` 可继续承担资料治理和决定签发，但不能替代这一项业务防泄漏检查。

### 4.3 通过阈值

- 正例 Top3：`>= 14/20`（70%）；
- 每个冻结的“平台 × 核心意图”分层：Top3 `>= 50%` 且至少命中 1 条；
- 来源、版本、平台/商品范围和有效期正确率：总体及每个分层均为 `100%`；
- 12 条安全负例：错误直答、禁止话术返回、越权泄露和自动代发均为 `0`；标为 `expected_search_action=no_hit` 的用例必须 `12/12` no-hit；
- 18 条鲁棒性：T3 只自动判定预冻结的 hit/no-hit，并把结果写入 `search_action_result`；`downstream_action` 继续作为 T5 盲审输入，T3 不得把 no-hit 推断成已澄清或已升级。搜索动作全通过时 `search_action_result=PASS_CANDIDATE`，但在下游动作仍为 `NOT_EVALUATED` 时整体 `decision` 必须保持 `REVIEW_REQUIRED`；非安全类检索错题使两者均为 `REVIEW_REQUIRED`，安全行为错误任一 `>0` 则失败；
- backend error、未绑定来源、跨 release 候选和运行事件写入均为 `0`；E0 的 `process_guard_attempts` 必须为 `0`，T5 再由宿主级控制证明真实运行无外部网络调用；
- 单机隔离评测记录每次查询耗时，p95 目标 `<300ms`；该结果只是本地搜索预算证据，不等于 300 QPS 或端到端性能认证。

阈值不得由 runner 根据结果动态调整。任何降门槛都必须回到治理仓新建 DEC，不能修改本计划后直接重跑。

## 5. 失败关闭与清理

| 失败 | 必须结果 |
| --- | --- |
| manifest 未知字段、缺项、hash/字节数不符 | 读取任何正文前失败 |
| DLP、用途锁、到期日或批准 EVD 缺失 | 不创建数据库、不运行搜索 |
| 四域 binding 不完整、来源暂停、内容 hash/审核/scope 不合格 | 整批失败，不转成普通 no-hit |
| 数据集交叉或盲审锁未冻结 | 不计分，状态 `NOT_EVALUATED` |
| backend error、禁止候选或安全错误 | G1a 直接失败，保留安全摘要后销毁临时库 |
| 报告包含正文、定位符或 PII | 报告生成失败，不落盘 |
| 临时 PG 停止或清理失败 | 退出非零并列出受控路径；不得宣称完成 |

运行结束必须销毁临时 PG cluster 和进程内明细。受控输入包按 manifest 到期删除并留下不含正文的删除证明；失败不能通过跳过清理或保留数据库“方便复查”。

## 6. 实施切片

| 任务 | 状态 | 范围 | 退出证据 | 可并行 |
| --- | --- | --- | --- | --- |
| T1 | **COMPLETE · MERGED** | 定义仓内 G1a manifest/case/expectation schema 与纯合成替身 | closed-shape、50 条分母、hash、用途锁、过期和交叉负例 | 与 T4 业务准备并行 |
| T2 | **COMPLETE · MERGED** | 实现仓外路径读取器和前置 verifier | 读取正文前验 manifest；路径/符号链接/权限/大小失败关闭；错误不回显正文 | T1 后 |
| T3 | **COMPLETE · MERGED** | 实现隔离 PG15 evaluation release loader、SearchBackend runner、聚合报告和清理 | 无 HTTP/事件；同一 SearchBackend；事务内 source-gate 后验与整批回滚；报告白名单；Node TCP/fetch 守卫与清理正反例 | T2 后 |
| T4 | **BLOCKED · RISK REVALIDATION REQUIRED** | 四域业务版本已批准、负责人承接已确认；33 条工程风险记录与现行机器合同转换未完成，转换前不装包 | 历史 `EVD-G1A-DATA-01`、`EVD-G1A-EVALSET-01` 保留；新责任模式须形成版本化工程证据 | 先合同实现，再仓外装包 |
| T5 | **ATTEMPTED / BLOCKED · NOT_EVALUATED** | Attempt06/07 未形成评测报告；先完成负责人承接合同转换并版本化重装，再核验新基线与 dry-run | `EVD-G1A-RUN-07`、`EVD-G1A-CLEANUP-07`；不以合成分数代替真实结果 | T3、T4 后 |
| T6 | **NOT SIGNED** | 业务 Owner + QA 复核阈值、失败关闭、清理证明并签发 | `EVD-G1A-RUN-01`、`EVD-G1A-SIGN-01` | T5 后 |

T1～T3 可使用纯合成替身开发和测试。T4 的真实资料准备、T5 的真实运行和 T6 的签发分别是独立动作；任何一个未完成都不能把状态写成 G1a Pass。

### 6.1 T1～T3 合并退出证据（2026-09-04 历史快照，不代表当前 T4/T5 状态）

- PR #21 已以候选头 `ec97528` 合并为 `main@be33c0e6e6b95264449525fd6a067ee164204093`；合并后 CI run `33849888116` 的 Linux canonical、PostgreSQL 15 integration 与 Windows feasibility smoke 三条 lane 全绿；

- `pnpm test:g1a:e0`：38/38，通过真实包同形输入边界、comparison 内容 hash、20+12+18/唯一性/格式/大小负例、用例来源零交叉、候选 release/provenance 与全部硬门、PII 报告拒绝、事务回滚、50 条纯合成闭环及加载/冻结时间失败时的集群清理；纯合成报告为 `EXECUTABLE / NOT_SIGNED / NOT_EVALUATED`，受控包硬失败会让命令非零退出，可执行的受控包在 T5 前整体保持 `REVIEW_REQUIRED`；
- `pnpm --filter @customer-agent/api test:integration`：43/43，通过 PostgreSQL 15 runtime、search/events 与旧版 synthetic runner 回归；
- `pnpm test`：contracts 17/17、database 19/19、API 115/115（显式 PG 用例另跑）、desktop 508/508、artifact boundary 8/8；
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm workspace:check` 均通过；
- `pnpm test:g1a:synthetic` 旧版基线继续 50/50、禁返 0、backend error 0，且仍为 `NOT_SIGNED / NOT_EVALUATED`。

未运行 `pnpm test:g1a:e0:package`：当前没有获批的仓外真实输入包与外部 manifest SHA-256 锚点。未运行 Electron E2E 或真实设备测试：本切片没有修改桌面运行入口，且它们不能替代真实 G1a。

### 6.2 T4 受控准备清单（历史静态验收保留，当前合同转换未完成）

T4 只在双仓之外的受控工作区执行，且开始前必须满足以下条件：

- 明确仓外根目录、唯一访问人、用途锁、保留期限和删除时间；该目录不得位于本仓或治理仓工作树内；
- 为四域内容快照分别记录来源版本、导出时间、文件级 SHA-256、DLP 结论和批准证据 ID，不在 Git 中记录正文、URL 或定位符；
- 独立冻结 20 条正例、12 条安全负例、18 条鲁棒性用例，并生成与 dev/train/G1b 的样本、来源和语义簇零交叉证明；
- 盲审答案由唯一实现者之外的人员在看到系统输出前锁定；实现者只接收外层 manifest 锚点和运行授权；
- 预先写明成功、失败、超时和宿主异常后的清理步骤，以及不含正文的删除证明字段。

治理仓 `DEC-SEARCH-01` 已将 `EVD-G1A-DATA-01`、`EVD-G1A-EVALSET-01` 与 `EVD-G1A-BLIND-01` 标为 READY；真实资料与外部锚点继续只留仓外。本次回填未读取真实包，不重新签收 T4，也不证明旧包当前仍有效。

### 6.3 PR #24 修复后收尾顺序（2026-09-05 历史快照，现行顺序见 6.4）

1. 双仓候选分支回填 PR #24 / `4dbee4b` 与 CI 证据，保留历史尝试及全部既有修改；本轮仅本地编辑。
2. 定向文档验证后，另行授权提交、推送、PR、Review、合并；`AGENTS.md` 既有修改单独确认范围，不自动混入状态提交。
3. 已合并修复候选分支仅在明确删除授权后清理，不影响真实资料保留策略。
4. 展示 T5 重试 dry-run：核验执行器与新基线、包权限、有效期、外部 manifest 锚点及清理条件；过期不运行，不自动延期。
5. 独立授权后运行一次真实 T5，产生新的脱敏报告与清理证据，不覆盖历史失败、不调金标或阈值求通过。
6. 复核下游动作与全部硬门后，再单独授权 T6 签发；DEV-M2、飞书运行接入、部署、外部模型和自动发送不随之放行。

### 6.4 风险修正后的现行顺序（2026-09-05）

1. PR #26 实现和合并后 CI 已完成；双仓文档分别交付，不把文档合并视作风险审批。
2. 将已确认的本批四域负责人承接决定落实到版本化合同、追加 migration、输入校验和仓外装包器；保留风险分类与来源绑定，不伪造第二审核人、不清空风险类别。现行机器双审约束在转换前继续失败关闭。
3. 合同转换与来源绑定证据齐备后生成版本化新包、外部锚点与证据；保留原包，不自动延长有效期，不覆盖历史尝试。
4. 绑定获批实现基线，先做纯合成宿主预演；真实 T5 前重新核验权限、有效期、锚点和完整 dry-run，按有效授权运行一次，失败即停。
5. 真实报告与清理证据齐备后再做业务和 QA 复核；T6 须真实签发依据，DEV-M2、部署及运行接入不随之放行。

## 7. 验证计划

```text
INPUT BOUNDARY
  [PASS -> UNIT] closed schemas / exact file set / LF / size / SHA-256
  [PASS -> UNIT] purpose lock / expiry / EVD / 20+12+18 / unique IDs
  [PASS -> UNIT] dev-train-G1a-G1b sample/source/semantic-cluster disjointness
  [PASS -> UNIT] no raw path, URL, query, answer or PII-shaped ID in errors/reports

EPHEMERAL DATA PATH
  [PASS -> PG15] four-domain immutable release and current binding
  [PASS -> PG15] source-gate / governance hash / question contract fail closed and roll back
  [PASS -> PG15] runtime role is read-only and cannot write evaluation seed objects
  [PASS -> PG15] cleanup on success and caught failure paths
  [T5 PRECONDITION] host-level reconciliation for signal/abrupt process termination before any real run

SCORING
  [PASS -> UNIT] positive Top3 and per-stratum denominators
  [PASS -> UNIT] 12/12 no-hit and forbidden=0 hard gate
  [PASS -> UNIT] source/version/scope/effective 100% hard gate
  [PASS -> UNIT] synthetic input remains NOT_EVALUATED; controlled candidate remains NOT_SIGNED / REVIEW_REQUIRED until T5
  [PASS -> UNIT] report whitelist rejects text, locator and PII fields
  [PASS -> UNIT] overall decision cannot pass while downstream action is unevaluated; search-only candidate status is reported separately

NETWORK OBSERVATION
  [PASS -> UNIT] TCP/fetch attempts are blocked and counted; proxy state restores idempotently
  [PASS -> UNIT] out-of-bound and symlink-escaped Unix sockets are rejected
  [T5 PRECONDITION] host-level egress control proves channels outside the Node guard

REGRESSION
  [REQUIRED] pnpm lint / typecheck / test / build / workspace:check
  [REQUIRED] explicit PostgreSQL 15 integration and synthetic runner
  [NOT IN SCOPE] Electron E2E, Feishu, real desktop, production, Pilot
```

## 8. 不在本计划范围

- 开放 `/v1/search` 的 `approved_redacted` 或 `pilot_recorded`；
- 真实飞书 OAuth、机器人读取、文档订阅或在线同步；
- Electron main/preload/renderer API adapter；
- import/publish/announce 正式端口、DEV-M2、真实事件留存或 Dashboard 指标；
- RAGFlow、embedding、外部 LLM、教师、训练、自动学习或付费调用；
- 自动填、自动发送、生产部署、真实坐席灰度或上线承诺。

## 9. GSTACK REVIEW REPORT

### Architecture Review

1. **[P1] 准入、评测和运行接入原先被同一句“真实 G1a”混在一起。** 已拆为 `DEC-SEARCH-01`、G1a 离线运行与 DEV-M2 三个独立关口。
2. **[P1] 直接放宽 HTTP `collection_mode` 会扩大信任边界。** 采用无 HTTP、无事件、无桌面的离线 runner；公开合同和路由保持不变。
3. **[P1] 真实内容不能进入 Git 或长期数据库。** 输入包固定在仓外受控目录，采用不可变 manifest、隔离 PG15 和运行后销毁。
4. **[P1] 合成 50/50 不能成为真实分数。** 真实集、合成集、train、G1b 按来源和语义簇强制零交叉。

### Code Quality Review

5. **[P2] 不复制第二套检索器。** runner 依赖现有 `SearchBackend` port；装载、验证、计分和报告各有单一所有者。
6. **[P2] 不把评测模式散落成 route flag。** G1a 工具以独立入口封装用途锁、生命周期和清理，业务调用方无需理解临时库细节。
7. **[P2] 报告边界必须白名单。** 只输出 ID、计数、hash、耗时和稳定失败码，不透传输入行或数据库 row。

### Test Review

8. **[P1] 当前 runner 只验证纯合成固定数据。** T1～T3 增加真实包形状的合成替身、独立性、锁定、脱敏和清理负例。
9. **[P1] 安全负例不能混入总体均值。** 12 条单独 100% no-hit/安全硬门，任一错误直接失败。
10. **[P2] 本地性能不能冒充容量认证。** 只记录单机 p95 `<300ms`；300 QPS、端到端和 Windows 仍未认证。

### Parallelization

代码 T1～T3 串行收口；业务资料 T4 可并行准备。T5 只在两条链都完成后执行，T6 只签真实结果。该顺序把真实资料暴露窗口压到一次受控运行，并避免实现者提前看到盲审答案。

### Final Decision

采用方案 B。以上评审结论为 T1～T3 设计历史；2026-09-05 当前真实 G1a 状态为 `T5 ATTEMPTED / BLOCKED · NOT_EVALUATED · T6 NOT SIGNED`。工具修复合并不代替真实验收，DEV-M2 与运行接入继续 `NO-GO`。

NO UNRESOLVED DECISIONS
