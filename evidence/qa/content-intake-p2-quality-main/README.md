# Main 质量检查合成验收

2026-10-07，接续冻结的 OpenAPI1.18/schema1.21。Main 接实际 ProductSession，管理候选、分页、人工检查与原操作恢复，当前只有隔离合成消费者，没有管理 UI 或生产入口。

已运行定向 33 项（Main20、ProductHttp13）通过，根 typecheck 通过。样本原文与 hash 归服务端；Main 不自动勾选，缺项不能提交，扩样保留初样。丢响应后缺回执/后续权限拒绝都保留原键；已知首次 413 保留人工草稿，允许只缩短超限原因后用新键提交。旧会话迟到请求不得抹去新会话状态，32MiB总样本上限失败不返回半页。

实际 PG 根探针通过 Main 冻结后丢响应、GET同键回执恢复、完整加载/人工检查/提交，再发布至第二坐席消费。最终 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均在修后代码通过，workspace 检查通过。OCR delegate 审查 3/3、宿主补查 8/8 测试和文档；原生独立复审发现首次 413 会清掉人工草稿的 P2，已修复并独立复现确认。最终无剩余确认缺陷，未调用外部模型。详细输入/时间/日志在忽略目录 `.gstack/qa-reports/content-intake-quality-main/`。

恢复状态仅 Main 内存存活期间有效。后续管理 UI 必须提示未恢复操作；本轮没有声称跨应用重启恢复，没有改生产 factory、IPC权限、真实审批/数据、原生 Mac/Windows 或打包。
