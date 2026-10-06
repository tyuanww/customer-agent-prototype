# FAQ 闭环：P2 正式合同交接

> 状态：**治理合同已提交并 export · 产品 intake / codegen / 追加迁移已验收 · 仅限合成开发 · 三方公开交付 EVD 待齐**。2026-10-06，产品依赖 P1 `d9e68ace6c1cb61c691e85bed6d7af42b0fa144e`。
> 本页把已确认需求映射到下一份正式合同需要表达的资源、约束与验收，不签发合同版本、阶段门或真实运行权限。当前任务与授权只在[需求计划 §0](plans/2026-10-03-content-intake-requirements.md)维护。

## 1. 交接范围与基线

P2 的结果是合成 FAQ 文件经过服务端复算、持久候选、合成人工审批证据、原子发布，最终被另一名坐席按当前店铺查询和复制。业务规则沿用计划 §12 / E0–E18；[P1 三方差集](reference-content-intake-p1-contract-gap.md)拥有当前 1.14.0、已 export 1.15.0 的来源 SHA 与双哈希，本页不复制第二份版本真源。

治理仓的 `30-开发-进行中/12-DEV-M3话术师发布产品活动合同增量.md` 及其 1.15.0 产物，只解决 coach 的 product/campaign 发布门。其介绍页仍有 NOT EXPORTED 历史字样，实际 export 的核验见 P1 差集。2026-09-09 后端合成开发批准是既有 T1–T6 范围，不能替本次新资源、权限和审批语义签发合同。新合同在治理仓对应规范及生成源中维护；产品仓只通过既有 intake 接收不可变快照，不手工改写上游合同。

以下三个冲突必须在同一份合同增量中明确处置，不以修改桌面按钮完成：

| 现有行为 | 采用的需求方向 | 合同交接要求 |
| --- | --- | --- |
| actor 为 agent/coach/owner；1.15.0 coach 仅两个域且禁关键词 | 岗位能力上限、业务动作、授权范围分离 | actor 登录兼容不变；新能力逐动作/范围判定。旧 owner/coach 条件与新模式的适用入口由正式合同分别限定，不能把所有主管映射为 owner |
| 既有 dual-review/quality gate，worker 组织审核声明 | 常规允许人工自审，关键稿独立他审 | 新模式以绑定候选版本的人工 task/timeline/附件证明履行组织审核；质量门继续独立执行。需逐项说明旧 dual-review 哪些条件被替换、哪些仍保留，旧入口在正式 intake 前不放宽 |
| 按域整体替换，import batch 承担短期在途状态 | 按登记来源合并、缺行保留、长期候选 | 新候选与短期发布尝试分离；旧写先计算实际影响集合，与 active 来源相交则整次拒绝。不能将 sourceId 标签当成旧整域写的影响边界 |

## 2. 资源和字段义务

表中名称是逻辑资源，最终 wire 字段、URL、SQL 对象及版本号由治理合同确定。使用现有 schema、错误外壳、对象存储和发布底座；不另外部署 IAM、审批引擎或队列平台。

