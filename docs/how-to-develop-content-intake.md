# 如何验证合成资料导入

本入口验证已授权的合成开发，不读真实工作簿、员工或飞书凭据。P1 探针不启动桌面/API/数据库；下方 P2 命令启动独立 Unix socket PostgreSQL，退出后移除该临时集群。FAQ 原生文件选择、参与人确认、上传校验、报告保存、合成审批发布与坐席查询已接通；真实审批 transport、原生设备人工验收及正式运行接入仍待完成。

## 运行

沿项目要求使用 Node 24.x、pnpm 11.19.0，依赖缺失时执行 `pnpm install --frozen-lockfile`。

```sh
pnpm test:content-intake:p1
pnpm content:intake:probe
```

第一条覆盖 API experiments 权限/审批模型和共享解析包的格式、限制、子进程生命周期。第二条实际生成 `.gstack/content-intake-p1/valid.xlsx`、`missing-c3.xlsx`、`issues.xlsx` 和 `probe.json`；重新从磁盘打开、解析、核对坐标与摘要，不以退出 0 代替验收。可指定不同输出目录：`pnpm --filter @customer-agent/content-intake probe /absolute/owned/output`。目录应为本次专用输出，命令会替换同名探针文件。

固定样例含来源页、`faq-p1.1`、非活动域、合法稳定 ID/启停、空相似问法页；有效样例两条合成话术，保留 C2 中文换行；无效样例只清 C3，因此恰好一个 `FAQ!C3 REQUIRED`。错误报告正文为纯字符串单元格，不生成 Excel 公式。

ZIP 前检逐条约束展开量、局部/中央文件名一致和规范 ASCII 内部部件名，拒绝 Unicode 路径别名、点路径、重复行/单元格及超界列定义；中文表名和单元格内容不受 ASCII 部件名限制。所选页背景图、绘图引用和图片统一阻断，避免 ExcelJS 忽略未支持对象。此限定适用于本轮生成的统一模板；未验证任意第三方导出器的内部 ZIP 命名兼容性。

## 所有者与复用

- `packages/content-intake`：ExcelJS 4.4.0（MIT）、yauzl 3.4.0（MIT）、saxes 6.0.0（ISC），固定模板及错误坐标、前置预算、模板/报告实物与子进程生命周期。没有通用列映射或客户原表兼容分支。
- `apps/api/experiments/content-intake-p1`：权限交集、委派模型、候选材料、风险与人工证据/提交点判定。复用已有 test-support JCS/SHA；不进 API dist、不注册 HTTP、不增加数据库权限。
- P2 `apps/api/src/content-intake` 复用正式 validator、对象存储与该解析包，当前消费者是隔离实库执行器；生产 app/HTTP/Main 尚未注册新路径。

## P2 权限与持久候选事务

```sh
CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin pnpm --filter @customer-agent/api test:intake:transactions
```

命令使用合成主体、来源和真实生成的 XLSX，执行权限交集、批量授予、撤权保留下游、原始操作键恢复、候选冻结/修订/取消与错误报告回读。数据库安装账户只供该临时测试集群；不得把它接到 API 启动配置。正式运行角色仍无 `content_intake` schema 权限。

服务接口只接收已验证会话和 objectId，不接文件路径、远程 URL、客户端 rows/digest 或 renderer 身份。根 allocation、身份事实、来源/词项及接收对象由测试受控登记；相关正式运维与上传 HTTP 接线仍待后续。当前任务回执复用 `backend_review.receipts` 的独立 `intake:` 命名空间，候选不依赖 24h HTTP 缓存。永久请求绑定沿用该私有回执的 SHA-256 方式，不依赖有保留期限的 HTTP HMAC 密钥。进程重启可按原 jobId 恢复解析，成功任务返回原候选；提交未知先查原 job/操作，不换键。

商品/场景单元格以英文逗号分隔稳定 ID；服务端只解析同品牌/域且属于品牌通用或当前店的已登记词项。正文和问法分别分配版本，缺行继承。来源版本尚未确认时材料记为 unknown，等待独立确认；不从文件时间推断新旧。`对应通用条目` 的非空内容暂时阻断，直到跨来源覆盖与发布冲突检查完成。该事务切片的原通过结论不含发布、使用资格或产品接线；后续封闭原子发布和旧写隔离见下文，注册生产角色与真实数据仍未开放。

