# P1 权限、审批与导入合同差集

> 2026-10-04 · P1 合成验证提案。授权与执行状态只在[需求计划 §0.1](plans/2026-10-03-content-intake-requirements.md)维护。本页不修改冻结合同，不构成正式 intake、运行激活或真实数据批准。

## 1. P1 三方基线及实际差异（2026-10-04 历史快照）

| 对象 | 已核对事实 |
| --- | --- |
| 产品消费锁 | `cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534`；OpenAPI SHA `39f69edfdbffcad6a57d3e9fc43e1f6a3cbdc1e8fdd951e30bdbbfe97eb3e394`；DDL SHA `5713f80e9abfd72592ad49955efb83cd8498ce9cd6c7be52b96c57bcde836caa` |
| 治理仓 export 实物 | `cs-ai-c11-openapi-1.15.0-schema-1.19-34a958e8193c`；来源 commit `34a958e8193c5b78e6ea736fdfed574d88094eb0`；OpenAPI SHA `ab328c09293df5b534594f46469381b312f8aa3644fab214ac7278fe4f91435e`；DDL SHA `7bfa432637b8fcf07668e3c308cd00616869097c04d6951944dbdc26f2a61a34` |
| 实物核验 | 治理仓 ignored `output/customer-agent-contract-sets/<id>/` 的 manifest、字节数、双哈希与指定 Git blob 一致。未复制进本仓 upstream，未运行 intake。治理说明仍有 `NOT EXPORTED` 旧字样，不能据此否认实际导出，也不能把 export 视为 intake |
| 当前产品代码 | API `content-release-service.ts` 的 `run` 先拒绝非 owner；桌面 `contentPublishGate` 同样 owner-only。导入允许 coach/owner；身份只有 agent/coach/owner，尚无本次店铺与委派模型 |
| 1.15.0 实际增量 | 对比解析后的所有 HTTP operation，仅 `POST /v1/content/publish` 改变：coach/owner；coach 只发 product/campaign 且标题/正文不能含过敏或赔付。DDL 替换 `publish_content_release` 对应校验，回滚仍 owner-only；旧域整体替换、quality gate、dual-review 和现有 payload 不变 |

| 动作/资源 | 当前 1.14.0 | 1.15.0 export | 本需求尚缺的合同 |
| --- | --- | --- | --- |
| 当前店查询 | agent/coach/owner；平台/商品上下文 | 不变 | 必填授权 shopId、上下文代际、同题家族/品牌强制、历史 SOP 使用资格 |
| 内容/草稿读取与上传 | coach/owner；batch/来源绑定；本地先预览 | 不变 | 能力与品牌/店铺/域/来源范围；草稿读也须授权；候选与解析任务分离 |
| 来源/映射/模板/词项 | 现有 source version/binding，非本次登记模型 | 不变 | 权威源登记、固定模板版本、不可变义词项、来源确认独立证据 |
| 组织岗位/人员授权 | 登录身份与固定 actor role | 不变 | tenant/app/稳定主体，部门+精确岗位上限，人工多店范围，分配资格与业务权分离，接管/撤权代际 |
| 审核 | 既有 review/quality 记录；worker 组织声明不是飞书人工证明 | 不变，仍不绕过 dual-review | 飞书实例/人工任务/动态、完整附件字节、贡献人及历史/当前审核资格、事实有效期 |
| 发布 | owner；`import_batch_id,title,summary` | coach 只限上述两个域/低风险 | 候选版本/摘要、证据版本、一次票据、实际影响范围；常规自审与关键他审需要正式协调旧 dual-review 约束，不能只改 UI |
| 取消 | batch cancel；桌面旧 actor-wide 清理 | 不变 | 本地 jobId+generation 和候选 id+version 的精准取消；提交未知先核对 |
| 回退 | owner；全目录 target release / previous | 不变 | 全影响集授权、受限来源纠正候选、撤销内容不可复活 |
| 发布与租约 | current/announce/ACK/快照底座 | 不变 | 来源合并保留缺行、统一 FAQ/SOP/媒体、审批谱系撤销、组织/审批最早截止、新旧写实际影响集 |

