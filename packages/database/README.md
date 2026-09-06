# @customer-agent/database

PostgreSQL 15 控制面深模块。它从已验证的合同 snapshot 确定性生成十二个不可变 migration，并把来源、顺序、checksum、session advisory lock、逐 migration 事务、私有账本和精确 catalog/ACL/函数定义后验封装在 `status → plan → apply → verify` 接口内。前九段是已签 `schema.v1.12` 基线，第十段是已复核 `schema.v1.13` 的受控 search projection 升级，第十一段是 `schema.v1.14` 的 ready-no-hit 搜索上下文升级；第十二段以一个事务安装 `schema.v1.15` 的完整负责人承接后缀；公共 status/plan 只返回 provenance 元数据，不暴露可执行 SQL。

生成命令会先在同一文件系统完整暂存 migration 目录与内嵌 catalogue 目录，再进行目录级替换；普通 I/O 失败会把两个目录一起回滚，避免留下已知的新旧混合生成物，额外旧成员也会在成功发布时被移除。

本包不读取环境变量、不创建连接、不接 API / desktop，也不接触真实数据或飞书。调用方必须提供一个已经连接、具备 migration owner 权限的 `pg.Client` 或已 checkout 的 `PoolClient`；裸 `pg.Pool` 和同一 client 上的并发控制面操作会在查询前被拒绝。生产运行身份不得拥有 DDL 或账本写权限。

```bash
pnpm db:migrations:generate
pnpm db:migrations:check
pnpm test                    # database unit + compiled-package smoke，无 PG15 前置
pnpm test:db                 # database 全门禁，含隔离 PG15
pnpm test:db:integration     # 仅隔离 PG15 集成门禁
```

PG15 集成门禁需要 `pg_config` 解析到 PostgreSQL 15，或设置 `CUSTOMER_AGENT_PG15_BIN=/path/to/postgresql-15/bin`。当前同时证明 `schema.v1.15` clean install、精确 `schema.v1.12` / `v1.13` / `v1.14` ledger 分别只执行 `0010+0011+0012` / `0011+0012` / `0012`；未知、缺失、改写或额外 ledger 仍失败关闭。本地测试使用一次性 PostgreSQL 15 cluster 和合成数据，不构成托管 PG、备份恢复、部署或生产认证。

仓内其它 package 若需复用同一临时 PG15 证据面，只能以 devDependency 导入显式 `@customer-agent/database/testkit` 子入口；它不属于 migration/runtime 公共入口，也不得进入生产请求链。

负责人承接迁移保留 0001–0011 的原字节与来源，将完整新合同的六段增量按来源行号提取为单个事务，最后更新 schema marker。`app_owner_acceptance_registrar` 为未绑定登录的 NOLOGIN 能力角色；合同要求安装时不存在同名角色，遇到既有角色即回滚本段并保留可追踪的旧账本前缀。因此隔离测试各自使用独立 cluster，不向共享 cluster 重复安装。runtime 无登记、撤销或登记表读取权限，当前不授权真实装载。