业务授权、分配母资格和相关主体事实的截止时间由事务模块收集，在写回执后、COMMIT 前统一用数据库时钟复核；新负责人撤权/接管只检查当前资格，发新授权仍须覆盖整段期限。base 检查同时取得既有发布 advisory lock，保护尚无 current 行的首次导入；这不等于后续旧写影响集隔离已实现。

当前额度验证覆盖 actor/source 并发 admission 和保守的 1GiB 已登记对象总量门。对象上传准入、报告字节预留、retention 回收及十倍历史存量负载尚未接入；取消任务不自动释放磁盘，不能把本阶段称为完整暂存容量治理。已确认无引用的失败报告清理由后续受控 retention 流程承担。

## P2 来源与审批证据

同一 `test:intake:transactions` 入口增加完整的合成审批消费链：实际 XLSX → 持久候选 → 固定 JSON 审核包 → 合成实例/人工任务 → 附件字节校验 → 历史资格 → 当前候选 readiness。审核包含完整材料、差异、贡献人、风险和 base，存入既有对象存储；内部说明只进入管理审核包，后续坐席投影仍不得输出该字段。

`createContentIntakeService` 可由合成执行器注入 `createApprovalAdapter(route, transport)`。没有生产默认 transport，也没有 HTTP 参数可提交审核人、PASS、实例或附件证明。当前 transport 协议是严格的规范化合成协议，真实 Feishu 原生响应翻译和租户认证仍须独立实现验证；不能直接将远程 JSON 当作该适配器。

- `confirmSource`：精确键/文件摘要/获取方式、来源确认权限及证据版本 CAS；同源整数不能落后已发布整数版本，相同整数不能换文件。opaque 由有权人显式核对。理由与结果保存在永久私有回执，材料摘要不变。
- `requestReview`：先持久化 UUID、固定包 objectId/SHA、定义/节点和 evidenceVersion，随后锁外创建。丢响应返回 `creating`，重试原操作恢复原 UUID；另键不能替换仍在创建的实例。已落盘但未登记、以及未知结果的包不自动回收。
- `refreshReview`：只核验原实例。五分钟期限从本次核验开始的数据库时钟计算，失败不续期；GET 不触发外部 I/O。人工决定必须晚于审核包登记，历史权限取决定时点的事实/岗位/grant，毫秒边界无法可靠判定时拒绝。关键稿还须证明审核人与所有贡献人不同。
- 当前 reviewer 资格不足或事实过期会让候选回到 `awaiting-evidence` 投影。换实例/补证/核验推进代际，过时回调拒绝。撤回是终态，并在同事务失效所有引用该 reviewRequestId 的 release；之后仅凭新的 APPROVED 响应不能复活旧实例。

历史资格把提供方毫秒时间视为完整的 `[T,T+1ms)` 区间：事实、岗位或授权在其中变化，或者有效期不足以覆盖整个区间，就不能证明资格。授权/岗位历史的 `recorded_at` 发生在事务内，不能直接当作提交时刻。本实现复用同一内容锁下登记审核包的时间作为已提交资格检查点：审核所需业务 grant 的创建、决定时采用的岗位规则都必须早于该点。审核包建立后才取得资格的人，需要提交后创建新审核实例再作人工决定；不把新资格倒算进旧 PASS。

此处比较过两种边界：为全部授权写入器增加提交后见证，以及复用现有审核包检查点。后者不新增冻结合同字段或写入生命周期，当前封闭执行器可直接验证；代价是资格晚于审核包时必须重开审批。该证明依赖所有资格写入器遵守 `lock_content()`，真实组织同步接入时必须一并验证，不得绕过锁直接写表。

`ready` 不是发布回执。后续内部原子发布见下文，使用资格和桌面接线仍未实现；应用角色仍无新 schema 权限。发布会在锁内重新验证全部门，不能信任早先 GET 或幂等回执里的 readiness。详细证据见[审批证据验收](../evidence/qa/content-intake-p2-evidence/README.md)。

## P1 测量含义与未验证范围

探针分别运行 500 行与 5000 行（10 倍）样例各 10 次，均含六页、排除页合并单元格和八个图片引用；报告进程总延迟 p95/p99、子进程 maxRSS、Node 调用方事件循环 p99、取消到退出耗时、网络尝试数。n=10 的尾值相当于样本最大值，不是 SLA。5000 行不是同量真实内容的容量证明。

唯一预算在 `src/policy.ts`。前置检查覆盖文件字节、ZIP 数量/重复路径/实际展开量、宏/外部关系/XML、坐标/共享字符串/单值与媒体预算。所选页媒体尚未支持就明确阻断；未选页内容不入规范结果，但仍经过资源安全检查。只传有限字节和固定 context 给子进程，不传会话环境。进程取消/超时等待退出后再收新任务。

