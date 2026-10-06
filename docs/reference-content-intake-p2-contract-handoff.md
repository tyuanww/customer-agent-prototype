# FAQ 闭环：P2 正式合同交接

> 状态：**治理合同已提交并 export · 产品 intake / codegen / 追加迁移已验收 · 仅限合成开发 · 三方公开交付 EVD 待齐**。2026-10-06，产品依赖 P1 `d9e68ace6c1cb61c691e85bed6d7af42b0fa144e`。
> 本页把已确认需求映射到下一份正式合同需要表达的资源、约束与验收，不签发合同版本、阶段门或真实运行权限。当前任务与授权只在[需求计划 §0](plans/2026-10-03-content-intake-requirements.md)维护。
> 当前消费已推进至 OpenAPI 1.17.0 / schema.v1.21，精确来源由消费锁与不可变 manifest 拥有；API 持久绑定、管理 HTTP 与 Main/Query 已由显式合成消费者接入，生产 HTTP/ACL、完整管理界面和原生验收尚未完成。质量 HTTP 缺口见末节。

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

接续的 API/DB 权限、持久候选、来源确认及合成人工审批，分别见[事务验收](../evidence/qa/content-intake-p2-transactions/README.md)和[审批证据验收](../evidence/qa/content-intake-p2-evidence/README.md)。0022 拥有旧写共存门；0023 拥有候选质量计划与逐条检查；0024 新增内部原生发布函数，复用同一个 release/current。当前消费者仍是隔离 PG 合成执行器，生产角色 ACL、P2 HTTP、Main 与 renderer 没有接线。

### 候选到发布底座的映射差集

采用原生材料与谱系映射，不把新候选塞进没有等价字段的旧 staging。发布接口消费已冻结正式 wire；0024 是本仓内部产品 overlay，不改写上游合同或旧函数。字段与证据的归属如下：

| 边界 | 本轮实现与所有者 | 后续限制 |
| --- | --- | --- |
| 材料身份 | release_lineage 精确引用不可变 candidate/version、来源、业务 ID、稿版本及 reviewRequestId；候选摘要包含整份材料 | 不能把质量 population hash 当旧 governance hash |
| 问法及检索字段 | 正文、独立问法版本、商品/场景词项、分类、适用说明、有效期原样留在 material；不截断或猜 platform/taxonomy/sku | 封闭 usage 按正式 IntakePublishedEntry 白名单输出；内部/附件说明不下发，停用问法不进入坐席页；生产 adapter 仍待接线 |
| 质量 | 最终事务要求候选绑定的质量状态为 passed；初样、扩样和逐条证据复用 0023 | 无冻结计划或新修订不能借用旧质量通过结论；旧 SQL 的 passed 不替代候选质量 |
| 来源与审批 | 来源确认与对象 SHA 绑定；锁外即时观察原审核实例，锁内核对 exact evidenceVersion、checkedAt、generation 及双方当前资格 | 原生人工证据不生成旧 single/dual/owner 记录；真实 transport 未实现 |
| 目录合并 | 当前来源使用完整候选（含缺行继承与显式停用）；其他来源谱系原样继承，并检查审批状态与最早期限 | 停用仍留历史谱系，读时过滤操作/有效期；显式 family 覆盖没有冲突证明时拒绝 |
| 旧成员与来源门 | 不同域 release_items 完整复制全部字段，四域 release_source_bindings 原样继承；继承前后重新调用原 owner 门，期限进入提交截止 | 四域绑定只拥有旧来源证明；新稿以自己的来源确认/审批谱系证明，不冒用旧来源或 owner 批准 |
| 发布与恢复 | 观察开始后至多 60 秒的一次服务器票据；候选、永久关联、release/catalog/lineage、current、公告和原 operation 回执同事务；未知提交只恢复原回执 | 回执是历史结果，不能当坐席当前使用权限；票据不外发 |
| 初始基线 | 只接续已有 native catalog；无基线或当前目标域仍有旧成员时 MODE_CONFLICT | bootstrap、旧内容认领/迁移及真实 v2-active 启用须独立治理，不能隐式清除旧成员 |

既有 owner 承接仍使用原 `g1a_offline_only` 合同及包外批准；新候选没有该旧身份时不伪造记录。最终事务先取得内容锁再取既有发布锁，重验 base、当前来源/发布人/审核人、材料及审批代际；继承审批和 owner 记录期限共同限制最晚提交。任何失败都不能留下票据、发布尝试或半个目录。实际验证与审查见[发布验收](../evidence/qa/content-intake-p2-publication/README.md)。

