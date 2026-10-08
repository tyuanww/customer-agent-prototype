# @customer-agent/database

PostgreSQL 15 控制面深模块。它从已验证的合同 snapshot 与产品 overlay 确定性生成二十九个不可变 migration，并把来源、顺序、checksum、session advisory lock、逐 migration 事务、私有账本和精确 catalog/ACL/函数定义后验封装在 `status → plan → apply → verify` 接口内。前九段是已签 `schema.v1.12` 基线，第十段是已复核 `schema.v1.13` 的受控 search projection 升级，第十一段是 `schema.v1.14` 的 ready-no-hit 搜索上下文升级；第十二段以一个事务安装 `schema.v1.15` 的完整负责人承接后缀，第十三段安装 `schema.v1.16` 的身份和审核命名空间；第十四段以固定 definer 修复发布延迟校验权限，不给 app_content_admin 增加底表权限；第十五段追加 `schema.v1.18` 的 ops-loop 存储与 SECURITY DEFINER 入口；第十六至十九段为冻结的产品 overlay；第二十段接收 coach 发布合同，第二十一段安装未开放应用授权的 content_intake 存储，第二十二段追加旧写共存门及统一锁序；第二十三/二十四段为候选质量及原子发布 overlay；第二十五段接入 schema.v1.21 的不可变使用资格上下文，第二十六段追加来源授权检索索引，第二十七段实现私有纠正回退事务与独立审批谱系，第二十八段追加显式同题家族的完整目录守卫，第二十九段追加私有对象容量账本与索引。公共 status/plan 只返回 provenance 元数据，不暴露可执行 SQL。

生成命令会先在同一文件系统完整暂存 migration 目录与内嵌 catalogue 目录，再进行目录级替换；普通 I/O 失败会把两个目录一起回滚，避免留下已知的新旧混合生成物，额外旧成员也会在成功发布时被移除。

本包不读取环境变量、不创建连接、不接 API / desktop，也不接触真实数据或飞书。调用方必须提供一个已经连接、具备 migration owner 权限的 `pg.Client` 或已 checkout 的 `PoolClient`；裸 `pg.Pool` 和同一 client 上的并发控制面操作会在查询前被拒绝。生产运行身份不得拥有 DDL 或账本写权限。

```bash
pnpm db:migrations:generate
pnpm db:migrations:check
pnpm test                    # database unit + compiled-package smoke，无 PG15 前置
pnpm test:db                 # database 全门禁，含隔离 PG15
pnpm test:db:integration     # 仅隔离 PG15 集成门禁
```

PG15 集成门禁需要 `pg_config` 解析到 PostgreSQL 15，或设置 `CUSTOMER_AGENT_PG15_BIN=/path/to/postgresql-15/bin`。当前验证 `schema.v1.21` 全迁移安装及各已接入历史 ledger 的精确前缀升级；已发 0001–0028 的字节与来源不变；0025 是使用上下文合同增量，0026 仅追加按来源检索授权的物理索引，不改变合同、判定或 ACL。0027 不改变冻结 wire/DDL 表形状，追加私有回退审批谱系；既有不可登录 `cs_ai_definer` 仅获该表 SELECT，用于拒绝旧发布路径丢失回退审批的继承，应用 runtime/admin/worker/auth/review 角色仍无新表或函数访问权。回退事务重验上一版本、实际影响范围、独立人工审批及 60 秒提交截止，并原子写入新 release、公告、指针和永久回执；后续原生发布继承回退审批，失效时拒绝。未知、缺失、改写或额外 ledger 仍失败关闭。本地测试使用一次性 PostgreSQL 15 cluster 和合成数据，不构成托管 PG、备份恢复、部署或生产认证。

仓内其它 package 若需复用同一临时 PG15 证据面，只能以 devDependency 导入显式 `@customer-agent/database/testkit` 子入口；它不属于 migration/runtime 公共入口，也不得进入生产请求链。

负责人承接迁移保留 0001–0011 的原字节与来源，将完整新合同的六段增量按来源行号提取为单个事务，最后更新 schema marker。`app_owner_acceptance_registrar` 为未绑定登录的 NOLOGIN 能力角色；合同要求安装时不存在同名角色，遇到既有角色即回滚本段并保留可追踪的旧账本前缀。因此隔离测试各自使用独立 cluster，不向共享 cluster 重复安装。runtime 无登记、撤销或登记表读取权限，当前不授权真实装载。

历史 overlay 源与冻结 SQL 必须逐字节对应，修改旧源会失败关闭；新的产品事务必须追加 migration。P2 新命名空间纳入 ACL、对象/owner、DOMAIN 定义和 CHECK、函数和触发器的精确后验，应用角色仍无访问权；存储安装不代表新事务或正式激活已完成。

`0028_intake_family` 仅追加产品 overlay，不改冻结合同或旧迁移字节。私有 `content_intake.assert_family_catalog(releaseId)` 对完整目录验证显式通用根、同租户/应用/品牌/域、店铺不可自设品牌强制及商品/场景/半开时间三维交集；标题不建立关系。启用店铺稿要求根启用；停用历史保留引用，可同时停用根与店铺稿。根仍参与结构校验，即使它的生效时间已经结束。正常发布和纠正回退在既有内容锁与 current 事务内通过 publication trigger 共用校验；API 签发/续签资格复用该私有函数。旧发布入口遇显式家族目录明确拒绝继承，不丢失关系；只有既有不可登录 definer 获 candidate_versions SELECT 用于此拒绝，应用角色 ACL 保持关闭。真实 PG 门禁覆盖 27→28 精确前缀、冲突矩阵、ACL/trigger 篡改，以及 5,000 条完整目录与 50,000 条未引用历史条目的有界验证；另覆盖同一家族 1 个根与 4,999 个覆盖的商品互斥、场景互斥、全不限半开时间不交叠三种稠密合法目录。区间以 running-max 结束时间划分相交分量，每分量按商品或场景倒排桶预计配对数选择更稀疏的一维，wildcard 单独处理；最后仍验证真实三维交集。无关联条目的本地字段检查不进入根关联扫描，品牌根物化后供结构/品牌强制复用；5,000 条无关联目录连续 50 次逐页 guard 共享 5 秒数据库预算，避免把家族判定成本施加到普通分页。固定 seed `0x5eed0028` 的 85 个目录与独立朴素逐对 oracle 比对，覆盖长区间桥接、空集、多词项和停用。

`0029_intake_capacity` 增加 `object_reservations`（reserved/persisted/adopted/releasing/released）及 tenant 容量索引，不授予应用角色任何权限。API 在落盘前持久预留，业务事务原子采用；未知提交保留额度，清理成功且目录 fsync 后才能释放。历史保留期未批准，已登记对象及引用全部保留，干跑命令不能 apply。生命周期、真实 PG 并发及十倍历史证据见[容量收尾验收](../../evidence/qa/content-intake-p2-capacity/README.md)。