另对选中页实际读取文本累计设置 300 万 UTF-16 单元预算（`normalizedTextChars`），重复共享字符串按每次引用计数。它在结果序列化前拒绝放大输入，保留 JSON 转义、重复行字段和元数据的输出空间；单格、行数、ZIP 和输出预算须同时满足，不能把各上限相乘当作保证容量。

P1 探针本身未验证：CSV 规范入口、SOP 图与媒体导入、商品/场景词项存在性、正式稳定版本分配、来源先后事实、持久 candidate/幂等/PG 竞态、真实飞书人工审批/附件和多客户端、Electron utilityProcess 打包、Windows/Linux/真实 Main 延迟、OS 级内存与出站限制。网络入口观测为零不能证明 OS 无网络能力；`--max-old-space-size` 不限制全部 RSS/Buffer。DB 查询量为 0，是本探针不调用数据库，不能替代 10 倍存量的 PG 查询计划验证。

依赖审计单列新增生产依赖与全仓已有项。ExcelJS 只使用 uuid.v4，锁到仍提供 CommonJS 的 uuid 11.1.1；minimatch 的 brace-expansion 按兼容 major 锁修复版。新增包沿用现有 Vitest 3.2.7，未启动它的 UI/browser 服务；既有工具链公告不代表本轮已修复。

P2 已覆盖的词项、版本、候选与 PG 场景见[事务验收](../evidence/qa/content-intake-p2-transactions/README.md)，不沿用 P1 的零数据库查询结论。

实际运行结果链接由[执行计划 §0](plans/2026-10-03-content-intake-requirements.md)维护。

## P2 旧发布入口共存门

追加产品迁移 0022 在既有 SQL 发布/回退入口内统一取得 `backend_review.lock_content()`，再进入原发布锁和既有门禁。旧请求只有域，因此按整个绑定域的全部登记来源判定；与 active 或当前新谱系相交时拒绝。不同域发布必须在同一事务继承新目录、统一空 SOP/media 及原审批谱系，不能丢失目录。旧全量回退没有 P2 审批计划，触及新目录或 active 来源时拒绝。

该门没有开放新 schema 的应用权限，也没有提供生产 mode 设置或候选发布接口。现有旧 API 返回 409 冲突；P2 专用恢复原因与 UI 接线仍待后续。来源 mode 与目录由隔离测试 fixture 登记，测试成功不代表真实 active 放行。

```sh
CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin pnpm --filter @customer-agent/database test:integration
CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-release.integration.test.ts
```

执行 API 实库命令前，按已有 `test:intake:transactions` 配方构建 contracts/database/content-intake runtime。数据库检查覆盖从 21 段账本追加、前序定义漂移拒绝和 ACL；API 检查实际消费者及两会话锁序。逐条谱系继承、后续审批撤销传播沿用 `test:intake:transactions`。证据与剩余发布依赖见[旧写共存验收](../evidence/qa/content-intake-p2-legacy-fence/README.md)。

旧 owner 上传会在 enqueue 前修改来源指纹，因此 0022 同时保护 `advance_source_snapshots` / `restore_source_snapshots`，并修正 actor admission 与组织审核 worker 的首锁。存在未完成的旧 snapshot reservation 时，来源不能进入 active；先取消并恢复后才可继续。此存储门不代替未来正式启用 API 的批准、base CAS 或使用资格检查。

批量取消与上传都由 SQL 入口先取内容锁、再取 actor admission 锁；API 不单独取得次级锁。并发回归在 `content-import.integration.test.ts`，验证取消完成后下一次上传成功，并检查阻塞期间的实际 PG 锁集合。

## P2 候选质量预览与 SQL 消费探针

`test:intake:transactions` 同时验证内部 `qualityPreview(actor,key)`。它只读冻结材料，每次按 `review` 动作重验资格、完整键、来源、base 与候选状态；不会缓存权限或写质量/发布回执。普通稿复用既有 `qualityTargets`，数据库继续拥有 population 摘要和 `sha256-ranked-v1` 选样。关键稿所有启用条目进入强制复核集合。稳定 ID 由来源和业务 ID 共同生成；完整候选摘要绑定问法、词项、说明和显式停用，避免旧 population 忽略停用时丢失材料身份。