### 使用资格与目录消费

封闭合成服务已有 `issueEntitlement` / `snapshot`，复用原 `snapshot_offline_leases`、`content_intake.entitlements` 和单一 current。资格存随机不透明 ID 的 SHA-256；底层租约 token 不出服务。店铺/上下文代际及期限仍由原 entitlement 拥有；0025 的 1:1 不可变 entitlement_contexts 保存认证私有会话键与排序后的商品/场景选择，租约 client identity 继续绑定来源代际。没有新增运行 ACL。仅签当前 release；同店普通新发布不主动使旧页失效，但旧资格永远不续命，不能签历史 SOP 资格。

每页重验主体、业务 query、来源代际、全 release 承继审批、原来源/owner 门及最早截止；按店/独立品牌授权、商品、场景、有效期过滤后分页。内容下一次生效/失效会缩短资格，防止跨页结果随时间漂移；停用/过期行不下发，词项取材料引用的显示版本，内部/附件说明永不进入坐席合同，SOP/media 确为实际空集合。

单页还受 `IntakeSnapshot.vocabulary.maxItems=100` 限制；候选单条的商品/场景去重引用总数超过 100 时以 FILE_LIMIT 阻断，发布预检也核对历史候选。跨多条累计超限自动提前分页，保持每条正文及引用完整。新 1.17 validator 已把启用条目的合计引用约束为 100；显式停用可处理历史超限条目。

**当前未完成边界：** 商品/场景选择与服务器持久会话绑定的合同差集已关闭。显式 family 冲突证明、旧内容认领/初始基线、生产 ACL/HTTP、真实 transport 与 Windows 桌面现场链仍各有未完成条件。Main 模块已消费正式 wire 和实际 PG 产物，通过测试专用 loopback HTTP 和根级消费者探针验证，但尚未注册到产品 factory 或 renderer，不等于完整 FAQ 界面闭环。

### 2026-10-06 治理候选形成记录（历史）

治理仓 `codex/content-intake-p2-contracts@edad9943411c2e5ca75514d85974992df563b331` 已保存 `30-开发-进行中/14-P2使用资格上下文合同候选.md` 与 OpenAPI 1.17.0 / schema.v1.21，状态 DRAFT。其 `content-intake-usage-candidate/verification.md` 拥有精确产物双哈希、8 项 schema/92 项隔离 PG、29 步 release、OCR 与本机复审证据；外部缺失覆盖保留。本仓只记录交接，不复制另一份上游合同或批准。

候选确定把规范化 productIds/scenarioIds 放入资格申请；API 复用已认证会话，在 `entitlement_contexts` 原子保存私有会话键和选择。分页读取原绑定，逐页重验会话和原权限；删除短期会话不受历史资格 FK 阻塞。Main 独占本机当前店/选择、取消和代际，不建立全局当前选择服务。选择缺失不默认全量、旧无上下文资格不回填，会话私有键不出服务器。

候选保持 vocabulary=100，并用标准 JSON Schema 约束单条启用引用总数；历史超限行只可显式停用。前序合同、profile、批准和本仓 24 段迁移不改；后续只能通过精确版本化 export/intake 追加新迁移。该候选本地 commit 不等于冻结批准、三方公开交付 EVD 或正式运行许可。

### 2026-10-06 冻结接收与持久消费

用户在明确候选版本对后批准继续。治理仓 `53906e302288fe0fb70e58b24a40088ecbbd3ef6` 记录批准并冻结原字节，实际导出 `cs-ai-c11-openapi-1.17.0-schema-1.21-53906e302288`；产品既有 intake 已核验 Git blob/双哈希并生成 223 个 validator、追加 0025，消费锁仍为 VERIFIED_NOT_ACTIVATED。机器文件历史 DRAFT 注解保留，不替代独立冻结批准。三方公开交付 EVD 与运行门仍独立办理。

API 现在从认证边界取得私有会话引用，逐页锁定核验，消费持久选择并在最晚提交点核验原截止。Main 的 `ContentIntakeUsage` 隐藏换店/选择取消、迟到回调、完整分页、风险提示与原文复制分离、断网截止和失效扇出；普通新发布保留原有效句柄。当前一次目录限制 500 页、累计响应 32 MiB，超限可见失败且不交出部分目录；不写磁盘、不在旧 announce 中创建第二发布指针。实际结果与限制见[本轮证据](../evidence/qa/content-intake-p2-usage-context/README.md)。

