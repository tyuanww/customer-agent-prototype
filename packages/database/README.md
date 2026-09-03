# @customer-agent/database

PostgreSQL 15 控制面深模块。它从已验证的合同 snapshot 确定性生成十个不可变 migration，并把来源、顺序、checksum、session advisory lock、逐 migration 事务、私有账本和精确 catalog/ACL/函数定义后验封装在 `status → plan → apply → verify` 接口内。前九段是已签 `schema.v1.12` 基线，第十段是 `schema.v1.13` 的受控 search projection 升级；公共 status/plan 只返回 provenance 元数据，不暴露可执行 SQL。

生成命令会先在同一文件系统完整暂存 migration 目录与内嵌 catalogue 目录，再进行目录级替换；普通 I/O 失败会把两个目录一起回滚，避免留下已知的新旧混合生成物，额外旧成员也会在成功发布时被移除。

本包不读取环境变量、不创建连接、不接 API / desktop，也不接触真实数据或飞书。调用方必须提供一个已经连接、具备 migration owner 权限的 `pg.Client` 或已 checkout 的 `PoolClient`；裸 `pg.Pool` 和同一 client 上的并发控制面操作会在查询前被拒绝。生产运行身份不得拥有 DDL 或账本写权限。

```bash
pnpm db:migrations:generate
pnpm db:migrations:check
pnpm test                    # database unit + compiled-package smoke，无 PG15 前置
pnpm test:db                 # database 全门禁，含隔离 PG15
pnpm test:db:integration     # 仅隔离 PG15 集成门禁
```

PG15 集成门禁需要 `pg_config` 解析到 PostgreSQL 15，或设置 `CUSTOMER_AGENT_PG15_BIN=/path/to/postgresql-15/bin`。当前同时证明 `schema.v1.13` clean install，以及精确已签 `schema.v1.12` ledger 只规划并执行 `0010` 的 `N-1 → N`；未知、缺失、改写或额外 ledger 仍失败关闭。本地测试使用一次性 PostgreSQL 15 cluster 和合成数据，不构成托管 PG、备份恢复、部署或生产认证。

仓内其它 package 若需复用同一临时 PG15 证据面，只能以 devDependency 导入显式 `@customer-agent/database/testkit` 子入口；它不属于 migration/runtime 公共入口，也不得进入生产请求链。