该结果明确标注 `synthetic-quality-preview`，不是持久冻结的质量计划，也不是质量通过证据。`population[].content_hash` 只是抽样投影摘要，不能写进要求 governance hash 的旧 staging。`has_conflict=false` 用于抽样分组，不证明跨来源业务冲突已排除；正式发布还须独立校验。当前预览允许审批前检查材料，不能据此签发发布票据。

实库测试单独创建合成旧批次和 worker lease，将预览原样送入 `freeze_content_quality_review_plan`，回读冻结的目标数量、population/selection hash；再调用 `record_content_quality_review_evidence` 验证缺扩样、伪造通过、关键稿漏审的拒绝和合法结论落盘。这个消费探针只存在于测试；不会在产品服务中创建旧批次或伪造 owner/dual-review。

旧 `OwnerAcceptanceRecord` 只允许 `g1a_offline_only`，原生人工审批不可转换成该记录。实库验证人工审批已通过、质量结论通过仍不能调用未登记的 owner 承接。完整字段差集与下一步验收见[合同交接](reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)。

### P2 冻结质量计划与逐条检查

在现有隔离 PG / 合成执行器中，先 `freezeQuality(actor,{operationId,key})` 冻结，再 `quality(actor,key)` 读回计划，按返回的精确 `initialScriptIds` 提交 `checkQuality(actor,{operationId,key,phase:'initial',checks})`。每条检查是 `{scriptId,contentHash,defect,reason}`；缺陷必须填写原因，不接受汇总计数或调用方结论。常规稿可自检，关键稿须未参与材料的有权人员。

每轮一次原子提交完整集合；`expansion_required` 时用 `expandedScriptIds` 提交 expanded，包含原初样且其内容和结果保持不变。任一缺陷最终要求整批新版本修订；`passed` 仅表示质量门通过，不取代来源/组织审批、负责人承接或最终发布门。使用原 operation 可恢复未知 COMMIT 的历史回执；当前资格与状态要重新读取，不以历史回执发布。

`0023_intake_quality` 是产品内部封闭存储，不改变正式 wire / 旧质量函数；两张表只追加，旧迁移保持原字节。状态函数从逐条检查计算结论，没有第二个可写的 passed 指针。生产应用角色仍不能访问。实库测试扩展原 `content-intake.integration.test.ts` 与数据库 `postgres.integration.test.ts`，使用上文同一命令与合成输入。


## P2 原生候选原子发布

同一个 `test:intake:transactions` 命令覆盖实际 XLSX → 来源确认 → 合成人工审批 → 质量 → 发布 → 按谱系回读材料。只有测试执行器显式建立的原生目录基线可以接续；服务不 bootstrap、不自动迁移旧同域数据、不认定显式同题覆盖已排除冲突。

在来源、审批与候选质量通过后，用 `publish(actor,{operationId,key,baseReleaseId,sourceEvidenceVersion,approvalEvidenceVersion,title,summary})`。发布动作有独立业务授权，不隐含要求 content-manage/review。API 先锁外即时核验审批，再由私有 SQL 在内容锁/发布锁下核对当前门，签发并消费从观察开始至多 60 秒的票据。目录、公告、单 current、永久关联及原 operation 回执一起提交；最终截止还受授权、审批、继承 owner 记录期限限制。

发生 `COMMIT_UNKNOWN` 时，用原 operationId 调 `operationReceipt(actor,operationId,'publish')`，或重试原 publish 请求；成功提交后的历史回执不再触发远程观察，不产生第二个 release。相同键换载荷拒绝；新操作键不能重复发布同一候选。历史回执不代替当前使用资格。隔离管理 HTTP 对应 `GET /v1/intake/operations/{operationId}?action=publish`；取消用 `action=cancel`，两者与当前主体共同限定命名空间。

新字段保留在不可变材料，release_lineage 绑定完整候选及来源内条目；缺行继承、显式停用保留版本历史。不同来源谱系和不同域旧成员完整复制，并重新核对其审批/来源/owner 门。内部说明仍只供管理审核；封闭坐席白名单读模型见下节，生产桌面尚未接线。未支持媒体的解析规则保持阻断，非空附件说明不能被本发布入口绕过。具体映射、限制和下一切片验收见[合同交接](reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)。


## P2 使用资格与按店目录