**治理次序：** 本页差集 → 治理仓规范与 OpenAPI/DDL 成对版本化批准、生成、校验、不可变 export → 产品仓明确 intake 范围 → 校验来源 SHA/manifest/双哈希 → 生成合同/追加 migration → API 权威判定 → Main/preload 窄接线。1.15.0 可以是前序增量，单独接收它也不足以完成新业务矩阵；不要手改 upstream 或让本地实验类型成为正式 wire schema。

## 2. M1 规则与合同字段

具体岗位矩阵以计划 §12.1 为唯一业务真源。实验 `permissions.ts` 验证下列交集：

`身份事实有效 ∩ 精确部门/岗位能力上限 ∩ 显式业务 grant(action, scope, time)`。

- 主体键：内部 principal；外部身份以 tenant/app/idType/externalId 映射。personKey 只在已证明的同人范围内归一；冲突拒绝关键审核。部门/职位不是身份，也不自动给予店铺范围。
- 范围：tenant、app、brand、shop（null 表品牌通用，**不是所有店的通配符**）、domain、source（null 明确表示该店/域内全部来源，非缺失事实）。管理多店用多个明确范围；若需团队管理，由服务端将获准团队解析为版本化范围快照，不能信任文件或 renderer 自报。
- 业务动作：query、content-manage、import、source-confirm、review、publish、candidate-cancel、rollback；凭据/映射配置不属于该集合。角色是上限，默认包也必须落成显式授权。
- Grant/Delegation：id、issuer、recipient、action、scope、startsAt/expiresAt、reason、version、revocation、steward。实验以一个动作和范围为独立授权记录；多选是多条记录的业务批次，正式批次事务另行 intake。分配资格不会增加本人的业务能力；资格不可递归转授。授出动作/范围/期限必须被自己的分配授权完整覆盖；禁止给自己或同人的其他身份提权。
- 撤销分配资格不级联删除下游有效业务 grant；保留原签发者与范围，移交负责人。无人接管进入待接管队列，冻结新的分配；受控运维仍可审计撤销。被授权人离职、禁用、业务撤权或到期独立失效。
- 组织事实有效期初值 5 分钟。checkedAt 不得在未来；过期/未知/刷新失败不产生新写或新资格。事件只触发读取当前事实，不以旧事件恢复禁用；提交点核对事实版本、撤权代际及 grant 有效期。历史资格必须有持久事实，不用当前角色反推过去。

本轮没有成员持久表、岗位适配器或授权管理 API。实验中的 transition 是纯模型；真实撤权与发布、并发授权、乱序事件防回滚仍须 PG/adapter 层证明。

审查后比较了两个接管边界：A 在多动作/多范围记录内再维护部分接管映射；B 使用单动作/单范围记录，以批次表达多选。采用 B：一条记录只有一个负责人和版本，撤销 A 店发布资格不会改变 B 店或 A 店查询权的负责人；避免调用方同时理解范围交集和部分覆盖优先级。业务矩阵不变，此形状仍是待批准的合成模型。

## 3. 候选、材料与人工证据

M3 任务：`reading → parsing → validated | failed | cancelled`。M4 持久候选：`awaiting-evidence → ready → publishing → published`；取消/材料或资格失效分别进入 `cancelled/invalidated`。未知提交保持核对态，不自动换 operationId 重发。

材料摘要完整清单以计划 E2 为准：规范内容/差异/分配版本、业务及问法 ID、选择页、模板/规则/mapping、来源声明与文件指纹、租户/应用/品牌/店/域、词项版本与时间条件、媒体摘要/必要性/说明、贡献人、风险与 baseReleaseId。审批实例/task ID、核验时刻、readiness、operationId 不进入材料摘要。实验复用现有 test-support JCS/SHA helper，使用独立 `candidate-p1.1` 前缀；它不替换正式 governance hash，仅对本轮 FAQ 材料子集做绑定验证。

