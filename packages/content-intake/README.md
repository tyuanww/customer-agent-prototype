# 合成 FAQ 规范解析

`parseWorkbook(bytes, fixedContext)` 用 ExcelJS 读取标准 FAQ 工作簿；`parseCsv(bytes, fixedContext)` 原生读取标准 CSV。两者复用 FAQ / 问法规则，返回规范行和错误坐标。`createTemplate` / `writeIssueReport` 生成可重新打开的 XLSX。`createParseRunner().parse` 拥有单个解析子进程、超时、取消与退出；取消完成后才释放槽位。

`parseSopWorkbook(bytes, fixedContext)` 是当前首期 SOP 的合成候选，不由 runner 或生产 API 选择。它只接受登记上下文中的六个工作表，按工作表行收集非空文字并保留列顺序与换行，把同一行的内嵌 PNG/JPEG/GIF 提取为受限附件元数据；图片所在行没有文字时整批拒绝。纯数字单元格按文字保留，公式和日期仍拒绝。飞书或 WPS 在富文本前写出的空 `<t/>` 会先去掉，否则 ExcelJS 读不开工作簿。SOP 分类保留原工作表名称，版本优先使用明确的“版本/版本号”字段，否则使用原文件 SHA-256。这个候选尚未进入冻结合同、HTTP 或数据库；FAQ、售前、售后、活动仍使用现有 23 列 CSV/XLSX 解析器。格式通过不等于已发布。

`projectMenokinSopSourceRows` 把已提取的扁平来源行投影成“场景目录、执行任务、判断分支、客户话术、知识与案例、资源与图片”六表候选。它固定五类严重度顺序，并把无法确定的节点、分支目标、话术风险或媒体绑定保留为 blocker。候选图的引用键、来源分组、终止出边和循环也必须通过独立拓扑门禁。调用方仍须把它限制在获批的合成 profile；这仍不代表 API、数据库、发布或正式合同已接通。

`parseMenokinFlatSopWorkbook(bytes, options?)` 是扁平一维 Menokin 源的只读解析边界。它只接受一个名为「特殊流程 SOP」的 18 列工作表，按行生成来源摘要和稳定行身份。D1～D7、DS 映射为步骤 3 下的执行节点，E1、E2 映射为终止节点，其他值保留未决节点。WPS `DISPIMG` 和内嵌图片只保留 MIME、字节数和内容摘要，不输出路径、关系 ID、公式或图片字节。来源行、工作簿和受控图片适配器任一失败都会清空全部 rows。该入口不是正式合同、API、数据库或发布器。

这是 P1 技术验证与 P2 API 合成事务共用的规范解析包。API 事务执行器通过 runner 消费；隔离合成 HTTP 与桌面 Main/preload/界面已接通上传、校验及报告读取，renderer 不直接运行解析器。正式生产服务尚未装配。来源事实由调用方固定；权限、风险与审批摘要归 API。任何阻断项返回空结果，不能把好行单独发出去。公式、宏、外部关系不执行；所选页的图片/附件暂时阻断并说明，排除页图片可计数。词项存在性及持久候选由 API 事务模块校验；完整媒体语义尚未支持。不能把这里的格式通过当成可发布。

`archive.ts` 在 ExcelJS 对象模型分配前流式检查成员、实际展开量、XML/稀疏坐标/单值预算。独立进程只收到字节和固定上下文，环境为空；网络观测拦截常用 Node 入口。此观测不等于 OS 网络沙箱，V8 heap 参数也不等于 RSS/Buffer 上限。

`parseWorkbook` / runner 的固定解析上下文必须显式提供 `scopeKind: 'brand' | 'shop'`；不能从范围标签是否等于 `brand` 推断权限。仅生成模板的 `createTemplate` 接收省略 `scopeKind` 的上下文，不承担授权判定。`parseFamilyReference` 按 `sourceId/businessEntryId` 解析 K 列「对应通用条目」；空单元格清除关联，缺行继承由 API 拥有。家族根、范围及冲突检查由发布数据库守卫拥有，格式通过不代表允许覆盖。

运行、限制与实际证据见[开发配方](../../docs/how-to-develop-content-intake.md)；历史 P1 差集见[合同差集](../../docs/reference-content-intake-p1-contract-gap.md)，当前接收及消费状态见[P2 合同交接](../../docs/reference-content-intake-p2-contract-handoff.md)。

CSV 的 `faq-csv-v1` / `intake-csv-v1` 已随 OpenAPI 1.22.0 / schema.v1.24 正式冻结并静态接收，唯一解析实现位于 `src/csv.ts`。`createCsvTemplate` 生成固定 23 列标准文件；`experiments/csv/synthetic-template.csv` 保留为原字节合成样例。runner 按可信上下文的模板版本选解析器，不能由文件名、客户端 MIME 或文件内来源字段决定范围。API 从已登记完整格式元组校验 MIME、映射与结构摘要，再从对象存储独立重算原字节摘要；CSV 不转换为 XLSX。调用同步 `parseCsv` 仅适用于隔离子进程或受控离线验证，不能放入 Main / HTTP 事件循环。

