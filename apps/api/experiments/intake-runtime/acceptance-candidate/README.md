# 本机验收用合同候选副本

这六个 SQL 是治理仓组合候选的逐字副本，只供一次性 PG15 合成验收。它们不属于正式 migration、生产 factory 或已 intake 合同。`manifest.json` 以文件 SHA-256 绑定当时治理候选内容；治理提交映射由主集成任务补充，不把工作内容伪称冻结版本。

测试所有者是 `tests/support/intake-runtime-candidate.ts`：先比对产品 32 个 migration 源文件及数据库实际安装 ledger，再以单一事务按 manifest 顺序安装。只有 `tests/support/intake-synthetic-host.ts` 的显式 `purpose-candidate` profile 消费本目录。生产 `app.ts` / `server.ts` 没有导入它。

环境创建 `synthetic_*` LOGIN NOINHERIT 账号，各仅获得一个 NOLOGIN capability。每次取连接先 SET ROLE，再调用 `intake_runtime.assert_purpose` 验证当前用途。原有实际 service 拥有主体、范围及业务规则；此 ACL 是受信 service 的用途边界，不声称直接 SQL 按最终用户隔离。组织池只做身份预检，本轮桌面路径不写组织事实。

会话锁只由既有实验 `consumer-pool.ts` 精确适配一条 pinned SQL，其他 SQL 原样调用。management HTTP 继续内部创建唯一、要求产品会话的 service，新增可选 `terminalPool` 仅用于它已有的失败收尾依赖；usage HTTP 注入 usage service。关闭宿主先停止 HTTP/解析队列，再关闭自有连接池和一次性 PG。旧 probe 保留独立 SQL 与历史证据。

本轮真实桌面暴露的两项缺口回到同一治理候选修正：usage 发现菜单需只读 `policy_versions`；business 候选取消需精确 `write_attempts` 列授权，并叠加仅 cancel pending→cancelled 的触发守卫。没有把发布或回退写入权交给 business 直接冒充结果。

验证证据见 `evidence/qa/intake-release-acceptance/README.md`。未来正式接入应由批准的版本化 intake 替换此测试安装边界；不能把候选副本直接注册到生产工厂。