| 逻辑资源 / 所有者 | 正式 schema 必须表达的内容 | 约束与验收入口 |
| --- | --- | --- |
| 主体事实 / API 身份模块 | 内部 principal；tenant/app/idType/externalId 映射；受确认范围的同人键；部门/精确岗位/启用状态；factsVersion、revocationGeneration、checkedAt、validUntil | 身份不从 renderer userId 获取；未知、冲突、禁用、过期拒绝新资格；历史事实可证明审核时权限。G01/02/25/27 |
| 业务授权与分配资格 / API 权限模块 | 独立记录 id、issuer、recipient、action、ScopeKey、起止、原因、版本、撤销、steward；业务授权与分配资格不同类型 | 每记录一个 action/scope；多选为原子批次；资格不增加业务权，禁止自提权/同人别名/越界/再委派。撤资格保留下游并接管。G26 |
| ScopeKey / 共享正式合同 | tenant/app/brand/shop/domain/source；品牌通用与单店显式区分 | grant 可明确覆盖同店域全部来源；候选只能绑定一个非空登记 source，且与材料 sourceId 完全一致。禁止用 null/遗漏暗示全公司。P1 OCR 修复回归 + G03/26 |
| 登记来源与词项 / API 来源模块 | sourceId、唯一范围、template/rule/mapping 版本、来源声明；商品/场景稳定 ID、显示版本、业务语义与引用状态 | 文件不能更改登记范围；来源顺序不是文件时间/hash；引用后不能就地变义。G03/04/09/30 |
| 上传对象与解析任务 / 既有对象存储、worker、Main | 受控 objectId、字节数/MIME/hash；本地 jobId/generation；模板版本、有限预览、问题坐标与排除计数 | Main 只预检；服务端从对象独立复算，不接收可信 rows/hash。两端同版本 policy；任务取消不改其他候选。G05–08/10/12 |
| 候选版本 / API 内容模块 | candidateId/version、完整材料、canonicalEncodingVersion、digest、baseReleaseId、持久生命周期、创建/贡献人、不可变对象引用 | 材料清单按 E2；材料变化重建版本，首次补证只推进 readiness。正文与问题版本由服务端分配。G09/11/13 |
| 来源确认 / API 来源模块 | candidateId/version/digest/sourceId、确认事实、确认者与时间、evidenceVersion、revocationGeneration | 单独证据，不把确认时间/记录 ID 放进材料摘要；提交点核验当前版本。G04/13 |
| 人工审核绑定与事实 / API 审批适配器 | tenant/app/definition/node；稳定创建 uuid；instanceCode、reviewRequestId、candidate 绑定、审核包对象 SHA/fileCode；人工 task/PASS；历史及当前审核人资格；证据版本、代际与截止 | remote JSON 只从认证适配器取得。attachmentV2 临时 URL 需受控取字节并核 SHA；不能直接与 fileCode 等同。常规自审与关键排除贡献人分别测试。G13/27/29 |
| 发布尝试 / API 内容模块与 DB | candidate/version、operationId、payload 摘要、baseReleaseId、审批/来源证据版本、内部一次票据、importBatch 关联、最终 release 回执 | 60s 票据只在服务器；永久 candidate-version→release 唯一关联；unknown 不换键、不删除对象。G15–18 |
| 正式快照与使用资格 / API、Main | 单 release 内 FAQ、空或非空 SOP、媒体、词项版本、完整授权集合；shop 与上下文代际；事实/内容/lease 最早截止及撤销代际 | P2 空 SOP 是实际空集合；按店与条件过滤后处理显式覆盖；同店新版本与真正失效分开。G19/21/28/29 |

输入字段必须有显式类型、非空/枚举/长度/集合上限、未知字段策略和失败码；原则由正式 schema 表达。P1 的 TypeScript 类型不能直接充当运行时 validator。来源确认、审批适配器、授权配置各自验证其事实，候选模块只消费被确认且互相绑定的事实。

## 3. 状态与写入边界

只保留 E2 的两组可写状态：解析任务 `reading/parsing/validated/failed/cancelled`；候选 `awaiting-evidence/ready/publishing/published/cancelled/invalidated`。界面的“待来源核对”“待审批”“结果待核对”来自状态及原因，不增加另一份可写状态。