首次来源确认、人工审批证据只推进 readiness，不改版本/摘要；改变材料才重建候选并重审。来源确认有独立 candidate/version/digest/sourceId 与证据版本/代际；签票和提交都核对当前确认，不能以 ready 状态替代确认事实。候选必须绑定单个登记来源，`scope.source` 与 `source.id` 相同且非空；grant 的全来源范围不能进入候选材料。候选模块从完整旧/新服务端快照自行计算差异和风险，不接受另报的差异省略关键变更。不同候选等待审批互不占据旧 import 在途槽位。正式发布请求应绑定 `{candidateId,version,digest,baseReleaseId,evidenceVersion,operationId}`；票据由服务端内部持有，renderer 不自签。

飞书原生审批的读取必须来自 API 的认证适配器；本地 fixture 不代表租户验收：

1. 固定租户/应用、definitionCode、表单字段 ID、审核节点 ID；服务端保存创建 uuid、reviewRequestId、候选绑定、审核包 SHA、fileCode 和返回 instanceCode。丢响应按原 uuid 查询，不换 uuid。
2. 详情的 `status=APPROVED` 只是必要条件。核验人工 `task_list`：非空 id/open_id、匹配 node_id、AND/OR/SEQUENTIAL、APPROVED、有效 end_time；同身份/task 的 PASS timeline 必须存在。AUTO_PASS/AUTO_REJECT、错误节点、截图和表格标签无效。
3. 实际审核人映射到内部 principal，审核时和发布时都具备 review 范围。常规允许自审；关键变更排除全部贡献人及同人别名，并需未参与声明。人工声明不能证明隐藏的协作编辑不存在。
4. **附件差集：** 官方详情 `attachmentV2.value` 返回临时地址，文档说明有效期 12 小时；不是上传 fileCode。未来 adapter 需通过受控、限制大小/重定向/出站目标的下载，核对完整返回附件字节 SHA 与原审核包 SHA，且绑定实例/表单引用/核验时刻。实验只消费合成字节核验事实，不请求地址；真实附件大小、渲染保真和节点配置仍待获准租户探针。
5. 关键风险取前后差异最高值；删关键词不能降级既有关键条目。关键词分别匹配每个字段，不能把前后版本或标题/正文拼成一个词。单候选已有条目由启用变停用≥2，或同 source 的 UTC 滚动 24h 累计≥2，升级他审；新建即停用不减少已发布的可用内容，不计下架次数。不声称防跨来源拆分。过敏正文必须同时含停手/确认，标题不能代替正文。
6. 锁外主动核验后签发至多 60 秒的一次票据，截止同时受发布人/审核人的组织与业务授权、审批和附件事实限制。锁内重新核验发布人与审核人版本/撤权代际及当前权限、候选/审批/来源确认证据代际、baseReleaseId、票据有效期。事务内不做 HTTP；锁等待/事务预算须明显短于票据有效期。
7. 远程撤回先发生且已观测：拒绝提交。提交先发生、撤回后到：按谱系使受影响整份 release 不可用；漏事件与连续刷新失败仍受最后成功核验后 5 分钟上界。新资格的 deadline 取组织、所有依赖审批、内容、最大 lease 的最早者；失败不续期。实验验证判定和时限，**没有证明 PG 原子性、真实传播时限或零窗口撤销**。

## 4. 待批准的窄 IPC/API 交接表

以下是能力形状提案，不是已存在的端点名。正式 URL/channel 由下一合同版本拥有。D=仅 Dashboard main-frame+可信 sender；Q/S=Query/SOP 各自白名单 main-frame。主体仅从会话取得，禁止 payload userId、任意 path/channel/invoke。所有写请求带 operationId、资源版本/基线；取消和审批结果未知时保留原键查询。