`isParseResult` 可读取两种已支持规则版本的历史报告；runner 另外传入本次预期规则，拒绝格式串线的进程输出。CSV 的问题坐标为逻辑记录号，首条数据为第 2 行，多行字段不增加记录号；报告仍为实际 XLSX。完整接线及合成验收的证据边界见[当前计划 §0.53](../../docs/plans/2026-10-03-content-intake-requirements.md#053-角色上限与直发候选2026-10-08)，不构成真实资料或生产运行激活。

`prepareMenokinSopReview(bytes, { selection?, review? })` 是本机受控 SOP 转换入口。它与原 parser 的 `sourceRows` 共用同一次安全读取，但只从新增的 `flatFacts` 取事实。`flatFacts` 保留真实物理表名、行号、行摘要、18 列原显示文字与规范文字、图片摘要；不使用旧 `sourceRows` 的 D1 节点推断、空路径目标或分组名作为物理表名。普通换行和首尾空白只在规范值中处理。路径选择、字段、操作说明、话术、快捷语、前提条件、判断维度、类型判断、症状描述与图片列的显式「无」在规范值中表示空项，原显示文字仍保留。图片公式只读取已有缓存显示值，并把受控原始公式对象保存在 `formulaSource`。无可用缓存时 `originalDisplayText` 为 `null`，不把未知显示值写成空格内容，不执行公式或跟随外链。源 SHA 与原图片引用摘要继续绑定。解析失败同时清空 `sourceRows` 与 `flatFacts`。

没有审核记录时返回 `needs-review`，不根据步骤名称、类型识别、编号或行顺序生成任务与边。报告包含全部物理行的映射、待确认或显式排除状态，以及媒体事实和待确认项。可用 `selection.rowIds` 指定批准的原行范围，`selection.flowIds` 指定要输出的完整流程。选择摘要同时绑定源文件 SHA、规则和六表表头；旧文件或旧选择的审核返回 `STALE_REVIEW`。重复决定、未知字段、错列、伪原句、非法关联不产生计划。先验证全部审核实体的业务 ID 唯一性、父流程 / 父任务、引用与完整图闭包，再按流程裁剪。重复或悬空实体保留在报告并阻断计划；只有归属于真实独立流程的完整实体才能被流程选择排除。已知资源范围也先与拥有流程核对，资料须相等，图片须满足 native 的范围包含关系，包含版本号。来源登记仍由 API 拥有。

审核格式由公开类型 `MenokinSopReviewRecord` 定义。一个负责人填写实际 `reviewer`、`reviewedAt` 与整体 `basis`，在同一记录中明确完整流程、范围、任务类型、确认项、分支、可见对象和关联，不增加额外审核人或逐单元格签字。每个六表实体显式填写 `maintenance: "启用"`，本入口只准备首批新增内容；既有停用另走现有 native 流程。字段可用 `kind: "reviewed"` 明确填写值，或用 `kind: "source"` 绑定原行、列、UTF-16 起止位置与精确原句。混合行可只提取获批原句，拼接符也必须明确。缺省普通字段按 native 六表约定写空字符串；必需字段空白继续阻断。省略源行审核不会悄悄丢行。

通用 `holds` 保留任意业务待确认项，不按真实行号硬编码。`appliesTo: { kind: "rows" }` 阻断使用对应原行的流程；明确排除的原行不进入作者计划。`{ kind: "flows", flowIds: [...] }` 明确其影响的真实流程，目标必须存在并与声明的来源行有审核图归属关系，适用于同一行包含已确认和未确认原句的情况。未知流程 ID 或无来源关联的 hold 始终阻断。解除必须在同一负责人记录中写出 `kind: "resolved"` 与实际 `resolution`。显式选择的完整依赖闭包仍未确认时返回 `needs-review`；未选择的真实完整流程可以保留 pending hold，并将它留在报告。仍被选中但没有映射的 pending 原行持续阻断，负责人须明确映射或用 `excluded` 与原因排除，不能靠无映射推断范围外。审核报告的六表行始终标记为待确认并保留相关 hold 原因，native parser 直接消费报告表会拒绝。只有无阻断的 `authoringPlan.tables` 写入启用、实际审核人并清空待确认事项。所有源行继续保留在报告中。

`authoring-ready` 返回六表作者计划、完整审核来源、图片原行与内容 SHA 绑定，以及必须实际登记的 flow、entry、image ID 清单。计划不含伪造的来源权威、风险分级或登记元数据，也不代表 native 导入、来源登记、发布或 Windows 试用验收通过。图片字节和 XLSX 写出由已有仓外受控作者流程负责；产品包不依赖 Codex / ArtifactTool 运行时。真正导入仍经过 `parseSopTaskWorkbook`、API `prepareImport`、媒体登记与 `makeMaterial/validateGraph`。

本机 CLI 使用已构建包，所有含原文的 JSON 只写入仓外新建私有目录，不覆盖既有输出。stdout 只打印 `needs-review` / `authoring-ready` / `invalid-input` 状态；输入/输出错误只给固定错误码。示例路径为仓外占位符。

```sh
pnpm --filter @customer-agent/content-intake build
node packages/content-intake/scripts/menokin-sop-review.mjs \
  --source /private/tmp/sop-controlled/source.xlsx \
  --output-dir /private/tmp/sop-controlled/review-new
node packages/content-intake/scripts/menokin-sop-review.mjs \
  --source /private/tmp/sop-controlled/source.xlsx \
  --review /private/tmp/sop-controlled/review-record.json \
  --selection /private/tmp/sop-controlled/selection.json \
  --output-dir /private/tmp/sop-controlled/authoring-new
```

`--review` 和 `--selection` 均可省略。首次运行输出 `report.json`，就绪时另输出 `authoring-plan.json`。审核记录中的 `sourceSha256` 与 `targetDigest` 使用相同选择下首次报告的值；审核人、时间与确认意见必须实际提供，不能用首次报告填补。文件权限为 `0600`，目录权限为 `0700`。合成端到端回归位于 `tests/menokin-sop-review.test.ts` 与 API `tests/menokin-sop-review-consumer.test.ts`。