| 写入时刻 | 必须在同一提交边界保证的事实 | 失败后可观察结果 |
| --- | --- | --- |
| 授权/撤权/接管 | 两个主体当前事实、范围与分配资格版本；批次全成或全败；代际单调、原签发者审计保留 | 不产生部分越界 grant；重复撤销无副作用；无接管人保留合法业务权并冻结新分配 |
| 接收与候选冻结 | 配额原子 admission；已接收对象/登记来源固定；服务端完整复算；版本和 digest 绑定 | 结构错误无候选；证据未齐保留有效稿；A 等待不占 B 的解析/发布槽 |
| 绑定或刷新证据 | 当前候选材料绑定、人工节点与审核包、资格和来源确认；更换实例产生新证据版本 | 无法核验不得续期；首次补证不改材料摘要，旧票据不能消费新证据 |
| 发布最终提交 | 沿现有统一锁序核对 current/base、模式实际影响集、双方权限、候选/来源/审批代际及票据有效期；候选、release、公告、幂等结果原子落地 | base 变更须重审；过期票据拒绝；超时或响应丢失保留原 operation 查询；不自动重发 |
| 取消/模式启用/回退 | 与发布使用一致锁序；取消先赢不发 release，提交先赢返回 ALREADY_PUBLISHED；全目录回退覆盖全部实际变化范围 | 旧 actor-wide 取消不触碰持久候选；来源受限回退走纠正候选；撤销内容不得复活 |
| 审批撤销/资格续签 | 审批撤销代际与引用 release 不可用同时更新；谱系涵盖承继版本；续签取所有事实最早截止 | 丢事件/远程持续失败不得续命；Main 使 Query/SOP 独立失效，Fox 仍只读未读投影 |

远程组织/审批查询和解析均在事务外；锁内只核对受版本约束的本地事实。正式 DDL 要证明 foreign key、复合唯一键、状态转换、追加版本和运行角色权限共同覆盖这些不变量，不能只依赖 API 先读后写。candidate-version 的发布唯一关联不随 24h 幂等缓存清理而消失。

查询计划按候选 scope/state/updated_at 和审批谱系反向引用验证，批量取权限/候选/lineage；使用真实 PG EXPLAIN 与 10 倍合成存量验证，不能仅凭“加了索引”验收。

## 4. API / IPC 增量与兼容

