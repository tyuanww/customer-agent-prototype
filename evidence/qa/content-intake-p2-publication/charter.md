# P2 原生发布功能冒烟

调用方 /review；5 分钟、最多 12 个探针。仅功能面，无浏览器或真实租户。

范围：正式 IntakePublish 输入通过 sealed service 消费合成 XLSX、审批附件及冻结质量；成功后必须回读 release、catalog/lineage、current、announcement 与永久回执；最高风险是最终公告失败或 COMMIT 丢响应造成部分发布、以及取消/撤权竞争。

入口：apps/api/tests/content-intake.integration.test.ts。所有 fixture 在 Pg15Harness 新建临时数据库内，Unix socket、对象目录均由测试拥有，afterEach 关闭 pool/client 并销毁集群。只允许该临时状态与报告目录写入；不接 HTTP、网络服务、真实 Feishu 或生产 pool。运行 Node 24/pnpm 11.19.0/本地 PostgreSQL15。

第一探针用 publishes native 成功用例验证真实持久结果；下一探针由实际输出决定。退出条件：成功与最高风险边界通过，或到期/失败/环境阻塞。全仓和计划必需检查另行记录，不受冒烟预算限制。源/测试/合同/命令及 fixture 哈希最后统一绑定。