| 能力 | 输入 → 输出 | 闸门/副作用与主要失败 |
| --- | --- | --- |
| 来源列表/登记/确认 | cursor/scope；登记事实或 sourceId/version/证明 → 脱敏来源/确认版本 | D；content-manage/source-confirm；来源版本 CAS，SCOPE_DENIED/SOURCE_ORDER_UNKNOWN |
| 模板下载/编号建议 | sourceId/templateVersion；缺编号报告 → 受控下载/建议清单 | D；管理范围；不代写业务原文，不成为候选，TEMPLATE_VERSION |
| 词项读取/更名/新建/停用 | sourceId/id/version/display → 有版本词项 | D；管理范围；变义新 ID、已引用禁停，VOCABULARY_IN_USE/MEANING_CHANGED |
| 委派预览/提交 | recipientPrincipalId/actions/scopes/期限/原因/version → 增减预览/记录 | D；分配资格；recipient 是管理目标不是会话主体，ROLE_CEILING/GRANT_AUTHORITY_DENIED |
| 业务撤权/资格撤权/接管 | grantId/version、动作类别、接管目标 → 影响范围/新版本 | D；对应范围管理资格；禁自提权，NO_STEWARD/PERMISSION_CHANGED |
| 解析/报告 | sourceId/templateVersion/有限 bytes、job generation → 规范预览/问题/排除计数/受控报告引用 | D；import；文件不授权，任何阻断整批失败；不暴露原生路径 |
| 取消本地读取 | jobId/generation → cancelled/already-finished | D；同一原生任务；杀进程后释放，不清其他候选 |
| 接收/候选恢复 | sourceId/objectId/baseReleaseId；candidateId/version → 服务端独立复算材料/差异/readiness | D；管理范围；不信 rows/hash；EMPTY_DATA/BASE_CHANGED |
| 送审/状态核验 | candidateId/version → 固定审批入口/状态/失败原因 | D；review/publish 分开；无合格审核人不建无效实例；审批不就绪仍可保存稿 |
| 发布/结果读取 | candidateId/version/digest/baseReleaseId/evidenceVersion/operationId → 唯一 release 回执/unknown | D；publish+全影响范围；原子 candidate/release/公告/幂等，票据只在服务端 |
| 取消候选 | candidateId/version/operationId → cancelled/ALREADY_PUBLISHED/unknown | D；candidate-cancel；严格限定候选；提交竞争由 DB 决定 |
| 回退预览/提交 | target release/current base/operationId → 来源影响集/新回执 | D；rollback 覆盖全部变化；受限范围走纠正候选 |
| 查询/SOP 使用资格 | shopId/product/scenario/platform/contextGeneration → 同版授权集合/有效截止 | Q/S；query；切店隔离旧动作，零店拒绝，LEASE_EXPIRED/APPROVAL_REVOKED |

Main 必须核对 session epoch，preload 独立入口内联 channel，不能引入 shared chunk。媒体和审核包由受控对象存储拥有，解析器只产生元数据；renderer 仅受控引用。API 与 Main 同版本 policy，API 从接收对象独立复算。当前 owner-only、旧 IPC 与 `runtime_activated=false` 未变。

## 5. 失败、恢复与副作用

