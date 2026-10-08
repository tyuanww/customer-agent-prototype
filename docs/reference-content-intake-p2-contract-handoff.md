# FAQ 闭环：P2 正式合同交接

> 状态：**治理合同已提交并 export · 产品 intake / codegen / 追加迁移已验收 · 仅限合成开发 · 三方公开交付 EVD 待齐**。2026-10-08 复核；产品依赖 P1 `d9e68ace6c1cb61c691e85bed6d7af42b0fa144e`。
> 本页把已确认需求映射到下一份正式合同需要表达的资源、约束与验收，不签发合同版本、阶段门或真实运行权限。当前任务与授权只在[需求计划 §0](plans/2026-10-03-content-intake-requirements.md)维护。
> 当前消费为 OpenAPI 1.20.0 / schema.v1.22，精确来源由消费锁与不可变 manifest 拥有；API、Main/Query 已在显式合成 profile 接入确认直发与旧审批历史兼容。生产 HTTP/ACL 尚未接入；新增组织传输/用途权限实验和店铺名称 DRAFT 的回收范围见下表及文末。

## 当前消费状态（2026-10-08）

下文 §1–§6 与 §7 初始交接保留各次历史时点和数字，不把当时的“下一步”“未接线”当成今日待办。当前消费锁为 OpenAPI 1.20.0 / schema.v1.22、VERIFIED_NOT_ACTIVATED；产品内部迁移已追加至 0032。新候选与回退确认直发；approval-v1 只保留历史有效性约束，不要求新审批 transport。不能把上游 schema 版本与本仓迁移段数混为一谈。

| 能力 | 当前状态与证据 |
| --- | --- |
| 权限、持久候选、质量/确认发布 HTTP 与 Main/preload/管理界面 | 已在隔离合成环境贯通上传、报告、修订/取消、逐条质量、来源确认、二次确认直发与另一客服查询复制；见[直发验收](../evidence/qa/intake-direct-publication/README.md) |
| 权限配置界面 | 现有内容管理内增加局部权限面板；复用冻结 grants 列表/只读预览/保存/撤销与具名主体目录，management 唯一 service 注册独立 grants plugin。HTTP＋PG15 3 项、桌面相关单元/组件 80 项通过；权限 Electron 已在主集成通过，见[三线收尾](../evidence/qa/intake-parallel-recovery/three-part-completion/README.md)；原独立结果见[权限配置证据](../evidence/qa/intake-grant-management/README.md) |
| 纠正回退 | 0032、API、Main 已接入确认直发，保留旧谱系有效性及原子新发布；实际 Electron→HTTP→PG15 已验证，见[直发验收](../evidence/qa/intake-direct-publication/README.md)；[原回退证据](../evidence/qa/content-intake-p2-rollback/README.md)保留历史范围 |
| 显式同题覆盖 | 0028 完整目录守卫及按店/商品/场景的覆盖与通用回落已验证；见[家族证据](../evidence/qa/content-intake-p2-family/README.md) |
| 坐席界面 | 店铺选择、商品/场景多选、适用 FAQ 查询及原文复制已接通并完成[选择器合成验收](../evidence/qa/content-intake-p2-query-filters/README.md)；正式店铺显示名仍待下方合同候选批准与版本化 intake |
| 对象容量 | 0029 与 API 已实现四类对象持久预留/采用/释放、未知提交保护及只读账本干跑；10→100 并发准入、10→100 合成发布历史与双来源 CAS 重审已验证，见[容量证据](../evidence/qa/content-intake-p2-capacity/README.md)；历史保留期与受控历史清理仍待批准 |
| 平台 | Mac 开发态及指定版本 Windows/WSL 已取得分层结果；[杭州证据](../evidence/qa/content-intake-p2-hangzhou/README.md)不覆盖后续回退、家族及商品/场景选择等新增切片，普通账号、可靠拖动、整机断网仍未确认 |
| 组织与权限准备 | 组织版本绑定/原子撤销/provenance 与共享令牌候选已补；原组织专项 usage 仍用管理池。后续 purpose-candidate 已用受限业务/usage/worker 池贯穿四域 HTTP，Mac FAQ/回退 Electron 2/2 通过，见[发布验收](../evidence/qa/intake-release-acceptance/README.md)；组织池该轮只预检。正式 transaction/factory/ACL 尚未接线，合成通过不等于生产运行装配 |
| 版本化交付工具 | 治理 exporter / 产品 intake 已支持 contract-set/v2 的封闭 runtime 伴随产物；合成跨仓往返验证 12 件产物与 9 个 runtime_sources。实际 1.21.0/schema.v1.23 仍 DRAFT、未冻结、未 export、未 intake；正式消费锁不变 |
| 退出条件 | 正式店铺名称合同、历史保留期及批准后的历史清理/磁盘核对、真实组织、旧审批历史失效依据（如有）、生产最小 ACL/factory、旧目录认领及业务/设备验收仍待完成；合成 CAS 已验证额外重审次数，不代表实际人工等待耗时；范围汇总见 [TODOS](../TODOS.md) |

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

## 5. 初次交接验收包（历史时点）

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

## 6. 逐次交接记录（历史时点）

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

本小节记录 1.17 接收时的历史阶段，当前完成范围见页首状态表。

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

### 2026-10-07 质量 HTTP 候选形成

治理仓提交 `ab70d723bab73c9a9b3bcd4f20a3e6bc9ecbd740` 的 `30-开发-进行中/15-P2质量检查HTTP合同候选.md` 已形成 OpenAPI1.18.0 / 原字节 schema.v1.21 候选；仍为 DRAFT / NOT FROZEN / NOT EXPORTED / NOT INTAKE。新增五条质量路径：有界摘要、阶段样本分页、冻结、完整逐条提交及专属操作回执。现有 `publish|cancel|rollback` 查询枚举不扩张，产品消费锁继续使用1.17/1.21。规范及精确产物双哈希由治理候选和对应验证记录拥有。