受控合成执行器调用 `issueEntitlement(actor,request)` 和 `snapshot(actor,{entitlementId,cursor?,limit?})`。OpenAPI 1.17.0 的 request 显式包含 shopId/contextGeneration/productIds/scenarioIds/releaseId；身份与私有会话引用来自认证模块。API 将选择及会话绑定原子保存到 0025 的不可变上下文，每页从数据库复原选择并锁定核验当前会话，调用方不能补传 sessionId 或分页选择。请求与返回用当前正式 validator，分页 limit 为 1–100，默认 50；整页去重词项最多 100，必要时提前分页。启用单条引用合计超限在冻结/发布前返回 FILE_LIMIT，须拆分业务条件；不截断词项，历史超限条目仍可显式停用。

同一资格分页须沿用相同会话和选择；换店、重新登录或改变选择后重签。新资格只能签 current，可指定 releaseId 作 CAS。普通新发布时旧页保持自己的 release；若希望展示新版，重新取资格并完成全部页面后整体替换，不能把新旧页合并。实际空目录必须能替换旧目录。游标只定位，不授予权限；每页均重验，不能把回执/旧资格/hash 当权限。

资格失败按 reason 恢复：SCOPE_DENIED/PERMISSION_CHANGED 核对登录及范围；ORG_FACTS_UNAVAILABLE 刷新组织事实；APPROVAL_UNAVAILABLE/APPROVAL_REVOKED 停止使用并处理审批；LEASE_EXPIRED 重签；BASE_CHANGED 重新取 current；MODE_CONFLICT 处理尚未支持的目录模式。Main 的 `ContentIntakeUsage` 已拥有完整分页、当前店/选择、迟到回调、原文复制与失效通知；单资格自然到期和精确 FORBIDDEN/LEASE_EXPIRED 只影响该资格，其他有效句柄仍受自己的原截止约束，真正会话/权限/审批失效才清除全部句柄。失败不会复活或延长资格。根级合成 HTTP 探针现在通过实际 `ProductHttp` / `ProductSession` 消费该模块；凭据仅驻留隔离进程内存，测试替换本机员工显示名读取，不读取用户 profile。产品 factory、白名单 IPC、renderer 和原生设备验收仍待接线；此前持久化和最终复审见[使用资格上下文验收](../evidence/qa/content-intake-p2-usage-context/README.md)。

封闭路由适配器 `apps/api/src/content-intake/usage-http.ts` 只由隔离合成宿主注册四个正式路径：`GET /v1/intake/authorization`、`GET /v1/intake/sources`、`POST /v1/intake/entitlements` 与 `GET /v1/intake/snapshot`。复用当前产品认证，原样保留私有 actor 引用；不接受额外身份/选择字段，重复查询参数不覆盖，错误统一为 `IntakeError` 并返回 `no-store`。生产 app/server 工厂未注册它。

`ProductHttp` 默认响应上限仍为 1 MiB；Main 的目录请求显式传入 32 MiB 总预算的剩余额度，每次 HTTP 读取也受同一剩余额度限制。合法 100 条长话术页可超过旧默认上限；没有截断或自动重试。错误诊断只写 HTTP 状态、已知错误类型/errno 和耗时，路径、游标、资格 ID、凭据与上游消息不进入日志。

本机定向验证：`CUSTOMER_AGENT_PG15_BIN=<PG15 bin> pnpm --filter @customer-agent/api test:intake:transactions`。使用临时 Unix socket PG，不读业务数据库；原生 Windows 不能直接运行此 PG harness，WSL 可提供 Linux 后端证据。远端需独立无特权目录并遮蔽生产路径；按 [远端测试流程](how-to-remote-development-and-deployment.md) 从已审阅 Git SHA 导出，不能把它变成生产发布。


## P2 授权店铺与来源发现

合成宿主调用 `authorizations(actor,{cursor?,limit?})` 与 `sources(actor,{cursor?,limit?})`，HTTP 使用上面的两个 GET 路径。身份只能来自产品认证对象及其私有会话；每页持有内容锁和会话锁，读取新鲜组织事实、正式业务授权谓词与分配资格。具体来源的 `actions`、`mayAllocate`、`mayDelegate` 分开投影，不能互相推断。范围内多个重叠凭据保守取有效截止；零权限返回空集合，不等于连接失败。

游标由服务端签名，绑定会话、列表类型、完整投影和最早截止；列表变更或服务重启后返回 `PERMISSION_CHANGED`，从第一页重读。每次最多 100 条，全部有权来源超过 5000 时返回 `FILE_LIMIT`，不截断。此分页不会创建业务回执或续期使用资格。`0026_intake_discovery_index` 用来源在动作之前的非撤销授权索引支撑每页即时复核；不缓存授权结果，不改变正式谓词，0001–0025 字节保持不变。同一来源的重叠授权先按动作/种类聚合，业务谓词每组只计算一次，避免逐条授权重复扫描。

