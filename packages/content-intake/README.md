# 合成 FAQ 规范解析

`parseWorkbook(bytes, fixedContext)` 用 ExcelJS 读取标准 FAQ 模板，返回规范行、相似问法、排除页统计与错误坐标。`createTemplate` / `writeIssueReport` 生成可重新打开的 XLSX。`createParseRunner().parse` 拥有单个解析子进程、超时、取消与退出；取消完成后才释放槽位。

这是 P1 技术验证与 P2 API 合成事务共用的规范解析包。API 事务执行器通过 runner 消费；隔离合成 HTTP 与桌面 Main/preload/界面已接通上传、校验及报告读取，renderer 不直接运行解析器。正式生产服务尚未装配。来源事实由调用方固定；权限、风险与审批摘要归 API。任何阻断项返回空结果，不能把好行单独发出去。公式、宏、外部关系不执行；所选页的图片/附件暂时阻断并说明，排除页图片可计数。词项存在性及持久候选由 API 事务模块校验；完整媒体语义尚未支持。不能把这里的格式通过当成可发布。

`archive.ts` 在 ExcelJS 对象模型分配前流式检查成员、实际展开量、XML/稀疏坐标/单值预算。独立进程只收到字节和固定上下文，环境为空；网络观测拦截常用 Node 入口。此观测不等于 OS 网络沙箱，V8 heap 参数也不等于 RSS/Buffer 上限。

`parseWorkbook` / runner 的固定解析上下文必须显式提供 `scopeKind: 'brand' | 'shop'`；不能从范围标签是否等于 `brand` 推断权限。仅生成模板的 `createTemplate` 接收省略 `scopeKind` 的上下文，不承担授权判定。`parseFamilyReference` 按 `sourceId/businessEntryId` 解析 K 列「对应通用条目」；空单元格清除关联，缺行继承由 API 拥有。家族根、范围及冲突检查由发布数据库守卫拥有，格式通过不代表允许覆盖。

运行、限制与实际证据见[开发配方](../../docs/how-to-develop-content-intake.md)；历史 P1 差集见[合同差集](../../docs/reference-content-intake-p1-contract-gap.md)，当前接收及消费状态见[P2 合同交接](../../docs/reference-content-intake-p2-contract-handoff.md)。