能力清单及输入输出以 [P1 窄接口差集](reference-content-intake-p1-contract-gap.md#4-待批准的窄-ipcapi-交接表)为准；此处补正式化时必须绑定的共同语义：

- 写操作携带原始 operationId 与候选/资源版本，payload hash 覆盖材料与所依赖证据版本；读取恢复结果先查 candidate/release 永久关联。无权与不存在对外避免泄露，内部保留诊断 ID。
- 列表分页默认 50、上限 100，差异按块读取。renderer 不接受原生路径、会话主体或票据签发能力；Main 验 session epoch 与 sender/main-frame，API 重验实际范围。
- `dashboard.ts` 新能力继续使用独立 preload 和内联通道，不能引入 overlay 通用能力或 shared preload chunk。Query/SOP 只取得当前授权集合和使用资格。
- API 单独拥有 `contentIntakeMode=legacy|v2-preview|v2-active` 的版本化配置。P2 合成验证用 preview；真实 active 仍需 P4 入场授权。不存在第二个布尔开关或第二个 current 指针。
- 先做 additive schema/API 兼容，再接新桌面，最后启用具体范围。旧整域写只要实际影响任一 active 来源就拒绝；不可推导也拒绝。支持不了新快照的旧客户端保留明确升级提示，不回落合成数据。
- 错误外壳沿用既有 code/reason；每个错误必须指向“修文件、补证、刷新事实、重新核对候选或查询原操作结果”之一。解析错误不显示“未连接飞书”。

## 5. 可审阅的验收包

| 交付项 | 具体证明 | 当前状态 |
| --- | --- | --- |
| 正式合同 | 治理仓规范、OpenAPI、DDL、生成工具与合同测试一致；逐项关闭 §1 三个冲突 | 1.16 / schema1.20 已冻结并本地提交/export；仅限合成开发，三方公开交付 EVD 待齐。历史 /review 未收敛记录保留 |
| 不可变交接 | 来源 Git SHA、contract_set_id、manifest、OpenAPI/DDL 双哈希与字节数可核验 | 治理 commit `d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713` 已导出，产品通过来源 Git blob、manifest 与成对字节核验 |
| 产品 intake | 用 `pnpm contracts:intake` 接收；verify、codegen 与追加 migration 检查通过；消费锁记录确切来源 | 已接收新 contract set；222 schema、追加 0020/0021，前 19 段不变；验收记录见 §6 |
| 权限与持久状态 | 目标服务赋能师/获授权管理者能完成；普通坐席与跨店写拒绝；撤权/接管和历史资格有 PG 证据 | 权限/分配/撤权接管、持久候选与报告见事务验收；人工审批历史资格、附件与撤销传播见审批证据验收，真实 transport 待后续 |
| 并发与恢复 | PG 双会话：发布/撤权、发布/取消、同 base 竞争、模式启用/旧写两种顺序；响应未知、过 24h 重试不重复发布 | 已验证并发修订、admission、解析中撤权、原操作恢复；旧写共存门覆盖模式/旧写与上传/批量取消竞争，新候选发布/取消及续租矩阵仍待实现 |
| 完整 FAQ 消费 | 两管理会话交接；第二坐席按店查询/复制；新增、修改、显式停用、缺行保留与纠正回退 | 待 API/Main/renderer 纵向接线 |
| 下游实物与平台 | Excel 与错误报告往返；Main/API 同输入复算；包内解析进程可启动/取消；版本更新与失效分别正确 | P1 Node/Excel 证据可复用；Electron 和目标平台未验证 |
| 业务退出 | 非开发维护者编号回填/修错演练；两无关来源的 CAS 重审次数与等待记录 | 待演练，不由工程自测代填 |

正式化交接顺序：治理仓形成并审核新合同候选 → 对应批准与版本冻结 → 不可变 export → 产品 intake → API/DB 权威判定与合成事务验证 → Main/preload/界面 → 第二坐席消费与失败恢复。每步复用未改变的有效证据；测试成功不代替下一阶段批准。

## 6. 当前交接结果与下一步

2026-10-05 用户明确授权复审、修复后本地 commit 并继续交接；2026-10-06 接续完成产品验收。治理仓本次 commit 为 `d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713`，对应不可变合同集为 `cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa`。来源与双哈希以 [消费锁](../contracts/upstream/customer-agent/contract-set.lock.json) 和其指向的 manifest 为准；本页不另复制哈希真源。授权解释见需求计划 §0.5。

产品仓根 intake 只新增这一精确版本对的路径校验，仍拒绝混用版本、假来源和字节漂移。contracts generator 生成 222 个 runtime schema；真实消费者暴露了原转换器把字段名 `required` 当成 schema 关键字的问题，现按 schema 节点、字段字典、普通值分别转换，保留 `description` / `x-*` 业务字段及字面量，同时继续剥离 schema 注解。

数据库生成器保持 0001–0019 字节与来源不变，追加 0020 coach 既有合同增量和 0021 P2 封闭存储；overlay 源和历史 SQL 必须一致。新的 content_intake schema 纳入原 verifier 的 ACL、对象、函数和触发器摘要。审查实测发现 DOMAIN CHECK 被删除后旧 verifier 仍通过，已把 domain 约束、定义与 ACL 纳入同一后验，不另建校验入口。实际 PG15 清单为 215 条 ACL（原 211 加四条已存在的 domain 默认 PUBLIC USAGE，不增加 schema/表/应用授权）、2680 个对象条目；库存为 81 表、7 视图、209 函数（此计数沿用 verifier 所列命名空间，不是全库统计）。

实际验收及审查见[交接证据](../evidence/qa/content-intake-p2-handoff/README.md)：仓库 lint/typecheck/test/build、合同 19 项、接收工具 19 项、隔离 PG 17 项通过；额外启用既有 API 导入/审核/发布实库回归，21 项通过。DOMAIN 回归保留修前失败与修后拒绝证据。详细日志与 OCR 输入在 ignored `.gstack/content-intake-p2-handoff/`。本机修后审查无剩余具体缺陷；外部结构化两组完成，一组外部对抗输出未通过完成格式校验，缺口如实保留。产品 API/Main/renderer 本次未接线，仍保持既有 owner-only HTTP/桌面发布行为；SQL 合同允许的 coach 增量并不代表 UI/HTTP 已开放。

接续的 API/DB 权威权限和持久候选事务已在隔离 PG 中运行，范围、实际检查与剩余门见[事务验收](../evidence/qa/content-intake-p2-transactions/README.md)。来源确认和合成人工审批证据已接续，见[审批证据验收](../evidence/qa/content-intake-p2-evidence/README.md)。0022 已追加旧写共存门，见[旧写共存验收](../evidence/qa/content-intake-p2-legacy-fence/README.md)。下一步衔接现有质量/负责人承接门，实现 P2 原子发布，再验证另一坐席按店查询；依 §5 保留并发、未知回执和无权路径验收。生产角色 ACL、P2 HTTP、Main 与 renderer 未接线，不存在可用的新上传/审核按钮或正式飞书实例接入。

下一可验收切片先明确候选材料如何投影到既有质量 population、抽检结果及 owner 承接证据，禁止伪造旧 dual-review 或直接插入 release 绕过质量门。随后在同一内容锁下消费一次票据并原子写入候选回执、release、catalog/lineage 和公告；验收须证明质量拒绝零副作用、取消/撤权先赢不发布、响应未知用原 operation 恢复且永久关联不重复发布。

### 候选到发布底座的映射差集

`qualityPreview` 已实现只读的候选→质量 population/抽样投影；隔离 PG 消费它验证旧冻结与质量证据 SQL。这不等于产品质量计划已持久化或新发布入口已实现。旧函数及其合同保持不变，以下差集不得靠默认值补齐：

| 边界 | 已验证的可复用部分 | 发布实现仍需完成 |
| --- | --- | --- |
| 材料身份 | 完整候选 key；来源限定的 script ID；每条投影均绑定整份材料摘要 | 独立持久化候选→质量计划/逐条人工检查，提交时比对原材料。不能把抽样 hash 当旧 governance hash |
| 质量选样 | `qualityTargets`；DB population JCS 与排序；500/501 边界、扩样阈值、关键稿全量复核 | 冻结发生在检查前；逐条结果须覆盖精确样本；任一阻断项使整批修订。旧 SQL 的“passed 且有 quarantined 行”不能直接表示 P2 整批可发布 |
| 停用与继承 | 缺行保留；显式停用独立列出，仍被完整 key 绑定 | 旧 population 只含 upsert；停用必须经候选整体人工审批及最终 source 内合并，不能因空 population 自动发布 |
| 原生审批 | 固定审核包、历史人工资格、常规自审/关键他审及撤销谱系 | 新稿使用原生 review binding；不能生成伪旧 single/dual-review 主体、EVD 或 owner 记录 |
| 负责人承接 | `assert_owner_acceptance`、`owner_acceptance_release_content_ready` 保持原用途和撤销/期限门 | 旧 `OwnerAcceptanceRecord` 的 purpose 固定 `g1a_offline_only`，四域来源和内容摘要均需包外批准；只能按其合同核对待继承的旧记录，不能由新审批追认 |
| 检索与业务字段 | 新材料保留问法独立版本、商品/场景词项、长正文、分类与范围 | 旧 staging 要求 intent taxonomy、platform、source_ref、风险类别等；商品词项不能直接变成旧 sku/category。逐字段确定转换或新读模型，不能截断、猜默认或扩大范围 |
| 发布集合 | 既有单 current、来源绑定完整性、质量/owner 门；0022 旧写隔离 | 增加候选/来源版本→旧 release 成员及精确谱系的映射；消耗一次票据、候选永久回执、release/catalog/公告同事务；继承旧 owner 内容需重验 |

以上涉及已有正式 wire/schema 含义变化的部分，须在所属治理仓版本化后再 intake；不改变其含义的内部实现沿本仓批准的 P2 推进。下一阶段先实现与候选绑定的不可变质量计划和逐条检查持久化，验证“检查前冻结、扩样、任一错误整批阻断、修订旧证据不可用”，再接票据与原子提交。生产 ACL、HTTP/Main/renderer、真实审批 transport、使用资格和第二坐席查询仍未完成。

现场资料 B 最新版/维护人、真实租户组织字段/人工节点/附件保真属于后续真实验证；本轮未读取真实资料、员工信息或凭据，未 push、PR、merge、deploy，也未启用 v2-active。