Main `loadIntakeAccess(session,signal?)` 收齐两张列表并再次完整核对权限，返回 `{validUntil,shops,sources,capabilities}`；只作过期即失效的选择提示，不能拿它查询/复制。复读核对可见的权限变化，并非跨 HTTP 原子快照；来源独立更新及读完后的变更由后续资格签发重新核验。沿用 `ContentIntakeUsage.select/refresh` 签发当前店资格。发现读取最多每张表 50 页、三次列表读取合计 8 MiB；达到预算显式失败，不保证所有字段均取最大长度时可容纳 5000 个来源。取消、会话变更、重复分页、错范围和读间撤权均不输出部分菜单。品牌通用范围不是可选店，未获 query 资格的分配者也不会获得可查询店铺。

当前合同没有店铺展示名；Main 保留真实的合成店铺 ID，UI 的正式命名目录尚待合同接入。生产工厂仍未注册新能力；仅下述显式 loopback 合成 profile 接入了 Main/renderer。实库及实际桌面会话消费通过既有 `test:intake:transactions` 入口运行，详见[本轮验收](../evidence/qa/content-intake-p2-discovery/README.md)。

## P2 桌面 Query 合成入口

该切片连接“合成会话 → 授权店铺 → 已发布通用 FAQ → 原文复制”。开发态设置 `CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE=faq-v2`，同时提供不同端口的 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 与 `CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN`（只能是 `http://127.0.0.1:<port>`）。然后运行 `pnpm dev`。未配置 flag 维持既有行为；flag 拼错、缺 origin 或使用远程 origin 都拒绝启动。

打包配置解析器支持在 `synthetic-stack.json` 的 `synthetic-local` 对象中添加 `"contentIntake":"faq-v2"`，但本轮没有打包态验收。标准 synthetic-stack 服务尚未注册新四条路由，不能只加 flag 就声称完整服务可用；需要已经登记合成来源/权限/发布物的隔离宿主和已批准会话入口。可复现原生验收用下述仓库测试，它自己创建两个 loopback 合成 wire 服务与独立 userData，退出清理，不访问生产服务：

```sh
pnpm --filter @customer-agent/desktop build
pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-query.spec.ts
```

Main `ContentIntakeQuery` 从授权发现组合选店，查询时通过 `ContentIntakeUsage` 重新取得完整资格快照。`productIds/scenarioIds` 暂为空数组，按冻结合同只取不限商品/场景条目；界面明确显示“店铺通用 FAQ”。检索复用 retrieval-core，标题/启用问法权重 3，正文 1，固定 BM25 k1=1.2、b=0.75；按快照顺序稳定破同分。暂不接外部模型、反馈写回或 SOP。最多 5000 条、2 MiB 检索字段输入；超限整次返回 LIMIT，不交付截断结果。计算后让出事件循环，再复核原资格，不能把计算期间到期的正文投影出来。

`cancel` 只停止查询及当前展示复制；独立店铺发现由后一次发现、会话改变或窗口销毁取消。复制只接受当前展示的 key，资格 owner 重新核验并写原文，不信 renderer 文本。新 profile 不读取旧 hydrate/偏好/员工显示名文件，也不装配旧检索、announce 或管理适配器。原生菜单、托盘和 Dock 现在可进入 FAQ 专用资料审核页；没有 content-manage 权限时只显示无管理权限，不装配旧管理适配器。FAQ 正文展示和复制均保留原换行。

上述两项原生测试使用冻结合同 wire double；真实 API/PG 与桌面整链入口见下方独立合成联调章节，此前封闭 PG → HTTP → Main 探针证据独立保留。剩余项包括商品/场景筛选、正式店铺显示名合同、新上传/校验管理入口、真实飞书审批 adapter，以及安装包 Mac/Windows 人工交互。窗口与合成测试通过不代表真实飞书/数据、生产 factory/ACL/activation 放行。

## P2 管理候选与人工质量检查

同一显式 FAQ 合成 profile 的工作台支持候选分页、材料及差异、冻结抽样、逐条人工判断和原操作回执恢复。列表使用实际来源权限，不按旧 coach/owner 名称授予权限。每页最多显示 20 条检查；未保存的编辑阻止翻页/提交，未提交草稿需明确放弃才能切候选。回执是历史记录，提交后重新读取检查状态。退出登录清空内存；关闭窗口或应用会提示正在处理/结果不明及尚未提交判断。强制关闭不是撤销服务端操作。

