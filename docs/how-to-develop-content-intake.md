# 如何验证合成资料导入

本入口验证已授权的合成开发，不读真实工作簿、员工或飞书凭据。P1 探针不启动桌面/API/数据库；下方 P2 命令启动独立 Unix socket PostgreSQL，退出后移除该临时集群。FAQ 原生文件选择、参与人确认、上传校验、报告保存、确认直发与坐席查询已接通。当前 OpenAPI 1.22.0/schema.v1.25 合同及35段迁移已冻结并完整版本化接收，新候选按 direct-v1 执行；剩余原生设备人工验收和正式运行接入仍待完成。当前剩余范围见 [TODOS](../TODOS.md)，已取得的平台证据见[杭州分层验收](../evidence/qa/content-intake-p2-hangzhou/README.md)。

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
- P2 `apps/api/src/content-intake` 复用正式 validator、对象存储与该解析包，隔离实库执行器、合成 HTTP 和桌面 Main/preload/界面已消费；生产 app/server 尚未注册新路径。

独立合成装配候选由 `apps/api/experiments/intake-runtime/runtime-candidate.ts` 提供，只供显式本机测试，不读取 `.env` 或启用生产入口。实际校验命令与23项PG15结果见[候选证据](../evidence/qa/intake-runtime-closeout/README.md)；需要复验时使用其中的门控命令，不把其合成provider或账号移入真实运行。Menokin规范整理映射和四域模板验证见[整理说明](reference-intake-menokin-readiness.md)。

## CSV 与 XLSX 输入

CSV 的 OpenAPI 1.22.0 / schema.v1.24 已冻结并实际 intake；当前消费已前进到仅追加旧 CHECK 执行权限的 schema.v1.25，格式与 HTTP 合同保持不变。`packages/content-intake/src/csv.ts` 与既有 XLSX 解析器通过同一隔离 runner 被 API 消费；`src/faq-rules.ts` 统一拥有两格式的 FAQ/问法业务规则。固定 `csv-parse` 7.0.3（MIT）是运行依赖；严格编码、引号、列结构、来源一致性和预算由 CSV 适配器负责，原件摘要从未转换的 Buffer 计算，保留 BOM 和换行字节。解析通过不代表来源已确认、权限已授予或可以发布。

CSV 采用单文件 23 列，保留独立问法编号；同一话术带多问法时重复的 FAQ 字段须相同，否则整批拒绝。来源登记的模板、规则、映射与结构摘要决定输入格式，客户端文件名不能改变登记。CSV 使用 `faq-csv-v1` / `intake-csv-v1` / `faq-csv-columns-v1`；XLSX 保留原规则。原表的一次性整理不增加永久列映射，旧 Excel/CSV 不能直接当作规范模板上传。`experiments/csv/` 仅保留原字节合成夹具，唯一解析实现在 src。当前 Mac 开发态实际上传、XLSX 错误报告、修订、确认发布与另一客服查询复制的结果见[CSV 接入证据](../evidence/qa/intake-csv-runtime/README.md)。生产 HTTP 与真实资料仍未开放。

## P2 权限与持久候选事务

```sh
CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin pnpm --filter @customer-agent/api test:intake:transactions
```

命令使用合成主体、来源和真实生成的 XLSX，执行权限交集、批量授予、撤权保留下游、原始操作键恢复、候选冻结/修订/取消与错误报告回读。数据库安装账户只供该临时测试集群；不得把它接到 API 启动配置。正式运行角色仍无 `content_intake` schema 权限。

服务接口只接收已验证会话和 objectId，不接文件路径、远程 URL、客户端 rows/digest 或 renderer 身份。根 allocation、身份事实、来源/词项及接收对象由测试受控登记；上传 HTTP 已由下述隔离合成宿主接入；正式组织事实维护和运行装配仍待后续。当前任务回执复用 `backend_review.receipts` 的独立 `intake:` 命名空间，候选不依赖 24h HTTP 缓存。永久请求绑定沿用该私有回执的 SHA-256 方式，不依赖有保留期限的 HTTP HMAC 密钥。进程重启可按原 jobId 恢复解析，成功任务返回原候选；提交未知先查原 job/操作，不换键。

商品/场景单元格以英文逗号分隔稳定 ID；服务端只解析同品牌/域且属于品牌通用或当前店的已登记词项。正文和问法分别分配版本，缺行继承。来源版本尚未确认时材料记为 unknown，等待独立确认；不从文件时间推断新旧。K 列 `对应通用条目` 使用精确的 `sourceId/businessEntryId`，空值清除关联、缺行仍继承。内部解析上下文必须显式提供 `scopeKind`；不能从店铺 ID 是否叫 `brand` 推断品牌范围。0028 在发布及回退同一事务内检查通用根、范围、适用条件交集与品牌不可覆盖；坐席读取先过滤资格和选择，再计算店铺覆盖与通用回落，最后分页。多选有未覆盖组合时保留通用稿，标题相似不合并。详见[同题覆盖验收](../evidence/qa/content-intake-p2-family/README.md)。该事务切片的原通过结论不含发布、使用资格或产品接线；后续封闭原子发布和旧写隔离见下文，注册生产角色与真实数据仍未开放。

业务授权、分配母资格和相关主体事实的截止时间由事务模块收集，在写回执后、COMMIT 前统一用数据库时钟复核；新负责人撤权/接管只检查当前资格，发新授权仍须覆盖整段期限。base 检查同时取得既有发布 advisory lock，保护尚无 current 行的首次导入；旧写影响集合由下述 0022 共存门独立校验，不能仅凭 base 检查替代。

