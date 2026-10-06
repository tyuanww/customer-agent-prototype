# 如何验证合成资料导入

本入口验证已授权的合成开发，不读真实工作簿、员工或飞书凭据。P1 探针不启动桌面/API/数据库；下方 P2 命令启动独立 Unix socket PostgreSQL，退出后移除该临时集群。完整 FAQ 产品闭环仍待真实审批 transport、发布与坐席接线。

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

商品/场景单元格以英文逗号分隔稳定 ID；服务端只解析同品牌/域且属于品牌通用或当前店的已登记词项。正文和问法分别分配版本，缺行继承。来源版本尚未确认时材料记为 unknown，等待独立确认；不从文件时间推断新旧。`对应通用条目` 的非空内容暂时阻断，直到跨来源覆盖与发布冲突检查完成。发布、使用资格、旧写隔离、注册生产角色与真实数据不属于这个事务切片的通过结论。

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

`ready` 不是发布回执。尚未实现 P2 原子发布、短票据、质量/负责人承接映射、旧写 fence、使用资格和桌面接线；应用角色仍无新 schema 权限。后续发布必须在锁内重新验证全部门，不能信任早先 GET 或幂等回执里的 readiness。详细证据见[审批证据验收](../evidence/qa/content-intake-p2-evidence/README.md)。

## P1 测量含义与未验证范围

探针分别运行 500 行与 5000 行（10 倍）样例各 10 次，均含六页、排除页合并单元格和八个图片引用；报告进程总延迟 p95/p99、子进程 maxRSS、Node 调用方事件循环 p99、取消到退出耗时、网络尝试数。n=10 的尾值相当于样本最大值，不是 SLA。5000 行不是同量真实内容的容量证明。

唯一预算在 `src/policy.ts`。前置检查覆盖文件字节、ZIP 数量/重复路径/实际展开量、宏/外部关系/XML、坐标/共享字符串/单值与媒体预算。所选页媒体尚未支持就明确阻断；未选页内容不入规范结果，但仍经过资源安全检查。只传有限字节和固定 context 给子进程，不传会话环境。进程取消/超时等待退出后再收新任务。

另对选中页实际读取文本累计设置 300 万 UTF-16 单元预算（`normalizedTextChars`），重复共享字符串按每次引用计数。它在结果序列化前拒绝放大输入，保留 JSON 转义、重复行字段和元数据的输出空间；单格、行数、ZIP 和输出预算须同时满足，不能把各上限相乘当作保证容量。

P1 探针本身未验证：CSV 规范入口、SOP 图与媒体导入、商品/场景词项存在性、正式稳定版本分配、来源先后事实、持久 candidate/幂等/PG 竞态、真实飞书人工审批/附件和多客户端、Electron utilityProcess 打包、Windows/Linux/真实 Main 延迟、OS 级内存与出站限制。网络入口观测为零不能证明 OS 无网络能力；`--max-old-space-size` 不限制全部 RSS/Buffer。DB 查询量为 0，是本探针不调用数据库，不能替代 10 倍存量的 PG 查询计划验证。

依赖审计单列新增生产依赖与全仓已有项。ExcelJS 只使用 uuid.v4，锁到仍提供 CommonJS 的 uuid 11.1.1；minimatch 的 brace-expansion 按兼容 major 锁修复版。新增包沿用现有 Vitest 3.2.7，未启动它的 UI/browser 服务；既有工具链公告不代表本轮已修复。

P2 已覆盖的词项、版本、候选与 PG 场景见[事务验收](../evidence/qa/content-intake-p2-transactions/README.md)，不沿用 P1 的零数据库查询结论。

实际运行结果链接由[执行计划 §0](plans/2026-10-03-content-intake-requirements.md)维护。