```sh
pnpm --filter @customer-agent/desktop build
pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-management.spec.ts tests/e2e/content-intake-query.spec.ts
```

已有候选现在支持来源版本确认、组织审批发起/读取/刷新和发布。Main 从已读取材料和候选构造摘要、基线、证据版本和操作编号；renderer 只传人填写的版本、原因、标题和摘要。来源/审批丢响应时重放同一 POST，发布可查询原操作回执。已确认发布后读取失败不会回退为未知写入。创建审批可能已提交审核包，即便随后返回权限错误也保留原操作，不能改用新编号猜测重试。

未保存质量判断与工作流表单互斥；重新发起审批须明确确认；审批显示的是最近一次观察，发布时 API 仍须重新核验。退出登录或强制关闭会丢弃内存恢复信息，界面/原生关闭提示不等于服务端撤销，也不承诺跨重启恢复。冻结抽样和“质量检查通过”均不等于组织审批或发布许可。

新上传不能默认空基线或从登录 userId 推断 principalId。最小管理上下文已按 OpenAPI1.19.0 / schema.v1.21 冻结接收，隔离 API 和 Main 实际会话探针已消费；参与人目录复用 1.16 已冻结的 `GET /v1/intake/principals`，本轮隔离宿主和 Main 合成探针已实现消费，不另建一份目录。

### P2 已确认参与人目录

现有隔离宿主已接入 `GET /v1/intake/principals?sourceId=source-a&purpose=contributor&limit=50`。contributor 要求当前来源 import；grant-recipient 要求分配资格。只返回同 tenant/app 的已登记主键、显式合成标签和事实版本/有效期/启用状态。不会从登录 userId 或显示名推断 actor，也不要求首次授权对象先有业务 grant。已禁用或事实过期的已确认贡献人仍可被声明；其旧事实不构成当前授权。

每页最多扫描 limit 个身份（另加1条后续判断），排序使用 ASCII，筛选后可空页但仍有 nextCursor。调用方必须跟到 nextCursor=null，不能把空页当结束。游标绑定会话、来源、用途、limit、调用者权限及截止；变化后从第一页重读。响应上限262,144字节，标签缺失或无效整页失败，不截断或回退到账号。最终授权写入仍按 factsVersion CAS 重验。

运行上文 `test:intake:transactions` 可验证完整实库矩阵；仅目录用例使用 `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-intake.integration.test.ts -t 'principals:'`。其中根桥接器实际调用 Desktop ProductHttp/ProductSession，验证分页、取消及注销后迟到响应；普通根 test 中该外部宿主用例会跳过，不能将跳过写成通过。合成宿主引用 API 的构建产物，源码接口变化后先 `pnpm build:services` 再运行 typecheck 或宿主，避免旧 dist 类型/实现被消费。

目录最初交付不包含 Dashboard 控件；下述原生上传现在同时消费该目录与已接收的最小管理上下文。详见[目录验收](../evidence/qa/content-intake-p2-principals/README.md)。


## P2 管理上下文与新接收输入

`GET /v1/intake/sources/{sourceId}/management-context` 在有效产品会话和当前来源 import 权限下，返回 `sourceId/sourceVersion/baseReleaseId/principalId/factsVersion/validUntil` 六字段。只有数据库确实尚未发布时 base 才为 null；principal 来自认证的组织主体，不能使用登录 userId 替代。读操作不创建回执、候选、租约或 ACK，未知/跨范围/无 import 的来源统一不可见；不接受 query、body 或 HEAD。

API 在既有内容事务及发布锁内取得同一时点的来源和基线，并在结束前复核会话、事实与 import 的最早截止。返回后变化仍可能发生；receive 必须重新验权和 CAS，`BASE_CHANGED` 或 `SOURCE_MISMATCH` 要求重新读上下文并让用户重新核对，不能以 null 或新编号静默重试。现有合成宿主路由允许合同规定的128字符 ID，超长值仍拒绝。

Main 探针通过实际 ProductSession/ProductHttp 读取上下文、提交已有合成对象、等待解析并读取候选，同时验证取消和注销迟到响应。该探针独立验证接口；下述原生上传 UI 复用同一真实输入。专项使用 `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-intake.integration.test.ts -t 'management context:'`，需要 PG15；完整入口仍为 `test:intake:transactions`。结果与限制见[管理上下文验收](../evidence/qa/content-intake-p2-management-context/README.md)。

## P2 独立 API/PG 与桌面合成联调