响应采用精简当前摘要与完整条目分页，复用既有 IntakeEntry；`viewHash`及游标绑定候选/阶段/会话和当前质量状态。检查保持每阶段一次原子提交，最多5,000项；每项原因最多1,000 Unicode code points，HTTP body和数据库jsonb文本分别限制8 MiB。质量历史回执仅返回原操作、候选键、动作、阶段及当时状态；当前review权限撤销后原有效主体可恢复自身精简结果，不能读取原内部回执中的正文/检查原因或继续写入。注销/禁用/事实失效继续拒绝。这是对上节“撤权拒绝”的明确细分：新读写拒绝，原操作历史核对不续权。

产品接入必须补齐现有 `reason.length` 与code point语义差异、数据库写前字节门、精简回执投影、当前摘要/样本分页和状态一致性检查。治理候选的schema/容量测试不能冒充这些运行验收。下一门是审阅精确版本对后冻结、增加独立导出门并export/intake，再接实际质量HTTP与Main管理端。真实飞书、生产factory/ACL、初始目录治理、Mac/Windows现场验收仍各有未完成条件。

候选14项专项与 machine-contracts 通过，release前31项及264单元通过；完整命令因最后 npm audit 网络错误退出1，独立审计经现有系统代理补验通过、0漏洞，保留失败记录。OCR和最终核心/原生复审完成，三项响应约束缺陷及一处说明已修复，无剩余确认缺陷。产品运行输入未变，未将本候选的schema证据升级为HTTP或原生平台通过。


### 2026-10-07 质量 HTTP 冻结、接收与运行切片

用户已批准精确版本对。治理仓 `18297cf802b195d8ff4e9f625143e50bff169418` 冻结并导出 `cs-ai-c11-openapi-1.18.0-schema-1.21-18297cf802b1`，产品通过原 intake 接收并生成 233 个 runtime schema；仍为 VERIFIED_NOT_ACTIVATED。DDL 原字节不变，全部26条 migration 的 SQL/来源/校验和保持既有值。只更新 catalogue 的消费 provenance，不创建虚假的新增迁移；原账本无 SQL 升级验收已有 PG 回归。

五条质量路径已接入封闭管理 HTTP 插件。质量状态、抽样与事务仍由原模块拥有；新 access 模块只拥有有界 wire、完整条目分页、游标绑定及精简回执。实际合成 Excel→质量 HTTP→组织证据核验→发布→第二坐席 HTTP 读取原文已经贯通，审批 transport 仍为内存合成提供方。先前“内部质量服务准备”的证据保留其历史时点；当前流程测试已替换为真实质量 HTTP。

重点验收包括：0条样本显式初样提交、5,000条关键检查、Unicode原因保真、HTTP与数据库独立8MiB门、扩样历史不可修改、会话/权限/阶段/重启游标失效、原键未知提交恢复。已有迁移测试发现生成器会随新HTTP来源改写旧迁移头，已在生成所有者固定旧来源，并为相同DDL的完整前序目录补失败关闭判定。实际检查与审查结果记录在[本切片验收](../evidence/qa/content-intake-p2-quality-http/README.md)。

接续事项是 Main 持有候选/原操作键/逐条草稿，管理界面经最小 preload 提交意图，继续复用现有 ProductSession/ProductHttp、来源发现和API模块；真实飞书、生产factory/ACL、v2-active、外发、Mac/Windows现场证明仍不由本切片放行。

### 2026-10-07 Main 质量检查接线

Main 已通过实际 ProductHttp/ProductSession 消费冻结质量 HTTP，负责完整样本、人工草稿、会话隔离与原请求恢复。根探针复用现有隔离桥，API 测试不直接依赖桌面源码；通过实际冻结提交后主动丢响应，恢复同一个历史回执且无重复写，然后逐条检查并发布，由第二坐席读取原文。具体结果见[Main 质量验收](../evidence/qa/content-intake-p2-quality-main/README.md)。

下一管理界面仍须接上传/解析报告、来源确认、组织审批状态、质量人工检查、发布与回执；Main 生成操作键及候选键，不允许 renderer 提交身份/抽样参数/发布结论。界面只展示授权能力；API 每次复核。未恢复操作须可见且不能静默换键，关闭/退出须明确内存恢复范围。跨平台原生和真实飞书验证仍分别待办。


### 2026-10-07 管理上下文冻结、接收与最小运行切片

治理提交 `240ae98a47d8b9432559c298f60af6fdc9ba8c4e` 已冻结并导出 `cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8`，产品通过原接收器 intake。OpenAPI SHA-256 为 `ef4e6df57d9ba934827a2315329aea2e473e12e577441011b78b706243251d38`，DDL 为 `5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013`；状态仍为 VERIFIED_NOT_ACTIVATED。新增一条管理上下文 GET 与一个 schema，原81条路径、233个 schema 保持不变，现共234个 schema。

26段迁移原字节、来源及 checksum 均不变。修复连续多个 HTTP 合同共享完整 DDL 时的规划器误拒绝，仍拒绝部分前缀重复、不同DDL、重复合同身份与任何原段漂移；真实PG验证旧1.17/1.18账本均 COMPLETE、apply 空列表，账本不变。

管理上下文复用现有 discovery、source/authorize 和事务，不另建状态仓或 current 指针。有效产品会话且拥有 import 才可读取来源版本、本人身份与发布基线；内容锁后取得发布锁，事务结束前复核最早截止。该读不是授权或提交票据，receive 仍 CAS。实际HTTP→Main ProductSession→receive→解析候选已有合成验证，尚无新上传 UI。代码、测试与审查证据见[本切片验收](../evidence/qa/content-intake-p2-management-context/README.md)。

