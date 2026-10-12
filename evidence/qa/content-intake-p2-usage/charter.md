# 使用资格与按店目录功能冒烟

调用 /review；纯功能面；5 分钟 / 最多 12 个探针。权限覆盖本任务合成 PG 状态与证据文件。没有浏览器、生产 ACL、真实租户或网络审批。

合同：第二坐席从已发布原生候选读取当前店和独立品牌内容；内外部字段隔离；每页重验资格；词项总预算和条目分页一致。首探针证明完整发布后第二主体分页/重启消费及持久资格。下一探针依实际观察选择失效/词项边界。

入口 apps/api/tests/content-intake.integration.test.ts，复用真实 Pg15Harness Unix socket 临时数据库和自有对象目录；每用例 beforeEach 创建，afterEach 关闭并清理。对象只有 createTemplate 合成 XLSX、受控人工审批响应，无生产连接和凭据。命令用 Node24、pnpm11.19.0、PostgreSQL15。有限 capture 超时；达到成功和最高风险拒绝即可退出。完整检查另行运行。