运行入口使用全新临时 PostgreSQL 15、冻结迁移、实际身份/资料 HTTP 模块和三条合成多行 FAQ；不读取 `api.env`、`content.env`、`feishu.env` 或已有业务库。仅两个随机 loopback 端口。临时来源、身份、空发布基线只由 test-support 引导，不注册生产 factory，不放开应用 ACL。手动宿主默认执行上传/接收/解析准备已有候选；原生上传 E2E 明确以空候选宿主启动，再从工作台选择文件贯穿整条链路。

需要 Node 24、锁定 pnpm、可用 PG15 和已安装的 Electron。Mac 可运行完整桌面；WSL 可运行后端专项，Windows 原生窗口/安装包仍须分别实测。

```sh
pnpm build
pnpm dev:intake:synthetic
```

保持此终端前台运行，另一个终端执行 READY 输出中的桌面启动命令。它指定独立 userData 和本次随机 API/身份端口，不修改日常开发配置。

1. 以初始 enabler 合成身份登录，从菜单打开资料审核，选择已有候选、查看材料并确认来源版本。
2. 发起组织审批。创建实例后还没有审批观察时显示「尚未核验审批结果」；点「刷新审批结果」可看到等待状态。
3. 在宿主终端输入 `approve`，显式推进唯一待办的合成审批；回到工作台刷新结果。发起请求本身不会自动批准。
4. 读取初检、冻结抽样、逐条保存人工判断并提交。刷新候选状态，填写发布标题/摘要，再发布。
5. 终端输入 `identity agent`，桌面退出登录后重新登录。选择 shop-a、查询「洁面」，核对新发布的多行原文和复制结果。切换命令只影响下一次登录。

`status` 输出合成状态；`quit`、EOF、退出信号或约5分钟事实到期会停止宿主。宿主只清理自己创建的 PG/对象目录；另起 Electron 的 userData 在独立目录，退出 Electron 后按输出路径手动清理。不要延长事实 TTL 绕过到期检查。杭州机器需按本仓说明独立准备运行环境，本轮不包含远程部署或 Windows/WSL 实机结果。

专项验收：

```sh
pnpm test:intake:synthetic
pnpm test:intake:desktop
```

前者包含真实 HTTP/PG 产物消费及 CLI 子进程的启动、固定命令、EOF 和清理边界；后者需要 Mac 图形桌面，使用空候选宿主验证原生选择坏 XLSX → renderer/preload/Main → HTTP/PG解析失败 → 完整报告落盘并由 ExcelJS 回读 → 整批更正重传 → 审核发布 → 换坐席查询并复制。OS 对话框只替换路径选择，其余链路实际执行。截图保存在 ignored `.gstack/intake-synthetic/`。这些是合成联调证据，真实飞书审批、生产激活、安装包、Windows 合成器和 macOS 人工窗口体验仍分别验收。


## P2 FAQ 原生上传

Dashboard 使用既有窄 `dashboard:intake-command` 接口。选择有 import 权限的来源，再选择不超过 10 MiB 的统一模板 XLSX。界面必须明确确认整理责任人及所有实际改稿人；本人制作也须显式勾选本人，已确认的历史/禁用参与人可列入贡献声明，其身份事实不授予当前权限。来源、发布基线或当前主体事实变化时，重新展示声明并要求确认。

Main 保留原始字节、服务端对象、parse job 和上传/接收的原操作编号。结果不明时「按原请求重试上传」先重新核对权限，再重放原字节或正文；「刷新上传权限」不会丢弃未知操作。「停止本机等待」只中止本地等待，不撤销服务端解析或候选。没有公开 parse-job cancel 路由。已打开另一个候选时，上传历史不能替换其选择和未提交输入。

解析进度按用户刷新读取。阻断错误不形成可审批候选；界面展示 totalIssues 和最多 100 条问题。完整 XLSX 报告通过认证会话、MIME、8 MiB 字节预算及 30 秒限时下载，由原生保存框原子写入；下载/保存失败不能显示成功。修正全部问题后重新选择整个工作簿。解析成功自动接入已有候选审核流程，不因缺行推断删除；修订既有候选和真正取消候选的管理界面仍为后续事项。

报告容量实测、有限文件读写、停止/恢复与完整消费的命令见[原生上传验证](how-to-verify-desktop.md#faq-原生上传与报告)。该切片没有新增生产 API 注册、真实飞书 transport 或运行 ACL。手动测试模板须为当前登记来源的合成资料；不得选择客户工作簿或员工文件。