当前额度验证覆盖 actor/source 并发 admission，以及 0029 统一管理的四类对象字节预留、引用保护和明确失败对象释放；10→100 并发准入及 10→100 合成发布历史已验收。取消任务不等于允许删除已登记历史对象；历史保留期与受控历史回收仍待批准，具体命令、口径与证据见[容量核对与历史保留](#容量核对与历史保留第二组)。

## P2 内容管理内的权限配置

现有 FAQ 合成入口在「内容管理」后增加侧栏「权限」。它不是第六个业务模块，没有 `dashboardPermissions` 时不出现。总监、经理按当前 `mayAllocate` 范围配置 business 授权；主管、组长不获得配置他人的能力。岗位、坐席命令和 43101 登录边界见[资料页与权限页](reference-intake-pages.md)，操作步骤见[如何操作资料页和权限页](how-to-operate-intake-pages.md)。选择已有配置范围和目录返回的具名人员，岗位只选「客服」或「客服主管」。动作集由岗位固定，页面不能单独勾选 `rollback`、`candidate-cancel` 或 `review`。再填写生效/失效时间和原因，先“预览权限”再“确认保存权限”。预览明确显示尚未保存，“返回修改”不写授权。撤销须核对授权记录并填写原因；当前姓名不可用的历史记录仍可按编号、范围、时间及原原因识别和撤销，不猜测人员姓名，也不要求手填员工 ID。本切片不提供 delegation、接管或根 allocation 编辑界面。

| 所有者 | 接线与不变量 |
| --- | --- |
| API 原 authority / discovery / service | 复用冻结合同的 `GET /v1/intake/grants`、`POST /v1/intake/grants/preview`、`POST /v1/intake/grants`、`PATCH /v1/intake/grants/{grantId}`；主体目录用 `purpose=grant-recipient`，范围来自 authorization。预览只读，保存重验；列表在 SQL 扫描前限定可管理范围，再复用原资格判断，游标不携带别范围授权 ID |
| `grants-http.ts` / 既有 management HTTP | grants plugin 注入 management 创建的同一个强制产品会话 service，不另建授权实现或服务实例；当前只由显式合成宿主注册 |
| Main `ContentIntakePermissions` / 权限 IPC | 持有主体和来源 ID、短期选择句柄、会话代际、人员/当前资格最早截止、固定预览和写请求。到期清理，取消拒绝迟到结果，结果未知只按原请求恢复；sender、main-frame 和会话均在 Main 核验 |
| Dashboard preload / `IntakePermissions` | 仅开放 `dashboardPermissions.current/command/onInvalidated`（`dashboard:permissions-current`、`dashboard:permissions-command`、`dashboard:permissions-invalidated`）；renderer 提交选择与确认意图，没有通用 HTTP、员工 ID 输入或凭据 |

[权限配置增量证据](../evidence/qa/intake-grant-management/README.md)记录实际 HTTP＋受限用途池＋PG15 3 项，以及桌面相关单元/组件 80 项通过。真实 Electron 权限闭环在集成后已通过：具名总监预览取消不生效、保存后另一坐席获得新查询资格、撤销后拒绝；980×680 浅色/深色控件可操作且无横向溢出。最终证据见[三线收尾](../evidence/qa/intake-parallel-recovery/three-part-completion/README.md)。命令从 `apps/desktop` 运行：

```sh
CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 ./node_modules/.bin/playwright test tests/e2e/content-intake-permissions-real-stack.spec.ts
```

用例要求现有 `purpose-runtime` 合成宿主，使用已登记合成总监和具名坐席，验证预览/取消不生效、保存后坐席新查询资格可用、撤销后重新取资格拒绝。它不代表经理身份单独实跑、真实员工名单、生产账号或正式运行装配已验证。版本和原角色上限保持不变。

## P2 来源确认与历史审批兼容

`confirmSource` 仍按精确键、文件摘要、获取方式、来源确认权限及证据版本 CAS 校验；同源整数不能落后已发布版本，相同整数不能换文件，opaque 由有权人显式核对。理由与结果写入永久私有回执，材料摘要不变。

当前 `createContentIntakeService` 保留旧内部 adapter 参数以兼容调用位置，但不调用它，也不能借它开启审批写入。新接收和显式修订产生 direct-v1 候选，发布与回退不创建审批包、实例、人工任务或审批事实。四个候选/回退审批写接口返回 `409 MODE_CONFLICT`，旧请求不会被伪装成通过；历史 GET 不触发外部 I/O。

旧 approval-v1 候选、不可变谱系、审批证据及回执保留。旧未发布候选须显式修订或重新导入才进入 direct-v1；历史发布物的审批到期/撤销依然限制继承、查询与回退，不能借一次直发复活。测试使用明确的历史 fixture 建立旧资料，生产入口没有绕过策略的开关。[原审批验收](../evidence/qa/content-intake-p2-evidence/README.md)记录历史实现；[直发验收](../evidence/qa/intake-direct-publication/README.md)记录当前消费边界。

`ready` 不是发布回执。最终写入始终在锁内重新验证来源、质量、权限、事实、会话、范围和基线；不能信任早先 GET 或幂等回执中的 readiness。

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

该门没有开放新 schema 的应用权限，也没有提供生产 mode 设置或候选发布接口。现有旧 API 返回 409 冲突；P2 合成桌面的失败恢复与管理入口见下文，生产 mode 设置仍未接入。来源 mode 与目录由隔离测试 fixture 登记，测试成功不代表真实 active 放行。

```sh
CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin pnpm --filter @customer-agent/database test:integration
CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-release.integration.test.ts
```

执行 API 实库命令前，按已有 `test:intake:transactions` 配方构建 contracts/database/content-intake runtime。数据库检查覆盖从 21 段账本追加、前序定义漂移拒绝和 ACL；API 检查实际消费者及两会话锁序。逐条谱系继承、后续审批撤销传播沿用 `test:intake:transactions`。证据与剩余发布依赖见[旧写共存验收](../evidence/qa/content-intake-p2-legacy-fence/README.md)。

旧 owner 上传会在 enqueue 前修改来源指纹，因此 0022 同时保护 `advance_source_snapshots` / `restore_source_snapshots`，并修正 actor admission 与组织审核 worker 的首锁。存在未完成的旧 snapshot reservation 时，来源不能进入 active；先取消并恢复后才可继续。此存储门不代替未来正式启用 API 的批准、base CAS 或使用资格检查。

批量取消与上传都由 SQL 入口先取内容锁、再取 actor admission 锁；API 不单独取得次级锁。并发回归在 `content-import.integration.test.ts`，验证取消完成后下一次上传成功，并检查阻塞期间的实际 PG 锁集合。

## P2 候选质量预览与 SQL 消费探针

`test:intake:transactions` 同时验证内部 `qualityPreview(actor,key)`。它只读冻结材料，每次按 `review` 动作重验资格、完整键、来源、base 与候选状态；不会缓存权限或写质量/发布回执。普通稿复用既有 `qualityTargets`，数据库继续拥有 population 摘要和 `sha256-ranked-v1` 选样。关键稿所有启用条目进入强制复核集合。稳定 ID 由来源和业务 ID 共同生成；完整候选摘要绑定问法、词项、说明和显式停用，避免旧 population 忽略停用时丢失材料身份。

该结果明确标注 `synthetic-quality-preview`，不是持久冻结的质量计划，也不是质量通过证据。`population[].content_hash` 只是抽样投影摘要，不能写进要求 governance hash 的旧 staging。`has_conflict=false` 用于抽样分组，不证明跨来源业务冲突已排除；正式发布还须独立校验。当前预览允许发布前检查材料，不能据此签发发布票据。

实库测试单独创建合成旧批次和 worker lease，将预览原样送入 `freeze_content_quality_review_plan`，回读冻结的目标数量、population/selection hash；再调用 `record_content_quality_review_evidence` 验证缺扩样、伪造通过、关键稿漏审的拒绝和合法结论落盘。这个消费探针只存在于测试；不会在产品服务中创建旧批次或伪造 owner/dual-review。

旧 `OwnerAcceptanceRecord` 只允许 `g1a_offline_only`，原生人工审批不可转换成该记录。实库验证人工审批已通过、质量结论通过仍不能调用未登记的 owner 承接。完整字段差集与下一步验收见[合同交接](reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)。

### P2 冻结质量计划与逐条检查

在现有隔离 PG / 合成执行器中，先 `freezeQuality(actor,{operationId,key})` 冻结，再 `quality(actor,key)` 读回计划，按返回的精确 `initialScriptIds` 提交 `checkQuality(actor,{operationId,key,phase:'initial',checks})`。每条检查是 `{scriptId,contentHash,defect,reason}`；缺陷必须填写原因，不接受汇总计数或调用方结论。常规稿可自检，关键稿须未参与材料的有权人员。

每轮一次原子提交完整集合；`expansion_required` 时用 `expandedScriptIds` 提交 expanded，包含原初样且其内容和结果保持不变。任一缺陷最终要求整批新版本修订；`passed` 仅表示质量门通过，不取代来源确认、当前权限与事实、负责人承接或最终发布门。使用原 operation 可恢复未知 COMMIT 的历史回执；当前资格与状态要重新读取，不以历史回执发布。

`0023_intake_quality` 是产品内部封闭存储，不改变正式 wire / 旧质量函数；两张表只追加，旧迁移保持原字节。状态函数从逐条检查计算结论，没有第二个可写的 passed 指针。生产应用角色仍不能访问。实库测试扩展原 `content-intake.integration.test.ts` 与数据库 `postgres.integration.test.ts`，使用上文同一命令与合成输入。


## P2 原生候选原子发布

同一个 `test:intake:transactions` 命令覆盖实际 XLSX → 来源确认 → 质量 → 原生确认直发 → 按谱系回读材料。只有测试执行器显式建立的原生目录基线可以接续；服务不 bootstrap、不自动迁移旧同域数据；显式同题覆盖由 0028 完整目录守卫在提交点检查。

在来源与候选质量通过后，用 `publish(actor,{operationId,key,baseReleaseId,sourceEvidenceVersion,confirmed:true,title,summary})`；旧 approvalEvidenceVersion 或缺少确认均拒绝。发布动作有独立业务授权，不隐含要求 content-manage/review。私有 SQL 在内容锁/发布锁下核对当前门，以数据库时钟记录确认并消费至多 60 秒的票据；候选合法地从等待证据推进到 ready 再 publishing。目录、公告、单 current、永久关联及原 operation 回执一起提交，COMMIT 前再次校验最终截止。direct-v1 不生成 reviewRequest/审批事实；混合谱系中原 approval-v1 的审批期限和继承 owner 记录期限仍有效。

发生 `COMMIT_UNKNOWN` 时，用原 operationId 调 `operationReceipt(actor,operationId,'publish')`，或重试原 direct-v1 publish 请求；成功提交后的历史回执不再触发远程观察，不产生第二个 release。相同键换载荷拒绝；新操作键不能重复发布同一候选。历史回执不代替当前使用资格。隔离管理 HTTP 对应 `GET /v1/intake/operations/{operationId}?action=publish`；取消用 `action=cancel`，两者与当前主体共同限定命名空间。

旧审批格式的未知发布/回退只读原回执，不改写为 confirmed=true 或换键重试。

新字段保留在不可变材料，release_lineage 绑定完整候选及来源内条目；缺行继承、显式停用保留版本历史。不同来源谱系和不同域旧成员完整复制，并按各自 publicationPolicy 重新核对来源/owner 门及历史审批门。内部说明仍只供管理审核；封闭坐席白名单读模型及合成桌面接线见下节，正式生产接入尚未放行。未支持媒体的解析规则保持阻断，非空附件说明不能被本发布入口绕过。具体映射、限制和下一切片验收见[合同交接](reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)。


## P2 纠正回退与同题覆盖验证

在 FAQ 工作台提供当前版本和它的上一已发布版本，读取实际影响后由 Main 原生弹窗确认，默认取消。回退生成新的发布版本、公告和永久回执；不直接恢复旧指针，新 direct-v1 回退不创建或复用审批证据。范围不完整时只能走完整纠正稿，目标内容或审批失效时拒绝回退。结果未知须恢复原操作，不能换编号重发。旧审批版本的历史证据见[回退验收](../evidence/qa/content-intake-p2-rollback/README.md)；当前确认直发/回退的实际 Electron→HTTP→PG15 结果见[直发验收](../evidence/qa/intake-direct-publication/README.md)。

```sh
pnpm test:intake:desktop
node scripts/probe-intake-family-sql.mjs --output .gstack/family-sql-check.json
```

第一条构建并运行原生上传和回退的实际栈用例，需要 Node 24、Electron 和 PG15。第二条使用临时 PG15 验证家族守卫、选择语义及查询计划，并写出可再次消费的 JSON；输出使用本次自有路径，存在时会被替换。其局部目录性能结果不代表完整十倍候选、审批、回执和对象历史存量验收。已有[同题覆盖证据](../evidence/qa/content-intake-p2-family/README.md)保留过一次全量 PG 超时及修后受影响项复测，不将其改写为一次全量通过。

## P2 使用资格与按店目录

受控合成执行器调用 `issueEntitlement(actor,request)` 和 `snapshot(actor,{entitlementId,cursor?,limit?})`。OpenAPI 1.17.0 的 request 显式包含 shopId/contextGeneration/productIds/scenarioIds/releaseId；身份与私有会话引用来自认证模块。API 将选择及会话绑定原子保存到 0025 的不可变上下文，每页从数据库复原选择并锁定核验当前会话，调用方不能补传 sessionId 或分页选择。请求与返回用当前正式 validator，分页 limit 为 1–100，默认 50；整页去重词项最多 100，必要时提前分页。启用单条引用合计超限在冻结/发布前返回 FILE_LIMIT，须拆分业务条件；不截断词项，历史超限条目仍可显式停用。

同一资格分页须沿用相同会话和选择；换店、重新登录或改变选择后重签。新资格只能签 current，可指定 releaseId 作 CAS。普通新发布时旧页保持自己的 release；若希望展示新版，重新取资格并完成全部页面后整体替换，不能把新旧页合并。实际空目录必须能替换旧目录。游标只定位，不授予权限；每页均重验，不能把回执/旧资格/hash 当权限。

资格失败按 reason 恢复：SCOPE_DENIED/PERMISSION_CHANGED 核对登录及范围；ORG_FACTS_UNAVAILABLE 刷新组织事实；APPROVAL_UNAVAILABLE/APPROVAL_REVOKED 表示历史 approval-v1 依据失效，停止使用并核对历史资料；LEASE_EXPIRED 重签；BASE_CHANGED 重新取 current；MODE_CONFLICT 处理尚未支持的目录模式。Main 的 `ContentIntakeUsage` 已拥有完整分页、当前店/选择、迟到回调、原文复制与失效通知；单资格自然到期和精确 FORBIDDEN/LEASE_EXPIRED 只影响该资格，其他有效句柄仍受自己的原截止约束，真正会话/权限/审批失效才清除全部句柄。失败不会复活或延长资格。根级合成 HTTP 探针现在通过实际 `ProductHttp` / `ProductSession` 消费该模块；凭据仅驻留隔离进程内存，测试替换本机员工显示名读取，不读取用户 profile。合成 profile 的 Main factory、白名单 IPC 和 renderer 已接线；生产 factory 与未覆盖设备项仍待验收；此前持久化和最终复审见[使用资格上下文验收](../evidence/qa/content-intake-p2-usage-context/README.md)。

封闭路由适配器 `apps/api/src/content-intake/usage-http.ts` 只由隔离合成宿主注册六个正式路径：`GET /v1/intake/authorization`、`GET /v1/intake/sources`、`GET /v1/intake/sources/{sourceId}/vocabulary`、`GET /v1/intake/shop-directory`、`POST /v1/intake/entitlements` 与 `GET /v1/intake/snapshot`。复用当前产品认证，原样保留私有 actor 引用；不接受额外身份/选择字段，重复查询参数不覆盖，错误统一为 `IntakeError` 并返回 `no-store`。生产 app/server 工厂未注册它。

`ProductHttp` 默认响应上限仍为 1 MiB；Main 的目录请求显式传入 32 MiB 总预算的剩余额度，每次 HTTP 读取也受同一剩余额度限制。合法 100 条长话术页可超过旧默认上限；没有截断或自动重试。错误诊断只写 HTTP 状态、已知错误类型/errno 和耗时，路径、游标、资格 ID、凭据与上游消息不进入日志。

本机定向验证：`CUSTOMER_AGENT_PG15_BIN=<PG15 bin> pnpm --filter @customer-agent/api test:intake:transactions`。使用临时 Unix socket PG，不读业务数据库；原生 Windows 不能直接运行此 PG harness，WSL 可提供 Linux 后端证据。远端需独立无特权目录并遮蔽生产路径；按 [远端测试流程](how-to-remote-development-and-deployment.md) 从已审阅 Git SHA 导出，不能把它变成生产发布。


## P2 授权店铺与来源发现

合成宿主调用 `authorizations(actor,{cursor?,limit?})` 与 `sources(actor,{cursor?,limit?})`，HTTP 使用上面的两个 GET 路径。身份只能来自产品认证对象及其私有会话；每页持有内容锁和会话锁，读取新鲜组织事实、正式业务授权谓词与分配资格。具体来源的 `actions`、`mayAllocate`、`mayDelegate` 分开投影，不能互相推断。范围内多个重叠凭据保守取有效截止；零权限返回空集合，不等于连接失败。

游标由服务端签名，绑定会话、列表类型、完整投影和最早截止；列表变更或服务重启后返回 `PERMISSION_CHANGED`，从第一页重读。每次最多 100 条，全部有权来源超过 5000 时返回 `FILE_LIMIT`，不截断。此分页不会创建业务回执或续期使用资格。`0026_intake_discovery_index` 用来源在动作之前的非撤销授权索引支撑每页即时复核；不缓存授权结果，不改变正式谓词，0001–0025 字节保持不变。同一来源的重叠授权先按动作/种类聚合，业务谓词每组只计算一次，避免逐条授权重复扫描。

Main `loadIntakeAccess(session,signal?)` 收齐两张列表并再次完整核对权限，返回 `{validUntil,shops,sources,capabilities}`；只作过期即失效的选择提示，不能拿它查询/复制。复读核对可见的权限变化，并非跨 HTTP 原子快照；来源独立更新及读完后的变更由后续资格签发重新核验。沿用 `ContentIntakeUsage.select/refresh` 签发当前店资格。发现读取最多每张表 50 页、三次列表读取合计 8 MiB；达到预算显式失败，不保证所有字段均取最大长度时可容纳 5000 个来源。取消、会话变更、重复分页、错范围和读间撤权均不输出部分菜单。品牌通用范围不是可选店，未获 query 资格的分配者也不会获得可查询店铺。

该早期发现合同没有店铺展示名；当前已接入 0033 的名称目录，Main 仍以稳定店铺 ID 作为授权依据，名称只用于显示。生产工厂仍未注册新能力；仅下述显式 loopback 合成 profile 接入了 Main/renderer。实库及实际桌面会话消费通过既有 `test:intake:transactions` 入口运行，详见[本轮验收](../evidence/qa/content-intake-p2-discovery/README.md)及下方[正式用途合同贯穿合成 HTTP 与本机 Electron](#正式用途合同贯穿合成-http-与本机-electron)。

## P2 桌面 Query 合成入口

该切片连接“合成会话 → 授权店铺/商品/场景 → 已发布适用 FAQ → 原文复制”。开发态设置 `CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE=faq-v2`，同时提供不同端口的 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 与 `CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN`（只能是 `http://127.0.0.1:<port>`）。然后运行 `pnpm dev`。未配置 flag 维持既有行为；flag 拼错、缺 origin 或使用远程 origin 都拒绝启动。

打包配置解析器支持在 `synthetic-stack.json` 的 `synthetic-local` 对象中添加 `"contentIntake":"faq-v2"`，指定版本已有 Windows 打包态验收，见[杭州记录](../evidence/qa/content-intake-p2-hangzhou/README.md)；不能推断后续回退/同题覆盖已在该包验收。标准 synthetic-stack 服务尚未注册上述五条使用路由，不能只加 flag 就声称完整服务可用；需要已经登记合成来源/权限/发布物的隔离宿主和已批准会话入口。可复现原生验收用下述仓库测试，它自己创建两个 loopback 合成 wire 服务与独立 userData，退出清理，不访问生产服务：

```sh
pnpm --filter @customer-agent/desktop build
pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-query.spec.ts
```

Main `ContentIntakeQuery` 从授权发现组合选店，查询时通过 `ContentIntakeUsage` 重新取得完整资格快照。词项从冻结的 `GET /v1/intake/sources/{sourceId}/vocabulary` 完整分页读取，按授权店铺/品牌/域校验，最多 5000 词项、8 MiB；改名、撤权或分页内容变化要求重读。结果区的商品/场景支持多选与清除，空维度仅取通用条目。Main 校验菜单成员后把稳定 ID 交给原使用资格；换店清选择，换条件撤旧结果与复制、保留问题、等待手动查询。胶囊只留“筛选”入口。检索复用 retrieval-core，标题/启用问法权重 3，正文 1，固定 BM25 k1=1.2、b=0.75；按快照顺序稳定破同分。暂不接外部模型、反馈写回或 SOP。最多 5000 条、2 MiB 检索字段输入；超限整次返回 LIMIT，不交付截断结果。计算后让出事件循环，再复核原资格，不能把计算期间到期的正文投影出来。

`cancel` 只停止查询及当前展示复制；独立店铺发现由后一次发现、会话改变或窗口销毁取消。复制只接受当前展示的 key，资格 owner 重新核验并写原文，不信 renderer 文本。新 profile 不读取旧 hydrate/偏好/员工显示名文件，也不装配旧检索、announce 或管理适配器。原生菜单、托盘和 Dock 现在可进入 FAQ 专用资料审核页；没有 content-manage 权限时只显示无管理权限，不装配旧管理适配器。FAQ 正文展示和复制均保留原换行。

上述两项原生测试使用冻结合同 wire double；真实 API/PG 与桌面整链入口见下方独立合成联调章节，此前封闭 PG → HTTP → Main 探针证据独立保留。新上传/校验管理入口已接通。商品/场景筛选已完成本组合成验证；店铺名称目录已接到查询选择器；名称异常保留编号，剩余平台人工验收仍待完成；已有设备结果按版本复用，不重新列为全未做。窗口与合成测试通过不代表真实飞书/数据、生产 factory/ACL/activation 放行。

## P2 管理候选与人工质量检查

同一显式 FAQ 合成 profile 的工作台支持候选分页、材料及差异、冻结抽样、逐条人工判断和原操作回执恢复。列表使用实际来源权限，不按旧 coach/owner 名称授予权限。每页最多显示 20 条检查；未保存的编辑阻止翻页/提交，未提交草稿需明确放弃才能切候选。回执是历史记录，提交后重新读取检查状态。退出登录清空内存；关闭窗口或应用会提示正在处理/结果不明及尚未提交判断。强制关闭不是撤销服务端操作。

```sh
pnpm --filter @customer-agent/desktop build
pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-management.spec.ts tests/e2e/content-intake-query.spec.ts
```

当前冻结合同下，新候选支持来源确认、人工质量检查和原生确认直发；历史审批只读。Main 从已读取材料和候选冻结摘要、基线、来源证据版本、confirmed 和操作编号，renderer 只提交用户意图与表单。取消弹窗不发 HTTP、不建立未知操作；确认后重新核对会话、权限与取消代际。来源丢响应重放原 POST，direct-v1 发布可查询原回执或重试完全相同的请求；旧审批 wire 的未知操作只查回执。已确认发布后读取失败不会回退为未知写入。

未保存质量判断与工作流表单互斥。退出登录或强制关闭会丢弃内存恢复信息，界面/原生关闭提示不等于服务端撤销，也不承诺跨重启恢复。质量 passed 不代替发布授权；常规自检、关键稿独立质量判断沿现有规则保留，取消的是组织审批流程。

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

1. 以初始 enabler 合成身份登录（固定测试 ID，实际岗位为 lead），从菜单打开资料管理，选择已有候选、查看材料并确认来源版本。
2. 读取初检、冻结抽样、逐条保存人工判断并提交；有问题时先整批修订。
3. 刷新候选状态，填写发布标题/摘要，点击发布；原生弹窗默认取消，确认后按 direct-v1 发布。无需终端审批命令。
4. 终端输入 `identity agent`，桌面退出后重新登录。选择 shop-a、查询「洁面」，核对新发布多行原文与复制结果。切换只影响下一次登录。

`status` 输出合成状态；`quit`、EOF、退出信号或约5分钟事实到期会停止宿主。宿主只清理自己创建的 PG/对象目录；另起 Electron 的 userData 在独立目录，退出 Electron 后按输出路径手动清理。不要延长事实 TTL 绕过到期检查。杭州机器需按本仓说明独立准备运行环境。这组本机命令本身不证明远程部署或 Windows/WSL 结果；已完成的指定版本远端和原生验收见[杭州分层证据](../evidence/qa/content-intake-p2-hangzhou/README.md)，不覆盖后续回退/同题家族。

专项验收：

```sh
pnpm test:intake:synthetic
pnpm test:intake:desktop
```

前者包含真实 HTTP/PG 产物消费及 CLI 子进程的启动、固定命令、EOF 和清理边界；后者需要 Mac 图形桌面，使用空候选宿主验证原生选择坏 XLSX → renderer/preload/Main → HTTP/PG解析失败 → 完整报告落盘并由 ExcelJS 回读 → 整批更正重传 → 检查与确认直发 → 换坐席查询并复制。OS 文件对话框使用受控路径、确认框使用受控取消/确认响应，其余链路实际执行。截图保存在 ignored `.gstack/intake-synthetic/`。这些是合成联调证据，真实组织接入、生产激活、安装包、Windows 合成器和 macOS 人工窗口体验仍分别验收。


## P2 FAQ 工作台

显式 `faq-v2` 合成模式复用原五个导航。侧栏 id `content` 显示「知识库」，默认打开本机人设知识库，不打开 `IntakeManagement`。切到概览、话术库、SOP、系统同步时，未发送的问题和未保存的权限预览仍留在挂载的页面里。会话失效仍由原 owner 处理，不因隐藏页面而停用。操作见[如何记下一条人设知识](how-to-operate-desk-knowledge.md)。

话术库按当前店铺和商品/场景条件读取有权查看的已发布资料，再按产品话术、活动话术、售前流程、售后流程展示。FAQ 是格式，不新增第五类。未选商品/场景只读相应通用资料；修改条件后点击“刷新可用资料”，没有全库、下架、导出或独立复制入口。普通客服继续在查询窗口查询复制。目录名称不可用时显示店铺编号，正文或资格失败时清空旧结果。系统同步显示同一读取结果的发布版本和截止，不表示公告已读、全库同步或软件更新；概览指标、SOP和软件更新显示“未接入”。

界面通过独立窄 IPC 读取 Main 的目录投影，不挂接旧资料适配器，也不共享 Query 的选店、资格与复制句柄。来源所属内容域取登记范围，在原上传选择器中显示；不得以文件名、标题或岗位推断。验证入口见[统一工作台](how-to-verify-desktop.md#faq-统一工作台)。


## P2 FAQ 原生上传

Dashboard 使用既有窄 `dashboard:intake-command` 接口。选择有 import 权限的来源，再选择不超过 10 MiB、符合该来源登记格式的规范 CSV 或统一模板 XLSX。界面必须明确确认整理责任人及所有实际改稿人；本人制作也须显式勾选本人，已确认的历史/禁用参与人可列入贡献声明，其身份事实不授予当前权限。来源、发布基线或当前主体事实变化时，重新展示声明并要求确认。

Main 保留原始字节、服务端对象、parse job 和上传/接收的原操作编号。结果不明时「按原请求重试上传」先重新核对权限，再重放原字节或正文；「刷新上传权限」不会丢弃未知操作。「停止本机等待」只中止本地等待，不撤销服务端解析或候选。没有公开 parse-job cancel 路由。已打开另一个候选时，上传历史不能替换其选择和未提交输入。

来源登记与原件格式不符时返回 `SOURCE_FORMAT_MISMATCH`，核对所选来源及其 CSV/XLSX 模板后重选原件，不自动转换或改写来源。真正的来源版本变化和未登记词项仍是 `SOURCE_MISMATCH`。数据库格式守卫明确回滚时返回相同格式错误；COMMIT 已开始但结果未知时仍按原请求恢复，不能当作格式错误重新发布。

解析进度按用户刷新读取。阻断错误不形成可发布候选；界面展示 totalIssues 和最多 100 条问题，CSV 坐标按逻辑记录计数，多行正文不增加记录号。两种输入的完整报告均为 XLSX，通过认证会话、MIME、8 MiB 字节预算及 30 秒限时下载，由原生保存框原子写入；下载/保存失败不能显示成功。修正全部问题后重新选择整个文件。解析成功接入已有来源确认、质量检查和二次确认发布流程，不因缺行推断删除；从当前候选点击「修订当前候选」，确认后上传完整修订稿；Main 固定旧键和来源，解析失败保留旧版，成功产生同 ID 下一版，来源确认和质量检查必须重新完成；旧 approval-v1 候选显式修订后为 direct-v1。

报告容量实测、有限文件读写、停止/恢复与完整消费的命令见[原生上传验证](how-to-verify-desktop.md#faq-原生上传与报告)。该切片没有新增生产 API 注册、真实飞书 transport 或运行 ACL。手动测试模板须为当前登记来源的合成资料；不得选择客户工作簿或员工文件。

用户最终从飞书表格导出 CSV；当前接线已支持规范 CSV 原件，不在客户端转换为 XLSX。实际原表仍需按已确认字段整理，首批来源及固定字段差异见[当前计划 §0.53](plans/2026-10-03-content-intake-requirements.md#053-角色上限与直发候选2026-10-08)。未把原表正文送入合成运行链，也未认领旧目录。

### 候选修订与取消

「修订当前候选」和「取消当前候选」只接受无参数意图。候选键、摘要和原操作编号由 Main 保存，API 在实际操作时重新验权与检查版本。处于发布中、已发布、已取消或已失效的候选不能修订/取消。取消成功使该候选版本不能发布，不会下架已发布内容。

取消结果不明时查询原回执或重试原请求，不能换编号重新提交，也不能凭网络错误宣称已取消。上传接收结果不明时同样保留完整旧键与原载荷。撤权会隐藏修订资料；尚未提交、也没有解析中的本地准备仍可明确清除，权限投影过期或断网不会阻止这一纯本地操作；随后重新选择有权候选仍须新鲜权限。解析进行中须先核对其终态，没有伪造的服务端解析取消入口。

## 运行接入准备与并行边界

本节记录合成链路之外的接入输入和拒启条件，不代表生产接入已经实现或获准。逐字段、历史协议、用途权限与旧目录认领的具体交接见[第三组运行接入交接](reference-content-intake-p2-contract-handoff.md#7-第三组运行接入交接2026-10-08候选未激活)。当前范围与批准依赖仍由[实施计划 §0.53](plans/2026-10-03-content-intake-requirements.md#053-角色上限与直发候选2026-10-08)拥有；真实组织、运行 ACL 和 `v2-active` 须绑定对应获准环境。

| 接入环节 | 现有消费边界 | 接入前必须提供或实现；缺失时的处理 |
| --- | --- | --- |
| 组织事实 | [现有飞书身份 provider](../apps/api/src/feishu-identity-provider.ts)取得登录身份；[事务所有者](../apps/api/src/content-intake/transaction.ts)另读 `principals/principal_facts/role_rules`，按部门 ID 与精确岗位匹配，并检查事实有效期和产品会话 | 职位来源已完成单次受控只读可行性核对，见[字段映射](reference-content-intake-p2-contract-handoff.md#职位来源与登录授权的当前映射2026-10-08)；仍须明确 tenant/app、登录身份到 principal 的归一依据、批准部门/岗位规则、人工店铺范围、事实刷新/版本发布与离职撤权来源及维护人。生产组织事实写入者尚未接线；缺字段、禁用、过期或刷新失败不能授予新使用/写入资格，不以登录角色替代，不延长五分钟事实窗口 |
| 历史审批兼容 | 新 direct-v1 不依赖审批 transport；旧 approval-v1 的材料与有效性只读保留 | 正式目录含旧审批谱系时，明确其有效性维护来源；不可伪造通过或绕过到期/撤销。缺有效依据时相应旧资料拒绝使用/继承/回退，不把接新审批流程列成本期目标 |
| 生产 factory | [管理 HTTP 插件](../apps/api/src/content-intake/management-http.ts)保留 auth/pool/store/principalLabels 与强制产品会话校验；[启动入口](../apps/api/src/server.ts)尚未装配 intake | 明确受控配置所有者、专用受限连接池、对象目录、真实组织依赖、启动后验与关闭清理。环境/配置/ACL/目录基线不满足不得启用；不得复制合成宿主管理员 pool、固定身份或测试标签 |
| 应用 ACL | [P2 基础迁移](../packages/database/migrations/0021_content_intake_v1_20.sql)及后续迁移保持应用角色对 intake 私有表/函数的权限封闭；业务事务还需锁定产品会话并写永久回执 | 按组织同步、业务事务、解析 worker、使用读取分别列出所需表/函数操作及角色；验证允许操作与越权拒绝，不能仅授 schema USAGE 或沿用管理员权限。用途 ACL 已按冻结 1.23 在 0033 接收并完成合成验证，生产账号与真实配置仍未装配；权限比预期更宽或必要操作不可用时拒绝启用，不修改既有 migration 来补权限 |
| 初始目录与旧内容认领 | [发布执行器](../packages/database/migrations/0024_intake_publication.sql)要求明确原生 catalog 基线；[合成 seed](../apps/api/tests/support/intake-synthetic-seed.ts)只为临时库建立空目录，不是正式承接工具 | 提供原发布基线、旧键到登记来源/稳定编号的映射、未归属清单、B1 维护人确认、来源范围和模式切换/回退条件。初始承接执行器仍需独立实现验收；未认领旧内容保留，缺基线、未迁移同域成员或范围冲突时拒绝发布，不以空目录、正文去重或自动归属绕过 |

显式同题家族与确认直发的合成闭环已完成。真实运行接入继续使用既有事项：组织可信观察/刷新、受限用途权限与运行装配、初始范围与旧内容认领；保留期未批准不删除历史。组织刷新与会话锁离线实验不等于生产装配。用户单独授权的只读职位观察没有进入这些验证链路，本指南命令始终只消费合成输入。历史审批失败映射保留用于旧资料兼容，不新增本期审批 transport 待办。

同题家族的材料、发布冲突、使用选择和数据库迁移由该功能所有者串行集成。运行接入准备不得并行改写发布指针、catalog/lineage、共享合同或新增 migration 序号；初始目录承接后续复用同一范围与家族校验，不另建规则。`content-intake.integration.test.ts`、合成 seed/host 是共用验证输入，改动须与集成负责人协调，避免组织有效期、谱系策略或基线变化使另一工作线的证据失效。

## 容量核对与历史保留（第二组）

四类对象共用 tenant 1 GiB：上传预留文件上限；服务端已知长度的报告/审核包预留实际长度（仍受输出上限约束）。已登记对象计实际字节；未采用、未知提交和清理失败计预留字节，不因等待时间自动释放。满额拒绝新对象，不影响已发布只读查询。失败/取消解析不能因为报告容量不足永久停留在 parsing；此时任务终结且无报告，解析结果为 `QUOTA_EXCEEDED`，已有候选不被替换。

在已批准的测试环境中，先构建 API，然后沿用既有干跑入口；仅传本次已获准的合成连接，不读取默认正式配置：

```bash
node scripts/content-retention.ts --group intake-objects --dsn "$SYNTHETIC_DATABASE_URL"
```

命令以只读一致快照返回已登记对象数量/字节、各预留状态的数量/占用及保护原因。`releasing` 表示已明确失败/重复对象的可重试释放；`reserved`/`persisted` 可能仍在进行或提交结果未知，必须保留。该输出是数据库账本核对，不代表完成整个磁盘的孤儿扫描；未知磁盘对象不删。`--apply`、与旧组混用、缺显式 DSN 均拒绝。历史保留期仍待确认，本轮没有批准历史删除或后台清理调度。验证明细与已知限制见[第二组证据](../evidence/qa/content-intake-p2-capacity/README.md)。

## 组织事实刷新离线验证

```sh
pnpm --filter @customer-agent/api test:intake:organization
```

该命令构建已有运行依赖，覆盖原生观察、writer PG、回环 HTTP、共享令牌生命周期、版本化登记/provenance 与原子撤销测试；当前数量及结果以[本轮补齐证据](../evidence/qa/intake-parallel-recovery/runtime-completion/README.md)为准，需要 Node 24 和现有 PG15 harness。单一写入器位于 `apps/api/src/content-intake/organization/facts-writer.ts`，与观察及登记刷新一起进入可构建模块；仅显式合成宿主装配，不注册生产 HTTP、不查询飞书或读取环境凭据。临时非 owner 账号只负责已登记主体的事实追加与版本/代际推进；实际登录、岗位/业务授权及使用资格消费者沿用现有实现。正式迁移0033已安装用途能力，环境运行账号仍只在合成宿主内创建。

输入要求、提交未知恢复、验证证据与缺口见[组织刷新验收](../evidence/qa/intake-organization/README.md)。这里的 snapshot 是可信观察方提供的内部实验输入，不是飞书原始响应，也不是允许 renderer 调用的接口。重试须保留原快照和 expectedFactsVersion，历史成功不表示当前权限有效；没有观察到新事实时不能人为修改时间延长有效期。


该入口现同时覆盖原生形状合成响应 → 精确职务映射 → 既有受限写入器 → 当前使用资格消费者。观察模块与 writer 由 src 单一所有者提供，回环 transport 仍在实验目录；失败不产出可写快照，未知写入必须重试成功观察时保留的原快照。该命令不读取真实通讯录，不能证明生产认证、限流、上游缓存/原子快照或即时离职事件。具体边界见[组织观察交接](reference-content-intake-p2-contract-handoff.md#原生组织观察离线切片2026-10-08)及[本轮证据](../evidence/qa/intake-organization/native-observer/README.md)。

新增 `http-transport.ts` 仅接受固定 `http://127.0.0.1:端口`，令牌由合成调用方注入并只在内存短期缓存；禁止重定向、隐式重试和环境凭据。请求/响应预算、限流、取消及异常释放由 transport 拥有；正式飞书 origin/认证装配保持关闭。早期四项 PG 证据使用过 harness 管理池；本轮正式用途消费另有新证据，不能把旧结果冒充新装配。证据及修复见[HTTP 观察验收](../evidence/qa/intake-organization/http-transport/README.md)与[回收记录](../evidence/qa/intake-parallel-recovery/README.md)。

## 历史会话锁离线实验

```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/intake-runtime-boundary.integration.test.ts
```

使用现有 PG15 harness 新建隔离集群，只装载合成身份/空目录。测试固定旧32段基线，先证明历史会话锁 SELECT-only 拒绝，以及为锁授予身份安全列 UPDATE 的风险，再安装 experiments 中的窄函数并以非 owner 账号验证取锁/截止/撤销/权限；测试结束关闭临时集群。SQL 仅是候选，不得复制到已有数据库或生产 migration。通过不代表完整受限用途账号或生产 factory 已具备，详细结论见[证据](../evidence/qa/intake-runtime-boundary/README.md)。

## 用途权限与装配依赖离线检查

先构建运行产物，再在一次性 PG15 上执行本专项；依赖和锁文件未变化时不安装。

```sh
pnpm build:services
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/intake-runtime-assembly.test.ts tests/intake-runtime-assembly.integration.test.ts
```

`purpose-acl.sql` 仅由测试安装四用途 LOGIN 与 NOLOGIN 函数属主，不是 migration 或生产 bootstrap。`createIntakeRuntimeAssembly` 检查 parser/权限/来源模式/目录等依赖；缺认领仅返回 `checked-not-activated`、`ready:false`，没有启动服务。检查中关闭/取消拒绝迟到结果，并发启动拒绝；连接由调用方借入并负责关闭，本模块不能中止已发出的 DB 查询。

`createPurposePrivilegeProbe` 保留旧 SQL 探针证据，实验测试显式使用旧32段基线。正式实际消费者现在使用 `src/content-intake/runtime-pool.ts`，不改写SQL，直接消费0033。业务/usage借独立用途池，失败收尾借worker `terminalPool`；COMMIT未知不回滚或释放占用。下列专项覆盖原service，HTTP/剪贴板由后述宿主和Electron验收补齐，生产HTTP仍不注册。
```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/intake-runtime-consumers.integration.test.ts
```

验证与剩余条件见[本轮补齐](../evidence/qa/intake-parallel-recovery/runtime-completion/README.md)及[实验接线说明](../apps/api/experiments/intake-runtime/INTEGRATION.md)。

## 正式用途合同贯穿合成 HTTP 与本机 Electron

显式 `purpose-runtime` 使用当前完整的35段迁移；四个环境LOGIN只借各自NOLOGIN能力，每次取连接都经过 `assert_purpose`。组织池实际完成合成绑定登记、双扫描观察及带provenance事实写入；业务/usage/worker复用原service。旧候选安装器和SQL改写桥不在这条运行链上，生产app/server不注册新路径。

```sh
pnpm build
CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 CUSTOMER_AGENT_INTAKE_PURPOSE_RUNTIME=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-real-stack.spec.ts tests/e2e/content-intake-rollback-real-stack.spec.ts tests/e2e/content-intake-permissions-real-stack.spec.ts tests/e2e/content-intake-shop-directory-real-stack.spec.ts tests/e2e/content-intake-workspace-real-stack.spec.ts
```

名称目录仅服务查询可见性。Main完整读取所有页，核对 shopId 与已授权店铺集合一致后展示名称；同名附编号，更名/失效重新加载，失败保留编号并提示。名录不会新增授权，也不延长查询资格。当前五规格组合的 Mac 合成复跑为 8/8，通过日志见[五规格复跑](../evidence/qa/intake-unified-workspace/electron-five-spec-rerun-2026-10-09.log)；原专项的数量、日志和失败边界仍见[正式合同合成接入](../evidence/qa/intake-parallel-recovery/runtime-formal/README.md)。真实维护/登记范围、密钥托管、生产账号与实时飞书仍不在这些合成命令内。