下一切片由 Main 持有原生文件、上传对象/操作键、解析任务与错误报告，Dashboard 只提交选择与确认意图，来源上下文和参与人目录从 API 获取；复用既有候选/审批/质量/发布界面。真实飞书、生产factory/ACL、v2-active与跨平台人工验收继续分别待办。


### 第一组店铺显示名差集（2026-10-08，候选，未冻结）

已冻结的 `IntakeSource.scope.shopId` 是稳定标识，没有可展示的店铺名称；不能把来源 ID、岗位或 fixture 映射当正式名称。商品/场景已经具备 `IntakeVocabularyList`，本轮直接实现其读取，不增加重复词表合同。

**当前候选：** 治理仓 OpenAPI 1.21.0/schema.v1.23 仍为 DRAFT，回收修复及冻结条件见[文末](#并行候选回收2026-10-08)。候选提供只读店铺目录，返回每条 `{shopId, displayName, displayVersion}` 及 `nextCursor`；`displayName` 非空、最多 256 字，缺失整次失败，重名仍可通过 ID 区分。目录需绑定当前产品会话和租户/app，限定当前有 query 授权的 shop 来源；品牌级授权不能自行展开全公司店铺。页面上限 100，游标与会话、完整目录修订和截止绑定，重命名、撤权或身份变化使旧游标失效。多来源同店必须给出一致名称版本。

选择独立只读目录而不是给每个 Source 重复塞名称，可避免同店跨来源名称漂移；Main 将其与当前有权店铺集合对齐，仅替换显示文案，查询和复制继续使用 shopId 和原 entitlement。不得让名称服务授予业务权限，也不新增 renderer 通用 HTTP 能力。

**进入实施前：** 治理仓明确组织目录名称的写入所有者、刷新时限/失败策略和字段版本，批准后 export → 产品仓版本化 intake/codegen → Main 显示接线。验收覆盖同名/更名/空名、跨租户、品牌授权、跨页目录变化、撤权/退出/过期；显示变化不改变 shopId。此条只是具体候选，不代表合同批准、真实组织数据接入或新 OpenAPI 版本已发布。当前继续清楚显示店铺编号。

## 7. 第三组：运行接入交接（2026-10-08，候选，未激活）

本组把已有“正式接入”待办细化为实施输入，不新增功能范围。核对基线为产品提交 `51a271b`，继续使用 OpenAPI 1.19.0 / schema.v1.21 与产品迁移 0029。以下是产品消费者要求及待治理的接入方案，不是正式配置、角色授权、真实租户验证或生产启用记录；当前批准及后续入口见[计划 §0.51](plans/2026-10-03-content-intake-requirements.md#051-原生组织观察离线消费验证2026-10-08)；后续受控只读字段观察见本节末尾，不等于运行接入验收。

### 主体映射与组织事实输入

已有登录链为 `feishu-identity-provider.exchange → product-auth-service.callback → backend_identity.complete_callback`。provider 返回 `open_id`，认证模块通过既有绑定签发产品会话；显示名只供显示，不能用 `usr_` 拼接、姓名或登录 owner 标签创建 P2 权限。[事务消费者](../apps/api/src/content-intake/transaction.ts)另从下列记录读组织事实，当前没有生产刷新写入者。

| 输入 / 写入所有者 | 当前消费者要求 | 接入交接要求与失败处理 |
| --- | --- | --- |
| 登录绑定 / 既有认证模块 | `principals.user_id` 唯一并引用已登记 `subject_bindings.user_id`；受保护调用须保留认证对象的私有会话引用 | 明确登录绑定与 principal 的可信对应关系；不从 renderer 接身份，不把克隆 DTO 当会话。未登记主体拒绝，登录成功不自动登记业务权限 |
| 同人关系 / 组织事实维护者 | `(tenant_id, app_id, identity_scope, person_key)` 唯一；关键审核按已确认同人关系排除贡献人 | 明确 ID 命名空间及跨账号归一依据；不能直接把不同应用标识认作同一人，也不能以姓名去重。只提供合成映射作开发输入，真实映射在获准环境登记 |
| 组织事实 / 独立刷新写入者（离线实验已验，生产未接线） | `principal_id/facts_version/department_ids/job_id/enabled/checked_at/valid_until/facts_digest`；部门 1–100 个，版本只增不改历史，当前指针由 principal 持有；有效期至多五分钟 | 职位来源方向已确认，见下方当前映射；正式部门/岗位映射版本、摘要规范与可信观察仍须明确。按既有内容锁原子追加事实及推进指针/撤销代际；失败不续期。当前到期/禁用拒绝消费及离线刷新实验，不代表生产原生观察或事件监听已实现 |
| 岗位规则 / 获准业务规则维护者 | 按 tenant/app、部门 ID 和精确 `job_id` 匹配 `role_rules`；多个不同角色匹配时不能选最高职级；策略版本单独 CAS | 提供经批准的部门/岗位映射。岗位能力上限、业务 grant、分配资格分开；不因“经理”等名称授予全公司范围 |
| 店铺/来源与业务权限 / 既有授权模块 | `scope` 与 `source` 显式登记，业务动作、分配资格及委派资格分别判断 | 提供获准范围、初始维护者及撤权/接管责任；有登录/岗位不等于有店铺 grant。店铺显示名另走已列合同候选，不阻塞稳定 ID 的合成验证 |

选择继续复用认证模块，并由独立组织事实写入者供给已有事务消费者；不把岗位刷新塞进每次登录，也不让每个业务入口自行查询飞书。这样登录会话、组织事实版本和内容事务仍各有唯一所有者。刷新写入的幂等/乱序合同及权限须在实施前明确，不能照搬合成 seed 的直接写表方式。

### 审批 transport 的精确交接

复用 [ApprovalTransport](../apps/api/src/content-intake/approval-adapter.ts) 三个方法及[合成提供方](../apps/api/tests/support/intake-approval.ts)，不增加客户端审批结论接口。以下字段是**内部规范化协议**；尚未验证飞书原生响应到这些字段的映射，不应当作原生 OpenAPI 请求样例。

| 方法 / 材料 | 必须保留的语义 | 未完成接入与拒绝条件 |
| --- | --- | --- |
| `create(binding, packageBytes, signal)` | 固定 tenant/app/definition/node、`createUuid`、审核包 SHA/长度；返回 `instanceCode/attachmentFileCode`。候选表单绑定 `reviewRequestId/key/packageSha256`，回退表单绑定 `reviewRequestId/rollbackPlanId/impactDigest/packageSha256` | 服务端配置须指定获准定义、人工节点和表单字段。实例已创建但响应丢失时沿原 UUID 恢复；不能仅在内存去重或更换 UUID。原生创建/恢复及附件上传尚未实现 |
| `instance(binding, signal)` | 精确回传绑定、表单、附件 fileCode 与状态；规范化状态为 PENDING/APPROVED/REJECTED/REVOKED。APPROVED 还须含指定节点 HUMAN task 与对应 PASS，task/person/time 一致 | 原生状态、撤回、转交、会签/多任务与时间单位必须显式映射。当前适配器只接受一个被绑定的人工决定和对应一条 PASS；不得从多条记录任取最后一次“通过”，也不得将未知状态映射成通过 |
| 审核人 / 历史资格 | `identityScope/personKey/taskId/endTime`；UTC ISO 时间须精确，决定不得早于固定包登记；历史资格和当前资格分别验证 | 原生审核人标识须通过已确认主体映射归一；关键稿排除全部贡献人。规范化通过不代替数据库的历史事实、独立性及提交点检查 |
| `attachment(fileCode, binding, signal)` | 输出 Buffer 流；实际长度等于 `packageBytes`、SHA 等于 `packageSha256`，受现有输出预算约束 | 用服务身份在获准租户取字节；fileCode 不等于临时下载 URL。原生上传后是否保持审核包原字节须实测；认证、下载权限、重定向与超时处理未由合成 transport 证明 |
| 失败与时限 | 适配器调用限时 30 秒并传 AbortSignal；证据所有者独占有效期与撤销传播 | 原生 I/O 实现还须真正响应取消、限制响应/附件字节，不能只有 Promise 超时。远程失败不推进事实截止；撤销后迟到 APPROVED 不得复活原证据 |

目前已验证错租户/实例/表单返回 `APPROVAL_BINDING`，自动通过或 task/timeline 不符返回 `HUMAN_REVIEW_REQUIRED`，换附件返回 `ATTACHMENT_UNVERIFIED`；缺 adapter 或依赖不可用不能发布。真实 API 的错误翻译、分页及租户认证是后续 transport 的验收项，不能用上述规范化模拟结果替代。

### 运行权限与装配候选

当前 [service](../apps/api/src/content-intake/service.ts) 只注入一个 pool；[管理 HTTP](../apps/api/src/content-intake/management-http.ts) 同时要求 `auth/pool/store`，审批与主体标签是服务端依赖。`requireProductSession: true` 由 HTTP 装配设置。生产 server 尚未注册 intake，不能靠新增环境变量自行变成可用服务。

| 用途边界（尚非已建数据库角色） | 源码所需操作 | 必须隔离或证明的边界 |
| --- | --- | --- |
| 组织事实 / 策略维护 | 追加主体事实、历史和版本指针；策略及授权由各自写入者维护 | 普通业务 pool 不能任意伪造身份事实、岗位或扩大维护资格；刷新失败/乱序不恢复已撤资格 |
| 管理与发布事务 | 来源/授权读取，候选/证据/质量/回退、永久回执及私有发布函数；共用内容锁和发布锁 | 不给 DDL/owner 权限；API 授权检查不能代替数据库运行角色验收。函数、触发器及跨 schema 依赖须纳入精确权限清单 |
| 解析与对象生命周期 | 输入/报告落盘、容量账本、任务收尾和候选冻结；终态收尾可能发生在主体失效后 | worker 不得因收尾需要获得授予权限或绕过发布门的能力；目录删除与历史回收权限分开，未知提交继续保护 |
| 坐席使用 | 签资格调用现有租约底座，并写 `entitlements/entitlement_scopes/entitlement_contexts`；分页读取有权目录 | 业务只读不等于数据库全程 SELECT；会话锁也须计入权限核对。不能给坐席通用候选/证据/发布写权限 |
| 运维容量核对 | `--group intake-objects --dsn ...` 使用只读事务核对账本 | 仅供获准环境；不取得历史删除、DDL 或业务发布权限，不等于完整磁盘核对 |

**实施前的具体差集：** 单一 service pool 尚未实现上表的连接用途隔离；所有新 schema 应用权限仍封闭。应先确定受限角色和可调用事务边界，再以追加迁移及实际非 owner 连接验证允许/拒绝矩阵。上表不是可执行 GRANT 清单，不承诺只需授几个表即可接入；尤其不能直接复用测试管理员 pool，也不能用 `GRANT ALL` 解决启动失败。

factory 的可验收输入为：获准环境标识、受限连接配置、受控对象目录、组织事实供应者、审批 route/transport、主体显示标签、来源模式及初始目录基线。配置、必要权限或目录基线缺失时不启用；审批暂不可用时不得替换成合成审批。连接、parser 与 transport 的关闭/取消职责须由 factory 明确接管，不把测试宿主的生命周期当生产实现。

### 旧目录认领与可复用验收

初始认领需要可核对的 `{baseReleaseId, legacyEntryKey, sourceId, businessEntryId, scope}` 映射清单及维护人确认；这是交接材料字段候选，尚不是已冻结 API。保留原版本字段、未认领成员和来源关系，不能按正文相同自动归属。首次承接、后续修改、正确范围的显式停用及中途失败均需验证；基线变化须重新核对。合成 seed 的空目录登记不是正式认领工具。

| 已有验证，可按内容指纹复用 | 证据位置 | 尚不能证明 |
| --- | --- | --- |
| 登录 owner 标签不授业务权；无范围、角色冲突、到期事实拒绝 | [事务测试](../apps/api/tests/content-intake.integration.test.ts) `ignores the login owner label`、`discovery: handles zero scope`；[实跑日志](../evidence/qa/content-intake-p2-capacity/api-postgres.log) | 原生组织同步、离职事件接收、乱序刷新写入器 |
| 未知创建沿原 UUID；错绑定、自动 PASS、附件替换拒绝；撤销终态 | 同一测试的 `workflow HTTP recovers an unknown provider creation`、`rejects forged instance/form bindings`、`keeps revoked evidence terminal`；同一实跑日志 | 飞书原生 task/timeline 翻译、真正网络恢复和附件权限 |
| 缺 bootstrap、同域旧成员未认领拒绝，current 不变 | 同一测试的 `refuses missing bootstrap and unmapped legacy-domain rows`；同一实跑日志 | 正式旧目录认领执行器或业务认领签收 |
| 新表/函数对现有应用角色封闭，迁移及 ACL 后验 | [数据库验收](../evidence/qa/content-intake-p2-capacity/README.md)及所链 PG 日志 | 生产最小角色已建、非 owner 全流程已通过 |

本组初始交接只核对源码、冻结合同和上述已运行证据；后续离线实验与单次只读观察分别见下文，未变化的功能测试不重跑。后续顺序：确认组织事实/审批的输入合同与用途权限方案 → 用合成原生响应和非 owner PG 连接完成离线实现 → 取得具体环境和真实输入授权后做受控联调。现场账号/拖动/整机断网继续按原安排；SOP/P3、历史删除和自动同步不进入本组。


### 2026-10-08 接续核对：原生输入与会话锁权限

治理工作树 `codex/content-intake-p2-contracts@240ae98` 干净；核对 `13-P2资料接入合同候选.md`、`2026-10-04_P2内容接入合同批准.md` 和 `2026-10-07_P2管理上下文合同批准.md`。批准只覆盖冻结合同及合成开发，明确未开放新应用 ACL、生产 factory、真实组织/审批与 active。产品消费锁仍是 1.19.0/schema1.21、VERIFIED_NOT_ACTIVATED。该离线实验阶段没有改治理仓或正式快照，也没有读取凭据/员工资料；后续单独获准的只读字段观察见下方，不能混用两阶段授权。

以下保留离线实验阶段的公开模型差异，并按官方接口说明补充时间类型；公开字段结构不是可信输入证明，SDK 类型也不能代替原生 wire 合同（2026-10-08 核对，非本项目冻结合同）。岗位来源的后续确认见下一小节：

| 输入 | 已核实的结构及与消费者的差异 | 进入正式映射前须明确 |
| --- | --- | --- |
| 组织 | [Contact User 模型](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/api/contact/v3/model/user.py) 有 open_id/user_id/union_id、department_ids、job_title、job_level_id、job_family_id，未列名为 job_id 的字段；不能把后三者任一直接等同本仓精确岗位键 | 岗位事实的权威来源和稳定标识、部门 ID 类型、同人归一命名空间及映射版本。若用自定义字段或人工映射，需要明确维护者与变更失效规则；姓名、登录角色和管理员标记均不授予业务权 |
| 启用状态/新鲜度 | [UserStatus 模型](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/api/contact/v3/model/user_status.py) 列出五个可选布尔字段；本仓需要明确 enabled 和至多五分钟的完整观察 | 明确缺字段、冻结/离职/未激活等组合的失败策略，以及观察起点、缓存、请求身份和失败不续期；字段模型本身不证明缓存与时间戳可信 |
| 审批实例 | [实例响应](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/api/approval/v4/model/get_instance_response_body.py) 有 approval_code/instance_code/uuid、字符串 form、task_list/timeline 及撤回关联；tenant/app 并非可直接照抄的响应字段 | tenant/app 由认证请求边界绑定；批准具体定义/节点、表单控件及完整附件字节取回协议；不将原生 JSON 直接作为内部规范化协议 |
| 人工决定 | [Task](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/api/approval/v4/model/instance_task.py) 有 id/node_id/custom_node_id/type/status、人员标识与时间模型；[Timeline](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/api/approval/v4/model/instance_timeline.py) 有 task_id/node_key/type/create_time 与人员标识 | [官方实例接口](https://open.feishu.cn/document/server-docs/approval-v4/instance/get)的原生 task/timeline 时间是毫秒时间戳字符串，不能从 SDK 的整数类型推断 wire 类型或单位。还须明确节点键对应、枚举及人工性依据，不能从字段名推断 HUMAN。转交、会签、多任务、撤回和重新提交须有确定策略；当前单个 HUMAN/PASS 消费者无法未经评审就自动挑最后一条通过 |

**受限权限的实际障碍：** `transaction.ts::lockProductSession` 对 sessions 和 subject_bindings 做 `FOR SHARE`。临时 PG15 证明 SELECT-only 账号被 42501 拒绝；只加 sessions 的 UPDATE 会在 subject_bindings 继续失败。为这两张表授予 `UPDATE(revoked_at)` / `UPDATE(enabled)` 虽能取锁，也允许反向撤销管理员停用。这是未启用的候选权限方案风险，不是声称线上已存在同样授权。现有 API 会回滚且不进入业务回调，外部结果为 INTERNAL_ERROR / COMMIT_UNKNOWN、commit=rolled_back；运维诊断保留 42501。运行 factory 应在启用前检查依赖，不能靠增权消除错误。

**两个边界方案：** A 给业务账号身份安全列 UPDATE；B 身份所有者提供固定查询的窄锁函数，仅返回原会话截止，业务账号仅 EXECUTE。选择 B 作为离线候选，隐藏身份表读取和锁权限；不去掉锁，也不复用认证 owner 池。`apps/api/experiments/intake-runtime/session-lock.sql` 仅由测试安装到一次性数据库的隔离 schema；NOLOGIN、非超级用户函数 owner 独占必要表权，函数固定 search_path、精确校验私有会话 hash+user、拒绝失效身份、持锁到调用事务结束并重验等待后的截止。私有 hash 必须由既有认证对象解析，不新增 HTTP 字段。调用方仍须遵守内容锁顺序及事务末尾最早截止校验。

[8 项实测及限制](../evidence/qa/intake-runtime-boundary/README.md)覆盖非 owner 调用、缺权拒绝、两表锁竞争、等待中到期及越权矩阵。SQL 不在 migration/生产构建中，现有 transaction 消费者未改接候选；不能据此声称完整坐席受限签发/分页、管理/worker 权限或生产装配完成。正式采用须先在身份合同所属治理仓审核函数语义、owner/执行角色与错误合同，冻结 export/intake 后再接线并验收完整用途矩阵。原生可信输入及初始旧目录认领仍按本节原有缺项办理，不新增业务 TODO。

### 职位来源与登录授权的当前映射（2026-10-08）

用户认可当次只读观察中的职位来源。观察范围、聚合及授权限制由[计划 §0.50](plans/2026-10-03-content-intake-requirements.md#050-职位来源确认与当前收尾范围2026-10-08)保存；本节只拥有技术映射，不登记真实人员或应用标识。当前选择通讯录用户职位与职务目录，不要求重建登录或另建应用；HR 尚未实查，不记为已验证来源。

| 来源与身份 | 可读取 / 现有行为 | 到内部事实的映射与剩余边界 |
| --- | --- | --- |
| 既有产品登录；用户 OAuth | `feishu-identity-provider` 授权请求为 `auth:user.id:read`；code 换用户 token，再取 `open_id` 与显示名 | 只建立已有登录绑定。显示名不授权；组织事实读取是同应用的独立应用身份能力，不要求把通讯录 scope 加进登录 URL。CLI 默认应用与目标应用不同，不能沿用其缺权结论 |
| [用户详情](https://open.feishu.cn/document/server-docs/contact-v3/user/get)；应用身份 | `open_id`、`department_ids`、`job_title`、`status`；对应用户基本/组织架构/受雇信息权限 | 使用明确 tenant/app/ID 类型的命名空间关联已登记 principal；部门 ID 类型保持一致，不跨应用复制 open_id，不以姓名去重。缺字段/禁用/不完整观察不产生新资格 |
| [职务列表](https://open.feishu.cn/document/contact-v3/job_title/list)；应用身份，`contact:job_title:readonly` | 分页目录的 `job_title_id/name/status` | 以原始 `user.job_title` 精确匹配唯一启用 `name`，取得稳定 `job_title_id`，作为内部精确 `job_id` 的映射输入。空值、无匹配、重复或停用均不能猜测；不模糊归类、不按职级取最高。正式映射版本、变更失效与完整分页观察仍须实现/治理 |
| 用户部门 ID 与[部门详情](https://open.feishu.cn/document/server-docs/contact-v3/department/get) | 当次可以读取 ID；部门名称查询仍缺 `contact:department.base:readonly` | 用户组织架构权限不等于部门名称权限；缺名称不推翻职位来源可行性，也不阻塞按 ID 的独立合成验证。名称不得由员工或岗位名臆造 |
| 内部岗位能力 / 店铺业务 grant | 现有 `role_rules` 与独立业务授权按新鲜事实分别判定 | 职务目录提供来源事实，不提供本产品角色或店铺范围。仍须业务批准精确规则、初始维护者、店铺/来源、动作及委派；用户对职位的认可不代替这些批准 |

当次读取成功不能证明持续观察的新鲜度或原子性。正式观察方仍须绑定请求身份、完整分页、观察起止及缓存策略；失败不续期，事实追加沿既有内容锁/CAS，组织变化按现有失效规则处理。不得把会话中查询到的真实人员改造成测试 fixture。当次观察时仍沿用常规自审/关键独立审的旧合同；用户后续已取消本期人工审批，以下最新决定优先，不再等待审批模板/节点。

### 原生组织观察离线切片（2026-10-08）

`apps/api/experiments/intake-organization/feishu-observer.ts` 已把原生形状的用户/职务响应映射到既有 writer 快照；仍无生产 transport、HTTP 或凭据读取。依据[官方职务接口](https://open.feishu.cn/document/contact-v3/job_title/list.md)，启用字段是布尔 `status`（修正此前文档中的 `is_enabled`），单页最多 50 条，接口频率上限为 10 次/分钟。当前只是注入合成响应，正式 transport 仍须落实限流、认证、网络字节预算及取消。

观察方固定 tenant/app，以已登记的 open_id→principal 绑定为受信输入；user_id_type 固定 open_id，部门类型固定 open_department_id。两次完整分页职务扫描及前后用户事实须一致，重复 ID/游标、超页数、缺失状态、职位空值/无匹配/重名/停用均不输出快照。岗位名不 trim、不做模糊匹配，姓名、管理员标记、职级与序列不授予业务权。五个用户状态字段须全部为布尔；未激活或冻结/离职/退出/未加入映射 enabled=false。只有字段完整且能确定唯一岗位时才写停用事实；若离职后 API 不再返回完整字段，则当前实现只能拒绝新观察并让旧事实在原截止失效，不能声称已接上即时离职事件。

观察开始时间来自服务端时钟，五分钟截止不从结束时刻重算；整个观察最多等待 180 秒，失败不输出部分材料。成功快照实际交由临时受限账号 writer 消费，重放/未知 COMMIT 继续保留原快照与预期版本，不重新观察后冒充重试。映射版本及职务目录摘要单独作为实验 provenance 返回，尚未持久化到正式事实合同。

两个边界方案中，选择由观察模块隐藏原生字段、分页和比对，writer 只接已有快照；不把网络字段和分页规则塞进数据库事务。两遍相等只能检测可观察变化，不能证明飞书跨页原子快照或缓存新鲜度；这仍是正式治理输入，不能靠加读次数消除。现有角色规则、grant、迁移和生产装配不变。实际命令、指纹与限制见[本切片证据](../evidence/qa/intake-organization/native-observer/README.md)。

### 用户最新权限与发布决定（2026-10-08）

客服总监、客服经理可直接配置权限，无需审批；客服总监、客服经理、客服主管、客服组长均可在负责范围上传Excel，并在弹窗二次确认后直接发布，无需人工审批。本期主管/组长不配置他人权限；普通客服查询复制。当前角色矩阵及并行安排见[计划§0.52](plans/2026-10-03-content-intake-requirements.md#052-四岗上传发布与剩余并行安排2026-10-08)。取消确认不发请求；二次确认不替代服务端当前权限、事实/会话有效期、材料版本/范围与发布冲突校验。上文组织审批与原生审批 transport 描述属于历史 approval-v1，不再是新候选流程；常规自检/关键独立判断的质量门仍保留。所属仓已承接版本化变更并由本仓 intake，不伪造审批通过。店铺/来源初始范围、正式用途权限和运行接入的剩余条件仍在。

### 确认直发候选与二次确认（2026-10-08）

产品 Main 的原生二次确认已完成：默认取消、请求冻结、取消保留表单、迟到确认拒绝、未知操作恢复不重复确认，未新增 IPC 或改写旧 HTTP wire。[验证记录](../evidence/qa/intake-publication-confirmation/README.md)包含完整检查与实际 Electron/HTTP/PG 合成闭环；原生弹窗响应受控，不是人工设备勾选。

治理仓 `codex/content-intake-p2-contracts@6f318d448929d1a87c5dc9e725ea4f90c48a4b97` 已按用户对精确候选的批准冻结、导出；产品消费 `cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929`，状态 VERIFIED_NOT_ACTIVATED。OpenAPI 1.20.0 SHA-256 `1513fe499773c83f4a2b9f0ca8e3a5f7369638f72dc1d18a291235093cfc034d`；schema.v1.22 SHA-256 `c5e4896e8ed1ff587e23a70723bd9d81c056ba65561cd9d94963aa6b5f1ae3ce`，均为获批原字节。治理 38 步 test:release 实际通过。冻结文档中的 NOT EXPORTED/NOT INTAKE 是冻结时刻声明，当前消费状态以产品锁和本记录为准。

产品保留 `0030` 两岗配置、四岗业务上限及历史 grant；新增 `0031` 冻结增量、`0032` 直发存储，前 30 段保持不变。新候选和显式修订为 direct-v1，发布/回退要求 confirmed=true，拒绝旧审批版本；四个审批写接口返回 MODE_CONFLICT，不生成审批事实。Main 原生确认默认取消，确认后重验会话、权限和取消代际；来源、人工质量、范围、CAS、最终截止和永久操作回执保留。

历史 approval-v1 不改写：旧未发布候选先显式修订；旧未知发布/回退只查原回执；混合发布继承旧谱系时仍受其审批到期/撤销限制。使用读取同时检查来源模式/映射、确认与已发布材料，不能借直发复活失效旧资料。完整实际 Electron/HTTP/PG 合成证据见[本次直发验证](../evidence/qa/intake-direct-publication/README.md)。

生产 app/server/factory、正式受限账号和真实组织刷新尚未接入，消费锁 runtime/Ddev 仍为 false；没有生产激活或真实范围认领。剩余条件在[计划 §0.53](plans/2026-10-03-content-intake-requirements.md#053-角色上限与直发候选2026-10-08)，完整 `/review` 的 INCOMPLETE 不变。

### 并行候选回收（2026-10-08）

A/B 已按原提交加追加修复接收到产品实验目录，C 只接收到治理候选；精确提交与实际验证见[回收记录](../evidence/qa/intake-parallel-recovery/README.md)。这些工作不改变当前已消费的 OpenAPI 1.20.0/schema.v1.22 或正式应用 ACL。

- **组织可信输入：** 固定回环 HTTP 已接原 observer/writer/资格消费者，拥有限流、字节/时间预算、取消和请求释放；未知提交重放原快照。后续候选已加入同应用 open_id 版本化登记、原子撤销及映射版本/目录摘要/观察截止的同事务持久化，未知提交重放原观察；共享 token owner 按租户/app 隔离签发代次和限流。候选将每次目录扫描限定为最多五页、每页 50 条，超限直接拒绝；共享配额不足也不排队或无限重试。正式 token 供应、可信登记来源、新鲜度及容量方案仍待所属仓治理。组织专项的 usage 消费使用 harness 管理池，受限 usage 的实际验证见 B，不混算两个环境。
- **用途权限/装配：** 四个 LOGIN 用途与一个 NOLOGIN 属主只在一次性 PG 中安装，窄会话锁及必要函数 EXECUTE 已有允许/拒绝证据；后续 `consumer-acl.sql` 与精确会话锁适配已由真实 service 消费，覆盖 multipart 上传、解析、质量/授权写入、确认发布/回退、另一主体非空分页/复制资格、撤权及历史审批失效。service 可选 `terminalPool` 仅用于失败收尾和 report 容量，默认原池；容量 COMMIT 未知不回滚或释放占用。旧 SQL 探针仍保留其原证据，不承担新业务实现；原生剪贴板不在本轮验证内。缺认领时依赖检查仍不启用，池由调用方关闭。正式 transaction/factory/ACL 尚未接线，候选须经所属仓治理/intake，不能直接装入生产。
- **店铺名称：** 治理 OpenAPI 1.21.0/schema.v1.23 为 DRAFT，独立只读目录不改变授权范围。回收修复游标 session hash 外泄与篡改，使用独立服务端私有签名 key；补等待后截止、名称字符一致性、维护人停用拒绝。后续草稿补受控登记资格、维护人 CAS/撤销/轮换与不可改历史，私有 key 注入/撤销/轮换按 keyId/version 派生游标签名；可信 consumer 按全局内容锁→实际会话→目录操作→最终截止→COMMIT 执行。登记者与名称维护人都须当前唯一映射为总监/经理，再分别叠加显式 registrar/steward 范围；岗位本身不授予全租户目录权，换岗或停用后拒绝写入。真实维护人/登记责任范围、密钥托管及精确版本批准仍是正式采用条件；候选通过不等于冻结、export/intake 或产品名称消费者接线。

当前追加补齐的提交、实际验证及局限见[第二轮回收](../evidence/qa/intake-parallel-recovery/runtime-completion/README.md)。上述剩余部分沿用既有“正式接入”和“店铺名称”事项，不增加业务范围。原角色 15/15 审核不重跑；完整外部 `/review` 仍为 INCOMPLETE。

### 内容管理权限配置与正式交付工具增量（2026-10-08）

权限配置属于用户既有需求，本轮没有新增角色或合同。界面沿用内容管理局部“资料 / 权限配置”切换；总监、经理只能在当前分配资格内选择已确认的具名主体并配置 business 动作，不提供根 allocation、delegation 或接管新界面。普通客服仍只有 query 上限，原 grant 历史不删除。

服务复用 OpenAPI 1.20 已冻结的 `GET/POST /v1/intake/grants`、`POST /v1/intake/grants/preview` 和 `PATCH /v1/intake/grants/{grantId}`。原 authority 拥有批量校验和保存/撤销，预览共用校验且不写数据库；discovery 列表在扫描前限制当前可管理范围。HTTP plugin 注入 management 唯一 service。主体目录 `purpose=grant-recipient` 与 authorization 共同提供短期界面选择，不能把目录可见或预览成功当成已生效授权。

Main 拥有选择句柄、会话和到期代际、原预览/写请求及未知提交恢复；Dashboard 独立 preload 只开放 permissions current/command/invalidated 窄能力。姓名隐藏或过期不会泄露隐藏人员资料，已有可管理授权仍可凭记录编号、范围、时间与原原因核对后撤销。详细使用方法与模块位置见[开发指南](how-to-develop-content-intake.md#p2-内容管理内的权限配置)。定向 HTTP/PG 与桌面单元/组件证据已取得；本次权限 Electron 已在主集成通过具名总监预览取消、保存生效和撤销拒绝新资格；经理不冒称独立实跑，也不重复旧角色 15/15 审核。

用途能力候选现已超出原离线 probe：显式 purpose-candidate 宿主使用环境 LOGIN→NOLOGIN capability 及候选安装账本校验，实际四域 HTTP 和 Mac FAQ/回退 Electron 的证据见[本轮发布验收](../evidence/qa/intake-release-acceptance/README.md)。其中原生文件读写、报告回读和系统剪贴板发生；组织池只预检、对话框响应受控，不能推断真实组织写入、人工设备操作或四套桌面界面验收。生产配置/账号、旧目录认领和真实店铺名单没有由合成通过自动补齐。

正式交付工具已支持 `customer-agent-contract-set/v2`。九件 runtime 伴随产物为安装清单、roles、organization、session、purpose ACL、directory ACL、directory 存储、provenance 和 protocol；与 manifest/OpenAPI/DDL 合计十二件。产品接收器按封闭成员集合、固定来源路径、Git blob/摘要及安装关联核验，再生成 `runtime_sources`，不把任意输入当执行脚本。主集成的合成出口→接收往返已验证十二件及九个来源记录，证明工具互通，未对真实候选执行冻结/export/intake。

OpenAPI 1.21.0/schema.v1.23 仍是 DRAFT；精确字节、最终 release 结果及正式采用条件由治理候选拥有，此处不预写尚未确认的 hash。当前正式消费仍为 OpenAPI 1.20.0/schema.v1.22、VERIFIED_NOT_ACTIVATED，32 段 migration 和 runtime/Ddev 未激活状态不变。下一步是在既有事项内完成精确候选批准与实际版本化交付，再按真实范围和环境条件接入；不增加审批流程、自动同步、历史删除或新的业务范围。完整外部 `/review` 保持 INCOMPLETE。

本轮组合候选已在治理本地提交 `6a25304`（来源 `1b91751`），最终稳定输入完整 test:release 41/41、PG253、合同/出口7与旧direct7通过；OpenAPI 1.21 SHA `bde5124df711333e6860c0cea1734f47fe5c45c95b56c0d5cde3d2e9466246d7`，schema1.23 SHA `4c2969459265262fabfe38ae425ab8c1275c46274d03ae09ec39b75ae9cc978e`，installation SHA `1683c487d6dc84e84b44d9f2a80ca9ab9cfb941144ace8d3b2cf7f520bb58486`。全部保持 DRAFT；实际冻结/export/intake 尚未发生。产品集成回收、两项恢复/接收缺陷的修复和精确下一决定见[三线收尾](../evidence/qa/intake-parallel-recovery/three-part-completion/README.md)。