| 失败族（提案 reason） | 下一步 | 允许副作用 |
| --- | --- | --- |
| ORG_FACTS_UNAVAILABLE / PERMISSION_CHANGED / SCOPE_DENIED / ROLE_CEILING | 刷新事实或联系范围/岗位责任人；不扩大权限 | 诊断/审计；无业务写入；旧资格仅至原截止 |
| GRANT_AUTHORITY_DENIED / SELF_ESCALATION / REDELEGATION_DENIED / NO_STEWARD | 核对委派范围/期限或受控接管 | 不发新授权；保留下游有效业务权 |
| FILE_TOO_LARGE / EXPANDED_LIMIT / ZIP_ENTRY_LIMIT / COORDINATE_LIMIT / CELL_LIMIT / CELL_TEXT_LIMIT | 按模板缩小、修复或拆分登记来源 | 失败报告；不生成半个可发布候选 |
| INVALID_XLSX / INVALID_ZIP_XML / ACTIVE_CONTENT / EXTERNAL_RESOURCE / UNRESOLVED_MEDIA | 重新导出纯规范表、补齐必要文字/媒体 | 不执行、不联网；不显示“未连接飞书” |
| REQUIRED / DUPLICATE_ID / SOURCE_MISMATCH / HEADER_MISMATCH / EMPTY_DATA | 按表/行/列整批修正重传 | 原发布目录保持；缺行不能推断删除 |
| BUSY / CANCELLED / TIMEOUT / PROCESS_FAILURE | 等当前任务退出、重新读取 | 只清当前子进程；不取消其他候选 |
| SOURCE_ORDER_UNKNOWN / AWAITING_APPROVAL / APPROVAL_UNAVAILABLE | 补来源证据或按原 uuid 核对审批 | 可保存有效稿；不得发布 |
| HUMAN_REVIEW_REQUIRED / APPROVAL_BINDING / APPROVAL_FORM / ATTACHMENT_UNVERIFIED | 修配置/身份/附件并重新核验，必要时重审 | 旧材料证据不冒充新审批 |
| MATERIAL_CHANGED / BASE_CHANGED / APPROVAL_CHANGED / APPROVAL_REVOKED | 重建候选重审，撤回发布发纠正候选 | 不复活旧审批/撤销内容 |
| TICKET_EXPIRED / TICKET_CONSUMED / IDEMPOTENCY_CONFLICT / COMMIT_UNKNOWN | 原 operation 查结果；明确未提交才重签票据；基线变则重审 | unknown 对象受保护，禁止重复发布和清理 |

沿用现有 error.code/reason → UI 恢复动作模式，不另建错误 SDK。上表是正式差集；实验仅实现其中与 P1 探针有关的分支。

## 6. P2 进入与退出条件

正式合同字段、事务和验收材料已整理为 [P2 交接](reference-content-intake-p2-contract-handoff.md)。P2 合同现已冻结、从精确提交 export 并由产品 intake；本页保留 P1 原始差集，不将合同接收写成 FAQ 运行能力完成。当前授权见需求计划 §0.5，三方公开交付 EVD 仍待齐。

- 先完成上述正式合同协调，特别是新能力矩阵与旧 coach/owner、dual-review、域整体替换三处冲突；intake 后才能接 API/DB/Main，不能只开发布按钮。
- FAQ 切片：标准文件→服务端独立复算→持久候选→合成人工证据→原子发布→第二坐席当前店查询/复制；新增/修改/显式停用/缺行保留/纠正回退均有结果。统一快照包含空 SOP 集合，不能回落 Demo 树。
- 补 PG 双会话：撤权/发布、取消/发布、同 base 竞争、mode 启用/旧域写；永久候选发布唯一关联和响应未知/超过 24h 重试；实际影响集覆盖回退与混合来源。
- 补 API/IPC 失败闭环、跨人接手、窄 preload 打包、实际隔离进程；Electron Main 和目标系统 RSS/取消/出站边界单独测，不把 Node 探针当设备证据。
- G01–G31 按原测试计划分层落实。本轮纯模型/进程/实物证据不将整组 DB/E2E 标为通过。目标服务赋能师/管理者合同验收、非开发维护人编号回填/新增修改停用修错演练、两个无关来源的 CAS 重审成本是 P2 退出条件。
- 真实 B 最新版/维护人、租户组织字段/可见范围、审批定义/人工节点/附件保真、安装设备仍是后续现场输入；不重新询问已确认业务规则。真实接入、SOP（P3）、试点（P4）各自授权。

公开依据（2026-10-04 查询）：[ExcelJS](https://github.com/exceljs/exceljs)、[飞书实例详情](https://open.feishu.cn/document/server-docs/approval-v4/instance/get)、[创建实例](https://open.feishu.cn/document/server-docs/approval-v4/instance/create)、[组织用户信息](https://open.feishu.cn/document/server-docs/contact-v3/user/get)。实际租户权限、附件预算和管理员定义没有调用或验证。
