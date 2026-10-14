# 合成 FAQ 规范解析

`parseWorkbook(bytes, fixedContext)` 用 ExcelJS 读取标准 FAQ 工作簿；`parseCsv(bytes, fixedContext)` 原生读取标准 CSV。两者复用 FAQ / 问法规则，返回规范行和错误坐标。`createTemplate` / `writeIssueReport` 生成可重新打开的 XLSX。`createParseRunner().parse` 拥有单个解析子进程、超时、取消与退出；取消完成后才释放槽位。

`parseSopWorkbook(bytes, fixedContext)` 是当前首期 SOP 的合成候选，不由 runner 或生产 API 选择。它只接受登记上下文中的六个工作表，按工作表行收集非空文字并保留列顺序与换行，把同一行的内嵌 PNG/JPEG/GIF 提取为受限附件元数据；图片所在行没有文字时整批拒绝。纯数字单元格按文字保留，公式和日期仍拒绝。飞书或 WPS 在富文本前写出的空 `<t/>` 会先去掉，否则 ExcelJS 读不开工作簿。SOP 分类保留原工作表名称，版本优先使用明确的“版本/版本号”字段，否则使用原文件 SHA-256。这个候选尚未进入冻结合同、HTTP 或数据库；FAQ、售前、售后、活动仍使用现有 23 列 CSV/XLSX 解析器。格式通过不等于已发布。

这是 P1 技术验证与 P2 API 合成事务共用的规范解析包。API 事务执行器通过 runner 消费；隔离合成 HTTP 与桌面 Main/preload/界面已接通上传、校验及报告读取，renderer 不直接运行解析器。正式生产服务尚未装配。来源事实由调用方固定；权限、风险与审批摘要归 API。任何阻断项返回空结果，不能把好行单独发出去。公式、宏、外部关系不执行；所选页的图片/附件暂时阻断并说明，排除页图片可计数。词项存在性及持久候选由 API 事务模块校验；完整媒体语义尚未支持。不能把这里的格式通过当成可发布。

`archive.ts` 在 ExcelJS 对象模型分配前流式检查成员、实际展开量、XML/稀疏坐标/单值预算。独立进程只收到字节和固定上下文，环境为空；网络观测拦截常用 Node 入口。此观测不等于 OS 网络沙箱，V8 heap 参数也不等于 RSS/Buffer 上限。

`parseWorkbook` / runner 的固定解析上下文必须显式提供 `scopeKind: 'brand' | 'shop'`；不能从范围标签是否等于 `brand` 推断权限。仅生成模板的 `createTemplate` 接收省略 `scopeKind` 的上下文，不承担授权判定。`parseFamilyReference` 按 `sourceId/businessEntryId` 解析 K 列「对应通用条目」；空单元格清除关联，缺行继承由 API 拥有。家族根、范围及冲突检查由发布数据库守卫拥有，格式通过不代表允许覆盖。

运行、限制与实际证据见[开发配方](../../docs/how-to-develop-content-intake.md)；历史 P1 差集见[合同差集](../../docs/reference-content-intake-p1-contract-gap.md)，当前接收及消费状态见[P2 合同交接](../../docs/reference-content-intake-p2-contract-handoff.md)。

CSV 的 `faq-csv-v1` / `intake-csv-v1` 已随 OpenAPI 1.22.0 / schema.v1.24 正式冻结并静态接收，唯一解析实现位于 `src/csv.ts`。`createCsvTemplate` 生成固定 23 列标准文件；`experiments/csv/synthetic-template.csv` 保留为原字节合成样例。runner 按可信上下文的模板版本选解析器，不能由文件名、客户端 MIME 或文件内来源字段决定范围。API 从已登记完整格式元组校验 MIME、映射与结构摘要，再从对象存储独立重算原字节摘要；CSV 不转换为 XLSX。调用同步 `parseCsv` 仅适用于隔离子进程或受控离线验证，不能放入 Main / HTTP 事件循环。

`isParseResult` 可读取两种已支持规则版本的历史报告；runner 另外传入本次预期规则，拒绝格式串线的进程输出。CSV 的问题坐标为逻辑记录号，首条数据为第 2 行，多行字段不增加记录号；报告仍为实际 XLSX。完整接线及合成验收的证据边界见[当前计划 §0.53](../../docs/plans/2026-10-03-content-intake-requirements.md#053-角色上限与直发候选2026-10-08)，不构成真实资料或生产运行激活。