### 下一阶段入场与验收

接下来补齐封闭合成 HTTP 与桌面 factory/白名单 IPC，让两个独立产品会话完成可操作的 FAQ 界面闭环。复用本轮 Main 目录所有者；新业务范围/选择意图需窄接口，不给 renderer 身份、资格凭据或通用请求能力。生产新 ACL、正式真实运行和数据门须分别完成，不以合成直连管理员池替代。

接入验收必须证明新 validator、候选合并及分页同时遵守 100 词项预算。还包括：两个独立产品会话完整“上传→校验→飞书人工审核→发布→分页 hydrate→按店检索”；跨店、会话重启及签发/注销竞争；断网至原截止、撤权/审批撤销的 Main 独立扇出；空目录替换与同店普通更新；Mac 和 Windows 原生客户端分别验证 preload/sandbox、窗口及复制。WSL 只覆盖后端，不作为后两项证据。

现场资料 B 最新版/维护人、真实租户组织字段/人工节点/附件保真属于后续真实验证；本轮未读取真实资料、员工信息或凭据，未 push、PR、merge、deploy，也未启用 v2-active。

### 管理 HTTP 接线与质量合同差集（2026-10-07）

计划 §0.20 沿现有 OpenAPI 接入七条路径：候选版本下 `POST source-confirmation`、`POST/GET review`、`POST review/refresh`、`POST publish`、`POST cancel`，以及 `GET /v1/intake/operations/{operationId}?action=publish|cancel|rollback`。所有写入保留完整请求并校验地址候选/版本一致；每个数据库阶段仍复核真实产品会话。GET 审批不观察远端、不续期；发布总是即时观察后由原子事务决定。接口只在隔离合成宿主注册。

取消仍持久化原有候选结果，由候选模块投影为冻结 `IntakeReceipt`，历史字节不迁移。操作回执严格使用主体+action+operationId 命名空间，发布和取消可恢复；不存在的回退操作返回与无权相同的 NOT_FOUND，回退执行器仍未实现，不由回执路由推断已支持回退。重复提交返回历史结果，不续签内容使用权。组织审批 transport 仍为合成实现；真实飞书另按专项流程。

**下一个合同增量：质量读写。** 本节是交接提案，未批准、未冻结，不是新增 wire 真源。规范/机器生成源仍归治理仓，须形成独立版本、批准/冻结/export 后由本仓 intake；现有 OpenAPI/生成 schema 不手改。

| 最小能力 | 现有内部接口 / 建议合同内容 | 必须保留的验收 |
| --- | --- | --- |
| 查看质量计划与结果 | `qualityPreview` / `quality`；绑定完整候选键，返回冻结/初样/扩样/通过/需修订/阻断状态，样本 ID 与内容 hash、抽样清单 hash、逐条结果及审核主体事实版本 | 读权限为 review；每次重验当前来源、base、候选键与会话，不能凭旧页面资格访问 |
| 冻结计划 | `freezeQuality({operationId,key})`；服务端选样，不接受客户端 seed、样本数量、审核人或结论 | 重放不新建计划；关键稿全部启用行必查；停用仍由完整材料摘要绑定 |
| 提交逐条检查 | `checkQuality({operationId,key,phase,checks})`；phase 为 initial/expanded；每项仅 scriptId/contentHash/defect/reason | 阶段集合必须精确匹配；重复 ID、漏项、错 hash、无原因缺陷拒绝；扩样原结果不可改；关键稿排除贡献人/同人别名 |
| 未知结果恢复与界面映射 | 质量操作沿既有永久回执；需在治理合同明确专属恢复路径/响应，不把质量动作塞进现有 publish/cancel/rollback 枚举 | 相同键不同载荷冲突；注销/撤权拒绝；质量 passed 不能替代组织审批、来源确认或发布票据 |
| 容量与分页 | 内部最多 5,000 检查项、每项原因 1,000 字符；内部完整投影含正文，不能未经预算直接搬到 HTTP | 在治理阶段决定固定请求/响应字节上限、计划/样本分页及游标绑定；以最大输入和实际客户端消费验收，不能套用当前写口的 64 KiB 上限 |

当前合成验收显式通过带真实会话的内部质量服务准备证据，然后用实际 HTTP 发布、由另一坐席通过资格/快照 HTTP 读取该 release 的原文。它证明现有门禁可组合，但质量步骤尚未走 HTTP；管理 UI、生产注册/ACL、初始目录治理、真实飞书与 Mac/Windows 现场验收仍是后续条件。
